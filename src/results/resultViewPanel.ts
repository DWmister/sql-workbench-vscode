import * as vscode from 'vscode';
import type { QueryColumn, QueryResult, QueryResultPagination, QueryValue } from './types';

export interface ResultPageRequest {
  resultIndex: number;
  connectionId: string;
  sql: string;
  page: number;
  pageSize: number;
  totalRows: number;
}

interface ResultViewPanelOptions {
  loadPage?: (request: ResultPageRequest) => Promise<QueryResult>;
}

interface DisplayResult {
  sql: string;
  columns: QueryColumn[];
  rows: string[][];
  rowCount: number;
  elapsedMs: number;
  affectedRows?: number;
  error?: string;
  connectionId?: string;
  connectionName?: string;
  pagination?: QueryResultPagination;
}

interface ResultsPayload {
  connectionName: string;
  elapsedMs: number;
  hasError: boolean;
  pageSize: number;
  resultCount: number;
  totalRows: number;
  results: DisplayResult[];
}

type WebviewMessage =
  | { type?: 'ready' }
  | { type?: 'requestPage'; payload?: ResultPageRequest };

export class ResultViewPanel {
  private panel: vscode.WebviewPanel | undefined;
  private messageSubscription: vscode.Disposable | undefined;
  private lastPayload: ResultsPayload | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly options: ResultViewPanelOptions = {},
  ) {}

  public show(results: QueryResult[]): void {
    this.lastPayload = toPayload(results, getResultPageSize());

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'sqlWorkbench.results',
        'SQL Results',
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          localResourceRoots: [this.extensionUri],
        },
      );

      this.messageSubscription = this.panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
        void this.handleMessage(message);
      });

      this.panel.onDidDispose(() => {
        this.messageSubscription?.dispose();
        this.messageSubscription = undefined;
        this.panel = undefined;
      });
    }

    this.panel.webview.html = renderResultsHtml(this.panel.webview);
    this.panel.reveal(vscode.ViewColumn.Beside, false);
    setTimeout(() => this.postResults(), 0);
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    if (message.type === 'ready') {
      this.postResults();
      return;
    }

    if (message.type !== 'requestPage' || !message.payload || !this.options.loadPage) {
      return;
    }

    try {
      const result = await this.options.loadPage(message.payload);
      const displayResult = toDisplayResult(result);

      if (this.lastPayload?.results[message.payload.resultIndex]) {
        this.lastPayload.results[message.payload.resultIndex] = displayResult;
      }

      void this.panel?.webview.postMessage({
        type: 'pageResult',
        payload: {
          resultIndex: message.payload.resultIndex,
          result: displayResult,
        },
      });
    } catch (error) {
      void this.panel?.webview.postMessage({
        type: 'pageError',
        payload: {
          resultIndex: message.payload.resultIndex,
          message: getErrorMessage(error),
        },
      });
    }
  }

  private postResults(): void {
    if (!this.panel || !this.lastPayload) {
      return;
    }

    void this.panel.webview.postMessage({
      type: 'results',
      payload: this.lastPayload,
    });
  }
}

function toPayload(results: QueryResult[], pageSize: number): ResultsPayload {
  const totalRows = results.reduce((count, result) => count + result.rowCount, 0);
  const elapsedMs = results.reduce((count, result) => count + result.elapsedMs, 0);
  const connectionName = results[0]?.connectionName ?? 'No connection';

  return {
    connectionName,
    elapsedMs,
    hasError: results.some((result) => result.error),
    pageSize,
    resultCount: results.length,
    totalRows,
    results: results.map(toDisplayResult),
  };
}

function toDisplayResult(result: QueryResult): DisplayResult {
  return {
    sql: result.sql,
    columns: result.columns,
    rows: result.rows.map((row) => row.map(formatValue)),
    rowCount: result.rowCount,
    elapsedMs: result.elapsedMs,
    affectedRows: result.affectedRows,
    error: result.error,
    connectionId: result.connectionId,
    connectionName: result.connectionName,
    pagination: result.pagination,
  };
}

