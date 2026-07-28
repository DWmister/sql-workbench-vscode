import {
  AiModelError,
  createHttpModelError,
  redactExactSecret,
} from './modelErrors';
import { validateAiModelRequest } from './modelAdapter';
import { SseParser, type ServerSentEvent } from './sseParser';
import type {
  AiMessage,
  AiModelAdapter,
  AiModelConfigurationProvider,
  AiModelRequest,
  AiModelStreamEvent,
  AiModelStreamOptions,
  AiModelUsage,
  AiToolCall,
} from './types';

export type AiFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface OpenAiCompatibleAdapterOptions {
  fetch?: AiFetch;
  defaultTimeoutMs?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  maxContentBytes?: number;
  maxToolArgumentsBytes?: number;
  maxToolCalls?: number;
  maxEventBytes?: number;
}

interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

interface ParsedChunk {
  textDeltas: string[];
  finishReason?: string;
  usage?: AiModelUsage;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_REQUEST_BYTES = 1024 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_CONTENT_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_TOOL_ARGUMENTS_BYTES = 512 * 1024;
const DEFAULT_MAX_TOOL_CALLS = 32;
const DEFAULT_MAX_EVENT_BYTES = 512 * 1024;
const MAX_ERROR_BODY_BYTES = 16 * 1024;

export class OpenAiCompatibleAdapter implements AiModelAdapter {
  private readonly fetchImplementation: AiFetch;
  private readonly defaultTimeoutMs: number;
  private readonly maxRequestBytes: number;
  private readonly maxResponseBytes: number;
  private readonly maxContentBytes: number;
  private readonly maxToolArgumentsBytes: number;
  private readonly maxToolCalls: number;
  private readonly maxEventBytes: number;

  constructor(
    private readonly configurationStore: AiModelConfigurationProvider,
    options: OpenAiCompatibleAdapterOptions = {},
  ) {
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRequestBytes = options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.maxContentBytes = options.maxContentBytes ?? DEFAULT_MAX_CONTENT_BYTES;
    this.maxToolArgumentsBytes = options.maxToolArgumentsBytes ?? DEFAULT_MAX_TOOL_ARGUMENTS_BYTES;
    this.maxToolCalls = options.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
    this.maxEventBytes = options.maxEventBytes ?? DEFAULT_MAX_EVENT_BYTES;
  }

