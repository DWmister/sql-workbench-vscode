import * as vscode from 'vscode';
import { getWebviewViewColumn } from '../editor/webviewColumn';
import type { ColumnInfo, TableDetails, TableInfo } from './types';

export interface TableDetailsPanelOptions {
  loadDdl(table: TableInfo): Promise<string>;
}

interface TableDetailsPanelMessage {
  type?: string;
  force?: boolean;
}

export class TableDetailsPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private currentDetails: TableDetails | undefined;
  private currentDdl: string | undefined;
  private tableVersion = 0;
  private ddlRequestId = 0;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly options: TableDetailsPanelOptions,
  ) {}

  public show(details: TableDetails): void {
    this.currentDetails = details;
    this.currentDdl = undefined;
    this.tableVersion += 1;
    this.ddlRequestId += 1;
    const viewColumn = this.panel?.viewColumn ?? getWebviewViewColumn();

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'sqlWorkbench.tableDetails',
        'Table Properties',
        viewColumn,
        {
          enableScripts: true,
          localResourceRoots: [this.extensionUri],
        },
      );

      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.currentDetails = undefined;
        this.currentDdl = undefined;
      });
      this.panel.webview.onDidReceiveMessage((message: TableDetailsPanelMessage) => {
        void this.handleMessage(message);
      });
    }

    this.panel.title = details.name;
    this.panel.webview.html = renderTableDetailsHtml(this.panel.webview, details);
    this.panel.reveal(viewColumn, false);
  }

  public dispose(): void {
    this.panel?.dispose();
  }

  private async handleMessage(message: TableDetailsPanelMessage): Promise<void> {
    if (message.type === 'loadDdl') {
      await this.loadDdl(Boolean(message.force));
      return;
    }

    if (message.type === 'copyDdl' && this.currentDdl !== undefined) {
      await vscode.env.clipboard.writeText(this.currentDdl);
      await this.panel?.webview.postMessage({ type: 'ddlCopied' });
    }
  }

  private async loadDdl(force: boolean): Promise<void> {
    const details = this.currentDetails;
    const panel = this.panel;
    if (!details || !panel) {
      return;
    }

    if (!force && this.currentDdl !== undefined) {
      await panel.webview.postMessage(createLoadedDdlMessage(this.currentDdl));
      return;
    }

    const tableVersion = this.tableVersion;
    const requestId = ++this.ddlRequestId;
    await panel.webview.postMessage({ type: 'ddlState', status: 'loading' });

    try {
      const ddl = await this.options.loadDdl(details);
      if (!this.isCurrentRequest(panel, tableVersion, requestId)) {
        return;
      }

      this.currentDdl = ddl;
      await panel.webview.postMessage(createLoadedDdlMessage(ddl));
    } catch (error) {
      if (!this.isCurrentRequest(panel, tableVersion, requestId)) {
        return;
      }

      await panel.webview.postMessage({
        type: 'ddlState',
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private isCurrentRequest(
    panel: vscode.WebviewPanel,
    tableVersion: number,
    requestId: number,
  ): boolean {
    return this.panel === panel
      && this.tableVersion === tableVersion
      && this.ddlRequestId === requestId;
  }
}

type SqlTokenKind = 'comment' | 'identifier' | 'keyword' | 'number' | 'operator' | 'plain' | 'string' | 'type';

interface SqlToken {
  kind: SqlTokenKind;
  value: string;
}

const SQL_KEYWORDS = new Set([
  'ACTION', 'ADD', 'ALTER', 'ALWAYS', 'AS', 'AUTO_INCREMENT', 'BY', 'BUCKETS',
  'CASCADE', 'CHARSET', 'CHECK', 'COLLATE', 'COMMENT', 'CONSTRAINT', 'CREATE',
  'DEFAULT', 'DEFERRABLE', 'DELETE', 'DISTRIBUTED', 'DROP', 'ENGINE', 'EXCLUDE',
  'FALSE', 'FOREIGN', 'GENERATED', 'HASH', 'IDENTITY', 'IF', 'INCLUDE', 'INDEX',
  'INITIALLY', 'KEY', 'LIKE', 'MATCH', 'NO', 'NOT', 'NULL', 'OLAP', 'ON', 'ONLY',
  'PARTITION', 'PRIMARY', 'PROPERTIES', 'REFERENCES', 'RESTRICT', 'SET', 'STORED',
  'TABLE', 'TABLESPACE', 'TEMP', 'TEMPORARY', 'TRUE', 'UNIQUE', 'UNLOGGED',
  'UPDATE', 'USING', 'VIRTUAL', 'WHERE', 'WITH',
]);

const SQL_TYPES = new Set([
  'ARRAY', 'BIGINT', 'BIGSERIAL', 'BINARY', 'BIT', 'BLOB', 'BOOL', 'BOOLEAN',
  'BYTEA', 'CHAR', 'CHARACTER', 'CLOB', 'DATE', 'DATETIME', 'DEC', 'DECIMAL',
  'DOUBLE', 'ENUM', 'FLOAT', 'GEOMETRY', 'INT', 'INTEGER', 'INTERVAL', 'JSON',
  'JSONB', 'MEDIUMINT', 'MONEY', 'NCHAR', 'NUMERIC', 'NVARCHAR', 'REAL', 'SERIAL',
  'SET', 'SMALLINT', 'SMALLSERIAL', 'TEXT', 'TIME', 'TIMESTAMP', 'TINYINT',
  'UUID', 'VARBINARY', 'VARCHAR', 'VARBIT', 'XML',
]);

function createLoadedDdlMessage(ddl: string): Record<string, string> {
  return {
    type: 'ddlState',
    status: 'loaded',
    ddl,
    ddlHtml: highlightSql(ddl),
  };
}

function highlightSql(sql: string): string {
  return tokenizeSql(sql).map((token) => {
    const value = escapeHtml(token.value);
    return token.kind === 'plain'
      ? value
      : `<span class="sql-${token.kind}">${value}</span>`;
  }).join('');
}

function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let index = 0;

  while (index < sql.length) {
    const remaining = sql.slice(index);
    const whitespace = /^\s+/u.exec(remaining)?.[0];
    if (whitespace) {
      tokens.push({ kind: 'plain', value: whitespace });
      index += whitespace.length;
      continue;
    }

    if (remaining.startsWith('--') || remaining.startsWith('#')) {
      const lineEnd = sql.indexOf('\n', index);
      const end = lineEnd === -1 ? sql.length : lineEnd;
      tokens.push({ kind: 'comment', value: sql.slice(index, end) });
      index = end;
      continue;
    }

    if (remaining.startsWith('/*')) {
      const commentEnd = sql.indexOf('*/', index + 2);
      const end = commentEnd === -1 ? sql.length : commentEnd + 2;
      tokens.push({ kind: 'comment', value: sql.slice(index, end) });
      index = end;
      continue;
    }

    const dollarTag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u.exec(remaining)?.[0];
    if (dollarTag) {
      const closingIndex = sql.indexOf(dollarTag, index + dollarTag.length);
      const end = closingIndex === -1 ? sql.length : closingIndex + dollarTag.length;
      tokens.push({ kind: 'string', value: sql.slice(index, end) });
      index = end;
      continue;
    }

    const character = sql[index];
    if (character === '\'' || character === '"' || character === '`' || character === '[') {
      const closing = character === '[' ? ']' : character;
      const end = findQuotedTokenEnd(sql, index, closing);
      tokens.push({
        kind: character === '\'' ? 'string' : 'identifier',
        value: sql.slice(index, end),
      });
      index = end;
      continue;
    }

    const number = /^(?:0x[\da-f]+|0b[01]+|\d+(?:\.\d*)?(?:e[+-]?\d+)?)/iu.exec(remaining)?.[0];
    if (number) {
      tokens.push({ kind: 'number', value: number });
      index += number.length;
      continue;
    }

    const word = /^[A-Za-z_][A-Za-z0-9_$]*/u.exec(remaining)?.[0];
    if (word) {
      const normalized = word.toUpperCase();
      const kind: SqlTokenKind = SQL_KEYWORDS.has(normalized)
        ? 'keyword'
        : SQL_TYPES.has(normalized)
          ? 'type'
          : 'identifier';
      tokens.push({ kind, value: word });
      index += word.length;
      continue;
    }

    const kind: SqlTokenKind = /[(),;.=:+\-*/%<>|&!]/u.test(character)
      ? 'operator'
      : 'plain';
    tokens.push({ kind, value: character });
    index += 1;
  }

  return tokens;
}

function findQuotedTokenEnd(sql: string, start: number, closing: string): number {
  let index = start + 1;

  while (index < sql.length) {
    if (sql[index] === '\\') {
      index = Math.min(sql.length, index + 2);
      continue;
    }

    if (sql[index] === closing) {
      if (sql[index + 1] === closing) {
        index += 2;
        continue;
      }
      return index + 1;
    }

    index += 1;
  }

  return sql.length;
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}' ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <title>${escapeHtml(details.name)}</title>
  <style nonce="${nonce}">
    :root {
      color-scheme: light dark;
      --border: var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
      --muted: var(--vscode-descriptionForeground);
      --accent: var(--vscode-focusBorder);
      --button: var(--vscode-button-secondaryBackground);
      --button-hover: var(--vscode-button-secondaryHoverBackground);
      --code: var(--vscode-textCodeBlock-background, var(--vscode-editorWidget-background));
      --error: var(--vscode-errorForeground);
      --sql-keyword: var(--vscode-symbolIcon-keywordForeground, #c586c0);
      --sql-type: var(--vscode-symbolIcon-classForeground, #4ec9b0);
      --sql-identifier: var(--vscode-symbolIcon-fieldForeground, #65b7f3);
      --sql-string: var(--vscode-debugTokenExpression-string, #8ec07c);
      --sql-number: var(--vscode-debugTokenExpression-number, #d19a66);
      --sql-comment: var(--vscode-editorLineNumber-foreground, #6a9955);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    button { font: inherit; }
    body.vscode-light {
      --sql-keyword: #7a1f8a;
      --sql-type: #006b68;
      --sql-identifier: #005fb8;
      --sql-string: #397300;
      --sql-number: #a04b00;
      --sql-comment: #527a2b;
    }
    .toolbar {
      position: sticky;
      top: 0;
      z-index: 3;
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 44px;
      padding: 0 16px;
      border-bottom: 1px solid var(--border);
      background: var(--vscode-editor-background);
    }
    .title { font-weight: 600; }
    .meta { color: var(--muted); }
    .badge {
      margin-left: auto;
      color: var(--muted);
      white-space: nowrap;
    }
    main { padding: 14px 16px 24px; }
    .summary {
      display: grid;
      grid-template-columns: repeat(3, minmax(120px, 1fr));
      gap: 10px;
      margin-bottom: 10px;
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
    .tabs {
      display: flex;
      align-items: flex-end;
      gap: 18px;
      min-height: 38px;
      margin-bottom: 12px;
      border-bottom: 1px solid var(--border);
    }
    .tab {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 38px;
      padding: 0 2px;
      border: 0;
      color: var(--muted);
      background: transparent;
      cursor: pointer;
      font-weight: 600;
    }
    .tab-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      color: var(--muted);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 14px;
      font-weight: 700;
      line-height: 1;
      letter-spacing: 0;
    }
    .tab-icon-columns { color: var(--sql-identifier); }
    .tab-icon-ddl { color: var(--sql-keyword); font-size: 12px; }
    .tab::after {
      position: absolute;
      right: 0;
      bottom: -1px;
      left: 0;
      height: 2px;
      background: transparent;
      content: '';
    }
    .tab:hover { color: var(--vscode-foreground); }
    .tab.active { color: var(--vscode-foreground); }
    .tab.active::after { background: var(--accent); }
    .tab:focus-visible,
    .action:focus-visible { outline: 1px solid var(--accent); outline-offset: 2px; }
    .panel[hidden] { display: none; }
    .table-wrap {
      overflow: auto;
      max-height: calc(100vh - 236px);
      border: 1px solid var(--border);
      border-radius: 4px;
    }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
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
    .col-name { width: 22%; }
    .col-type { width: 18%; }
    .col-length { width: 9%; }
    .col-comment { width: 24%; }
    .col-flag { width: 9%; }
    .col-default { width: 10%; }
    tr:last-child td { border-bottom: none; }
    th:last-child,
    td:last-child { border-right: none; }
    .key { color: var(--accent); font-weight: 600; }
    .empty,
    .ddl-state {
      padding: 16px 12px;
      color: var(--muted);
    }
    .ddl-state.error { color: var(--error); }
    .ddl-toolbar {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      min-height: 34px;
      margin-bottom: 8px;
    }
    .action {
      min-width: 72px;
      height: 28px;
      padding: 0 10px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 3px;
      color: var(--vscode-button-secondaryForeground);
      background: var(--button);
      cursor: pointer;
    }
    .action:hover { background: var(--button-hover); }
    .ddl-code {
      min-height: 240px;
      max-height: calc(100vh - 278px);
      margin: 0;
      padding: 14px 16px;
      overflow: auto;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: var(--code);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, 13px);
      line-height: 1.55;
      tab-size: 2;
      white-space: pre;
    }
    .sql-keyword { color: var(--sql-keyword); font-weight: 600; }
    .sql-type { color: var(--sql-type); }
    .sql-identifier { color: var(--sql-identifier); }
    .sql-string { color: var(--sql-string); }
    .sql-number { color: var(--sql-number); }
    .sql-comment { color: var(--sql-comment); }
    .sql-operator { color: var(--vscode-foreground); }
    @media (max-width: 720px) {
      .summary { grid-template-columns: 1fr; }
      .toolbar { flex-wrap: wrap; padding: 8px 12px; }
      .badge { margin-left: 0; }
      main { padding-right: 12px; padding-left: 12px; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <span class="title">${escapeHtml(schema)}${escapeHtml(details.name)}</span>
    <span class="meta">${details.columns.length} column${details.columns.length === 1 ? '' : 's'}</span>
    <span class="badge">Read-only properties</span>
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
    <div class="tabs" role="tablist" aria-label="Table properties">
      <button id="columns-tab" class="tab active" type="button" role="tab" aria-selected="true" aria-controls="columns-panel" data-tab="columns"><span class="tab-icon tab-icon-columns" aria-hidden="true">▤</span><span>Columns</span></button>
      <button id="ddl-tab" class="tab" type="button" role="tab" aria-selected="false" aria-controls="ddl-panel" data-tab="ddl"><span class="tab-icon tab-icon-ddl" aria-hidden="true">{}</span><span>DDL</span></button>
    </div>
    <section id="columns-panel" class="panel" role="tabpanel" aria-labelledby="columns-tab">
      ${renderColumns(details.columns)}
    </section>
    <section id="ddl-panel" class="panel" role="tabpanel" aria-labelledby="ddl-tab" hidden>
      <div id="ddl-toolbar" class="ddl-toolbar" hidden>
        <button class="action" type="button" data-action="copy" title="Copy DDL to clipboard">Copy</button>
        <button class="action" type="button" data-action="refresh" title="Reload DDL from the database">Refresh</button>
      </div>
      <div id="ddl-state" class="ddl-state" aria-live="polite">DDL loads when this tab opens.</div>
      <pre id="ddl-code" class="ddl-code" tabindex="0" hidden></pre>
    </section>
  </main>
  <script nonce="${nonce}">${getClientScript()}</script>
</body>
</html>`;
}

function getClientScript(): string {
  return `
const vscode = acquireVsCodeApi();
const state = { activeTab: 'columns', ddlStatus: 'idle' };

document.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-tab]');
  if (tab) {
    selectTab(tab.dataset.tab);
    return;
  }

  const action = event.target.closest('[data-action]');
  if (!action) return;
  if (action.dataset.action === 'copy') vscode.postMessage({ type: 'copyDdl' });
  if (action.dataset.action === 'refresh') requestDdl(true);
  if (action.dataset.action === 'retry') requestDdl(true);
});

window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message.type !== 'string') return;
  if (message.type === 'ddlState') renderDdlState(message);
  if (message.type === 'ddlCopied') showCopyConfirmation();
});

function selectTab(tabName) {
  if (tabName !== 'columns' && tabName !== 'ddl') return;
  state.activeTab = tabName;
  document.querySelectorAll('[data-tab]').forEach((tab) => {
    const active = tab.dataset.tab === tabName;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  document.getElementById('columns-panel').hidden = tabName !== 'columns';
  document.getElementById('ddl-panel').hidden = tabName !== 'ddl';
  if (tabName === 'ddl' && state.ddlStatus === 'idle') requestDdl(false);
}

function requestDdl(force) {
  state.ddlStatus = 'loading';
  renderDdlState({ status: 'loading' });
  vscode.postMessage({ type: 'loadDdl', force: Boolean(force) });
}

function renderDdlState(message) {
  const status = document.getElementById('ddl-state');
  const code = document.getElementById('ddl-code');
  const toolbar = document.getElementById('ddl-toolbar');
  state.ddlStatus = message.status;
  status.classList.toggle('error', message.status === 'error');

  if (message.status === 'loading') {
    status.hidden = false;
    status.textContent = 'Loading DDL...';
    code.hidden = true;
    toolbar.hidden = true;
    return;
  }

  if (message.status === 'loaded') {
    if (typeof message.ddlHtml === 'string') code.innerHTML = message.ddlHtml;
    else code.textContent = typeof message.ddl === 'string' ? message.ddl : '';
    code.hidden = false;
    toolbar.hidden = false;
    status.hidden = true;
    return;
  }

  if (message.status === 'error') {
    status.hidden = false;
    status.textContent = '';
    const messageText = document.createElement('div');
    messageText.textContent = message.message || 'Unable to load DDL.';
    const retry = document.createElement('button');
    retry.className = 'action';
    retry.type = 'button';
    retry.dataset.action = 'retry';
    retry.textContent = 'Retry';
    retry.style.marginTop = '12px';
    status.append(messageText, retry);
    code.hidden = true;
    toolbar.hidden = true;
  }
}

function showCopyConfirmation() {
  const copy = document.querySelector('[data-action="copy"]');
  if (!copy) return;
  const original = copy.textContent;
  copy.textContent = 'Copied';
  window.setTimeout(() => { copy.textContent = original; }, 1200);
}
`;
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

export const __tableDetailsPanelTestHooks = {
  getClientScript,
  highlightSql,
  renderTableDetailsHtml,
};
