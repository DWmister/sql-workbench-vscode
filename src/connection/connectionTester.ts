import * as fs from 'fs';
import mysql = require('mysql2/promise');
import { Client } from 'pg';
import initSqlJs = require('sql.js');
import type { NewConnectionConfig } from './types';

export interface DraftConnectionConfig extends NewConnectionConfig {
  password?: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
}

let sqlJsPromise: Promise<initSqlJs.SqlJsStatic> | undefined;

export async function testConnection(
  config: DraftConnectionConfig,
): Promise<ConnectionTestResult> {
  try {
    if (config.type === 'sqlite') {
      await testSqliteConnection(config);
    } else if (config.type === 'mysql') {
      await testMysqlConnection(config);
    } else if (config.type === 'postgresql') {
      await testPostgresqlConnection(config);
    } else {
      return { ok: false, message: 'Unsupported database type.' };
    }

    return { ok: true, message: 'Connection successful.' };
  } catch (error) {
    return { ok: false, message: getErrorMessage(error) };
  }
}

async function testSqliteConnection(config: DraftConnectionConfig): Promise<void> {
  if (!config.path) {
    throw new Error('SQLite database file path is required.');
  }

  const SQL = await getSqlJs();
  const databaseBytes = fs.existsSync(config.path)
    ? await fs.promises.readFile(config.path)
    : undefined;
  const database = new SQL.Database(databaseBytes);

  database.close();
}

async function testMysqlConnection(config: DraftConnectionConfig): Promise<void> {
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    multipleStatements: false,
  });

  try {
    await connection.ping();
  } finally {
    await connection.end();
  }
}

async function testPostgresqlConnection(config: DraftConnectionConfig): Promise<void> {
  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
  });

  try {
    await client.connect();
    await client.query('SELECT 1');
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function getSqlJs(): Promise<initSqlJs.SqlJsStatic> {
  sqlJsPromise ??= initSqlJs({
    locateFile: (fileName) => require.resolve(`sql.js/dist/${fileName}`),
  });
  return sqlJsPromise;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
