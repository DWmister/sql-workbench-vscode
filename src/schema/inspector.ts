import * as fs from 'fs';
import mysql = require('mysql2/promise');
import { Client } from 'pg';
import initSqlJs = require('sql.js');
import type { ConnectionConfig } from '../connection/types';
import type { ColumnInfo, IndexInfo, TableDetails, TableInfo } from './types';

export interface SchemaInspector {
  listDatabases(connection: ConnectionConfig): Promise<string[]>;
  listTables(connection: ConnectionConfig): Promise<TableInfo[]>;
  getTableDetails(table: TableInfo): Promise<TableDetails>;
  getTableDdl(table: TableInfo): Promise<string>;
}

export interface SchemaInspectorOptions {
  getPassword?: (connectionId: string) => Promise<string | undefined>;
}

let sqlJsPromise: Promise<initSqlJs.SqlJsStatic> | undefined;

export function createSchemaInspector(options: SchemaInspectorOptions = {}): SchemaInspector {
  return {
    listDatabases(connection) {
      if (connection.type === 'mysql') {
        return listMysqlDatabases(connection, options);
      }

      if (connection.type === 'postgresql') {
        return listPostgresqlDatabases(connection, options);
      }

      return Promise.resolve([]);
    },
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
    getTableDdl(table) {
      if (table.connection.type === 'sqlite') {
        return getSqliteTableDdl(table);
      }

      if (table.connection.type === 'mysql') {
        return getMysqlTableDdl(table, options);
      }

      if (table.connection.type === 'postgresql') {
        return getPostgresqlTableDdl(table, options);
      }

      return Promise.reject(new Error(`DDL is not supported for ${table.connection.type}.`));
    },
  };
}

async function listMysqlDatabases(
  connection: ConnectionConfig,
  options: SchemaInspectorOptions,
): Promise<string[]> {
  const database = await openMysqlConnection(connection, options);
  try {
    const [rows] = await database.query('SHOW DATABASES;');
    return (rows as Array<Record<string, unknown>>)
      .map((row) => row.Database ?? Object.values(row)[0])
      .filter((name): name is string => typeof name === 'string' && Boolean(name.trim()))
      .sort((left, right) => left.localeCompare(right));
  } finally {
    await database.end();
  }
}

async function listPostgresqlDatabases(
  connection: ConnectionConfig,
  options: SchemaInspectorOptions,
): Promise<string[]> {
  const client = await openPostgresqlClient(connection, options);
  try {
    const result = await client.query(`
      SELECT datname AS name
      FROM pg_database
      WHERE datistemplate = false
        AND has_database_privilege(datname, 'CONNECT')
      ORDER BY datname;
    `);
    return result.rows
      .map((row: { name?: unknown }) => row.name)
      .filter((name): name is string => typeof name === 'string' && Boolean(name.trim()));
  } finally {
    await client.end().catch(() => undefined);
  }
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
      indexes: tryGetSqliteIndexes(database, table.name),
    };
  } finally {
    database.close();
  }
}

async function getSqliteTableDdl(
  table: TableInfo,
): Promise<string> {
  const database = await openSqliteDatabase(table.connection);
  try {
    const tableDdl = getSqliteSchemaStatements(database, 'table', table.name, table.name)[0];
    if (!tableDdl) {
      throw new Error(`Table ${table.name} was not found.`);
    }

    const indexDdls = getSqliteSchemaStatements(database, 'index', table.name);
    return joinDdlStatements([tableDdl, ...indexDdls]);
  } finally {
    database.close();
  }
}

function getSqliteSchemaStatements(
  database: initSqlJs.Database,
  type: 'table' | 'index',
  tableName: string,
  objectName?: string,
): string[] {
  const statement = database.prepare(`
    SELECT sql
    FROM sqlite_schema
    WHERE type = $type
      AND tbl_name = $tableName
      AND sql IS NOT NULL
      ${objectName ? 'AND name = $objectName' : ''}
    ORDER BY name COLLATE NOCASE;
  `);

  try {
    statement.bind({
      $type: type,
      $tableName: tableName,
      ...objectName ? { $objectName: objectName } : {},
    });

    const statements: string[] = [];
    while (statement.step()) {
      const sql = statement.getAsObject().sql;
      if (typeof sql === 'string' && sql.trim()) {
        statements.push(sql);
      }
    }
    return statements;
  } finally {
    statement.free();
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

function quoteMysqlIdentifier(identifier: string): string {
  return `\`${identifier.replace(/`/g, '``')}\``;
}

function quotePostgresqlIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function quotePostgresqlQualifiedName(schema: string, name: string): string {
  return `${quotePostgresqlIdentifier(schema)}.${quotePostgresqlIdentifier(name)}`;
}

function quotePostgresqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function joinDdlStatements(statements: string[]): string {
  return statements
    .map((statement) => statement.trim().replace(/;+\s*$/u, ''))
    .filter(Boolean)
    .map((statement) => `${statement};`)
    .join('\n\n');
}

function tryGetSqliteIndexes(
  database: initSqlJs.Database,
  tableName: string,
): IndexInfo[] | undefined {
  try {
    return getSqliteIndexes(database, tableName);
  } catch {
    return undefined;
  }
}

function getSqliteIndexes(
  database: initSqlJs.Database,
  tableName: string,
): IndexInfo[] {
  const indexList = database.exec(`PRAGMA index_list(${quoteIdentifier(tableName)});`)[0];
  if (!indexList) {
    return [];
  }

  return indexList.values.map((row): IndexInfo => {
    const name = String(row[1]);
    const unique = Number(row[2]) === 1;
    const origin = String(row[3] ?? '');
    const columnsResult = database.exec(`PRAGMA index_info(${quoteIdentifier(name)});`)[0];
    const columns = columnsResult?.values
      .map((columnRow) => String(columnRow[2]))
      .filter(Boolean) ?? [];

    return {
      name,
      columns,
      unique,
      primary: origin === 'pk',
    };
  });
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

    const indexes = await getMysqlIndexes(database, table).catch(() => undefined);

    return { ...table, columns, indexes };
  } finally {
    await database.end();
  }
}

async function getMysqlTableDdl(
  table: TableInfo,
  options: SchemaInspectorOptions,
): Promise<string> {
  const database = await openMysqlConnection(table.connection, options);
  try {
    const schema = table.schema ?? table.connection.database;
    const qualifiedName = schema
      ? `${quoteMysqlIdentifier(schema)}.${quoteMysqlIdentifier(table.name)}`
      : quoteMysqlIdentifier(table.name);
    const [rows] = await database.query(`SHOW CREATE TABLE ${qualifiedName};`);
    const row = (rows as Array<Record<string, unknown>>)[0];
    const ddl = row?.['Create Table']
      ?? Object.entries(row ?? {}).find(([key, value]) => /create\s+table/i.test(key) && typeof value === 'string')?.[1];

    if (typeof ddl !== 'string' || !ddl.trim()) {
      throw new Error(`MySQL did not return DDL for ${qualifiedName}.`);
    }

    return joinDdlStatements([ddl]);
  } finally {
    await database.end();
  }
}

