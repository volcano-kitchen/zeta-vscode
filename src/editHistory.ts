import * as vscode from 'vscode';

export interface EditEvent {
  timestamp: number;
  uri: string;
  range: vscode.Range;
  oldText: string;
  newText: string;
}

export interface FileSwitchEvent {
  timestamp: number;
  uri: string;
}

export type StoredEvent = EditEvent | FileSwitchEvent;

export function isEditEvent(e: StoredEvent): e is EditEvent {
  return 'range' in e;
}

export class EditHistoryTracker {
  private history: Map<string, StoredEvent[]> = new Map();
  private recentPaths: string[] = [];
  private maxHistoryPerFile = 50;
  private maxRecentPaths = 20;

  constructor() {
    vscode.workspace.onDidChangeTextDocument(e => {
      for (const change of e.contentChanges) {
        if (change.rangeLength > 0 || change.text.length > 0) {
          this.pushEvent({
            timestamp: Date.now(),
            uri: e.document.uri.toString(),
            range: change.range,
            oldText: e.document.getText(change.range),
            newText: change.text,
          });
        }
      }
    });

    vscode.window.onDidChangeActiveTextEditor(e => {
      if (e?.document) {
        this.pushFileSwitch(e.document.uri.toString());
      }
    });
  }

  private pushEvent(event: EditEvent) {
    const uri = event.uri;
    let events = this.history.get(uri);
    if (!events) {
      events = [];
      this.history.set(uri, events);
    }
    events.push(event);
    if (events.length > this.maxHistoryPerFile) {
      events.splice(0, events.length - this.maxHistoryPerFile);
    }
  }

  private pushFileSwitch(uri: string) {
    const idx = this.recentPaths.indexOf(uri);
    if (idx >= 0) {
      this.recentPaths.splice(idx, 1);
    }
    this.recentPaths.unshift(uri);
    if (this.recentPaths.length > this.maxRecentPaths) {
      this.recentPaths.pop();
    }
  }

  getRecentPaths(): string[] {
    return [...this.recentPaths];
  }

  getEditHistoryAsDiff(uri: string): string {
    const events = this.history.get(uri)?.filter(isEditEvent);
    if (!events || events.length === 0) return '';

    const lines: string[] = [];
    const path = vscode.Uri.parse(uri).fsPath;
    lines.push(`--- a/${path}`);
    lines.push(`+++ b/${path}`);

    for (const event of events.slice(-20)) {
      const startLine = event.range.start.line + 1;
      const oldLines = event.oldText.split('\n');
      const newLines = event.newText.split('\n');

      if (oldLines.length === 1 && newLines.length === 1) {
        if (event.oldText && event.newText) {
          lines.push(`-${event.oldText}`);
          lines.push(`+${event.newText}`);
        } else if (event.newText && !event.oldText) {
          lines.push(`+${event.newText}`);
        } else if (event.oldText && !event.newText) {
          lines.push(`-${event.oldText}`);
        }
      } else {
        for (const l of oldLines) lines.push(`-${l}`);
        for (const l of newLines) lines.push(`+${l}`);
      }
    }

    return lines.join('\n');
  }

  clear() {
    this.history.clear();
    this.recentPaths = [];
  }
}
