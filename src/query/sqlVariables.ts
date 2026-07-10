export interface SqlVariableReference {
  name: string;
  token: string;
  start: number;
  end: number;
}

export type SqlVariableDialect = 'mysql' | 'postgresql' | 'sqlite';

export interface CompiledSqlVariables {
  sql: string;
  params: unknown[];
}

export function findSqlVariables(sql: string): SqlVariableReference[] {
  const variables: SqlVariableReference[] = [];
  let index = 0;
  let state: 'normal' | 'single' | 'double' | 'backtick' | 'bracket' | 'lineComment' | 'blockComment' | 'dollarQuote' = 'normal';
  let dollarQuoteDelimiter = '';

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];

    switch (state) {
      case 'normal':
        if (char === '-' && next === '-') {
          state = 'lineComment';
          index += 2;
          continue;
        }
        if (char === '/' && next === '*') {
          state = 'blockComment';
          index += 2;
          continue;
        }
        if (char === '\'') {
          state = 'single';
          index += 1;
          continue;
        }
        if (char === '"') {
          state = 'double';
          index += 1;
          continue;
        }
        if (char === '`') {
          state = 'backtick';
          index += 1;
          continue;
        }
        if (char === '[') {
          state = 'bracket';
          index += 1;
          continue;
        }
        if (char === '$') {
          const delimiter = readDollarQuoteDelimiter(sql, index);
          if (delimiter) {
            state = 'dollarQuote';
            dollarQuoteDelimiter = delimiter;
            index += delimiter.length;
            continue;
          }
        }
        if (isVariablePrefix(char) && isVariableStart(next) && !isSkippedVariablePrefix(sql, index)) {
          const variable = readVariable(sql, index);
          variables.push(variable);
          index = variable.end;
          continue;
        }
        break;

      case 'single':
        if (char === '\'' && next === '\'') {
          index += 2;
          continue;
        }
        if (char === '\'') {
          state = 'normal';
        }
        break;

      case 'double':
        if (char === '"' && next === '"') {
          index += 2;
          continue;
        }
        if (char === '"') {
          state = 'normal';
        }
        break;

      case 'backtick':
        if (char === '`') {
          state = 'normal';
        }
        break;

      case 'bracket':
        if (char === ']') {
          state = 'normal';
        }
        break;

      case 'lineComment':
        if (char === '\n' || char === '\r') {
          state = 'normal';
        }
        break;

      case 'blockComment':
        if (char === '*' && next === '/') {
          state = 'normal';
          index += 2;
          continue;
        }
        break;

      case 'dollarQuote':
        if (sql.startsWith(dollarQuoteDelimiter, index)) {
          state = 'normal';
          index += dollarQuoteDelimiter.length;
          continue;
        }
        break;
    }

    index += 1;
  }

  return variables;
}

export function getSqlVariableNames(sql: string): string[] {
  return Array.from(new Set(findSqlVariables(sql).map((variable) => variable.name)));
}

export function compileSqlVariables(
  sql: string,
  values: Record<string, unknown>,
  dialect: SqlVariableDialect,
): CompiledSqlVariables {
  const variables = findSqlVariables(sql);
  let result = '';
  let offset = 0;
  const params: unknown[] = [];

  for (const variable of variables) {
    result += sql.slice(offset, variable.start);
    params.push(values[variable.name] ?? null);
    result += toDriverPlaceholder(dialect, params.length);
    offset = variable.end;
  }

  result += sql.slice(offset);
  return { sql: result, params };
}

function readVariable(sql: string, start: number): SqlVariableReference {
  let end = start + 2;
  while (end < sql.length && isVariablePart(sql[end])) {
    end += 1;
  }

  return {
    name: sql.slice(start + 1, end),
    token: sql.slice(start, end),
    start,
    end,
  };
}

function isVariablePrefix(char: string): boolean {
  return char === ':' || char === '$';
}

function isVariableStart(char: string | undefined): boolean {
  return !!char && /[A-Za-z_]/.test(char);
}

function isVariablePart(char: string): boolean {
  return /\w/.test(char);
}

function isSkippedVariablePrefix(sql: string, index: number): boolean {
  const char = sql[index];
  const previous = sql[index - 1];
  const next = sql[index + 1];

  if (char === ':' && (previous === ':' || next === ':')) {
    return true;
  }

  if (char === ':' && next === '=') {
    return true;
  }

  if (char === '$' && previous && /[A-Za-z_0-9$]/.test(previous)) {
    return true;
  }

  return false;
}

function toDriverPlaceholder(dialect: SqlVariableDialect, position: number): string {
  return dialect === 'postgresql' ? `$${position}` : '?';
}

function readDollarQuoteDelimiter(sql: string, start: number): string | undefined {
  const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u.exec(sql.slice(start));
  return match?.[0];
}
