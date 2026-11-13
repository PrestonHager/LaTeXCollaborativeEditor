// Checks the editor theme colors in style.css: every theme has a full set, the two light
// copies match, and line numbers keep at least 4.5:1 contrast against the gutter (#81).

async function readStyleCss(): Promise<string> {
  // Vitest turns CSS imports into empty strings, so we read the file. The app has no Node types.
  const fs = (await import('node:fs' as string)) as { readFileSync(path: string, encoding: 'utf8'): string };
  return fs.readFileSync('src/style.css', 'utf8');
}

/** The `--editor-*` declarations in the first rule body that follows `selector`. */
function editorVars(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start + selector.length);
  const body = css.slice(open + 1, css.indexOf('}', open));
  const vars: Record<string, string> = {};
  for (const match of body.matchAll(/(--editor-[\w-]+)\s*:\s*([^;]+);/g)) vars[match[1]] = match[2].trim();
  return vars;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const REQUIRED = [
  '--editor-text',
  '--editor-bg',
  '--editor-gutter-bg',
  '--editor-gutter-active-bg',
  '--editor-line-number',
  '--editor-line-number-active',
  '--editor-keyword',
  '--editor-string',
  '--editor-number',
  '--editor-comment',
  '--editor-operator',
];

describe('editor theme colors in style.css', () => {
  it('defines a full dark set on :root (system theme, dark OS) and the explicit dark theme', async () => {
    const dark = editorVars(await readStyleCss(), ':root,\n[data-editor-theme="dark"]');
    expect(Object.keys(dark).sort()).toEqual([...REQUIRED].sort());
  });

  it('uses the same light set for the light theme and for system on a light OS', async () => {
    const css = await readStyleCss();
    const light = editorVars(css, '\n[data-editor-theme="light"]');
    const systemLight = editorVars(css, ':root:not([data-editor-theme="dark"])');
    expect(Object.keys(light).sort()).toEqual([...REQUIRED].sort());
    expect(systemLight).toEqual(light);
  });

  it('gives the light theme a light gutter', async () => {
    const light = editorVars(await readStyleCss(), '\n[data-editor-theme="light"]');
    expect(luminance(light['--editor-gutter-bg'])).toBeGreaterThan(0.8);
    expect(luminance(light['--editor-gutter-active-bg'])).toBeGreaterThan(0.7);
  });

  it('colors the active line number on the gutter element itself, where CodeMirror puts the class', async () => {
    const css = await readStyleCss();
    expect(css).toMatch(/\.cm-gutterElement\.cm-activeLineGutter\s*\{\s*color: var\(--editor-line-number-active\)/);
  });

  it.each([
    ['dark', ':root,\n[data-editor-theme="dark"]'],
    ['light', '\n[data-editor-theme="light"]'],
  ])('keeps %s line numbers at least 4.5:1 against the gutter', async (_name, selector) => {
    const vars = editorVars(await readStyleCss(), selector);
    expect(contrast(vars['--editor-line-number'], vars['--editor-gutter-bg'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(vars['--editor-line-number-active'], vars['--editor-gutter-active-bg'])).toBeGreaterThanOrEqual(4.5);
  });
});
