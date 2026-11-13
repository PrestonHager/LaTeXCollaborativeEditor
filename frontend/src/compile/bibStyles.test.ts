import { biblatexStyle, buildBibliography, initials, parseBib, parseName, purify, resolveStyle, sentenceCase, type BibEntry } from './bibStyles';

const style = (name: string) => resolveStyle(name)!;
const entry = (type: string, fields: Record<string, string>, key = 'k'): BibEntry => ({ key, type, fields });
const text = (name: string, e: BibEntry) => buildBibliography([e], style(name))[0].text;

describe('parseBib', () => {
  it('reads braced, quoted and bare fields, keeping inner braces', () => {
    expect(parseBib('@misc{k, title={A {B} C}, note="q {"} r", year=2020,\n month = jan}')).toEqual([
      { key: 'k', type: 'misc', fields: { title: 'A {B} C', note: 'q {"} r', year: '2020', month: 'jan' } },
    ]);
  });

  it('expands @string macros and # joins, and skips comments and preambles', () => {
    const bib = '@String{tug = "TeX Users"}\n@comment{x}\n@preamble{"y"}\n@BOOK(nope)\n@Book{b, publisher = tug # { Group}, title = {\\"{o} \\}}}\n@misc{bare}';
    expect(parseBib(bib)).toEqual([
      { key: 'b', type: 'book', fields: { publisher: 'TeX Users Group', title: '\\"{o} \\}' } },
      { key: 'bare', type: 'misc', fields: {} },
    ]);
  });

  it('copes with an unclosed entry', () => {
    expect(parseBib('@misc{k, title = {open')).toEqual([{ key: 'k', type: 'misc', fields: { title: 'open' } }]);
  });
});

describe('names', () => {
  it('reads the three BibTeX name forms', () => {
    expect(parseName('Donald E. Knuth')).toEqual({ first: 'Donald E.', von: '', last: 'Knuth', jr: '' });
    expect(parseName('Ludwig van Beethoven')).toEqual({ first: 'Ludwig', von: 'van', last: 'Beethoven', jr: '' });
    expect(parseName('van Beethoven, Ludwig')).toEqual({ first: 'Ludwig', von: 'van', last: 'Beethoven', jr: '' });
    expect(parseName('Ford, Jr., Henry')).toEqual({ first: 'Henry', von: '', last: 'Ford', jr: 'Jr.' });
    expect(parseName('{World Health Organization}')).toEqual({ first: '', von: '', last: '{World Health Organization}', jr: '' });
    expect(parseName('Jean {de la} Fontaine')).toEqual({ first: 'Jean {de la}', von: '', last: 'Fontaine', jr: '' });
  });

  it('turns first names into initials', () => {
    expect(initials('Donald Ervin')).toBe('D.~E.');
    expect(initials('Jean-Paul', ' ')).toBe('J.-P.');
    expect(initials("{\\'E}mile")).toBe("{\\'E}.");
    expect(initials("\\'Emile")).toBe("\\'E.");
  });

  it('lists names like plain.bst, with et al. for "and others"', () => {
    expect(text('plain', entry('misc', { author: 'A One and B Two and others' }))).toBe('A One, B Two et~al.');
    expect(text('apalike', entry('misc', { author: 'A One and B Two and C Three', year: '1' }))).toBe('One, A., Two, B., and Three, C. (1).');
  });
});

describe('text helpers', () => {
  it('lowercases titles but keeps braces, commands and the start after a colon', () => {
    expect(sentenceCase('The {TeX}book: A Guide to \\LaTeX')).toBe('The {TeX}book: A guide to \\LaTeX');
    expect(sentenceCase('\\"Uber Alles')).toBe('\\"Uber alles');
  });

  it('purifies text for sort keys and labels', () => {
    expect(purify('{\\"O}ber-Smith \\ss{} {\\TeX}!')).toBe('Ober Smith ss');
  });
});

