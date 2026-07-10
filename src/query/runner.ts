import * as fs from 'fs';
import * as path from 'path';
import { performance } from 'perf_hooks';
import mysql = require('mysql2/promise');
import { Client } from 'pg';
import initSqlJs = require('sql.js');
import type { ConnectionConfig } from '../connection/types';
import type { QueryColumn, QueryResult, QueryRow, QueryValue } from '../results/types';
import { splitSqlStatements } from './sqlParser';
import { compileSqlVariables, type SqlVariableDialect } from './sqlVariables';

export interface QueryRunner {
  execute(connection: ConnectionConfig, query: QueryInput, executionOptions?: QueryExecutionOptions): Promise<QueryResult[]>;
  fetchPage(connection: ConnectionConfig, request: QueryPageRequest, executionOptions?: QueryExecutionOptions): Promise<QueryResult>;
}

export type QueryInput = string | {
  sql: string;
  variableValues?: Record<string, unknown>;
};

export interface QueryExecutionOptions {
  queryTimeoutMs?: number;
  resultPageSize?: number;
}

export interface QueryPageRequest {
  sql: string;
  variableValues?: Record<string, unknown>;
  page: number;
  pageSize: number;
  totalRows: number;
}

export interface QueryRunnerOptions {
  getPassword?: (connectionId: string) => Promise<string | undefined>;
}

let sqlJsPromise: Promise<initSqlJs.SqlJsStatic> | undefined;

interface NormalizedQueryInput {
  sql: string;
  variableValues: Record<string, unknown>;
}

export function createQueryRunner(options: QueryRunnerOptions = {}): QueryRunner {
  return {
    execute(connection, query, executionOptions = {}) {
      const input = normalizeQueryInput(query);
      if (connection.type === 'sqlite') {
        return executeSqlite(connection, input, executionOptions);
      }

      if (connection.type === 'mysql') {
        return executeMysql(connection, input, options, executionOptions);
      }

      if (connection.type === 'postgresql') {
        return executePostgresql(connection, input, options, executionOptions);
      }

      return Promise.resolve([createErrorResult(connection, input.sql, 'Unsupported database type.', 0)]);
    },
    fetchPage(connection, request, executionOptions = {}) {
      if (connection.type === 'sqlite') {
        return fetchSqlitePage(connection, request, executionOptions);
      }

      if (connection.type === 'mysql') {
        return fetchMysqlPage(connection, request, options, executionOptions);
      }

      if (connection.type === 'postgresql') {
        return fetchPostgresqlPage(connection, request, options, executionOptions);
      }

      return Promise.resolve(createErrorResult(connection, request.sql, 'Unsupported database type.', 0));
    },
  };
}

async function executeSqlite(
  connection: ConnectionConfig,
  query: NormalizedQueryInput,
  executionOptions: QueryExecutionOptions,
): Promise<QueryResult[]> {
  if (!connection.path) {
    return [createErrorResult(connection, query.sql, 'SQLite connection is missing a database file path.', 0)];
  }

  const statements = splitSqlStatements(query.sql);
  if (statements.length === 0) {
    return [createErrorResult(connection, query.sql, 'No SQL statement to execute.', 0)];
  }

  const SQL = await getSqlJs();
  const databaseBytes = fs.existsSync(connection.path)
    ? await fs.promises.readFile(connection.path)
    : undefined;
  const database = new SQL.Database(databaseBytes);
  const results: QueryResult[] = [];
  let shouldPersist = false;

  try {
    if (statements.length === 1 && isPageableSelect(statements[0])) {
      results.push(executeSqlitePage(database, connection, statements[0], query.variableValues, 1, getResultPageSize(executionOptions), undefined));
      return results;
    }

    for (const statement of statements) {
      const start = performance.now();

      try {
        const readOnlyStatement = isReadOnlyStatement(statement);
        const compiled = compileQuery(statement, query.variableValues, 'sqlite');
        const executed = executeSqliteStatement(database, compiled.sql, compiled.params);
        const elapsedMs = roundElapsed(start);
        const affectedRows = database.getRowsModified();

        shouldPersist ||= !readOnlyStatement;

        if (executed.length === 0) {
          results.push({
            ...resultBase(connection, statement, elapsedMs),
            columns: [],
            rows: [],
            rowCount: 0,
            affectedRows: readOnlyStatement ? undefined : affectedRows,
          });
          continue;
        }

        for (const result of executed) {
          results.push({
            ...resultBase(connection, statement, elapsedMs),
            columns: result.columns.map((name): QueryColumn => ({ name })),
            rows: result.values.map(normalizeRow),
            rowCount: result.values.length,
            affectedRows: readOnlyStatement ? undefined : affectedRows,
          });
        }
      } catch (error) {
        results.push(createErrorResult(connection, statement, getErrorMessage(error), roundElapsed(start)));
        break;
      }
    }

    if (shouldPersist) {
      await persistSqliteDatabase(connection.path, database);
    }
  } finally {
    database.close();
  }

  return results;
}

