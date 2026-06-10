# AI Autocomplete & Edit Prediction Research

## Zed

### Native Features (no extensions needed)

**Edit Prediction** - Built-in inline completion system that sends each keystroke as a request to an edit prediction provider, returning inline suggestions (accept with Tab).

**Supported Providers:**
- **Zeta** (default, open-source model by Zed) - Requires sign-in
- **GitHub Copilot** (cloud, paid)
- **Mercury Coder** (cloud)
- **Codestral** (Mistral, cloud)

**Local Model Support** (via Settings -> "Use a Local Model"):
- **Ollama** - Full Zed AI features + Edit Prediction
- **LM Studio** - Full Zed AI features + Edit Prediction
- **Local OpenAI-compatible server** - Full Zed AI features + Edit Prediction (e.g., vLLM, llama.cpp, Text Generation Inference)
- **Local/self-hosted edit prediction server** - Edit Prediction only (no Agent/Agent features)

**External Agents** - Separate config from main AI. Run external MCP-based agents (Claude Code, Codex, Cursor, etc.) via Terminal Threads.

### Extensions
- **Zabby** (22k downloads) - Tabby IDE integration for Zed. Connects Zed to self-hosted Tabby server.
- **Corust Agent** (17k downloads) - Rust-focused AI coding agent.
- **OpenCode** (425k downloads) - Open source coding agent (listed in general extensions).

---

## Cursor

Cursor is a Chromium-based editor (fork of VS Code) with built-in AI-native features.

### Built-in Local Model Support
- **Custom Models** - Settings -> "Model" -> "Custom Model" allows connecting any OpenAI-compatible API
- Supports vLLM, llama.cpp, Ollama, LM Studio, and any OpenAI-compatible endpoint
- Configure base URL, model name, and API key (or omit for local)
- Can set up local models for both autocomplete and agent features

### Extensions (VS Code extension marketplace)
- **Continue** - Open source AI autocomplete/chat for VS Code (works in Cursor)
- **CodeGPT** - Open source AI coding assistant
- **Cline** (formerly Wipet) - Open source autonomous coding agent
- **Tabby** - Self-hosted code assistant

### Key Features
- Codebase indexing via RAG
- Cursor Command (AI chat in sidebar)
- Tab autocomplete (inline completions)
- Composer (multi-file editing)

---

## VS Code

### Built-in
- **GitHub Copilot** - Default AI assistant (paid subscription)
- **GitHub Copilot Chat** - AI chat integration
- **GitHub Copilot Edits** - AI-assisted file editing
- **IntelliCode** - Microsoft's free completion engine (trained on public repos)

### Open Source Extensions

**Continue** (⭐ 30k+)
- Open source AI autocomplete & chat for VS Code
- Supports: Ollama, LM Studio, vLLM, llama.cpp, Text Gen Inference, and any OpenAI-compatible API
- Configurable via `continue.yaml`
- Inline completions, chat, edit, and codebase indexing
- Works with local models: Ollama, vLLM, llama.cpp, etc.
- Also supports cloud: Claude, GPT-4, Gemini, Codestral

**Tabby** (⭐ 15k+)
- Self-hosted code assistant
- VS Code extension: `tabby-client-vscode`
- Uses self-hosted Tabby server
- Supports any model backend (OpenChat, CodeLlama, etc.)
- Provides inline completions

**Cline** (⭐ 10k+)
- Open source autonomous coding agent
- Supports local models via OpenAI-compatible endpoints
- Can work with Ollama, vLLM, etc.
- Multi-file editing, terminal access, MCP support

**CodeGPT**
- Open source AI coding assistant
- Supports multiple providers including local models

**Copilot alternatives for VS Code:**
- **ConCode** - Claude Code integration for VS Code
- **Aider** - Open source pair programming (terminal-based)

### Popular Local Model Configurations

**Continue + Ollama:**
```yaml
# .continue/config.yaml
models:
  main:
    title: "Ollama"
    model: "codestral"
    apiBase: "http://localhost:11434/v1"
    completion:
      model: "codestral"
```

