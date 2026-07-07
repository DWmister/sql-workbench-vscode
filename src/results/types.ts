export type QueryValue = string | number | boolean | null | Uint8Array;

export type QueryRow = QueryValue[];

export interface QueryColumn {
  name: string;
  type?: string;
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
}
