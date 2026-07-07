import type { ConnectionConfig } from '../connection/types';

export interface TableInfo {
  connection: ConnectionConfig;
  name: string;
  schema?: string;
  rowCount?: number;
}

export interface ColumnInfo {
  name: string;
  type: string;
  length?: string;
  comment?: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue?: string;
  ordinal: number;
}

export interface TableDetails extends TableInfo {
  columns: ColumnInfo[];
}
