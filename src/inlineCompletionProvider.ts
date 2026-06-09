import * as vscode from 'vscode';
import { InferenceClient } from './inferenceClient';
import { buildFimPrompt, getFimStopTokens, FimRequest } from './promptBuilder';
import { getLspContext } from './lspContext';
import { ZetaConfig, loadConfig } from './config';

export class ZetaInlineCompletionProvider
  implements vscode.InlineCompletionItemProvider
{
  private client: InferenceClient;
  private config: ZetaConfig;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRequest: AbortController | null = null;

  constructor() {
    this.config = loadConfig();
    this.client = new InferenceClient(this.config);

    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('zeta')) {
        this.config = loadConfig();
        this.client.updateConfig(this.config);
      }
    });
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    if (!this.config.enabled) return undefined;

    if (context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic) {
      return this.handleAutomatic(document, position, token);
    }

    return this.handleExplicit(document, position, token);
  }

  private async handleAutomatic(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    return new Promise(resolve => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);

      const offset = document.offsetAt(position);
      const prefix = document.getText().slice(0, offset);
      const suffix = document.getText().slice(offset);

      if (!prefix.trim() && !suffix.trim()) {
        resolve(undefined);
        return;
      }

      this.debounceTimer = setTimeout(async () => {
        const result = await this.doFimComplete(
          { prefix, suffix, language: document.languageId, filePath: document.uri.fsPath },
          document,
          position,
          token
        );
        resolve(result);
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

      const item = new vscode.InlineCompletionItem(
        completion,
        new vscode.Range(position, position)
      );

      return [item];
    } finally {
      this.pendingRequest = null;
    }
  }
}
