import * as vscode from 'vscode';
import { AiConfigurationStore } from './configurationStore';
import { AiConfigurationPanel } from './configurationPanel';
import { AiCommandIds } from './ids';

export const AI_CONFIGURE_COMMAND_ID = AiCommandIds.configure;

export function registerAiConfigurationCommand(
  context: vscode.ExtensionContext,
  store: AiConfigurationStore = new AiConfigurationStore(context.secrets),
): vscode.Disposable {
  const panel = new AiConfigurationPanel(context.extensionUri, store);
  const command = vscode.commands.registerCommand(
    AI_CONFIGURE_COMMAND_ID,
    () => panel.show(),
  );
  return vscode.Disposable.from(command, panel);
}