async function fetchSqlitePage(
  connection: ConnectionConfig,
  request: QueryPageRequest,
  executionOptions: QueryExecutionOptions,
): Promise<QueryResult> {
  if (!connection.path) {
    return createErrorResult(connection, request.sql, 'SQLite connection is missing a database file path.', 0);
  }

  const SQL = await getSqlJs();
  const databaseBytes = fs.existsSync(connection.path)
    ? await fs.promises.readFile(connection.path)
    : undefined;
  const database = new SQL.Database(databaseBytes);

  try {
    return executeSqlitePage(database, connection, request.sql, request.variableValues ?? {}, request.page, request.pageSize, request.totalRows);
  } finally {
    database.close();
  }
}

function executeSqlitePage(
  database: initSqlJs.Database,
  connection: ConnectionConfig,
  sql: string,
  variableValues: Record<string, unknown>,
  page: number,
  pageSize: number,
  knownTotalRows: number | undefined,
): QueryResult {
  const start = performance.now();

  try {
    const compiled = compileQuery(sql, variableValues, 'sqlite');
    const totalRows = knownTotalRows ?? getSqliteCount(database, sql, variableValues);
    const pageSql = toPageSql(sql, page, pageSize);
    const pageCompiled = {
      ...compiled,
      sql: toPageSql(compiled.sql, page, pageSize),
    };
    const executed = executeSqliteStatement(database, pageCompiled.sql, pageCompiled.params);
    const result = executed[0];
    const elapsedMs = roundElapsed(start);

    return {
      ...resultBase(connection, sql, elapsedMs),
      columns: result ? result.columns.map((name): QueryColumn => ({ name })) : [],
      rows: result ? result.values.map(normalizeRow) : [],
      rowCount: totalRows,
      pagination: toPagination(sql, page, pageSize, totalRows, variableValues),
    };
  } catch (error) {
    return createErrorResult(connection, sql, getErrorMessage(error), roundElapsed(start));
  }
}

function getSqliteCount(database: initSqlJs.Database, sql: string, variableValues: Record<string, unknown>): number {
  const compiled = compileQuery(sql, variableValues, 'sqlite');
  const result = executeSqliteStatement(database, toCountSql(compiled.sql), compiled.params)[0];
  const value = result?.values[0]?.[0];
  return normalizeCount(value);
}

async function executeMysql(
  connection: ConnectionConfig,
  query: NormalizedQueryInput,
  options: QueryRunnerOptions,
  executionOptions: QueryExecutionOptions,
): Promise<QueryResult[]> {
  const statements = splitSqlStatements(query.sql);
  if (statements.length === 0) {
    return [createErrorResult(connection, query.sql, 'No SQL statement to execute.', 0)];
  }

  let database: mysql.Connection | undefined;
  const results: QueryResult[] = [];
  const queryTimeoutMs = normalizePositiveInteger(executionOptions.queryTimeoutMs, 30000);

  try {
    database = await mysql.createConnection({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      user: connection.username,
      password: await options.getPassword?.(connection.id),
      namedPlaceholders: false,
      multipleStatements: false,
      connectTimeout: queryTimeoutMs,
    });

    if (statements.length === 1 && isPageableSelect(statements[0])) {
      results.push(await executeMysqlPage(database, connection, statements[0], query.variableValues, 1, getResultPageSize(executionOptions), undefined, queryTimeoutMs));
      return results;
    }

    for (const statement of statements) {
      const start = performance.now();
      try {
        const compiled = compileQuery(statement, query.variableValues, 'mysql');
        const [rows, fields] = await database.query({ sql: compiled.sql, timeout: queryTimeoutMs }, compiled.params);
        const result = toMysqlResult(connection, statement, rows, fields, roundElapsed(start));
        results.push(result);
      } catch (error) {
        results.push(createErrorResult(connection, statement, getErrorMessage(error), roundElapsed(start)));
        break;
      }
    }
  } catch (error) {
    return [createErrorResult(connection, query.sql, getErrorMessage(error), 0)];
  } finally {
    await database?.end();
  }

  return results;
}

