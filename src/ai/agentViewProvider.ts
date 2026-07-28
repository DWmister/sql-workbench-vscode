import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import type { ActiveConnectionState, ConnectionResolver } from '../connection/activeConnectionState';
import type { ConnectionConfig } from '../connection/types';
import type { AiAgentRunEvent, AiAgentRuntime } from './agentRuntime';
import { renderAgentViewHtml } from './agentViewHtml';
import type { AiConfigurationStore } from './configurationStore';
import { decodeAiWebviewMessage, type AiWebviewMessage } from './contracts';
import { AI_AGENT_FOCUS_COMMAND_ID, AiCommandIds } from './ids';
import { getSafeErrorMessage } from './modelErrors';
import type {
  AiConversation,
  AiSessionStore,
} from './sessionStore';
import type { AiSqlDraftHost } from './sqlDrafts';

const SELECTED_CONVERSATION_KEY = 'sqlWorkbench.ai.selectedConversationId';
const MAX_SEEN_REQUESTS = 200;

interface RunningState {
  runId: string;
  conversationId: string;
}

export type AiConversationTimelineItem =
  | {
    type: 'message';
    id: string;
    role: 'user' | 'assistant';
    text: string;
    createdAt: number;
  }
  | {
    type: 'draft';
    id: string;
    title: string;
    sql: string;
    rationale?: string;
    createdAt: number;
  };

export interface AiAgentViewProviderOptions {
  extensionUri: vscode.Uri;
  workspaceState: vscode.Memento;
  configuration: AiConfigurationStore;
  sessions: AiSessionStore;
  runtime: AiAgentRuntime;
  drafts: AiSqlDraftHost;
  connections: ConnectionResolver;
  activeConnection: ActiveConnectionState;
  resolveActiveConnection: () => Promise<ConnectionConfig | undefined>;
  refreshSqlCodeLenses: () => void;
}

