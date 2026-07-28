export type AiMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AiToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface AiMessage {
  role: AiMessageRole;
  content: string | null;
  toolCallId?: string;
  toolCalls?: AiToolCall[];
}

export interface AiToolDefinition {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

export type AiToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | {
    name: string;
  };

export interface AiModelRequest {
  messages: AiMessage[];
  tools?: AiToolDefinition[];
  toolChoice?: AiToolChoice;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface AiModelStreamOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface AiModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export type AiModelStreamEvent =
  | {
    type: 'text-delta';
    delta: string;
  }
  | {
    type: 'tool-call';
    toolCall: AiToolCall;
  }
  | {
    type: 'finish';
    finishReason?: string;
    usage?: AiModelUsage;
  };

export interface AiModelAdapter {
  stream(
    request: AiModelRequest,
    options?: AiModelStreamOptions,
  ): AsyncIterable<AiModelStreamEvent>;
}

export interface AiModelConfiguration {
  baseUrl: string;
  endpoint: string;
  model: string;
  apiKey?: string;
  loopback: boolean;
}

export interface AiModelConfigurationProvider {
  load(): Promise<AiModelConfiguration>;
}