async function fetchMysqlPage(
  connection: ConnectionConfig,
  request: QueryPageRequest,
  options: QueryRunnerOptions,
  executionOptions: QueryExecutionOptions,
): Promise<QueryResult> {
  const queryTimeoutMs = normalizePositiveInteger(executionOptions.queryTimeoutMs, 30000);
  let database: mysql.Connection | undefined;

  try {
    database = await mysql.createConnection({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      user: connection.username,
      password: await options.getPassword?.(connection.id),
      namedPlaceholders: false,
      multipleStatements: false,
      connectTimeout: queryTimeoutMs,
    });
    return await executeMysqlPage(database, connection, request.sql, request.variableValues ?? {}, request.page, request.pageSize, request.totalRows, queryTimeoutMs);
  } catch (error) {
    return createErrorResult(connection, request.sql, getErrorMessage(error), 0);
  } finally {
    await database?.end();
  }
}

async function executeMysqlPage(
  database: mysql.Connection,
  connection: ConnectionConfig,
  sql: string,
  variableValues: Record<string, unknown>,
  page: number,
  pageSize: number,
  knownTotalRows: number | undefined,
  queryTimeoutMs: number,
): Promise<QueryResult> {
  const start = performance.now();

  try {
    const compiled = compileQuery(sql, variableValues, 'mysql');
    const totalRows = knownTotalRows ?? await getMysqlCount(database, sql, variableValues, queryTimeoutMs);
    const [rows, fields] = await database.query({ sql: toPageSql(compiled.sql, page, pageSize), timeout: queryTimeoutMs }, compiled.params);
    const result = toMysqlResult(connection, sql, rows, fields, roundElapsed(start));

    return {
      ...result,
      rowCount: totalRows,
      pagination: toPagination(sql, page, pageSize, totalRows, variableValues),
    };
  } catch (error) {
    return createErrorResult(connection, sql, getErrorMessage(error), roundElapsed(start));
  }
}

async function getMysqlCount(database: mysql.Connection, sql: string, variableValues: Record<string, unknown>, queryTimeoutMs: number): Promise<number> {
  const compiled = compileQuery(sql, variableValues, 'mysql');
  const [rows] = await database.query({ sql: toCountSql(compiled.sql), timeout: queryTimeoutMs }, compiled.params);
  return normalizeCount((rows as Array<Record<string, unknown>>)[0]?.total_count);
}

async function executePostgresql(
  connection: ConnectionConfig,
  query: NormalizedQueryInput,
  options: QueryRunnerOptions,
  executionOptions: QueryExecutionOptions,
): Promise<QueryResult[]> {
  const statements = splitSqlStatements(query.sql);
  if (statements.length === 0) {
    return [createErrorResult(connection, query.sql, 'No SQL statement to execute.', 0)];
  }

  const queryTimeoutMs = normalizePositiveInteger(executionOptions.queryTimeoutMs, 30000);
  const client = new Client({
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.username,
    password: await options.getPassword?.(connection.id),
    connectionTimeoutMillis: queryTimeoutMs,
    query_timeout: queryTimeoutMs,
    statement_timeout: queryTimeoutMs,
  });
  const results: QueryResult[] = [];

  try {
    await client.connect();

    if (statements.length === 1 && isPageableSelect(statements[0])) {
      results.push(await executePostgresqlPage(client, connection, statements[0], query.variableValues, 1, getResultPageSize(executionOptions), undefined));
      return results;
    }

    for (const statement of statements) {
      const start = performance.now();
      try {
        const compiled = compileQuery(statement, query.variableValues, 'postgresql');
        const result = await client.query(compiled.sql, compiled.params);
        const columns = result.fields.map((field): QueryColumn => ({
          name: field.name,
          type: normalizePostgresqlColumnType(field.dataTypeID),
        }));
        const rows = result.rows.map((row) => columns.map((column) => normalizeValue(row[column.name])));

        results.push({
          ...resultBase(connection, statement, roundElapsed(start)),
          columns,
          rows,
          rowCount: rows.length,
          affectedRows: isReadOnlyStatement(statement) ? undefined : (result.rowCount ?? undefined),
        });
      } catch (error) {
        results.push(createErrorResult(connection, statement, getErrorMessage(error), roundElapsed(start)));
        break;
      }
    }
  } catch (error) {
    return [createErrorResult(connection, query.sql, getErrorMessage(error), 0)];
  } finally {
    await client.end().catch(() => undefined);
  }

  return results;
}

