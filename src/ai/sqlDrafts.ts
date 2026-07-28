import * as vscode from 'vscode';
import type { AiSqlDraft } from './sessionStore';

export interface AiSqlDraftSource {
  findDraft(conversationId: string, draftId: string): AiSqlDraft | undefined;
}

export class AiSqlDraftHost {
  constructor(private readonly source: AiSqlDraftSource) {}

  /**
   * Resolves SQL from trusted Extension Host state. The Webview supplies only
   * conversationId/draftId and cannot replace the SQL at action time.
   */
  public async insert(conversationId: string, draftId: string): Promise<void> {
    const draft = this.requireDraft(conversationId, draftId);
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      throw new Error('Open an editor before inserting an AI SQL draft.');
    }

    const insertion = getInsertion(editor, draft.sql);
    const applied = await editor.edit((builder) => {
      builder.replace(editor.selection, insertion);
    });
    if (!applied) {
      throw new Error('The AI SQL draft could not be inserted into the editor.');
    }
  }

  public async open(conversationId: string, draftId: string): Promise<vscode.TextEditor> {
    const draft = this.requireDraft(conversationId, draftId);
    const document = await vscode.workspace.openTextDocument({
      language: 'sql',
      content: `${draft.sql.trim()}\n`,
    });
    return vscode.window.showTextDocument(document, { preview: false });
  }

  private requireDraft(conversationId: string, draftId: string): AiSqlDraft {
    const draft = this.source.findDraft(conversationId, draftId);
    if (!draft) {
      throw new Error('The requested AI SQL draft no longer exists.');
    }
    return draft;
  }
}

function getInsertion(editor: vscode.TextEditor, sql: string): string {
  const value = sql.trim();
  if (!editor.selection.isEmpty) {
    return value;
  }

  const document = editor.document;
  const offset = document.offsetAt(editor.selection.active);
  const before = offset > 0 ? document.getText().slice(0, offset) : '';
  const after = offset < document.getText().length
    ? document.getText().slice(offset)
    : '';
  return `${before && !before.endsWith('\n') ? '\n' : ''}${value}${after && !after.startsWith('\n') ? '\n' : ''}`;
}
