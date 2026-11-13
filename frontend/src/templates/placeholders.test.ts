import { emptyProfile, isEmptyProfile, sanitizeProfile } from '../state/profile';
import { guessLanguage, guessPaper } from './profileOptions';
import {
  escapeLatex,
  fillPlaceholders,
  formatValue,
  initialValues,
  parseManifest,
  placeholderDefs,
  placeholdersIn,
  profileToPlaceholders,
  serializeManifest,
  STANDARD_PLACEHOLDERS,
  usedPlaceholders,
} from './placeholders';

const defs = placeholderDefs({ placeholders: [{ key: 'course', label: 'Course', default: 'MATH 101' }] });

describe('escapeLatex', () => {
  it('escapes every LaTeX special character so it prints as typed', () => {
    expect(escapeLatex('R&D 50% $5 #1 a_b {x} ~ ^ \\')).toBe(
      'R\\&D 50\\% \\$5 \\#1 a\\_b \\{x\\} \\textasciitilde{} \\textasciicircum{} \\textbackslash{}',
    );
  });

  it('leaves ordinary text and Unicode alone', () => {
    expect(escapeLatex('Zoë Müller-Lüdenscheidt, Ph.D.')).toBe('Zoë Müller-Lüdenscheidt, Ph.D.');
  });

  it('does not escape its own output twice', () => {
    // A backslash becomes \textbackslash{}, and those braces must not be escaped again.
    expect(escapeLatex('\\')).toBe('\\textbackslash{}');
    expect(escapeLatex('{\\}')).toBe('\\{\\textbackslash{}\\}');
  });
});

