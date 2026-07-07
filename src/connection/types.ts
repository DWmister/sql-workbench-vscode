export type ConnectionType = 'mysql' | 'postgresql' | 'sqlite';

export const DEFAULT_CONNECTION_GROUP = 'Default';

export interface ConnectionConfig {
  id: string;
  name: string;
  type: ConnectionType;
  group: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  path?: string;
  readonly?: boolean;
  prod?: boolean;
}

export type NewConnectionConfig = Omit<ConnectionConfig, 'id' | 'group'> &
  Partial<Pick<ConnectionConfig, 'id' | 'group'>>;

export type ConnectionConfigPatch = Partial<
  Omit<ConnectionConfig, 'id'>
>;

export function normalizeConnectionGroup(group?: string): string {
  const normalized = group?.trim();
  return normalized || DEFAULT_CONNECTION_GROUP;
}

export function normalizeConnectionId(value: string): string {
  const normalized = toSlug(value);
  if (!normalized) {
    throw new Error('Connection id cannot be empty.');
  }
  return normalized;
}

export function generateConnectionId(
  config: Pick<ConnectionConfig, 'type'> &
    Partial<
      Pick<
        ConnectionConfig,
        'name' | 'group' | 'host' | 'port' | 'database' | 'username' | 'path'
      >
    >,
  existingIds: Iterable<string> = []
): string {
  const usedIds = new Set(Array.from(existingIds, normalizeConnectionId));
  const group = normalizeConnectionGroup(config.group);
  const label =
    config.name ||
    config.database ||
    config.path ||
    config.host ||
    config.username ||
    'connection';
  const signature = [
    config.type,
    group,
    config.name ?? '',
    config.host ?? '',
    config.port ?? '',
    config.database ?? '',
    config.username ?? '',
    config.path ?? '',
  ].join('|');
  const base = toSlug(
    [config.type, group, label, stableHash(signature)].join('-')
  );

  if (!usedIds.has(base)) {
    return base;
  }

  let index = 2;
  let candidate = `${base}-${index}`;
  while (usedIds.has(candidate)) {
    index += 1;
    candidate = `${base}-${index}`;
  }
  return candidate;
}

export function normalizeConnectionConfig(
  config: NewConnectionConfig
): ConnectionConfig {
  const name = config.name.trim();
  if (!name) {
    throw new Error('Connection name cannot be empty.');
  }

  const normalized: ConnectionConfig = {
    id: normalizeConnectionId(config.id ?? generateConnectionId(config)),
    name,
    type: config.type,
    group: normalizeConnectionGroup(config.group),
    host: normalizeOptionalString(config.host),
    port: normalizePort(config.port),
    database: normalizeOptionalString(config.database),
    username: normalizeOptionalString(config.username),
    path: normalizeOptionalString(config.path),
    readonly: config.readonly || undefined,
    prod: config.prod || undefined,
  };

  return stripUndefined(normalized);
}

export function isConnectionType(value: unknown): value is ConnectionType {
  return value === 'mysql' || value === 'postgresql' || value === 'sqlite';
}

export function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

function normalizeOptionalString(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function normalizePort(port?: number): number | undefined {
  if (port === undefined) {
    return undefined;
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Connection port must be an integer between 1 and 65535.');
  }

  return port;
}

function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
