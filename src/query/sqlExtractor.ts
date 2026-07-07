import * as vscode from 'vscode';
import { findStatementAtOffset } from './sqlParser';

export type SqlExtractionSource = 'selection' | 'statement' | 'document';

export interface ExtractedSql {
  sql: string;
  source: SqlExtractionSource;
  range?: vscode.Range;
}

export function extractSelectedOrCurrentStatement(
  editor: vscode.TextEditor,
): ExtractedSql | undefined {
  const document = editor.document;
  const selectionText = editor.document.getText(editor.selection).trim();

  if (selectionText) {
    return {
      sql: selectionText,
      source: 'selection',
      range: editor.selection,
    };
  }

  const text = document.getText();
  const cursorOffset = document.offsetAt(editor.selection.active);
  const statement = findStatementAtOffset(text, cursorOffset);

  if (!statement) {
    return undefined;
  }

  return {
    sql: text.slice(statement.start, statement.end).trim(),
    source: 'statement',
    range: new vscode.Range(
      document.positionAt(statement.start),
      document.positionAt(statement.end),
    ),
  };
}

export function extractFullDocumentSql(
  editor: vscode.TextEditor,
): ExtractedSql | undefined {
  const sql = editor.document.getText().trim();

  if (!sql) {
    return undefined;
  }

  return {
    sql,
    source: 'document',
    range: new vscode.Range(
      editor.document.positionAt(0),
      editor.document.positionAt(editor.document.getText().length),
    ),
  };
}
