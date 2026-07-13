import * as vscode from 'vscode';
import type { ConnectionConfig } from '../connection/types';
import type { QueryResult } from '../results/types';
import { ResultViewPanel } from '../results/resultViewPanel';
import {
  extractFullDocumentSql,
  extractSelectedOrCurrentStatement,
  type SqlExtractionSource,
} from './sqlExtractor';
import { createQueryRunner, type QueryExecutionOptions, type QueryInput, type QueryRunner } from './runner';
import { findDangerousSqlStatements } from './sqlSafety';
import { findStatementAtOffset, splitSqlStatements } from './sqlParser';
import { getSqlVariableNames } from './sqlVariables';

export const QueryCommandIds = {
  runCurrent: 'sqlWorkbench.query.runCurrent',
  runAll: 'sqlWorkbench.query.runAll',
  runRange: 'sqlWorkbench.query.runRange',
  runStatementAtRange: 'sqlWorkbench.query.runStatementAtRange',
} as const;

export interface QueryCommandRegistrationOptions {
  resolveConnection: (document?: vscode.TextDocument) => Promise<ConnectionConfig | undefined>;
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
            variableValues: request.variableValues,
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
    vscode.commands.registerCommand(QueryCommandIds.runRange, async (uri?: vscode.Uri, range?: vscode.Range) => {
      lastConnection = await executeRange(uri, range, options.resolveConnection, runner, resultViewPanel);
    }),
    vscode.commands.registerCommand(QueryCommandIds.runStatementAtRange, async (uri?: vscode.Uri, range?: vscode.Range) => {
      lastConnection = await executeStatementAtRange(uri, range, options.resolveConnection, runner, resultViewPanel);
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

  return executeSql(
    extracted.sql,
    extracted.source,
    optionsFrom(resolveConnection, runner, resultViewPanel, editor.document),
  );
}

async function executeRange(
  uri: vscode.Uri | undefined,
  range: vscode.Range | undefined,
  resolveConnection: () => Promise<ConnectionConfig | undefined>,
  runner: QueryRunner,
  resultViewPanel: ResultViewPanel,
): Promise<ConnectionConfig | undefined> {
  if (!uri || !range) {
    vscode.window.showWarningMessage('No SQL statement range was provided.');
    return undefined;
  }

  const document = await vscode.workspace.openTextDocument(uri);
  const sql = document.getText(range).trim();
  if (!sql) {
    vscode.window.showInformationMessage('No SQL found to execute.');
    return undefined;
  }

  return executeSql(sql, 'statement', optionsFrom(resolveConnection, runner, resultViewPanel, document));
}

async function executeStatementAtRange(
  uri: vscode.Uri | undefined,
  range: vscode.Range | undefined,
  resolveConnection: () => Promise<ConnectionConfig | undefined>,
  runner: QueryRunner,
  resultViewPanel: ResultViewPanel,
): Promise<ConnectionConfig | undefined> {
  if (!uri || !range) {
    vscode.window.showWarningMessage('No SQL statement range was provided.');
    return undefined;
  }

  const document = await vscode.workspace.openTextDocument(uri);
  const statement = findStatementAtOffset(
    document.getText(),
    document.offsetAt(range.start),
  );
  if (!statement) {
    vscode.window.showInformationMessage('No SQL found to execute.');
    return undefined;
  }

  return executeRange(
    uri,
    new vscode.Range(
      document.positionAt(statement.start),
      document.positionAt(statement.end),
    ),
    resolveConnection,
    runner,
    resultViewPanel,
  );
}

function optionsFrom(
  resolveConnection: (document?: vscode.TextDocument) => Promise<ConnectionConfig | undefined>,
  runner: QueryRunner,
  resultViewPanel: ResultViewPanel,
  document?: vscode.TextDocument,
): ExecuteSqlOptions {
  return {
    resolveConnection,
    runner,
    resultViewPanel,
    document,
  };
}

interface ExecuteSqlOptions {
  resolveConnection: (document?: vscode.TextDocument) => Promise<ConnectionConfig | undefined>;
  runner: QueryRunner;
  resultViewPanel: ResultViewPanel;
  document?: vscode.TextDocument;
}

async function executeSql(
  sql: string,
  source: SqlExtractionSource,
  options: ExecuteSqlOptions,
): Promise<ConnectionConfig | undefined> {
  const connection = await options.resolveConnection(options.document);
  if (!connection) {
    vscode.window.showWarningMessage('Choose an active connection before running SQL.');
    return undefined;
  }

  if (!await confirmDangerousSql(sql, connection)) {
    return undefined;
  }

  const executionOptions = getQueryExecutionOptions();
  const query = await resolveSqlVariables(sql);
  if (query === undefined) {
    return undefined;
  }

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: getExecutionTitle(source),
        cancellable: false,
      },
      async () => {
        const results = await options.runner.execute(connection, query, executionOptions);
        options.resultViewPanel.show(withExecutedSql(results, sql, source));
      },
    );
    return connection;
  } catch (error) {
    vscode.window.showErrorMessage(getErrorMessage(error));
    return undefined;
  }
}

