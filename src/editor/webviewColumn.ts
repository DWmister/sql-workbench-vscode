import * as vscode from 'vscode';

export function getWebviewViewColumn(): vscode.ViewColumn {
  const tabGroups = vscode.window.tabGroups;
  if (tabGroups.all.length > 1) {
    return tabGroups.activeTabGroup.viewColumn;
  }

  return vscode.ViewColumn.Beside;
}
