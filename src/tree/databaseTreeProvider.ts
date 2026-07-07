import * as vscode from 'vscode';
import {
  DatabaseConnection,
  DatabaseConnectionTreeItem,
  DatabaseEmptyTreeItem,
  DatabaseGroupTreeItem,
  DatabaseTreeItem,
} from './treeItems';
import { normalizeConnectionGroup } from '../connection/types';

export interface ConnectionStoreLike {
  list(): DatabaseConnection[] | Promise<DatabaseConnection[]>;
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

  constructor(private readonly connectionStore: ConnectionStoreLike) {}

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
      return [];
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

  private compareNames(left: string, right: string): number {
    return this.collator.compare(left, right);
  }
}
