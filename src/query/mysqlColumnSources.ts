export interface MysqlResultFieldIdentity {
  name: string;
  schema?: string;
  db?: string;
  table?: string;
  orgTable?: string;
  orgName?: string;
}

export interface MysqlColumnSource {
  schema: string;
  table: string;
  column: string;
}

interface MysqlTableReference {
  schema: string;
  table: string;
  alias: string;
}

const IDENTIFIER = '(?:`(?:``|[^`])+`|"(?:""|[^"])+"|\\[(?:\\]\\]|[^\\]])+\\]|[A-Za-z_][\\w$]*)';
const QUALIFIED_COLUMN_PATTERN = new RegExp(
  `^(${IDENTIFIER})\\s*\\.\\s*(${IDENTIFIER})(?:\\s+(?:AS\\s+)?${IDENTIFIER})?$`,
  'i',
);
const UNQUALIFIED_COLUMN_PATTERN = new RegExp(
  `^(${IDENTIFIER})(?:\\s+(?:AS\\s+)?${IDENTIFIER})?$`,
  'i',
);
const QUALIFIED_STAR_PATTERN = new RegExp(`^(${IDENTIFIER})\\s*\\.\\s*\\*$`, 'i');
const SELECT_MODIFIER_PATTERN = /^(?:distinct(?:row)?|all)\s+/i;

export function resolveMysqlColumnSources(
  sql: string,
  fields: MysqlResultFieldIdentity[],
  defaultSchema: string,
): Array<MysqlColumnSource | undefined> {
  const tableReferences = parseMysqlTableReferences(sql, defaultSchema);
  const projectionSources = resolveProjectionSources(sql, fields, tableReferences);

  return fields.map((field, index) =>
    getDriverColumnSource(field, defaultSchema) ?? projectionSources[index],
  );
}

function getDriverColumnSource(
  field: MysqlResultFieldIdentity,
  defaultSchema: string,
): MysqlColumnSource | undefined {
  const schema = field.schema || field.db || defaultSchema;
  if (!schema || !field.orgTable || !field.orgName) {
    return undefined;
  }

  return {
    schema,
    table: field.orgTable,
    column: field.orgName,
  };
}

function resolveProjectionSources(
  sql: string,
  fields: MysqlResultFieldIdentity[],
  tableReferences: MysqlTableReference[],
): Array<MysqlColumnSource | undefined> {
  const projections = parseSelectProjections(sql);
  if (projections.length === 0 || tableReferences.length === 0) {
    return [];
  }

  if (projections.length === 1) {
    const projection = stripSelectModifier(projections[0]);
    const qualifiedStar = QUALIFIED_STAR_PATTERN.exec(projection);
    if (projection === '*' || qualifiedStar) {
      const table = qualifiedStar
        ? findTableReference(tableReferences, qualifiedStar[1])
        : tableReferences.length === 1 ? tableReferences[0] : undefined;
      return table
        ? fields.map((field) => toColumnSource(table, unquoteIdentifier(field.name)))
        : [];
    }
  }

  if (projections.length !== fields.length) {
    return [];
  }

  return projections.map((projection) =>
    resolveProjectionSource(projection, tableReferences),
  );
}

function resolveProjectionSource(
  projection: string,
  tableReferences: MysqlTableReference[],
): MysqlColumnSource | undefined {
  const normalized = stripSelectModifier(stripSqlComments(projection));
  const qualified = QUALIFIED_COLUMN_PATTERN.exec(normalized);
  if (qualified) {
    const table = findTableReference(tableReferences, qualified[1]);
    return table ? toColumnSource(table, unquoteIdentifier(qualified[2])) : undefined;
  }

  const unqualified = UNQUALIFIED_COLUMN_PATTERN.exec(normalized);
  if (unqualified && tableReferences.length === 1) {
    return toColumnSource(tableReferences[0], unquoteIdentifier(unqualified[1]));
  }

  return undefined;
}

function stripSelectModifier(projection: string): string {
  return projection.trim().replace(SELECT_MODIFIER_PATTERN, '').trim();
}

