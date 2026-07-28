import * as vscode from 'vscode';
import type { ConnectionConfig } from '../connection/types';
import {
  extractSelectedOrCurrentStatement,
} from '../query/sqlExtractor';
import type { AiAgentViewProvider } from './agentViewProvider';
import { AiCommandIds } from './ids';

export interface AiCommandRegistrationOptions {
  provider: AiAgentViewProvider;
  resolveConnection: (
    document?: vscode.TextDocument,
  ) => Promise<ConnectionConfig | undefined>;
}

export function registerAiCommands(
  options: AiCommandRegistrationOptions,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(
      AiCommandIds.explainSql,
      async (
        uri?: vscode.Uri,
        range?: vscode.Range,
        documentVersion?: number,
      ) => {
        const target = await resolveExplainTarget(uri, range, documentVersion);
        if (!target) {
          return;
        }

        const connection = await options.resolveConnection(target.document);
        if (!connection) {
          await vscode.window.showWarningMessage(
            'Choose an active connection before asking AI to explain SQL.',
          );
          return;
        }

        await options.provider.explainSql(target.sql, connection);
      },
    ),
    vscode.commands.registerCommand(
      AiCommandIds.newConversation,
      () => options.provider.newConversation(),
    ),
    vscode.commands.registerCommand(
      AiCommandIds.clearHistory,
      () => options.provider.clearHistory(),
    ),
  ];
}

interface ExplainTarget {
  document: vscode.TextDocument;
  sql: string;
}

async function resolveExplainTarget(
  uri?: vscode.Uri,
  range?: vscode.Range,
  documentVersion?: number,
): Promise<ExplainTarget | undefined> {
  const hasCodeLensArguments = uri !== undefined
    || range !== undefined
    || documentVersion !== undefined;

  if (hasCodeLensArguments) {
    if (!uri || !range || !Number.isInteger(documentVersion)) {
      await vscode.window.showWarningMessage(
        'The AI Explain statement reference is incomplete. Run the command again.',
      );
      return undefined;
    }

    const document = await vscode.workspace.openTextDocument(uri);
    if (document.languageId !== 'sql') {
      await vscode.window.showWarningMessage('AI Explain is available only for SQL documents.');
      return undefined;
    }
    if (document.version !== documentVersion) {
      await vscode.window.showWarningMessage(
        'The SQL document changed after the AI Explain action was created. Run AI Explain again.',
      );
      return undefined;
    }
    if (!isExactDocumentRange(document, range)) {
      await vscode.window.showWarningMessage(
        'The SQL statement range is no longer valid. Run AI Explain again.',
      );
      return undefined;
    }

    const sql = document.getText(range).trim();
    if (!sql) {
      await vscode.window.showInformationMessage('No SQL found to explain.');
      return undefined;
    }
    return { document, sql };
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'sql') {
    await vscode.window.showWarningMessage(
      'Open a SQL editor before asking AI to explain SQL.',
    );
    return undefined;
  }
  const extracted = extractSelectedOrCurrentStatement(editor);
  if (!extracted) {
    await vscode.window.showInformationMessage('No SQL found to explain.');
    return undefined;
  }
  return {
    document: editor.document,
    sql: extracted.sql,
  };
}

function isExactDocumentRange(
  document: vscode.TextDocument,
  range: vscode.Range,
): boolean {
  if (range.start.isAfter(range.end)) {
    return false;
  }
  return isExactDocumentPosition(document, range.start)
    && isExactDocumentPosition(document, range.end);
}

function isExactDocumentPosition(
  document: vscode.TextDocument,
  position: vscode.Position,
): boolean {
  if (
    !Number.isInteger(position.line)
    || !Number.isInteger(position.character)
    || position.line < 0
    || position.character < 0
    || position.line >= document.lineCount
  ) {
    return false;
  }
  return position.character <= document.lineAt(position.line).text.length;
}

export const __aiCommandTestHooks = {
  isExactDocumentRange,
};
