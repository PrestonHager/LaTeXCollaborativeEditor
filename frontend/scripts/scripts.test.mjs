// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSubset, readVegaSource, OUTPUT_PATH } from './basecoat-subset.mjs';
import { checkBudget, measureAssets } from './check-bundle-size.mjs';

const fakeVega = [
  '/* Accordion */',
  '@layer components {',
  '  .accordion { color: red; }',
  '',
  '  /* Button */',
  '  .btn { color: blue; }',
  '',
  '  /* Dropdown Menu */',
  '  .dropdown-menu { color: green; }',
  '}',
  '',
].join('\n');

describe('basecoat subset script', () => {
  it('keeps only the listed sections', () => {
    const css = buildSubset(fakeVega, ['Dropdown Menu']);
    expect(css).toContain('.dropdown-menu');
    expect(css).not.toContain('.btn');
    expect(css).not.toContain('.accordion');
    expect(css).toContain('@layer components {');
  });

  it('throws when a component name is not in the source', () => {
    expect(() => buildSubset(fakeVega, ['Nope'])).toThrow('Nope');
  });

  it('matches the committed file, so a Basecoat upgrade gets regenerated', () => {
    // If this fails, run `npm run basecoat:subset` and commit the result.
    expect(readFileSync(OUTPUT_PATH, 'utf8').replace(/\r\n/g, '\n')).toBe(buildSubset(readVegaSource()));
  });
});

describe('bundle size script', () => {
  it('flags a bundle that is over budget', () => {
    const result = checkBudget([{ name: 'a.js', bytes: 5000, gzipBytes: 3000 }], 2048);
    expect(result.overBudget).toBe(true);
    expect(result.summary).toContain('over the 2.0 kB budget');
  });

  it('passes a bundle under budget', () => {
    const result = checkBudget([{ name: 'a.js', bytes: 5000, gzipBytes: 1000 }], 2048);
    expect(result.overBudget).toBe(false);
    expect(result.lines.at(-1)).toContain('total gzip: 1.0 kB');
  });

  it('measures only js and css files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bundle-size-'));
    try {
      writeFileSync(join(dir, 'app.js'), 'console.log(1);'.repeat(50));
      writeFileSync(join(dir, 'app.css'), 'a{color:red}');
      writeFileSync(join(dir, 'logo.png'), 'not measured');
      const files = measureAssets(dir);
      expect(files.map((f) => f.name).sort()).toEqual(['app.css', 'app.js']);
      expect(files.every((f) => f.gzipBytes > 0)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