function parseMysqlTableReferences(sql: string, defaultSchema: string): MysqlTableReference[] {
  const references: MysqlTableReference[] = [];
  const pattern = new RegExp(
    `\\b(?:from|join)\\s+(${IDENTIFIER}(?:\\s*\\.\\s*${IDENTIFIER})?)(?:\\s+(?:as\\s+)?(${IDENTIFIER}))?`,
    'gi',
  );
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(stripSqlComments(sql))) !== null) {
    const qualifiedName = splitQualifiedIdentifier(match[1]);
    const table = qualifiedName.at(-1) ?? '';
    const schema = qualifiedName.length > 1
      ? qualifiedName.at(-2) ?? defaultSchema
      : defaultSchema;
    const parsedAlias = match[2] ? unquoteIdentifier(match[2]) : table;
    const alias = isClauseKeyword(parsedAlias) ? table : parsedAlias;

    if (schema && table) {
      references.push({ schema, table, alias });
    }
  }

  return references;
}

function parseSelectProjections(sql: string): string[] {
  const selectStart = findTopLevelKeyword(sql, 'select', 0);
  if (selectStart < 0) {
    return [];
  }

  const projectionStart = selectStart + 'select'.length;
  const fromStart = findTopLevelKeyword(sql, 'from', projectionStart);
  if (fromStart < 0) {
    return [];
  }

  return splitTopLevel(sql.slice(projectionStart, fromStart));
}

function findTopLevelKeyword(sql: string, keyword: string, start: number): number {
  let depth = 0;
  let quote: string | undefined;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = start; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];

    if (inLineComment) {
      if (character === '\n' || character === '\r') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (character === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (character === quote) {
        if (next === quote) {
          index += 1;
        } else {
          quote = undefined;
        }
      } else if (character === '\\' && next) {
        index += 1;
      }
      continue;
    }

    if ((character === '-' && next === '-') || character === '#') {
      inLineComment = true;
      index += character === '-' ? 1 : 0;
      continue;
    }
    if (character === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (character === '\'' || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '(') {
      depth += 1;
      continue;
    }
    if (character === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth === 0 && sql.slice(index, index + keyword.length).toLowerCase() === keyword) {
      const before = sql[index - 1];
      const after = sql[index + keyword.length];
      if (!isIdentifierCharacter(before) && !isIdentifierCharacter(after)) {
        return index;
      }
    }
  }

  return -1;
}

function splitTopLevel(sql: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | undefined;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];

    if (inLineComment) {
      if (character === '\n' || character === '\r') {
        inLineComment = false;
      }
      continue;
    }
    if (inBlockComment) {
      if (character === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === quote) {
        if (next === quote) {
          index += 1;
        } else {
          quote = undefined;
        }
      } else if (character === '\\' && next) {
        index += 1;
      }
      continue;
    }

    if ((character === '-' && next === '-') || character === '#') {
      inLineComment = true;
      index += character === '-' ? 1 : 0;
      continue;
    }
    if (character === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (character === '\'' || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '(') {
      depth += 1;
      continue;
    }
    if (character === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (character === ',' && depth === 0) {
      parts.push(sql.slice(start, index).trim());
      start = index + 1;
    }
  }

  parts.push(sql.slice(start).trim());
  return parts.filter(Boolean);
}

function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\r\n]*/g, ' ')
    .replace(/#[^\r\n]*/g, ' ');
}

function findTableReference(
  references: MysqlTableReference[],
  qualifier: string,
): MysqlTableReference | undefined {
  const normalized = normalizeIdentifier(qualifier);
  return references.find((reference) =>
    normalizeIdentifier(reference.alias) === normalized
    || normalizeIdentifier(reference.table) === normalized,
  );
}

function toColumnSource(table: MysqlTableReference, column: string): MysqlColumnSource {
  return {
    schema: table.schema,
    table: table.table,
    column,
  };
}

function splitQualifiedIdentifier(value: string): string[] {
  return value.split('.').map((part) => unquoteIdentifier(part));
}

function unquoteIdentifier(value: string): string {
  const normalized = value.trim();
  if (normalized.startsWith('`') && normalized.endsWith('`')) {
    return normalized.slice(1, -1).replace(/``/g, '`');
  }
  if (normalized.startsWith('"') && normalized.endsWith('"')) {
    return normalized.slice(1, -1).replace(/""/g, '"');
  }
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    return normalized.slice(1, -1).replace(/]]/g, ']');
  }
  return normalized;
}

function normalizeIdentifier(value: string): string {
  return unquoteIdentifier(value).toLowerCase();
}

function isIdentifierCharacter(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9_$]/.test(value);
}

function isClauseKeyword(value: string): boolean {
  return [
    'where',
    'join',
    'left',
    'right',
    'inner',
    'outer',
    'full',
    'cross',
    'group',
    'order',
    'limit',
    'having',
    'on',
  ].includes(normalizeIdentifier(value));
}
