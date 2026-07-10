export interface SqlStatementRange {
  start: number;
  end: number;
}

export function splitSqlStatements(sql: string): string[] {
  return scanStatementRanges(sql)
    .map((range) => sql.slice(range.start, range.end).trim())
    .filter(Boolean);
}

export function getSqlStatementRanges(sql: string): SqlStatementRange[] {
  return scanStatementRanges(sql);
}

export function findStatementAtOffset(
  sql: string,
  offset: number,
): SqlStatementRange | undefined {
  const ranges = scanStatementRanges(sql);

  for (const range of ranges) {
    if (offset >= range.start && offset <= range.end) {
      return range;
    }
  }

  return ranges.find((range) => range.start >= offset)
    ?? ranges.at(-1);
}

function scanStatementRanges(sql: string): SqlStatementRange[] {
  const ranges: SqlStatementRange[] = [];
  let start = 0;
  let index = 0;
  let state: 'normal' | 'single' | 'double' | 'backtick' | 'bracket' | 'lineComment' | 'blockComment' = 'normal';

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
        if (char === ';') {
          pushTrimmedRange(sql, ranges, start, index);
          start = index + 1;
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

  pushTrimmedRange(sql, ranges, start, sql.length);
  return ranges;
}

function pushTrimmedRange(
  sql: string,
  ranges: SqlStatementRange[],
  rawStart: number,
  rawEnd: number,
): void {
  let start = rawStart;
  let end = rawEnd;

  while (start < end && /\s/.test(sql[start])) {
    start += 1;
  }

  while (end > start && /\s/.test(sql[end - 1])) {
    end -= 1;
  }

  if (start < end && containsSqlToken(sql.slice(start, end))) {
    ranges.push({ start, end });
  }
}

function containsSqlToken(sql: string): boolean {
  let index = 0;
  let state: 'normal' | 'lineComment' | 'blockComment' = 'normal';

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];

    switch (state) {
      case 'normal':
        if (/\s|;/.test(char)) {
          index += 1;
          continue;
        }
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
        return true;

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

  return false;
}
