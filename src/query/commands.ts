import * as vscode from 'vscode';
import type { ConnectionConfig } from '../connection/types';
import { ResultViewPanel } from '../results/resultViewPanel';
import { extractFullDocumentSql, extractSelectedOrCurrentStatement } from './sqlExtractor';
import { createQueryRunner, type QueryExecutionOptions, type QueryRunner } from './runner';

export const QueryCommandIds = {
  runCurrent: 'sqlWorkbench.query.runCurrent',
  runAll: 'sqlWorkbench.query.runAll',
} as const;

export interface QueryCommandRegistrationOptions {
  resolveConnection: () => Promise<ConnectionConfig | undefined>;
  resultViewPanel?: ResultViewPanel;
  runner?: QueryRunner;
}

export function registerQueryCommands(
  context: vscode.ExtensionContext,
  options: QueryCommandRegistrationOptions,
): vscode.Disposable[] {
  const runner = options.runner ?? createQueryRunner();
  let lastConnection: ConnectionConfig | undefined;
  const resultViewPanel = options.resultViewPanel
    ?? new ResultViewPanel(context.extensionUri, {
      loadPage: async (request) => {
        if (!lastConnection || lastConnection.id !== request.connectionId) {
          throw new Error('The original connection for this result is no longer active. Run the query again.');
        }

        return runner.fetchPage(
          lastConnection,
          {
            sql: request.sql,
            page: request.page,
            pageSize: request.pageSize,
            totalRows: request.totalRows,
          },
          getQueryExecutionOptions(),
        );
      },
    });

  return [
    vscode.commands.registerCommand(QueryCommandIds.runCurrent, async () => {
      lastConnection = await executeFromEditor('current', options.resolveConnection, runner, resultViewPanel);
    }),
    vscode.commands.registerCommand(QueryCommandIds.runAll, async () => {
      lastConnection = await executeFromEditor('all', options.resolveConnection, runner, resultViewPanel);
    }),
  ];
}

async function executeFromEditor(
  mode: 'current' | 'all',
  resolveConnection: () => Promise<ConnectionConfig | undefined>,
  runner: QueryRunner,
  resultViewPanel: ResultViewPanel,
): Promise<ConnectionConfig | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Open a .sql editor before running a query.');
    return undefined;
  }

  const extracted = mode === 'all'
    ? extractFullDocumentSql(editor)
    : extractSelectedOrCurrentStatement(editor);

  if (!extracted) {
    vscode.window.showInformationMessage('No SQL found to execute.');
    return undefined;
  }

  const connection = await resolveConnection();
  if (!connection) {
    vscode.window.showWarningMessage('Choose an active connection before running SQL.');
    return undefined;
  }

  const executionOptions = getQueryExecutionOptions();

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: mode === 'all' ? 'Running SQL document' : 'Running SQL statement',
        cancellable: false,
      },
      async () => {
        const results = await runner.execute(connection, extracted.sql, executionOptions);
        resultViewPanel.show(results);
      },
    );
    return connection;
  } catch (error) {
    vscode.window.showErrorMessage(getErrorMessage(error));
    return undefined;
  }
}

function getQueryExecutionOptions(): QueryExecutionOptions {
  const config = vscode.workspace.getConfiguration('sqlWorkbench');
  return {
    queryTimeoutMs: config.get<number>('queryTimeoutMs', 30000),
    resultPageSize: config.get<number>('resultPageSize', 10),
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
