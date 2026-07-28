import type { ConnectionConfig } from '../connection/types';
import type { SchemaInspector } from '../schema/inspector';
import type { TableDetails, TableInfo } from '../schema/types';

export const MAX_SCHEMA_SEARCH_RESULTS = 20;
export const MAX_SCHEMA_DESCRIPTIONS = 8;

const MAX_SCHEMA_QUERY_LENGTH = 200;

export interface AiSchemaTable {
  name: string;
  schema?: string;
  estimatedRowCount?: number;
}

export interface AiSchemaColumn {
  name: string;
  type: string;
  length?: string;
  nullable: boolean;
  primaryKey: boolean;
  /**
   * Database comments are untrusted reference data. They are never treated as
   * instructions by the Agent runtime.
   */
  untrustedComment?: string;
}

export interface AiSchemaIndex {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
}

export interface AiSchemaTableDetails extends AiSchemaTable {
  columns: AiSchemaColumn[];
  indexes: AiSchemaIndex[];
}

export interface AiSchemaTools {
  searchTables(
    connection: ConnectionConfig,
    query: string,
    limit?: number,
  ): Promise<AiSchemaTable[]>;
  describeTables(
    connection: ConnectionConfig,
    tables: readonly AiSchemaTableReference[],
  ): Promise<AiSchemaTableDetails[]>;
}

export interface AiSchemaTableReference {
  name: string;
  schema?: string;
}

export function createAiSchemaTools(inspector: SchemaInspector): AiSchemaTools {
  return {
    async searchTables(connection, query, requestedLimit) {
      const normalizedQuery = query.trim().slice(0, MAX_SCHEMA_QUERY_LENGTH);
      const limit = clampLimit(requestedLimit, MAX_SCHEMA_SEARCH_RESULTS);
      const tables = await inspector.listTables(connection);
      const matches = normalizedQuery
        ? tables.filter((table) => tableMatches(table, normalizedQuery))
        : tables;
      return matches.slice(0, limit).map(projectTableInfo);
    },

    async describeTables(connection, references) {
      const requested = normalizeReferences(references).slice(0, MAX_SCHEMA_DESCRIPTIONS);
      if (requested.length === 0) {
        return [];
      }

      const tables = await inspector.listTables(connection);
      const selected = requested
        .map((reference) => findTable(tables, reference))
        .filter((table): table is TableInfo => table !== undefined);
      const details = await Promise.all(
        selected.map((table) => inspector.getTableDetails(table)),
      );
      return details.map(projectTableDetails);
    },
  };
}

/**
 * These projection functions are the only boundary where database Schema
 * entities become model-safe data. Never serialize TableInfo/TableDetails
 * directly: they contain ConnectionConfig and column default values.
 */
export function projectTableInfo(table: TableInfo): AiSchemaTable {
  return compact({
    name: table.name,
    schema: table.schema,
    estimatedRowCount: finiteNonNegative(table.rowCount),
  });
}

export function projectTableDetails(table: TableDetails): AiSchemaTableDetails {
  return {
    ...projectTableInfo(table),
    columns: table.columns.map((column) => compact({
      name: column.name,
      type: column.type,
      length: column.length,
      nullable: column.nullable,
      primaryKey: column.primaryKey,
      untrustedComment: cleanUntrustedText(column.comment),
    })),
    indexes: (table.indexes ?? []).map((index) => ({
      name: index.name,
      columns: [...index.columns],
      unique: index.unique,
      primary: index.primary === true,
    })),
  };
}

function tableMatches(table: TableInfo, query: string): boolean {
  const needle = query.toLocaleLowerCase();
  return table.name.toLocaleLowerCase().includes(needle)
    || table.schema?.toLocaleLowerCase().includes(needle) === true;
}

function normalizeReferences(
  references: readonly AiSchemaTableReference[],
): AiSchemaTableReference[] {
  const unique = new Map<string, AiSchemaTableReference>();
  for (const reference of references.slice(0, MAX_SCHEMA_DESCRIPTIONS)) {
    if (!reference || typeof reference.name !== 'string') {
      continue;
    }
    const name = reference.name.trim().slice(0, 256);
    const schema = typeof reference.schema === 'string'
      ? reference.schema.trim().slice(0, 256) || undefined
      : undefined;
    if (!name) {
      continue;
    }
    const key = `${schema ?? ''}\u0000${name}`.toLocaleLowerCase();
    if (!unique.has(key)) {
      unique.set(key, compact({ name, schema }));
    }
  }
  return [...unique.values()];
}

function findTable(
  tables: readonly TableInfo[],
  reference: AiSchemaTableReference,
): TableInfo | undefined {
  const name = reference.name.toLocaleLowerCase();
  const schema = reference.schema?.toLocaleLowerCase();
  return tables.find((table) => (
    table.name.toLocaleLowerCase() === name
    && (schema === undefined || table.schema?.toLocaleLowerCase() === schema)
  ));
}

function clampLimit(requested: number | undefined, maximum: number): number {
  return requested === undefined || !Number.isFinite(requested)
    ? maximum
    : Math.max(1, Math.min(maximum, Math.floor(requested)));
}

function finiteNonNegative(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function cleanUntrustedText(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\u0000/g, '').trim();
  return normalized ? normalized.slice(0, 2_000) : undefined;
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
