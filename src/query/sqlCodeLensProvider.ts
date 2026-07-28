import * as vscode from 'vscode';
import { AiCommandIds } from '../ai/ids';
import { QueryCommandIds } from './commands';
import { getSqlStatementRanges } from './sqlParser';

const MAX_CODELENSES = 200;

export interface SqlCodeLensController extends vscode.Disposable {
  refresh(): void;
}

export function registerSqlCodeLensProvider(): SqlCodeLensController {
  const refreshEmitter = new vscode.EventEmitter<void>();
  const registration = vscode.languages.registerCodeLensProvider(
    { language: 'sql', scheme: '*' },
    {
      onDidChangeCodeLenses: refreshEmitter.event,
      provideCodeLenses(document) {
        return getSqlStatementRanges(document.getText())
          .slice(0, MAX_CODELENSES)
          .flatMap((statementRange, index) => {
            const range = new vscode.Range(
              document.positionAt(statementRange.start),
              document.positionAt(statementRange.end),
            );
            const lineRange = new vscode.Range(range.start, range.start);

            return [
              new vscode.CodeLens(lineRange, {
                title: `Run Statement${index === 0 ? '' : ` #${index + 1}`}`,
                command: QueryCommandIds.runStatementAtRange,
                arguments: [document.uri, range],
              }),
              new vscode.CodeLens(lineRange, {
                title: 'AI Explain',
                command: AiCommandIds.explainSql,
                arguments: [document.uri, range, document.version],
              }),
            ];
          });
      },
    },
  );
  return {
    refresh() {
      refreshEmitter.fire();
    },
    dispose() {
      registration.dispose();
      refreshEmitter.dispose();
    },
  };
}
