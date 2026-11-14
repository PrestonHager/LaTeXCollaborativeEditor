import {
  CORPUS_INFO,
  REPORT_END,
  REPORT_START,
  classify,
  corpusDocuments,
  corpusFolders,
  extractReport,
  formatReport,
  groupByFolder,
  replaceReport,
  runCorpus,
  runDocument,
  shortMessage,
  type CorpusResult,
} from './compatCorpus';

// The app has no Node types, so the file system comes in untyped, as in style.test.ts.
type Fs = {
  readFileSync(path: string, encoding: 'utf8'): string;
  writeFileSync(path: string, text: string): void;
  readdirSync(path: string, options: { recursive: true }): string[];
};
const fs = async () => (await import('node:fs' as string)) as Fs;

// Tests run in frontend/, so the docs are one level up.
const BASELINE_PATH = '../docs/compatibility-baseline.md';
const UPDATE = Boolean((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.UPDATE_CORPUS_BASELINE);

describe('compatCorpus helpers', () => {
  it('fails when there is no HTML or an error, warns on warnings or missing files, and passes otherwise', () => {
    const info = { path: 'main.tex', line: 1, severity: 'info' as const, message: 'note' };
    expect(classify({ html: null, errors: [], missing: [] })).toBe('fail');
    expect(classify({ html: '<p></p>', errors: [{ ...info, severity: 'error' }], missing: [] })).toBe('fail');
    expect(classify({ html: '<p></p>', errors: [{ ...info, severity: 'warning' }], missing: [] })).toBe('warning');
    expect(classify({ html: '<p></p>', errors: [], missing: ['chapters/gone'] })).toBe('warning');
    expect(classify({ html: '<p></p>', errors: [info], missing: [] })).toBe('pass');
  });

  it('flattens messages to one line and cuts long ones', () => {
    expect(shortMessage('  two\n  lines ')).toBe('two lines');
    const long = shortMessage('x'.repeat(500));
    expect(long).toHaveLength(160);
    expect(long.endsWith('…')).toBe(true);
  });

  it('groups files by their top folder', () => {
    const folders = groupByFolder({ 'r/a/main.tex': 'A', 'r/a/sub/x.tex': 'X', 'r/b/main.tex': 'B' }, 'r/');
    expect([...folders.keys()]).toEqual(['a', 'b']);
    expect(folders.get('a')).toEqual(new Map([['main.tex', 'A'], ['sub/x.tex', 'X']]));
  });

  it('gives a document with no folder no files', () => {
    const docs = corpusDocuments(new Map());
    expect(docs.map((doc) => doc.texts.size)).toEqual(CORPUS_INFO.map(() => 0));
  });

  it('counts a compiler that throws as a failure', () => {
    const doc = { id: 'x', title: 'X', compiler: 'pdfLaTeX', mainPath: 'main.tex', texts: new Map([['main.tex', '']]) };
    const result = runDocument(doc, () => {
      throw new Error('boom');
    });
    expect(result.status).toBe('fail');
    expect(result.diagnostics).toEqual([{ path: 'main.tex', line: 1, severity: 'error', message: 'Error: boom' }]);
  });

  it('fails a document whose main file is missing, without compiling it', () => {
    const doc = { id: 'x', title: 'X', compiler: 'pdfLaTeX', mainPath: 'main.tex', texts: new Map([['other.tex', '']]) };
    const compile = vi.fn();
    const result = runDocument(doc, compile);
    expect(compile).not.toHaveBeenCalled();
    expect(result.status).toBe('fail');
    expect(result.diagnostics[0].message).toBe('The main file is missing.');
  });

  it('formats a summary, each diagnostic, missing files and changes, and escapes pipes', () => {
    const results: CorpusResult[] = [
      { id: 'ok', title: 'OK', compiler: 'pdfLaTeX', status: 'pass', diagnostics: [], missing: [], changes: [] },
      {
        id: 'bad',
        title: 'Bad',
        compiler: 'XeLaTeX',
        status: 'warning',
        diagnostics: [{ path: 'main.tex', line: 3, severity: 'warning', message: 'a | b' }],
        missing: ['gone'],
        changes: ['Removed \\foo.'],
      },
    ];
    const report = formatReport(results);
    expect(report).toContain('**1 pass, 1 warning, 0 fail** out of 2 documents.');
    expect(report).toContain('| `bad` Bad | XeLaTeX | Warning | 0 | 1 | 0 | 1 |');
    expect(report).toContain('### `ok`: Pass\n\nNo diagnostics.');
    expect(report).toContain('| warning | `main.tex:3` | a \\| b |');
    expect(report).toContain("| missing | `gone` | The file isn't in the project. |");
    expect(report).toContain('- Removed \\foo.');
  });

  it('swaps the report between its markers, and reads it back', () => {
    const doc = `intro\n${REPORT_START}\nold\n${REPORT_END}\noutro`;
    const updated = replaceReport(doc, 'new');
    expect(updated).toBe(`intro\n${REPORT_START}\nnew\n${REPORT_END}\noutro`);
    expect(extractReport(updated)).toBe('new');
    expect(extractReport('no markers')).toBeNull();
    expect(() => replaceReport('no markers', 'new')).toThrow(/markers/);
  });
});

describe('Overleaf-style corpus (issue #197)', () => {
  it('has a CORPUS_INFO entry with a main.tex for every folder in dev/corpus, and no others', () => {
    const folders = corpusFolders();
    expect([...folders.keys()].sort()).toEqual(CORPUS_INFO.map((info) => info.id).sort());
    for (const doc of corpusDocuments(folders)) expect(doc.texts.has('main.tex')).toBe(true);
  });

  it('is not imported by any production module', async () => {
    const { readdirSync, readFileSync } = await fs();
    const sources = readdirSync('src', { recursive: true }).filter((path) => /\.ts$/.test(path) && !/\.test\.ts$/.test(path));
    const importers = sources.filter((path) => /compatCorpus|dev\/corpus/.test(readFileSync(`src/${path}`, 'utf8')));
    expect(importers.map((path) => path.replace(/\\/g, '/'))).toEqual(['dev/compatCorpus.ts']);
  });

  // The baseline lives in docs/ so engine work can be measured against it. When a change moves a
  // result, rerun with `npm run corpus:update` and commit the new baseline with the change.
  it('matches the baseline in docs/compatibility-baseline.md', async () => {
    const { readFileSync, writeFileSync } = await fs();
    const report = formatReport(runCorpus());
    const doc = readFileSync(BASELINE_PATH, 'utf8');
    if (UPDATE) writeFileSync(BASELINE_PATH, replaceReport(doc, report));
    else expect(extractReport(doc), 'The corpus results changed. Run `npm run corpus:update` in frontend/ and commit docs/compatibility-baseline.md.').toBe(report);
  });
});
