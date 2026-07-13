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
  'DISTINCT',
  'FROM',
  'WHERE',
  'JOIN',
  'LEFT JOIN',
  'RIGHT JOIN',
  'INNER JOIN',
  'OUTER JOIN',
  'CROSS JOIN',
  'ON',
  'GROUP BY',
  'HAVING',
  'ORDER BY',
  'ASC',
  'DESC',
  'LIMIT',
  'OFFSET',
  'UNION',
  'UNION ALL',
  'CASE WHEN',
  'THEN',
  'ELSE',
  'END',
  'AND',
  'OR',
  'IN',
  'EXISTS',
  'BETWEEN',
  'LIKE',
  'IS NULL',
  'IS NOT NULL',
  'INSERT INTO',
  'VALUES',
  'UPDATE',
  'SET',
  'DELETE FROM',
  'CREATE TABLE',
  'ALTER TABLE',
  'DROP TABLE',
  'WITH',
  'AS',
  'EXPLAIN',
  'SHOW',
  'DESCRIBE',
];

const SQL_FUNCTIONS = [
  'COALESCE',
  'NULLIF',
  'IFNULL',
  'DATE_FORMAT',
  'DATE_ADD',
  'DATE_SUB',
  'NOW',
  'CURRENT_DATE',
  'CURRENT_TIMESTAMP',
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'CONCAT',
  'LOWER',
  'UPPER',
  'CAST',
  'EXTRACT',
];

const CACHE_TTL_MS = 60_000;

export interface SqlCompletionProviderOptions {
  resolveConnection: (document?: vscode.TextDocument) => Promise<ConnectionConfig | undefined>;
  schemaInspector: SchemaInspector;
  shouldWarm?: (connection: ConnectionConfig) => boolean;
}

export interface RegisteredSqlCompletionProvider extends vscode.Disposable {
  prime(connection: ConnectionConfig, tables: TableInfo[]): void;
  warm(document?: vscode.TextDocument): Promise<void>;
}

interface CachedSchema {
  expiresAt: number;
  tables: TableInfo[];
  details: TableDetails[];
  detailLoads: Map<string, Promise<void>>;
}

export function registerSqlCompletionProvider(
  options: SqlCompletionProviderOptions,
): RegisteredSqlCompletionProvider {
  const cache = new Map<string, CachedSchema>();
  const schemaLoads = new Map<string, Promise<CachedSchema>>();

  const registration = vscode.languages.registerCompletionItemProvider(
    { language: 'sql', scheme: '*' },
    {
      async provideCompletionItems(document, position) {
        const items = createKeywordItems();
        const connection = await options.resolveConnection(document);

        if (!connection) {
          return items;
        }

        const schema = await loadSchema(
          connection,
          options.schemaInspector,
          cache,
          schemaLoads,
        );
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
    '_',
  );

  return {
    dispose() {
      registration.dispose();
    },
    prime(connection, tables) {
      primeSchema(connection, tables, cache);
    },
    async warm(document) {
      const connection = await options.resolveConnection(document);
      if (connection && options.shouldWarm?.(connection) !== false) {
        await loadSchema(connection, options.schemaInspector, cache, schemaLoads);
      }
    },
  };
}

function primeSchema(
  connection: ConnectionConfig,
  tables: TableInfo[],
  cache: Map<string, CachedSchema>,
): void {
  const cacheKey = getConnectionCacheKey(connection);
  const previous = cache.get(cacheKey);
  const tableNames = new Set(tables.map((table) => normalizeIdentifier(table.name)));

  if (previous) {
    previous.expiresAt = Date.now() + CACHE_TTL_MS;
    previous.tables = tables;
    previous.details = previous.details.filter((table) =>
      tableNames.has(normalizeIdentifier(table.name)));
    return;
  }

  cache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    tables,
    details: [],
    detailLoads: new Map(),
  });
}

