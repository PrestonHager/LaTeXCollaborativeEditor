import { ENGINE_LABELS, engineFromProgram, enginePackageMessage, readMagicComments, resolveEngine, type TexEngine } from '../project/texEngine';
import type { ProjectDiagnostic, SourceLine } from './projectSource';

// \usepackage[opts]{a,b} and \RequirePackage{c}, with the names in group 1.
const PACKAGE_PATTERN = /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;

/** A line with its `%` comment cut off. `\%` is a percent sign, not a comment. */
function stripComment(line: string): string {
  const match = /(^|[^\\])(\\\\)*%/.exec(line);
  return match ? line.slice(0, match.index + match[0].length - 1) : line;
}

/**
 * Notes that depend on the project's engine (issue #199): a package that won't load under it,
 * like fontspec under pdfLaTeX, and a `% !TEX program` comment naming a program we don't know.
 * `source` is the expanded project, so packages loaded from an \input file are found too, and
 * `lineMap` points each one back to its own file and line.
 */
export function engineDiagnostics(
  mainPath: string,
  mainText: string | undefined,
  setting: TexEngine | undefined,
  source: string,
  lineMap: SourceLine[],
): ProjectDiagnostic[] {
  const diagnostics: ProjectDiagnostic[] = [];
  const program = mainText === undefined ? undefined : readMagicComments(mainText).program;
  const { engine } = resolveEngine(setting, mainText);
  if (program && !engineFromProgram(program.value)) {
    diagnostics.push({
      path: mainPath,
      line: program.line,
      severity: 'warning',
      message: `"${program.value.slice(0, 60)}" isn't a TeX program the editor knows, so it uses ${ENGINE_LABELS[engine]}. Use pdflatex, xelatex or lualatex.`,
    });
  }
  const seen = new Set<string>();
  source.split('\n').forEach((raw, index) => {
    const line = stripComment(raw);
    if (!line.includes('ackage')) return;
    for (const match of line.matchAll(PACKAGE_PATTERN)) {
      for (const name of match[1].split(',').map((part) => part.trim())) {
        if (!name || seen.has(name)) continue;
        const message = enginePackageMessage(name, engine);
        if (!message) continue;
        seen.add(name);
        const origin = lineMap[index] ?? { path: mainPath, line: 1 };
        diagnostics.push({ path: origin.path, line: origin.line, severity: 'warning', message });
      }
    }
  });
  return diagnostics;
}