  async *stream(
    request: AiModelRequest,
    options: AiModelStreamOptions = {},
  ): AsyncIterable<AiModelStreamEvent> {
    validateAiModelRequest(request);
    const configuration = await this.configurationStore.load();
    let body: string;
    try {
      const payload = toOpenAiRequest(configuration.model, request);
      body = JSON.stringify(configuration.apiKey
        ? redactExactSecretInValue(payload, configuration.apiKey)
        : payload);
    } catch (error) {
      throw new AiModelError(
        'configuration',
        'The AI model request could not be serialized.',
        { cause: error },
      );
    }
    if (Buffer.byteLength(body, 'utf8') > this.maxRequestBytes) {
      throw new AiModelError('request-too-large', 'The AI model request exceeded the allowed size.');
    }

    const externalSignal = options.signal;
    if (externalSignal?.aborted) {
      throw new AiModelError('cancelled', 'The AI model request was cancelled.');
    }

    const controller = new AbortController();
    let timeoutTriggered = false;
    const timeoutMs = normalizeTimeout(options.timeoutMs ?? this.defaultTimeoutMs);
    const timeout = setTimeout(() => {
      timeoutTriggered = true;
      controller.abort();
    }, timeoutMs);
    const cancel = () => controller.abort();
    externalSignal?.addEventListener('abort', cancel, { once: true });

    try {
      const headers: Record<string, string> = {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
      };
      if (configuration.apiKey) {
        headers.Authorization = `Bearer ${configuration.apiKey}`;
      }

      let response: Response;
      try {
        response = await this.fetchImplementation(configuration.endpoint, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
          redirect: 'error',
        });
      } catch (error) {
        throw classifyRequestFailure(error, timeoutTriggered, externalSignal?.aborted === true);
      }

      if (!response.ok) {
        let detail: string | undefined;
        try {
          detail = await readErrorDetail(response, this.maxResponseBytes);
        } catch (error) {
          throw classifyRequestFailure(error, timeoutTriggered, externalSignal?.aborted === true);
        }
        if (configuration.apiKey && detail) {
          detail = detail.split(configuration.apiKey).join('[REDACTED]');
        }
        throw createHttpModelError(
          response.status,
          detail,
          parseRetryAfter(response.headers.get('retry-after')),
        );
      }
      if (!response.body) {
        throw new AiModelError('invalid-response', 'The AI API returned an empty response stream.');
      }

      const parser = new SseParser({
        maxEventBytes: this.maxEventBytes,
        maxBufferedBytes: this.maxEventBytes,
      });
      const toolCalls = new Map<number, ToolCallAccumulator>();
      let responseBytes = 0;
      let contentBytes = 0;
      let finishReason: string | undefined;
      let usage: AiModelUsage | undefined;
      let completed = false;
      let sawDataEvent = false;

      try {
        for await (const chunk of response.body) {
          responseBytes += chunk.byteLength;
          if (responseBytes > this.maxResponseBytes) {
            throw new AiModelError('response-too-large', 'The AI API response exceeded the allowed size.');
          }

          for (const event of parser.push(chunk)) {
            sawDataEvent = true;
            if (event.data.trim() === '[DONE]') {
              completed = true;
              break;
            }
            const parsed = parseStreamEvent(
              event,
              toolCalls,
              this.maxToolCalls,
              this.maxToolArgumentsBytes,
            );
            finishReason = parsed.finishReason ?? finishReason;
            usage = parsed.usage ?? usage;
            for (const delta of parsed.textDeltas) {
              contentBytes += Buffer.byteLength(delta, 'utf8');
              if (contentBytes > this.maxContentBytes) {
                throw new AiModelError('response-too-large', 'The AI API text response exceeded the allowed size.');
              }
              if (delta) {
                yield { type: 'text-delta', delta };
              }
            }
          }
          if (completed) {
            break;
          }
        }

        if (!completed) {
          for (const event of parser.finish()) {
            sawDataEvent = true;
            if (event.data.trim() === '[DONE]') {
              completed = true;
              continue;
            }
            const parsed = parseStreamEvent(
              event,
              toolCalls,
              this.maxToolCalls,
              this.maxToolArgumentsBytes,
            );
            finishReason = parsed.finishReason ?? finishReason;
            usage = parsed.usage ?? usage;
            for (const delta of parsed.textDeltas) {
              contentBytes += Buffer.byteLength(delta, 'utf8');
              if (contentBytes > this.maxContentBytes) {
                throw new AiModelError('response-too-large', 'The AI API text response exceeded the allowed size.');
              }
              if (delta) {
                yield { type: 'text-delta', delta };
              }
            }
          }
        }
      } catch (error) {
        if (error instanceof AiModelError) {
          throw error;
        }
        throw classifyRequestFailure(error, timeoutTriggered, externalSignal?.aborted === true);
      }

      if (timeoutTriggered) {
        throw new AiModelError('timeout', 'The AI model request timed out.');
      }
      if (externalSignal?.aborted) {
        throw new AiModelError('cancelled', 'The AI model request was cancelled.');
      }
      if (!sawDataEvent) {
        throw new AiModelError(
          'invalid-response',
          'The AI API response was not a valid server-sent event stream.',
        );
      }

      for (const toolCall of finalizeToolCalls(toolCalls)) {
        yield { type: 'tool-call', toolCall };
      }
      yield { type: 'finish', finishReason, usage };
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', cancel);
      controller.abort();
    }
  }
}

function toOpenAiRequest(model: string, request: AiModelRequest): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model,
    stream: true,
    messages: request.messages.map(toOpenAiMessage),
  };

  if (request.tools?.length) {
    payload.tools = request.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }
  if (request.toolChoice !== undefined) {
    payload.tool_choice = typeof request.toolChoice === 'string'
      ? request.toolChoice
      : {
        type: 'function',
        function: { name: request.toolChoice.name },
      };
  }
  if (request.temperature !== undefined) {
    payload.temperature = request.temperature;
  }
  if (request.maxOutputTokens !== undefined) {
    payload.max_tokens = request.maxOutputTokens;
  }

  return payload;
}

function redactExactSecretInValue(
  value: unknown,
  secret: string,
): unknown {
  if (typeof value === 'string') {
    return redactExactSecret(value, secret);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactExactSecretInValue(entry, secret));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        redactExactSecretInValue(entry, secret),
      ]),
    );
  }
  return value;
}

function toOpenAiMessage(message: AiMessage): Record<string, unknown> {
  const output: Record<string, unknown> = {
    role: message.role,
    content: message.content,
  };
  if (message.toolCallId) {
    output.tool_call_id = message.toolCallId;
  }
  if (message.toolCalls?.length) {
    output.tool_calls = message.toolCalls.map((toolCall) => ({
      id: toolCall.id,
      type: 'function',
      function: {
        name: toolCall.name,
        arguments: toolCall.arguments,
      },
    }));
  }
  return output;
}

