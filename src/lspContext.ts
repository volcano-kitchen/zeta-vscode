import * as vscode from 'vscode';

export async function getLspContext(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<string> {
  const lines: string[] = [];
  const uri = document.uri;

  try {
    const symbols = await vscode.commands.executeCommand<
      vscode.DocumentSymbol[]
    >('vscode.executeDocumentSymbolProvider', uri);

    if (symbols) {
      const enclosing = findEnclosingSymbols(symbols, position);
      for (const sym of enclosing) {
        const range = sym.range;
        const kind = symbolKindToString(sym.kind);
        lines.push(
          `${kind} ${sym.name}: ${sym.detail || ''} (line ${range.start.line + 1})`
        );
      }
    }
  } catch {
    // LSP symbol provider not available
  }

  try {
    const hovers = await vscode.commands.executeCommand<
      vscode.Hover[]
    >('vscode.executeHoverProvider', uri, position);

    if (hovers && hovers.length > 0) {
      for (const hover of hovers) {
        const contents = hover.contents
          .map(c => (typeof c === 'string' ? c : c.value))
          .join(' ');
        if (contents) {
          lines.push(`hover: ${contents}`);
        }
      }
    }
  } catch {
    // Hover provider not available
  }

  try {
    const defs = await vscode.commands.executeCommand<
      vscode.Location[]
    >('vscode.executeDefinitionProvider', uri, position);

    if (defs && defs.length > 0) {
      for (const def of defs.slice(0, 3)) {
        const line = document.lineAt(def.range.start.line);
        lines.push(
          `definition: ${line.text.trim()} (${def.uri.fsPath}:${def.range.start.line + 1})`
        );
      }
    }
  } catch {
    // Definition provider not available
  }

  return lines.join('\n');
}

function symbolKindToString(kind: vscode.SymbolKind): string {
  switch (kind) {
    case vscode.SymbolKind.Function: return 'fn';
    case vscode.SymbolKind.Method: return 'method';
    case vscode.SymbolKind.Class: return 'class';
    case vscode.SymbolKind.Interface: return 'interface';
    case vscode.SymbolKind.Struct: return 'struct';
    case vscode.SymbolKind.Enum: return 'enum';
    case vscode.SymbolKind.Variable: return 'var';
    case vscode.SymbolKind.Constant: return 'const';
    case vscode.SymbolKind.Property: return 'property';
    case vscode.SymbolKind.TypeParameter: return 'type';
    case vscode.SymbolKind.Module: return 'module';
    case vscode.SymbolKind.Namespace: return 'namespace';
    default: return 'symbol';
  }
}

function findEnclosingSymbols(
  symbols: vscode.DocumentSymbol[],
  position: vscode.Position
): vscode.DocumentSymbol[] {
  const result: vscode.DocumentSymbol[] = [];

  function walk(syms: vscode.DocumentSymbol[]) {
    for (const sym of syms) {
      if (sym.range.contains(position)) {
        result.push(sym);
        if (sym.children && sym.children.length > 0) {
          walk(sym.children);
        }
        return;
      }
    }
  }

  walk(symbols);
  return result;
}
