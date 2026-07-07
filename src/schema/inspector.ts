import * as fs from 'fs';
import mysql = require('mysql2/promise');
import { Client } from 'pg';
import initSqlJs = require('sql.js');
import type { ConnectionConfig } from '../connection/types';
import type { ColumnInfo, TableDetails, TableInfo } from './types';

export interface SchemaInspector {
  listTables(connection: ConnectionConfig): Promise<TableInfo[]>;
  getTableDetails(table: TableInfo): Promise<TableDetails>;
}

export interface SchemaInspectorOptions {
  getPassword?: (connectionId: string) => Promise<string | undefined>;
}

let sqlJsPromise: Promise<initSqlJs.SqlJsStatic> | undefined;

export function createSchemaInspector(options: SchemaInspectorOptions = {}): SchemaInspector {
  return {
    listTables(connection) {
      if (connection.type === 'sqlite') {
        return listSqliteTables(connection);
      }

      if (connection.type === 'mysql') {
        return listMysqlTables(connection, options);
      }

      if (connection.type === 'postgresql') {
        return listPostgresqlTables(connection, options);
      }

      return Promise.resolve([]);
    },
    getTableDetails(table) {
      if (table.connection.type === 'sqlite') {
        return getSqliteTableDetails(table);
      }

      if (table.connection.type === 'mysql') {
        return getMysqlTableDetails(table, options);
      }

      if (table.connection.type === 'postgresql') {
        return getPostgresqlTableDetails(table, options);
      }

      return Promise.resolve({ ...table, columns: [] });
    },
  };
}

async function listSqliteTables(
  connection: ConnectionConfig,
): Promise<TableInfo[]> {
  const database = await openSqliteDatabase(connection);
  try {
    const result = database.exec(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name COLLATE NOCASE;
    `);

    if (result.length === 0) {
      return [];
    }

    return result[0].values
      .map(([name]) => String(name))
      .map((name) => ({
        connection,
        name,
      }));
  } finally {
    database.close();
  }
}

async function getSqliteTableDetails(
  table: TableInfo,
): Promise<TableDetails> {
  const database = await openSqliteDatabase(table.connection);
  try {
    const result = database.exec(`PRAGMA table_info(${quoteIdentifier(table.name)});`);
    const columns = result[0]?.values.map((row): ColumnInfo => {
      const ordinal = Number(row[0]);
      const name = String(row[1]);
      const type = String(row[2] || '');
      const notNull = Number(row[3]) === 1;
      const defaultValue = row[4] === null || row[4] === undefined
        ? undefined
        : String(row[4]);
      const primaryKey = Number(row[5]) > 0;

      return {
        name,
        type,
        length: getTypeLength(type),
        nullable: !notNull && !primaryKey,
        primaryKey,
        defaultValue,
        ordinal,
      };
    }) ?? [];

    return {
      ...table,
      columns,
    };
  } finally {
    database.close();
  }
}

async function openSqliteDatabase(
  connection: ConnectionConfig,
): Promise<initSqlJs.Database> {
  if (!connection.path) {
    throw new Error('SQLite connection is missing a database file path.');
  }

  const SQL = await getSqlJs();
  const databaseBytes = fs.existsSync(connection.path)
    ? await fs.promises.readFile(connection.path)
    : undefined;

  return new SQL.Database(databaseBytes);
}

async function getSqlJs(): Promise<initSqlJs.SqlJsStatic> {
  sqlJsPromise ??= initSqlJs({
    locateFile: (fileName) => require.resolve(`sql.js/dist/${fileName}`),
  });
  return sqlJsPromise;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function listMysqlTables(
  connection: ConnectionConfig,
  options: SchemaInspectorOptions,
): Promise<TableInfo[]> {
  const database = await openMysqlConnection(connection, options);
  try {
    const [rows] = await database.query(
      `
      SELECT table_name AS name, table_schema AS \`schema\`
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_type = 'BASE TABLE'
      ORDER BY table_name;
      `,
    );

    return (rows as Array<{ name: string; schema: string }>).map((row) => ({
      connection,
      name: row.name,
      schema: row.schema,
    }));
  } finally {
    await database.end();
  }
}

