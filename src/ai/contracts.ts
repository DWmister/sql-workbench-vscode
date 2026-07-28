export const MAX_AI_PROMPT_LENGTH = 8_000;
export const AI_WEBVIEW_PROTOCOL_VERSION = 1;
const MAX_ID_LENGTH = 128;

export type AiWebviewMessage =
  | { type: 'ready' }
  | { type: 'submitPrompt'; requestId: string; conversationId: string; text: string }
  | { type: 'cancelRun'; runId: string }
  | { type: 'selectConversation'; conversationId: string }
  | { type: 'insertDraft'; conversationId: string; draftId: string }
  | { type: 'openDraft'; conversationId: string; draftId: string }
  | { type: 'newConversation' }
  | { type: 'clearHistory' }
  | { type: 'configure' };

export type AiWebviewDecodeResult =
  | { ok: true; message: AiWebviewMessage }
  | { ok: false; error: string };

/**
 * The single trust boundary for messages received from the AI Webview.
 *
 * Draft actions deliberately accept identifiers only. They never accept SQL
 * or connection data from the Webview; the Extension Host resolves those
 * values from its own state. Agent Chat has no SQL execution message.
 */
export function decodeAiWebviewMessage(input: unknown): AiWebviewDecodeResult {
  if (
    !isRecord(input)
    || input.protocolVersion !== AI_WEBVIEW_PROTOCOL_VERSION
    || typeof input.type !== 'string'
  ) {
    return invalid('Expected a supported AI Webview protocol message.');
  }

  switch (input.type) {
    case 'ready':
      return hasExactKeys(input, ['protocolVersion', 'type'])
        ? valid({ type: 'ready' })
        : invalid('Unexpected ready fields.');

    case 'submitPrompt': {
      if (!hasExactKeys(input, ['protocolVersion', 'type', 'requestId', 'conversationId', 'text'])) {
        return invalid('Unexpected submitPrompt fields.');
      }
      const requestId = decodeId(input.requestId);
      const conversationId = decodeId(input.conversationId);
      if (!requestId || !conversationId) {
        return invalid('Invalid requestId or conversationId.');
      }
      if (typeof input.text !== 'string') {
        return invalid('Prompt must be a string.');
      }
      const text = input.text.trim();
      if (!text) {
        return invalid('Prompt cannot be empty.');
      }
      if (text.length > MAX_AI_PROMPT_LENGTH) {
        return invalid(`Prompt cannot exceed ${MAX_AI_PROMPT_LENGTH} characters.`);
      }
      return valid({ type: 'submitPrompt', requestId, conversationId, text });
    }

    case 'cancelRun': {
      if (!hasExactKeys(input, ['protocolVersion', 'type', 'runId'])) {
        return invalid('Unexpected cancelRun fields.');
      }
      const runId = decodeId(input.runId);
      return runId
        ? valid({ type: 'cancelRun', runId })
        : invalid('Invalid runId.');
    }

    case 'selectConversation': {
      if (!hasExactKeys(input, ['protocolVersion', 'type', 'conversationId'])) {
        return invalid('Unexpected selectConversation fields.');
      }
      const conversationId = decodeId(input.conversationId);
      return conversationId
        ? valid({ type: 'selectConversation', conversationId })
        : invalid('Invalid conversationId.');
    }

    case 'insertDraft':
    case 'openDraft': {
      if (!hasExactKeys(input, ['protocolVersion', 'type', 'conversationId', 'draftId'])) {
        return invalid(`Unexpected ${input.type} fields.`);
      }
      const conversationId = decodeId(input.conversationId);
      const draftId = decodeId(input.draftId);
      return conversationId && draftId
        ? valid({ type: input.type, conversationId, draftId })
        : invalid('Invalid conversationId or draftId.');
    }

    case 'newConversation':
    case 'clearHistory':
    case 'configure':
      return hasExactKeys(input, ['protocolVersion', 'type'])
        ? valid({ type: input.type })
        : invalid(`Unexpected ${input.type} fields.`);

    default:
      return invalid('Unsupported AI Webview message type.');
  }
}

function decodeId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized
    && normalized.length <= MAX_ID_LENGTH
    && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(normalized)
    ? normalized
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function valid(message: AiWebviewMessage): AiWebviewDecodeResult {
  return { ok: true, message };
}

function invalid(error: string): AiWebviewDecodeResult {
  return { ok: false, error };
}
