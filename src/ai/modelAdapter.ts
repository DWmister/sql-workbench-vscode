import { AiModelError } from './modelErrors';
import type {
  AiModelAdapter,
  AiModelRequest,
  AiModelStreamEvent,
  AiModelStreamOptions,
  AiToolCall,
} from './types';

export type {
  AiModelAdapter,
  AiModelRequest,
  AiModelStreamEvent,
  AiModelStreamOptions,
};

export interface AiModelCompletion {
  content: string;
  toolCalls: AiToolCall[];
  finishReason?: string;
}

export async function collectAiModelCompletion(
  adapter: AiModelAdapter,
  request: AiModelRequest,
  options?: AiModelStreamOptions,
): Promise<AiModelCompletion> {
  let content = '';
  const toolCalls: AiToolCall[] = [];
  let finishReason: string | undefined;

  for await (const event of adapter.stream(request, options)) {
    switch (event.type) {
      case 'text-delta':
        content += event.delta;
        break;
      case 'tool-call':
        toolCalls.push(event.toolCall);
        break;
      case 'finish':
        finishReason = event.finishReason;
        break;
      default:
        assertNever(event);
    }
  }

  return { content, toolCalls, finishReason };
}

export function validateAiModelRequest(request: AiModelRequest): void {
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    throw new AiModelError('configuration', 'An AI model request must contain at least one message.');
  }

  for (const message of request.messages) {
    if (!['system', 'user', 'assistant', 'tool'].includes(message.role)) {
      throw new AiModelError('configuration', 'An AI model request contains an invalid message role.');
    }
    if (message.content !== null && typeof message.content !== 'string') {
      throw new AiModelError('configuration', 'An AI model request contains invalid message content.');
    }
    if (message.role === 'tool' && !message.toolCallId) {
      throw new AiModelError('configuration', 'A tool result message must identify its tool call.');
    }
  }

  if (request.temperature !== undefined
    && (!Number.isFinite(request.temperature) || request.temperature < 0 || request.temperature > 2)) {
    throw new AiModelError('configuration', 'The AI model temperature must be between 0 and 2.');
  }

  if (request.maxOutputTokens !== undefined
    && (!Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens <= 0)) {
    throw new AiModelError('configuration', 'The AI model output token limit must be a positive integer.');
  }
}

function assertNever(value: never): never {
  throw new AiModelError('invalid-response', `Unsupported AI stream event: ${String(value)}`);
}
