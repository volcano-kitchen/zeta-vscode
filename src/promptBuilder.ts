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
  endMarkerIndex: number;
  replacement: string;
}

export interface ParsedEditResponse {
  regions: ParsedEditRegion[];
  full: string;
}

// V0318SeedMultiRegions tokens (Zeta 2.1 format)
const ENDOF_TEXT = '<|endoftext|>';
const FIM_SUFFIX = '<[fim-suffix]>';
const FIM_PREFIX = '<[fim-prefix]>';
const FIM_MIDDLE = '<[fim-middle]>';
const FILE_MARKER = '<filename>';
const CURSOR_MARKER = '<|user_cursor|>';
const V0318_END_MARKER = '<[end▁of▁sentence]>';

// Editable window sizing (V0318 uses 350 editable tokens ≈ ~1000 bytes)
const EDITABLE_LINES_BEFORE = 30;
const EDITABLE_LINES_AFTER = 10;
const MIN_BLOCK_LINES = 6;
const MAX_BLOCK_LINES = 16;

export function buildFimPrompt(req: FimRequest): string {
  const suffix = req.suffix.trimEnd();
  const prefix = req.prefix.trimStart();

  let header = '';
  if (req.lspContext) {
    header = `/* LSP context:\n${req.lspContext}\n*/\n`;
  }
  if (req.filePath) {
    header += `${FILE_MARKER}${req.filePath}\n`;
  }

  return `${header}${FIM_SUFFIX}\n${suffix}\n${FIM_PREFIX}\n${prefix}\n${FIM_MIDDLE}`;
}

export function getFimStopTokens(): string[] {
  return [ENDOF_TEXT, FIM_MIDDLE, V0318_END_MARKER, '\n\n'];
}

// --- Block splitting (mimics compute_marker_offsets_v0318) ---

function splitIntoBlocks(text: string, minLines: number, maxLines: number): number[] {
  if (!text) return [0, 0];
  const lines = text.split('\n');
  const offsets: number[] = [0];
  let lastBoundary = 0;

  for (let i = 0; i < lines.length; i++) {
    const gap = i - lastBoundary;

    // prefer split at blank-line boundaries when minLines reached
    if (gap >= minLines && i > 0 && lines[i - 1].trim() === '') {
      offsets.push(countBytes(lines.slice(0, i)));
      lastBoundary = i;
      continue;
    }

    // hard cap: split at maxLines
    if (gap >= maxLines) {
      offsets.push(countBytes(lines.slice(0, i)));
      lastBoundary = i;
    }
  }

  const end = countBytes(lines);
  if (offsets[offsets.length - 1] !== end) {
    offsets.push(end);
  }
  return offsets;
}

function countBytes(lines: string[]): number {
  let len = 0;
  for (let i = 0; i < lines.length; i++) {
    len += lines[i].length + 1;
  }
  return len === 0 ? 0 : len - 1; // remove trailing newline added to last
}

function getTextRange(document: vscode.TextDocument, startLine: number, endLine: number): string {
  const start = document.offsetAt(new vscode.Position(Math.max(0, startLine), 0));
  const endLineClamped = Math.min(endLine, document.lineCount - 1);
  const endLineLen = document.lineAt(endLineClamped).text.length;
  const end = document.offsetAt(new vscode.Position(endLineClamped, endLineLen));
  return document.getText().slice(start, end);
}

// --- Prompt building ---