**Continue + vLLM:**
```yaml
models:
  main:
    title: "vLLM"
    model: "Your/Model"
    apiBase: "http://localhost:8000/v1"
```

---

## Neovim

### copilot.lua (⭐ 14k+)
- Native Lua implementation of GitHub Copilot for Neovim
- Drop-in replacement for copilot.vim
- **Supports local models:** Ollama, LM Studio, any OpenAI-compatible API
- Config via `require('copilot').setup()`
- Works with: Ollama (http://localhost:11434), vLLM, llama.cpp
- Features: inline completion, suggestion accept/reject

```lua
-- Example with Ollama
require('copilot').setup({
  suggestion = { enabled = true },
  panel = { enabled = true },
})
```

### copilot-cmp (⭐ 1k+)
- Completion source for nvim-cmp
- Brings Copilot suggestions into the cmp completion menu
- Works alongside copilot.lua
- Can use local model providers

### copilot.vim (original, now deprecated)
- VimScript-based Copilot plugin
- Replaced by copilot.lua

### Tabby for Neovim
- Self-hosted code assistant
- Uses Tabby server as backend
- Provides inline completions

### Other Options

**Concode** - Claude Code integration for Neovim via terminal

**Aider** - Open source AI pair programming (runs in terminal, can be integrated)

---

## Summary: Open Source + Local Model Options

| Editor | Plugin/Feature | Local Model Support | Open Source |
|--------|---------------|---------------------|-------------|
| **Zed** | Native Edit Prediction | Ollama, LM Studio, OpenAI-compatible, custom EP server | Yes (Zeta) |
| **Zed** | Zabby extension | Tabby server | Yes |
| **Cursor** | Built-in Custom Models | Any OpenAI-compatible API | N/A (proprietary) |
| **Cursor** | Continue extension | Ollama, vLLM, LM Studio, llama.cpp | Yes |
| **VS Code** | Native IntelliCode | Microsoft cloud models | Yes (Microsoft) |
| **VS Code** | Continue | Ollama, vLLM, LM Studio, llama.cpp, etc. | Yes |
| **VS Code** | Tabby | Tabby server | Yes |
| **VS Code** | Cline | OpenAI-compatible APIs | Yes |
| **Neovim** | copilot.lua | Ollama, LM Studio, OpenAI-compatible | Yes |
| **Neovim** | copilot-cmp | Any provider | Yes |
| **Neovim** | Tabby client | Tabby server | Yes |

## Recommendation for Your Setup (Zeta2.1 Inference Server)

Since you have a **Zeta2.1 inference server** (likely OpenAI-compatible endpoint):

1. **Zed:** Use Settings -> "Use a Local Model" -> "Local OpenAI-compatible server" and point to your Zeta2.1 endpoint. This gives you both Agent features AND Edit Prediction.

2. **Cursor:** Settings -> Model -> "Custom Model" -> Configure your Zeta2.1 endpoint as OpenAI-compatible.

3. **VS Code:** Install **Continue** extension, configure with your Zeta2.1 endpoint URL.

4. **Neovim:** Use **copilot.lua** with `apiBase` pointing to your Zeta2.1 endpoint.

All four editors support OpenAI-compatible endpoints, so your Zeta2.1 server should work with proper configuration.

---

## Quick Setup Guide

### Zed (Local OpenAI-compatible)
1. Settings -> AI -> "Use a Local Model"
2. Select "Local OpenAI-compatible server"
3. Enter your Zeta2.1 server URL (e.g., `http://localhost:8000`)
4. Enter model name and API key if required

### Cursor (Custom Model)
1. Settings -> "Model" -> "Custom Model"
2. Base URL: your Zeta2.1 endpoint
3. Model: your model name
4. API key (if required)

### VS Code (Continue)
```jsonc
// .continue/config.yaml
models:
  main:
    title: "Zeta2.1"
    model: "zeta2.1"
    apiBase: "http://your-zeta21-server:port/v1"
    completion:
      model: "zeta2.1"
```

### Neovim (copilot.lua)
```lua
-- init.lua or lua/copilot.lua
require('copilot').setup({
  api_base = "http://your-zeta21-server:port/v1",
  -- additional settings
})
```