describe('styles', () => {
  it('resolves known names case-insensitively and rejects unknown ones', () => {
    expect(resolveStyle('IEEEtran')?.layout).toBe('ieee');
    expect(resolveStyle('nature')).toBeNull();
    expect(biblatexStyle('style=ieee').name).toBe('ieeetr');
    expect(biblatexStyle('bibstyle=authoryear-comp').label).toBe('authoryear');
  });

  it('lays out the common entry types in plain', () => {
    expect(text('plain', entry('book', { editor: 'Ed Itor and Al Two', title: 'Collected', volume: '2', series: 'Lectures', publisher: 'P', edition: 'Second', year: '1990' }))).toBe(
      'Ed Itor and Al Two, editors. \\emph{Collected}, volume 2 of \\emph{Lectures}. P, second edition, 1990.',
    );
    expect(text('plain', entry('incollection', { author: 'A B', editor: 'E F', title: 'Chap', booktitle: 'Book', chapter: '3', pages: '5', publisher: 'P', year: '1' }))).toBe(
      'A B. Chap. In E F, editor, \\emph{Book}, chapter 3, page 5. P, 1.',
    );
    expect(text('plain', entry('phdthesis', { author: 'A B', title: 'Thesis Title', school: 'MIT', year: '2' }))).toBe('A B. \\emph{Thesis Title}. PhD thesis, MIT, 2.');
    expect(text('plain', entry('mastersthesis', { author: 'A B', title: 'T', school: 'S', year: '2' }))).toBe("A B. T. Master's thesis, S, 2.");
    expect(text('plain', entry('techreport', { author: 'A B', title: 'T', institution: 'I', number: '7', year: '3' }))).toBe('A B. T. Technical Report 7, I, 3.');
    expect(text('plain', entry('techreport', { author: 'A B', title: 'T', institution: 'I' }))).toBe('A B. T. Technical report, I.');
    expect(text('plain', entry('manual', { organization: 'Org', title: 'Manual', year: '4' }))).toBe('Org. \\emph{Manual}. 4.');
    expect(text('plain', entry('misc', { author: 'A B', title: 'Web Page?', howpublished: 'Online', note: 'Seen today' }))).toBe('A B. Web page? Online. Seen today.');
    expect(text('plain', entry('article', { author: 'A B', title: 'T', journal: 'J', pages: '1-2', month: '3', year: '5' }))).toBe('A B. T. \\emph{J}, pages 1--2, March 5.');
  });

  it('lays out the common entry types in ieeetr', () => {
    expect(text('ieeetr', entry('book', { author: 'Ann Bee', title: 'Book', publisher: 'P', year: '1' }))).toBe('A. Bee, \\emph{Book}. P, 1.');
    expect(text('ieeetr', entry('incollection', { author: 'Ann Bee', title: 'Part', booktitle: 'B', pages: '9', address: 'NY', publisher: 'P', year: '1' }))).toBe(
      "A. Bee, ``Part,'' in \\emph{B}, p.~9, NY: P, 1.",
    );
    expect(text('ieeetr', entry('phdthesis', { author: 'Ann Bee', title: 'T', school: 'S', year: '1' }))).toBe('A. Bee, \\emph{T}. PhD thesis, S, 1.');
    expect(text('ieeetr', entry('mastersthesis', { author: 'Ann Bee', title: 'T', school: 'S', year: '1' }))).toBe("A. Bee, ``T,'' Master's thesis, S, 1.");
    expect(text('ieeetr', entry('techreport', { author: 'Ann Bee', title: 'T', institution: 'I', number: '4' }))).toBe("A. Bee, ``T,'' Tech. Rep. 4, I.");
    expect(text('ieeetr', entry('techreport', { author: 'Ann Bee', title: 'T', institution: 'I' }))).toBe("A. Bee, ``T,'' tech. rep., I.");
    expect(text('ieeetr', entry('misc', { author: 'Ann Bee', title: 'T' }))).toBe("A. Bee, ``T.''");
    expect(text('ieeetr', entry('book', { author: 'Ann Bee', title: 'B' }))).toBe('A. Bee, \\emph{B}.');
    expect(text('ieeetr', entry('misc', { editor: 'Ed Itor', howpublished: 'Online', month: 'sep' }))).toBe('E. Itor, editor, Online, Sept.');
  });

  it('adds letters to duplicate alpha and author-year labels, and labels authorless entries by key', () => {
    const twins = [entry('misc', { author: 'Ann Bee', year: '2001', title: 'B' }, 'b'), entry('misc', { author: 'Ann Bee', year: '2001', title: 'A' }, 'a')];
    expect(buildBibliography(twins, style('alpha')).map((item) => item.label)).toEqual(['Bee01a', 'Bee01b']);
    expect(buildBibliography(twins, style('apalike')).map((item) => item.label)).toEqual(['Bee, 2001a', 'Bee, 2001b']);
    const many = entry('misc', { author: 'A One and B Two and C Three and D Four and E Five', year: '1999' });
    expect(buildBibliography([many], style('alpha'))[0].label).toBe('OTT+99');
    expect(buildBibliography([entry('misc', {}, 'webpage')], style('alpha'))[0].label).toBe('web');
    expect(buildBibliography([entry('misc', {}, 'webpage')], style('apalike'))[0].label).toBe('webpage, ');
  });
});

