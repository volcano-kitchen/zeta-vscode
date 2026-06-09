import * as vscode from 'vscode';

export interface ZetaConfig {
  serverUrl: string;
  modelName: string;
  maxContextTokens: number;
  debounceMs: number;
  temperature: number;
  maxFimTokens: number;
  maxEditPredictionTokens: number;
  enabled: boolean;
  enableEditPrediction: boolean;
  experimentalInjectLsp: boolean;
  fimContextLines: number;
  fimSuffixLines: number;
}

export function loadConfig(): ZetaConfig {
  const cfg = vscode.workspace.getConfiguration('zeta');
  return {
    serverUrl: cfg.get<string>('serverUrl', 'http://localhost:8080'),
    modelName: cfg.get<string>('modelName', 'zeta-2.1'),
    maxContextTokens: cfg.get<number>('maxContextTokens', 28672),
    debounceMs: cfg.get<number>('debounceMs', 250),
    temperature: cfg.get<number>('temperature', 0.1),
    maxFimTokens: cfg.get<number>('maxFimTokens', 64),
    maxEditPredictionTokens: cfg.get<number>('maxEditPredictionTokens', 256),
    enabled: cfg.get<boolean>('enabled', true),
    enableEditPrediction: cfg.get<boolean>('enableEditPrediction', false),
    experimentalInjectLsp: cfg.get<boolean>('experimentalInjectLsp', false),
    fimContextLines: cfg.get<number>('fimContextLines', 100),
    fimSuffixLines: cfg.get<number>('fimSuffixLines', 30),
  };
}