async function loadSchema(
  connection: ConnectionConfig,
  schemaInspector: SchemaInspector,
  cache: Map<string, CachedSchema>,
  schemaLoads: Map<string, Promise<CachedSchema>>,
): Promise<CachedSchema> {
  const cacheKey = getConnectionCacheKey(connection);
  const cached = cache.get(cacheKey);
  if (cached) {
    if (cached.expiresAt <= Date.now()) {
      void refreshSchema(connection, schemaInspector, cache, schemaLoads, cacheKey);
    }
    return cached;
  }

  return refreshSchema(connection, schemaInspector, cache, schemaLoads, cacheKey);
}

function refreshSchema(
  connection: ConnectionConfig,
  schemaInspector: SchemaInspector,
  cache: Map<string, CachedSchema>,
  schemaLoads: Map<string, Promise<CachedSchema>>,
  cacheKey: string,
): Promise<CachedSchema> {
  const pending = schemaLoads.get(cacheKey);
  if (pending) {
    return pending;
  }

  const load = schemaInspector.listTables(connection)
    .then((tables): CachedSchema => {
      const tableNames = new Set(tables.map((table) => normalizeIdentifier(table.name)));
      const previous = cache.get(cacheKey);
      if (previous) {
        previous.expiresAt = Date.now() + CACHE_TTL_MS;
        previous.tables = tables;
        previous.details = previous.details.filter((table) =>
          tableNames.has(normalizeIdentifier(table.name)));
        return previous;
      }

      const next: CachedSchema = {
        expiresAt: Date.now() + CACHE_TTL_MS,
        tables,
        details: [],
        detailLoads: new Map(),
      };

      cache.set(cacheKey, next);
      return next;
    })
    .catch((): CachedSchema => {
      const previous = cache.get(cacheKey);
      if (previous) {
        previous.expiresAt = Date.now() + CACHE_TTL_MS;
        return previous;
      }

      const empty: CachedSchema = {
        expiresAt: Date.now() + CACHE_TTL_MS,
        tables: [],
        details: [],
        detailLoads: new Map(),
      };
      cache.set(cacheKey, empty);
      return empty;
    })
    .finally(() => {
      schemaLoads.delete(cacheKey);
    });

  schemaLoads.set(cacheKey, load);
  return load;
}

function getConnectionCacheKey(connection: ConnectionConfig): string {
  return [
    connection.id,
    connection.type,
    connection.host ?? '',
    connection.port ?? '',
    connection.database ?? '',
    connection.username ?? '',
    connection.path ?? '',
  ].join('|');
}

async function ensureReferencedTableDetails(
  schema: CachedSchema,
  context: CompletionContext,
  schemaInspector: SchemaInspector,
): Promise<void> {
  const loaded = new Set(schema.details.map((table) => normalizeIdentifier(table.name)));
  const needed = new Set(context.tableRefs.map((tableRef) => tableRef.tableName));
  const loads: Promise<void>[] = [];

  for (const tableName of needed) {
    if (loaded.has(tableName)) {
      continue;
    }

    const table = schema.tables.find((candidate) => normalizeIdentifier(candidate.name) === tableName);
    if (!table) {
      continue;
    }

    const pending = schema.detailLoads.get(tableName);
    if (pending) {
      loads.push(pending);
      continue;
    }

    const load = schemaInspector.getTableDetails(table)
      .then((details) => {
        schema.details.push(details);
        loaded.add(tableName);
      })
      .catch(() => {
        // Completion should stay quiet if a metadata lookup fails.
      })
      .finally(() => {
        schema.detailLoads.delete(tableName);
      });

    schema.detailLoads.set(tableName, load);
    loads.push(load);
  }

  await Promise.all(loads);
}

function createKeywordItems(): vscode.CompletionItem[] {
  const keywords = SQL_KEYWORDS.map((keyword) => {
    const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
    item.detail = 'SQL keyword';
    item.insertText = keyword;
    return item;
  });

  const functions = SQL_FUNCTIONS.map((name) => {
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
    item.detail = 'SQL function';
    item.insertText = name;
    return item;
  });

  return [...keywords, ...functions];
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
