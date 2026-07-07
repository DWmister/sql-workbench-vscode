import * as vscode from 'vscode';
import type { ConnectionConfig } from '../connection/types';
import { ResultViewPanel } from '../results/resultViewPanel';
import { extractFullDocumentSql, extractSelectedOrCurrentStatement } from './sqlExtractor';
import { createQueryRunner, type QueryRunner } from './runner';

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
  const resultViewPanel = options.resultViewPanel
    ?? new ResultViewPanel(context.extensionUri);
  const runner = options.runner ?? createQueryRunner();

  return [
    vscode.commands.registerCommand(QueryCommandIds.runCurrent, async () => {
      await executeFromEditor('current', options.resolveConnection, runner, resultViewPanel);
    }),
    vscode.commands.registerCommand(QueryCommandIds.runAll, async () => {
      await executeFromEditor('all', options.resolveConnection, runner, resultViewPanel);
    }),
  ];
}

async function executeFromEditor(
  mode: 'current' | 'all',
  resolveConnection: () => Promise<ConnectionConfig | undefined>,
  runner: QueryRunner,
  resultViewPanel: ResultViewPanel,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Open a .sql editor before running a query.');
    return;
  }

  const extracted = mode === 'all'
    ? extractFullDocumentSql(editor)
    : extractSelectedOrCurrentStatement(editor);

  if (!extracted) {
    vscode.window.showInformationMessage('No SQL found to execute.');
    return;
  }

  const connection = await resolveConnection();
  if (!connection) {
    vscode.window.showWarningMessage('Choose an active connection before running SQL.');
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: mode === 'all' ? 'Running SQL document' : 'Running SQL statement',
      cancellable: false,
    },
    async () => {
      const results = await runner.execute(connection, extracted.sql);
      resultViewPanel.show(results);
    },
  );
}