async function fetchPostgresqlPage(
  connection: ConnectionConfig,
  request: QueryPageRequest,
  options: QueryRunnerOptions,
  executionOptions: QueryExecutionOptions,
): Promise<QueryResult> {
  const queryTimeoutMs = normalizePositiveInteger(executionOptions.queryTimeoutMs, 30000);
  const client = new Client({
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.username,
    password: await options.getPassword?.(connection.id),
    connectionTimeoutMillis: queryTimeoutMs,
    query_timeout: queryTimeoutMs,
    statement_timeout: queryTimeoutMs,
  });

  try {
    await client.connect();
    return await executePostgresqlPage(client, connection, request.sql, request.variableValues ?? {}, request.page, request.pageSize, request.totalRows);
  } catch (error) {
    return createErrorResult(connection, request.sql, getErrorMessage(error), 0);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function executePostgresqlPage(
  client: Client,
  connection: ConnectionConfig,
  sql: string,
  variableValues: Record<string, unknown>,
  page: number,
  pageSize: number,
  knownTotalRows: number | undefined,
): Promise<QueryResult> {
  const start = performance.now();

  try {
    const compiled = compileQuery(sql, variableValues, 'postgresql');
    const totalRows = knownTotalRows ?? await getPostgresqlCount(client, sql, variableValues);
    const result = await client.query(toPageSql(compiled.sql, page, pageSize), compiled.params);
    const columns = result.fields.map((field): QueryColumn => ({
      name: field.name,
      type: normalizePostgresqlColumnType(field.dataTypeID),
    }));
    const rows = result.rows.map((row) => columns.map((column) => normalizeValue(row[column.name])));

    return {
      ...resultBase(connection, sql, roundElapsed(start)),
      columns,
      rows,
      rowCount: totalRows,
      pagination: toPagination(sql, page, pageSize, totalRows, variableValues),
    };
  } catch (error) {
    return createErrorResult(connection, sql, getErrorMessage(error), roundElapsed(start));
  }
}

async function getPostgresqlCount(client: Client, sql: string, variableValues: Record<string, unknown>): Promise<number> {
  const compiled = compileQuery(sql, variableValues, 'postgresql');
  const result = await client.query(toCountSql(compiled.sql), compiled.params);
  return normalizeCount(result.rows[0]?.total_count);
}


function toMysqlResult(
  connection: ConnectionConfig,
  sql: string,
  rows: unknown,
  fields: mysql.FieldPacket[] | mysql.FieldPacket[][] | undefined,
  elapsedMs: number,
): QueryResult {
  const fieldList = Array.isArray(fields) && !Array.isArray(fields[0])
    ? fields as mysql.FieldPacket[]
    : [];
  const columns = fieldList.map((field): QueryColumn => ({
    name: field.name,
    type: normalizeMysqlColumnType(field.type),
  }));

  if (Array.isArray(rows)) {
    const rowObjects = rows as Record<string, unknown>[];
    const fallbackColumns = columns.length > 0
      ? columns
      : Object.keys(rowObjects[0] ?? {}).map((name): QueryColumn => ({ name }));
    const normalizedRows = rowObjects.map((row) =>
      fallbackColumns.map((column) => normalizeValue(row[column.name])),
    );

    return {
      ...resultBase(connection, sql, elapsedMs),
      columns: fallbackColumns,
      rows: normalizedRows,
      rowCount: normalizedRows.length,
    };
  }

  const affectedRows = getAffectedRows(rows);
  return {
    ...resultBase(connection, sql, elapsedMs),
    columns: [],
    rows: [],
    rowCount: 0,
    affectedRows,
  };
}

function normalizeMysqlColumnType(type: number | undefined): string | undefined {
  if (type === undefined) {
    return undefined;
  }
  return type === 245 ? 'json' : String(type);
}

function normalizePostgresqlColumnType(type: number): string {
  if (type === 114) {
    return 'json';
  }
  if (type === 3802) {
    return 'jsonb';
  }
  if (type === 199) {
    return 'json[]';
  }
  if (type === 3807) {
    return 'jsonb[]';
  }
  return String(type);
}

async function getSqlJs(): Promise<initSqlJs.SqlJsStatic> {
  sqlJsPromise ??= initSqlJs({
    locateFile: (fileName) => require.resolve(`sql.js/dist/${fileName}`),
  });
  return sqlJsPromise;
}

function normalizeQueryInput(query: QueryInput): NormalizedQueryInput {
  if (typeof query === 'string') {
    return {
      sql: query,
      variableValues: {},
    };
  }

  return {
    sql: query.sql,
    variableValues: query.variableValues ?? {},
  };
}

async function persistSqliteDatabase(databasePath: string, database: initSqlJs.Database): Promise<void> {
  await fs.promises.mkdir(path.dirname(databasePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(databasePath),
    `.${path.basename(databasePath)}.${process.pid}.${Date.now()}.tmp`,
  );

  try {
    await fs.promises.writeFile(tempPath, Buffer.from(database.export()));
    await fs.promises.rename(tempPath, databasePath);
  } catch (error) {
    await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function compileQuery(
  sql: string,
  variableValues: Record<string, unknown>,
  dialect: SqlVariableDialect,
): { sql: string; params: unknown[] } {
  return compileSqlVariables(sql, variableValues, dialect);
}

function executeSqliteStatement(
  database: initSqlJs.Database,
  sql: string,
  params: unknown[],
): initSqlJs.QueryExecResult[] {
  if (params.length === 0) {
    return database.exec(sql);
  }

  const statement = database.prepare(sql);
  try {
    statement.bind(params as initSqlJs.BindParams);
    const columns = statement.getColumnNames();
    const values: initSqlJs.SqlValue[][] = [];

    while (statement.step()) {
      values.push(statement.get());
    }

    return columns.length > 0
      ? [{ columns, values }]
      : [];
  } finally {
    statement.free();
  }
}

function resultBase(
  connection: ConnectionConfig,
  sql: string,
  elapsedMs: number,
): Pick<QueryResult, 'sql' | 'elapsedMs' | 'readOnly' | 'connectionId' | 'connectionName' | 'executedAt'> {
  return {
    sql,
    elapsedMs,
    readOnly: true,
    connectionId: connection.id,
    connectionName: connection.name,
    executedAt: new Date().toISOString(),
  };
}

function createErrorResult(
  connection: ConnectionConfig,
  sql: string,
  error: string,
  elapsedMs: number,
): QueryResult {
  return {
    ...resultBase(connection, sql, elapsedMs),
    columns: [],
    rows: [],
    rowCount: 0,
    error,
  };
}

function normalizeRow(row: initSqlJs.SqlValue[]): QueryRow {
  return row.map(normalizeValue);
}

function normalizeValue(value: unknown): QueryValue {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
    || value instanceof Uint8Array
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Buffer.isBuffer(value)) {
    return new Uint8Array(value);
  }

  if (value === undefined) {
    return null;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isReadOnlyStatement(sql: string): boolean {
  return /^(?:select|with|explain)\b/i.test(sql.trim());
}

function isPageableSelect(sql: string): boolean {
  const trimmed = sql.trim();
  return /^(?:select|with)\b/i.test(trimmed)
    && !/\blimit\b/i.test(trimmed)
    && !/\bfor\s+(?:update|share)\b/i.test(trimmed);
}

function toCountSql(sql: string): string {
  return `SELECT COUNT(*) AS total_count FROM (${trimSql(sql)}) AS sql_workbench_count`;
}

function toPageSql(sql: string, page: number, pageSize: number): string {
  const offset = Math.max(0, page - 1) * pageSize;
  return `${trimSql(sql)} LIMIT ${pageSize} OFFSET ${offset}`;
}

function toPagination(
  sql: string,
  page: number,
  pageSize: number,
  totalRows: number,
  variableValues: Record<string, unknown> = {},
): QueryResult['pagination'] {
  return {
    mode: 'server',
    sourceSql: sql,
    variableValues: Object.keys(variableValues).length > 0 ? variableValues : undefined,
    page,
    pageSize,
    totalRows,
  };
}

function trimSql(sql: string): string {
  return sql.trim().replace(/;+$/u, '').trimEnd();
}

function normalizeCount(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'bigint') {
    return Number(value);
  }

  if (typeof value === 'string') {
    return Number(value);
  }

  return 0;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function roundElapsed(start: number): number {
  return Math.round((performance.now() - start) * 100) / 100;
}

function getAffectedRows(rows: unknown): number | undefined {
  if (typeof rows !== 'object' || rows === null) {
    return undefined;
  }

  const candidate = rows as { affectedRows?: unknown; rowCount?: unknown };
  if (typeof candidate.affectedRows === 'number') {
    return candidate.affectedRows;
  }

  if (typeof candidate.rowCount === 'number') {
    return candidate.rowCount;
  }

  return undefined;
}

function getResultPageSize(executionOptions: QueryExecutionOptions): number {
  return normalizePositiveInteger(executionOptions.resultPageSize, 10);
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value !== undefined && value > 0 ? value : fallback;
}
