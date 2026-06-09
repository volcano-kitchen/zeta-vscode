import * as vscode from 'vscode';

export interface FimRequest {
  prefix: string;
  suffix: string;
  language?: string;
  filePath?: string;
  lspContext?: string;
}

export interface EditRegionSpec {
  startOffset: number;
  endOffset: number;
  currentText: string;
  markerIndex: number;
}

export interface EditPredictionRequest {
  document: vscode.TextDocument;
  cursorPosition: vscode.Position;
  editHistory: string;
  relatedFiles: string;
  maxRegions: number;
}

export interface ParsedEditRegion {
  markerIndex: number;
  replacement: string;
}

export interface ParsedEditResponse {
  regions: ParsedEditRegion[];
  full: string;
}

const ENDOF_TEXT = '<|endoftext|>';
const FIM_MIDDLE = '<[fim-middle]>';

export function buildFimPrompt(req: FimRequest): string {
  const suffix = req.suffix.trimEnd();
  const prefix = req.prefix.trimStart();

  let header = '';
  if (req.lspContext) {
    header = `/* LSP context:\n${req.lspContext}\n*/\n`;
  }
  if (req.filePath) {
    header += `<filename>${req.filePath}\n`;
  }

  return `${header}<[fim-suffix]>\n${suffix}\n<[fim-prefix]>\n${prefix}\n${FIM_MIDDLE}`;
}

export function getFimStopTokens(): string[] {
  return [ENDOF_TEXT, FIM_MIDDLE, '\n\n'];
}

function buildMarkerRegion(
  document: vscode.TextDocument,
  cursorPosition: vscode.Position,
  regionIndex: number
): string {
  const line = document.lineAt(cursorPosition.line).text;
  const beforeCursor = line.slice(0, cursorPosition.character);
  const afterCursor = line.slice(cursorPosition.character);

  return `${beforeCursor}<|user_cursor|>${afterCursor}`;
}

export function buildEditPredictionPrompt(
  req: EditPredictionRequest
): string {
  const { document, cursorPosition, editHistory, relatedFiles, maxRegions } = req;
  const offset = document.offsetAt(cursorPosition);
  const fullText = document.getText();

  const suffix = fullText.slice(offset).trimEnd();
  const prefix = fullText.slice(0, offset);

  const parts: string[] = [];

  parts.push(`<[fim-suffix]>\n${suffix}`);
  parts.push(`<[fim-prefix]>`);

  if (relatedFiles) {
    parts.push(relatedFiles);
  }

  if (editHistory) {
    parts.push(`<filename>edit_history\n${editHistory}`);
  }

  parts.push(`<filename>${document.uri.fsPath}`);
  parts.push(prefix);

  parts.push(`<|marker_1|>\n${buildMarkerRegion(document, cursorPosition, 1)}\n<|marker_2|>`);
  parts.push(FIM_MIDDLE);

  return parts.join('\n');
}

export function parseEditPredictionResponse(
  response: string,
  maxRegions: number = 5
): ParsedEditResponse {
  const regions: ParsedEditRegion[] = [];

  for (let i = 1; i <= maxRegions; i++) {
    const pattern = new RegExp(
      `<\\|marker_${i}\\|>([\\s\\S]*?)(?:<\\|marker_${i + 1}\\|>|$)`
    );
    const match = response.match(pattern);
    if (match) {
      regions.push({
        markerIndex: i,
        replacement: match[1].trim(),
      });
    } else {
      break;
    }
  }

  return { regions, full: response };
}

export function getEditPredictionStopTokens(): string[] {
  return [ENDOF_TEXT, FIM_MIDDLE];
}
