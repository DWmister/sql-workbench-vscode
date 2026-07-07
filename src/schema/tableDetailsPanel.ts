import * as vscode from 'vscode';
import type { ColumnInfo, TableDetails } from './types';

export class TableDetailsPanel {
  private panel: vscode.WebviewPanel | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  public show(details: TableDetails): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'sqlWorkbench.tableDetails',
        'Table Columns',
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

    this.panel.title = details.name;
    this.panel.webview.html = renderTableDetailsHtml(this.panel.webview, details);
    this.panel.reveal(vscode.ViewColumn.Beside, false);
  }
}

function renderTableDetailsHtml(
  webview: vscode.Webview,
  details: TableDetails,
): string {
  const nonce = getNonce();
  const schema = details.schema ? `${details.schema}.` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}' ${webview.cspSource};">
  <title>${escapeHtml(details.name)}</title>
  <style nonce="${nonce}">
    :root {
      color-scheme: light dark;
      --border: var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
      --muted: var(--vscode-descriptionForeground);
      --accent: var(--vscode-focusBorder);
    }
    body {
      margin: 0;
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
      min-height: 44px;
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
    .summary {
      display: grid;
      grid-template-columns: repeat(3, minmax(120px, 1fr));
      gap: 10px;
      margin-bottom: 14px;
    }
    .summary-item {
      min-width: 0;
      padding: 9px 0;
      border-bottom: 1px solid var(--border);
    }
    .label {
      margin-bottom: 4px;
      color: var(--muted);
      font-size: 0.92em;
    }
    .value {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 600;
    }
    .table-wrap {
      overflow: auto;
      max-height: calc(100vh - 178px);
      border: 1px solid var(--border);
      border-radius: 6px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    th,
    td {
      padding: 8px 10px;
      border-right: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
      text-align: left;
      vertical-align: middle;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: var(--vscode-editorGroupHeader-tabsBackground);
      font-weight: 600;
    }
    .col-name {
      width: 22%;
    }
    .col-type {
      width: 18%;
    }
    .col-length {
      width: 9%;
    }
    .col-comment {
      width: 24%;
    }
    .col-flag {
      width: 9%;
    }
    .col-default {
      width: 10%;
    }
    tr:last-child td {
      border-bottom: none;
    }
    th:last-child,
    td:last-child {
      border-right: none;
    }
    .key {
      color: var(--accent);
      font-weight: 600;
    }
    .empty {
      padding: 16px 12px;
      color: var(--muted);
    }
    @media (max-width: 720px) {
      .summary {
        grid-template-columns: 1fr;
      }
      .toolbar {
        flex-wrap: wrap;
        padding: 8px 12px;
      }
      .badge {
        margin-left: 0;
      }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <span class="title">${escapeHtml(schema)}${escapeHtml(details.name)}</span>
    <span class="meta">${details.columns.length} column${details.columns.length === 1 ? '' : 's'}</span>
    <span class="badge">Read-only schema view</span>
  </div>
  <main>
    <div class="summary">
      <div class="summary-item">
        <div class="label">Connection</div>
        <div class="value" title="${escapeAttribute(details.connection.name)}">${escapeHtml(details.connection.name)}</div>
      </div>
      <div class="summary-item">
        <div class="label">Database</div>
        <div class="value" title="${escapeAttribute(getDatabaseLabel(details))}">${escapeHtml(getDatabaseLabel(details))}</div>
      </div>
      <div class="summary-item">
        <div class="label">Table</div>
        <div class="value" title="${escapeAttribute(details.name)}">${escapeHtml(details.name)}</div>
      </div>
    </div>
    ${renderColumns(details.columns)}
  </main>
</body>
</html>`;
}

function renderColumns(columns: ColumnInfo[]): string {
  if (columns.length === 0) {
    return '<div class="empty">No columns found.</div>';
  }

  return `<div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th class="col-name">Name</th>
          <th class="col-type">Type</th>
          <th class="col-length">Length</th>
          <th class="col-comment">Comment</th>
          <th class="col-flag">Nullable</th>
          <th class="col-flag">Primary Key</th>
          <th class="col-default">Default</th>
        </tr>
      </thead>
      <tbody>
        ${columns.map(renderColumn).join('')}
      </tbody>
    </table>
  </div>`;
}

function renderColumn(column: ColumnInfo): string {
  const name = column.primaryKey
    ? `<span class="key">PK</span> ${escapeHtml(column.name)}`
    : escapeHtml(column.name);

  return `<tr>
    <td class="col-name" title="${escapeAttribute(column.name)}">${name}</td>
    <td class="col-type" title="${escapeAttribute(column.type)}">${escapeHtml(column.type || '-')}</td>
    <td class="col-length" title="${escapeAttribute(column.length ?? '')}">${escapeHtml(column.length ?? '')}</td>
    <td class="col-comment" title="${escapeAttribute(column.comment ?? '')}">${escapeHtml(column.comment ?? '')}</td>
    <td class="col-flag">${column.nullable ? 'YES' : 'NO'}</td>
    <td class="col-flag">${column.primaryKey ? 'YES' : 'NO'}</td>
    <td class="col-default" title="${escapeAttribute(column.defaultValue ?? '')}">${escapeHtml(column.defaultValue ?? '')}</td>
  </tr>`;
}

function getDatabaseLabel(details: TableDetails): string {
  return details.connection.database
    ?? details.connection.path
    ?? details.connection.type;
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