async function getMysqlTableDetails(
  table: TableInfo,
  options: SchemaInspectorOptions,
): Promise<TableDetails> {
  const database = await openMysqlConnection(table.connection, options);
  try {
    const [rows] = await database.execute(
      `
      SELECT
        column_name AS name,
        column_type AS type,
        COALESCE(character_maximum_length, numeric_precision) AS length,
        is_nullable AS nullable,
        column_key AS column_key,
        column_default AS default_value,
        column_comment AS comment,
        ordinal_position AS ordinal
      FROM information_schema.columns
      WHERE table_schema = ?
        AND table_name = ?
      ORDER BY ordinal_position;
      `,
      [table.schema ?? table.connection.database ?? '', table.name],
    );

    const columns = (rows as MysqlColumnRow[]).map((row): ColumnInfo => ({
      name: row.name,
      type: row.type,
      length: row.length === null || row.length === undefined ? undefined : String(row.length),
      comment: normalizeOptionalText(row.comment),
      nullable: row.nullable === 'YES',
      primaryKey: row.column_key === 'PRI',
      defaultValue: row.default_value === null ? undefined : String(row.default_value),
      ordinal: Number(row.ordinal) - 1,
    }));

    return { ...table, columns };
  } finally {
    await database.end();
  }
}

async function listPostgresqlTables(
  connection: ConnectionConfig,
  options: SchemaInspectorOptions,
): Promise<TableInfo[]> {
  const client = await openPostgresqlClient(connection, options);
  try {
    const result = await client.query(`
      SELECT table_name AS name, table_schema AS schema
      FROM information_schema.tables
      WHERE table_catalog = current_database()
        AND table_schema NOT IN ('pg_catalog', 'information_schema')
        AND table_type = 'BASE TABLE'
      ORDER BY table_schema, table_name;
    `);

    return result.rows.map((row: { name: string; schema: string }) => ({
      connection,
      name: row.name,
      schema: row.schema,
    }));
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function getPostgresqlTableDetails(
  table: TableInfo,
  options: SchemaInspectorOptions,
): Promise<TableDetails> {
  const client = await openPostgresqlClient(table.connection, options);
  try {
    const result = await client.query(
      `
      SELECT
        c.column_name AS name,
        CASE
          WHEN c.character_maximum_length IS NOT NULL THEN c.data_type || '(' || c.character_maximum_length || ')'
          WHEN c.numeric_precision IS NOT NULL AND c.numeric_scale IS NOT NULL THEN c.data_type || '(' || c.numeric_precision || ',' || c.numeric_scale || ')'
          ELSE c.data_type
        END AS type,
        COALESCE(c.character_maximum_length, c.numeric_precision) AS length,
        c.is_nullable AS nullable,
        c.column_default AS default_value,
        c.ordinal_position AS ordinal,
        pg_catalog.col_description(
          (quote_ident(c.table_schema) || '.' || quote_ident(c.table_name))::regclass::oid,
          c.ordinal_position
        ) AS comment,
        EXISTS (
          SELECT 1
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
            AND tc.table_name = kcu.table_name
          WHERE tc.constraint_type = 'PRIMARY KEY'
            AND tc.table_schema = c.table_schema
            AND tc.table_name = c.table_name
            AND kcu.column_name = c.column_name
        ) AS primary_key
      FROM information_schema.columns c
      WHERE c.table_schema = $1
        AND c.table_name = $2
      ORDER BY c.ordinal_position;
      `,
      [table.schema ?? 'public', table.name],
    );

    const columns = result.rows.map((row: PostgresqlColumnRow): ColumnInfo => ({
      name: row.name,
      type: row.type,
      length: row.length === null || row.length === undefined ? undefined : String(row.length),
      comment: normalizeOptionalText(row.comment),
      nullable: row.nullable === 'YES',
      primaryKey: row.primary_key,
      defaultValue: row.default_value === null ? undefined : row.default_value,
      ordinal: Number(row.ordinal) - 1,
    }));

    return { ...table, columns };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function openMysqlConnection(
  connection: ConnectionConfig,
  options: SchemaInspectorOptions,
): Promise<mysql.Connection> {
  return mysql.createConnection({
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.username,
    password: await options.getPassword?.(connection.id),
    multipleStatements: false,
  });
}

async function openPostgresqlClient(
  connection: ConnectionConfig,
  options: SchemaInspectorOptions,
): Promise<Client> {
  const client = new Client({
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.username,
    password: await options.getPassword?.(connection.id),
  });

  await client.connect();
  return client;
}

interface MysqlColumnRow {
  name: string;
  type: string;
  length: number | null;
  nullable: 'YES' | 'NO';
  column_key: string;
  default_value: unknown;
  comment: string | null;
  ordinal: number;
}

interface PostgresqlColumnRow {
  name: string;
  type: string;
  length: number | null;
  nullable: 'YES' | 'NO';
  default_value: string | null;
  comment: string | null;
  ordinal: number;
  primary_key: boolean;
}

function getTypeLength(type: string): string | undefined {
  const match = /\(([^)]+)\)/.exec(type);
  return match?.[1];
}

function normalizeOptionalText(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}
