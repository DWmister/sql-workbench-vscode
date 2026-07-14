import * as vscode from 'vscode';
import { getWebviewViewColumn } from '../editor/webviewColumn';
import type { QueryColumn, QueryResult, QueryResultPagination, QueryValue } from './types';

export interface ResultPageRequest {
  resultIndex: number;
  connectionId: string;
  sql: string;
  variableValues?: Record<string, unknown>;
  page: number;
  pageSize: number;
  totalRows: number;
}

interface ResultViewPanelOptions {
  loadPage?: (request: ResultPageRequest) => Promise<QueryResult>;
}

type DisplayValue = string | number | boolean | null | { type: 'blob'; bytes: number };

interface DisplayResult {
  sql: string;
  sqlHtml: string;
  columns: QueryColumn[];
  rows: string[][];
  values: DisplayValue[][];
  rowCount: number;
  elapsedMs: number;
  affectedRows?: number;
  error?: string;
  connectionId?: string;
  connectionName?: string;
  pagination?: DisplayPagination;
}

type DisplayPagination = Omit<QueryResultPagination, 'variableValues'>;

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
  | { type?: 'requestPage'; payload?: ResultPageRequest }
  | { type?: 'exportResult'; payload?: ExportRequest };

interface ExportRequest {
  resultIndex: number;
  format: 'csv' | 'json' | 'xlsx';
  scope: 'page' | 'all';
  page: number;
  pageSize: number;
}

const FULL_EXPORT_ROW_LIMIT = 50_000;

