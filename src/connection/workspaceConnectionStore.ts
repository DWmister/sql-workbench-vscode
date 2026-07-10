import * as vscode from 'vscode';
import * as path from 'path';
import {
  type ConnectionConfig,
  isConnectionType,
  normalizeConnectionConfig,
  stripUndefined,
} from './types';

const WORKSPACE_CONNECTION_FILE = '.vscode/sql-workbench.json';

interface WorkspaceConnectionFile {
  version?: 1;
  connections?: WorkspaceConnectionInput[];
}

type WorkspaceConnectionInput = Partial<ConnectionConfig> & {
  password?: unknown;
  privateKey?: unknown;
  token?: unknown;
};

export class WorkspaceConnectionStore {
  async list(): Promise<ConnectionConfig[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const connections = await Promise.all(
      folders.map((folder) => this.readFolderConnections(folder)),
    );

    return connections.flat();
  }

  private async readFolderConnections(
    folder: vscode.WorkspaceFolder,
  ): Promise<ConnectionConfig[]> {
    const uri = vscode.Uri.joinPath(folder.uri, WORKSPACE_CONNECTION_FILE);
    let bytes: Uint8Array;

    try {
      bytes = await vscode.workspace.fs.readFile(uri);
    } catch {
      return [];
    }

    try {
      const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as WorkspaceConnectionFile;
      const inputs = Array.isArray(parsed.connections) ? parsed.connections : [];

      return inputs.flatMap((input) => {
        try {
          const connection = this.toConnectionConfig(input, folder.uri.toString());
          return connection ? [connection] : [];
        } catch (error) {
          void vscode.window.showWarningMessage(`Skipped workspace connection "${input.id ?? input.name ?? 'unknown'}": ${getErrorMessage(error)}`);
          return [];
        }
      });
    } catch (error) {
      void vscode.window.showWarningMessage(`Failed to read ${WORKSPACE_CONNECTION_FILE}: ${getErrorMessage(error)}`);
      return [];
    }
  }

  private toConnectionConfig(
    input: WorkspaceConnectionInput,
    folderUri: string,
  ): ConnectionConfig | undefined {
    const sensitiveFields = ['password', 'privateKey', 'token']
      .filter((field) => input[field as keyof WorkspaceConnectionInput] !== undefined);
    if (sensitiveFields.length > 0) {
      throw new Error(`Workspace connections must not include sensitive fields: ${sensitiveFields.join(', ')}. Use SQL Workbench SecretStorage instead.`);
    }

    if (!input.id || !input.name || !isConnectionType(input.type)) {
      return undefined;
    }

    return normalizeConnectionConfig(stripUndefined({
      id: `workspace-${stableHash(folderUri)}-${input.id}`,
      name: input.name,
      type: input.type,
      group: input.group ? `Workspace / ${input.group}` : 'Workspace',
      host: input.host,
      port: input.port,
      database: input.database,
      username: input.username,
      path: input.path ? resolveWorkspacePath(folderUri, input.path) : undefined,
      readonly: input.readonly ?? true,
      prod: input.prod,
    }));
  }
}

function resolveWorkspacePath(folderUri: string, value: string): string {
  if (path.isAbsolute(value)) {
    return value;
  }

  return vscode.Uri.joinPath(vscode.Uri.parse(folderUri), value).fsPath;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
