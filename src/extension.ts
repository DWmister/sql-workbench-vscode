import * as vscode from 'vscode';
import { registerSqlCompletionProvider } from './completion/sqlCompletionProvider';
import { ConnectionFormPanel } from './connection/connectionFormPanel';
import { ConnectionStore } from './connection/connectionStore';
import { testConnection } from './connection/connectionTester';
import {
  type ConnectionConfig,
  isConnectionType,
} from './connection/types';
import { registerQueryCommands } from './query/commands';
import { createQueryRunner } from './query/runner';
import { createSchemaInspector } from './schema/inspector';
import { TableDetailsPanel } from './schema/tableDetailsPanel';
import { DatabaseTreeProvider } from './tree/databaseTreeProvider';
import {
  DATABASE_TREE_VIEW_ID,
  DatabaseTreeCommandIds,
  type DatabaseConnection,
  DatabaseConnectionTreeItem,
  DatabaseTableTreeItem,
} from './tree/treeItems';

const ACTIVE_CONNECTION_KEY = 'sqlWorkbench.activeConnectionId';

export function activate(context: vscode.ExtensionContext): void {
  const connectionStore = new ConnectionStore(
    context.globalState,
    context.secrets,
  );
  const activeConnection = new ActiveConnectionState(context, connectionStore);
  const getPassword = (connectionId: string) => connectionStore.getPassword(connectionId);
  const schemaInspector = createSchemaInspector({ getPassword });
  const tableDetailsPanel = new TableDetailsPanel(context.extensionUri);
  const treeProvider = new DatabaseTreeProvider({
    connectionStore: {
      async list() {
        const connections = await connectionStore.list();
        const activeId = activeConnection.getId();
        return connections.map((connection) => ({
          ...connection,
          status: connection.id === activeId ? 'connected' : 'disconnected',
        }));
      },
    },
    schemaInspector,
  });
  const statusBar = new ActiveConnectionStatusBar(activeConnection);
  const connectionFormPanel = new ConnectionFormPanel(context.extensionUri, {
    test: testConnection,
    save: async (input) => {
      const { password, ...config } = input;
      return connectionStore.create(config, password || undefined);
    },
    onSaved: async (connection) => {
      await activeConnection.set(connection.id);
      treeProvider.refresh();
      await statusBar.refresh();
    },
  });

  context.subscriptions.push(
    vscode.window.createTreeView(DATABASE_TREE_VIEW_ID, {
      treeDataProvider: treeProvider,
      showCollapseAll: true,
    }),
    statusBar,
    connectionFormPanel,
    registerCommand(DatabaseTreeCommandIds.addConnection, () => {
      connectionFormPanel.show();
    }),
    registerCommand(DatabaseTreeCommandIds.refresh, async () => {
      treeProvider.refresh();
      await statusBar.refresh();
    }),
    registerCommand(DatabaseTreeCommandIds.deleteConnection, async (argument?: unknown) => {
      const target = await resolveConnectionArgument(argument, activeConnection);
      if (!target) {
        return;
      }

      const confirmed = await vscode.window.showWarningMessage(
        `Delete connection "${target.name}"? Password secrets will be removed too.`,
        { modal: true },
        'Delete',
      );

      if (confirmed !== 'Delete') {
        return;
      }

      await connectionStore.delete(target.id);
      if (activeConnection.getId() === target.id) {
        await activeConnection.set(undefined);
      }
      treeProvider.refresh();
      await statusBar.refresh();
    }),
    registerCommand(DatabaseTreeCommandIds.editConnection, async (argument?: unknown) => {
      const target = await resolveConnectionArgument(argument, activeConnection);
      if (!target) {
        return;
      }

      const nextName = await vscode.window.showInputBox({
        title: 'Edit Connection Name',
        prompt: 'MVP edit flow only supports renaming. Full connection editing comes next.',
        value: target.name,
        ignoreFocusOut: true,
        validateInput: (value) => value.trim() ? undefined : 'Connection name is required.',
      });

      if (!nextName) {
        return;
      }

      await connectionStore.update(target.id, { name: nextName });
      treeProvider.refresh();
      await statusBar.refresh();
    }),
    registerCommand(DatabaseTreeCommandIds.switchActiveConnection, async (argument?: unknown) => {
      const connection = extractConnectionArgument(argument);
      if (connection) {
        await activeConnection.set(connection.id);
        treeProvider.refresh();
        await statusBar.refresh();
        return;
      }

      const selected = await pickConnection(activeConnection);
      if (!selected) {
        return;
      }

      await activeConnection.set(selected.id);
      treeProvider.refresh();
      await statusBar.refresh();
    }),
    registerCommand(DatabaseTreeCommandIds.openQuery, async (argument?: unknown) => {
      const target = extractConnectionArgument(argument) ?? await pickConnection(activeConnection);
      if (!target) {
        return;
      }

      await activeConnection.set(target.id);
      treeProvider.refresh();
      await statusBar.refresh();
      await openQueryDocument(target);
    }),
    registerCommand(DatabaseTreeCommandIds.openTableDetails, async (argument?: unknown) => {
      const table = extractTableArgument(argument);
      if (!table) {
        vscode.window.showWarningMessage('Choose a table to inspect.');
        return;
      }

      await activeConnection.set(table.connection.id);
      treeProvider.refresh();
      await statusBar.refresh();

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Loading columns for ${table.name}`,
          cancellable: false,
        },
        async () => {
          const details = await schemaInspector.getTableDetails(table);
          tableDetailsPanel.show(details);
        },
      );
    }),
    ...registerQueryCommands(context, {
      runner: createQueryRunner({ getPassword }),
      resolveConnection: async () => {
        const current = await activeConnection.get();
        if (current) {
          return current;
        }

        const selected = await pickConnection(activeConnection);
        if (!selected) {
          return undefined;
        }

        await activeConnection.set(selected.id);
        treeProvider.refresh();
        await statusBar.refresh();
        return selected;
      },
    }),
    registerSqlCompletionProvider({
      schemaInspector,
      resolveConnection: () => activeConnection.get(),
    }),
  );

  statusBar.refresh();
}

export function deactivate(): void {
  // Nothing to clean up yet.
}

function registerCommand(
  command: string,
  callback: (...args: any[]) => unknown,
): vscode.Disposable {
  return vscode.commands.registerCommand(command, callback);
}

class ActiveConnectionState {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly connectionStore: ConnectionStore,
  ) {}

  public getId(): string | undefined {
    return this.context.globalState.get<string>(ACTIVE_CONNECTION_KEY);
  }

  public async get(): Promise<ConnectionConfig | undefined> {
    const id = this.getId();
    return id ? this.connectionStore.get(id) : undefined;
  }

  public async list(): Promise<ConnectionConfig[]> {
    return this.connectionStore.list();
  }

  public async set(id: string | undefined): Promise<void> {
    await this.context.globalState.update(ACTIVE_CONNECTION_KEY, id);
  }
}

class ActiveConnectionStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    98,
  );

  constructor(private readonly activeConnection: ActiveConnectionState) {
    this.item.command = DatabaseTreeCommandIds.switchActiveConnection;
    this.item.tooltip = 'Choose Active Connection';
    this.item.show();
  }

  public async refresh(): Promise<void> {
    const connection = await this.activeConnection.get();
    if (!connection) {
      this.item.text = '$(database) DB: none';
      this.item.tooltip = 'Choose Active Connection';
      return;
    }

    const database = connection.database ?? connection.path ?? connection.type;
    this.item.text = `$(database) ${connection.name}`;
    this.item.tooltip = `Active connection: ${connection.name} / ${database}`;
  }

  public dispose(): void {
    this.item.dispose();
  }
}

async function pickConnection(
  activeConnection: ActiveConnectionState,
): Promise<ConnectionConfig | undefined> {
  const connections = await activeConnection.list();
  if (connections.length === 0) {
    const add = await vscode.window.showInformationMessage(
      'No connections yet.',
      'Add Connection',
    );
    if (add === 'Add Connection') {
      await vscode.commands.executeCommand(DatabaseTreeCommandIds.addConnection);
    }
    return undefined;
  }

  const activeId = activeConnection.getId();
  const current = connections.find((connection) => connection.id === activeId);
  const others = connections.filter((connection) => connection.id !== activeId);
  const items: Array<vscode.QuickPickItem & { connection?: ConnectionConfig }> = [];

  if (current) {
    items.push({ label: 'Current', kind: vscode.QuickPickItemKind.Separator });
    items.push(toConnectionPick(current));
  }

  if (others.length > 0) {
    items.push({ label: current ? 'Other connections' : 'Connections', kind: vscode.QuickPickItemKind.Separator });
    items.push(...others.map(toConnectionPick));
  }

  const selected = await vscode.window.showQuickPick(items, {
    title: 'Choose Active Connection',
    placeHolder: 'Pick a connection',
    ignoreFocusOut: true,
    matchOnDescription: true,
    matchOnDetail: true,
  });

  return selected?.connection;
}

function toConnectionPick(
  connection: ConnectionConfig,
): vscode.QuickPickItem & { connection: ConnectionConfig } {
  const endpoint = connection.path
    ?? ([connection.host, connection.port].filter(Boolean).join(':') || connection.type);

  return {
    label: connection.name,
    description: connection.group,
    detail: `${connection.type} ${endpoint}${connection.database ? ` / ${connection.database}` : ''}`,
    connection,
  };
}

async function resolveConnectionArgument(
  argument: unknown,
  activeConnection: ActiveConnectionState,
): Promise<ConnectionConfig | undefined> {
  const connection = extractConnectionArgument(argument);
  if (connection) {
    return connection;
  }

  return pickConnection(activeConnection);
}

function extractConnectionArgument(argument: unknown): DatabaseConnection | undefined {
  if (!argument) {
    return undefined;
  }

  if (argument instanceof DatabaseConnectionTreeItem) {
    return argument.connection;
  }

  if (isConnectionLike(argument)) {
    return argument;
  }

  return undefined;
}

function extractTableArgument(argument: unknown) {
  if (!argument) {
    return undefined;
  }

  if (argument instanceof DatabaseTableTreeItem) {
    return argument.table;
  }

  return undefined;
}

function isConnectionLike(value: unknown): value is DatabaseConnection {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<DatabaseConnection>;
  return typeof candidate.id === 'string'
    && typeof candidate.name === 'string'
    && isConnectionType(candidate.type);
}

async function openQueryDocument(connection: ConnectionConfig): Promise<void> {
  const database = connection.database ?? connection.path ?? connection.type;
  const document = await vscode.workspace.openTextDocument({
    language: 'sql',
    content: [
      `-- SQL Workbench: ${connection.name} / ${database}`,
      '-- MVP is SQL-only for writes. Result grids and schema inspectors are read-only.',
      '',
      'SELECT *',
      'FROM ',
      'LIMIT 100;',
      '',
    ].join('\n'),
  });

  await vscode.window.showTextDocument(document, { preview: false });
}
