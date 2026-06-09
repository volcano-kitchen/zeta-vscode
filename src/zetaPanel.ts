import * as vscode from 'vscode';
import { EditPredictionManager } from './editPredictionManager';
import { ZetaConfig } from './config';

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 64; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

export class ZetaSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'zeta.sidebar';
  private _view?: vscode.WebviewView;
  private manager: EditPredictionManager | null;
  private config: ZetaConfig;
  private serverStatus: 'unknown' | 'ok' | 'error' = 'unknown';
  private serverMessage: string = '';

  constructor(manager: EditPredictionManager | null, config: ZetaConfig) {
    this.manager = manager;
    this.config = config;
  }

  updateConfig(config: ZetaConfig) {
    this.config = config;
    this._view?.webview.postMessage({ command: 'updateConfig', config: this.getConfigForWebview() });
  }

  refresh() {
    this._view?.webview.postMessage({ command: 'refresh', config: this.getConfigForWebview(), stats: this.getStatsForWebview(), serverStatus: this.serverStatus, serverMessage: this.serverMessage });
  }

  setServerStatus(status: 'unknown' | 'ok' | 'error', message: string) {
    this.serverStatus = status;
    this.serverMessage = message;
    this._view?.webview.postMessage({ command: 'serverStatus', status, message });
  }

  private getConfigForWebview() {
    return {
      serverUrl: this.config.serverUrl,
      enabled: this.config.enabled,
      enableEditPrediction: this.config.enableEditPrediction,
      aggressivenessMode: this.config.aggressivenessMode,
    };
  }

  private getStatsForWebview() {
    return this.manager?.getStats() ?? {
      totalShown: 0, totalAccepted: 0, acceptRate: 0,
      hasActiveSuggestion: false, activeRegions: 0,
      currentRegionIndex: 0, aggressivenessMode: 'auto', maxEditRegions: 5,
    };
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    const nonce = getNonce();
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml(nonce);

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

  private getHtml(nonce: string): string {
    const stats = this.getStatsForWebview();

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 8px; margin: 0; }
.section { margin-bottom: 16px; }
.section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--vscode-descriptionForeground); margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid var(--vscode-panel-border); }
.row { display: flex; align-items: center; justify-content: space-between; padding: 4px 0; }
.label { color: var(--vscode-foreground); }
.value { color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
.badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; font-weight: 500; }
.bg-green { background: #4ec94733; color: #4ec947; }
.bg-red { background: #f14c4c33; color: #f14c4c; }
.bg-yellow { background: #e2b71433; color: #e2b714; }
button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; border-radius: 2px; cursor: pointer; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); width: 100%; text-align: center; }
button:hover { background: var(--vscode-button-hoverBackground); }
button.sec { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
button.sec:hover { background: var(--vscode-button-secondaryHoverBackground); }
select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border); padding: 2px 6px; border-radius: 2px; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
.actions { display: flex; gap: 4px; margin-top: 8px; }
.actions button { flex: 1; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }
</style>
</head>
<body>
  <div class="section">
    <div class="section-title">Server</div>
    <div class="row">
      <span class="label">Status</span>
      <span class="value"><span id="srvDot" class="dot" style="background:#888"></span><span id="srvLabel">Unknown</span></span>
    </div>
    <div class="row">
      <span class="label">URL</span>
      <span id="srvUrl" class="value" style="font-size:11px">${this.config.serverUrl}</span>
    </div>
    <div id="srvMsg" style="display:none;font-size:11px"></div>
    <div style="margin-top:6px"><button id="btnTest">Test Connection</button></div>
  </div>
  <div class="section">
    <div class="section-title">Settings</div>
    <div class="row">
      <span class="label">Enabled</span>
      <span id="bdgEnabled" class="value"><span class="badge ${this.config.enabled ? 'bg-green' : 'bg-red'}">${this.config.enabled ? 'ON' : 'OFF'}</span></span>
    </div>
    <div class="row">
      <span class="label">Edit Prediction</span>
      <span id="bdgEditPred" class="value"><span class="badge ${this.config.enableEditPrediction ? 'bg-green' : 'bg-yellow'}">${this.config.enableEditPrediction ? 'ON' : 'OFF'}</span></span>
    </div>
    <div class="row">
      <span class="label">Aggressiveness</span>
      <select id="selAgg">
        <option value="conservative">Conservative</option>
        <option value="balanced">Balanced</option>
        <option value="aggressive">Aggressive</option>
        <option value="auto" selected>Auto</option>
      </select>
    </div>
    <div class="actions">
      <button id="btnToggle">Toggle</button>
      <button id="btnEditPred" class="sec">Edit Pred</button>
    </div>
  </div>
  <div class="section">
    <div class="section-title">Statistics</div>
    <div class="row"><span class="label">Shown</span><span id="statShown" class="value">${stats.totalShown}</span></div>
    <div class="row"><span class="label">Accepted</span><span id="statAccepted" class="value">${stats.totalAccepted}</span></div>
    <div class="row">
      <span class="label">Rate</span>
      <span id="statRate" class="value"><span class="badge bg-red">0%</span></span>
    </div>
  </div>
  <div class="section">
    <div class="section-title">Active Prediction</div>
    <div class="row">
      <span class="label">Status</span>
      <span class="value"><span id="bdgPred" class="badge bg-red">None</span></span>
    </div>
    <div id="predDetails" style="display:none">
      <div class="row"><span class="label">Regions</span><span id="statRegions" class="value">0</span></div>
      <div class="row"><span class="label">Current</span><span id="statCurRegion" class="value">0 of 0</span></div>
      <div class="actions">
        <button id="btnAcceptAll">Accept All</button>
        <button id="btnDismiss" class="sec">Dismiss</button>
      </div>
    </div>
  </div>
<script nonce="${nonce}">
(function() {
  const vscode = acquireVsCodeApi();

  function $(id) { return document.getElementById(id); }

  document.addEventListener('click', e => {
    const id = e.target?.id;
    if (id === 'btnTest') vscode.postMessage({ command: 'testServer' });
    else if (id === 'btnToggle') vscode.postMessage({ command: 'toggleEnabled' });
    else if (id === 'btnEditPred') vscode.postMessage({ command: 'toggleEditPrediction' });
    else if (id === 'btnAcceptAll') vscode.postMessage({ command: 'acceptAll' });
    else if (id === 'btnDismiss') vscode.postMessage({ command: 'dismiss' });
  });

  document.addEventListener('change', e => {
    if (e.target?.id === 'selAgg') vscode.postMessage({ command: 'setAggressiveness', value: e.target.value });
  });

  window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.command) {
      case 'serverStatus':
        $('srvDot').style.background = msg.status === 'ok' ? '#4ec947' : msg.status === 'error' ? '#f14c4c' : '#888';
        $('srvLabel').textContent = msg.status === 'ok' ? 'Connected' : msg.status === 'error' ? 'Error' : 'Unknown';
        if (msg.message) {
          $('srvMsg').style.display = 'block';
          $('srvMsg').textContent = msg.message;
          $('srvMsg').style.color = msg.status === 'ok' ? '#4ec947' : '#f14c4c';
        }
        break;
      case 'refresh':
        const stats = msg.stats;
        $('statShown').textContent = stats.totalShown;
        $('statAccepted').textContent = stats.totalAccepted;
        const rate = (stats.acceptRate * 100).toFixed(0) + '%';
        const rateBadge = $('statRate').querySelector('.badge');
        rateBadge.textContent = rate;
        rateBadge.className = 'badge ' + (stats.acceptRate >= 0.5 ? 'bg-green' : stats.acceptRate >= 0.2 ? 'bg-yellow' : 'bg-red');
        if (stats.hasActiveSuggestion) {
          $('bdgPred').textContent = 'Active';
          $('bdgPred').className = 'badge bg-green';
          $('predDetails').style.display = 'block';
          $('statRegions').textContent = stats.activeRegions;
          $('statCurRegion').textContent = (stats.currentRegionIndex + 1) + ' of ' + stats.activeRegions;
        } else {
          $('bdgPred').textContent = 'None';
          $('bdgPred').className = 'badge bg-red';
          $('predDetails').style.display = 'none';
        }
        break;
      case 'updateConfig':
        const cfg = msg.config;
        $('srvUrl').textContent = cfg.serverUrl;
        const en = $('bdgEnabled').querySelector('.badge');
        en.textContent = cfg.enabled ? 'ON' : 'OFF';
        en.className = 'badge ' + (cfg.enabled ? 'bg-green' : 'bg-red');
        const ep = $('bdgEditPred').querySelector('.badge');
        ep.textContent = cfg.enableEditPrediction ? 'ON' : 'OFF';
        ep.className = 'badge ' + (cfg.enableEditPrediction ? 'bg-green' : 'bg-yellow');
        $('selAgg').value = cfg.aggressivenessMode;
        break;
    }
  });
})();
</script>
</body>
</html>`;
  }
}