async function getMysqlIndexes(
  database: mysql.Connection,
  table: TableInfo,
): Promise<IndexInfo[]> {
  const [rows] = await database.execute(
    `
    SELECT
      index_name AS name,
      non_unique AS non_unique,
      column_name AS column_name,
      seq_in_index AS seq_in_index
    FROM information_schema.statistics
    WHERE table_schema = ?
      AND table_name = ?
    ORDER BY index_name, seq_in_index;
    `,
    [table.schema ?? table.connection.database ?? '', table.name],
  );

  return groupIndexRows((rows as MysqlIndexRow[]).map((row) => ({
    name: row.name,
    column: row.column_name,
    ordinal: Number(row.seq_in_index),
    unique: Number(row.non_unique) === 0,
    primary: row.name === 'PRIMARY',
  })));
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

    const indexes = await getPostgresqlIndexes(client, table).catch(() => undefined);

    return { ...table, columns, indexes };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function getPostgresqlTableDdl(
  table: TableInfo,
  options: SchemaInspectorOptions,
): Promise<string> {
  const client = await openPostgresqlClient(table.connection, options);
  try {
    const schema = table.schema ?? 'public';
    const metadataResult = await client.query(
      `
      SELECT
        c.oid::text AS oid,
        c.relkind AS relation_kind,
        c.relispartition AS is_partition,
        c.reloptions AS relation_options,
        tablespace.spcname AS tablespace,
        obj_description(c.oid, 'pg_class') AS table_comment,
        pg_get_partkeydef(c.oid) AS partition_key,
        parent_namespace.nspname AS parent_schema,
        parent.relname AS parent_name,
        pg_get_expr(c.relpartbound, c.oid, true) AS partition_bound
      FROM pg_class c
      JOIN pg_namespace namespace ON namespace.oid = c.relnamespace
      LEFT JOIN pg_tablespace tablespace ON tablespace.oid = c.reltablespace
      LEFT JOIN pg_inherits inheritance ON inheritance.inhrelid = c.oid
      LEFT JOIN pg_class parent ON parent.oid = inheritance.inhparent
      LEFT JOIN pg_namespace parent_namespace ON parent_namespace.oid = parent.relnamespace
      WHERE namespace.nspname = $1
        AND c.relname = $2
        AND c.relkind IN ('r', 'p')
      LIMIT 1;
      `,
      [schema, table.name],
    );
    const metadata = metadataResult.rows[0] as PostgresqlTableMetadataRow | undefined;
    if (!metadata) {
      throw new Error(`Table ${schema}.${table.name} was not found.`);
    }

    const columnsResult = await client.query(
      `
      SELECT
        attribute.attname AS name,
        format_type(attribute.atttypid, attribute.atttypmod) AS type,
        attribute.attnotnull AS not_null,
        attribute.attidentity AS identity_kind,
        attribute.attgenerated AS generated_kind,
        pg_get_expr(default_value.adbin, default_value.adrelid, true) AS default_value,
        CASE
          WHEN attribute.attcollation <> type_definition.typcollation
          THEN quote_ident(collation_namespace.nspname) || '.' || quote_ident(collation.collname)
          ELSE NULL
        END AS collation,
        col_description(attribute.attrelid, attribute.attnum) AS comment
      FROM pg_attribute attribute
      JOIN pg_type type_definition ON type_definition.oid = attribute.atttypid
      LEFT JOIN pg_attrdef default_value
        ON default_value.adrelid = attribute.attrelid
        AND default_value.adnum = attribute.attnum
      LEFT JOIN pg_collation collation ON collation.oid = attribute.attcollation
      LEFT JOIN pg_namespace collation_namespace ON collation_namespace.oid = collation.collnamespace
      WHERE attribute.attrelid = $1::oid
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
      ORDER BY attribute.attnum;
      `,
      [metadata.oid],
    );
    const columns = columnsResult.rows as PostgresqlDdlColumnRow[];

    const constraintsResult = await client.query(
      `
      SELECT
        constraint_definition.conname AS name,
        pg_get_constraintdef(constraint_definition.oid, true) AS definition
      FROM pg_constraint constraint_definition
      WHERE constraint_definition.conrelid = $1::oid
        AND constraint_definition.contype IN ('p', 'u', 'f', 'c', 'x')
      ORDER BY
        CASE constraint_definition.contype
          WHEN 'p' THEN 1
          WHEN 'u' THEN 2
          WHEN 'c' THEN 3
          WHEN 'f' THEN 4
          ELSE 5
        END,
        constraint_definition.conname;
      `,
      [metadata.oid],
    );
    const constraints = constraintsResult.rows as PostgresqlConstraintRow[];

    const indexesResult = await client.query(
      `
      SELECT pg_get_indexdef(table_index.indexrelid, 0, true) AS definition
      FROM pg_index table_index
      LEFT JOIN pg_constraint constraint_definition
        ON constraint_definition.conindid = table_index.indexrelid
      WHERE table_index.indrelid = $1::oid
        AND constraint_definition.oid IS NULL
      ORDER BY table_index.indexrelid::regclass::text;
      `,
      [metadata.oid],
    );

    return buildPostgresqlTableDdl(
      schema,
      table.name,
      metadata,
      columns,
      constraints,
      indexesResult.rows as PostgresqlDdlIndexRow[],
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

function buildPostgresqlTableDdl(
  schema: string,
  tableName: string,
  metadata: PostgresqlTableMetadataRow,
  columns: PostgresqlDdlColumnRow[],
  constraints: PostgresqlConstraintRow[],
  indexes: PostgresqlDdlIndexRow[],
): string {
  const qualifiedName = quotePostgresqlQualifiedName(schema, tableName);
  const statements: string[] = [];

  if (metadata.is_partition && metadata.parent_name) {
    const parentName = quotePostgresqlQualifiedName(metadata.parent_schema ?? schema, metadata.parent_name);
    const partitionBound = metadata.partition_bound?.trim();
    statements.push(`CREATE TABLE ${qualifiedName} PARTITION OF ${parentName}${partitionBound ? `\n${partitionBound}` : ''}`);
  } else {
    const definitions = [
      ...columns.map(renderPostgresqlColumnDefinition),
      ...constraints.map((constraint) =>
        `CONSTRAINT ${quotePostgresqlIdentifier(constraint.name)} ${constraint.definition}`,
      ),
    ];
    let createTable = `CREATE TABLE ${qualifiedName} (\n${definitions.map((definition) => `  ${definition}`).join(',\n')}\n)`;

    if (metadata.relation_kind === 'p' && metadata.partition_key) {
      createTable += `\nPARTITION BY ${metadata.partition_key}`;
    }

    const relationOptions = normalizePostgresqlTextArray(metadata.relation_options);
    if (relationOptions.length > 0) {
      createTable += `\nWITH (${relationOptions.join(', ')})`;
    }

    if (metadata.tablespace) {
      createTable += `\nTABLESPACE ${quotePostgresqlIdentifier(metadata.tablespace)}`;
    }

    statements.push(createTable);
  }

  statements.push(...indexes
    .map((index) => index.definition)
    .filter((definition): definition is string => typeof definition === 'string' && Boolean(definition.trim())));

  if (metadata.table_comment !== null && metadata.table_comment !== undefined) {
    statements.push(`COMMENT ON TABLE ${qualifiedName} IS ${quotePostgresqlString(metadata.table_comment)}`);
  }

  for (const column of columns) {
    if (column.comment !== null && column.comment !== undefined) {
      statements.push(
        `COMMENT ON COLUMN ${qualifiedName}.${quotePostgresqlIdentifier(column.name)} IS ${quotePostgresqlString(column.comment)}`,
      );
    }
  }

  return joinDdlStatements(statements);
}

function renderPostgresqlColumnDefinition(column: PostgresqlDdlColumnRow): string {
  const clauses = [quotePostgresqlIdentifier(column.name), column.type];

  if (column.collation) {
    clauses.push(`COLLATE ${column.collation}`);
  }

  if (column.identity_kind === 'a') {
    clauses.push('GENERATED ALWAYS AS IDENTITY');
  } else if (column.identity_kind === 'd') {
    clauses.push('GENERATED BY DEFAULT AS IDENTITY');
  } else if (column.generated_kind) {
    const storage = column.generated_kind === 's' ? ' STORED' : '';
    clauses.push(`GENERATED ALWAYS AS (${column.default_value ?? ''})${storage}`);
  } else if (column.default_value !== null && column.default_value !== undefined) {
    clauses.push(`DEFAULT ${column.default_value}`);
  }

  if (column.not_null) {
    clauses.push('NOT NULL');
  }

  return clauses.join(' ');
}

function normalizePostgresqlTextArray(value: string[] | string | null): string[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value) {
    return [];
  }

  return value
    .replace(/^\{|\}$/g, '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function getPostgresqlIndexes(
  client: Client,
  table: TableInfo,
): Promise<IndexInfo[]> {
  const result = await client.query(
    `
    SELECT
      indexname AS name,
      indexdef AS definition
    FROM pg_indexes
    WHERE schemaname = $1
      AND tablename = $2
    ORDER BY indexname;
    `,
    [table.schema ?? 'public', table.name],
  );

  return result.rows.map((row: PostgresqlIndexRow): IndexInfo => ({
    name: row.name,
    columns: parsePostgresqlIndexColumns(row.definition),
    unique: /^CREATE\s+UNIQUE\s+INDEX\b/i.test(row.definition),
    primary: row.name.endsWith('_pkey'),
  }));
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

interface MysqlIndexRow {
  name: string;
  non_unique: number;
  column_name: string;
  seq_in_index: number;
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

interface PostgresqlIndexRow {
  name: string;
  definition: string;
}

interface PostgresqlTableMetadataRow {
  oid: string;
  relation_kind: 'r' | 'p';
  is_partition: boolean;
  relation_options: string[] | string | null;
  tablespace: string | null;
  table_comment: string | null;
  partition_key: string | null;
  parent_schema: string | null;
  parent_name: string | null;
  partition_bound: string | null;
}

interface PostgresqlDdlColumnRow {
  name: string;
  type: string;
  not_null: boolean;
  identity_kind: string;
  generated_kind: string;
  default_value: string | null;
  collation: string | null;
  comment: string | null;
}

interface PostgresqlConstraintRow {
  name: string;
  definition: string;
}

interface PostgresqlDdlIndexRow {
  definition: string | null;
}

interface NormalizedIndexRow {
  name: string;
  column: string;
  ordinal: number;
  unique: boolean;
  primary: boolean;
}

function groupIndexRows(rows: NormalizedIndexRow[]): IndexInfo[] {
  const grouped = new Map<string, NormalizedIndexRow[]>();

  for (const row of rows) {
    grouped.set(row.name, [...(grouped.get(row.name) ?? []), row]);
  }

  return Array.from(grouped.entries()).map(([name, indexRows]) => {
    const sortedRows = indexRows.sort((a, b) => a.ordinal - b.ordinal);
    return {
      name,
      columns: sortedRows.map((row) => row.column),
      unique: sortedRows.some((row) => row.unique),
      primary: sortedRows.some((row) => row.primary),
    };
  });
}

function parsePostgresqlIndexColumns(definition: string): string[] {
  const match = /\((.*)\)\s*$/u.exec(definition);
  if (!match) {
    return [];
  }

  return match[1]
    .split(',')
    .map((column) => column.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

function getTypeLength(type: string): string | undefined {
  const match = /\(([^)]+)\)/.exec(type);
  return match?.[1];
}

function normalizeOptionalText(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}