function renderResultsHtml(webview: vscode.Webview): string {
  const nonce = getNonce();

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '  <meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'nonce-' + nonce + '\' ' + webview.cspSource + '; script-src \'nonce-' + nonce + '\';">',
    '  <title>SQL Results</title>',
    '  <style nonce="' + nonce + '">',
    '    :root { color-scheme: light dark; --border: var(--vscode-panel-border, rgba(128, 128, 128, 0.35)); --muted: var(--vscode-descriptionForeground); --error: var(--vscode-errorForeground); --button-bg: var(--vscode-button-secondaryBackground, transparent); --button-fg: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); }',
    '    body { margin: 0; padding: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }',
    '    .toolbar, .pager { display: flex; align-items: center; gap: 10px; min-height: 38px; padding: 0 14px; border-bottom: 1px solid var(--border); background: var(--vscode-editor-background); white-space: nowrap; }',
    '    .toolbar { position: sticky; top: 0; z-index: 2; }',
    '    .title, .section-title { font-weight: 600; }',
    '    .meta, .range, .empty, .loading { color: var(--muted); }',
    '    .badge { margin-left: auto; padding: 2px 8px; border: 1px solid var(--border); border-radius: 999px; color: var(--muted); }',
    '    main { padding: 12px 14px 18px; }',
    '    section { margin-bottom: 16px; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: var(--vscode-editor-background); }',
    '    .section-header { display: flex; align-items: center; gap: 10px; min-height: 38px; padding: 0 12px; border-bottom: 1px solid var(--border); background: var(--vscode-sideBar-background); }',
    '    pre { margin: 0; padding: 9px 12px; overflow: auto; border-bottom: 1px solid var(--border); color: var(--muted); font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); line-height: 1.45; white-space: pre-wrap; }',
    '    .table-wrap { overflow: auto; max-height: 62vh; }',
    '    table { width: 100%; border-collapse: collapse; table-layout: auto; }',
    '    th, td { max-width: 420px; padding: 7px 10px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '    th { position: sticky; top: 0; background: var(--vscode-editorGroupHeader-tabsBackground); font-weight: 600; z-index: 1; }',
    '    th:last-child, td:last-child { border-right: none; }',
    '    .empty, .error, .loading { padding: 16px 12px; }',
    '    .error { color: var(--error); white-space: pre-wrap; }',
    '    button { min-width: 28px; height: 24px; border: 1px solid var(--border); border-radius: 4px; color: var(--button-fg); background: var(--button-bg); font: inherit; cursor: pointer; }',
    '    button:disabled { cursor: default; opacity: 0.45; }',
    '    .page-number { min-width: 42px; text-align: center; color: var(--muted); }',
    '  </style>',
    '</head>',
    '<body>',
    '  <div id="toolbar" class="toolbar"><span class="title">SQL Results</span><span class="meta">Waiting for results...</span><span class="badge">Read-only</span></div>',
    '  <main id="results"></main>',
    '  <script nonce="' + nonce + '">',
    getClientScript(),
    '  </script>',
    '</body>',
    '</html>',
  ].join('\n');
}

