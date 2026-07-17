export type QueryValue = string | number | boolean | null | Uint8Array;

export type QueryRow = QueryValue[];

export interface QueryColumn {
  name: string;
  type?: string;
  comment?: string;
}

export interface QueryResultPagination {
  mode: 'server';
  sourceSql: string;
  variableValues?: Record<string, unknown>;
  page: number;
  pageSize: number;
  totalRows: number;
}

export interface QueryResult {
  sql: string;
  columns: QueryColumn[];
  rows: QueryRow[];
  rowCount: number;
  elapsedMs: number;
  readOnly: true;
  affectedRows?: number;
  error?: string;
  connectionId?: string;
  connectionName?: string;
  executedAt: string;
  pagination?: QueryResultPagination;
}
