import * as vscode from 'vscode';
import { InferenceClient } from './inferenceClient';
import { buildFimPrompt, getFimStopTokens, sanitizeCompletion, FimRequest } from './promptBuilder';
import { getLspContext } from './lspContext';
import { ZetaConfig, loadConfig } from './config';
import { EditPredictionManager } from './editPredictionManager';
import { EditHistoryTracker } from './editHistory';

const FIM_DEDUP_WINDOW = 80;

export class ZetaInlineCompletionProvider
  implements vscode.InlineCompletionItemProvider
{
  private client: InferenceClient;
  private config: ZetaConfig;
  private fimDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRequest: AbortController | null = null;
  private editPredictionManager: EditPredictionManager | null = null;
  private editHistory: EditHistoryTracker | null = null;

  private resolvePendingFim: ((value: vscode.InlineCompletionItem[] | undefined) => void) | null = null;

  private _onDidGetSuggestion = new vscode.EventEmitter<void>();
  readonly onDidGetSuggestion: vscode.Event<void> = this._onDidGetSuggestion.event;

  constructor() {
    this.config = loadConfig();
    this.client = new InferenceClient(this.config);

    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('zeta')) {
        this.config = loadConfig();
        this.client.updateConfig(this.config);
        if (this.editPredictionManager) {
          this.editPredictionManager.updateConfig(this.config);
        }
      }
    });
  }

  setEditHistory(history: EditHistoryTracker) {
    this.editHistory = history;
  }

  getEditPredictionManager(): EditPredictionManager | null {
    if (!this.editHistory) return null;
    return this.ensureEditPredictionManager();
  }

  private ensureEditPredictionManager(): EditPredictionManager {
    if (!this.editPredictionManager) {
      this.editPredictionManager = new EditPredictionManager(
        this.editHistory!,
        this.client,
        this.config
      );
    }
    return this.editPredictionManager;
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    if (!this.config.enabled) return undefined;

    if (this.config.enableEditPrediction && this.editHistory) {
      const editResult = await this.handleEditPrediction(document, position, token);
      if (editResult) return editResult;
    }

    if (context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic) {
      return this.handleAutomatic(document, position, token);
    }

    return this.handleExplicit(document, position, token);
  }

  private async handleEditPrediction(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    if (token.isCancellationRequested) return undefined;

    const offset = document.offsetAt(position);
    const prefix = document.getText().slice(0, offset);
    const suffix = document.getText().slice(offset);
    if (!prefix.trim() && !suffix.trim()) return undefined;

    const manager = this.ensureEditPredictionManager();
    const suggestion = await manager.getSuggestion(document, position, token);

    if (!suggestion || suggestion.regions.length === 0) return undefined;

    const primaryRegion = suggestion.regions[0];
    const cursorOffset = document.offsetAt(position);
    const rangeStart = document.offsetAt(primaryRegion.range.start);
    const rangeEnd = document.offsetAt(primaryRegion.range.end);

    let text = primaryRegion.replacement;
    let range = primaryRegion.range;

    if (cursorOffset > rangeStart && cursorOffset <= rangeEnd) {
      const existingBeforeCursor = document.getText().slice(rangeStart, cursorOffset);
      const commonPrefixLen = this.findCommonPrefixLength(text, existingBeforeCursor);

      if (commonPrefixLen >= existingBeforeCursor.length * 0.5) {
        text = text.slice(commonPrefixLen);
        range = new vscode.Range(position, primaryRegion.range.end);
      } else if (commonPrefixLen > 0) {
        text = text.slice(commonPrefixLen);
        range = new vscode.Range(position, primaryRegion.range.end);
      } else {
        return undefined;
      }
    }

    if (!text.trim()) return undefined;

    const item = new vscode.InlineCompletionItem(text, range);
    this._onDidGetSuggestion.fire();
    return [item];
  }

  private findCommonPrefixLength(a: string, b: string): number {
    const maxLen = Math.min(a.length, b.length);
    let i = 0;
    while (i < maxLen && a[i] === b[i]) {
      i++;
    }
    return i;
  }

  private async handleAutomatic(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    if (this.resolvePendingFim) {
      this.resolvePendingFim(undefined);
      this.resolvePendingFim = null;
    }
    if (this.fimDebounceTimer) {
      clearTimeout(this.fimDebounceTimer);
      this.fimDebounceTimer = null;
    }

    const offset = document.offsetAt(position);
    const prefix = document.getText().slice(0, offset);
    const suffix = document.getText().slice(offset);

    if (!prefix.trim() && !suffix.trim()) {
      return undefined;
    }

    return new Promise(resolve => {
      this.resolvePendingFim = resolve;

      this.fimDebounceTimer = setTimeout(async () => {
        this.fimDebounceTimer = null;
        const r = this.resolvePendingFim;
        this.resolvePendingFim = null;

        const result = await this.doFimComplete(
          { prefix, suffix, language: document.languageId, filePath: document.uri.fsPath },
          document,
          position,
          token
        );
        r?.(result);
      }, this.config.debounceMs);
    });
  }

  private async handleExplicit(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const offset = document.offsetAt(position);
    const prefix = document.getText().slice(0, offset);
    const suffix = document.getText().slice(offset);

    return this.doFimComplete(
      { prefix, suffix, language: document.languageId, filePath: document.uri.fsPath },
      document,
      position,
      token
    );
  }

  private async doFimComplete(
    req: FimRequest,
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    if (this.pendingRequest) {
      this.pendingRequest.abort();
      this.pendingRequest = null;
    }

    if (token.isCancellationRequested) return undefined;

    // Zeta 2.1 SPM FIM works best at line boundaries.
    // Skip if cursor is in the middle of a line (non-whitespace after cursor).
    const restOfLine = document.lineAt(position.line).text.slice(position.character);
    if (restOfLine.trim().length > 0) {
      return undefined;
    }

    if (this.config.experimentalInjectLsp) {
      try {
        const lspInfo = await getLspContext(document, position);
        if (lspInfo) {
          req.lspContext = lspInfo;
        }
      } catch {
        // LSP injection failed, continue without it
      }
    }

    const prompt = buildFimPrompt(req);
    const stop = getFimStopTokens();

    const controller = new AbortController();
    this.pendingRequest = controller;

    token.onCancellationRequested(() => controller.abort());

    try {
      const completion = await this.client.complete(
        prompt,
        this.config.maxFimTokens,
        stop,
        controller.signal
      );

      if (!completion || token.isCancellationRequested) return undefined;

      const cleaned = sanitizeCompletion(completion);
      if (!cleaned) return undefined;

      // Strip any characters the model echoes from right before cursor or from suffix
      let text = cleaned;
      const tailPrefix = req.prefix.slice(-FIM_DEDUP_WINDOW);
      const prefixCommonLen = this.findCommonPrefixLength(text, tailPrefix);
      if (prefixCommonLen > 0) {
        text = text.slice(prefixCommonLen);
      }
      // Also trim if the model regenerated the start of the suffix
      const headSuffix = req.suffix.slice(0, FIM_DEDUP_WINDOW).trimStart();
      const suffixCommonLen = this.findCommonPrefixLength(text, headSuffix);
      if (suffixCommonLen > 0) {
        text = text.slice(suffixCommonLen);
      }
      if (!text.trim()) return undefined;

      const item = new vscode.InlineCompletionItem(
        text,
        new vscode.Range(position, position)
      );

      return [item];
    } finally {
      this.pendingRequest = null;
    }
  }
}
