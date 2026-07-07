import * as fs from 'fs';
import * as path from 'path';
import { performance } from 'perf_hooks';
import initSqlJs = require('sql.js');
import type { ConnectionConfig } from '../connection/types';
import type { QueryColumn, QueryResult, QueryRow, QueryValue } from '../results/types';
import { splitSqlStatements } from './sqlParser';

export interface QueryRunner {
  execute(connection: ConnectionConfig, sql: string): Promise<QueryResult[]>;
}

let sqlJsPromise: Promise<initSqlJs.SqlJsStatic> | undefined;

export function createQueryRunner(): QueryRunner {
  return {
    execute(connection, sql) {
      if (connection.type === 'sqlite') {
        return executeSqlite(connection, sql);
      }

      return Promise.resolve([
        createErrorResult(
          connection,
          sql,
          `${connection.type} execution is not wired in the MVP yet. Keep the connection config; use SQLite for the first executable build.`,
          0,
        ),
      ]);
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
  return row.map((value): QueryValue => value);
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
