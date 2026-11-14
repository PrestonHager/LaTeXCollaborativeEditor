import type { ProjectDiagnostic } from '../projectSource';

/**
 * Turn a TeX log into diagnostics in the editor's lint format (issue #242), each on a project
 * file and line. TeX logs say which file they're in with `(./chapters/intro.tex` when a file is
 * opened and `)` when it's closed, so the parser keeps a stack of open files.
 *
 * It reads:
 * - `! Message` errors, with the line from the `l.12 ...` that follows;
 * - `./file.tex:12: Message` errors, in -file-line-error style;
 * - `LaTeX Warning:` and `Package x Warning:` notes, with `on input line 12`;
 * - Overfull and Underfull boxes, as info, with `at lines 10--12` or `at line 10`;
 * - `! LaTeX Error: File 'x.sty' not found`, with a note that the engine build lacks it.
 * Anything it can't place goes on the main file's line 1.
 */

export type TexLogContext = {
  mainPath: string;
  /** Every path in the project, so files from the TeX distribution aren't taken for project files. */
  projectPaths: ReadonlySet<string>;
};

/** Most diagnostics kept from one log, so a runaway document doesn't flood the editor. */
export const MAX_LOG_DIAGNOSTICS = 200;
const MAX_MESSAGE = 300;

/** A project path from a path in the log, or null when it isn't one of ours. */
export function projectPathFromLog(raw: string, projectPaths: ReadonlySet<string>): string | null {
  const path = raw.replace(/^"|"$/g, '').replace(/^(\.\/)+/, '');
  if (projectPaths.has(path)) return path;
  // `\input{chapter}` opens chapter.tex.
  if (projectPaths.has(`${path}.tex`)) return `${path}.tex`;
  return null;
}

// TeX wraps log lines at 79 characters, which splits long paths and messages. Join them back
// when a line is exactly that long, the way latexmk and Overleaf's parser do.
const WRAP_WIDTH = 79;
function unwrap(log: string): string[] {
  const out: string[] = [];
  let carry = '';
  for (const line of log.replace(/\r\n?/g, '\n').split('\n')) {
    const joined = carry + line;
    if (line.length === WRAP_WIDTH) carry = joined;
    else {
      out.push(joined);
      carry = '';
    }
  }
  if (carry) out.push(carry);
  return out;
}

const FILE_LINE_ERROR = /^(?:\.\/)?([^:\s()][^:()]*\.(?:tex|sty|cls|bib|bbl|ltx|def)):(\d+):\s*(.*)$/;
const INPUT_LINE = /on input line (\d+)/;
const BOX_LINES = /at lines? (\d+)(?:--\d+)?/;
const WARNING = /^(?:LaTeX|Package [\w.@-]+|Class [\w.@-]+|LaTeX Font) Warning:\s*(.*)$/;
const BOX = /^(Overfull|Underfull) \\[hv]box/;
const MISSING_FILE = /^! LaTeX Error: File `([^']+)' not found/;

/** Track `(file` and `)` on one line, updating the stack of open files. */
function trackFiles(line: string, stack: string[]) {
  // A path starts after "(" and runs to a space, ")" or "(" (TeX doesn't quote most paths).
  const pattern = /\(("[^"]+"|[^\s()]+)|\)/g;
  for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
    if (match[0] === ')') stack.pop();
    else stack.push(match[1]);
  }
}

export function parseTexLog(log: string, { mainPath, projectPaths }: TexLogContext): ProjectDiagnostic[] {
  const lines = unwrap(log);
  const stack: string[] = [];
  const out: ProjectDiagnostic[] = [];
  const seen = new Set<string>();

  /** The innermost open project file, or the main file. */
  const currentFile = () => {
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      const path = projectPathFromLog(stack[i], projectPaths);
      if (path) return path;
    }
    return mainPath;
  };

  const add = (diagnostic: ProjectDiagnostic) => {
    const message = diagnostic.message.replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE);
    const key = `${diagnostic.path}:${diagnostic.line}:${diagnostic.severity}:${message}`;
    if (seen.has(key) || out.length >= MAX_LOG_DIAGNOSTICS) return;
    seen.add(key);
    out.push({ ...diagnostic, line: Math.max(1, diagnostic.line), message });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const fileLine = FILE_LINE_ERROR.exec(line);
    if (fileLine) {
      const path = projectPathFromLog(fileLine[1], projectPaths);
      add({ path: path ?? mainPath, line: path ? Number(fileLine[2]) : 1, severity: 'error', message: fileLine[3] });
      continue;
    }

    if (line.startsWith('! ')) {
      const missing = MISSING_FILE.exec(line);
      let message = line.slice(2);
      if (missing) message = `${missing[1]} isn't in the project or in this site's TeX engine build. Add it to the project, or leave out the package.`;
      // The line number comes a few lines later, as "l.12 \foo".
      let at = 0;
      const context: string[] = [];
      for (let j = i + 1; j < Math.min(lines.length, i + 12); j += 1) {
        const where = /^l\.(\d+)\s?(.*)$/.exec(lines[j]);
        if (where) {
          at = Number(where[1]);
          if (!missing && where[2]) context.push(where[2].trim());
          break;
        }
        if (lines[j].startsWith('! ')) break;
      }
      add({ path: currentFile(), line: at || 1, severity: 'error', message: context.length ? `${message} (at ${context[0].slice(0, 60)})` : message });
      continue;
    }

    const warning = WARNING.exec(line);
    if (warning) {
      // Package warnings continue on lines starting with "(name)".
      let text = warning[1];
      for (let j = i + 1; j < lines.length && /^\([\w.@-]+\)\s/.test(lines[j]); j += 1) text += ` ${lines[j].replace(/^\([\w.@-]+\)\s+/, '')}`;
      const at = INPUT_LINE.exec(text);
      add({ path: currentFile(), line: at ? Number(at[1]) : 1, severity: 'warning', message: text.replace(/\s*on input line \d+\.?/, '') });
      continue;
    }

    if (BOX.test(line)) {
      const at = BOX_LINES.exec(line);
      add({ path: currentFile(), line: at ? Number(at[1]) : 1, severity: 'info', message: line.replace(/\s*(?:in paragraph|detected|has occurred while \\output is active).*$/, '') });
      continue;
    }

    trackFiles(line, stack);
  }
  return out;
}

/** Errors first, then warnings, then info, each in the order the log gave them. */
export function sortDiagnostics(diagnostics: ProjectDiagnostic[]): ProjectDiagnostic[] {
  const rank = { error: 0, warning: 1, info: 2 } as const;
  return diagnostics.map((d, i) => [d, i] as const).sort(([a, i], [b, j]) => rank[a.severity] - rank[b.severity] || i - j).map(([d]) => d);
}
