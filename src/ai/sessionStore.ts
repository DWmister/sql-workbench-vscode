import { randomUUID } from 'crypto';
import type { Memento } from 'vscode';
import type { ConnectionType } from '../connection/types';

export const AI_SESSION_STATE_VERSION = 1;
export const MAX_AI_CONVERSATIONS = 20;

const DEFAULT_STATE_KEY = 'sqlWorkbench.ai.sessions';
const MAX_MESSAGES = 100;
const MAX_DRAFTS = 50;
const MAX_TOOL_SUMMARIES = 100;
const MAX_TEXT_LENGTH = 64 * 1024;
const MAX_TITLE_LENGTH = 160;

export interface AiSessionMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface AiSqlDraft {
  id: string;
  title: string;
  sql: string;
  rationale?: string;
  createdAt: number;
}

export interface AiToolSummary {
  id: string;
  name: 'search_schema' | 'describe_tables' | 'propose_sql_draft';
  summary: string;
  createdAt: number;
}

export interface AiConversation {
  id: string;
  title: string;
  connectionId: string;
  dialect: ConnectionType;
  createdAt: number;
  updatedAt: number;
  messages: AiSessionMessage[];
  drafts: AiSqlDraft[];
  toolSummaries: AiToolSummary[];
}

interface StoredAiSessionState {
  version: 1;
  conversations: AiConversation[];
}

export interface AiSessionStoreOptions {
  stateKey?: string;
}

export class AiSessionStore {
  private readonly stateKey: string;

  constructor(
    private readonly workspaceState: Memento,
    options: AiSessionStoreOptions = {},
  ) {
    this.stateKey = options.stateKey ?? DEFAULT_STATE_KEY;
  }

  public list(): AiConversation[] {
    return this.readState().map(cloneConversation);
  }

  public get(conversationId: string): AiConversation | undefined {
    const conversation = this.readState().find(({ id }) => id === conversationId);
    return conversation ? cloneConversation(conversation) : undefined;
  }

  public async create(input: {
    connectionId: string;
    dialect: ConnectionType;
    title?: string;
  }): Promise<AiConversation> {
    const now = Date.now();
    const conversation = normalizeConversation({
      id: randomUUID(),
      title: input.title ?? 'New conversation',
      connectionId: input.connectionId,
      dialect: input.dialect,
      createdAt: now,
      updatedAt: now,
      messages: [],
      drafts: [],
      toolSummaries: [],
    });
    if (!conversation) {
      throw new Error('Cannot create an AI conversation with invalid connection metadata.');
    }

    await this.writeState([conversation, ...this.readState()]);
    return cloneConversation(conversation);
  }

  public async save(conversation: AiConversation): Promise<AiConversation> {
    const normalized = normalizeConversation({
      ...conversation,
      updatedAt: Date.now(),
    });
    if (!normalized) {
      throw new Error('Cannot save an invalid AI conversation.');
    }

    const conversations = this.readState().filter(({ id }) => id !== normalized.id);
    await this.writeState([normalized, ...conversations]);
    return cloneConversation(normalized);
  }

  public async delete(conversationId: string): Promise<void> {
    await this.writeState(
      this.readState().filter(({ id }) => id !== conversationId),
    );
  }

  public async clear(): Promise<void> {
    await this.writeState([]);
  }

  public findDraft(conversationId: string, draftId: string): AiSqlDraft | undefined {
    const draft = this.get(conversationId)?.drafts.find(({ id }) => id === draftId);
    return draft ? { ...draft } : undefined;
  }

  private readState(): AiConversation[] {
    const raw = this.workspaceState.get<unknown>(this.stateKey);
    if (!isRecord(raw) || raw.version !== AI_SESSION_STATE_VERSION || !Array.isArray(raw.conversations)) {
      return [];
    }

    return raw.conversations
      .map(normalizeConversation)
      .filter((entry): entry is AiConversation => entry !== undefined)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_AI_CONVERSATIONS);
  }

  private async writeState(conversations: AiConversation[]): Promise<void> {
    const sanitized = conversations
      .map(normalizeConversation)
      .filter((entry): entry is AiConversation => entry !== undefined)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_AI_CONVERSATIONS);
    const state: StoredAiSessionState = {
      version: AI_SESSION_STATE_VERSION,
      conversations: sanitized,
    };
    await this.workspaceState.update(this.stateKey, state);
  }
}

