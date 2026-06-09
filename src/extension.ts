import * as vscode from 'vscode';
import { ZetaInlineCompletionProvider } from './inlineCompletionProvider';
import { EditHistoryTracker } from './editHistory';

let provider: ZetaInlineCompletionProvider | null = null;
let editHistory: EditHistoryTracker | null = null;

export function activate(context: vscode.ExtensionContext) {
  provider = new ZetaInlineCompletionProvider();

  const providerRegistration = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: '**' },
    provider
  );

  context.subscriptions.push(providerRegistration);

  editHistory = new EditHistoryTracker();

  const toggle = vscode.commands.registerCommand('zeta.toggleEnabled', () => {
    const cfg = vscode.workspace.getConfiguration('zeta');
    const current = cfg.get<boolean>('enabled', true);
    cfg.update('enabled', !current, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(
      `Zeta completions: ${!current ? 'enabled' : 'disabled'}`
    );
  });

  const menu = vscode.commands.registerCommand('zeta.showMenu', async () => {
    const items: vscode.QuickPickItem[] = [
      {
        label: 'Toggle Enable/Disable',
        description: `Currently: ${provider ? 'enabled' : 'disabled'}`,
      },
      {
        label: 'Open Settings',
        description: 'Configure Zeta server URL, model, FIM, edit prediction',
      },
    ];
    const selected = await vscode.window.showQuickPick(items);
    if (!selected) return;

    if (selected.label.startsWith('Toggle')) {
      vscode.commands.executeCommand('zeta.toggleEnabled');
    } else if (selected.label.startsWith('Open Settings')) {
      vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '@ext:zeta-vscode'
      );
    }
  });

  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = 'zeta.showMenu';
  statusBarItem.text = '$(sparkle) Zeta';
  statusBarItem.tooltip = 'Zeta Edit Prediction — click for menu';
  statusBarItem.show();

  context.subscriptions.push(toggle, menu, statusBarItem);

  if (vscode.workspace.getConfiguration('zeta').get('experimentalInjectLsp')) {
    console.log('Zeta: LSP context injection enabled');
  }

  console.log('Zeta edit prediction extension activated');
}

export function deactivate() {
  provider = null;
  if (editHistory) {
    editHistory.clear();
    editHistory = null;
  }
}
