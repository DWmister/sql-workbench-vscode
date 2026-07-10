import * as vscode from 'vscode';
import {
  DatabaseConnection,
  DatabaseConnectionTreeItem,
  DatabaseColumnTreeItem,
  DatabaseEmptyTreeItem,
  DatabaseGroupTreeItem,
  DatabaseTablesTreeItem,
  DatabaseTableTreeItem,
  DatabaseTreeItem,
} from './treeItems';
import { normalizeConnectionGroup } from '../connection/types';
import type { SchemaInspector } from '../schema/inspector';
import type { TableInfo } from '../schema/types';

export interface ConnectionStoreLike {
  list(): DatabaseConnection[] | Promise<DatabaseConnection[]>;
}

export interface DatabaseTreeProviderOptions {
  connectionStore: ConnectionStoreLike;
  schemaInspector: SchemaInspector;
  onTablesLoaded?: (connection: DatabaseConnection, tables: TableInfo[]) => void;
}

export class DatabaseTreeProvider
  implements vscode.TreeDataProvider<DatabaseTreeItem>
{
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    DatabaseTreeItem | undefined | null | void
  >();

  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private readonly collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
  });

  private cachedConnections: DatabaseConnection[] = [];
  private isCacheLoaded = false;
  private readonly connectionStore: ConnectionStoreLike;
  private readonly schemaInspector: SchemaInspector;
  private readonly onTablesLoaded?: DatabaseTreeProviderOptions['onTablesLoaded'];

  constructor(options: DatabaseTreeProviderOptions) {
    this.connectionStore = options.connectionStore;
    this.schemaInspector = options.schemaInspector;
    this.onTablesLoaded = options.onTablesLoaded;
  }

  public refresh(item?: DatabaseTreeItem): void {
    if (!item) {
      this.isCacheLoaded = false;
    }

    this.onDidChangeTreeDataEmitter.fire(item);
  }

  public getTreeItem(element: DatabaseTreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(
    element?: DatabaseTreeItem,
  ): Promise<DatabaseTreeItem[]> {
    if (element instanceof DatabaseConnectionTreeItem) {
      return [new DatabaseTablesTreeItem(element.connection)];
    }

    if (element instanceof DatabaseTablesTreeItem) {
      return this.createTableItems(element.connection);
    }

    if (element instanceof DatabaseTableTreeItem) {
      return this.createColumnItems(element.table);
    }

    const connections = await this.getConnections();

    if (element instanceof DatabaseGroupTreeItem) {
      return this.createConnectionItems(connections, element.groupName);
    }

    if (connections.length === 0) {
      return [new DatabaseEmptyTreeItem()];
    }

    return this.createGroupItems(connections);
  }

  private async getConnections(): Promise<DatabaseConnection[]> {
    if (this.isCacheLoaded) {
      return this.cachedConnections;
    }

    const listedConnections = await this.connectionStore.list();
    this.cachedConnections = [...listedConnections];
    this.isCacheLoaded = true;

    return this.cachedConnections;
  }

  private createGroupItems(
    connections: DatabaseConnection[],
  ): DatabaseGroupTreeItem[] {
    const groupedConnections = new Map<string, DatabaseConnection[]>();

    for (const connection of connections) {
      const group = normalizeConnectionGroup(connection.group);
      const groupConnections = groupedConnections.get(group) ?? [];

      groupConnections.push(connection);
      groupedConnections.set(group, groupConnections);
    }

    return [...groupedConnections.entries()]
      .sort(([leftGroup], [rightGroup]) => this.compareNames(leftGroup, rightGroup))
      .map(
        ([groupName, groupConnections]) =>
          new DatabaseGroupTreeItem(groupName, groupConnections.length),
      );
  }

  private createConnectionItems(
    connections: DatabaseConnection[],
    groupName: string,
  ): DatabaseConnectionTreeItem[] {
    return connections
      .filter(
        (connection) => normalizeConnectionGroup(connection.group) === groupName,
      )
      .sort((left, right) => this.compareNames(left.name, right.name))
      .map((connection) => new DatabaseConnectionTreeItem(connection));
  }

  private async createTableItems(
    connection: DatabaseConnection,
  ): Promise<DatabaseTreeItem[]> {
    try {
      const tables = await this.schemaInspector.listTables(connection);
      this.onTablesLoaded?.(connection, tables);

      if (tables.length === 0) {
        return [new DatabaseEmptyTreeItem('No tables found', '')];
      }

      return tables
        .sort((left, right) => this.compareNames(left.name, right.name))
        .map((table) => new DatabaseTableTreeItem(table));
    } catch (error) {
      return [new DatabaseEmptyTreeItem(getErrorMessage(error))];
    }
  }

  private async createColumnItems(
    table: TableInfo,
  ): Promise<DatabaseTreeItem[]> {
    try {
      const details = await this.schemaInspector.getTableDetails(table);

      if (details.columns.length === 0) {
        return [new DatabaseEmptyTreeItem('No columns found', '')];
      }

      return details.columns.map(
        (column) => new DatabaseColumnTreeItem(table, column),
      );
    } catch (error) {
      return [new DatabaseEmptyTreeItem(getErrorMessage(error))];
    }
  }

  private compareNames(left: string, right: string): number {
    return this.collator.compare(left, right);
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
