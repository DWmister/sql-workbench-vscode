import * as vscode from 'vscode';
import {
  type ConnectionConfig,
  normalizeConnectionGroup,
} from '../connection/types';
import type { ColumnInfo, TableInfo } from '../schema/types';

export const DATABASE_TREE_VIEW_ID = 'sqlWorkbench.connections';

export const DatabaseTreeCommandIds = {
  addConnection: 'sqlWorkbench.connection.add',
  deleteConnection: 'sqlWorkbench.connection.delete',
  editConnection: 'sqlWorkbench.connection.edit',
  openTableDetails: 'sqlWorkbench.schema.openTable',
  openQuery: 'sqlWorkbench.query.open',
  refresh: 'sqlWorkbench.connection.refresh',
  switchActiveConnection: 'sqlWorkbench.connection.switchActive',
} as const;

export type DatabaseConnectionStatus =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'error'
  | 'unknown'
  | string;

export interface DatabaseConnection extends ConnectionConfig {
  status?: DatabaseConnectionStatus | null;
}

export type DatabaseTreeItem =
  | DatabaseGroupTreeItem
  | DatabaseConnectionTreeItem
  | DatabaseCatalogTreeItem
  | DatabaseTablesTreeItem
  | DatabaseTableTreeItem
  | DatabaseColumnTreeItem
  | DatabaseEmptyTreeItem;

export function normalizeConnectionStatus(
  status?: DatabaseConnectionStatus | null,
): string {
  return (status?.trim?.() || 'disconnected').toLowerCase();
}

export class DatabaseGroupTreeItem extends vscode.TreeItem {
  public readonly contextValue = 'group';

  constructor(
    public readonly groupName: string,
    public readonly connectionCount: number,
  ) {
    super(groupName, vscode.TreeItemCollapsibleState.Expanded);

    this.id = `sqlWorkbench.group.${groupName}`;
    this.description = `${connectionCount}`;
    this.tooltip = `${groupName} (${connectionCount})`;
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}

export class DatabaseConnectionTreeItem extends vscode.TreeItem {
  public readonly contextValue = 'connection';

  constructor(public readonly connection: DatabaseConnection) {
    super(connection.name, vscode.TreeItemCollapsibleState.Collapsed);

    const status = normalizeConnectionStatus(connection.status);
    const group = normalizeConnectionGroup(connection.group);

    this.id = `sqlWorkbench.connection.${connection.id}`;
    this.description = status;
    this.tooltip = buildConnectionTooltip(connection, group, status);
    this.iconPath = getConnectionIcon(status);
    this.command = {
      command: DatabaseTreeCommandIds.switchActiveConnection,
      title: 'Switch Active Connection',
      arguments: [connection],
    };
  }
}

export class DatabaseCatalogTreeItem extends vscode.TreeItem {
  public readonly contextValue = 'database';

  constructor(public readonly connection: DatabaseConnection) {
    super(connection.database ?? 'Database', vscode.TreeItemCollapsibleState.Collapsed);

    this.id = `sqlWorkbench.connection.${connection.id}.database.${connection.database ?? ''}`;
    this.iconPath = new vscode.ThemeIcon('database');
    this.tooltip = `${connection.name}\nDatabase: ${connection.database ?? '-'}`;
  }
}

export class DatabaseTablesTreeItem extends vscode.TreeItem {
  public readonly contextValue = 'tables';

  constructor(public readonly connection: DatabaseConnection) {
    super('Tables', vscode.TreeItemCollapsibleState.Collapsed);

    this.id = `sqlWorkbench.connection.${connection.id}.${connection.database ?? ''}.tables`;
    this.iconPath = new vscode.ThemeIcon('list-tree');
    this.tooltip = `Tables in ${connection.name}`;
  }
}

export class DatabaseTableTreeItem extends vscode.TreeItem {
  public readonly contextValue = 'table';

  constructor(public readonly table: TableInfo) {
    super(table.name, vscode.TreeItemCollapsibleState.Collapsed);

    const suffix = table.schema ? `${table.schema}.${table.name}` : table.name;

    this.id = `sqlWorkbench.connection.${table.connection.id}.${table.connection.database ?? ''}.table.${suffix}`;
    this.iconPath = new vscode.ThemeIcon('table');
    this.tooltip = `${suffix}\nClick to inspect columns.`;
    this.command = {
      command: DatabaseTreeCommandIds.openTableDetails,
      title: 'Open Table Columns',
      arguments: [this],
    };
  }
}

export class DatabaseColumnTreeItem extends vscode.TreeItem {
  public readonly contextValue = 'column';

  constructor(
    public readonly table: TableInfo,
    public readonly column: ColumnInfo,
  ) {
    super(column.name, vscode.TreeItemCollapsibleState.None);

    this.id = [
      'sqlWorkbench',
      table.connection.id,
      table.connection.database ?? '',
      table.schema ?? '',
      table.name,
      column.ordinal,
      column.name,
    ].join('.');
    this.description = buildColumnDescription(column);
    this.tooltip = buildColumnTooltip(column);
    this.iconPath = column.primaryKey
      ? new vscode.ThemeIcon('key')
      : new vscode.ThemeIcon('symbol-field');
  }
}

export class DatabaseEmptyTreeItem extends vscode.TreeItem {
  public readonly contextValue = 'empty';

  constructor(label = 'No connections yet', description = 'Add one to get started') {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = new vscode.ThemeIcon('info');
    if (label === 'No connections yet') {
      this.command = {
        command: DatabaseTreeCommandIds.addConnection,
        title: 'Add Connection',
      };
    }
  }
}

function getConnectionIcon(status: string): vscode.ThemeIcon {
  if (status === 'connected') {
    return new vscode.ThemeIcon(
      'database',
      new vscode.ThemeColor('testing.iconPassed'),
    );
  }

  if (status === 'connecting') {
    return new vscode.ThemeIcon(
      'database',
      new vscode.ThemeColor('charts.yellow'),
    );
  }

  if (status === 'error') {
    return new vscode.ThemeIcon('server', new vscode.ThemeColor('errorForeground'));
  }

  return new vscode.ThemeIcon('server');
}

function buildConnectionTooltip(
  connection: DatabaseConnection,
  group: string,
  status: string,
): string {
  const detailLines = [
    connection.name,
    `Group: ${group}`,
    `Status: ${status}`,
  ];

  if (connection.type) {
    detailLines.push(`Type: ${connection.type}`);
  }

  if (connection.host) {
    const endpoint = connection.port
      ? `${connection.host}:${connection.port}`
      : connection.host;
    detailLines.push(`Host: ${endpoint}`);
  }

  if (connection.database) {
    detailLines.push(`Database: ${connection.database}`);
  }

  return detailLines.join('\n');
}

function buildColumnDescription(column: ColumnInfo): string {
  const flags = [
    column.type,
    column.primaryKey ? 'PK' : undefined,
    column.nullable ? undefined : 'not null',
  ].filter(Boolean);

  return flags.join(' ');
}

function buildColumnTooltip(column: ColumnInfo): string {
  const lines = [
    column.name,
    `Type: ${column.type || '-'}`,
    `Nullable: ${column.nullable ? 'YES' : 'NO'}`,
    `Primary key: ${column.primaryKey ? 'YES' : 'NO'}`,
  ];

  if (column.defaultValue !== undefined) {
    lines.push(`Default: ${column.defaultValue}`);
  }

  return lines.join('\n');
}
