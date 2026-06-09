export interface FimRequest {
  prefix: string;
  suffix: string;
  language?: string;
  filePath?: string;
  lspContext?: string;
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

export function buildEditPredictionPrompt(params: {
  suffix: string;
  prefix: string;
  cursorLine: string;
  editHistory: string;
  relatedFiles: string;
  filePath?: string;
}): string {
  const { suffix, prefix, cursorLine, editHistory, relatedFiles, filePath } = params;

  const parts: string[] = [];

  parts.push(`<[fim-suffix]>\n${suffix.trimEnd()}`);
  parts.push(`<[fim-prefix]>`);

  if (relatedFiles) {
    parts.push(relatedFiles);
  }

  if (editHistory) {
    parts.push(`<filename>edit_history\n${editHistory}`);
  }

  if (filePath) {
    parts.push(`<filename>${filePath}`);
  }

  parts.push(`${prefix.trimStart()}`);
  parts.push(`<|marker_1|>\n${cursorLine}\n<|marker_2|>`);
  parts.push(FIM_MIDDLE);

  return parts.join('\n');
}

export function parseEditPredictionResponse(
  response: string
): { marker1?: string; marker2?: string; full?: string } {
  const m1Match = response.match(/<\|marker_1\|>([\s\S]*?)(?:<\|marker_2\|>|$)/);
  const m2Match = response.match(/<\|marker_2\|>([\s\S]*?)$/);

  return {
    marker1: m1Match?.[1]?.trim(),
    marker2: m2Match?.[1]?.trim(),
    full: response,
  };
}