describe('peer-supplied values', () => {
  it('escapes bare % and balances braces in field values', () => {
    // An entry cut off at the end of the file leaves its last value unbalanced.
    expect(parseBib('@misc{k, note = {50% off \\% kept}, x = {{d}}, title = {a {b')[0].fields).toEqual({
      note: '50\\% off \\% kept',
      x: '{d}',
      title: 'a {b}',
    });
  });

  it('shows an authorless key as safe text', () => {
    const [item] = buildBibliography([entry('misc', { year: '2000' }, 'odd_key&{x}\\y')], style('apalike'));
    expect(item.names).toBe('odd\\_key\\&xy');
  });
});

describe('long adversarial input', () => {
  const n = 50_000;
  const spaces = ' '.repeat(n);
  /** Run fn and check it finishes well inside the time a quadratic pass over 50k characters would take. */
  const fast = (fn: () => unknown) => {
    const started = performance.now();
    fn();
    expect(performance.now() - started).toBeLessThan(1000);
  };

  it('parses huge or odd .bib text in linear time', () => {
    fast(() => parseBib(`@misc{k, ${'a'.repeat(n)}}`));
    fast(() => parseBib(`@misc{k, ${'a = b, '.repeat(n / 6)}}`));
    fast(() => parseBib(`@misc{k, title = {${spaces}x${spaces}}}`));
    fast(() => parseBib(`@misc{k, title = ${'x # '.repeat(n / 4)}y}`));
    fast(() => parseBib('@'.repeat(n) + `@misc{${spaces}`));
  });

  it('formats huge or odd fields in linear time', () => {
    const fields: Record<string, string>[] = [
      { pages: `1${spaces}2`, author: 'A B', title: 'T', journal: 'J' },
      { pages: `${'- '.repeat(n / 2)}`, author: 'A B' },
      { author: `A${spaces}B${spaces}C` },
      { author: `A${' and'.repeat(n / 4)} B` },
      { author: `A${spaces}andx B`, editor: `{${spaces}` },
      { author: `${'A, '.repeat(n / 3)}B` },
      { author: 'A B', title: `${'\\'.repeat(n)}x` },
      { author: 'A B', title: `x${'}'.repeat(n)}`, note: `.${'}'.repeat(n)}x` },
      { first: `${'~'.repeat(n)}` },
    ];
    for (const f of fields) {
      for (const name of ['plain', 'alpha', 'ieeetr', 'apalike']) {
        fast(() => buildBibliography([entry('article', f, `k${spaces}_`)], style(name)));
      }
    }
    fast(() => biblatexStyle(`${spaces},style${spaces}=${spaces}alphabetic`));
    expect(biblatexStyle(`${spaces},style${spaces}=${spaces}alphabetic`).name).toBe('alpha');
  });

  it('still reads names and page ranges the same way', () => {
    expect(text('plain', entry('article', { author: 'A  One AND   B Two', title: 'T', journal: 'J', pages: '1 -  10' }))).toBe('A One and B Two. T. \\emph{J}, pages 1--10.');
    expect(text('plain', entry('misc', { author: 'Sandy Anders and Ann Bee' }))).toBe('Sandy Anders and Ann Bee.');
  });
});
