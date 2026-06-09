import * as vscode from 'vscode';
import { EditHistoryTracker } from './editHistory';
import { InferenceClient } from './inferenceClient';
import {
  buildEditPredictionPrompt,
  parseEditPredictionResponse,
  getEditPredictionStopTokens,
  ParsedEditRegion,
} from './promptBuilder';
import { ZetaConfig } from './config';

export interface EditRegionLocation {
  markerIndex: number;
  replacement: string;
  range: vscode.Range;
  line: number;
}

export interface EditPredictionSuggestion {
  regions: EditRegionLocation[];
  fullResponse: string;
}

function tokenToSignal(token: vscode.CancellationToken): AbortSignal {
  const ctrl = new AbortController();
  token.onCancellationRequested(() => ctrl.abort());
  return ctrl.signal;
}

export class EditPredictionManager {
  private history: EditHistoryTracker;
  private client: InferenceClient;
  private config: ZetaConfig;

  private currentSuggestion: EditPredictionSuggestion | null = null;
  private currentRegionIndex: number = 0;

  private totalShown: number = 0;
  private totalAccepted: number = 0;

  private preFetchSuggestion: EditPredictionSuggestion | null = null;
  private preFetchInFlight: boolean = false;

  private _onDidUpdateSuggestion = new vscode.EventEmitter<EditPredictionSuggestion | null>();
  readonly onDidUpdateSuggestion: vscode.Event<EditPredictionSuggestion | null> =
    this._onDidUpdateSuggestion.event;

  constructor(
    history: EditHistoryTracker,
    client: InferenceClient,
    config: ZetaConfig
  ) {
    this.history = history;
    this.client = client;
    this.config = config;
  }

  updateConfig(config: ZetaConfig) {
    this.config = config;
    this.client.updateConfig(config);
  }

  cancel() {
    this.client.cancel();
    this.preFetchSuggestion = null;
    this.preFetchInFlight = false;
  }

  private async getRelatedFilesContent(): Promise<string> {
    const recentPaths = this.history.getRecentPaths();
    const maxFiles = this.config.maxRelatedFiles;
    if (maxFiles <= 0) return '';

    const contents: string[] = [];
    const seen = new Set<string>();

    for (const uriStr of recentPaths) {
      if (seen.size >= maxFiles) break;
      if (seen.has(uriStr)) continue;
      seen.add(uriStr);

      try {
        const uri = vscode.Uri.parse(uriStr);
        const doc = await vscode.workspace.openTextDocument(uri);
        const text = doc.getText();
        const lines = text.split('\n');
        const preview = lines.slice(0, 100).join('\n');
        contents.push(`<filename>${uri.fsPath}\n${preview}`);
      } catch {
        // skip
      }
    }

    return contents.join('\n');
  }

