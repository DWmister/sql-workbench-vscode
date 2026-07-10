import * as vscode from 'vscode';
import { createHash } from 'crypto';
import type { ConnectionConfig } from './types';

const ACTIVE_CONNECTION_KEY = 'sqlWorkbench.activeConnectionId';
const DOCUMENT_CONNECTIONS_KEY = 'sqlWorkbench.documentConnectionIds';
const DOCUMENT_FINGERPRINT_CONNECTIONS_KEY = 'sqlWorkbench.documentFingerprintConnectionIds';

export interface ConnectionResolver {
  get(id: string): Promise<ConnectionConfig | undefined>;
  list(): Promise<ConnectionConfig[]>;
}

interface DocumentFingerprintBinding {
  connectionId: string;
  documentKey: string;
  updatedAt: string;
}

export class ActiveConnectionState {
  private readonly transientDocumentBindings = new WeakMap<vscode.TextDocument, string>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly connectionStore: ConnectionResolver,
  ) {}

  public getId(document?: vscode.TextDocument): string | undefined {
    const documentId = document ? this.getDocumentConnectionId(document) : undefined;
    return documentId ?? this.context.globalState.get<string>(ACTIVE_CONNECTION_KEY);
  }

  public getDocumentBindingId(document: vscode.TextDocument): string | undefined {
    return this.getDocumentConnectionId(document);
  }

  public async get(document?: vscode.TextDocument): Promise<ConnectionConfig | undefined> {
    const id = this.getId(document);
    return id ? this.connectionStore.get(id) : undefined;
  }

  public async list(): Promise<ConnectionConfig[]> {
    return this.connectionStore.list();
  }

  public async set(id: string | undefined, document?: vscode.TextDocument): Promise<void> {
    if (document && isSqlDocument(document)) {
      const bindings = this.getDocumentBindings();
      const fingerprintBindings = this.getDocumentFingerprintBindings();
      const key = getDocumentKey(document);
      const fingerprint = getDocumentFingerprint(document);
      if (id) {
        bindings[key] = id;
        if (fingerprint) {
          fingerprintBindings[fingerprint] = {
            connectionId: id,
            documentKey: key,
            updatedAt: new Date().toISOString(),
          };
        }
        this.transientDocumentBindings.set(document, id);
      } else {
        delete bindings[key];
        if (fingerprint) {
          delete fingerprintBindings[fingerprint];
        }
        this.transientDocumentBindings.delete(document);
      }
      await this.context.workspaceState.update(DOCUMENT_CONNECTIONS_KEY, bindings);
      await this.context.workspaceState.update(DOCUMENT_FINGERPRINT_CONNECTIONS_KEY, fingerprintBindings);
    }

    await this.context.globalState.update(ACTIVE_CONNECTION_KEY, id);
  }

  public async restoreDocumentBinding(document: vscode.TextDocument): Promise<ConnectionConfig | undefined> {
    if (!isSqlDocument(document) || this.getDocumentConnectionId(document)) {
      return undefined;
    }

    const fingerprint = getDocumentFingerprint(document);
    if (!fingerprint) {
      return undefined;
    }
    const match = this.getDocumentFingerprintBindings()[fingerprint];
    if (!match || match.documentKey === getDocumentKey(document)) {
      return undefined;
    }

    const connection = await this.connectionStore.get(match.connectionId);
    if (!connection) {
      const fingerprintBindings = this.getDocumentFingerprintBindings();
      delete fingerprintBindings[fingerprint];
      await this.context.workspaceState.update(DOCUMENT_FINGERPRINT_CONNECTIONS_KEY, fingerprintBindings);
      return undefined;
    }

    const confirmed = await vscode.window.showInformationMessage(
      [
        `Restore SQL Workbench connection "${connection.name}" for this SQL file?`,
        `It matches a previously bound file: ${formatDocumentKey(match.documentKey)}`,
      ].join('\n'),
      'Restore Connection',
      'Not Now',
    );

    if (confirmed !== 'Restore Connection') {
      return undefined;
    }

    await this.set(connection.id, document);
    return connection;
  }

  public async deleteConnectionBindings(id: string): Promise<void> {
    const bindings = this.getDocumentBindings();
    const nextBindings = Object.fromEntries(
      Object.entries(bindings).filter(([, connectionId]) => connectionId !== id),
    );
    const fingerprintBindings = this.getDocumentFingerprintBindings();
    const nextFingerprintBindings = Object.fromEntries(
      Object.entries(fingerprintBindings).filter(([, binding]) => binding.connectionId !== id),
    );
    await this.context.workspaceState.update(DOCUMENT_CONNECTIONS_KEY, nextBindings);
    await this.context.workspaceState.update(DOCUMENT_FINGERPRINT_CONNECTIONS_KEY, nextFingerprintBindings);
  }

  private getDocumentConnectionId(document: vscode.TextDocument): string | undefined {
    if (!isSqlDocument(document)) {
      return undefined;
    }

    return this.transientDocumentBindings.get(document)
      ?? this.getDocumentBindings()[getDocumentKey(document)];
  }

  private getDocumentBindings(): Record<string, string> {
    return this.context.workspaceState.get<Record<string, string>>(DOCUMENT_CONNECTIONS_KEY, {});
  }

  private getDocumentFingerprintBindings(): Record<string, DocumentFingerprintBinding> {
    return this.context.workspaceState.get<Record<string, DocumentFingerprintBinding>>(DOCUMENT_FINGERPRINT_CONNECTIONS_KEY, {});
  }
}

export function isSqlDocument(document: vscode.TextDocument): boolean {
  return document.languageId === 'sql';
}

export function getDocumentFingerprint(document: vscode.TextDocument): string | undefined {
  const normalized = normalizeSqlDocumentText(document.getText());
  if (normalized.length < 20) {
    return undefined;
  }

  return createHash('sha256')
    .update(normalized)
    .digest('hex');
}

function getDocumentKey(document: vscode.TextDocument): string {
  return document.uri.toString();
}

function normalizeSqlDocumentText(text: string): string {
  return text.replace(/\r\n/gu, '\n').trim();
}

function formatDocumentKey(key: string): string {
  try {
    const uri = vscode.Uri.parse(key);
    return uri.scheme === 'file' ? uri.fsPath : key;
  } catch {
    return key;
  }
}