export class AiAgentViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly seenRequestIds = new Set<string>();
  private view: vscode.WebviewView | undefined;
  private messageSubscription: vscode.Disposable | undefined;
  private running: RunningState | undefined;
  private selectedConversationId: string | undefined;

  constructor(private readonly options: AiAgentViewProviderOptions) {
    this.selectedConversationId = options.workspaceState.get<string>(SELECTED_CONVERSATION_KEY);
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.messageSubscription?.dispose();
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.options.extensionUri],
    };
    webviewView.webview.html = renderAgentViewHtml(webviewView.webview);
    this.messageSubscription = webviewView.webview.onDidReceiveMessage((input: unknown) => {
      void this.handleUnknownMessage(input);
    });
    webviewView.onDidDispose(() => {
      this.messageSubscription?.dispose();
      this.messageSubscription = undefined;
      if (this.view === webviewView) {
        this.view = undefined;
      }
    });
  }

  public async newConversation(): Promise<AiConversation | undefined> {
    const connection = await this.options.resolveActiveConnection();
    if (!connection) {
      await vscode.window.showWarningMessage('Choose an active database connection before starting an AI conversation.');
      return undefined;
    }

    const conversation = await this.options.runtime.createConversation(connection);
    await this.selectConversation(conversation.id);
    await this.focus();
    await this.postState();
    return conversation;
  }

  public async clearHistory(): Promise<void> {
    const confirmed = await vscode.window.showWarningMessage(
      'Clear all SQL Workbench AI conversation history and SQL drafts in this workspace?',
      { modal: true },
      'Clear History',
    );
    if (confirmed !== 'Clear History') {
      return;
    }

    if (this.running) {
      this.options.runtime.cancel(this.running.conversationId);
      this.running = undefined;
    }
    await this.options.sessions.clear();
    await this.selectConversation(undefined);
    await this.postState();
  }

  public async explainSql(sql: string, connection: ConnectionConfig): Promise<void> {
    const instructions = await this.loadExplainInstructions();
    if (instructions === undefined) {
      return;
    }
    const title = `Explain: ${sql.replace(/\s+/gu, ' ').trim().slice(0, 72)}`;
    const conversation = await this.ensureConversation(connection, title);
    await this.focus();
    await this.startRun(
      conversation,
      this.options.runtime.explainSql({
        conversationId: conversation.id,
        connection,
        sql,
        instructions,
      }),
    );
  }

  public dispose(): void {
    this.messageSubscription?.dispose();
    this.messageSubscription = undefined;
    if (this.running) {
      this.options.runtime.cancel(this.running.conversationId);
    }
  }

  private async handleUnknownMessage(input: unknown): Promise<void> {
    const decoded = decodeAiWebviewMessage(input);
    if (!decoded.ok) {
      await this.postToast(decoded.error);
      return;
    }

    try {
      await this.handleMessage(decoded.message);
    } catch (error) {
      await this.postToast(getSafeErrorMessage(error));
    }
  }

  private async handleMessage(message: AiWebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.postState();
        return;
      case 'configure':
        await vscode.commands.executeCommand(AiCommandIds.configure);
        await this.postState();
        return;
      case 'newConversation':
        await this.newConversation();
        return;
      case 'clearHistory':
        await this.clearHistory();
        return;
      case 'selectConversation':
        if (this.options.sessions.get(message.conversationId)) {
          await this.selectConversation(message.conversationId);
          await this.postState();
        }
        return;
      case 'cancelRun':
        if (this.running?.runId === message.runId) {
          this.options.runtime.cancel(this.running.conversationId);
        }
        return;
      case 'submitPrompt':
        await this.submitPrompt(message.requestId, message.conversationId, message.text);
        return;
      case 'insertDraft':
        await this.insertDraft(message.conversationId, message.draftId);
        return;
      case 'openDraft':
        await this.openDraft(message.conversationId, message.draftId);
        return;
    }
  }

  private async submitPrompt(
    requestId: string,
    conversationId: string,
    text: string,
  ): Promise<void> {
    if (this.seenRequestIds.has(requestId)) {
      return;
    }
    this.rememberRequest(requestId);

    let conversation = this.options.sessions.get(conversationId);
    if (!conversation) {
      throw new Error('The selected AI conversation no longer exists.');
    }
    const connection = await this.requireConversationConnection(conversation);
    if (conversation.messages.length === 0 && conversation.title === 'New conversation') {
      conversation.title = text.replace(/\s+/gu, ' ').slice(0, 72);
      conversation = await this.options.sessions.save(conversation);
    }
    await this.selectConversation(conversation.id);
    await this.startRun(
      conversation,
      this.options.runtime.runPrompt({
        conversationId: conversation.id,
        connection,
        prompt: text,
      }),
    );
  }

  private async startRun(
    conversation: AiConversation,
    events: AsyncIterable<AiAgentRunEvent>,
  ): Promise<void> {
    if (this.running) {
      throw new Error('Wait for the current Agent Chat response to finish or cancel it.');
    }

    const run: RunningState = {
      runId: randomUUID(),
      conversationId: conversation.id,
    };
    this.running = run;
    await this.postState();
    let sequence = 0;

    try {
      for await (const event of events) {
        if (this.running?.runId !== run.runId) {
          break;
        }
        if (event.type === 'text-delta') {
          sequence += 1;
          await this.postMessage({
            type: 'assistantDelta',
            conversationId: conversation.id,
            runId: run.runId,
            seq: sequence,
            text: event.delta,
          });
        } else if (event.type === 'started') {
          await this.postState();
        } else if (event.type === 'tool-summary') {
          await this.postToast(event.summary.summary);
        } else if (event.type === 'draft') {
          await this.postState();
        }
      }
    } catch (error) {
      const message = getSafeErrorMessage(error);
      if (!/cancel/iu.test(message)) {
        await this.postToast(message);
      }
    } finally {
      if (this.running?.runId === run.runId) {
        this.running = undefined;
      }
      await this.postState();
    }
  }

  private async insertDraft(conversationId: string, draftId: string): Promise<void> {
    const conversation = this.requireConversation(conversationId);
    const connection = await this.requireConversationConnection(conversation);
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'sql') {
      throw new Error('Open a SQL editor before inserting an AI SQL draft.');
    }

    const existingBinding = this.options.activeConnection.getDocumentBindingId(editor.document);
    if (existingBinding && existingBinding !== connection.id) {
      const confirmed = await vscode.window.showWarningMessage(
        `This SQL file is bound to another connection. Insert the draft and bind it to "${connection.name}"?`,
        { modal: true },
        'Insert and Rebind',
      );
      if (confirmed !== 'Insert and Rebind') {
        return;
      }
    }

    await this.options.drafts.insert(conversationId, draftId);
    await this.options.activeConnection.set(connection.id, editor.document);
    this.options.refreshSqlCodeLenses();
    await this.postToast('SQL draft inserted. Use AI Explain or Run Statement in the SQL editor.');
  }

  private async openDraft(conversationId: string, draftId: string): Promise<void> {
    const conversation = this.requireConversation(conversationId);
    const connection = await this.requireConversationConnection(conversation);
    const editor = await this.options.drafts.open(conversationId, draftId);
    await this.options.activeConnection.set(connection.id, editor.document);
    this.options.refreshSqlCodeLenses();
    await this.postToast(`Opened SQL draft bound to ${connection.name}.`);
  }

  private async ensureConversation(
    connection: ConnectionConfig,
    title: string,
  ): Promise<AiConversation> {
    const selected = this.selectedConversationId
      ? this.options.sessions.get(this.selectedConversationId)
      : undefined;
    if (selected?.connectionId === connection.id && selected.dialect === connection.type) {
      return selected;
    }

    const conversation = await this.options.runtime.createConversation(connection, title);
    await this.selectConversation(conversation.id);
    return conversation;
  }

  private requireConversation(conversationId: string): AiConversation {
    const conversation = this.options.sessions.get(conversationId);
    if (!conversation) {
      throw new Error('The AI conversation no longer exists.');
    }
    return conversation;
  }

  private async requireConversationConnection(
    conversation: AiConversation,
  ): Promise<ConnectionConfig> {
    const connection = await this.options.connections.get(conversation.connectionId);
    if (!connection || connection.type !== conversation.dialect) {
      throw new Error('The database connection bound to this conversation is unavailable.');
    }
    return connection;
  }

  private async selectConversation(conversationId: string | undefined): Promise<void> {
    this.selectedConversationId = conversationId;
    await this.options.workspaceState.update(SELECTED_CONVERSATION_KEY, conversationId);
  }

  private async focus(): Promise<void> {
    await vscode.commands.executeCommand(AI_AGENT_FOCUS_COMMAND_ID);
  }

  private async postState(): Promise<void> {
    const conversations = this.options.sessions.list();
    if (
      this.selectedConversationId
      && !conversations.some(({ id }) => id === this.selectedConversationId)
    ) {
      this.selectedConversationId = undefined;
    }
    if (!this.selectedConversationId && conversations[0]) {
      await this.selectConversation(conversations[0].id);
    }

    const configured = await this.isConfigured();
    const viewConversations = await Promise.all(
      conversations.map(async (conversation) => {
        const connection = await this.options.connections.get(conversation.connectionId);
        const databaseLabel = connection?.database ?? connection?.type ?? conversation.dialect;
        return {
          id: conversation.id,
          title: conversation.title,
          connectionSummary: connection
            ? `${connection.name} · ${databaseLabel}`
            : 'Disconnected conversation',
          timeline: buildAiConversationTimeline(conversation),
        };
      }),
    );

    await this.postMessage({
      type: 'state',
      state: {
        configured,
        selectedConversationId: this.selectedConversationId,
        conversations: viewConversations,
        running: this.running,
      },
    });
  }

  private async isConfigured(): Promise<boolean> {
    try {
      await this.options.configuration.load();
      return true;
    } catch {
      return false;
    }
  }

  private async loadExplainInstructions(): Promise<string | undefined> {
    try {
      await this.options.configuration.load();
      return this.options.configuration.getExplainInstructions();
    } catch (error) {
      const configureAction = 'Configure Model';
      const selected = await vscode.window.showWarningMessage(
        getSafeErrorMessage(error),
        configureAction,
      );
      if (selected === configureAction) {
        await vscode.commands.executeCommand(AiCommandIds.configure);
      }
      return undefined;
    }
  }

  private async postToast(text: string): Promise<void> {
    await this.postMessage({ type: 'toast', text });
  }

  private async postMessage(message: unknown): Promise<void> {
    await this.view?.webview.postMessage(message);
  }

  private rememberRequest(requestId: string): void {
    this.seenRequestIds.add(requestId);
    if (this.seenRequestIds.size <= MAX_SEEN_REQUESTS) {
      return;
    }
    const oldest = this.seenRequestIds.values().next().value as string | undefined;
    if (oldest) {
      this.seenRequestIds.delete(oldest);
    }
  }
}

export function buildAiConversationTimeline(
  conversation: AiConversation,
): AiConversationTimelineItem[] {
  const sortable = [
    ...conversation.messages.map((message, sourceIndex) => ({
      item: {
        type: 'message' as const,
        id: message.id,
        role: message.role,
        text: message.content,
        createdAt: message.createdAt,
      },
      tieRank: message.role === 'user' ? 0 : 2,
      sourceIndex,
    })),
    ...conversation.drafts.map((draft, sourceIndex) => ({
      item: {
        type: 'draft' as const,
        id: draft.id,
        title: draft.title,
        sql: draft.sql,
        rationale: draft.rationale,
        createdAt: draft.createdAt,
      },
      tieRank: 1,
      sourceIndex,
    })),
  ];

  return sortable
    .sort((left, right) =>
      left.item.createdAt - right.item.createdAt
      || left.tieRank - right.tieRank
      || left.sourceIndex - right.sourceIndex)
    .map(({ item }) => item);
}