describe('fillPlaceholders', () => {
  it('replaces profile and template placeholders, escaping the values', () => {
    const text = '\\author{{{name}}}\\date{{{ date }}} {{course}} \\texttt{{{email}}}';
    const out = fillPlaceholders(text, defs, { name: 'Ann & Bob', date: '1 May', course: 'C#_1', email: 'a_b@x.org' });
    expect(out).toBe('\\author{Ann \\& Bob}\\date{1 May} C\\#\\_1 \\texttt{a\\_b@x.org}');
  });

  it('escapes every special character in a value, so a hostile value cannot inject LaTeX', () => {
    const out = fillPlaceholders('\\title{{{name}}}', defs, { name: '}\\input{/etc/passwd}{ % $x$ ^ ~ #' });
    expect(out).toBe('\\title{\\}\\textbackslash{}input\\{/etc/passwd\\}\\{ \\% \\$x\\$ \\textasciicircum{} \\textasciitilde{} \\#}');
    expect(out).not.toContain('\\input{');
  });

  it('leaves unknown names and real LaTeX alone', () => {
    const text = '\\frac{{a}}{b} {{\\bf x}} {{unknown}} {{\\relax name}} {{ }}';
    expect(fillPlaceholders(text, defs, { name: 'Ann' })).toBe(text);
  });

  it('stays fast on long text that almost looks like placeholders', () => {
    const started = performance.now();
    fillPlaceholders(`{{${' '.repeat(100_000)}`, defs, {});
    fillPlaceholders(`{{name${' '.repeat(100_000)}}`, defs, {});
    fillPlaceholders('{{a'.repeat(50_000), defs, {});
    placeholdersIn(`{{${'a'.repeat(100_000)} }`);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('fills a missing value with nothing', () => {
    expect(fillPlaceholders('[{{orcid}}]', defs, {})).toBe('[]');
  });

  it('does not fill placeholders that appear in values', () => {
    expect(fillPlaceholders('{{name}}', defs, { name: '{{email}}' })).toBe('\\{\\{email\\}\\}');
  });

  it('joins multiline values with \\\\ and escapes each line', () => {
    expect(fillPlaceholders('{{address}}', defs, { address: '1 Main St\r\n\n  Apt #4 \nSpringfield' })).toBe('1 Main St \\\\ Apt \\#4 \\\\ Springfield');
  });

  it('joins lines of a one-line field with spaces', () => {
    expect(formatValue({}, 'a\nb')).toBe('a b');
  });

  it('only lets listed values into a choice, since they go in unescaped', () => {
    const language = STANDARD_PLACEHOLDERS.find((def) => def.key === 'language')!;
    expect(formatValue(language, 'ngerman')).toBe('ngerman');
    expect(formatValue(language, 'english]{x}\\input{y')).toBe('english');
  });

  it('puts raw values in as they are', () => {
    expect(formatValue({ raw: true }, '\\today')).toBe('\\today');
  });
});

describe('placeholders in a template', () => {
  it('lists the names used, in order, once each', () => {
    expect(placeholdersIn('{{b}} {{a}} {{ b }}')).toEqual(['b', 'a']);
  });

  it('only counts names it can fill', () => {
    const used = usedPlaceholders(['{{course}} {{name}} {{nope}}', '{{name}} {{date}}'], defs);
    expect(used.map((def) => def.key)).toEqual(['course', 'name', 'date']);
  });

  it('lets a template relabel a standard placeholder without losing its profile link', () => {
    const relabeled = placeholderDefs({ placeholders: [{ key: 'name', label: 'Author' }] });
    expect(relabeled.find((def) => def.key === 'name')).toMatchObject({ label: 'Author', profile: 'name' });
  });

  it('starts with profile values, then template defaults, then guesses', () => {
    const profile = { ...emptyProfile(), name: 'Ann', language: 'french' };
    const values = initialValues(defs, profile, 'en-US', new Date(2026, 0, 2));
    expect(values).toMatchObject({ name: 'Ann', course: 'MATH 101', language: 'french', paper: 'letterpaper', email: '' });
    expect(values.date).toBe('January 2, 2026');
    expect(initialValues(defs, emptyProfile(), 'de-DE').language).toBe('ngerman');
    expect(initialValues(defs, emptyProfile(), 'de-DE').paper).toBe('a4paper');
  });

  it('turns profile values back into placeholders for Save as Template', () => {
    const profile = { ...emptyProfile(), name: 'Ann Lee', email: 'ann_lee@x.org', affiliation: 'A&B', orcid: 'ab' };
    const { text, count } = profileToPlaceholders('\\author{Ann Lee}\\texttt{ann\\_lee@x.org} A\\&B ab', profile);
    expect(text).toBe('\\author{{{name}}}\\texttt{{{email}}} {{affiliation}} ab');
    expect(count).toBe(3);
  });
});

describe('template.json', () => {
  it('round-trips a manifest', () => {
    const text = serializeManifest({ name: 'Lab report', description: 'For labs', mainFile: 'main.tex', placeholders: [{ key: 'course', label: 'Course', default: 'X', multiline: true }] });
    expect(parseManifest(text)).toEqual({
      format: 'latex-editor-template',
      version: 1,
      name: 'Lab report',
      description: 'For labs',
      mainFile: 'main.tex',
      placeholders: [{ key: 'course', label: 'Course', default: 'X', multiline: true }],
    });
  });

  it('never writes the profile link of a placeholder', () => {
    expect(serializeManifest({ name: 'x', description: '', placeholders: [{ key: 'name', label: 'Name', profile: 'name' }] })).not.toContain('"profile"');
  });

  it('drops malformed placeholders and caps lengths', () => {
    const manifest = parseManifest(
      JSON.stringify({
        name: 'x'.repeat(500),
        placeholders: [{ key: '1bad' }, { key: 'ok', label: 7, default: 'd', options: ['a', { value: 'b', label: 'B' }, { nope: 1 }], raw: true }, 'junk', null],
      }),
    )!;
    expect(manifest.name).toHaveLength(200);
    expect(manifest.placeholders).toEqual([{ key: 'ok', label: 'ok', default: 'd', raw: true, options: [{ value: 'a', label: 'a' }, { value: 'b', label: 'B' }] }]);
  });

  it('rejects something that is not a template.json', () => {
    expect(parseManifest('not json')).toBeNull();
    expect(parseManifest('[]')).toBeNull();
    expect(parseManifest(JSON.stringify({ format: 'latex-editor-settings' }))).toBeNull();
    expect(parseManifest('{}', 'Fallback')).toMatchObject({ name: 'Fallback', description: '', placeholders: [] });
  });
});

describe('profile', () => {
  it('keeps only known string fields, trimmed and capped', () => {
    expect(sanitizeProfile({ name: '  Ann ', email: 5, extra: 'x', address: 'a\r\nb', orcid: 'x'.repeat(100) })).toEqual({
      ...emptyProfile(),
      name: 'Ann',
      address: 'a\nb',
      orcid: 'x'.repeat(40),
    });
    expect(sanitizeProfile('Ann')).toBeUndefined();
    expect(sanitizeProfile([])).toBeUndefined();
  });

  it('drops a language or paper size that could not be one', () => {
    expect(sanitizeProfile({ language: 'english]{x}', paper: 'b5paper' })).toMatchObject({ language: '', paper: '' });
    expect(sanitizeProfile({ language: 'ngerman', paper: 'a4paper' })).toMatchObject({ language: 'ngerman', paper: 'a4paper' });
  });

  it('knows when nothing is filled in', () => {
    expect(isEmptyProfile(emptyProfile())).toBe(true);
    expect(isEmptyProfile({ ...emptyProfile(), paper: 'a4paper' })).toBe(false);
  });

  it('guesses a babel language and paper size from the locale', () => {
    expect(guessLanguage('en-GB')).toBe('british');
    expect(guessLanguage('en')).toBe('english');
    expect(guessLanguage('pt-BR')).toBe('brazilian');
    expect(guessLanguage('pt-PT')).toBe('portuguese');
    expect(guessLanguage('nb-NO')).toBe('norsk');
    expect(guessLanguage('ja-JP')).toBe('english');
    expect(guessLanguage(undefined)).toBe('english');
    expect(guessPaper('en-US')).toBe('letterpaper');
    expect(guessPaper('es-MX')).toBe('letterpaper');
    expect(guessPaper('en-GB')).toBe('a4paper');
    expect(guessPaper(undefined)).toBe('a4paper');
  });
});
