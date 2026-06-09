import * as vscode from 'vscode';
import { EditPredictionManager, EditRegionLocation } from './editPredictionManager';

export class EditPredictionHoverProvider implements vscode.HoverProvider {
  private manager: EditPredictionManager;

  constructor(manager: EditPredictionManager) {
    this.manager = manager;
  }

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    const suggestion = this.manager.getCurrentSuggestion();
    if (!suggestion) return null;

    const regionAtLine = suggestion.regions.find(r => r.line === position.line);
    if (!regionAtLine) return null;

    const currentLine = document.lineAt(regionAtLine.line).text.trim();

    const markdown = new vscode.MarkdownString();
    markdown.isTrusted = true;
    markdown.supportHtml = true;

    markdown.appendMarkdown('**Zeta Edit Prediction**  \n');
    markdown.appendMarkdown('---\n');
    markdown.appendMarkdown('```diff\n');
    markdown.appendMarkdown(`- ${currentLine || '(empty)'}\n`);
    markdown.appendMarkdown('```\n');
    markdown.appendMarkdown('⬇️  **Suggested replacement**  \n');
    markdown.appendMarkdown('```\n');
    const replacementLines = regionAtLine.replacement.split('\n');
    for (const line of replacementLines) {
      markdown.appendMarkdown(`${line}\n`);
    }
    markdown.appendMarkdown('```\n');
    markdown.appendMarkdown('---\n');
    markdown.appendMarkdown(
      `_Region ${regionAtLine.markerIndex} of ${suggestion.regions.length}_  \n`
    );
    markdown.appendMarkdown(
      '`Tab` to accept, `Alt+↓`/`Alt+↑` to navigate, `Esc` to dismiss'
    );

    return new vscode.Hover(markdown);
  }
}
