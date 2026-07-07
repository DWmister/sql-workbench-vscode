import * as fs from 'fs';
import * as path from 'path';
import { performance } from 'perf_hooks';
import mysql = require('mysql2/promise');
import { Client } from 'pg';
import initSqlJs = require('sql.js');
import type { ConnectionConfig } from '../connection/types';
import type { QueryColumn, QueryResult, QueryRow, QueryValue } from '../results/types';
import { splitSqlStatements } from './sqlParser';

export interface QueryRunner {
  execute(connection: ConnectionConfig, sql: string): Promise<QueryResult[]>;
}

export interface QueryRunnerOptions {
  getPassword?: (connectionId: string) => Promise<string | undefined>;
}

let sqlJsPromise: Promise<initSqlJs.SqlJsStatic> | undefined;

export function createQueryRunner(options: QueryRunnerOptions = {}): QueryRunner {
  return {
    execute(connection, sql) {
      if (connection.type === 'sqlite') {
        return executeSqlite(connection, sql);
      }

      if (connection.type === 'mysql') {
        return executeMysql(connection, sql, options);
      }

      if (connection.type === 'postgresql') {
        return executePostgresql(connection, sql, options);
      }

      return Promise.resolve([createErrorResult(connection, sql, 'Unsupported database type.', 0)]);
    },
  };
}

async function executeSqlite(
  connection: ConnectionConfig,
  sql: string,
): Promise<QueryResult[]> {
  if (!connection.path) {
    return [
      createErrorResult(
        connection,
        sql,
        'SQLite connection is missing a database file path.',
        0,
      ),
    ];
  }

  const statements = splitSqlStatements(sql);
  if (statements.length === 0) {
    return [
      createErrorResult(connection, sql, 'No SQL statement to execute.', 0),
    ];
  }

  const SQL = await getSqlJs();
  const databaseBytes = fs.existsSync(connection.path)
    ? await fs.promises.readFile(connection.path)
    : undefined;
  const database = new SQL.Database(databaseBytes);
  const results: QueryResult[] = [];
  let shouldPersist = false;

  try {
    for (const statement of statements) {
      const start = performance.now();

      try {
        const readOnlyStatement = isReadOnlyStatement(statement);
        const executed = database.exec(statement);
        const elapsedMs = Math.round((performance.now() - start) * 100) / 100;
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
        const elapsedMs = Math.round((performance.now() - start) * 100) / 100;
        results.push(
          createErrorResult(connection, statement, getErrorMessage(error), elapsedMs),
        );
        break;
      }
    }

    if (shouldPersist) {
      await fs.promises.mkdir(path.dirname(connection.path), { recursive: true });
      await fs.promises.writeFile(connection.path, Buffer.from(database.export()));
    }
  } finally {
    database.close();
  }

  return results;
}

async function executeMysql(
  connection: ConnectionConfig,
  sql: string,
  options: QueryRunnerOptions,
): Promise<QueryResult[]> {
  const statements = splitSqlStatements(sql);
  if (statements.length === 0) {
    return [createErrorResult(connection, sql, 'No SQL statement to execute.', 0)];
  }

  let database: mysql.Connection | undefined;
  const results: QueryResult[] = [];

  try {
    database = await mysql.createConnection({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      user: connection.username,
      password: await options.getPassword?.(connection.id),
      namedPlaceholders: false,
      multipleStatements: false,
    });

    for (const statement of statements) {
      const start = performance.now();
      try {
        const [rows, fields] = await database.query(statement);
        const elapsedMs = roundElapsed(start);
        results.push(toMysqlResult(connection, statement, rows, fields, elapsedMs));
      } catch (error) {
        results.push(createErrorResult(connection, statement, getErrorMessage(error), roundElapsed(start)));
        break;
      }
    }
  } catch (error) {
    return [createErrorResult(connection, sql, getErrorMessage(error), 0)];
  } finally {
    await database?.end();
  }

  return results;
}

async function executePostgresql(
  connection: ConnectionConfig,
  sql: string,
  options: QueryRunnerOptions,
): Promise<QueryResult[]> {
  const statements = splitSqlStatements(sql);
  if (statements.length === 0) {
    return [createErrorResult(connection, sql, 'No SQL statement to execute.', 0)];
  }

  const client = new Client({
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.username,
    password: await options.getPassword?.(connection.id),
  });
  const results: QueryResult[] = [];

  try {
    await client.connect();

    for (const statement of statements) {
      const start = performance.now();
      try {
        const result = await client.query(statement);
        const elapsedMs = roundElapsed(start);
        const columns = result.fields.map((field): QueryColumn => ({
          name: field.name,
          type: String(field.dataTypeID),
        }));
        const rows = result.rows.map((row) => columns.map((column) => normalizeValue(row[column.name])));

        results.push({
          ...resultBase(connection, statement, elapsedMs),
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
    return [createErrorResult(connection, sql, getErrorMessage(error), 0)];
  } finally {
    await client.end().catch(() => undefined);
  }

  return results;
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
    type: String(field.type),
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

async function getSqlJs(): Promise<initSqlJs.SqlJsStatic> {
  sqlJsPromise ??= initSqlJs({
    locateFile: (fileName) => require.resolve(`sql.js/dist/${fileName}`),
  });
  return sqlJsPromise;
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
