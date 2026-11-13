import { appendInline, parseBlocks, parseChangelog, renderBlocks, resolveHref, REPO_BLOB_BASE } from './changelogMarkdown';

const noLinks = new Map<string, string>();

function inline(text: string, links = noLinks) {
  const el = document.createElement('p');
  appendInline(el, text, links);
  return el;
}

function blocks(markdown: string, links = noLinks) {
  const el = document.createElement('div');
  renderBlocks(el, parseBlocks(markdown.split('\n')), links, 1);
  return el;
}

describe('appendInline', () => {
  it('renders bold and inline code', () => {
    const p = inline('A **bold** word and `code <b>` here.');
    expect(p.querySelector('strong')!.textContent).toBe('bold');
    expect(p.querySelector('code')!.textContent).toBe('code <b>');
    expect(p.textContent).toBe('A bold word and code <b> here.');
  });

  it('nests code and links inside bold', () => {
    const p = inline('**Use `x` and [docs](https://example.com)**');
    const strong = p.querySelector('strong')!;
    expect(strong.querySelector('code')!.textContent).toBe('x');
    expect(strong.querySelector('a')!.href).toBe('https://example.com/');
  });

  it('opens links in a new tab with noopener', () => {
    const a = inline('See [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).').querySelector('a')!;
    expect(a.textContent).toBe('Keep a Changelog');
    expect(a.href).toBe('https://keepachangelog.com/en/1.1.0/');
    expect(a.target).toBe('_blank');
    expect(a.rel.split(' ')).toContain('noopener');
  });

  it('points relative links at the file on GitHub', () => {
    expect(inline('[v](docs/versioning.md)').querySelector('a')!.href).toBe(`${REPO_BLOB_BASE}docs/versioning.md`);
    expect(inline('[v](./docs/a.md "Title")').querySelector('a')!.href).toBe(`${REPO_BLOB_BASE}docs/a.md`);
  });

  it('resolves reference-style links from the definitions', () => {
    const links = new Map([['0.1.0', 'https://example.com/r'], ['keep', 'https://keep.example/']]);
    const full = inline('[the release][0.1.0]', links).querySelector('a')!;
    expect(full.textContent).toBe('the release');
    expect(full.href).toBe('https://example.com/r');
    expect(inline('[Keep][]', links).querySelector('a')!.href).toBe('https://keep.example/');
    expect(inline('[KEEP]', links).querySelector('a')!.href).toBe('https://keep.example/');
    // Brackets without a definition stay as text.
    expect(inline('[nope] and [x][missing]', links).textContent).toBe('[nope] and [x][missing]');
  });

  it('shows raw HTML as text', () => {
    const p = inline('<img src=x onerror="alert(1)"> <script>alert(2)</script>');
    expect(p.children.length).toBe(0);
    expect(p.textContent).toBe('<img src=x onerror="alert(1)"> <script>alert(2)</script>');
  });

  it('drops links with unsafe schemes but keeps the text', () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,hi', '//evil.example/x']) {
      const p = inline(`[click](${href})`);
      expect(p.querySelector('a')).toBeNull();
      expect(p.textContent).toBe('click');
    }
  });

  it('keeps unclosed markers and escapes as text', () => {
    expect(inline('a ** b ` c [d').textContent).toBe('a ** b ` c [d');
    expect(inline('\\*\\*not bold\\*\\*').querySelector('strong')).toBeNull();
    expect(inline('\\*\\*not bold\\*\\*').textContent).toBe('**not bold**');
    expect(inline('ends with \\').textContent).toBe('ends with \\');
  });

  it('handles nested brackets in link text', () => {
    const a = inline('[a [b] c](https://example.com)').querySelector('a')!;
    expect(a.textContent).toBe('a [b] c');
  });
});

describe('resolveHref', () => {
  it('keeps http, https and mailto', () => {
    expect(resolveHref('https://a.example/')).toBe('https://a.example/');
    expect(resolveHref('mailto:x@example.com')).toBe('mailto:x@example.com');
  });

  it('resolves anchors and paths against CHANGELOG.md on GitHub', () => {
    expect(resolveHref('#unreleased')).toBe(`${REPO_BLOB_BASE}CHANGELOG.md#unreleased`);
    expect(resolveHref('/SECURITY.md')).toBe(`${REPO_BLOB_BASE}SECURITY.md`);
  });

  it('refuses empty, unsafe and escaping targets', () => {
    expect(resolveHref('  ')).toBeNull();
    expect(resolveHref('JavaScript:alert(1)')).toBeNull();
    expect(resolveHref('../../../x')).toBeNull();
  });
});

