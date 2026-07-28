import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { getWebviewViewColumn } from '../editor/webviewColumn';
import type { AiConfigurationStore, AiConfigurationValues } from './configurationStore';
import { MAX_AI_EXPLAIN_INSTRUCTIONS_LENGTH } from './ids';
import { getSafeErrorMessage } from './modelErrors';

interface AiConfigurationSavePayload {
  baseUrl: string;
  model: string;
  explainInstructions: string;
  apiKey?: string;
  removeApiKey: boolean;
}

type AiConfigurationMessage =
  | { type: 'save'; payload: AiConfigurationSavePayload }
  | { type: 'close' };

type AiConfigurationDecodeResult =
  | { ok: true; message: AiConfigurationMessage }
  | { ok: false; error: string };

export class AiConfigurationPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private messageSubscription: vscode.Disposable | undefined;
  private closed: Promise<void> | undefined;
  private resolveClosed: (() => void) | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: AiConfigurationStore,
  ) {}

  public async show(): Promise<void> {
    const values = await this.store.getValues();
    const viewColumn = this.panel?.viewColumn ?? getWebviewViewColumn();

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'sqlWorkbench.aiConfiguration',
        'Configure Agent Chat',
        viewColumn,
        {
          enableScripts: true,
          localResourceRoots: [this.extensionUri],
        },
      );
      this.closed = new Promise<void>((resolve) => {
        this.resolveClosed = resolve;
      });
      this.messageSubscription = this.panel.webview.onDidReceiveMessage((input: unknown) => {
        void this.handleUnknownMessage(input);
      });
      this.panel.onDidDispose(() => {
        this.messageSubscription?.dispose();
        this.messageSubscription = undefined;
        this.panel = undefined;
        const resolve = this.resolveClosed;
        this.closed = undefined;
        this.resolveClosed = undefined;
        resolve?.();
      });
    }

    this.panel.webview.html = renderAiConfigurationHtml(this.panel.webview, values);
    this.panel.reveal(viewColumn, false);
    await this.closed;
  }

  public dispose(): void {
    this.messageSubscription?.dispose();
    this.panel?.dispose();
  }

  private async handleUnknownMessage(input: unknown): Promise<void> {
    const decoded = decodeAiConfigurationMessage(input);
    if (!decoded.ok) {
      this.postStatus(false, decoded.error);
      return;
    }

    if (decoded.message.type === 'close') {
      this.panel?.dispose();
      return;
    }

    const { payload } = decoded.message;
    try {
      this.postStatus(undefined, 'Saving model configuration…');
      const apiKey = resolveSubmittedApiKey(
        payload,
        await this.store.getApiKey(),
      );
      await this.store.save({
        baseUrl: payload.baseUrl,
        model: payload.model,
        explainInstructions: payload.explainInstructions,
        apiKey,
      });
      await vscode.window.showInformationMessage('SQL Workbench Agent Chat configuration saved.');
      this.panel?.dispose();
    } catch (error) {
      this.postStatus(false, getSafeErrorMessage(error));
    }
  }

  private postStatus(ok: boolean | undefined, message: string): void {
    void this.panel?.webview.postMessage({
      type: 'status',
      payload: { ok, message },
    });
  }
}

function decodeAiConfigurationMessage(input: unknown): AiConfigurationDecodeResult {
  if (!isRecord(input) || typeof input.type !== 'string') {
    return invalid('Invalid Agent Chat configuration message.');
  }

  if (input.type === 'close') {
    return hasExactKeys(input, ['type'])
      ? { ok: true, message: { type: 'close' } }
      : invalid('Unexpected close fields.');
  }

  if (
    input.type !== 'save'
    || !hasExactKeys(input, ['type', 'payload'])
    || !isRecord(input.payload)
    || !hasRequiredOptionalKeys(
      input.payload,
      ['baseUrl', 'model', 'explainInstructions', 'removeApiKey'],
      ['apiKey'],
    )
  ) {
    return invalid('Invalid model configuration payload.');
  }

  const {
    baseUrl,
    model,
    explainInstructions,
    apiKey,
    removeApiKey,
  } = input.payload;
  if (
    typeof baseUrl !== 'string'
    || typeof model !== 'string'
    || typeof explainInstructions !== 'string'
    || (apiKey !== undefined && typeof apiKey !== 'string')
    || typeof removeApiKey !== 'boolean'
  ) {
    return invalid('Model configuration fields have invalid types.');
  }

  const normalizedInstructions = explainInstructions.trim();
  if (normalizedInstructions.length > MAX_AI_EXPLAIN_INSTRUCTIONS_LENGTH) {
    return invalid(
      `SQL Explain instructions cannot exceed ${MAX_AI_EXPLAIN_INSTRUCTIONS_LENGTH} characters.`,
    );
  }

  const normalizedKey = apiKey?.trim();
  return {
    ok: true,
    message: {
      type: 'save',
      payload: {
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        explainInstructions: normalizedInstructions,
        apiKey: normalizedKey || undefined,
        removeApiKey,
      },
    },
  };
}

