import { projectToPreviewHtml, type ProjectPreviewInput, type ProjectPreviewResult } from '../compile/latexJsPreview';

// NOTE: only compatCorpus.test.ts imports this, so production never ships the corpus (issue #197).
const ROOT = '../../dev/corpus/';

// Pull the corpus in as text. It has no images, so every file is a string.
const files = import.meta.glob<string>('../../dev/corpus/*/**/*.{tex,bib,cls,sty}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** One document in dev/corpus: its folder, what it is and which compiler Overleaf uses for it. */
export type CorpusDocument = { id: string; title: string; compiler: string; mainPath: string; texts: Map<string, string> };

/** What each folder in dev/corpus holds. The tests check every folder has an entry. */
export const CORPUS_INFO: ReadonlyArray<Omit<CorpusDocument, 'texts' | 'mainPath'>> = [
  { id: 'article', title: 'Article', compiler: 'pdfLaTeX' },
  { id: 'beamer', title: 'Beamer deck', compiler: 'pdfLaTeX' },
  { id: 'tikz', title: 'TikZ figure', compiler: 'pdfLaTeX' },
  { id: 'biblatex', title: 'biblatex document', compiler: 'pdfLaTeX + Biber' },
  { id: 'custom-class', title: 'Custom .cls', compiler: 'pdfLaTeX' },
  { id: 'xelatex', title: 'XeLaTeX with fontspec', compiler: 'XeLaTeX' },
  { id: 'thesis', title: 'Multi-file thesis', compiler: 'pdfLaTeX' },
];

/** Group raw file contents (keyed by path under dev/corpus/) into one text map per top folder. */
export function groupByFolder(raw: Record<string, string>, root = ROOT): Map<string, Map<string, string>> {
  const folders = new Map<string, Map<string, string>>();
  for (const [fullPath, text] of Object.entries(raw)) {
    const path = fullPath.slice(root.length);
    const slash = path.indexOf('/');
    const folder = path.slice(0, slash);
    if (!folders.has(folder)) folders.set(folder, new Map());
    folders.get(folder)!.set(path.slice(slash + 1), text);
  }
  return folders;
}

/** The corpus folders found on disk, by folder name. */
export function corpusFolders(): Map<string, Map<string, string>> {
  return groupByFolder(files);
}

/** Every corpus document, in CORPUS_INFO order, with main.tex as its main file. */
export function corpusDocuments(folders = corpusFolders()): CorpusDocument[] {
  return CORPUS_INFO.map((info) => ({ ...info, mainPath: 'main.tex', texts: folders.get(info.id) ?? new Map<string, string>() }));
}

export type CorpusStatus = 'pass' | 'warning' | 'fail';

export type CorpusDiagnostic = { path: string; line: number; severity: 'error' | 'warning' | 'info'; message: string };

export type CorpusResult = {
  id: string;
  title: string;
  compiler: string;
  status: CorpusStatus;
  diagnostics: CorpusDiagnostic[];
  missing: string[];
  changes: string[];
};

/**
 * Fail: the preview shows nothing. Warning: it shows the document, but something is missing
 * (a warning diagnostic or a file it couldn't find). Pass: it shows it, with info notes at most.
 */
export function classify(result: Pick<ProjectPreviewResult, 'html' | 'errors' | 'missing'>): CorpusStatus {
  if (result.html === null || result.errors.some((error) => error.severity === 'error')) return 'fail';
  if (result.missing.length > 0 || result.errors.some((error) => error.severity === 'warning')) return 'warning';
  return 'pass';
}

// LaTeX.js parse errors list every token it expected, which can run to thousands of characters.
const MAX_MESSAGE = 160;

/** One line of plain text, cut to a readable length, so the report stays a table people can read. */
export function shortMessage(message: string): string {
  const flat = message.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_MESSAGE ? `${flat.slice(0, MAX_MESSAGE - 1)}…` : flat;
}

type Compile = (input: ProjectPreviewInput) => ProjectPreviewResult;

/** Run one document through the preview pipeline, the same call the compile worker makes. */
export function runDocument(doc: CorpusDocument, compile: Compile = projectToPreviewHtml): CorpusResult {
  const failed = (message: string): ProjectPreviewResult => ({
    html: null,
    errors: [{ path: doc.mainPath, line: 1, severity: 'error', message }],
    missing: [],
    changes: [],
  });
  // An empty project typesets to an empty page, which would read as a pass.
  if (!doc.texts.has(doc.mainPath)) return summarize(doc, failed('The main file is missing.'));
  try {
    return summarize(doc, compile({ mainPath: doc.mainPath, texts: doc.texts, binaryPaths: [], imageUrls: new Map() }));
  } catch (error) {
    // The worker answers a throw with an error too, so count it as a failure, not a crash.
    return summarize(doc, failed(String(error)));
  }
}

function summarize(doc: CorpusDocument, result: ProjectPreviewResult): CorpusResult {
  return {
    id: doc.id,
    title: doc.title,
    compiler: doc.compiler,
    status: classify(result),
    diagnostics: result.errors.map(({ path, line, severity, message }) => ({ path, line, severity, message: shortMessage(message) })),
    missing: [...result.missing],
    changes: result.changes.map(shortMessage),
  };
}

/** Run the whole corpus. */
export function runCorpus(docs = corpusDocuments(), compile?: Compile): CorpusResult[] {
  return docs.map((doc) => runDocument(doc, compile));
}

const STATUS_LABEL: Record<CorpusStatus, string> = { pass: 'Pass', warning: 'Warning', fail: 'Fail' };

const count = (result: CorpusResult, severity: CorpusDiagnostic['severity']) =>
  result.diagnostics.filter((diagnostic) => diagnostic.severity === severity).length;

// Pipes would split a Markdown table cell.
const cell = (text: string) => text.replace(/\|/g, '\\|');

/** The report as Markdown: a summary table, then each document's diagnostics. */
export function formatReport(results: CorpusResult[]): string {
  const totals = (status: CorpusStatus) => results.filter((result) => result.status === status).length;
  const lines = [
    `**${totals('pass')} pass, ${totals('warning')} warning, ${totals('fail')} fail** out of ${results.length} documents.`,
    '',
    '| Document | Overleaf compiler | Result | Errors | Warnings | Info | Missing files |',
    '|----------|-------------------|--------|--------|----------|------|---------------|',
    ...results.map(
      (result) =>
        `| \`${result.id}\` ${result.title} | ${result.compiler} | ${STATUS_LABEL[result.status]} | ` +
        `${count(result, 'error')} | ${count(result, 'warning')} | ${count(result, 'info')} | ${result.missing.length} |`,
    ),
  ];
  for (const result of results) {
    lines.push('', `### \`${result.id}\`: ${STATUS_LABEL[result.status]}`, '');
    if (result.diagnostics.length === 0 && result.missing.length === 0) lines.push('No diagnostics.');
    else {
      lines.push('| Severity | Where | Message |', '|----------|-------|---------|');
      for (const d of result.diagnostics) lines.push(`| ${d.severity} | \`${d.path}:${d.line}\` | ${cell(d.message)} |`);
      for (const name of result.missing) lines.push(`| missing | \`${name}\` | The file isn't in the project. |`);
    }
    if (result.changes.length > 0) {
      lines.push('', 'What the preview changed:', '');
      for (const change of result.changes) lines.push(`- ${change}`);
    }
  }
  return lines.join('\n');
}

export const REPORT_START = '<!-- corpus-report:start -->';
export const REPORT_END = '<!-- corpus-report:end -->';

/** Put `report` between the report markers in `doc`. Throws if the markers are missing. */
export function replaceReport(doc: string, report: string): string {
  const start = doc.indexOf(REPORT_START);
  const end = doc.indexOf(REPORT_END);
  if (start < 0 || end < start) throw new Error(`The baseline needs ${REPORT_START} and ${REPORT_END} markers.`);
  return `${doc.slice(0, start + REPORT_START.length)}\n${report}\n${doc.slice(end)}`;
}

/** The report between the markers in `doc`, or null if it has none. */
export function extractReport(doc: string): string | null {
  const start = doc.indexOf(REPORT_START);
  const end = doc.indexOf(REPORT_END);
  if (start < 0 || end < start) return null;
  return doc.slice(start + REPORT_START.length, end).trim();
}