export class ResultViewPanel {
  private panel: vscode.WebviewPanel | undefined;
  private messageSubscription: vscode.Disposable | undefined;
  private lastPayload: ResultsPayload | undefined;
  private paginationVariables = new Map<number, Record<string, unknown>>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly options: ResultViewPanelOptions = {},
  ) {}

  public show(results: QueryResult[]): void {
    this.lastPayload = toPayload(results, getResultPageSize());
    this.paginationVariables = getPaginationVariables(results);
    const viewColumn = this.panel?.viewColumn ?? getWebviewViewColumn();

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'sqlWorkbench.results',
        'SQL Results',
        viewColumn,
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
    this.panel.reveal(viewColumn, false);
    setTimeout(() => this.postResults(), 0);
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    if (message.type === 'ready') {
      this.postResults();
      return;
    }

    if (message.type === 'exportResult' && message.payload) {
      await this.exportResult(message.payload);
      return;
    }

    if (message.type !== 'requestPage' || !message.payload || !this.options.loadPage) {
      return;
    }

    try {
      const result = await this.options.loadPage({
        ...message.payload,
        variableValues: this.paginationVariables.get(message.payload.resultIndex),
      });
      const displayResult = toDisplayResult(result);

      if (this.lastPayload?.results[message.payload.resultIndex]) {
        this.lastPayload.results[message.payload.resultIndex] = displayResult;
      }
      if (result.pagination?.variableValues) {
        this.paginationVariables.set(message.payload.resultIndex, result.pagination.variableValues);
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

  private async exportResult(request: ExportRequest): Promise<void> {
    const result = this.lastPayload?.results[request.resultIndex];
    if (!result || result.error || result.columns.length === 0) {
      await vscode.window.showWarningMessage('There is no tabular result to export.');
      return;
    }

    try {
      if (request.scope === 'all' && result.pagination && result.pagination.totalRows > FULL_EXPORT_ROW_LIMIT) {
        await vscode.window.showWarningMessage(`Full export is limited to ${FULL_EXPORT_ROW_LIMIT.toLocaleString()} rows. Export the current page instead.`);
        return;
      }

      const exportResult = request.scope === 'all' && result.pagination && this.options.loadPage
        ? toDisplayResult(await this.options.loadPage({
          resultIndex: request.resultIndex,
          connectionId: result.connectionId ?? '',
          sql: result.pagination.sourceSql,
          variableValues: this.paginationVariables.get(request.resultIndex),
          page: 1,
          pageSize: result.pagination.totalRows,
          totalRows: result.pagination.totalRows,
        }))
        : result;
      const scopedResult = request.scope === 'page' && !result.pagination
        ? sliceDisplayResult(exportResult, request.page, request.pageSize)
        : exportResult;
      const content = toExportBuffer(scopedResult, request.format);
      const uri = await vscode.window.showSaveDialog({
        title: `Export ${request.format.toUpperCase()} Result`,
        defaultUri: getExportDefaultUri(`sql-workbench-result-${request.resultIndex + 1}.${request.format}`),
        filters: getExportFilters(request.format),
      });

      if (!uri) {
        return;
      }

      await vscode.workspace.fs.writeFile(uri, content);
      await vscode.window.showInformationMessage(`Exported ${scopedResult.values.length} rows to ${uri.fsPath}.`);
    } catch (error) {
      await vscode.window.showErrorMessage(`Export failed: ${getErrorMessage(error)}`);
    }
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

function getPaginationVariables(results: QueryResult[]): Map<number, Record<string, unknown>> {
  const values = new Map<number, Record<string, unknown>>();

  results.forEach((result, index) => {
    if (result.pagination?.variableValues) {
      values.set(index, result.pagination.variableValues);
    }
  });

  return values;
}

function toDisplayResult(result: QueryResult): DisplayResult {
  return {
    sql: result.sql,
    sqlHtml: highlightResultSql(result.sql),
    columns: result.columns,
    rows: result.rows.map((row) => row.map(formatValue)),
    values: result.rows.map((row) => row.map(toDisplayValue)),
    rowCount: result.rowCount,
    elapsedMs: result.elapsedMs,
    affectedRows: result.affectedRows,
    error: result.error,
    connectionId: result.connectionId,
    connectionName: result.connectionName,
    pagination: result.pagination ? {
      mode: result.pagination.mode,
      sourceSql: result.pagination.sourceSql,
      page: result.pagination.page,
      pageSize: result.pagination.pageSize,
      totalRows: result.pagination.totalRows,
    } : undefined,
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
    '    :root { color-scheme: light dark; --border: var(--vscode-panel-border, rgba(128, 128, 128, 0.35)); --muted: var(--vscode-descriptionForeground); --error: var(--vscode-errorForeground); --button-bg: var(--vscode-button-secondaryBackground, transparent); --button-fg: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); --code: var(--vscode-textCodeBlock-background, var(--vscode-editorWidget-background)); --sql-keyword: var(--vscode-symbolIcon-keywordForeground, #c586c0); --sql-type: var(--vscode-symbolIcon-classForeground, #4ec9b0); --sql-identifier: var(--vscode-symbolIcon-fieldForeground, #65b7f3); --sql-function: var(--vscode-symbolIcon-functionForeground, #dcdcaa); --sql-string: var(--vscode-debugTokenExpression-string, #8ec07c); --sql-number: var(--vscode-debugTokenExpression-number, #d19a66); --sql-comment: var(--vscode-editorLineNumber-foreground, #6a9955); --sql-operator: var(--vscode-symbolIcon-operatorForeground, var(--vscode-foreground)); }',
    '    body { margin: 0; padding: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }',
    '    body.vscode-light { --sql-keyword: #7a1f8a; --sql-type: #006b68; --sql-identifier: #005fb8; --sql-function: #7a4d00; --sql-string: #397300; --sql-number: #a04b00; --sql-comment: #527a2b; }',
    '    .toolbar, .pager, .result-actions { display: flex; align-items: center; gap: 10px; min-height: 38px; padding: 0 14px; border-bottom: 1px solid var(--border); background: var(--vscode-editor-background); white-space: nowrap; }',
    '    .toolbar { position: sticky; top: 0; z-index: 2; }',
    '    .title, .section-title { font-weight: 600; }',
    '    .meta, .range, .empty, .loading { color: var(--muted); }',
    '    .badge { margin-left: auto; padding: 2px 8px; border: 1px solid var(--border); border-radius: 999px; color: var(--muted); }',
    '    main { padding: 12px 14px 18px; }',
    '    section { margin-bottom: 16px; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: var(--vscode-editor-background); }',
    '    .section-header { display: flex; align-items: center; gap: 10px; min-height: 38px; padding: 0 12px; border-bottom: 1px solid var(--border); background: var(--vscode-sideBar-background); }',
    '    pre { margin: 0; padding: 9px 12px; overflow: auto; border-bottom: 1px solid var(--border); color: var(--muted); font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); line-height: 1.45; white-space: pre-wrap; }',
    '    .sql-preview { max-height: min(42vh, 360px); overflow: auto; color: var(--vscode-editor-foreground); background: var(--code); tab-size: 2; white-space: pre; }',
    '    .sql-keyword { color: var(--sql-keyword); font-weight: 600; }',
    '    .sql-type { color: var(--sql-type); }',
    '    .sql-identifier { color: var(--sql-identifier); }',
    '    .sql-function { color: var(--sql-function); }',
    '    .sql-string { color: var(--sql-string); }',
    '    .sql-number { color: var(--sql-number); }',
    '    .sql-comment { color: var(--sql-comment); }',
    '    .sql-operator { color: var(--sql-operator); }',
    '    .table-wrap { overflow: auto; max-height: 62vh; }',
    '    table { width: 100%; border-collapse: collapse; table-layout: auto; }',
    '    th, td { max-width: 420px; padding: 7px 10px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '    th { position: sticky; top: 0; background: var(--vscode-editorGroupHeader-tabsBackground); font-weight: 600; z-index: 1; }',
    '    th:last-child, td:last-child { border-right: none; }',
    '    .empty, .error, .loading { padding: 16px 12px; }',
    '    .error { color: var(--error); white-space: pre-wrap; }',
    '    .json-view { max-height: 62vh; overflow: auto; color: var(--vscode-editor-foreground); }',
    '    .cell-button { max-width: 420px; width: 100%; height: auto; min-height: 22px; padding: 0; border: 0; color: inherit; background: transparent; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '    .cell-button:hover { color: var(--vscode-textLink-foreground); text-decoration: underline; }',
    '    .modal-backdrop { position: fixed; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0, 0, 0, 0.48); }',
    '    .modal { width: min(920px, 100%); max-height: min(720px, 92vh); display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 6px; background: var(--vscode-editor-background); box-shadow: 0 12px 34px rgba(0,0,0,0.35); }',
    '    .modal-head, .modal-actions { display: flex; align-items: center; gap: 10px; min-height: 42px; padding: 0 12px; border-bottom: 1px solid var(--border); }',
    '    .modal-actions { justify-content: flex-end; border-top: 1px solid var(--border); border-bottom: 0; }',
    '    .modal-title { font-weight: 600; }',
    '    .modal-body { padding: 12px; overflow: auto; }',
    '    .cell-viewer { box-sizing: border-box; width: 100%; min-height: 360px; resize: vertical; padding: 10px; border: 1px solid var(--border); color: var(--vscode-input-foreground); background: var(--vscode-input-background); font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); line-height: 1.45; }',
    '    .modal-note { margin-right: auto; color: var(--muted); }',
    '    .export-options { display: grid; grid-template-columns: 92px 1fr; gap: 14px 12px; align-items: center; min-width: min(520px, 80vw); }',
    '    .export-choice-group { display: flex; flex-wrap: wrap; gap: 6px; }',
    '    .export-hint { grid-column: 2; color: var(--muted); }',
    '    button { min-width: 28px; height: 24px; border: 1px solid var(--border); border-radius: 4px; color: var(--button-fg); background: var(--button-bg); font: inherit; cursor: pointer; }',
    '    button.active { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border-color: var(--vscode-button-background); }',
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
    'const state = { payload: undefined, pages: [], loading: {}, modes: {}, modal: undefined, exportModal: undefined };',
    'window.addEventListener("message", (event) => { const data = event.data; if (!data) return; if (data.type === "results") { state.payload = data.payload; state.pages = state.payload.results.map((result) => result.pagination ? result.pagination.page : 1); state.loading = {}; render(); } else if (data.type === "pageResult") { state.payload.results[data.payload.resultIndex] = data.payload.result; state.pages[data.payload.resultIndex] = data.payload.result.pagination ? data.payload.result.pagination.page : 1; state.loading[data.payload.resultIndex] = false; renderResult(data.payload.resultIndex); renderToolbar(); } else if (data.type === "pageError") { state.loading[data.payload.resultIndex] = false; const body = document.querySelector("[data-body=\\"" + data.payload.resultIndex + "\\"]"); if (body) body.innerHTML = "<div class=\\"error\\">" + escapeHtml(data.payload.message) + "</div>"; } });',
    'document.addEventListener("click", (event) => { const button = event.target.closest("button[data-action]"); if (!button) return; const action = button.dataset.action; if (action === "modal-close") { closeCellModal(); return; } if (action === "modal-format") { formatCellModalJson(); return; } if (action === "modal-copy") { copyCellModalText(); return; } if (action === "export-close") { closeExportModal(); return; } if (action === "export-format") { if (state.exportModal) state.exportModal.format = button.dataset.format || "csv"; refreshExportModal(); return; } if (action === "export-scope") { if (state.exportModal && (button.dataset.scope !== "all" || state.exportModal.canExportAll)) state.exportModal.scope = button.dataset.scope || "page"; refreshExportModal(); return; } if (action === "export-confirm") { confirmExportModal(); return; } if (!state.payload) return; const index = Number(button.dataset.index); const result = state.payload.results[index]; if (action === "view-cell") { openCellModal(index, Number(button.dataset.row), Number(button.dataset.column)); return; } if (action === "export-open") { openExportModal(index); return; } if (action === "table" || action === "json") { state.modes[index] = action; renderResult(index); return; } const pageSize = result.pagination ? result.pagination.pageSize : state.payload.pageSize; const pageCount = getPageCount(result, pageSize); const current = state.pages[index] || 1; const next = action === "prev" ? Math.max(1, current - 1) : Math.min(pageCount, current + 1); if (next === current) return; if (result.pagination && result.connectionId) { requestServerPage(index, result, next); } else { state.pages[index] = next; renderResult(index); } });',
    'document.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeCellModal(); closeExportModal(); } });',
    'function requestServerPage(index, result, page) { state.loading[index] = true; state.pages[index] = page; renderResult(index); vscode.postMessage({ type: "requestPage", payload: { resultIndex: index, connectionId: result.connectionId, sql: result.pagination.sourceSql, page, pageSize: result.pagination.pageSize, totalRows: result.pagination.totalRows } }); }',
    'function render() { renderToolbar(); const root = document.getElementById("results"); root.innerHTML = state.payload.results.map((_, index) => sectionShell(index)).join(""); state.payload.results.forEach((_, index) => renderResult(index)); }',
    'function renderToolbar() { const payload = state.payload; document.getElementById("toolbar").innerHTML = "<span class=\\"title\\">" + escapeHtml(payload.connectionName) + "</span><span class=\\"meta\\">" + payload.resultCount + " result" + (payload.resultCount === 1 ? "" : "s") + " · Total " + payload.totalRows + " · 耗时: " + formatElapsed(payload.elapsedMs) + (payload.hasError ? " · error" : "") + "</span><span class=\\"badge\\">Page size " + payload.pageSize + "</span>"; }',
    'function sectionShell(index) { return "<section data-result=\\"" + index + "\\"><div class=\\"section-header\\" data-header=\\"" + index + "\\"></div><pre class=\\"sql-preview\\" data-sql=\\"" + index + "\\"></pre><div data-body=\\"" + index + "\\"></div></section>"; }',
    'function renderResult(index) { const result = state.payload.results[index]; const pageSize = result.pagination ? result.pagination.pageSize : state.payload.pageSize; const page = state.pages[index] || 1; const pageCount = getPageCount(result, pageSize); const start = result.rowCount === 0 ? 0 : (page - 1) * pageSize + 1; const end = Math.min(result.rowCount, page * pageSize); const affected = result.affectedRows === undefined ? "" : " · " + result.affectedRows + " affected"; document.querySelector("[data-header=\\"" + index + "\\"]").innerHTML = "<span class=\\"section-title\\">Result " + (index + 1) + "</span><span class=\\"meta\\">" + start + "-" + end + " / Total " + result.rowCount + " · 耗时: " + formatElapsed(result.elapsedMs) + affected + "</span>"; document.querySelector("[data-sql=\\"" + index + "\\"]").innerHTML = result.sqlHtml; const body = document.querySelector("[data-body=\\"" + index + "\\"]"); if (state.loading[index]) { body.innerHTML = renderPager(index, page, pageCount, start, end, result.rowCount) + "<div class=\\"loading\\">Loading page " + page + "...</div>"; return; } if (result.error) { body.innerHTML = "<div class=\\"error\\">" + escapeHtml(result.error) + "</div>"; return; } if (result.columns.length === 0) { body.innerHTML = "<div class=\\"empty\\">Statement executed. No rows returned.</div>"; return; } const rows = result.pagination ? result.rows : result.rows.slice((page - 1) * pageSize, page * pageSize); const values = result.pagination ? result.values : result.values.slice((page - 1) * pageSize, page * pageSize); body.innerHTML = renderPager(index, page, pageCount, start, end, result.rowCount) + renderActions(index, result) + (state.modes[index] === "json" ? renderJson(result, values) : renderTable(index, result, rows, values)); }',
    'function renderActions(index, result) { const mode = state.modes[index] || "table"; return "<div class=\\"result-actions\\"><button data-action=\\"table\\" data-index=\\"" + index + "\\" class=\\"" + (mode === "table" ? "active" : "") + "\\">Table</button><button data-action=\\"json\\" data-index=\\"" + index + "\\" class=\\"" + (mode === "json" ? "active" : "") + "\\">JSON</button><button data-action=\\"export-open\\" data-index=\\"" + index + "\\" title=\\"Export result\\">⇩ 导出</button></div>"; }',
    'function renderTable(resultIndex, result, rows, values) { return "<div class=\\"table-wrap\\"><table><thead><tr>" + result.columns.map((column) => "<th title=\\"" + escapeAttribute(column.name) + "\\">" + escapeHtml(column.name) + "</th>").join("") + "</tr></thead><tbody>" + rows.map((row, rowIndex) => "<tr>" + row.map((cell, columnIndex) => renderCell(resultIndex, rowIndex, columnIndex, cell, values[rowIndex] ? values[rowIndex][columnIndex] : cell)).join("") + "</tr>").join("") + "</tbody></table></div>"; }',
    'function renderCell(resultIndex, rowIndex, columnIndex, cell) { const result = state.payload.results[resultIndex]; const title = escapeAttribute(cell); if (!isJsonColumn(result.columns[columnIndex])) return "<td title=\\"" + title + "\\">" + escapeHtml(cell) + "</td>"; return "<td title=\\"" + title + "\\"><button class=\\"cell-button\\" data-action=\\"view-cell\\" data-index=\\"" + resultIndex + "\\" data-row=\\"" + rowIndex + "\\" data-column=\\"" + columnIndex + "\\" title=\\"View JSON value\\">" + escapeHtml(cell) + "</button></td>"; }',
    'function isJsonColumn(column) { const type = String(column && column.type !== undefined ? column.type : "").trim().toLowerCase(); return type === "json" || type === "jsonb" || type === "json[]" || type === "jsonb[]" || type === "245" || type === "114" || type === "199" || type === "3802" || type === "3807"; }',
    'function openCellModal(resultIndex, rowIndex, columnIndex) { closeCellModal(); const result = state.payload.results[resultIndex]; if (!isJsonColumn(result.columns[columnIndex])) return; const pageSize = result.pagination ? result.pagination.pageSize : state.payload.pageSize; const page = state.pages[resultIndex] || 1; const pageOffset = result.pagination ? 0 : (page - 1) * pageSize; const absoluteRowIndex = pageOffset + rowIndex; const valueRow = result.values[absoluteRowIndex] || result.values[rowIndex] || []; const displayRow = result.rows[absoluteRowIndex] || result.rows[rowIndex] || []; const raw = formatModalValue(valueRow[columnIndex], displayRow[columnIndex]); state.modal = { resultIndex, rowIndex, columnIndex }; document.body.insertAdjacentHTML("beforeend", renderCellModal(resultIndex, rowIndex, result.columns[columnIndex].name, raw)); }',
    'function renderCellModal(resultIndex, rowIndex, columnName, value) { return "<div class=\\"modal-backdrop\\" id=\\"cell-modal\\"><div class=\\"modal\\"><div class=\\"modal-head\\"><span class=\\"modal-title\\">View Cell Value</span><span class=\\"meta\\">Result " + (resultIndex + 1) + " · row " + (rowIndex + 1) + " · column " + escapeHtml(columnName) + "</span></div><div class=\\"modal-body\\"><textarea id=\\"cell-viewer\\" class=\\"cell-viewer\\" spellcheck=\\"false\\" readonly>" + escapeHtml(value) + "</textarea></div><div class=\\"modal-actions\\"><span class=\\"modal-note\\">Read-only JSON. Use SQL to modify data.</span><button data-action=\\"modal-format\\">Format</button><button data-action=\\"modal-copy\\">Copy</button><button data-action=\\"modal-close\\">Close</button></div></div></div>"; }',
    'function closeCellModal() { const modal = document.getElementById("cell-modal"); if (modal) modal.remove(); state.modal = undefined; }',
    'function openExportModal(resultIndex) { closeExportModal(); const result = state.payload.results[resultIndex]; const pageSize = result.pagination ? result.pagination.pageSize : state.payload.pageSize; const canExportAll = !result.pagination || result.pagination.totalRows <= 50000; state.exportModal = { resultIndex, format: "csv", scope: "page", page: state.pages[resultIndex] || 1, pageSize, canExportAll }; document.body.insertAdjacentHTML("beforeend", renderExportModal()); }',
    'function closeExportModal() { const modal = document.getElementById("export-modal"); if (modal) modal.remove(); state.exportModal = undefined; }',
    'function refreshExportModal() { const modal = document.getElementById("export-modal"); if (!modal || !state.exportModal) return; const current = state.exportModal; const html = renderExportModal(); modal.remove(); state.exportModal = current; document.body.insertAdjacentHTML("beforeend", html); }',
    'function renderExportModal() { const current = state.exportModal; const formats = ["csv", "json", "xlsx"]; const formatButtons = formats.map((format) => "<button data-action=\\"export-format\\" data-format=\\"" + format + "\\" class=\\"" + (current.format === format ? "active" : "") + "\\">" + format.toUpperCase() + "</button>").join(""); const allDisabled = current.canExportAll ? "" : " disabled title=\\"Full export is capped at 50,000 rows.\\""; const hint = current.canExportAll ? "" : "<div class=\\"export-hint\\">数据量过大时暂不支持导出全部，请导出当前页。</div>"; return "<div class=\\"modal-backdrop\\" id=\\"export-modal\\"><div class=\\"modal\\"><div class=\\"modal-head\\"><span class=\\"modal-title\\">导出选项</span></div><div class=\\"modal-body\\"><div class=\\"export-options\\"><span class=\\"meta\\">类型</span><div class=\\"export-choice-group\\">" + formatButtons + "</div><span class=\\"meta\\">范围</span><div class=\\"export-choice-group\\"><button data-action=\\"export-scope\\" data-scope=\\"page\\" class=\\"" + (current.scope === "page" ? "active" : "") + "\\">当前页</button><button data-action=\\"export-scope\\" data-scope=\\"all\\" class=\\"" + (current.scope === "all" ? "active" : "") + "\\"" + allDisabled + ">全部数据</button></div>" + hint + "</div></div><div class=\\"modal-actions\\"><button data-action=\\"export-close\\">关闭</button><button data-action=\\"export-confirm\\">导出</button></div></div></div>"; }',
    'function confirmExportModal() { const current = state.exportModal; if (!current) return; if (current.scope === "all" && !current.canExportAll) { current.scope = "page"; refreshExportModal(); return; } vscode.postMessage({ type: "exportResult", payload: { resultIndex: current.resultIndex, format: current.format, scope: current.scope, page: current.page, pageSize: current.pageSize } }); closeExportModal(); }',
    'function formatCellModalJson() { const viewer = document.getElementById("cell-viewer"); if (!viewer) return; try { viewer.value = JSON.stringify(JSON.parse(viewer.value), null, 2); } catch { viewer.focus(); } }',
    'function copyCellModalText() { const viewer = document.getElementById("cell-viewer"); if (!viewer) return; viewer.select(); document.execCommand("copy"); }',
    'function formatModalValue(value, fallback) { if (value && typeof value === "object" && value.type === "blob") return "<BLOB " + value.bytes + " bytes>"; if (value === null) return "NULL"; if (typeof value === "string") return value; if (typeof value === "object") return JSON.stringify(value, null, 2); return fallback !== undefined ? String(fallback) : String(value); }',
    'function renderJson(result, values) { return "<pre class=\\"json-view\\">" + escapeHtml(JSON.stringify(toObjects(result, values), null, 2)) + "</pre>"; }',
    'function toObjects(result, values) { return values.map((row) => Object.fromEntries(result.columns.map((column, columnIndex) => [column.name, row[columnIndex]]))); }',
    'function renderPager(index, page, pageCount, start, end, total) { return "<div class=\\"pager\\"><button data-action=\\"prev\\" data-index=\\"" + index + "\\" " + (page <= 1 ? "disabled" : "") + ">&lt;</button><span class=\\"page-number\\">" + page + " / " + pageCount + "</span><button data-action=\\"next\\" data-index=\\"" + index + "\\" " + (page >= pageCount ? "disabled" : "") + ">&gt;</button><span class=\\"range\\">" + start + "-" + end + " / Total " + total + "</span></div>"; }',
    'function getPageCount(result, pageSize) { return Math.max(1, Math.ceil(result.rowCount / pageSize)); }',
    'function formatElapsed(elapsedMs) { return elapsedMs < 1000 ? (Math.round(elapsedMs * 100) / 100) + " ms" : (Math.round((elapsedMs / 1000) * 100) / 100) + " s"; }',
    'function escapeHtml(value) { return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\\\'/g, "&#39;"); }',
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

function toDisplayValue(value: QueryValue): DisplayValue {
  if (value instanceof Uint8Array) {
    return { type: 'blob', bytes: value.byteLength };
  }

  return value;
}

function sliceDisplayResult(result: DisplayResult, page: number, pageSize: number): DisplayResult {
  const start = Math.max(0, page - 1) * pageSize;
  const end = start + pageSize;

  return {
    ...result,
    rows: result.rows.slice(start, end),
    values: result.values.slice(start, end),
  };
}

function toCsv(result: DisplayResult): string {
  const lines = [
    result.columns.map((column) => escapeCsv(column.name)).join(','),
    ...result.values.map((row) => row.map((value) => escapeCsv(formatExportValue(value))).join(',')),
  ];

  return lines.join('\n') + '\n';
}

function toJson(result: DisplayResult): string {
  return JSON.stringify(toObjectRows(result), null, 2) + '\n';
}

function toExportBuffer(result: DisplayResult, format: ExportRequest['format']): Buffer {
  if (format === 'csv') {
    return Buffer.from(toCsv(result), 'utf8');
  }

  if (format === 'json') {
    return Buffer.from(toJson(result), 'utf8');
  }

  return toXlsx(result);
}

function getExportFilters(format: ExportRequest['format']): Record<string, string[]> {
  if (format === 'csv') {
    return { CSV: ['csv'] };
  }

  if (format === 'json') {
    return { JSON: ['json'] };
  }

  return { XLSX: ['xlsx'] };
}

function getExportDefaultUri(fileName: string): vscode.Uri | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder ? vscode.Uri.joinPath(folder.uri, fileName) : undefined;
}

function toObjectRows(result: DisplayResult): Array<Record<string, DisplayValue>> {
  return result.values.map((row) => Object.fromEntries(
    result.columns.map((column, columnIndex) => [column.name, row[columnIndex] ?? null]),
  ));
}

function formatExportValue(value: DisplayValue): string {
  if (value === null) {
    return '';
  }

  const text = typeof value === 'object'
    ? `<BLOB ${value.bytes} bytes>`
    : String(value);

  return /^[=+\-@]/u.test(text) ? `'${text}` : text;
}

function escapeCsv(value: string): string {
  return /[",\n\r]/u.test(value)
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

function toXlsx(result: DisplayResult): Buffer {
  return zipFiles({
    '[Content_Types].xml': [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
      '</Types>',
    ].join(''),
    '_rels/.rels': [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
      '</Relationships>',
    ].join(''),
    'xl/workbook.xml': [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
      '<sheets><sheet name="Result" sheetId="1" r:id="rId1"/></sheets>',
      '</workbook>',
    ].join(''),
    'xl/_rels/workbook.xml.rels': [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>',
      '</Relationships>',
    ].join(''),
    'xl/worksheets/sheet1.xml': toWorksheetXml(result),
  });
}

function toWorksheetXml(result: DisplayResult): string {
  const rows = [
    result.columns.map((column) => column.name),
    ...result.values,
  ];
  const sheetRows = rows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 1;
    const cells = row.map((value, columnIndex) => toWorksheetCell(value, columnName(columnIndex), rowNumber)).join('');
    return `<row r="${rowNumber}">${cells}</row>`;
  }).join('');

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    `<sheetData>${sheetRows}</sheetData>`,
    '</worksheet>',
  ].join('');
}

function toWorksheetCell(value: DisplayValue | string, column: string, row: number): string {
  const ref = `${column}${row}`;
  if (value === null || value === undefined) {
    return `<c r="${ref}"/>`;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }

  if (typeof value === 'boolean') {
    return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }

  const text = typeof value === 'object'
    ? `<BLOB ${value.bytes} bytes>`
    : String(value);
  return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(text)}</t></is></c>`;
}

function columnName(index: number): string {
  let value = '';
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    value = String.fromCharCode(65 + remainder) + value;
    current = Math.floor((current - 1) / 26);
  }
  return value;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;');
}

function zipFiles(files: Record<string, string | Buffer>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const crc = crc32(data);
    const localHeader = Buffer.alloc(30);

    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBytes, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBytes);

    offset += localHeader.length + nameBytes.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

const CRC32_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
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

const RESULT_SQL_KEYWORDS = new Set([
  'ACTION', 'ADD', 'ALL', 'ALTER', 'ALWAYS', 'AND', 'AS', 'ASC', 'AUTO_INCREMENT',
  'BETWEEN', 'BY', 'CASE', 'CASCADE', 'CHARSET', 'CHECK', 'COLLATE', 'COMMENT',
  'CONSTRAINT', 'CREATE', 'CROSS', 'DEFAULT', 'DEFERRABLE', 'DELETE', 'DESC', 'DESCRIBE',
  'DISTINCT', 'DISTRIBUTED', 'DROP', 'ELSE', 'END', 'ENGINE', 'EXISTS', 'EXPLAIN', 'FALSE',
  'FOREIGN', 'FROM', 'FULL', 'GENERATED', 'GROUP', 'HASH', 'HAVING', 'IDENTITY', 'IF',
  'IN', 'INCLUDE', 'INDEX', 'INITIALLY', 'INNER', 'INSERT', 'INTO', 'IS', 'JOIN', 'KEY',
  'LEFT', 'LIKE', 'LIMIT', 'MATCH', 'NO', 'NOT', 'NULL', 'OFFSET', 'ON', 'ONLY', 'OR',
  'ORDER', 'OUTER', 'PARTITION', 'PRIMARY', 'REFERENCES', 'RESTRICT', 'RIGHT', 'SELECT',
  'SET', 'SHOW', 'STORED', 'TABLE', 'TEMP', 'TEMPORARY', 'THEN', 'TRUE', 'UNION', 'UNIQUE',
  'UPDATE', 'USING', 'VALUES', 'VIRTUAL', 'WHEN', 'WHERE', 'WITH',
]);

const RESULT_SQL_FUNCTIONS = new Set([
  'AVG', 'CAST', 'COALESCE', 'CONCAT', 'COUNT', 'CURRENT_DATE', 'CURRENT_TIMESTAMP',
  'DATE_ADD', 'DATE_FORMAT', 'DATE_SUB', 'EXTRACT', 'IFNULL', 'LOWER', 'MAX', 'MIN', 'NOW',
  'NULLIF', 'SUM', 'UPPER',
]);

const RESULT_SQL_TYPES = new Set([
  'ARRAY', 'BIGINT', 'BIGSERIAL', 'BINARY', 'BIT', 'BLOB', 'BOOL', 'BOOLEAN', 'BYTEA',
  'CHAR', 'CHARACTER', 'CLOB', 'DATE', 'DATETIME', 'DEC', 'DECIMAL', 'DOUBLE', 'ENUM',
  'FLOAT', 'GEOMETRY', 'INT', 'INTEGER', 'INTERVAL', 'JSON', 'JSONB', 'MEDIUMINT', 'MONEY',
  'NCHAR', 'NUMERIC', 'NVARCHAR', 'REAL', 'SERIAL', 'SET', 'SMALLINT', 'SMALLSERIAL',
  'TEXT', 'TIME', 'TIMESTAMP', 'TINYINT', 'UUID', 'VARBINARY', 'VARCHAR', 'VARBIT', 'XML',
]);

function highlightResultSql(sql: string): string {
  let html = '';
  let index = 0;

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];

    if ((char === '-' && next === '-') || char === '#') {
      const end = sql.indexOf('\n', index);
      const token = sql.slice(index, end === -1 ? sql.length : end);
      html += wrapSqlToken('comment', token);
      index += token.length;
      continue;
    }

    if (char === '/' && next === '*') {
      const close = sql.indexOf('*/', index + 2);
      const end = close === -1 ? sql.length : close + 2;
      html += wrapSqlToken('comment', sql.slice(index, end));
      index = end;
      continue;
    }

    const dollarTag = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u)?.[0];
    if (dollarTag) {
      const closingIndex = sql.indexOf(dollarTag, index + dollarTag.length);
      const end = closingIndex === -1 ? sql.length : closingIndex + dollarTag.length;
      html += wrapSqlToken('string', sql.slice(index, end));
      index = end;
      continue;
    }

    if (char === '\'' || char === '"') {
      const end = findQuotedSqlTokenEnd(sql, index, char);
      html += wrapSqlToken(char === '\'' ? 'string' : 'identifier', sql.slice(index, end));
      index = end;
      continue;
    }

    if (char === '`' || char === '[') {
      const closing = char === '`' ? '`' : ']';
      const end = findQuotedSqlTokenEnd(sql, index, closing);
      html += wrapSqlToken('identifier', sql.slice(index, end));
      index = end;
      continue;
    }

    const number = sql.slice(index).match(/^(?:0x[\da-f]+|0b[01]+|\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/iu)?.[0];
    if (number) {
      html += wrapSqlToken('number', number);
      index += number.length;
      continue;
    }

    const word = sql.slice(index).match(/^[A-Za-z_][A-Za-z0-9_$]*/u)?.[0];
    if (word) {
      const upper = word.toUpperCase();
      const kind = RESULT_SQL_KEYWORDS.has(upper)
        ? 'keyword'
        : RESULT_SQL_FUNCTIONS.has(upper) ? 'function'
          : RESULT_SQL_TYPES.has(upper) ? 'type' : 'identifier';
      html += wrapSqlToken(kind, word);
      index += word.length;
      continue;
    }

    if ('=<>!+-*/%|&^~'.includes(char)) {
      html += wrapSqlToken('operator', char);
    } else {
      html += escapeSqlHtml(char);
    }
    index += 1;
  }

  return html;
}

function findQuotedSqlTokenEnd(sql: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === '\\') {
      index += 2;
      continue;
    }
    if (sql[index] === quote) {
      if (quote !== ']' && sql[index + 1] === quote) {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  return sql.length;
}

function wrapSqlToken(kind: 'comment' | 'function' | 'identifier' | 'keyword' | 'number' | 'operator' | 'plain' | 'string' | 'type', token: string): string {
  const escaped = escapeSqlHtml(token);
  return kind === 'plain' ? escaped : `<span class="sql-${kind}">${escaped}</span>`;
}

function escapeSqlHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

export const __resultViewPanelTestHooks = {
  toDisplayResult,
  sliceDisplayResult,
  toCsv,
  toJson,
  toExportBuffer,
  getExportDefaultUri,
  getClientScript,
  highlightResultSql,
};
