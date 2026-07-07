import * as vscode from 'vscode';
import type { ConnectionConfig } from '../connection/types';
import type { SchemaInspector } from '../schema/inspector';
import type { TableDetails, TableInfo } from '../schema/types';

const SQL_KEYWORDS = [
  'SELECT',
  'FROM',
  'WHERE',
  'JOIN',
  'LEFT JOIN',
  'INNER JOIN',
  'GROUP BY',
  'ORDER BY',
  'LIMIT',
  'INSERT INTO',
  'UPDATE',
  'DELETE FROM',
  'CREATE TABLE',
  'ALTER TABLE',
  'WITH',
  'EXPLAIN',
];

const MAX_TABLES_FOR_COLUMN_HINTS = 30;
const CACHE_TTL_MS = 30_000;

export interface SqlCompletionProviderOptions {
  resolveConnection: () => Promise<ConnectionConfig | undefined>;
  schemaInspector: SchemaInspector;
}

interface CachedSchema {
  expiresAt: number;
  tables: TableInfo[];
  details: TableDetails[];
}

export function registerSqlCompletionProvider(
  options: SqlCompletionProviderOptions,
): vscode.Disposable {
  const cache = new Map<string, CachedSchema>();

  return vscode.languages.registerCompletionItemProvider(
    { language: 'sql', scheme: '*' },
    {
      async provideCompletionItems() {
        const items = createKeywordItems();
        const connection = await options.resolveConnection();

        if (!connection) {
          return items;
        }

        const schema = await loadSchema(connection, options.schemaInspector, cache);
        items.push(...createTableItems(schema.tables));
        items.push(...createColumnItems(schema.details));

        return items;
      },
    },
    '.',
  );
}

async function loadSchema(
  connection: ConnectionConfig,
  schemaInspector: SchemaInspector,
  cache: Map<string, CachedSchema>,
): Promise<CachedSchema> {
  const cached = cache.get(connection.id);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  try {
    const tables = await schemaInspector.listTables(connection);
    const details = await Promise.all(
      tables.slice(0, MAX_TABLES_FOR_COLUMN_HINTS).map((table) =>
        schemaInspector.getTableDetails(table),
      ),
    );
    const next: CachedSchema = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      tables,
      details,
    };

    cache.set(connection.id, next);
    return next;
  } catch {
    return {
      expiresAt: Date.now() + CACHE_TTL_MS,
      tables: [],
      details: [],
    };
  }
}

function createKeywordItems(): vscode.CompletionItem[] {
  return SQL_KEYWORDS.map((keyword) => {
    const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
    item.detail = 'SQL keyword';
    item.insertText = keyword;
    return item;
  });
}

function createTableItems(tables: TableInfo[]): vscode.CompletionItem[] {
  return tables.map((table) => {
    const item = new vscode.CompletionItem(table.name, vscode.CompletionItemKind.Struct);
    item.detail = table.schema ? `${table.schema} table` : 'table';
    item.insertText = table.name;
    return item;
  });
}

function createColumnItems(details: TableDetails[]): vscode.CompletionItem[] {
  return details.flatMap((table) =>
    table.columns.map((column) => {
      const item = new vscode.CompletionItem(column.name, vscode.CompletionItemKind.Field);
      item.detail = `${table.name}.${column.name}`;
      item.documentation = [
        column.type || 'column',
        column.primaryKey ? 'primary key' : undefined,
        column.nullable ? 'nullable' : 'not null',
      ].filter(Boolean).join(' · ');
      item.insertText = column.name;
      return item;
    }),
  );
}