function renderAiConfigurationHtml(
  webview: vscode.Webview,
  values: AiConfigurationValues,
): string {
  const nonce = crypto.randomBytes(18).toString('base64');
  const initialState = JSON.stringify({
    baseUrl: values.baseUrl,
    model: values.model,
    explainInstructions: values.explainInstructions,
    hasApiKey: values.hasApiKey,
  }).replace(/</gu, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}' ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <title>Configure Agent Chat</title>
  <style nonce="${nonce}">
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font: 13px/1.5 var(--vscode-font-family);
    }
    main { max-width: 760px; padding: 32px 36px 44px; }
    h1 { margin: 0 0 8px; font-size: 24px; font-weight: 650; }
    .lead { margin: 0 0 28px; color: var(--vscode-descriptionForeground); }
    .field { margin-bottom: 22px; }
    label { display: block; margin-bottom: 7px; font-weight: 600; }
    input, textarea {
      width: 100%;
      padding: 6px 9px;
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 3px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      font: inherit;
    }
    input { height: 34px; }
    textarea { min-height: 118px; resize: vertical; }
    input:focus, textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    .help { margin: 7px 0 0; color: var(--vscode-descriptionForeground); }
    .field-meta { display: flex; justify-content: space-between; gap: 12px; }
    .counter { flex: 0 0 auto; }
    code { font-family: var(--vscode-editor-font-family); }
    .key-state {
      display: inline-block;
      margin-left: 8px;
      padding: 1px 7px;
      border-radius: 10px;
      color: var(--vscode-badge-foreground);
      background: var(--vscode-badge-background);
      font-size: 11px;
      font-weight: 400;
    }
    .remove-row { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
    .remove-row input { width: auto; height: auto; }
    .remove-row label { margin: 0; font-weight: 400; }
    .actions { display: flex; gap: 9px; margin-top: 30px; }
    button {
      min-width: 86px;
      padding: 6px 12px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 3px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      font: inherit;
      cursor: pointer;
    }
    button.secondary {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .status { min-height: 22px; margin-top: 16px; color: var(--vscode-descriptionForeground); }
    .status.ok { color: var(--vscode-testing-iconPassed, #73c991); }
    .status.error { color: var(--vscode-errorForeground); }
  </style>
</head>
<body>
  <main>
    <h1>Configure Agent Chat</h1>
    <p class="lead">Connect directly to your OpenAI-compatible API. SQL Workbench does not proxy or host the model service.</p>
    <form id="configuration">
      <div class="field">
        <label for="base-url">API Base URL</label>
        <input id="base-url" type="url" autocomplete="url" spellcheck="false" placeholder="https://api.example.com/v1" required>
        <p class="help">Enter the provider's OpenAI-compatible base URL. SQL Workbench appends <code>/chat/completions</code> when needed. Remote URLs must use HTTPS.</p>
      </div>
      <div class="field">
        <label for="model">Model ID</label>
        <input id="model" type="text" autocomplete="off" spellcheck="false" placeholder="Exact API model ID" required>
        <p class="help"><strong>Use the exact model name accepted by the API, not the provider or product name.</strong> For example, enter <code>deepseek-v4-flash</code>, not <code>deepseek</code>. Copy the current ID from your provider's model list or API error.</p>
      </div>
      <div class="field">
        <label for="explain-instructions">Explain Instructions</label>
        <textarea id="explain-instructions" maxlength="${MAX_AI_EXPLAIN_INSTRUCTIONS_LENGTH}" spellcheck="true" placeholder="For example: Respond in Chinese, explain step by step, and focus on indexes and full-table scans."></textarea>
        <div class="field-meta help">
          <span>Optional global preferences for SQL Explain only. Fixed safety requirements and the no-execution boundary cannot be overridden. Clear this field to restore the default behavior.</span>
          <span id="instructions-count" class="counter">0 / ${MAX_AI_EXPLAIN_INSTRUCTIONS_LENGTH}</span>
        </div>
      </div>
      <div class="field">
        <label for="api-key">API Key <span id="key-state" class="key-state" hidden>Saved in VS Code SecretStorage</span></label>
        <input id="api-key" type="password" autocomplete="new-password" spellcheck="false">
        <p id="key-help" class="help"></p>
        <div id="remove-row" class="remove-row" hidden>
          <input id="remove-key" type="checkbox">
          <label for="remove-key">Remove the saved API Key</label>
        </div>
      </div>
      <div class="actions">
        <button type="submit">Save</button>
        <button id="cancel" class="secondary" type="button">Cancel</button>
      </div>
      <div id="status" class="status" role="status" aria-live="polite"></div>
    </form>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const initial = ${initialState};
    const form = document.getElementById('configuration');
    const baseUrl = document.getElementById('base-url');
    const model = document.getElementById('model');
    const explainInstructions = document.getElementById('explain-instructions');
    const instructionsCount = document.getElementById('instructions-count');
    const apiKey = document.getElementById('api-key');
    const keyState = document.getElementById('key-state');
    const keyHelp = document.getElementById('key-help');
    const removeRow = document.getElementById('remove-row');
    const removeKey = document.getElementById('remove-key');
    const status = document.getElementById('status');

    baseUrl.value = initial.baseUrl || '';
    model.value = initial.model || '';
    explainInstructions.value = initial.explainInstructions || '';
    const updateInstructionsCount = () => {
      instructionsCount.textContent = explainInstructions.value.length + ' / ${MAX_AI_EXPLAIN_INSTRUCTIONS_LENGTH}';
    };
    explainInstructions.addEventListener('input', updateInstructionsCount);
    updateInstructionsCount();
    keyState.hidden = !initial.hasApiKey;
    removeRow.hidden = !initial.hasApiKey;
    apiKey.placeholder = initial.hasApiKey
      ? 'Leave blank to keep the saved key'
      : 'Paste API Key';
    keyHelp.textContent = initial.hasApiKey
      ? 'The existing key is never sent to this page. Leave this field blank to keep it, or enter a new key to replace it.'
      : 'The key is stored only in VS Code SecretStorage. A key is optional only for loopback development endpoints.';

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      status.className = 'status';
      status.textContent = 'Saving model configuration…';
      vscode.postMessage({
        type: 'save',
        payload: {
          baseUrl: baseUrl.value,
          model: model.value,
          explainInstructions: explainInstructions.value,
          apiKey: apiKey.value || undefined,
          removeApiKey: Boolean(removeKey.checked),
        },
      });
    });
    document.getElementById('cancel').addEventListener('click', () => {
      vscode.postMessage({ type: 'close' });
    });
    removeKey.addEventListener('change', () => {
      apiKey.disabled = removeKey.checked;
      if (removeKey.checked) apiKey.value = '';
    });
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message?.type !== 'status' || !message.payload) return;
      status.textContent = String(message.payload.message || '');
      status.className = 'status ' + (message.payload.ok === true ? 'ok' : message.payload.ok === false ? 'error' : '');
    });
  </script>
</body>
</html>`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function hasRequiredOptionalKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => keys.includes(key))
    && keys.every((key) => allowed.has(key));
}

function invalid(error: string): AiConfigurationDecodeResult {
  return { ok: false, error };
}

function resolveSubmittedApiKey(
  payload: AiConfigurationSavePayload,
  existingKey: string | undefined,
): string | undefined {
  return payload.removeApiKey
    ? undefined
    : payload.apiKey ?? existingKey;
}

export const __aiConfigurationPanelTestHooks = {
  decodeAiConfigurationMessage,
  renderAiConfigurationHtml,
  resolveSubmittedApiKey,
};
