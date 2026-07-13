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

  const sqlStart = skipLeadingSqlComments(text, statement.start, statement.end);

  return {
    sql: text.slice(sqlStart, statement.end).trim(),
    source: 'statement',
    range: new vscode.Range(
      document.positionAt(sqlStart),
      document.positionAt(statement.end),
    ),
  };
}

function skipLeadingSqlComments(sql: string, start: number, end: number): number {
  let index = start;

  while (index < end) {
    while (index < end && /\s/u.test(sql[index])) {
      index += 1;
    }

    if ((sql[index] === '-' && sql[index + 1] === '-') || sql[index] === '#') {
      const lineEnd = sql.indexOf('\n', index);
      index = lineEnd === -1 || lineEnd >= end ? end : lineEnd + 1;
      continue;
    }

    if (sql[index] === '/' && sql[index + 1] === '*') {
      const blockEnd = sql.indexOf('*/', index + 2);
      index = blockEnd === -1 || blockEnd + 2 >= end ? end : blockEnd + 2;
      continue;
    }

    break;
  }

  return index;
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
