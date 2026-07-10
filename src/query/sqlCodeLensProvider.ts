import * as vscode from 'vscode';
import { QueryCommandIds } from './commands';
import { getSqlStatementRanges } from './sqlParser';

const MAX_CODELENSES = 200;

export function registerSqlCodeLensProvider(): vscode.Disposable {
  return vscode.languages.registerCodeLensProvider(
    { language: 'sql', scheme: '*' },
    {
      provideCodeLenses(document) {
        return getSqlStatementRanges(document.getText())
          .slice(0, MAX_CODELENSES)
          .map((statementRange, index) => {
            const range = new vscode.Range(
              document.positionAt(statementRange.start),
              document.positionAt(statementRange.end),
            );
            const lineRange = new vscode.Range(range.start, range.start);

            return new vscode.CodeLens(lineRange, {
              title: `Run Statement${index === 0 ? '' : ` #${index + 1}`}`,
              command: QueryCommandIds.runStatementAtRange,
              arguments: [document.uri, range],
            });
          });
      },
    },
  );
}
