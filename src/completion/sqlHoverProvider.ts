import * as vscode from 'vscode';
import type { ConnectionConfig } from '../connection/types';
import type { SchemaInspector } from '../schema/inspector';
import type { ColumnInfo, IndexInfo, TableDetails, TableInfo } from '../schema/types';
import { normalizeIdentifier } from './sqlCompletionContext';

const CACHE_TTL_MS = 30_000;
const MAX_COLUMNS_IN_HOVER = 12;
const MAX_INDEXES_IN_HOVER = 6;

export interface SqlHoverProviderOptions {
  resolveConnection: (document?: vscode.TextDocument) => Promise<ConnectionConfig | undefined>;
  schemaInspector: SchemaInspector;
}

interface CachedTables {
  expiresAt: number;
  tables: TableInfo[];
}

interface CachedDetails {
  expiresAt: number;
  details: TableDetails;
}

export function registerSqlHoverProvider(
  options: SqlHoverProviderOptions,
): vscode.Disposable {
  const tableCache = new Map<string, CachedTables>();
  const detailsCache = new Map<string, CachedDetails>();

  return vscode.languages.registerHoverProvider(
    { language: 'sql', scheme: '*' },
    {
      async provideHover(document, position) {
        const token = getTableToken(document, position);
        if (!token) {
          return undefined;
        }

        const connection = await options.resolveConnection(document);
        if (!connection) {
          return undefined;
        }

        const table = await resolveTable(connection, token.text, options.schemaInspector, tableCache);
        if (!table) {
          return undefined;
        }

        const details = await loadTableDetails(table, options.schemaInspector, detailsCache);
        return new vscode.Hover(renderTableHover(details), token.range);
      },
    },
  );
}

async function resolveTable(
  connection: ConnectionConfig,
  token: string,
  schemaInspector: SchemaInspector,
  cache: Map<string, CachedTables>,
): Promise<TableInfo | undefined> {
  const tables = await loadTables(connection, schemaInspector, cache);
  const parts = token.split('.').map(normalizeIdentifier).filter(Boolean);
  const tableName = parts.at(-1);
  const schemaName = parts.length > 1 ? parts.at(-2) : undefined;

  if (!tableName) {
    return undefined;
  }

  return tables.find((table) =>
    normalizeIdentifier(table.name) === tableName
    && (!schemaName || normalizeIdentifier(table.schema ?? '') === schemaName),
  );
}

async function loadTables(
  connection: ConnectionConfig,
  schemaInspector: SchemaInspector,
  cache: Map<string, CachedTables>,
): Promise<TableInfo[]> {
  const cached = cache.get(connection.id);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.tables;
  }

  try {
    const tables = await schemaInspector.listTables(connection);
    cache.set(connection.id, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      tables,
    });
    return tables;
  } catch {
    return [];
  }
}

async function loadTableDetails(
  table: TableInfo,
  schemaInspector: SchemaInspector,
  cache: Map<string, CachedDetails>,
): Promise<TableDetails> {
  const cacheKey = [
    table.connection.id,
    normalizeIdentifier(table.schema ?? ''),
    normalizeIdentifier(table.name),
  ].join('.');
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.details;
  }

  const details = await schemaInspector.getTableDetails(table);
  cache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    details,
  });
  return details;
}

function getTableToken(
  document: vscode.TextDocument,
  position: vscode.Position,
): { text: string; range: vscode.Range } | undefined {
  const range = document.getWordRangeAtPosition(
    position,
    /[`"\[]?[A-Za-z_][\w$]*[`"\]]?(?:\.[`"\[]?[A-Za-z_][\w$]*[`"\]]?)?/,
  );

  if (!range) {
    return undefined;
  }

  const text = document.getText(range).trim();
  return text ? { text, range } : undefined;
}

function renderTableHover(details: TableDetails): vscode.MarkdownString {
  const tableName = details.schema
    ? `${details.schema}.${details.name}`
    : details.name;
  const primaryKeys = details.columns
    .filter((column) => column.primaryKey)
    .map((column) => column.name);
  const indexes = details.indexes ?? [];
  const markdown = new vscode.MarkdownString(undefined, true);

  markdown.isTrusted = false;
  markdown.appendMarkdown(`### ${escapeMarkdown(tableName)}\n\n`);
  markdown.appendMarkdown(`Connection: \`${details.connection.name}\`\n\n`);
  markdown.appendMarkdown(`Columns: **${details.columns.length}**`);
  if (primaryKeys.length > 0) {
    markdown.appendMarkdown(` · Primary key: \`${primaryKeys.join('`, `')}\``);
  }
  markdown.appendMarkdown('\n\n');

  markdown.appendMarkdown('**Indexes**\n\n');
  if (!details.indexes) {
    markdown.appendMarkdown('- unavailable\n\n');
  } else if (indexes.length === 0) {
    markdown.appendMarkdown('- none\n\n');
  } else {
    for (const index of indexes.slice(0, MAX_INDEXES_IN_HOVER)) {
      markdown.appendMarkdown(`- ${formatIndex(index)}\n`);
    }
    if (indexes.length > MAX_INDEXES_IN_HOVER) {
      markdown.appendMarkdown(`- ... ${indexes.length - MAX_INDEXES_IN_HOVER} more\n`);
    }
    markdown.appendMarkdown('\n');
  }

  markdown.appendMarkdown('**Columns**\n\n');
  for (const column of details.columns.slice(0, MAX_COLUMNS_IN_HOVER)) {
    markdown.appendMarkdown(`- ${formatColumn(column)}\n`);
  }
  if (details.columns.length > MAX_COLUMNS_IN_HOVER) {
    markdown.appendMarkdown(`- ... ${details.columns.length - MAX_COLUMNS_IN_HOVER} more\n`);
  }

  return markdown;
}

function formatIndex(index: IndexInfo): string {
  const flags = [
    index.primary ? 'primary' : undefined,
    index.unique ? 'unique' : undefined,
  ].filter(Boolean);
  const suffix = flags.length > 0 ? ` (${flags.join(', ')})` : '';
  const columns = index.columns.length > 0 ? index.columns.join(', ') : '-';
  return `\`${index.name}\`${suffix}: ${columns}`;
}

function formatColumn(column: ColumnInfo): string {
  const flags = [
    column.primaryKey ? 'PK' : undefined,
    column.nullable ? undefined : 'not null',
  ].filter(Boolean);
  const suffix = flags.length > 0 ? ` · ${flags.join(' · ')}` : '';
  const comment = column.comment ? ` — ${escapeMarkdown(column.comment)}` : '';

  return `\`${column.name}\` ${column.type || 'unknown'}${suffix}${comment}`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}[\]()#+\-.!|>])/g, '\\$1');
}
