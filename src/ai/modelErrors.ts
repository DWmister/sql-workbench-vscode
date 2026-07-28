export type AiModelErrorCode =
  | 'configuration'
  | 'authentication'
  | 'rate-limit'
  | 'cancelled'
  | 'timeout'
  | 'network'
  | 'provider'
  | 'invalid-response'
  | 'request-too-large'
  | 'response-too-large';

export interface AiModelErrorOptions {
  status?: number;
  retryAfterMs?: number;
  cause?: unknown;
}

export class AiModelError extends Error {
  readonly code: AiModelErrorCode;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(code: AiModelErrorCode, message: string, options: AiModelErrorOptions = {}) {
    super(sanitizeAiErrorText(message));
    this.name = 'AiModelError';
    this.code = code;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export function createHttpModelError(
  status: number,
  providerMessage?: string,
  retryAfterMs?: number,
): AiModelError {
  if (status === 401 || status === 403) {
    return new AiModelError(
      'authentication',
      'The configured AI API rejected the credentials.',
      { status },
    );
  }

  if (status === 429) {
    return new AiModelError(
      'rate-limit',
      'The configured AI API rate limit was reached. Try again later.',
      { status, retryAfterMs },
    );
  }

  const safeDetail = providerMessage
    ? ` ${sanitizeAiErrorText(providerMessage).slice(0, 500)}`
    : '';
  return new AiModelError(
    'provider',
    `The configured AI API returned HTTP ${status}.${safeDetail}`,
    { status, retryAfterMs },
  );
}

export function sanitizeAiErrorText(value: string): string {
  return redactCredentialPatterns(value);
}

export function redactCredentialPatterns(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(sk-[A-Za-z0-9_-]{8})[A-Za-z0-9_-]*/g, '$1[REDACTED]')
    .replace(/([?&](?:api[_-]?key|token|access[_-]?token|key)=)[^&#\s]*/gi, '$1[REDACTED]')
    .replace(
      /([A-Za-z][A-Za-z\d+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi,
      '$1[REDACTED]@',
    );
}

export function redactExactSecret(
  value: string,
  secret: string | undefined,
  replacement = '[REDACTED_API_KEY]',
): string {
  return secret
    ? value.split(secret).join(replacement)
    : value;
}

export function getSafeErrorMessage(error: unknown): string {
  if (error instanceof AiModelError) {
    return error.message;
  }

  if (error instanceof Error) {
    return sanitizeAiErrorText(error.message);
  }

  return 'The AI model request failed.';
}
