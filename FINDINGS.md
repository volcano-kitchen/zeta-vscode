# Zeta VS Code Extension — Findings & Progress

## Current Status

✅ Phase 2 fully implemented. Extension builds and type-checks cleanly.
✅ Sidebar webview renders, buttons work, "Test Connection" works.
✅ Settings changes apply live (no reload needed).
✅ Server connection succeeds with correct `zeta.modelName` setting.
✅ Prompt format matches Zeta 2.1 V0318SeedMultiRegions format from Zed.

## Issues Found & Fixed

| # | Issue | Status | Fix |
|---|-------|--------|------|
| 1 | Settings search `@ext:zeta-vscode` didn't find settings | ✅ Fixed | Changed to `@ext:local.zeta-vscode` |
| 2 | Webview sidebar "keeps loading" — icon `$(sparkle)` invalid for activity bar | ✅ Fixed | Use `media/zeta-icon.svg` file path |
| 3 | Webview sidebar "keeps loading" — missing CSP nonce for inline scripts | ✅ Fixed | Added `Content-Security-Policy` with `script-src 'nonce-...'` |
| 4 | `zeta.testServer` not found — commands registered conditionally inside `if (editPredManager)` | ✅ Fixed | All commands registered unconditionally; sidebar accepts nullable manager |
| 5 | `getEditPredictionManager()` returned null — returned field directly | ✅ Fixed | Now calls `ensureEditPredictionManager()` which lazy-creates |
| 6 | Webview buttons don't fire — inline `onclick` handlers blocked by VS Code CSP | ✅ Fixed | Switched to `addEventListener` + event delegation on `document` |
| 7 | Webview status doesn't update — full HTML refresh (`refresh()`) resets state | ✅ Fixed | Use `window.addEventListener('message')` + `postMessage` from extension for live updates |
| 8 | Config change listener not added to `context.subscriptions` — settings change didn't persist | ✅ Fixed | Added `context.subscriptions.push(onDidChangeConfiguration(...))` |
| 9 | Test connection used hardcoded `zeta-2.1` model name — ignored settings | ✅ Fixed | `testServerConnection()` now reads `modelName` from config |
| 10 | Webview buttons still didn't fire — `addEventListener` on individual elements unreliable | ✅ Fixed | Event delegation on `document.getElementById('click')` checking `e.target.id` |
| 11 | Hard to debug model name — no visibility into what value is being sent | ✅ Fixed | Error message now shows `model:"..."` + config inspect info |
| 12 | Edit prediction prompt format was wrong — only 2 markers around cursor line, wrong suffix/prefix, missing `end▁of▁sentence` stop token | ✅ Fixed | Rewrote to match Zeta 2.1 V0318SeedMultiRegions format: block-split editable region (6-16 lines per block), SPM order (suffix after editable window), `<[end▁of▁sentence]>` stop token+end marker |

## V0318 Prompt Format (Zeta 2.1)

```
<[fim-suffix]>
{text AFTER editable window}
<[fim-prefix]>
{related files with <filename> tags}
<filename>edit_history
{edit history diff}
<filename>{target/file}
{text BEFORE editable window}
<|marker_1|>
{block 1 of editable window (6-16 lines)}
<|marker_2|>
{block 2 with <|user_cursor|>}
<|marker_3|>
{block 3}
<[fim-middle]>
```

### Editable Window
- 30 lines before cursor, 10 lines after cursor (= ~40 lines total)
- Split into blocks of 6-16 lines each
- Prefer split at blank-line boundaries
- Each block wrapped with `<|marker_N|>`

### Model Output
- **Edit**: `<|marker_1|>new content for blocks 1-3<|marker_3|><[end▁of▁sentence]>`
- **No edit**: `<|marker_2|><|marker_2|><[end▁of▁sentence]>` (same marker repeated)
- Stop tokens: `<|endoftext|>`, `<[end▁of▁sentence]>`, `<[fim-middle]>`

### Key Difference from Old Code
- Old: suffix = text AFTER cursor, prefix = text before cursor, only 2 markers
- New: suffix = text AFTER editable window, prefix includes context before window, editable window split into N marker blocks

## Architecture

```
extension.ts (activate)
  ├→ ZetaInlineCompletionProvider (InlineCompletionItemProvider)
  │   ├→ handleAutomatic/handleExplicit (FIM, debounced)
  │   ├→ handleEditPrediction (via EditPredictionManager)
  │   └→ falls back to FIM when edit prediction returns null
  ├→ EditHistoryTracker (tracks file edits)
  ├→ EditPredictionManager (prediction lifecycle, pre-fetch, stats, aggressiveness)
  │   └→ resolveRegionLocations: maps V0318 marker blocks → document line ranges
  ├→ GutterDecorationManager (gutter arrows + inline diff decorations)
  ├→ EditPredictionHoverProvider (hover tooltip diff preview)
  ├→ ZetaSidebarProvider (webview control panel)
  │   ├→ Uses postMessage (extension→webview) for live status/stats updates
  │   ├→ Uses onDidReceiveMessage (webview→extension) for button clicks
  │   └→ Attributes: event delegation, nonce CSP, separate script
  └→ Commands: testServer, acceptAndAdvance, jumpToNext/Prev, acceptAll, dismiss
```

### Webview Communication Pattern

```
Extension → Webview: webview.postMessage({ command, data })
  → window.addEventListener('message') updates specific DOM elements

Webview → Extension: vscode.postMessage({ command, value })
  → webviewView.webview.onDidReceiveMessage() dispatches to commands
```

## Key Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `zeta.serverUrl` | `http://localhost:8080` | llama.cpp server URL |
| `zeta.modelName` | `zeta-2.1` | Model name sent in `/v1/completions` (set to `zeta2.1` if server loaded as `zeta2.1`) |
| `zeta.enableEditPrediction` | `false` | Use edit prediction instead of FIM |
| `zeta.prefetchEnabled` | `true` | Pre-fetch next prediction |
| `zeta.maxEditRegions` | `5` | Max multi-region edits to parse |
| `zeta.aggressivenessMode` | `auto` | Adjusts regions shown based on accept rate |

## Known Requirements

- llama.cpp server running with Zeta 2.1 GGUF model at configured URL
- `zeta.modelName` must match whatever name the model was loaded with (default: `zeta-2.1`)
- **Important**: the setting `zeta.modelName` defaults to `zeta-2.1` but the model GGUF file on many servers loads as `zeta2.1` — change in Settings → `@ext:local.zeta-vscode`
- `zeta.enableEditPrediction` must be `true` to activate Phase 2
- VS Code window reload required after installing new VSIX with `package.json` changes

## To Test

1. Pull latest: `git pull`
2. Rebuild: `npm run build`
3. Package: `npx @vscode/vsce package`
4. Install VSIX in VS Code, **Reload Window**
5. Click Zeta icon in activity bar → Test Connection
6. Set `zeta.modelName` to match server's model name
7. Set `zeta.enableEditPrediction` to `true`
8. Type code — should see inline ghost text + gutter arrows
