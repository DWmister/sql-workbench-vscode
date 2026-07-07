import * as vscode from 'vscode';
import type { ConnectionConfig } from './types';
import {
  type ConnectionTestResult,
  type DraftConnectionConfig,
} from './connectionTester';

interface ConnectionFormCallbacks {
  save(input: DraftConnectionConfig): Promise<ConnectionConfig>;
  test(input: DraftConnectionConfig): Promise<ConnectionTestResult>;
  onSaved(connection: ConnectionConfig): Promise<void>;
}

type FormMessage =
  | { type: 'save'; payload: DraftConnectionConfig }
  | { type: 'test'; payload: DraftConnectionConfig }
  | { type: 'close' };

export class ConnectionFormPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private messageSubscription: vscode.Disposable | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly callbacks: ConnectionFormCallbacks,
  ) {}

  public show(): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'sqlWorkbench.connectionForm',
        'Add Connection',
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          localResourceRoots: [this.extensionUri],
        },
      );

      this.messageSubscription = this.panel.webview.onDidReceiveMessage((message: FormMessage) => {
        void this.handleMessage(message);
      });
      this.panel.onDidDispose(() => {
        this.messageSubscription?.dispose();
        this.messageSubscription = undefined;
        this.panel = undefined;
      });
    }

    this.panel.webview.html = renderConnectionFormHtml(this.panel.webview);
    this.panel.reveal(vscode.ViewColumn.Beside, false);
  }

  public dispose(): void {
    this.messageSubscription?.dispose();
    this.panel?.dispose();
  }

  private async handleMessage(message: FormMessage): Promise<void> {
    if (message.type === 'close') {
      this.panel?.dispose();
      return;
    }

    if (message.type === 'test') {
      const validation = validateDraftConnection(message.payload);
      if (validation) {
        this.postStatus({ ok: false, message: validation });
        return;
      }

      this.postStatus({ ok: undefined, message: 'Testing connection...' });
      this.postStatus(await this.callbacks.test(cleanDraft(message.payload)));
      return;
    }

    if (message.type === 'save') {
      const validation = validateDraftConnection(message.payload);
      if (validation) {
        this.postStatus({ ok: false, message: validation });
        return;
      }

      try {
        this.postStatus({ ok: undefined, message: 'Saving connection...' });
        const created = await this.callbacks.save(cleanDraft(message.payload));
        await this.callbacks.onSaved(created);
        this.postStatus({ ok: true, message: `Saved ${created.name}.` });
        this.panel?.dispose();
      } catch (error) {
        this.postStatus({ ok: false, message: getErrorMessage(error) });
      }
    }
  }

  private postStatus(status: { ok: boolean | undefined; message: string }): void {
    void this.panel?.webview.postMessage({
      type: 'status',
      payload: status,
    });
  }
}

function validateDraftConnection(input: DraftConnectionConfig): string | undefined {
  if (!input.name?.trim()) {
    return 'Connection name is required.';
  }

  if (input.type === 'sqlite') {
    return input.path?.trim() ? undefined : 'SQLite database file path is required.';
  }

  if (!input.host?.trim()) {
    return 'Host is required.';
  }

  if (!input.port || !Number.isInteger(Number(input.port))) {
    return 'Port must be an integer.';
  }

  if (!input.database?.trim()) {
    return 'Database is required.';
  }

  if (!input.username?.trim()) {
    return 'Username is required.';
  }

  return undefined;
}

function cleanDraft(input: DraftConnectionConfig): DraftConnectionConfig {
  return {
    name: input.name.trim(),
    group: input.group?.trim() || 'Default',
    type: input.type,
    host: normalizeOptional(input.host),
    port: input.port === undefined ? undefined : Number(input.port),
    database: normalizeOptional(input.database),
    username: normalizeOptional(input.username),
    password: input.password,
    path: normalizeOptional(input.path),
  };
}

