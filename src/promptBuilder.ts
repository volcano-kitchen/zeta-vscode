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

const ENDOF_TEXT = '<|endoftext|>';
const FIM_SUFFIX = '<|fim_suffix|>';
const FIM_PREFIX = '<|fim_prefix|>';
const FIM_MIDDLE = '<|fim_middle|>';
const FILE_MARKER = '<filename>';
const CURSOR_MARKER = '<|user_cursor|>';
const V0318_END_MARKER = '<[end▁of▁sentence]>';

const EDITABLE_LINES_BEFORE = 30;
const EDITABLE_LINES_AFTER = 10;
const MIN_BLOCK_LINES = 6;
const MAX_BLOCK_LINES = 16;

export function buildFimPrompt(req: FimRequest): string {
  const suffix = req.suffix.trimEnd();
  const prefix = req.prefix.trimStart();

  // LSP context as comment only (experimental)
  let lspHeader = '';
  if (req.lspContext) {
    lspHeader = `/* LSP context:\n${req.lspContext}\n*/\n`;
  }

  // Seed-Coder SPM format: suffix first, then prefix, then model fills middle
  return `${lspHeader}${FIM_SUFFIX}\n${suffix}\n${FIM_PREFIX}\n${prefix}\n${FIM_MIDDLE}`;
}

export function getFimStopTokens(): string[] {
  return [ENDOF_TEXT, FIM_MIDDLE, FIM_SUFFIX, FIM_PREFIX, V0318_END_MARKER];
}

export function splitIntoBlocks(text: string, minLines: number, maxLines: number): number[] {
  if (!text) return [0, 0];
  let lines = text.split('\n');
  // drop trailing empty element from split when text ends with '\n'
  if (text.endsWith('\n') && lines.length > 1 && lines[lines.length - 1] === '') {
    lines = lines.slice(0, -1);
  }

  const offsets: number[] = [0];
  let lastBoundary = 0;

  for (let i = 0; i < lines.length; i++) {
    const gap = i - lastBoundary;

    if (gap >= minLines && i > 0 && lines[i - 1].trim() === '') {
      offsets.push(countBytes(lines.slice(0, i)));
      lastBoundary = i;
      continue;
    }

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
  return len === 0 ? 0 : len - 1;
}

export function buildEditPredictionPrompt(
  req: EditPredictionRequest
): string {
  const { document, cursorPosition, editHistory, relatedFiles } = req;
  const cursorLine = cursorPosition.line;
  const docLineCount = document.lineCount;
  const fullText = document.getText();

  const editableStartLine = Math.max(0, cursorLine - EDITABLE_LINES_BEFORE);
  const editableEndLine = Math.min(docLineCount - 1, cursorLine + EDITABLE_LINES_AFTER);

  const editableStartOffset = document.offsetAt(new vscode.Position(editableStartLine, 0));
  const editableEndLineLen = document.lineAt(editableEndLine).text.length;
  const editableEndOffset = document.offsetAt(new vscode.Position(editableEndLine, editableEndLineLen));

  const prefixText = fullText.slice(0, editableStartOffset);
  const editableText = fullText.slice(editableStartOffset, editableEndOffset);
  const suffixText = fullText.slice(editableEndOffset);

  const cursorOffset = document.offsetAt(cursorPosition);
  const cursorInEditable = cursorOffset - editableStartOffset;

  const blockOffsets = splitIntoBlocks(editableText, MIN_BLOCK_LINES, MAX_BLOCK_LINES);

  const parts: string[] = [];

  parts.push(`${FIM_SUFFIX}\n${suffixText}`);
  parts.push(`${FIM_PREFIX}`);

  if (relatedFiles) {
    parts.push(relatedFiles);
  }

  if (editHistory) {
    parts.push(`${FILE_MARKER}edit_history\n${editHistory}`);
  }

  parts.push(`${FILE_MARKER}${document.uri.fsPath}`);
  parts.push(prefixText);

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

export function parseEditPredictionResponse(
  response: string,
  _maxRegions: number = 5
): ParsedEditResponse {
  let text = response.trimEnd();
  if (text.endsWith(V0318_END_MARKER)) {
    text = text.slice(0, -V0318_END_MARKER.length).trimEnd();
  }

  const regions: ParsedEditRegion[] = [];

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

  if (firstMarker.num === lastMarker.num) {
    return { regions: [], full: response };
  }

  // extract content between first and last marker, strip any intermediate markers
  let replacement = text.slice(firstMarker.end, lastMarker.start);
  replacement = replacement.replace(/<\|marker_\d+\|>/g, '');
  replacement = replacement.replace(CURSOR_MARKER, '');
  replacement = replacement.trim();

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

export function sanitizeCompletion(text: string): string {
  let result = text;

  // If the model echoed back FIM control tokens (prompt regurgitation),
  // strip everything up to and including <|fim_middle|> — the real
  // generated content starts after that token.
  const middleIdx = result.lastIndexOf(FIM_MIDDLE);
  if (middleIdx >= 0) {
    result = result.slice(middleIdx + FIM_MIDDLE.length);
  }

  // Strip all control / special tokens that may leak into output
  result = result
    .replace(/<\|marker_\d+\|>/g, '')
    .replace(/<\|user_cursor\|>/g, '')
    .replace(/<\[end▁of▁sentence\]>/g, '')
    .replace(/<filename>/g, '')
    .replace(/<\[fim-suffix\]>/g, '')
    .replace(/<\[fim-prefix\]>/g, '')
    .replace(/<\[fim-middle\]>/g, '')
    .replace(/<\|fim_suffix\|>/g, '')
    .replace(/<\|fim_prefix\|>/g, '')
    .replace(/<\|fim_middle\|>/g, '')
    .replace(/<\|fim_pad\|>/g, '')
    .replace(/<\|file_separator\|>/g, '')
    .replace(/<\|endoftext\|>/g, '')
    .replace(/NO_EDITS\s*/g, '')
    .replace(/<<<<<<< CURRENT\s*/g, '')
    .replace(/=======\s*/g, '')
    .replace(/>>>>>>> UPDATED\s*/g, '')
    .trim();

  return result;
}
