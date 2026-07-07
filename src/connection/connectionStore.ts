import type { Memento, SecretStorage } from 'vscode';
import {
  type ConnectionConfig,
  type ConnectionConfigPatch,
  type NewConnectionConfig,
  generateConnectionId,
  isConnectionType,
  normalizeConnectionConfig,
  normalizeConnectionGroup,
  normalizeConnectionId,
  stripUndefined,
} from './types';

const DEFAULT_CONNECTIONS_KEY = 'databaseClient.connections';
const DEFAULT_SECRET_PREFIX = 'databaseClient.connection.';

interface StoredConnectionState {
  version: 1;
  connections: ConnectionConfig[];
}

export interface ConnectionStoreOptions {
  connectionsKey?: string;
  secretPrefix?: string;
}

export class ConnectionStore {
  private readonly connectionsKey: string;
  private readonly secretPrefix: string;

  constructor(
    private readonly globalState: Memento,
    private readonly secrets: SecretStorage,
    options: ConnectionStoreOptions = {}
  ) {
    this.connectionsKey = options.connectionsKey ?? DEFAULT_CONNECTIONS_KEY;
    this.secretPrefix = options.secretPrefix ?? DEFAULT_SECRET_PREFIX;
  }

  async list(): Promise<ConnectionConfig[]> {
    return this.readConnections();
  }

  async get(id: string): Promise<ConnectionConfig | undefined> {
    const connections = await this.readConnections();
    const config = connections.find((connection) => connection.id === id);
    return config ? { ...config } : undefined;
  }

  async create(
    input: NewConnectionConfig,
    password?: string
  ): Promise<ConnectionConfig> {
    const connections = await this.readConnections();
    const id =
      (input.id ? normalizeConnectionId(input.id) : undefined) ??
      generateConnectionId(
        { ...input, group: normalizeConnectionGroup(input.group) },
        connections.map((connection) => connection.id)
      );

    if (connections.some((connection) => connection.id === id)) {
      throw new Error(`Connection id already exists: ${id}`);
    }

    const config = normalizeConnectionConfig({ ...input, id });
    await this.writeConnections([...connections, config]);

    if (password !== undefined) {
      await this.savePassword(config.id, password);
    }

    return { ...config };
  }

  async update(
    id: string,
    patch: ConnectionConfigPatch
  ): Promise<ConnectionConfig> {
    const connections = await this.readConnections();
    const index = connections.findIndex((connection) => connection.id === id);

    if (index === -1) {
      throw new Error(`Connection not found: ${id}`);
    }

    const nextConfig = normalizeConnectionConfig({
      ...connections[index],
      ...patch,
      id,
      group: normalizeConnectionGroup(patch.group ?? connections[index].group),
    });
    const nextConnections = [...connections];
    nextConnections[index] = nextConfig;

    await this.writeConnections(nextConnections);
    return { ...nextConfig };
  }

  async delete(id: string): Promise<void> {
    const connections = await this.readConnections();
    const nextConnections = connections.filter(
      (connection) => connection.id !== id
    );

    if (nextConnections.length === connections.length) {
      return;
    }

    await this.writeConnections(nextConnections);
    await this.deletePassword(id);
  }

  async savePassword(id: string, password: string): Promise<void> {
    await this.secrets.store(this.passwordKey(id), password);
  }

  async getPassword(id: string): Promise<string | undefined> {
    return this.secrets.get(this.passwordKey(id));
  }

  async deletePassword(id: string): Promise<void> {
    await this.secrets.delete(this.passwordKey(id));
  }

  private async readConnections(): Promise<ConnectionConfig[]> {
    const stored = this.globalState.get<
      StoredConnectionState | ConnectionConfig[] | undefined
    >(
      this.connectionsKey
    );
    const connections = Array.isArray(stored) ? stored : stored?.connections;

    if (!connections) {
      return [];
    }

    return connections.map(sanitizeForStorage);
  }

  private async writeConnections(
    connections: ConnectionConfig[]
  ): Promise<void> {
    const sanitized = connections.map(sanitizeForStorage);
    const state: StoredConnectionState = {
      version: 1,
      connections: sanitized,
    };

    await this.globalState.update(this.connectionsKey, state);
  }

  private passwordKey(id: string): string {
    return `${this.secretPrefix}${id}.password`;
  }
}

function sanitizeForStorage(config: ConnectionConfig): ConnectionConfig {
  if (!isConnectionType(config.type)) {
    throw new Error(`Unsupported connection type: ${String(config.type)}`);
  }

  return stripUndefined({
    id: config.id,
    name: config.name,
    type: config.type,
    group: normalizeConnectionGroup(config.group),
    host: config.host,
    port: config.port,
    database: config.database,
    username: config.username,
    path: config.path,
    readonly: config.readonly || undefined,
    prod: config.prod || undefined,
  });
}