function normalizeOptional(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function renderConnectionFormHtml(webview: vscode.Webview): string {
  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}' ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <title>Add Connection</title>
  <style nonce="${nonce}">
    :root {
      color-scheme: light dark;
      --border: var(--vscode-panel-border, rgba(128, 128, 128, 0.32));
      --muted: var(--vscode-descriptionForeground);
      --field: var(--vscode-input-background);
      --field-border: var(--vscode-input-border, transparent);
      --button: var(--vscode-button-background);
      --button-text: var(--vscode-button-foreground);
      --danger: var(--vscode-errorForeground);
      --ok: var(--vscode-testing-iconPassed, #73c991);
    }
    body {
      margin: 0;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    main {
      max-width: 980px;
      padding: 28px 34px 36px;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 26px;
    }
    .logo {
      position: relative;
      width: 48px;
      height: 42px;
      flex: none;
    }
    .logo span {
      position: absolute;
      width: 28px;
      height: 34px;
      border-radius: 9px 9px 6px 6px;
      opacity: 0.92;
    }
    .logo .a { left: 0; top: 8px; background: #f97316; }
    .logo .b { left: 10px; top: 2px; background: #facc15; }
    .logo .c { left: 20px; top: 0; background: #3b82f6; }
    h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 650;
      letter-spacing: 0;
    }
    .top-grid,
    .form-grid {
      display: grid;
      grid-template-columns: 130px minmax(220px, 1fr) 130px minmax(220px, 1fr);
      gap: 14px 18px;
      align-items: center;
    }
    .section {
      margin-top: 22px;
      padding-top: 18px;
      border-top: 1px solid var(--border);
    }
    .section-title {
      margin-bottom: 12px;
      color: var(--muted);
      font-weight: 600;
    }
    label {
      color: var(--muted);
      white-space: nowrap;
    }
    label.required::before {
      content: '*';
      margin-right: 5px;
      color: var(--danger);
    }
    input,
    select {
      width: 100%;
      box-sizing: border-box;
      height: 32px;
      padding: 5px 9px;
      border: 1px solid var(--field-border);
      border-radius: 4px;
      color: var(--vscode-input-foreground);
      background: var(--field);
      font-family: inherit;
    }
    .service-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 7px 14px;
    }
    .service-tabs button {
      height: 28px;
      padding: 0 4px;
      border: 0;
      border-bottom: 2px solid transparent;
      color: var(--muted);
      background: transparent;
      font: inherit;
      cursor: pointer;
    }
    .service-tabs button.active {
      color: var(--vscode-foreground);
      border-bottom-color: var(--vscode-focusBorder);
    }
    .wide {
      grid-column: span 3;
    }
    .sqlite-only {
      display: none;
    }
    body[data-db-type="sqlite"] .server-only {
      display: none;
    }
    body[data-db-type="sqlite"] .sqlite-only {
      display: block;
    }
    .actions {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin-top: 28px;
    }
    button.action {
      min-width: 78px;
      height: 32px;
      padding: 0 12px;
      border: 0;
      border-radius: 4px;
      color: var(--button-text);
      background: var(--button);
      cursor: pointer;
      font: inherit;
    }
    button.secondary {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }
    .status {
      min-height: 22px;
      margin-top: 14px;
      text-align: center;
      color: var(--muted);
    }
    .status.ok {
      color: var(--ok);
    }
    .status.error {
      color: var(--danger);
    }
    @media (max-width: 760px) {
      main {
        padding: 22px 18px 30px;
      }
      .top-grid,
      .form-grid {
        grid-template-columns: 1fr;
      }
      .wide {
        grid-column: auto;
      }
    }
  </style>
</head>
<body data-db-type="mysql">
  <main>
    <div class="header">
      <div class="logo" aria-hidden="true"><span class="a"></span><span class="b"></span><span class="c"></span></div>
      <h1>连接至服务</h1>
    </div>

    <div class="top-grid">
      <label class="required" for="name">名称</label>
      <input id="name" autocomplete="off" placeholder="连接名称">
      <label class="required" for="group">分组</label>
      <input id="group" autocomplete="off" value="Default">
    </div>

    <div class="section">
      <div class="section-title">服务类型</div>
      <div class="service-tabs" role="tablist">
        <button type="button" class="active" data-type="mysql">MySQL / MariaDB</button>
        <button type="button" data-type="postgresql">PostgreSQL</button>
        <button type="button" data-type="sqlite">SQLite</button>
      </div>
    </div>

    <div class="section">
      <div class="section-title">配置</div>
      <div class="form-grid">
        <label class="required server-only" for="host">主机名</label>
        <input class="server-only" id="host" autocomplete="off" value="127.0.0.1">
        <label class="required server-only" for="port">端口</label>
        <input class="server-only" id="port" inputmode="numeric" value="3306">

        <label class="required server-only" for="username">用户名</label>
        <input class="server-only" id="username" autocomplete="off" value="root">
        <label class="server-only" for="password">密码</label>
        <input class="server-only" id="password" type="password" autocomplete="off" placeholder="密码">

        <label class="required server-only" for="database">数据库</label>
        <input class="server-only wide" id="database" autocomplete="off" placeholder="目标数据库">

        <label class="required sqlite-only" for="path">数据库文件</label>
        <input class="sqlite-only wide" id="path" autocomplete="off" placeholder="/path/to/database.sqlite">
      </div>
    </div>

    <div class="actions">
      <button class="action secondary" type="button" id="test">测试连接</button>
      <button class="action" type="button" id="save">保存</button>
      <button class="action secondary" type="button" id="close">关闭</button>
    </div>
    <div id="status" class="status" role="status"></div>
  </main>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const buttons = Array.from(document.querySelectorAll('[data-type]'));
    const status = document.getElementById('status');

    buttons.forEach((button) => {
      button.addEventListener('click', () => setType(button.dataset.type));
    });

    document.getElementById('test').addEventListener('click', () => {
      setStatus('Testing connection...', '');
      vscode.postMessage({ type: 'test', payload: readForm() });
    });
    document.getElementById('save').addEventListener('click', () => {
      setStatus('Saving connection...', '');
      vscode.postMessage({ type: 'save', payload: readForm() });
    });
    document.getElementById('close').addEventListener('click', () => {
      vscode.postMessage({ type: 'close' });
    });

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type !== 'status') {
        return;
      }
      const payload = message.payload;
      setStatus(payload.message, payload.ok === true ? 'ok' : payload.ok === false ? 'error' : '');
    });

    function setType(type) {
      document.body.dataset.dbType = type;
      buttons.forEach((button) => button.classList.toggle('active', button.dataset.type === type));
      document.getElementById('port').value = type === 'postgresql' ? '5432' : '3306';
      setStatus('', '');
    }

    function readForm() {
      const type = document.body.dataset.dbType;
      return {
        type,
        name: value('name'),
        group: value('group'),
        host: value('host'),
        port: Number(value('port')),
        username: value('username'),
        password: value('password'),
        database: value('database'),
        path: value('path')
      };
    }

    function value(id) {
      return document.getElementById(id).value;
    }

    function setStatus(text, state) {
      status.textContent = text;
      status.className = 'status' + (state ? ' ' + state : '');
    }
  </script>
</body>
</html>`;
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
