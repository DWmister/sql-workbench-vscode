import * as crypto from 'crypto';
import type * as vscode from 'vscode';
import { MAX_AI_PROMPT_LENGTH } from './contracts';

export function renderAgentViewHtml(webview: vscode.Webview): string {
  const nonce = crypto.randomBytes(18).toString('base64');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>SQL Workbench Agent Chat</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    html, body { height: 100%; overflow: hidden; }
    body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font: 13px/1.45 var(--vscode-font-family); }
    button, select, textarea { font: inherit; color: inherit; }
    button { cursor: pointer; }
    button:disabled { cursor: default; opacity: .55; }
    .app { height: 100vh; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
    .header { position: sticky; top: 0; z-index: 2; padding: 10px; border-bottom: 1px solid var(--vscode-sideBar-border, var(--vscode-panel-border)); background: var(--vscode-sideBar-background); }
    .brand { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
    .brand strong { font-size: 13px; }
    .status { padding: 2px 7px; border-radius: 999px; color: var(--vscode-descriptionForeground); background: var(--vscode-badge-background); }
    .status.ready { color: var(--vscode-badge-foreground); }
    .toolbar { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 5px; }
    select, textarea { width: 100%; border: 1px solid var(--vscode-input-border, transparent); color: var(--vscode-input-foreground); background: var(--vscode-input-background); }
    select { min-width: 0; padding: 4px 6px; }
    button { border: 1px solid var(--vscode-button-border, transparent); padding: 4px 8px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button.secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
    .connection { margin-top: 7px; color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; }
    .messages { flex: 1 1 auto; min-height: 0; padding: 10px; overflow: auto; }
    .empty { padding: 18px 10px; text-align: center; color: var(--vscode-descriptionForeground); }
    .message { margin: 0 0 10px; padding: 8px 9px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 5px; background: var(--vscode-editor-background); }
    .message.user { border-color: var(--vscode-focusBorder); }
    .message .role { margin-bottom: 4px; color: var(--vscode-descriptionForeground); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
    .message .text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .draft { margin-top: 8px; padding: 8px; border-left: 2px solid var(--vscode-charts-blue); background: var(--vscode-textBlockQuote-background); }
    .draft-head { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
    .draft-kind { color: var(--vscode-descriptionForeground); font-size: 11px; }
    pre { max-height: 220px; margin: 0 0 7px; padding: 7px; overflow: auto; white-space: pre; color: var(--vscode-editor-foreground); background: var(--vscode-textCodeBlock-background); font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); }
    .actions { display: flex; flex-wrap: wrap; gap: 5px; }
    .composer { position: sticky; bottom: 0; z-index: 2; padding: 10px; border-top: 1px solid var(--vscode-sideBar-border, var(--vscode-panel-border)); background: var(--vscode-sideBar-background); }
    textarea { min-height: 72px; max-height: 220px; resize: vertical; padding: 7px; }
    .composer-actions { display: flex; justify-content: space-between; gap: 6px; margin-top: 6px; }
    .hint { color: var(--vscode-descriptionForeground); font-size: 11px; }
    .toast { position: fixed; right: 8px; bottom: 112px; left: 8px; z-index: 5; padding: 8px; border: 1px solid var(--vscode-notifications-border); background: var(--vscode-notifications-background); box-shadow: 0 3px 12px var(--vscode-widget-shadow); }
    [hidden] { display: none !important; }
  </style>
</head>
<body>
  <div class="app">
    <header class="header">
      <div class="brand"><strong>Schema-aware Chat</strong><span id="status" class="status">Not configured</span></div>
      <div class="toolbar">
        <select id="conversation" aria-label="Conversation"></select>
        <button id="new-conversation" class="secondary" type="button" title="New conversation">＋</button>
        <button id="configure" class="secondary" type="button" title="Configure model">⚙</button>
      </div>
      <div id="connection" class="connection">No connection-bound conversation</div>
    </header>
    <main id="messages" class="messages"><div class="empty">Configure a model and create a connection-bound conversation.</div></main>
    <footer class="composer">
      <textarea id="prompt" aria-label="Message" placeholder="Ask about the active database, generate SQL, or paste an error to fix…" maxlength="${MAX_AI_PROMPT_LENGTH}"></textarea>
      <div class="composer-actions">
        <span class="hint">Enter to send · Shift+Enter for a new line · No result values are sent.</span>
        <button id="send" type="button">Send</button>
        <button id="cancel" class="secondary" type="button" hidden>Cancel</button>
      </div>
    </footer>
  </div>
  <div id="toast" class="toast" role="status" hidden></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const PROTOCOL_VERSION = 1;
    const ui = {
      cancel: document.getElementById('cancel'),
      configure: document.getElementById('configure'),
      connection: document.getElementById('connection'),
      conversation: document.getElementById('conversation'),
      messages: document.getElementById('messages'),
      newConversation: document.getElementById('new-conversation'),
      prompt: document.getElementById('prompt'),
      send: document.getElementById('send'),
      status: document.getElementById('status'),
      toast: document.getElementById('toast'),
    };
    const local = { state: undefined, stream: '', streamRunId: undefined, toastTimer: undefined };
    const post = (message) => vscode.postMessage({ protocolVersion: PROTOCOL_VERSION, ...message });
    const createRequestId = () => globalThis.crypto?.randomUUID?.() || String(Date.now()) + '-' + Math.random().toString(36).slice(2);

    ui.configure.addEventListener('click', () => post({ type: 'configure' }));
    ui.newConversation.addEventListener('click', () => post({ type: 'newConversation' }));
    ui.conversation.addEventListener('change', () => post({ type: 'selectConversation', conversationId: ui.conversation.value }));
    ui.send.addEventListener('click', submitPrompt);
    ui.cancel.addEventListener('click', () => {
      const running = local.state?.running;
      if (running) post({ type: 'cancelRun', runId: running.runId });
    });
    ui.prompt.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        submitPrompt();
      }
    });
    ui.messages.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const conversationId = button.dataset.conversationId;
      const draftId = button.dataset.draftId;
      if (!conversationId || !draftId) return;
      const action = button.dataset.action;
      if (action === 'insert') post({ type: 'insertDraft', conversationId, draftId });
      if (action === 'open') post({ type: 'openDraft', conversationId, draftId });
    });

    function submitPrompt() {
      const text = ui.prompt.value.trim();
      const conversationId = local.state?.selectedConversationId;
      if (!text || !conversationId || local.state?.running) return;
      post({ type: 'submitPrompt', requestId: createRequestId(), conversationId, text });
      ui.prompt.value = '';
    }

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message || typeof message !== 'object') return;
      if (message.type === 'state') {
        local.state = message.state;
        if (!local.state?.running) {
          local.stream = '';
          local.streamRunId = undefined;
        }
        render();
      } else if (message.type === 'assistantDelta') {
        if (local.state?.selectedConversationId !== message.conversationId) return;
        if (local.streamRunId !== message.runId) {
          local.streamRunId = message.runId;
          local.stream = '';
        }
        local.stream += typeof message.text === 'string' ? message.text : '';
        renderMessages();
      } else if (message.type === 'toast') {
        showToast(String(message.text || ''));
      }
    });

    function render() {
      const state = local.state || {};
      ui.status.textContent = state.running ? 'Thinking…' : state.configured ? 'Ready' : 'Not configured';
      ui.status.classList.toggle('ready', Boolean(state.configured));
      ui.send.disabled = !state.configured || !state.selectedConversationId || Boolean(state.running);
      ui.cancel.hidden = !state.running;
      ui.send.hidden = Boolean(state.running);
      renderConversationPicker();
      renderMessages();
    }

    function renderConversationPicker() {
      const state = local.state || {};
      const conversations = Array.isArray(state.conversations) ? state.conversations : [];
      ui.conversation.replaceChildren();
      if (conversations.length === 0) {
        const option = document.createElement('option');
        option.textContent = 'No conversations';
        option.value = '';
        ui.conversation.append(option);
      } else {
        for (const conversation of conversations) {
          const option = document.createElement('option');
          option.value = conversation.id;
          option.textContent = conversation.title || 'New conversation';
          option.selected = conversation.id === state.selectedConversationId;
          ui.conversation.append(option);
        }
      }
      const selected = conversations.find((conversation) => conversation.id === state.selectedConversationId);
      ui.connection.textContent = selected?.connectionSummary || 'No connection-bound conversation';
    }

    function renderMessages() {
      const state = local.state || {};
      const conversations = Array.isArray(state.conversations) ? state.conversations : [];
      const selected = conversations.find((conversation) => conversation.id === state.selectedConversationId);
      ui.messages.replaceChildren();
      if (!selected) {
        appendEmpty(state.configured ? 'Create a conversation for the active database connection.' : 'Configure an OpenAI-compatible model to begin.');
        return;
      }
      const timeline = Array.isArray(selected.timeline) ? selected.timeline : [];
      if (timeline.length === 0 && !local.stream) {
        appendEmpty('Ask for SQL, paste a query to explain, or describe a database task.');
      }
      for (const item of timeline) {
        if (item.type === 'message') appendMessage(item.role, item.text, false);
        if (item.type === 'draft') ui.messages.append(renderDraft(selected.id, item));
      }
      if (local.stream) appendMessage('assistant', local.stream, true);
      scrollToLatest();
    }

    function appendEmpty(text) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = text;
      ui.messages.append(empty);
    }

    function appendMessage(role, text, streaming = false) {
      const article = document.createElement('article');
      article.className = 'message ' + (role === 'user' ? 'user' : 'assistant');
      const label = document.createElement('div');
      label.className = 'role';
      label.textContent = role === 'user' ? 'You' : streaming ? 'Agent · streaming' : 'Agent';
      const body = document.createElement('p');
      body.className = 'text';
      body.textContent = typeof text === 'string' ? text : '';
      article.append(label, body);
      ui.messages.append(article);
    }

    function renderDraft(conversationId, draft) {
      const section = document.createElement('section');
      section.className = 'draft';
      const head = document.createElement('div');
      head.className = 'draft-head';
      const title = document.createElement('strong');
      title.textContent = draft.title || 'SQL draft';
      const kind = document.createElement('span');
      kind.className = 'draft-kind';
      kind.textContent = 'review in editor';
      head.append(title, kind);
      const code = document.createElement('pre');
      code.textContent = draft.sql || '';
      const actions = document.createElement('div');
      actions.className = 'actions';
      actions.append(draftButton('Insert', 'insert', conversationId, draft.id), draftButton('Open', 'open', conversationId, draft.id));
      section.append(head, code, actions);
      return section;
    }

    function draftButton(label, action, conversationId, draftId) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.dataset.action = action;
      button.dataset.conversationId = conversationId;
      button.dataset.draftId = draftId;
      button.textContent = label;
      return button;
    }

    function scrollToLatest() {
      const scroll = () => {
        ui.messages.scrollTop = ui.messages.scrollHeight;
      };
      scroll();
      requestAnimationFrame(scroll);
    }

    function showToast(text) {
      if (!text) return;
      clearTimeout(local.toastTimer);
      ui.toast.textContent = text;
      ui.toast.hidden = false;
      local.toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 4500);
    }

    post({ type: 'ready' });
  </script>
</body>
</html>`;
}