function normalizeConversation(value: unknown): AiConversation | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = normalizedId(value.id);
  const connectionId = normalizedId(value.connectionId);
  const title = normalizedText(value.title, MAX_TITLE_LENGTH);
  const dialect = normalizeDialect(value.dialect);
  const createdAt = normalizedTimestamp(value.createdAt);
  const updatedAt = normalizedTimestamp(value.updatedAt);
  if (!id || !connectionId || !title || !dialect || createdAt === undefined || updatedAt === undefined) {
    return undefined;
  }

  return {
    id,
    title,
    connectionId,
    dialect,
    createdAt,
    updatedAt,
    messages: normalizeArray(value.messages, normalizeMessage, MAX_MESSAGES),
    drafts: normalizeArray(value.drafts, normalizeDraft, MAX_DRAFTS),
    toolSummaries: normalizeArray(value.toolSummaries, normalizeToolSummary, MAX_TOOL_SUMMARIES),
  };
}

function normalizeMessage(value: unknown): AiSessionMessage | undefined {
  if (!isRecord(value) || (value.role !== 'user' && value.role !== 'assistant')) {
    return undefined;
  }
  const id = normalizedId(value.id);
  const content = normalizedText(value.content, MAX_TEXT_LENGTH);
  const createdAt = normalizedTimestamp(value.createdAt);
  return id && content && createdAt !== undefined
    ? { id, role: value.role, content, createdAt }
    : undefined;
}

function normalizeDraft(value: unknown): AiSqlDraft | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = normalizedId(value.id);
  const title = normalizedText(value.title, MAX_TITLE_LENGTH);
  const sql = normalizedText(value.sql, MAX_TEXT_LENGTH);
  const rationale = normalizedOptionalText(value.rationale, MAX_TEXT_LENGTH);
  const createdAt = normalizedTimestamp(value.createdAt);
  return id && title && sql && createdAt !== undefined
    ? { id, title, sql, rationale, createdAt }
    : undefined;
}

function normalizeToolSummary(value: unknown): AiToolSummary | undefined {
  if (!isRecord(value) || !isToolName(value.name)) {
    return undefined;
  }
  const id = normalizedId(value.id);
  const summary = normalizedText(value.summary, MAX_TITLE_LENGTH);
  const createdAt = normalizedTimestamp(value.createdAt);
  return id && summary && createdAt !== undefined
    ? { id, name: value.name, summary, createdAt }
    : undefined;
}

function normalizeArray<T>(
  value: unknown,
  normalize: (entry: unknown) => T | undefined,
  limit: number,
): T[] {
  return Array.isArray(value)
    ? value.map(normalize).filter((entry): entry is T => entry !== undefined).slice(-limit)
    : [];
}

function normalizedId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized
    && normalized.length <= 128
    && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(normalized)
    ? normalized
    : undefined;
}

function normalizedText(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized ? normalized.slice(0, limit) : undefined;
}

function normalizedOptionalText(value: unknown, limit: number): string | undefined {
  return value === undefined ? undefined : normalizedText(value, limit);
}

function normalizedTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function normalizeDialect(value: unknown): ConnectionType | undefined {
  return value === 'mysql' || value === 'postgresql' || value === 'sqlite'
    ? value
    : undefined;
}

function isToolName(value: unknown): value is AiToolSummary['name'] {
  return value === 'search_schema'
    || value === 'describe_tables'
    || value === 'propose_sql_draft';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneConversation(conversation: AiConversation): AiConversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) => ({ ...message })),
    drafts: conversation.drafts.map((draft) => ({ ...draft })),
    toolSummaries: conversation.toolSummaries.map((summary) => ({ ...summary })),
  };
}
