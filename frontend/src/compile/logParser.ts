import type { EditorDiagnostic } from '../ui/diagnostics';

const LINE_REF = /l\.(\d+)/;
const INPUT_LINE_REF = /on input line (\d+)/i;
const WARNING_LINE_REF = /LaTeX Warning:\s*(.+?)\s+on input line (\d+)\.?$/i;
const BOX_LINE_REF = /(Overfull|Underfull)\s+\\hbox.+?at lines (\d+)(?:--\d+)?/i;

export function parseLatexLog(log: string): EditorDiagnostic[] {
  const diagnostics: EditorDiagnostic[] = [];
  const lines = log.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    const warningMatch = line.match(WARNING_LINE_REF);
    if (warningMatch) {
      diagnostics.push({
        line: Number(warningMatch[2]),
        severity: 'warning',
        message: warningMatch[1].trim(),
        raw: line,
      });
      continue;
    }

    const boxMatch = line.match(BOX_LINE_REF);
    if (boxMatch) {
      diagnostics.push({
        line: Number(boxMatch[2]),
        severity: 'info',
        message: line.trim(),
        raw: line,
      });
      continue;
    }

    if (line.startsWith('! ')) {
      const lineNumber = findLineReference(lines, index);
      diagnostics.push({
        line: lineNumber ?? 1,
        severity: 'error',
        message: line.slice(2).trim(),
        raw: line,
      });
      continue;
    }

    if (line.includes('LaTeX Error:')) {
      const message = line.slice(line.indexOf('LaTeX Error:') + 'LaTeX Error:'.length).trim();
      const directRef = line.match(INPUT_LINE_REF);
      const lineNumber = directRef ? Number(directRef[1]) : findLineReference(lines, index);
      diagnostics.push({
        line: lineNumber ?? 1,
        severity: 'error',
        message,
        raw: line,
      });
    }
  }

  return diagnostics;
}

function findLineReference(lines: string[], fromIndex: number): number | null {
  for (let cursor = fromIndex; cursor < Math.min(lines.length, fromIndex + 6); cursor += 1) {
    const match = lines[cursor].match(LINE_REF);
    if (match) {
      return Number(match[1]);
    }
  }
  return null;
}
