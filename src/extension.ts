import * as vscode from 'vscode';
import { registerSqlHoverProvider } from './completion/sqlHoverProvider';
import { registerSqlCompletionProvider } from './completion/sqlCompletionProvider';
import { ActiveConnectionState, isSqlDocument, type ConnectionResolver } from './connection/activeConnectionState';
import { ConnectionFormPanel } from './connection/connectionFormPanel';
import { ConnectionStore } from './connection/connectionStore';
import { testConnection } from './connection/connectionTester';
import { WorkspaceConnectionStore } from './connection/workspaceConnectionStore';
import {
  type ConnectionConfig,
  isConnectionType,
} from './connection/types';
import { registerQueryCommands } from './query/commands';
import { createQueryRunner } from './query/runner';
import { registerSqlCodeLensProvider } from './query/sqlCodeLensProvider';
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

export function activate(context: vscode.ExtensionContext): void {
  const connectionStore = new ConnectionStore(
    context.globalState,
    context.secrets,
  );
  const workspaceConnectionStore = new WorkspaceConnectionStore();
  const connectionRegistry = new ConnectionRegistry(connectionStore, workspaceConnectionStore);
  const activeConnection = new ActiveConnectionState(context, connectionRegistry);
  const getPassword = async (connectionId: string) => {
    const password = await connectionStore.getPassword(connectionId);
    if (password !== undefined || !isWorkspaceConnectionId(connectionId)) {
      return password;
    }

    const connection = await connectionRegistry.get(connectionId);
    if (!connection || connection.type === 'sqlite') {
      return undefined;
    }

    const entered = await vscode.window.showInputBox({
      title: 'Workspace Connection Password',
      prompt: `Password for ${connection.name}`,
      password: true,
      ignoreFocusOut: true,
    });

    if (entered === undefined) {
      return undefined;
    }

    await connectionStore.savePassword(connectionId, entered);
    return entered;
  };
  const schemaInspector = createSchemaInspector({ getPassword });
  const tableDetailsPanel = new TableDetailsPanel(context.extensionUri, {
    loadDdl: (table) => schemaInspector.getTableDdl(table),
  });
  const treeProvider = new DatabaseTreeProvider({
    connectionStore: {
      async list() {
        const connections = await connectionStore.list();
        const workspaceConnections = await workspaceConnectionStore.list();
        const activeId = activeConnection.getId(getActiveSqlDocument());
        return [...connections, ...workspaceConnections].map((connection) => ({
          ...connection,
          status: connection.id === activeId ? 'connected' : 'disconnected',
        }));
      },
    },
    schemaInspector,
  });
  const statusBar = new ActiveConnectionStatusBar(activeConnection);
  const connectionFormPanel = new ConnectionFormPanel(context.extensionUri, {
    test: async (input, editingId) => {
      const password = input.password
        ?? (editingId ? await connectionStore.getPassword(editingId) : undefined);
      return testConnection({ ...input, password });
    },
    save: async (input, editingId) => {
      const { password, ...config } = input;
      if (editingId) {
        const updated = await connectionStore.update(editingId, config);
        if (password !== undefined) {
          await connectionStore.savePassword(editingId, password);
        }
        return updated;
      }
      return connectionStore.create(config, password || undefined);
    },
    onSaved: async (connection) => {
      await activeConnection.set(connection.id, getActiveSqlDocument());
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
    tableDetailsPanel,
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

      if (isWorkspaceConnection(target)) {
        vscode.window.showInformationMessage('Workspace connections are read-only. Edit .vscode/sql-workbench.json to change this connection.');
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
        await activeConnection.set(undefined, getActiveSqlDocument());
      }
      await activeConnection.deleteConnectionBindings(target.id);
      treeProvider.refresh();
      await statusBar.refresh();
    }),
    registerCommand(DatabaseTreeCommandIds.editConnection, async (argument?: unknown) => {
      const target = await resolveConnectionArgument(argument, activeConnection);
      if (!target) {
        return;
      }

      if (isWorkspaceConnection(target)) {
        vscode.window.showInformationMessage('Workspace connections are read-only. Edit .vscode/sql-workbench.json to change this connection.');
        return;
      }

      connectionFormPanel.show(target);
    }),
    registerCommand(DatabaseTreeCommandIds.switchActiveConnection, async (argument?: unknown) => {
      const connection = extractConnectionArgument(argument);
      if (connection) {
        await activeConnection.set(connection.id, getActiveSqlDocument());
        treeProvider.refresh();
        await statusBar.refresh();
        return;
      }

      const selected = await pickConnection(activeConnection);
      if (!selected) {
        return;
      }

      await activeConnection.set(selected.id, getActiveSqlDocument());
      treeProvider.refresh();
      await statusBar.refresh();
    }),
    registerCommand(DatabaseTreeCommandIds.openQuery, async (argument?: unknown) => {
      const target = extractConnectionArgument(argument) ?? await pickConnection(activeConnection);
      if (!target) {
        return;
      }

      const document = await openQueryDocument(target);
      await activeConnection.set(target.id, document);
      treeProvider.refresh();
      await statusBar.refresh();
    }),
    registerCommand(DatabaseTreeCommandIds.openTableDetails, async (argument?: unknown) => {
      const table = extractTableArgument(argument);
      if (!table) {
        vscode.window.showWarningMessage('Choose a table to inspect.');
        return;
      }

      await activeConnection.set(table.connection.id, getActiveSqlDocument());
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
      resolveConnection: async (document) => {
        if (document) {
          const restored = await activeConnection.restoreDocumentBinding(document);
          if (restored) {
            treeProvider.refresh();
            await statusBar.refresh();
            return restored;
          }
        }

        const current = await activeConnection.get(document);
        if (current) {
          return current;
        }

        const selected = await pickConnection(activeConnection);
        if (!selected) {
          return undefined;
        }

        await activeConnection.set(selected.id, document ?? getActiveSqlDocument());
        treeProvider.refresh();
        await statusBar.refresh();
        return selected;
      },
    }),
    registerSqlCompletionProvider({
      schemaInspector,
      resolveConnection: (document) => activeConnection.get(document),
    }),
    registerSqlHoverProvider({
      schemaInspector,
      resolveConnection: (document) => activeConnection.get(document),
    }),
    registerSqlCodeLensProvider(),
    vscode.window.onDidChangeActiveTextEditor(async () => {
      await statusBar.refresh();
      treeProvider.refresh();
    }),
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      const id = activeConnection.getDocumentBindingId(document);
      if (id) {
        await activeConnection.set(id, document);
      }
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

class ConnectionRegistry implements ConnectionResolver {
  constructor(
    private readonly connectionStore: ConnectionStore,
    private readonly workspaceConnectionStore: WorkspaceConnectionStore,
  ) {}

  public async get(id: string): Promise<ConnectionConfig | undefined> {
    return (await this.connectionStore.get(id))
      ?? (await this.workspaceConnectionStore.list()).find((connection) => connection.id === id);
  }

  public async list(): Promise<ConnectionConfig[]> {
    return [
      ...await this.connectionStore.list(),
      ...await this.workspaceConnectionStore.list(),
    ];
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
    const document = getActiveSqlDocument();
    const connection = await this.activeConnection.get(document);
    if (!connection) {
      this.item.text = '$(database) DB: none';
      this.item.tooltip = 'Choose Active Connection';
      return;
    }

    const database = connection.database ?? connection.path ?? connection.type;
    this.item.text = `$(database) ${connection.name}`;
    this.item.tooltip = document
      ? `Connection for active SQL file or default: ${connection.name} / ${database}`
      : `Default connection: ${connection.name} / ${database}`;
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

  const activeId = activeConnection.getId(getActiveSqlDocument());
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

function isWorkspaceConnection(connection: ConnectionConfig): boolean {
  return isWorkspaceConnectionId(connection.id);
}

function isWorkspaceConnectionId(id: string): boolean {
  return id.startsWith('workspace-');
}

function getActiveSqlDocument(): vscode.TextDocument | undefined {
  const document = vscode.window.activeTextEditor?.document;
  return document && isSqlDocument(document) ? document : undefined;
}

async function openQueryDocument(connection: ConnectionConfig): Promise<vscode.TextDocument> {
  const database = connection.database ?? connection.path ?? connection.type;
  const document = await vscode.workspace.openTextDocument({
    language: 'sql',
    content: [
      `-- SQL Workbench: ${connection.name} / ${database}`,
      '-- Result grids and table properties are read-only.',
      '-- Use SQL for all data and schema changes.',
      '',
      'SELECT *',
      'FROM ',
      'LIMIT 100;',
      '',
    ].join('\n'),
  });

  await vscode.window.showTextDocument(document, { preview: false });
  return document;
}
