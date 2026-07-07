import type { TableDetails } from '../schema/types';

export interface CompletionContext {
  aliasQualifier?: string;
  tableRefs: TableReference[];
}

export interface TableReference {
  tableName: string;
  alias: string;
}

export function getSqlCompletionContext(
  textBeforeCursor: string,
  fullText = textBeforeCursor,
): CompletionContext {
  const currentStatement = getCurrentStatementAtCursor(
    fullText,
    textBeforeCursor.length,
  );

  return {
    aliasQualifier: getAliasQualifier(textBeforeCursor),
    tableRefs: parseTableReferences(currentStatement),
  };
}

export function getScopedTableDetails(
  details: TableDetails[],
  context: CompletionContext,
): TableDetails[] {
  if (context.tableRefs.length === 0) {
    return details;
  }

  if (context.aliasQualifier) {
    const ref = context.tableRefs.find((tableRef) =>
      tableRef.alias === context.aliasQualifier
      || tableRef.tableName === context.aliasQualifier,
    );

    if (!ref) {
      return [];
    }

    return details.filter((table) => normalizeIdentifier(table.name) === ref.tableName);
  }

  if (context.tableRefs.length === 1) {
    const [ref] = context.tableRefs;
    return details.filter((table) => normalizeIdentifier(table.name) === ref.tableName);
  }

  return [];
}

export function normalizeIdentifier(identifier: string): string {
  return identifier
    .trim()
    .replace(/^[`"\[]+|[`"\]]+$/g, '')
    .toLowerCase();
}

function getCurrentStatementAtCursor(text: string, cursorOffset: number): string {
  const beforeCursor = text.slice(0, cursorOffset);
  const afterCursor = text.slice(cursorOffset);
  const statementStart = beforeCursor.lastIndexOf(';') + 1;
  const nextSemicolon = afterCursor.indexOf(';');
  const statementEnd = nextSemicolon === -1
    ? text.length
    : cursorOffset + nextSemicolon;

  return text.slice(statementStart, statementEnd);
}

function getAliasQualifier(textBeforeCursor: string): string | undefined {
  const match = /([A-Za-z_][\w$]*)\.\s*[A-Za-z_]*$/.exec(textBeforeCursor);
  return match?.[1].toLowerCase();
}

function parseTableReferences(sql: string): TableReference[] {
  const refs: TableReference[] = [];
  const pattern = /\b(?:from|join)\s+([`"\[\]\w.]+)(?:\s+(?:as\s+)?([A-Za-z_][\w$]*))?/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(sql)) !== null) {
    const tableName = normalizeIdentifier(match[1].split('.').pop() ?? match[1]);
    const parsedAlias = normalizeIdentifier(match[2] ?? tableName);
    const alias = isClauseKeyword(parsedAlias) ? tableName : parsedAlias;

    if (!tableName) {
      continue;
    }

    refs.push({ tableName, alias });
  }

  return refs;
}

function isClauseKeyword(value: string): boolean {
  return [
    'where',
    'join',
    'left',
    'right',
    'inner',
    'full',
    'cross',
    'group',
    'order',
    'limit',
    'on',
  ].includes(value);
}