describe('parseBlocks and renderBlocks', () => {
  it('renders headings shifted by the offset', () => {
    const el = blocks('### Added\n#### Detail ##');
    expect(el.querySelector('h4')!.textContent).toBe('Added');
    expect(el.querySelector('h5')!.textContent).toBe('Detail');
  });

  it('clamps heading levels to h1-h6', () => {
    const el = document.createElement('div');
    renderBlocks(el, [{ kind: 'heading', level: 6, text: 'deep' }], noLinks, 3);
    expect(el.querySelector('h6')!.textContent).toBe('deep');
  });

  it('joins paragraph lines and splits on blank lines', () => {
    const el = blocks('one\ntwo\n\nthree');
    expect([...el.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['one two', 'three']);
  });

  it('nests list items by indent and carries on wrapped lines', () => {
    const el = blocks('- **First**\n  - child a\n  - child b\n    wrapped\n- Second\n* Third\n\nAfter.');
    const top = el.querySelector('ul')!;
    const items = [...top.children] as HTMLLIElement[];
    expect(items.map((li) => li.firstChild!.textContent)).toEqual(['First', 'Second', 'Third']);
    expect(items[0].querySelector('strong')!.textContent).toBe('First');
    const nested = items[0].querySelector('ul')!;
    expect([...nested.children].map((li) => li.textContent)).toEqual(['child a', 'child b wrapped']);
    expect(el.querySelector('p')!.textContent).toBe('After.');
  });

  it('goes back up a level when the indent drops', () => {
    const el = blocks('- a\n  - b\n    - c\n- d');
    const top = el.querySelector(':scope > ul')!;
    expect(top.children.length).toBe(2);
    expect(top.querySelector('ul ul ul li')!.textContent).toBe('c');
  });

  it('ends a list at a paragraph and at a heading', () => {
    const el = blocks('- a\ntext\n- b\n### H\n- c');
    expect(el.querySelectorAll(':scope > ul').length).toBe(3);
    expect(el.querySelector(':scope > p')!.textContent).toBe('text');
  });

  it('skips link definitions', () => {
    expect(blocks('[x]: https://example.com\ntext').textContent).toBe('text');
  });
});

describe('parseChangelog', () => {
  const sample = [
    '# Changelog',
    '',
    'Intro text that is not shown.',
    '',
    '## [0.1.0] - 2026-01-01',
    '',
    '### Added',
    '- First',
    '',
    '## [Unreleased]',
    '### Fixed',
    '- Bug',
    '',
    '## [0.10.0] - 2026-03-01',
    '- Ten',
    '',
    '## v0.2.0',
    '- Two',
    '',
    '## Old stuff',
    '- Misc',
    '',
    '[Unreleased]: https://example.com/compare',
    '[0.1.0]: https://example.com/0.1.0',
  ].join('\r\n');

  it('puts Unreleased first, then versions newest first', () => {
    const { releases } = parseChangelog(sample);
    expect(releases.map((r) => r.version)).toEqual(['Unreleased', '0.10.0', '0.2.0', '0.1.0', 'Old stuff']);
    expect(releases[0].unreleased).toBe(true);
    expect(releases[1].date).toBe('2026-03-01');
    expect(releases[2].date).toBe('');
  });

  it('collects the reference links, lowercased', () => {
    const { links } = parseChangelog(sample);
    expect(links.get('unreleased')).toBe('https://example.com/compare');
    expect(links.get('0.1.0')).toBe('https://example.com/0.1.0');
  });

  it('keeps each release body', () => {
    const { releases } = parseChangelog(sample);
    const first = releases.find((r) => r.version === '0.1.0')!;
    expect(first.blocks[0]).toEqual({ kind: 'heading', level: 3, text: 'Added' });
    expect(first.blocks[1]).toEqual({ kind: 'list', items: [{ text: 'First', children: [] }] });
  });

  it('returns no releases for a file without ## headings', () => {
    expect(parseChangelog('# Changelog\n\nNothing yet.').releases).toEqual([]);
  });
});
