import * as vscode from 'vscode';
import {
  type ConnectionConfig,
  normalizeConnectionGroup,
} from '../connection/types';

export const DATABASE_TREE_VIEW_ID = 'sqlWorkbench.connections';

export const DatabaseTreeCommandIds = {
  addConnection: 'sqlWorkbench.connection.add',
  deleteConnection: 'sqlWorkbench.connection.delete',
  editConnection: 'sqlWorkbench.connection.edit',
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
    super(connection.name, vscode.TreeItemCollapsibleState.None);

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

export class DatabaseEmptyTreeItem extends vscode.TreeItem {
  public readonly contextValue = 'empty';

  constructor() {
    super('No connections yet', vscode.TreeItemCollapsibleState.None);
    this.description = 'Add one to get started';
    this.iconPath = new vscode.ThemeIcon('info');
    this.command = {
      command: DatabaseTreeCommandIds.addConnection,
      title: 'Add Connection',
    };
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