function getExecutionTitle(source: SqlExtractionSource): string {
  if (source === 'document') {
    return 'Running SQL document';
  }

  return source === 'selection' ? 'Running selected SQL' : 'Running SQL statement';
}

function withExecutedSql(
  results: QueryResult[],
  sql: string,
  source: SqlExtractionSource,
): QueryResult[] {
  const statements = splitSqlStatements(sql);
  if (source === 'document' || statements.length !== 1) {
    return results;
  }

  const [statement] = statements;
  return results.map((result) => ({
    ...result,
    sql: statement,
    pagination: result.pagination ? {
      ...result.pagination,
      sourceSql: statement,
    } : undefined,
  }));
}

async function confirmDangerousSql(
  sql: string,
  connection: ConnectionConfig,
): Promise<boolean> {
  const dangerousStatements = findDangerousSqlStatements(sql);
  if (dangerousStatements.length === 0) {
    return true;
  }

  const preview = dangerousStatements
    .map((statement) => statement.sql.replace(/\s+/g, ' ').trim())
    .join('\n\n')
    .slice(0, 600);
  const target = connection.database ?? connection.path ?? connection.type;
  const confirmed = await vscode.window.showWarningMessage(
    [
      `This will run ${dangerousStatements.length} UPDATE/DELETE statement without WHERE on ${connection.name} / ${target}.`,
      '',
      preview,
    ].join('\n'),
    { modal: true },
    'Run Anyway',
  );

  return confirmed === 'Run Anyway';
}

async function resolveSqlVariables(sql: string): Promise<QueryInput | undefined> {
  const names = getSqlVariableNames(sql);
  if (names.length === 0) {
    return { sql };
  }

  const defaults = getSqlVariableDefaults();
  const variableValues: Record<string, unknown> = {};
  for (const name of names) {
    const configuredValue = defaults[name];
    const value = await vscode.window.showInputBox({
      title: 'SQL Variable',
      prompt: `Value for ${name}`,
      placeHolder: 'Use NULL for SQL NULL. Numbers and booleans are passed as typed parameters.',
      value: configuredValue === undefined || configuredValue === null
        ? configuredValue === null ? 'NULL' : undefined
        : String(configuredValue),
      ignoreFocusOut: true,
    });

    if (value === undefined) {
      return undefined;
    }

    variableValues[name] = parseSqlVariableValue(value);
  }

  return { sql, variableValues };
}

function parseSqlVariableValue(value: string): string | number | boolean | null {
  const trimmed = value.trim();

  if (/^null$/i.test(trimmed)) {
    return null;
  }

  if (/^true$/i.test(trimmed)) {
    return true;
  }

  if (/^false$/i.test(trimmed)) {
    return false;
  }

  if (/^[+-]?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) {
    return Number(trimmed);
  }

  return value;
}

function getSqlVariableDefaults(): Record<string, string | number | boolean | null> {
  const configured = vscode.workspace.getConfiguration('sqlWorkbench').get<unknown>('variables', {});
  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) {
    return {};
  }

  return configured as Record<string, string | number | boolean | null>;
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

export const __queryCommandTestHooks = {
  withExecutedSql,
};
