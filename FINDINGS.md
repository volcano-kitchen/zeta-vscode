# Zeta VS Code Extension — Findings & Progress

## Current Status

Phase 2 (edit prediction) is fully implemented. The extension builds and type-checks cleanly. The sidebar webview "keeps loading" — root cause identified and being fixed iteratively.

## Issues Found & Fixed

| # | Issue | Status | Fix |
|---|-------|--------|-----|
| 1 | Settings search `@ext:zeta-vscode` didn't find settings | ✅ Fixed | Changed to `@ext:local.zeta-vscode` |
| 2 | Webview sidebar "keeps loading" — activity bar icon `$(sparkle)` is invalid | ✅ Fixed | Changed to `media/zeta-icon.svg` file path |
| 3 | Webview sidebar "keeps loading" — missing CSP nonce for inline scripts, scripts blocked by VS Code default CSP | ✅ Fixed | Added `Content-Security-Policy` with nonce attribute on `<script>` tag |
| 4 | `zeta.testServer` command not found — sidebar commands registered conditionally inside `if (editPredManager)` block | ✅ Fixed | All commands are now registered unconditionally in `extension.ts`; sidebar accepts nullable manager |
| 5 | `getEditPredictionManager()` returned null — returned field directly instead of lazy-creating | ✅ Fixed | Now calls `ensureEditPredictionManager()` which creates if null |

## Remaining Concerns

- **Webview still loading?** After all fixes, user may need to **reload VS Code window** (`Developer: Reload Window`) after installing the updated VSIX — package.json `contributes.viewsContainers` changes require a full window reload.
- **Edit prediction doesn't trigger** unless `zeta.enableEditPrediction` is `true` and server is running.
- **No server running** = no completions at all. Must have llama.cpp server with Zeta 2.1 model.

## Architecture

```
extension.ts (activate)
  ├→ ZetaInlineCompletionProvider (InlineCompletionItemProvider)
  │   ├→ handleAutomatic/handleExplicit (FIM, debounced)
  │   ├→ handleEditPrediction (via EditPredictionManager)
  │   └→ falls back to FIM when edit prediction returns null
  ├→ EditHistoryTracker (tracks file edits)
  ├→ EditPredictionManager (prediction lifecycle, pre-fetch, stats, aggressiveness)
  ├→ GutterDecorationManager (gutter arrows + inline diff decorations)
  ├→ EditPredictionHoverProvider (hover tooltip diff preview)
  ├→ ZetaSidebarProvider (webview control panel)
  └→ Commands: testServer, acceptAndAdvance, jumpToNext/Prev, acceptAll, dismiss
```

## Prompt Formats (Edit Prediction)

### Input (SPM format, suffix-first)
```
<[fim-suffix]>
{text from cursor to end of file}
<[fim-prefix]>
{related files with <filename> tags}
<filename>edit_history
{'diff of recent edits'}
<filename>{current file}
{text from start to cursor}
<|marker_1|>
{cursor line}<|user_cursor|>{rest of line}
<|marker_2|>
<[fim-middle]>
```

### Expected output (multi-region)
```
<|marker_1|>
{rewritten region 1}
<|marker_2|>
... (optional marker_3..marker_N for multi-region)
```

Stop tokens: `<|endoftext|>`, `<[fim-middle]>`

## Key Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `zeta.serverUrl` | `http://localhost:8080` | llama.cpp server |
| `zeta.enableEditPrediction` | `false` | Use edit prediction instead of FIM |
| `zeta.prefetchEnabled` | `true` | Pre-fetch next prediction |
| `zeta.maxEditRegions` | `5` | Max multi-region edits to parse |
| `zeta.aggressivenessMode` | `auto` | Adjusts max regions based on accept rate |

## To Verify

1. Pull latest: `git pull`
2. Rebuild: `npm run build`
3. Package: `npx @vscode/vsce package`
4. Install VSIX in VS Code
5. **Reload VS Code window** (Developer: Reload Window)
6. Click Zeta icon in activity bar
7. Click "Test Connection" — should show result
8. Set `zeta.enableEditPrediction` to `true`
9. Type code — should see inline completions + gutter arrows
