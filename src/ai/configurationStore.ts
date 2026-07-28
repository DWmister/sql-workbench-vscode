import * as vscode from 'vscode';
import type { SecretStorage, WorkspaceConfiguration } from 'vscode';
import {
  AI_API_KEY_SECRET,
  AiConfigurationKeys,
  MAX_AI_EXPLAIN_INSTRUCTIONS_LENGTH,
} from './ids';
import { AiModelError } from './modelErrors';
import type { AiModelConfiguration } from './types';

export const AI_CONFIGURATION_SECTION = 'sqlWorkbench.ai';
export const AI_BASE_URL_SETTING = AiConfigurationKeys.baseUrl.slice(`${AI_CONFIGURATION_SECTION}.`.length);
export const AI_MODEL_SETTING = AiConfigurationKeys.model.slice(`${AI_CONFIGURATION_SECTION}.`.length);
export const AI_EXPLAIN_INSTRUCTIONS_SETTING = AiConfigurationKeys.explainInstructions
  .slice(`${AI_CONFIGURATION_SECTION}.`.length);
export { AI_API_KEY_SECRET } from './ids';

const MAX_BASE_URL_LENGTH = 2_048;
const MAX_MODEL_LENGTH = 256;
const MAX_API_KEY_LENGTH = 16_384;

export interface AiConfigurationValues {
  baseUrl: string;
  model: string;
  explainInstructions: string;
  hasApiKey: boolean;
}

export interface AiConfigurationDraft {
  baseUrl: string;
  model: string;
  explainInstructions?: string;
  apiKey?: string;
}

export interface AiConfigurationStoreOptions {
  getConfiguration?: () => WorkspaceConfiguration;
  configurationTarget?: vscode.ConfigurationTarget | boolean | null;
}

export class AiConfigurationStore {
  private readonly getConfiguration: () => WorkspaceConfiguration;
  private readonly configurationTarget: vscode.ConfigurationTarget | boolean | null;

  constructor(
    private readonly secrets: SecretStorage,
    options: AiConfigurationStoreOptions = {},
  ) {
    this.getConfiguration = options.getConfiguration
      ?? (() => vscode.workspace.getConfiguration(AI_CONFIGURATION_SECTION));
    this.configurationTarget = options.configurationTarget
      ?? vscode.ConfigurationTarget.Global;
  }

  async getValues(): Promise<AiConfigurationValues> {
    const configuration = this.getConfiguration();
    const apiKey = await this.secrets.get(AI_API_KEY_SECRET);
    return {
      baseUrl: normalizeSetting(configuration.get<unknown>(AI_BASE_URL_SETTING)),
      model: normalizeSetting(configuration.get<unknown>(AI_MODEL_SETTING)),
      explainInstructions: normalizeSetting(
        configuration.get<unknown>(AI_EXPLAIN_INSTRUCTIONS_SETTING),
      ),
      hasApiKey: Boolean(apiKey?.trim()),
    };
  }

  async load(): Promise<AiModelConfiguration> {
    const configuration = this.getConfiguration();
    const apiKey = await this.secrets.get(AI_API_KEY_SECRET);
    return validateAiConfiguration({
      baseUrl: normalizeSetting(configuration.get<unknown>(AI_BASE_URL_SETTING)),
      model: normalizeSetting(configuration.get<unknown>(AI_MODEL_SETTING)),
      apiKey,
    });
  }

  async save(draft: AiConfigurationDraft): Promise<AiModelConfiguration> {
    const validated = validateAiConfiguration(draft);
    const explainInstructions = validateExplainInstructions(
      draft.explainInstructions ?? '',
    );
    const configuration = this.getConfiguration();

    await configuration.update(
      AI_BASE_URL_SETTING,
      validated.baseUrl,
      this.configurationTarget,
    );
    await configuration.update(
      AI_MODEL_SETTING,
      validated.model,
      this.configurationTarget,
    );
    await configuration.update(
      AI_EXPLAIN_INSTRUCTIONS_SETTING,
      explainInstructions,
      this.configurationTarget,
    );

    if (validated.apiKey === undefined) {
      await this.secrets.delete(AI_API_KEY_SECRET);
    } else {
      await this.secrets.store(AI_API_KEY_SECRET, validated.apiKey);
    }

    return validated;
  }

