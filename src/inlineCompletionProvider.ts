import * as vscode from 'vscode';
import { InferenceClient } from './inferenceClient';
import { buildFimPrompt, getFimStopTokens, sanitizeCompletion, FimRequest, buildEditPredictionPrompt, parseEditPredictionResponse, getEditPredictionStopTokens } from './promptBuilder';
import { getLspContext } from './lspContext';
import { ZetaConfig, loadConfig } from './config';
import { EditPredictionManager } from './editPredictionManager';
import { EditHistoryTracker } from './editHistory';

export class ZetaInlineCompletionProvider
  implements vscode.InlineCompletionItemProvider
{
  private client: InferenceClient;
  private config: ZetaConfig;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRequest: AbortController | null = null;
  private editPredictionManager: EditPredictionManager | null = null;
  private editHistory: EditHistoryTracker | null = null;

  private resolvePendingEditPrediction: ((value: vscode.InlineCompletionItem[] | undefined) => void) | null = null;
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
      const immediate = context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke;
      const editResult = await this.handleEditPrediction(document, position, token, immediate);
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
    token: vscode.CancellationToken,
    immediate: boolean = false
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    if (this.resolvePendingEditPrediction) {
      this.resolvePendingEditPrediction(undefined);
      this.resolvePendingEditPrediction = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    const run = async (resolve: (value: vscode.InlineCompletionItem[] | undefined) => void) => {
      if (token.isCancellationRequested) {
        resolve(undefined);
        return;
      }

      const offset = document.offsetAt(position);
      const prefix = document.getText().slice(0, offset);
      const suffix = document.getText().slice(offset);
      if (!prefix.trim() && !suffix.trim()) {
        resolve(undefined);
        return;
      }

      const manager = this.ensureEditPredictionManager();
      const suggestion = await manager.getSuggestion(document, position, token);

      if (!suggestion || suggestion.regions.length === 0) {
        resolve(undefined);
        return;
      }

      const primaryRegion = suggestion.regions[0];
      const cursorOffset = document.offsetAt(position);
      const rangeStart = document.offsetAt(primaryRegion.range.start);
      const rangeEnd = document.offsetAt(primaryRegion.range.end);

      let text = primaryRegion.replacement;
      let range = primaryRegion.range;

      // If cursor is inside the region range, trim the already-typed prefix
      // so ghost text only shows what comes after the cursor
      if (cursorOffset > rangeStart && cursorOffset <= rangeEnd) {
        const existingBeforeCursor = document.getText().slice(rangeStart, cursorOffset);
        if (text.startsWith(existingBeforeCursor)) {
          text = text.slice(existingBeforeCursor.length);
          range = new vscode.Range(position, primaryRegion.range.end);
        }
      }

      const item = new vscode.InlineCompletionItem(text, range);

      this._onDidGetSuggestion.fire();
      resolve([item]);
    };

    if (immediate) {
      return new Promise(resolve => { run(resolve); });
    }

    return new Promise(resolve => {
      this.resolvePendingEditPrediction = resolve;
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        const r = this.resolvePendingEditPrediction;
        this.resolvePendingEditPrediction = null;
        run(r!);
      }, this.config.debounceMs);
    });
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
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // snapshot prefix/suffix at call time, before debounce
    const offset = document.offsetAt(position);
    const prefix = document.getText().slice(0, offset);
    const suffix = document.getText().slice(offset);

    if (!prefix.trim() && !suffix.trim()) {
      return undefined;
    }

    return new Promise(resolve => {
      this.resolvePendingFim = resolve;

      this.debounceTimer = setTimeout(async () => {
        this.debounceTimer = null;
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

      const item = new vscode.InlineCompletionItem(
        cleaned,
        new vscode.Range(position, position)
      );

      return [item];
    } finally {
      this.pendingRequest = null;
    }
  }
}
