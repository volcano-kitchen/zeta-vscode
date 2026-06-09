import * as vscode from 'vscode';
import { ZetaInlineCompletionProvider } from './inlineCompletionProvider';
import { EditHistoryTracker } from './editHistory';
import { GutterDecorationManager } from './gutterDecorations';
import { EditPredictionHoverProvider } from './diffWidget';
import { EditPredictionManager } from './editPredictionManager';

let provider: ZetaInlineCompletionProvider | null = null;
let editHistory: EditHistoryTracker | null = null;
let gutterDecorationManager: GutterDecorationManager | null = null;

export function activate(context: vscode.ExtensionContext) {
  provider = new ZetaInlineCompletionProvider();
  editHistory = new EditHistoryTracker();
  provider.setEditHistory(editHistory);

  GutterDecorationManager.writeIcons(context);
  gutterDecorationManager = new GutterDecorationManager();

  const providerRegistration = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: '**' },
    provider
  );
  context.subscriptions.push(providerRegistration);

  const editPredManager = provider.getEditPredictionManager();

  if (editPredManager) {
    const hoverProvider = vscode.languages.registerHoverProvider(
      { pattern: '**' },
      new EditPredictionHoverProvider(editPredManager)
    );
    context.subscriptions.push(hoverProvider);

    provider.onDidGetSuggestion(() => {
      const suggestion = editPredManager.getCurrentSuggestion();
      const editor = vscode.window.activeTextEditor;
      if (editor && suggestion) {
        gutterDecorationManager!.update(editor, suggestion.regions, editPredManager.getCurrentRegionIndex());
      }
    });

    editPredManager.onDidUpdateSuggestion(suggestion => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        if (suggestion) {
          gutterDecorationManager!.update(editor, suggestion.regions, editPredManager.getCurrentRegionIndex());
        } else {
          gutterDecorationManager!.clear(editor);
        }
      }
    });

    vscode.window.onDidChangeActiveTextEditor(() => {
      const sug = editPredManager.getCurrentSuggestion();
      const editor = vscode.window.activeTextEditor;
      if (editor && sug) {
        gutterDecorationManager!.update(editor, sug.regions, editPredManager.getCurrentRegionIndex());
      } else if (editor) {
        gutterDecorationManager!.clear(editor);
      }
    });

    context.subscriptions.push(
      vscode.commands.registerCommand('zeta.acceptAndAdvance', async () => {
        if (!editPredManager.hasMoreRegions()) {
          await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
          editPredManager.recordAccept();
          editPredManager.clearSuggestion();
          return;
        }

        await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
        editPredManager.recordAccept();

        const nextRegion = editPredManager.advanceToNextRegion();
        if (nextRegion) {
          const editor = vscode.window.activeTextEditor;
          if (editor) {
            const newPos = new vscode.Position(nextRegion.line, 0);
            editor.selection = new vscode.Selection(newPos, newPos);
            editor.revealRange(
              new vscode.Range(newPos, newPos),
              vscode.TextEditorRevealType.Default
            );
            await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
          }
        }
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('zeta.jumpToNextEditLocation', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

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
          editor.revealRange(
            new vscode.Range(pos, pos),
            vscode.TextEditorRevealType.Default
          );
          gutterDecorationManager!.update(editor, suggestion.regions, editPredManager.getCurrentRegionIndex());
        }
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('zeta.jumpToPrevEditLocation', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const suggestion = editPredManager.getCurrentSuggestion();
        if (!suggestion) return;

        const region = editPredManager.goToPrevRegion();
        if (region) {
          const pos = new vscode.Position(region.line, 0);
          editor.selection = new vscode.Selection(pos, pos);
          editor.revealRange(
            new vscode.Range(pos, pos),
            vscode.TextEditorRevealType.Default
          );
          gutterDecorationManager!.update(editor, suggestion.regions, editPredManager.getCurrentRegionIndex());
        }
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('zeta.acceptAllEdits', async () => {
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
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('zeta.dismissPrediction', () => {
        editPredManager.recordReject();
        editPredManager.clearSuggestion();
        gutterDecorationManager!.clear();
      })
    );
  }

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