  getExplainInstructions(): string {
    return validateExplainInstructions(
      this.getConfiguration().get<unknown>(AI_EXPLAIN_INSTRUCTIONS_SETTING),
    );
  }

  async getApiKey(): Promise<string | undefined> {
    return this.secrets.get(AI_API_KEY_SECRET);
  }

  async deleteApiKey(): Promise<void> {
    await this.secrets.delete(AI_API_KEY_SECRET);
  }
}

export function validateExplainInstructions(value: unknown): string {
  if (value === undefined) {
    return '';
  }
  if (typeof value !== 'string') {
    throw new AiModelError(
      'configuration',
      'SQL Explain instructions must be a string.',
    );
  }
  const normalized = value.trim();
  if (normalized.length > MAX_AI_EXPLAIN_INSTRUCTIONS_LENGTH) {
    throw new AiModelError(
      'configuration',
      `SQL Explain instructions cannot exceed ${MAX_AI_EXPLAIN_INSTRUCTIONS_LENGTH} characters.`,
    );
  }
  return normalized;
}

export function validateAiConfiguration(draft: AiConfigurationDraft): AiModelConfiguration {
  const baseUrl = draft.baseUrl.trim();
  const model = draft.model.trim();
  const apiKey = draft.apiKey?.trim() ? draft.apiKey : undefined;

  if (!baseUrl) {
    throw new AiModelError('configuration', 'Configure an AI API Base URL before using AI features.');
  }
  if (baseUrl.length > MAX_BASE_URL_LENGTH) {
    throw new AiModelError('configuration', 'The AI API Base URL is too long.');
  }
  if (!model) {
    throw new AiModelError('configuration', 'Configure an AI model name before using AI features.');
  }
  if (model.length > MAX_MODEL_LENGTH) {
    throw new AiModelError('configuration', 'The AI model name is too long.');
  }
  if (apiKey && apiKey.length > MAX_API_KEY_LENGTH) {
    throw new AiModelError('configuration', 'The AI API key is too long.');
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new AiModelError('configuration', 'The AI API Base URL must be an absolute URL.');
  }

  if (hasUrlUserInfo(baseUrl) || parsed.username || parsed.password) {
    throw new AiModelError('configuration', 'The AI API Base URL must not contain user information.');
  }
  if (/[?#]/.test(baseUrl)) {
    throw new AiModelError('configuration', 'The AI API Base URL must not contain a query or fragment.');
  }
  if (!parsed.hostname) {
    throw new AiModelError('configuration', 'The AI API Base URL must include a host.');
  }

  const loopback = isStrictLoopbackHost(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw new AiModelError(
      'configuration',
      'The AI API Base URL must use HTTPS. HTTP is allowed only for a loopback development endpoint.',
    );
  }
  if (!apiKey && !loopback) {
    throw new AiModelError(
      'configuration',
      'An AI API key is required unless the API is a loopback development endpoint.',
    );
  }

  parsed.pathname = normalizeBasePath(parsed.pathname);
  const normalizedBaseUrl = parsed.toString().replace(/\/$/, '');
  const endpointUrl = new URL(parsed.toString());
  if (!endpointUrl.pathname.endsWith('/chat/completions')) {
    endpointUrl.pathname = `${endpointUrl.pathname.replace(/\/$/, '')}/chat/completions`;
  }

  return {
    baseUrl: normalizedBaseUrl,
    endpoint: endpointUrl.toString(),
    model,
    apiKey,
    loopback,
  };
}

export function isStrictLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost'
    || isIpv4Loopback(normalized)
    || normalized === '::1'
    || normalized === '[::1]';
}

function isIpv4Loopback(hostname: string): boolean {
  const parts = hostname.split('.');
  return parts.length === 4
    && parts[0] === '127'
    && parts.every((part) => (
      /^\d{1,3}$/.test(part)
      && Number(part) >= 0
      && Number(part) <= 255
    ));
}

function normalizeBasePath(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, '');
  return normalized || '/';
}

function normalizeSetting(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hasUrlUserInfo(value: string): boolean {
  const authority = /^[A-Za-z][A-Za-z\d+.-]*:\/\/([^/]*)/.exec(value)?.[1];
  return authority?.includes('@') === true;
}
