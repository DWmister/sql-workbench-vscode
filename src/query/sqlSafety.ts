import { splitSqlStatements } from './sqlParser';

export interface DangerousSqlStatement {
  sql: string;
  reason: string;
}

export function findDangerousSqlStatements(sql: string): DangerousSqlStatement[] {
  return splitSqlStatements(sql)
    .map((statement) => ({
      sql: statement,
      tokens: getSqlTokens(statement),
    }))
    .filter(({ tokens }) => isUnsafeUpdateOrDelete(tokens))
    .map(({ sql: statement }) => ({
      sql: statement,
      reason: 'UPDATE or DELETE without WHERE',
    }));
}

function isUnsafeUpdateOrDelete(tokens: string[]): boolean {
  const first = tokens[0]?.toLowerCase();
  if (first !== 'update' && first !== 'delete') {
    return false;
  }

  return !tokens.some((token) => token.toLowerCase() === 'where');
}

function getSqlTokens(sql: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let index = 0;
  let state: 'normal' | 'single' | 'double' | 'backtick' | 'bracket' | 'lineComment' | 'blockComment' = 'normal';

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];

    switch (state) {
      case 'normal':
        if (char === '-' && next === '-') {
          pushToken(tokens, current);
          current = '';
          state = 'lineComment';
          index += 2;
          continue;
        }
        if (char === '/' && next === '*') {
          pushToken(tokens, current);
          current = '';
          state = 'blockComment';
          index += 2;
          continue;
        }
        if (char === '\'') {
          pushToken(tokens, current);
          current = '';
          state = 'single';
          index += 1;
          continue;
        }
        if (char === '"') {
          pushToken(tokens, current);
          current = '';
          state = 'double';
          index += 1;
          continue;
        }
        if (char === '`') {
          pushToken(tokens, current);
          current = '';
          state = 'backtick';
          index += 1;
          continue;
        }
        if (char === '[') {
          pushToken(tokens, current);
          current = '';
          state = 'bracket';
          index += 1;
          continue;
        }
        if (/[A-Za-z_]/.test(char)) {
          current += char;
        } else {
          pushToken(tokens, current);
          current = '';
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
    }

    index += 1;
  }

  pushToken(tokens, current);
  return tokens;
}

function pushToken(tokens: string[], token: string): void {
  if (token) {
    tokens.push(token);
  }
}
