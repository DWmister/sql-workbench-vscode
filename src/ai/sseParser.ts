import { AiModelError } from './modelErrors';

export interface ServerSentEvent {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}

export interface SseParserOptions {
  maxEventBytes?: number;
  maxBufferedBytes?: number;
}

const DEFAULT_MAX_EVENT_BYTES = 512 * 1024;
const DEFAULT_MAX_BUFFERED_BYTES = 1024 * 1024;

export class SseParser {
  private readonly decoder = new TextDecoder();
  private readonly maxEventBytes: number;
  private readonly maxBufferedBytes: number;
  private buffer = '';
  private eventName: string | undefined;
  private eventId: string | undefined;
  private eventRetry: number | undefined;
  private dataLines: string[] = [];
  private currentEventBytes = 0;

  constructor(options: SseParserOptions = {}) {
    this.maxEventBytes = options.maxEventBytes ?? DEFAULT_MAX_EVENT_BYTES;
    this.maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
  }

  push(chunk: Uint8Array | string): ServerSentEvent[] {
    this.buffer += typeof chunk === 'string'
      ? chunk
      : this.decoder.decode(chunk, { stream: true });
    this.ensureBufferLimit();
    return this.consumeLines(false);
  }

  finish(): ServerSentEvent[] {
    this.buffer += this.decoder.decode();
    const events = this.consumeLines(true);
    const finalEvent = this.dispatchEvent();
    if (finalEvent) {
      events.push(finalEvent);
    }
    return events;
  }

  private consumeLines(flush: boolean): ServerSentEvent[] {
    const events: ServerSentEvent[] = [];
    let lineStart = 0;

    for (let index = 0; index < this.buffer.length; index += 1) {
      const character = this.buffer[index];
      if (character !== '\n' && character !== '\r') {
        continue;
      }
      if (character === '\r' && index === this.buffer.length - 1 && !flush) {
        break;
      }

      const line = this.buffer.slice(lineStart, index);
      if (character === '\r' && this.buffer[index + 1] === '\n') {
        index += 1;
      }
      lineStart = index + 1;
      const event = this.consumeLine(line);
      if (event) {
        events.push(event);
      }
    }

    this.buffer = this.buffer.slice(lineStart);
    if (flush && this.buffer) {
      const event = this.consumeLine(this.buffer);
      this.buffer = '';
      if (event) {
        events.push(event);
      }
    }
    this.ensureBufferLimit();
    return events;
  }

  private consumeLine(line: string): ServerSentEvent | undefined {
    this.currentEventBytes += Buffer.byteLength(line, 'utf8') + 1;
    if (this.currentEventBytes > this.maxEventBytes) {
      throw new AiModelError('response-too-large', 'An AI API stream event exceeded the allowed size.');
    }

    if (line === '') {
      return this.dispatchEvent();
    }
    if (line.startsWith(':')) {
      return undefined;
    }

    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }

    switch (field) {
      case 'event':
        this.eventName = value;
        break;
      case 'data':
        this.dataLines.push(value);
        break;
      case 'id':
        if (!value.includes('\0')) {
          this.eventId = value;
        }
        break;
      case 'retry': {
        const retry = Number(value);
        if (/^\d+$/.test(value) && Number.isSafeInteger(retry)) {
          this.eventRetry = retry;
        }
        break;
      }
      default:
        break;
    }

    return undefined;
  }

  private dispatchEvent(): ServerSentEvent | undefined {
    const event = this.dataLines.length > 0
      ? {
        event: this.eventName,
        data: this.dataLines.join('\n'),
        id: this.eventId,
        retry: this.eventRetry,
      }
      : undefined;

    this.eventName = undefined;
    this.eventRetry = undefined;
    this.dataLines = [];
    this.currentEventBytes = 0;
    return event;
  }

  private ensureBufferLimit(): void {
    if (Buffer.byteLength(this.buffer, 'utf8') > this.maxBufferedBytes) {
      throw new AiModelError('response-too-large', 'The AI API stream buffer exceeded the allowed size.');
    }
  }
}
