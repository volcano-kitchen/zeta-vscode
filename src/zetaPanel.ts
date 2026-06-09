import * as vscode from 'vscode';
import { EditPredictionManager } from './editPredictionManager';
import { ZetaConfig } from './config';

export class ZetaSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'zeta.sidebar';
  private _view?: vscode.WebviewView;
  private manager: EditPredictionManager;
  private config: ZetaConfig;
  private serverStatus: 'unknown' | 'ok' | 'error' = 'unknown';
  private serverMessage: string = '';

  constructor(manager: EditPredictionManager, config: ZetaConfig) {
    this.manager = manager;
    this.config = config;
  }

  updateConfig(config: ZetaConfig) {
    this.config = config;
    this.refresh();
  }

  refresh() {
    if (this._view) {
      this._view.webview.html = this.getHtml();
    }
  }

  setServerStatus(status: 'unknown' | 'ok' | 'error', message: string) {
    this.serverStatus = status;
    this.serverMessage = message;
    this.refresh();
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'testServer':
          vscode.commands.executeCommand('zeta.testServer');
          return;
        case 'toggleEnabled':
          vscode.commands.executeCommand('zeta.toggleEnabled');
          return;
        case 'toggleEditPrediction': {
          const cfg = vscode.workspace.getConfiguration('zeta');
          const current = cfg.get<boolean>('enableEditPrediction', false);
          await cfg.update('enableEditPrediction', !current, vscode.ConfigurationTarget.Global);
          return;
        }
        case 'setAggressiveness': {
          const cfg = vscode.workspace.getConfiguration('zeta');
          await cfg.update('aggressivenessMode', message.value, vscode.ConfigurationTarget.Global);
          return;
        }
        case 'dismiss':
          vscode.commands.executeCommand('zeta.dismissPrediction');
          return;
        case 'acceptAll':
          vscode.commands.executeCommand('zeta.acceptAllEdits');
          return;
      }
    });
  }

  private getHtml(): string {
    const isEnabled = this.config.enabled;
    const editPredOn = this.config.enableEditPrediction;
    const stats = this.manager.getStats();
    const serverOk = this.serverStatus === 'ok';
    const serverColor = this.serverStatus === 'ok' ? '#4ec947' : this.serverStatus === 'error' ? '#f14c4c' : '#888';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  padding: 8px;
  margin: 0;
}
.section {
  margin-bottom: 16px;
}
.section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--vscode-panel-border);
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
}
.label {
  color: var(--vscode-foreground);
}
.value {
  color: var(--vscode-descriptionForeground);
  font-variant-numeric: tabular-nums;
}
.badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 500;
}
.badge-green {
  background: #4ec94733;
  color: #4ec947;
}
.badge-red {
  background: #f14c4c33;
  color: #f14c4c;
}
.badge-yellow {
  background: #e2b71433;
  color: #e2b714;
}
button {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none;
  padding: 4px 12px;
  border-radius: 2px;
  cursor: pointer;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  width: 100%;
  text-align: center;
}
button:hover {
  background: var(--vscode-button-hoverBackground);
}
button.secondary {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}
button.secondary:hover {
  background: var(--vscode-button-secondaryHoverBackground);
}
select {
  background: var(--vscode-dropdown-background);
  color: var(--vscode-dropdown-foreground);
  border: 1px solid var(--vscode-dropdown-border);
  padding: 2px 6px;
  border-radius: 2px;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
}
.actions {
  display: flex;
  gap: 4px;
  margin-top: 8px;
}
.actions button {
  flex: 1;
}
.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 4px;
}
</style>
</head>
<body>
  <div class="section">
    <div class="section-title">Server</div>
    <div class="row">
      <span class="label">Status</span>
      <span class="value">
        <span class="status-dot" style="background:${serverColor}"></span>
        ${this.serverStatus === 'ok' ? 'Connected' : this.serverStatus === 'error' ? 'Error' : 'Unknown'}
      </span>
    </div>
    <div class="row">
      <span class="label">URL</span>
      <span class="value" style="font-size:11px">${this.config.serverUrl}</span>
    </div>
    ${this.serverMessage ? `<div class="row"><span class="value" style="font-size:11px;color:${serverColor}">${this.serverMessage}</span></div>` : ''}
    <div style="margin-top:6px">
      <button onclick="postMsg('testServer')">Test Connection</button>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Settings</div>
    <div class="row">
      <span class="label">Enabled</span>
      <span class="value">
        <span class="badge ${isEnabled ? 'badge-green' : 'badge-red'}">${isEnabled ? 'ON' : 'OFF'}</span>
      </span>
    </div>
    <div class="row">
      <span class="label">Edit Prediction</span>
      <span class="value">
        <span class="badge ${editPredOn ? 'badge-green' : 'badge-yellow'}">${editPredOn ? 'ON' : 'OFF'}</span>
      </span>
    </div>
    <div class="row">
      <span class="label">Aggressiveness</span>
      <select onchange="postMsg('setAggressiveness', this.value)">
        <option value="conservative" ${this.config.aggressivenessMode === 'conservative' ? 'selected' : ''}>Conservative</option>
        <option value="balanced" ${this.config.aggressivenessMode === 'balanced' ? 'selected' : ''}>Balanced</option>
        <option value="aggressive" ${this.config.aggressivenessMode === 'aggressive' ? 'selected' : ''}>Aggressive</option>
        <option value="auto" ${this.config.aggressivenessMode === 'auto' ? 'selected' : ''}>Auto</option>
      </select>
    </div>
    <div class="actions">
      <button onclick="postMsg('toggleEnabled')">Toggle</button>
      <button class="secondary" onclick="postMsg('toggleEditPrediction')">Edit Pred</button>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Statistics</div>
    <div class="row">
      <span class="label">Suggestions Shown</span>
      <span class="value">${stats.totalShown}</span>
    </div>
    <div class="row">
      <span class="label">Accepted</span>
      <span class="value">${stats.totalAccepted}</span>
    </div>
    <div class="row">
      <span class="label">Accept Rate</span>
      <span class="value">
        <span class="badge ${stats.acceptRate >= 0.5 ? 'badge-green' : stats.acceptRate >= 0.2 ? 'badge-yellow' : 'badge-red'}">
          ${(stats.acceptRate * 100).toFixed(0)}%
        </span>
      </span>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Active Prediction</div>
    <div class="row">
      <span class="label">Status</span>
      <span class="value">
        <span class="badge ${stats.hasActiveSuggestion ? 'badge-green' : 'badge-red'}">
          ${stats.hasActiveSuggestion ? 'Active' : 'None'}
        </span>
      </span>
    </div>
    ${stats.hasActiveSuggestion ? `
    <div class="row">
      <span class="label">Regions</span>
      <span class="value">${stats.activeRegions}</span>
    </div>
    <div class="row">
      <span class="label">Current</span>
      <span class="value">${stats.currentRegionIndex + 1} of ${stats.activeRegions}</span>
    </div>
    <div class="actions">
      <button onclick="postMsg('acceptAll')">Accept All</button>
      <button class="secondary" onclick="postMsg('dismiss')">Dismiss</button>
    </div>
    ` : ''}
  </div>

<script>
const vscode = acquireVsCodeApi();
function postMsg(cmd, value) {
  vscode.postMessage({ command: cmd, value: value });
}
</script>
</body>
</html>`;
  }
}
