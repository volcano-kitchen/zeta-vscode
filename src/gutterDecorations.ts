import * as vscode from 'vscode';
import * as path from 'path';
import { EditRegionLocation } from './editPredictionManager';

const ARROW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
  <path fill="#4fc1ff" d="M6 4v8l4-4z"/>
</svg>`;

const ARROW_WARN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
  <path fill="#e2b714" d="M6 4v8l4-4z"/>
</svg>`;

export class GutterDecorationManager {
  private primaryDeco: vscode.TextEditorDecorationType;
  private secondaryDeco: vscode.TextEditorDecorationType;
  private nextDeco: vscode.TextEditorDecorationType;

  private static iconFilePrimary?: vscode.Uri;
  private static iconFileSecondary?: vscode.Uri;

  static writeIcons(context: vscode.ExtensionContext) {
    const primaryPath = path.join(context.extensionPath, 'media', 'arrow-primary.svg');
    const secondaryPath = path.join(context.extensionPath, 'media', 'arrow-secondary.svg');
    try {
      const fs = require('fs');
      const dir = path.dirname(primaryPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(primaryPath, ARROW_SVG);
      fs.writeFileSync(secondaryPath, ARROW_WARN_SVG);
      this.iconFilePrimary = vscode.Uri.file(primaryPath);
      this.iconFileSecondary = vscode.Uri.file(secondaryPath);
    } catch {
      // fallback: use in-memory icon paths
      this.iconFilePrimary = vscode.Uri.parse('data:image/svg+xml;base64,' + Buffer.from(ARROW_SVG).toString('base64'));
      this.iconFileSecondary = vscode.Uri.parse('data:image/svg+xml;base64,' + Buffer.from(ARROW_WARN_SVG).toString('base64'));
    }
  }

  constructor() {
    this.primaryDeco = vscode.window.createTextEditorDecorationType({
      gutterIconPath: GutterDecorationManager.iconFilePrimary,
      gutterIconSize: 'contain',
      isWholeLine: true,
      overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.infoForeground'),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      backgroundColor: new vscode.ThemeColor('editorInfo.background'),
    });

    this.secondaryDeco = vscode.window.createTextEditorDecorationType({
      gutterIconPath: GutterDecorationManager.iconFileSecondary,
      gutterIconSize: 'contain',
      isWholeLine: true,
      overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.warningForeground'),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      backgroundColor: new vscode.ThemeColor('editorWarning.background'),
    });

    this.nextDeco = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      borderWidth: '0 0 0 2px',
      borderStyle: 'solid',
      borderColor: new vscode.ThemeColor('focusBorder'),
    });
  }

  update(editor: vscode.TextEditor, regions: EditRegionLocation[], currentIndex: number = 0) {
    if (regions.length === 0) {
      this.clear(editor);
      return;
    }

    const primaryLines: vscode.Range[] = [];
    const secondaryLines: vscode.Range[] = [];
    const nextLines: vscode.Range[] = [];

    for (let i = 0; i < regions.length; i++) {
      const r = regions[i];
      const lineRange = editor.document.lineAt(r.line).range;
      if (i === currentIndex) {
        primaryLines.push(lineRange);
        nextLines.push(lineRange);
      } else {
        secondaryLines.push(lineRange);
      }
    }

    editor.setDecorations(this.primaryDeco, primaryLines);
    editor.setDecorations(this.secondaryDeco, secondaryLines);
    editor.setDecorations(this.nextDeco, nextLines);
  }

  clear(editor?: vscode.TextEditor) {
    const editors = editor ? [editor] : vscode.window.visibleTextEditors;
    for (const e of editors) {
      e.setDecorations(this.primaryDeco, []);
      e.setDecorations(this.secondaryDeco, []);
      e.setDecorations(this.nextDeco, []);
    }
  }

  dispose() {
    this.primaryDeco.dispose();
    this.secondaryDeco.dispose();
    this.nextDeco.dispose();
  }
}
