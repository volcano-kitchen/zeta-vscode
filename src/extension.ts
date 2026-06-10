import * as vscode from 'vscode';
import { ZetaInlineCompletionProvider } from './inlineCompletionProvider';
import { EditHistoryTracker } from './editHistory';
import { GutterDecorationManager } from './gutterDecorations';
import { EditPredictionHoverProvider } from './diffWidget';
import { EditPredictionManager } from './editPredictionManager';
import { ZetaSidebarProvider } from './zetaPanel';
import { loadConfig, ZetaConfig } from './config';

let provider: ZetaInlineCompletionProvider | null = null;
let editHistory: EditHistoryTracker | null = null;
let gutterDecorationManager: GutterDecorationManager | null = null;
let sidebarProvider: ZetaSidebarProvider | null = null;
let editPredManager: EditPredictionManager | null = null;
let config: ZetaConfig;

async function testServerConnection(url: string): Promise<{ ok: boolean; message: string }> {
  try {
    const cfg = vscode.workspace.getConfiguration('zeta');
    const modelName = cfg.get<string>('modelName', 'zeta-2.1');
    const modelInfo = cfg.inspect('modelName');
    const response = await fetch(`${url}/v1/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'def hello():\n    ',
        max_tokens: 2,
        temperature: 0.1,
        model: modelName,
        stop: ['\n\n'],
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      return { ok: true, message: `Server responded (${response.status})` };
    }
    const text = await response.text().catch(() => '');
    const info = modelInfo ? `[default:${modelInfo.defaultValue}, global:${modelInfo.globalValue}, workspace:${modelInfo.workspaceValue}]` : '';
    return { ok: false, message: `Error ${response.status} (model:"${modelName}" ${info})${text ? ': ' + text.slice(0, 120) : ''}` };
  } catch (err: any) {
    return { ok: false, message: `Connection failed: ${err?.message || 'unknown error'}` };
  }
}

export function activate(context: vscode.ExtensionContext) {
  config = loadConfig();
  provider = new ZetaInlineCompletionProvider();
  editHistory = new EditHistoryTracker();
  provider.setEditHistory(editHistory);
  editPredManager = provider.getEditPredictionManager();

  GutterDecorationManager.writeIcons(context);
  gutterDecorationManager = new GutterDecorationManager();

  const providerRegistration = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: '**' },
    provider
  );
  context.subscriptions.push(providerRegistration);

  sidebarProvider = new ZetaSidebarProvider(editPredManager, config);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ZetaSidebarProvider.viewType, sidebarProvider)
  );

  if (editPredManager) {
    const hoverProvider = vscode.languages.registerHoverProvider(
      { pattern: '**' },
      new EditPredictionHoverProvider(editPredManager)
    );
    context.subscriptions.push(hoverProvider);

    provider.onDidGetSuggestion(() => {
      const sug = editPredManager!.getCurrentSuggestion();
      const editor = vscode.window.activeTextEditor;
      if (editor && sug) {
        gutterDecorationManager!.update(editor, sug.regions, editPredManager!.getCurrentRegionIndex());
      }
      sidebarProvider?.refresh();
    });

    editPredManager.onDidUpdateSuggestion(suggestion => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        if (suggestion) {
          gutterDecorationManager!.update(editor, suggestion.regions, editPredManager!.getCurrentRegionIndex());
        } else {
          gutterDecorationManager!.clear(editor);
        }
      }
      sidebarProvider?.refresh();
    });

    vscode.window.onDidChangeActiveTextEditor(() => {
      const sug = editPredManager!.getCurrentSuggestion();
      const editor = vscode.window.activeTextEditor;
      if (editor && sug) {
        gutterDecorationManager!.update(editor, sug.regions, editPredManager!.getCurrentRegionIndex());
      } else if (editor) {
        gutterDecorationManager!.clear(editor);
      }
    });
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('zeta.testServer', async () => {
      const url = vscode.workspace.getConfiguration('zeta').get<string>('serverUrl', 'http://localhost:8080');
      sidebarProvider?.setServerStatus('unknown', 'Testing...');

      const result = await testServerConnection(url);
      if (result.ok) {
        sidebarProvider?.setServerStatus('ok', result.message);
        vscode.window.showInformationMessage(`Zeta server: ${result.message}`);
      } else {
        sidebarProvider?.setServerStatus('error', result.message);
        vscode.window.showErrorMessage(`Zeta server: ${result.message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('zeta.acceptAndAdvance', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !editPredManager) return;

      const suggestion = editPredManager.getCurrentSuggestion();
      if (!suggestion) return;

      await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
      editPredManager.recordAccept();

      if (!editPredManager.hasMoreRegions()) {
        editPredManager.clearSuggestion();
        return;
      }

      // Small delay to let the edit apply before moving cursor
      await new Promise(r => setTimeout(r, 30));

      const nextRegion = editPredManager.advanceToNextRegion();
      if (nextRegion) {
        const newPos = new vscode.Position(nextRegion.line, 0);
        editor.selection = new vscode.Selection(newPos, newPos);
        editor.revealRange(new vscode.Range(newPos, newPos), vscode.TextEditorRevealType.Default);
        
        // Trigger next prediction after cursor moved
        await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('zeta.jumpToNextEditLocation', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !editPredManager) return;

      const suggestion = editPredManager.getCurrentSuggestion();
      if (!suggestion) return;

      const currentIndex = editPredManager.getCurrentRegionIndex();
      const nextIndex = (currentIndex + 1) % suggestion.regions.length;
      const region = nextIndex === 0
        ? editPredManager.goToPrevRegion() || suggestion.regions[0]
        : editPredManager.advanceToNextRegion();

      if (region) {
        const pos = new vscode.Position(region.line, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.Default);
        gutterDecorationManager!.update(editor, suggestion.regions, editPredManager.getCurrentRegionIndex());
        sidebarProvider?.refresh();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('zeta.jumpToPrevEditLocation', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !editPredManager) return;

      const suggestion = editPredManager.getCurrentSuggestion();
      if (!suggestion) return;

      const region = editPredManager.goToPrevRegion();
      if (region) {
        const pos = new vscode.Position(region.line, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.Default);
        gutterDecorationManager!.update(editor, suggestion.regions, editPredManager.getCurrentRegionIndex());
        sidebarProvider?.refresh();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('zeta.acceptAllEdits', async () => {
      if (!editPredManager) return;
      const suggestion = editPredManager.getCurrentSuggestion();
      if (!suggestion) return;

      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      await editor.edit(builder => {
        for (const region of suggestion.regions) {
          builder.replace(region.range, region.replacement);
        }
      });

      editPredManager.recordAccept();
      editPredManager.clearSuggestion();
      sidebarProvider?.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('zeta.dismissPrediction', () => {
      editPredManager?.recordReject();
      editPredManager?.clearSuggestion();
      gutterDecorationManager!.clear();
      sidebarProvider?.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('zeta.forcePredict', () => {
      vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
    })
  );

  const toggle = vscode.commands.registerCommand('zeta.toggleEnabled', () => {
    const cfg = vscode.workspace.getConfiguration('zeta');
    const current = cfg.get<boolean>('enabled', true);
    cfg.update('enabled', !current, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Zeta completions: ${!current ? 'enabled' : 'disabled'}`);
    sidebarProvider?.refresh();
  });

  const menu = vscode.commands.registerCommand('zeta.showMenu', async () => {
    const items: vscode.QuickPickItem[] = [
      {
        label: 'Toggle Enable/Disable',
        description: `Currently: ${config.enabled ? 'enabled' : 'disabled'}`,
      },
      {
        label: 'Open Settings',
        description: 'Configure Zeta server URL, model, FIM, edit prediction',
      },
      {
        label: 'Test Server Connection',
        description: 'Ping llama.cpp server to verify connectivity',
      },
    ];
    const selected = await vscode.window.showQuickPick(items);
    if (!selected) return;

    if (selected.label.startsWith('Toggle')) {
      vscode.commands.executeCommand('zeta.toggleEnabled');
    } else if (selected.label.startsWith('Open Settings')) {
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:local.zeta-vscode');
    } else if (selected.label.startsWith('Test Server')) {
      vscode.commands.executeCommand('zeta.testServer');
    }
  });

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'zeta.showMenu';
  statusBarItem.text = '$(sparkle) Zeta';
  statusBarItem.tooltip = 'Zeta Edit Prediction — click for menu';
  statusBarItem.show();

  context.subscriptions.push(toggle, menu, statusBarItem);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('zeta')) {
        config = loadConfig();
        sidebarProvider?.updateConfig(config);
      }
    })
  );

  console.log('Zeta edit prediction extension activated (Phase 2)');
}

export function deactivate() {
  if (gutterDecorationManager) {
    gutterDecorationManager.dispose();
    gutterDecorationManager = null;
  }
  provider = null;
  if (editHistory) {
    editHistory.clear();
    editHistory = null;
  }
}
