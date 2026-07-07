import * as vscode from 'vscode';
import type { QueryResult, QueryValue } from './types';

export class ResultViewPanel {
  private panel: vscode.WebviewPanel | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  public show(results: QueryResult[]): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'sqlWorkbench.results',
        'SQL Results',
        vscode.ViewColumn.Beside,
        {
          enableScripts: false,
          localResourceRoots: [this.extensionUri],
        },
      );

      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
    }

    this.panel.webview.html = renderResultsHtml(this.panel.webview, results);
    this.panel.reveal(vscode.ViewColumn.Beside, false);
  }
}

function renderResultsHtml(
  webview: vscode.Webview,
  results: QueryResult[],
): string {
  const nonce = getNonce();
  const hasError = results.some((result) => result.error);
  const totalRows = results.reduce((count, result) => count + result.rowCount, 0);
  const elapsed = results.reduce((count, result) => count + result.elapsedMs, 0);
  const connection = results[0]?.connectionName ?? 'No connection';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}' ${webview.cspSource};">
  <title>SQL Results</title>
  <style nonce="${nonce}">
    :root {
      color-scheme: light dark;
      --border: var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
      --muted: var(--vscode-descriptionForeground);
      --error: var(--vscode-errorForeground);
    }
    body {
      margin: 0;
      padding: 0;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    .toolbar {
      position: sticky;
      top: 0;
      z-index: 1;
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 42px;
      padding: 0 16px;
      border-bottom: 1px solid var(--border);
      background: var(--vscode-editor-background);
    }
    .title {
      font-weight: 600;
    }
    .meta {
      color: var(--muted);
    }
    .badge {
      margin-left: auto;
      padding: 2px 8px;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--muted);
      white-space: nowrap;
    }
    main {
      padding: 14px 16px 24px;
    }
    section {
      margin-bottom: 18px;
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
      background: var(--vscode-editor-background);
    }
    .section-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      background: var(--vscode-sideBar-background);
    }
    .section-title {
      font-weight: 600;
    }
    pre {
      margin: 0;
      padding: 10px 12px;
      overflow: auto;
      border-bottom: 1px solid var(--border);
      color: var(--muted);
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      line-height: 1.45;
      white-space: pre-wrap;
    }
    .table-wrap {
      overflow: auto;
      max-height: 62vh;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: auto;
    }
    th,
    td {
      max-width: 420px;
      padding: 7px 10px;
      border-right: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
      text-align: left;
      vertical-align: top;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    th {
      position: sticky;
      top: 0;
      background: var(--vscode-editorGroupHeader-tabsBackground);
      font-weight: 600;
    }
    tr:last-child td {
      border-bottom: none;
    }
    th:last-child,
    td:last-child {
      border-right: none;
    }
    .empty,
    .error {
      padding: 16px 12px;
    }
    .error {
      color: var(--error);
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <span class="title">${escapeHtml(connection)}</span>
    <span class="meta">${results.length} result${results.length === 1 ? '' : 's'} · ${totalRows} row${totalRows === 1 ? '' : 's'} · ${formatElapsed(elapsed)}${hasError ? ' · error' : ''}</span>
    <span class="badge">Read-only result view</span>
  </div>
  <main>
    ${results.map(renderResultSection).join('')}
  </main>
</body>
</html>`;
}

function renderResultSection(result: QueryResult, index: number): string {
  const affectedRows = result.affectedRows === undefined
    ? ''
    : ` · ${result.affectedRows} affected`;

  return `<section>
    <div class="section-header">
      <span class="section-title">Result ${index + 1}</span>
      <span class="meta">${result.rowCount} row${result.rowCount === 1 ? '' : 's'} · ${formatElapsed(result.elapsedMs)}${affectedRows}</span>
    </div>
    <pre>${escapeHtml(result.sql)}</pre>
    ${result.error ? renderError(result.error) : renderTable(result)}
  </section>`;
}

function renderError(error: string): string {
  return `<div class="error">${escapeHtml(error)}</div>`;
}

function renderTable(result: QueryResult): string {
  if (result.columns.length === 0) {
    return '<div class="empty meta">Statement executed. No rows returned.</div>';
  }

  return `<div class="table-wrap">
    <table>
      <thead>
        <tr>${result.columns.map((column) => `<th title="${escapeAttribute(column.name)}">${escapeHtml(column.name)}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${result.rows.map((row) => `<tr>${row.map(renderCell).join('')}</tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

function renderCell(value: QueryValue): string {
  const displayValue = formatValue(value);
  return `<td title="${escapeAttribute(displayValue)}">${escapeHtml(displayValue)}</td>`;
}

function formatValue(value: QueryValue): string {
  if (value === null) {
    return 'NULL';
  }

  if (value instanceof Uint8Array) {
    return `<BLOB ${value.byteLength} bytes>`;
  }

  return String(value);
}

function formatElapsed(elapsedMs: number): string {
  if (elapsedMs < 1000) {
    return `${Math.round(elapsedMs * 100) / 100} ms`;
  }

  return `${Math.round((elapsedMs / 1000) * 100) / 100} s`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/\n/g, '&#10;');
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';

  for (let index = 0; index < 32; index += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return text;
}
