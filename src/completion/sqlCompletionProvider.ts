import * as vscode from 'vscode';
import type { ConnectionConfig } from '../connection/types';
import type { SchemaInspector } from '../schema/inspector';
import type { TableDetails, TableInfo } from '../schema/types';
import {
  type CompletionContext,
  getScopedTableDetails,
  getSqlCompletionContext,
  normalizeIdentifier,
} from './sqlCompletionContext';

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
      async provideCompletionItems(document, position) {
        const items = createKeywordItems();
        const connection = await options.resolveConnection();

        if (!connection) {
          return items;
        }

        const schema = await loadSchema(connection, options.schemaInspector, cache);
        const context = getCompletionContext(document, position);
        await ensureReferencedTableDetails(schema, context, options.schemaInspector);
        const scopedDetails = getScopedTableDetails(schema.details, context);

        if (context.aliasQualifier) {
          return createColumnItems(scopedDetails, context.aliasQualifier);
        }

        items.push(...createTableItems(schema.tables));
        items.push(...createColumnItems(scopedDetails));

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

async function ensureReferencedTableDetails(
  schema: CachedSchema,
  context: CompletionContext,
  schemaInspector: SchemaInspector,
): Promise<void> {
  const loaded = new Set(schema.details.map((table) => normalizeIdentifier(table.name)));
  const needed = new Set(context.tableRefs.map((tableRef) => tableRef.tableName));

  for (const tableName of needed) {
    if (loaded.has(tableName)) {
      continue;
    }

    const table = schema.tables.find((candidate) => normalizeIdentifier(candidate.name) === tableName);
    if (!table) {
      continue;
    }

    try {
      schema.details.push(await schemaInspector.getTableDetails(table));
      loaded.add(tableName);
    } catch {
      // Completion should stay quiet if a metadata lookup fails.
    }
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

function getCompletionContext(
  document: vscode.TextDocument,
  position: vscode.Position,
): CompletionContext {
  const textBeforeCursor = document.getText(
    new vscode.Range(new vscode.Position(0, 0), position),
  );
  return getSqlCompletionContext(textBeforeCursor, document.getText());
}

function createColumnItems(
  details: TableDetails[],
  aliasQualifier?: string,
): vscode.CompletionItem[] {
  return details.flatMap((table) =>
    table.columns.map((column) => {
      const item = new vscode.CompletionItem(
        {
          label: column.name,
          detail: column.comment ? ` ${column.comment}` : undefined,
          description: column.type || undefined,
        },
        vscode.CompletionItemKind.Field,
      );
      const source = `${aliasQualifier ?? table.name}.${column.name}`;
      item.detail = [
        source,
        column.type || undefined,
        column.primaryKey ? 'primary key' : undefined,
        column.nullable ? 'nullable' : 'not null',
      ].filter(Boolean).join(' · ');
      item.documentation = new vscode.MarkdownString([
        `**${source}**`,
        '',
        `Type: \`${column.type || 'unknown'}\``,
        column.comment ? `Comment: ${column.comment}` : undefined,
        column.defaultValue !== undefined ? `Default: \`${column.defaultValue}\`` : undefined,
      ].filter(Boolean).join('\n\n'));
      item.insertText = column.name;
      item.sortText = column.ordinal.toString().padStart(4, '0');
      return item;
    }),
  );
}
