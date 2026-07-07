import * as fs from 'fs';
import initSqlJs = require('sql.js');
import type { ConnectionConfig } from '../connection/types';
import type { ColumnInfo, TableDetails, TableInfo } from './types';

export interface SchemaInspector {
  listTables(connection: ConnectionConfig): Promise<TableInfo[]>;
  getTableDetails(table: TableInfo): Promise<TableDetails>;
}

let sqlJsPromise: Promise<initSqlJs.SqlJsStatic> | undefined;

export function createSchemaInspector(): SchemaInspector {
  return {
    listTables(connection) {
      if (connection.type !== 'sqlite') {
        return Promise.resolve([]);
      }

      return listSqliteTables(connection);
    },
    getTableDetails(table) {
      if (table.connection.type !== 'sqlite') {
        return Promise.resolve({ ...table, columns: [] });
      }

      return getSqliteTableDetails(table);
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
