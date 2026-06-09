# Zeta VS Code Extension — Project Knowledge

## What This Is

A VS Code extension that provides **FIM autocomplete** and **edit prediction** (next-edit suggestions) using the open-weight **Zeta 2.1** model from Zed Industries via a local llama.cpp server (or any OpenAI-compatible `/v1/completions` endpoint).

Zeta 2.1 is an 8B-parameter code edit prediction model (Apache 2.0), fine-tuned from ByteDance-Seed/Seed-Coder-8B-Base. It uses an SPM (Suffix-Prefix-Middle) FIM format with numbered multi-region markers for editable regions.

## Architecture

```
User types → InlineCompletionProvider (debounced)
  ├→ FIM path (Phase 1): buildFimPrompt → InferenceClient → ghost text
  └→ Edit Prediction path (Phase 2): EditPredictionManager
       → PromptBuilder (edit history + related files + multi-marker SPM)
       → InferenceClient
       → Parse multi-region markers
       → InlineCompletionItem (primary region)
       → GutterDecorationManager (all regions)
       → EditPredictionHoverProvider (diff preview on hover)
       → Tab-to-advance through regions
       → Pre-fetch next prediction
       → Aggressiveness adaptation (accept/reject tracking)
```

## File Reference

| File | Purpose |
|---|---|---|
| `src/extension.ts` | Entry point — activates provider, registers status bar item, commands |
| `src/inlineCompletionProvider.ts` | VS Code `InlineCompletionItemProvider` — handles autocomplete/explicit triggers, debounce, cancellation, LSP injection |
| `src/inferenceClient.ts` | HTTP client to llama.cpp OpenAI-compatible `/v1/completions` with abort support |
| `src/promptBuilder.ts` | Builds Zeta 2.1 SPM FIM prompts and edit prediction prompts; parses edit prediction responses |
| `src/lspContext.ts` | LSP context injection — queries document symbols, hover info, definitions at cursor |
| `src/editHistory.ts` | Per-file edit event ring buffer + recent file path tracker (for Phase 2 edit prediction) |
| `src/config.ts` | Typed settings loader from VS Code configuration |
| `src/editPredictionManager.ts` | Core edit prediction lifecycle — prompt building, API calls, multi-region parsing, pre-fetch, accept/reject tracking, aggressiveness adaptation |
| `src/gutterDecorations.ts` | Gutter arrow + overview ruler decorations for off-screen edit prediction locations |
| `src/diffWidget.ts` | Hover provider showing compact diff preview for predicted edit regions |

## Settings (`zeta.*`)

| Setting | Default | Description |
|---|---|---|---|
| `serverUrl` | `http://localhost:8080` | llama.cpp server URL |
| `modelName` | `zeta-2.1` | Model name in /v1/completions |
| `maxContextTokens` | 28672 | Max prompt tokens (model has 32K) |
| `debounceMs` | 250 | Typing debounce delay |
| `temperature` | 0.1 | Sampling temperature |
| `maxFimTokens` | 64 | Max tokens for FIM responses |
| `maxEditPredictionTokens` | 256 | Max tokens for edit prediction |
| `enabled` | true | Master toggle |
| `enableEditPrediction` | false | Enable next-edit prediction (Phase 2) |
| `experimentalInjectLsp` | false | Inject LSP symbols/hover/defs into prompt |
| `fimContextLines` | 100 | Lines before cursor for FIM |
| `fimSuffixLines` | 30 | Lines after cursor for FIM |
| `prefetchEnabled` | true | Speculatively pre-fetch next edit prediction |
| `maxRelatedFiles` | 3 | Max related files to inject for cross-file context |
| `maxEditRegions` | 5 | Max marker pairs to parse from response |
| `aggressivenessMode` | `auto` | `auto` / `conservative` / `balanced` / `aggressive` |
| `aggressivenessThreshold` | 0.3 | Min accept rate to maintain current level in `auto` mode |

## Prompt Formats

### FIM Autocomplete (Phase 1 — current)

```
<[fim-suffix]>
{text after cursor}
<[fim-prefix]>
{text before cursor}
<[fim-middle]>
```

If `experimentalInjectLsp` is on, prepends:
```
/* LSP context:
{fn add(a: number, b: number): number (line 42)}
*/
```

Stop tokens: `<|endoftext|>`, `<[fim-middle]>`, `\n\n`

### Edit Prediction (Phase 2 — current)

```
<[fim-suffix]>
{text from cursor position to end of file}
<[fim-prefix]>
{related files content with <filename> tags}
<filename>edit_history
--- a/{file}
+++ b/{file}
-{old}
+{new}

<filename>{target/file}
{text from start of file to cursor position}
<|marker_1|>
{line at cursor}<|user_cursor|>{rest of cursor line}
<|marker_2|>
<[fim-middle]>
```

Expected model output (multi-region):
```
<|marker_1|>
{rewritten region 1 content}
<|marker_2|>
```

The parser also handles `marker_3`..`marker_N` for multi-region edits.

Stop tokens: `<|endoftext|>`, `<[fim-middle]>`

## llama.cpp Server Setup

```bash
# Download Zeta 2.1 GGUF (Q4_K_M recommended — ~4.8GB VRAM)
# From huggingface: adilkairolla/zeta-2.1-GGUF

# Run server with FIM support + KV cache
llama-server \
  -m zeta-2.1-Q4_K_M.gguf \
  --host 0.0.0.0 \
  --port 8080 \
  -c 32768 \
  --cache-type-k f16 \
  --cache-type-v f16 \
  --parallel 4
```

## Key Design Decisions

1. **SPM format (suffix-first)** — Zeta 2.1 uses suffix-prefix-middle ordering, NOT standard prefix-suffix-middle. This is intentional in the model's training.

2. **Prompt cache friendly** — The most stable parts of the prompt (related files, edit history) come first in the prefix section; only the suffix and cursor window change per keystroke. This maximizes KV cache reuse in llama.cpp/vLLM.

3. **LSP injection** — When enabled, queries VS Code's LSP APIs (documentSymbol, hover, definition) at cursor position and injects a comment block. This gives the model type context without changing the prompt structure.

4. **Dual-model architecture (future)** — Zeta 2.1 handles edit prediction (with trajectory history). A separate small FIM model (qwen2.5-coder:1.5b) can be added for low-latency cursor autocomplete. Currently we try Zeta 2.1 for both.

5. **Edit history tracking** — `editHistory.ts` records per-file text edits (with old/new text and ranges) and recent file switches. Ready for edit prediction prompt building in Phase 2.

## Phase 2 Plan (Edit Prediction + Long-Distance Jumps) ✓

- [x] Build full edit prediction prompt with edit_history + related files
- [x] Parse multi-region output (`<|marker_1|>...<|marker_2|>`)
- [x] Long-distance jump widget (compact diff preview near cursor)
- [x] Gutter arrows for off-screen edit locations
- [x] Tab-to-navigate + Tab-to-accept UX
- [x] Speculative pre-fetch on prediction shown
- [x] Per-user aggressiveness adaptation (accept/reject tracking)

### Future Ideas
- Dual-model architecture: small FIM model (qwen2.5-coder:1.5b) for low-latency autocomplete + Zeta 2.1 for edit prediction
- Multi-line FIM middle support
- User-specific aggressiveness persistence across sessions
- Per-project accept/reject stats

## Running in Development

```bash
# Install deps
npm install

# Build
npm run build

# Type check
npm run lint

# Watch mode
npm run watch

# Then in VS Code: F5 → Extension Development Host
```

## License

Apache 2.0