function getClientScript(): string {
  return [
    'const vscode = acquireVsCodeApi();',
    'const state = { payload: undefined, pages: [], loading: {} };',
    'window.addEventListener("message", (event) => { const data = event.data; if (!data) return; if (data.type === "results") { state.payload = data.payload; state.pages = state.payload.results.map((result) => result.pagination ? result.pagination.page : 1); state.loading = {}; render(); } else if (data.type === "pageResult") { state.payload.results[data.payload.resultIndex] = data.payload.result; state.pages[data.payload.resultIndex] = data.payload.result.pagination ? data.payload.result.pagination.page : 1; state.loading[data.payload.resultIndex] = false; renderResult(data.payload.resultIndex); renderToolbar(); } else if (data.type === "pageError") { state.loading[data.payload.resultIndex] = false; const body = document.querySelector("[data-body=\\"" + data.payload.resultIndex + "\\"]"); if (body) body.innerHTML = "<div class=\\"error\\">" + escapeHtml(data.payload.message) + "</div>"; } });',
    'document.addEventListener("click", (event) => { const button = event.target.closest("button[data-action]"); if (!button || !state.payload) return; const index = Number(button.dataset.index); const result = state.payload.results[index]; const pageCount = getPageCount(result, state.payload.pageSize); const current = state.pages[index] || 1; const next = button.dataset.action === "prev" ? Math.max(1, current - 1) : Math.min(pageCount, current + 1); if (next === current) return; if (result.pagination && result.connectionId) { requestServerPage(index, result, next); } else { state.pages[index] = next; renderResult(index); } });',
    'function requestServerPage(index, result, page) { state.loading[index] = true; state.pages[index] = page; renderResult(index); vscode.postMessage({ type: "requestPage", payload: { resultIndex: index, connectionId: result.connectionId, sql: result.pagination.sourceSql, page, pageSize: result.pagination.pageSize, totalRows: result.pagination.totalRows } }); }',
    'function render() { renderToolbar(); const root = document.getElementById("results"); root.innerHTML = state.payload.results.map((_, index) => sectionShell(index)).join(""); state.payload.results.forEach((_, index) => renderResult(index)); }',
    'function renderToolbar() { const payload = state.payload; document.getElementById("toolbar").innerHTML = "<span class=\\"title\\">" + escapeHtml(payload.connectionName) + "</span><span class=\\"meta\\">" + payload.resultCount + " result" + (payload.resultCount === 1 ? "" : "s") + " · Total " + payload.totalRows + " · 耗时: " + formatElapsed(payload.elapsedMs) + (payload.hasError ? " · error" : "") + "</span><span class=\\"badge\\">Page size " + payload.pageSize + "</span>"; }',
    'function sectionShell(index) { return "<section data-result=\\"" + index + "\\"><div class=\\"section-header\\" data-header=\\"" + index + "\\"></div><pre data-sql=\\"" + index + "\\"></pre><div data-body=\\"" + index + "\\"></div></section>"; }',
    'function renderResult(index) { const result = state.payload.results[index]; const pageSize = result.pagination ? result.pagination.pageSize : state.payload.pageSize; const page = state.pages[index] || 1; const pageCount = getPageCount(result, pageSize); const start = result.rowCount === 0 ? 0 : (page - 1) * pageSize + 1; const end = Math.min(result.rowCount, page * pageSize); const affected = result.affectedRows === undefined ? "" : " · " + result.affectedRows + " affected"; document.querySelector("[data-header=\\"" + index + "\\"]").innerHTML = "<span class=\\"section-title\\">Result " + (index + 1) + "</span><span class=\\"meta\\">" + start + "-" + end + " / Total " + result.rowCount + " · 耗时: " + formatElapsed(result.elapsedMs) + affected + "</span>"; document.querySelector("[data-sql=\\"" + index + "\\"]").textContent = result.sql; const body = document.querySelector("[data-body=\\"" + index + "\\"]"); if (state.loading[index]) { body.innerHTML = renderPager(index, page, pageCount, start, end, result.rowCount) + "<div class=\\"loading\\">Loading page " + page + "...</div>"; return; } if (result.error) { body.innerHTML = "<div class=\\"error\\">" + escapeHtml(result.error) + "</div>"; return; } if (result.columns.length === 0) { body.innerHTML = "<div class=\\"empty\\">Statement executed. No rows returned.</div>"; return; } const rows = result.pagination ? result.rows : result.rows.slice((page - 1) * pageSize, page * pageSize); body.innerHTML = renderPager(index, page, pageCount, start, end, result.rowCount) + "<div class=\\"table-wrap\\"><table><thead><tr>" + result.columns.map((column) => "<th title=\\"" + escapeAttribute(column.name) + "\\">" + escapeHtml(column.name) + "</th>").join("") + "</tr></thead><tbody>" + rows.map((row) => "<tr>" + row.map((cell) => "<td title=\\"" + escapeAttribute(cell) + "\\">" + escapeHtml(cell) + "</td>").join("") + "</tr>").join("") + "</tbody></table></div>"; }',
    'function renderPager(index, page, pageCount, start, end, total) { return "<div class=\\"pager\\"><button data-action=\\"prev\\" data-index=\\"" + index + "\\" " + (page <= 1 ? "disabled" : "") + ">&lt;</button><span class=\\"page-number\\">" + page + " / " + pageCount + "</span><button data-action=\\"next\\" data-index=\\"" + index + "\\" " + (page >= pageCount ? "disabled" : "") + ">&gt;</button><span class=\\"range\\">" + start + "-" + end + " / Total " + total + "</span></div>"; }',
    'function getPageCount(result, pageSize) { return Math.max(1, Math.ceil(result.rowCount / pageSize)); }',
    'function formatElapsed(elapsedMs) { return elapsedMs < 1000 ? (Math.round(elapsedMs * 100) / 100) + " ms" : (Math.round((elapsedMs / 1000) * 100) / 100) + " s"; }',
    'function escapeHtml(value) { return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\\"/g, "&quot;").replace(/\'/g, "&#39;"); }',
    'function escapeAttribute(value) { return escapeHtml(value).replace(/\\n/g, "&#10;"); }',
    'vscode.postMessage({ type: "ready" });',
  ].join('\n');
}

function getResultPageSize(): number {
  const configured = vscode.workspace.getConfiguration('sqlWorkbench').get<number>('resultPageSize', 10);
  return Number.isInteger(configured) && configured > 0 ? configured : 10;
}

function formatValue(value: QueryValue): string {
  if (value === null) {
    return 'NULL';
  }

  if (value instanceof Uint8Array) {
    return '<BLOB ' + value.byteLength + ' bytes>';
  }

  return String(value);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';

  for (let index = 0; index < 32; index += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return text;
}