function parseStreamEvent(
  event: ServerSentEvent,
  toolCalls: Map<number, ToolCallAccumulator>,
  maxToolCalls: number,
  maxToolArgumentsBytes: number,
): ParsedChunk {
  let payload: unknown;
  try {
    payload = JSON.parse(event.data);
  } catch {
    throw new AiModelError('invalid-response', 'The AI API returned invalid stream JSON.');
  }
  if (!isRecord(payload)) {
    throw new AiModelError('invalid-response', 'The AI API returned an invalid stream payload.');
  }

  const result: ParsedChunk = {
    textDeltas: [],
    usage: parseUsage(payload.usage),
  };
  if (!Array.isArray(payload.choices)) {
    return result;
  }

  for (const choice of payload.choices) {
    if (!isRecord(choice)) {
      continue;
    }
    if (typeof choice.finish_reason === 'string') {
      result.finishReason = choice.finish_reason;
    }
    if (!isRecord(choice.delta)) {
      continue;
    }
    if (typeof choice.delta.content === 'string') {
      result.textDeltas.push(choice.delta.content);
    }
    if (Array.isArray(choice.delta.tool_calls)) {
      mergeToolCallDeltas(
        choice.delta.tool_calls,
        toolCalls,
        maxToolCalls,
        maxToolArgumentsBytes,
      );
    }
  }

  return result;
}

function mergeToolCallDeltas(
  deltas: unknown[],
  toolCalls: Map<number, ToolCallAccumulator>,
  maxToolCalls: number,
  maxToolArgumentsBytes: number,
): void {
  for (const delta of deltas) {
    if (!isRecord(delta) || !Number.isInteger(delta.index) || Number(delta.index) < 0) {
      throw new AiModelError('invalid-response', 'The AI API returned an invalid tool call index.');
    }

    const index = Number(delta.index);
    let accumulator = toolCalls.get(index);
    if (!accumulator) {
      if (toolCalls.size >= maxToolCalls) {
        throw new AiModelError('response-too-large', 'The AI API returned too many tool calls.');
      }
      accumulator = { id: '', name: '', arguments: '' };
      toolCalls.set(index, accumulator);
    }

    if (typeof delta.id === 'string') {
      accumulator.id += delta.id;
    }
    if (isRecord(delta.function)) {
      if (typeof delta.function.name === 'string') {
        accumulator.name += delta.function.name;
      }
      if (typeof delta.function.arguments === 'string') {
        accumulator.arguments += delta.function.arguments;
        if (Buffer.byteLength(accumulator.arguments, 'utf8') > maxToolArgumentsBytes) {
          throw new AiModelError('response-too-large', 'AI tool call arguments exceeded the allowed size.');
        }
      }
    }
  }
}

function finalizeToolCalls(toolCalls: Map<number, ToolCallAccumulator>): AiToolCall[] {
  return [...toolCalls.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, toolCall]) => {
      if (!toolCall.id || !toolCall.name) {
        throw new AiModelError('invalid-response', 'The AI API returned an incomplete tool call.');
      }
      return { ...toolCall };
    });
}

function parseUsage(value: unknown): AiModelUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const usage: AiModelUsage = {};
  if (isNonNegativeNumber(value.prompt_tokens)) {
    usage.inputTokens = value.prompt_tokens;
  }
  if (isNonNegativeNumber(value.completion_tokens)) {
    usage.outputTokens = value.completion_tokens;
  }
  if (isNonNegativeNumber(value.total_tokens)) {
    usage.totalTokens = value.total_tokens;
  }
  return Object.keys(usage).length > 0 ? usage : undefined;
}

async function readErrorDetail(response: Response, maxResponseBytes: number): Promise<string | undefined> {
  if (!response.body) {
    return undefined;
  }

  const limit = Math.min(MAX_ERROR_BODY_BYTES, maxResponseBytes);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size <= limit) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      size += next.value.byteLength;
      if (size > limit) {
        break;
      }
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const text = new TextDecoder().decode(Buffer.concat(chunks)).trim();
  if (!text) {
    return undefined;
  }

  try {
    const payload: unknown = JSON.parse(text);
    if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === 'string') {
      return payload.error.message;
    }
    if (isRecord(payload) && typeof payload.message === 'string') {
      return payload.message;
    }
  } catch {
    // Compatible providers do not always return JSON error bodies.
  }
  return text;
}

function classifyRequestFailure(
  error: unknown,
  timeoutTriggered: boolean,
  externallyCancelled: boolean,
): AiModelError {
  if (timeoutTriggered) {
    return new AiModelError('timeout', 'The AI model request timed out.', { cause: error });
  }
  if (externallyCancelled || isAbortError(error)) {
    return new AiModelError('cancelled', 'The AI model request was cancelled.', { cause: error });
  }
  return new AiModelError('network', 'Could not reach the configured AI API.', { cause: error });
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    return Math.max(0, Math.round(Number(value) * 1000));
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return undefined;
  }
  return Math.max(0, timestamp - Date.now());
}

function normalizeTimeout(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new AiModelError('configuration', 'The AI model timeout must be a positive number.');
  }
  return Math.max(1, Math.min(Math.round(timeoutMs), 10 * 60_000));
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