  async getSuggestion(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<EditPredictionSuggestion | null> {
    if (this.preFetchSuggestion) {
      const sug = this.preFetchSuggestion;
      this.preFetchSuggestion = null;
      this.preFetchInFlight = false;
      this.setSuggestion(sug);
      return sug;
    }

    const editHistory = this.history.getEditHistoryAsDiff(document.uri.toString());
    const relatedFiles = await this.getRelatedFilesContent();

    const prompt = buildEditPredictionPrompt({
      document,
      cursorPosition: position,
      editHistory,
      relatedFiles,
      maxRegions: this.config.maxEditRegions,
    });

    const stop = getEditPredictionStopTokens();
    const maxTokens = this.config.maxEditPredictionTokens;

    const response = await this.client.complete(prompt, maxTokens, stop, tokenToSignal(token));

    if (!response || token.isCancellationRequested) return null;

    const parsed = parseEditPredictionResponse(response, this.config.maxEditRegions);

    if (parsed.regions.length === 0) return null;

    const locations = this.resolveRegionLocations(
      document,
      position,
      parsed.regions
    );

    if (locations.length === 0) return null;

    const suggestion: EditPredictionSuggestion = {
      regions: locations,
      fullResponse: parsed.full,
    };

    this.setSuggestion(suggestion);
    this.totalShown++;

    if (this.config.prefetchEnabled) {
      this.prefetchNext(document, position);
    }

    return suggestion;
  }

  private setSuggestion(suggestion: EditPredictionSuggestion | null) {
    this.currentSuggestion = suggestion;
    this.currentRegionIndex = 0;
    vscode.commands.executeCommand(
      'setContext',
      'zeta.hasActivePrediction',
      suggestion !== null
    );
    this._onDidUpdateSuggestion.fire(suggestion);
  }

  private resolveRegionLocations(
    document: vscode.TextDocument,
    cursorPosition: vscode.Position,
    regions: ParsedEditRegion[]
  ): EditRegionLocation[] {
    const locations: EditRegionLocation[] = [];
    const EDITABLE_BEFORE = 30;
    const EDITABLE_AFTER = 10;
    const MIN_BLOCK = 6;
    const MAX_BLOCK = 16;

    const editableStartLine = Math.max(0, cursorPosition.line - EDITABLE_BEFORE);
    const editableEndLine = Math.min(document.lineCount - 1, cursorPosition.line + EDITABLE_AFTER);
    const editableText = getTextRange(document, editableStartLine, editableEndLine + 1);
    const blockOffsets = splitIntoBlocks(editableText, MIN_BLOCK, MAX_BLOCK);

    for (const region of regions) {
      const startBlockIdx = region.markerIndex - 1;
      const endBlockIdx = region.endMarkerIndex - 1;
      if (startBlockIdx >= blockOffsets.length - 1 || endBlockIdx >= blockOffsets.length - 1) {
        continue;
      }

      // Map byte offsets within editable text back to document line ranges
      const startLine = mapOffsetToLine(document, editableStartLine, blockOffsets[startBlockIdx]);
      const endOffset = blockOffsets[endBlockIdx + 1];
      const endLine = mapOffsetToLine(document, editableStartLine, endOffset);

      const clampedStartLine = Math.max(0, startLine);
      const clampedEndLine = Math.min(document.lineCount - 1, endLine);

      const range = new vscode.Range(
        clampedStartLine,
        0,
        clampedEndLine,
        document.lineAt(clampedEndLine).text.length
      );

      locations.push({
        markerIndex: region.markerIndex,
        replacement: region.replacement,
        range,
        line: clampedStartLine,
      });
    }

    return locations;
  }

  private async prefetchNext(
    document: vscode.TextDocument,
    position: vscode.Position
  ) {
    if (this.preFetchInFlight) return;
    this.preFetchInFlight = true;

    try {
      const editHistory = this.history.getEditHistoryAsDiff(document.uri.toString());
      const relatedFiles = await this.getRelatedFilesContent();

      const prompt = buildEditPredictionPrompt({
        document,
        cursorPosition: position,
        editHistory,
        relatedFiles,
        maxRegions: this.config.maxEditRegions,
      });

      const stop = getEditPredictionStopTokens();
      const maxTokens = this.config.maxEditPredictionTokens;

      const response = await this.client.complete(prompt, maxTokens, stop);

      if (response) {
        const parsed = parseEditPredictionResponse(response, this.config.maxEditRegions);
        if (parsed.regions.length > 0) {
          const locations = this.resolveRegionLocations(
            document,
            position,
            parsed.regions
          );
          if (locations.length > 0) {
            this.preFetchSuggestion = { regions: locations, fullResponse: parsed.full };
          }
        }
      }
    } catch {
      // pre-fetch failed silently
    } finally {
      this.preFetchInFlight = false;
    }
  }

  getCurrentSuggestion(): EditPredictionSuggestion | null {
    return this.currentSuggestion;
  }

  getCurrentRegionIndex(): number {
    return this.currentRegionIndex;
  }

  getCurrentRegion(): EditRegionLocation | null {
    if (!this.currentSuggestion) return null;
    if (this.currentRegionIndex >= this.currentSuggestion.regions.length) return null;
    return this.currentSuggestion.regions[this.currentRegionIndex];
  }

  advanceToNextRegion(): EditRegionLocation | null {
    if (!this.currentSuggestion) return null;
    this.currentRegionIndex++;
    if (this.currentRegionIndex >= this.currentSuggestion.regions.length) {
      this.setSuggestion(null);
      return null;
    }
    return this.currentSuggestion.regions[this.currentRegionIndex];
  }

  goToPrevRegion(): EditRegionLocation | null {
    if (!this.currentSuggestion) return null;
    this.currentRegionIndex = Math.max(0, this.currentRegionIndex - 1);
    return this.currentSuggestion.regions[this.currentRegionIndex];
  }

  hasMoreRegions(): boolean {
    if (!this.currentSuggestion) return false;
    return this.currentRegionIndex < this.currentSuggestion.regions.length - 1;
  }

  recordAccept() {
    this.totalAccepted++;
  }

  recordReject() {
    // rejected — still track it
  }

  getTotalShown(): number { return this.totalShown; }

  getTotalAccepted(): number { return this.totalAccepted; }

  getAcceptRate(): number {
    if (this.totalShown === 0) return 0;
    return this.totalAccepted / this.totalShown;
  }

  getStats() {
    return {
      totalShown: this.totalShown,
      totalAccepted: this.totalAccepted,
      acceptRate: this.getAcceptRate(),
      hasActiveSuggestion: this.currentSuggestion !== null,
      activeRegions: this.currentSuggestion?.regions.length ?? 0,
      currentRegionIndex: this.currentRegionIndex,
      aggressivenessMode: this.config.aggressivenessMode,
      maxEditRegions: this.config.maxEditRegions,
    };
  }

  getEffectiveMaxRegions(): number {
    switch (this.config.aggressivenessMode) {
      case 'conservative':
        return 1;
      case 'balanced':
        return Math.min(this.config.maxEditRegions, 3);
      case 'aggressive':
        return this.config.maxEditRegions;
      case 'auto': {
        const rate = this.getAcceptRate();
        if (rate < 0.2) return Math.min(this.config.maxEditRegions, 1);
        if (rate < 0.4) return Math.min(this.config.maxEditRegions, 2);
        if (rate < 0.6) return Math.min(this.config.maxEditRegions, 3);
        return this.config.maxEditRegions;
      }
      default:
        return this.config.maxEditRegions;
    }
  }

  clearSuggestion() {
    this.setSuggestion(null);
  }

  clearPreFetch() {
    this.preFetchSuggestion = null;
  }
}

// --- Shared helpers (mirrors promptBuilder.ts for V0318 block mapping) ---

function splitIntoBlocks(text: string, minLines: number, maxLines: number): number[] {
  if (!text) return [0, 0];
  const lines = text.split('\n');
  const offsets: number[] = [0];
  let lastBoundary = 0;

  for (let i = 0; i < lines.length; i++) {
    const gap = i - lastBoundary;
    if (gap >= minLines && i > 0 && lines[i - 1].trim() === '') {
      offsets.push(countBytes(lines.slice(0, i)));
      lastBoundary = i;
      continue;
    }
    if (gap >= maxLines) {
      offsets.push(countBytes(lines.slice(0, i)));
      lastBoundary = i;
    }
  }

  const end = countBytes(lines);
  if (offsets[offsets.length - 1] !== end) {
    offsets.push(end);
  }
  return offsets;
}

function countBytes(lines: string[]): number {
  let len = 0;
  for (let i = 0; i < lines.length; i++) {
    len += lines[i].length + 1;
  }
  return len === 0 ? 0 : len - 1;
}

function getTextRange(document: vscode.TextDocument, startLine: number, endLine: number): string {
  const start = document.offsetAt(new vscode.Position(Math.max(0, startLine), 0));
  const endLineClamped = Math.min(endLine, document.lineCount - 1);
  const endLineLen = document.lineAt(endLineClamped).text.length;
  const end = document.offsetAt(new vscode.Position(endLineClamped, endLineLen));
  return document.getText().slice(start, end);
}

function mapOffsetToLine(document: vscode.TextDocument, baseLine: number, byteOffset: number): number {
  const editableStartOffset = document.offsetAt(new vscode.Position(baseLine, 0));
  const targetOffset = editableStartOffset + byteOffset;
  for (let line = baseLine; line < document.lineCount; line++) {
    const lineEnd = document.offsetAt(new vscode.Position(line, document.lineAt(line).text.length));
    if (lineEnd >= targetOffset) return line;
  }
  return document.lineCount - 1;
}