export function buildEditPredictionPrompt(
  req: EditPredictionRequest
): string {
  const { document, cursorPosition, editHistory, relatedFiles } = req;
  const cursorLine = cursorPosition.line;
  const docLineCount = document.lineCount;

  // define editable window around cursor
  const editableStartLine = Math.max(0, cursorLine - EDITABLE_LINES_BEFORE);
  const editableEndLine = Math.min(docLineCount - 1, cursorLine + EDITABLE_LINES_AFTER);

  // text before editable window (context)
  const prefixText = getTextRange(document, 0, editableStartLine);

  // editable window text
  const editableText = getTextRange(document, editableStartLine, editableEndLine + 1);

  // text after editable window (suffix)
  const suffixLineStart = Math.min(docLineCount - 1, editableEndLine + 1);
  const suffixStart = document.offsetAt(new vscode.Position(suffixLineStart, 0));
  const suffixText = document.getText().slice(suffixStart);

  // compute cursor offset within editable text
  const cursorOffset = document.offsetAt(cursorPosition);
  const editableStartOffset = document.offsetAt(new vscode.Position(editableStartLine, 0));
  const cursorInEditable = cursorOffset - editableStartOffset;

  // split editable text into marker blocks
  const blockOffsets = splitIntoBlocks(editableText, MIN_BLOCK_LINES, MAX_BLOCK_LINES);

  const parts: string[] = [];

  // Suffix first (SPM order)
  parts.push(`${FIM_SUFFIX}\n${suffixText}`);

  // Prefix section
  parts.push(`${FIM_PREFIX}`);

  // Related files
  if (relatedFiles) {
    parts.push(relatedFiles);
  }

  // Edit history
  if (editHistory) {
    parts.push(`${FILE_MARKER}edit_history\n${editHistory}`);
  }

  // Cursor excerpt section
  parts.push(`${FILE_MARKER}${document.uri.fsPath}`);
  parts.push(prefixText);

  // Write marker blocks (matches write_editable_with_markers_v0318)
  let cursorPlaced = false;
  for (let i = 0; i < blockOffsets.length - 1; i++) {
    const blockStart = blockOffsets[i];
    const blockEnd = blockOffsets[i + 1];
    const markerNum = i + 1;
    let block = editableText.slice(blockStart, blockEnd);

    parts.push(`<|marker_${markerNum}|>`);
    if (!cursorPlaced && cursorInEditable >= blockStart && cursorInEditable <= blockEnd) {
      cursorPlaced = true;
      const cursorInBlock = cursorInEditable - blockStart;
      const bounded = Math.min(cursorInBlock, block.length);
      parts.push(block.slice(0, bounded) + CURSOR_MARKER + block.slice(bounded));
    } else {
      parts.push(block);
    }
  }

  parts.push(FIM_MIDDLE);

  return parts.join('\n');
}

// --- Response parsing ---

export function parseEditPredictionResponse(
  response: string,
  _maxRegions: number = 5
): ParsedEditResponse {
  // Strip the end marker if present
  let text = response.trimEnd();
  if (text.endsWith(V0318_END_MARKER)) {
    text = text.slice(0, -V0318_END_MARKER.length).trimEnd();
  }

  const regions: ParsedEditRegion[] = [];

  // Find all <|marker_N|> tags
  const markerRe = /<\|marker_(\d+)\|>/g;
  const markers: Array<{ num: number; start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = markerRe.exec(text)) !== null) {
    const tagEnd = match.index + match[0].length;
    markers.push({
      num: parseInt(match[1], 10),
      start: match.index,
      end: tagEnd,
    });
  }

  if (markers.length < 2) return { regions: [], full: response };

  const firstMarker = markers[0];
  const lastMarker = markers[markers.length - 1];

  // Same marker repeated with no content or empty content between = no edits
  if (firstMarker.num === lastMarker.num) {
    return { regions: [], full: response };
  }

  // Extract content between first and last marker tags
  const contentStart = firstMarker.end;
  const contentEnd = lastMarker.start;
  const replacement = text.slice(contentStart, contentEnd).trim();

  // Create a single region spanning from first to last marker
  regions.push({
    markerIndex: firstMarker.num,
    endMarkerIndex: lastMarker.num,
    replacement,
  });

  return { regions, full: response };
}

export function getEditPredictionStopTokens(): string[] {
  return [ENDOF_TEXT, V0318_END_MARKER, FIM_MIDDLE];
}

// Strip all V0318 control tokens from model output (for FIM path)
export function sanitizeCompletion(text: string): string {
  return text
    .replace(/<\|marker_\d+\|>/g, '')
    .replace(/<\|user_cursor\|>/g, '')
    .replace(/<\[end▁of▁sentence\]>/g, '')
    .replace(/NO_EDITS\s*/g, '')
    .replace(/<<<<<<< CURRENT\s*/g, '')
    .replace(/=======\s*/g, '')
    .replace(/>>>>>>> UPDATED\s*/g, '')
    .trim();
}
