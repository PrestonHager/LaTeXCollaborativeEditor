// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSubset, readVegaSource, OUTPUT_PATH } from './basecoat-subset.mjs';
import { checkBudget, measureAssets } from './check-bundle-size.mjs';
import { checkPages, checkVersionFile, REQUIRED_PAGES, FORBIDDEN_PATHS } from './check-build-pages.mjs';
import {
  VERSION_FILE,
  isValidVersionInfo,
  resolveBuildInfo,
  resolveCommit,
  versionJson,
  versionJsonPlugin,
} from './build-info.mjs';
import { changelogSection, prepareRelease, versionFromTag } from './release-notes.mjs';
import viteConfig from '../vite.config.ts';

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

describe('build pages script', () => {
  it('passes a dist folder with every page and no dev files', () => {
    const result = checkPages(['index.html', 'privacy.html', 'tos.html', 'assets', 'favicon.svg']);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('fails when the legal pages are missing (issue #110)', () => {
    const result = checkPages(['index.html', 'assets']);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['privacy.html', 'tos.html']);
    expect(result.errors[0]).toContain('privacy.html is missing');
  });

  it('fails when a dev-only page ships', () => {
    const result = checkPages([...REQUIRED_PAGES, 'regression.html', 'dev']);
    expect(result.ok).toBe(false);
    expect(result.unexpected).toEqual(['regression.html', 'dev']);
    expect(result.errors.join('\n')).toContain('regression.html is dev-only');
  });

  it('builds exactly the required pages from vite.config.ts', () => {
    const input = viteConfig.build.rolldownOptions.input;
    const pages = Object.values(input).map((path) => path.split(/[\\/]/).at(-1));
    expect(pages.sort()).toEqual([...REQUIRED_PAGES].sort());
    for (const forbidden of FORBIDDEN_PATHS) expect(pages).not.toContain(forbidden);
  });

  it('covers every local page index.html links to', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const linked = [...html.matchAll(/href="\.\/([\w-]+\.html)"/g)].map((match) => match[1]);
    expect(linked.length).toBeGreaterThan(0);
    for (const page of linked) expect(REQUIRED_PAGES).toContain(page);
  });
});

const goodInfo = { version: '0.1.0', commit: 'abc1234', builtAt: '2026-11-13T10:00:00.000Z' };

describe('build info script', () => {
  const noGit = () => {
    throw new Error('git: not found');
  };

  it('takes the short SHA from git', () => {
    expect(resolveCommit({ GITHUB_SHA: 'f'.repeat(40) }, () => 'ABC1234\n')).toBe('abc1234');
  });

  it('falls back to GITHUB_SHA, then to dev', () => {
    expect(resolveCommit({ GITHUB_SHA: '0123456789abcdef0123456789abcdef01234567' }, noGit)).toBe('0123456');
    expect(resolveCommit({ GITHUB_SHA: 'not-a-sha' }, noGit)).toBe('dev');
    expect(resolveCommit({}, noGit)).toBe('dev');
    // git printing something odd (an error on stdout) doesn't count either.
    expect(resolveCommit({}, () => 'fatal: not a git repository')).toBe('dev');
  });

  it('bakes in the version, commit and build time', () => {
    const now = new Date('2026-11-13T10:00:00Z');
    expect(resolveBuildInfo({ version: '0.1.0', env: {}, git: () => 'abc1234', now })).toEqual(goodInfo);
  });

  it('uses the real git checkout by default', () => {
    const info = resolveBuildInfo({ version: '0.1.0' });
    expect(isValidVersionInfo(info)).toBe(true);
  });

  it('writes only the three fields to version.json', () => {
    const text = versionJson({ ...goodInfo, secret: 'x' });
    expect(JSON.parse(text)).toEqual(goodInfo);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('emits version.json from the Vite plugin and serves it in dev', () => {
    const plugin = versionJsonPlugin(goodInfo);
    const emitFile = vi.fn();
    plugin.generateBundle.call({ emitFile });
    expect(emitFile).toHaveBeenCalledWith({ type: 'asset', fileName: VERSION_FILE, source: versionJson(goodInfo) });

    let middleware;
    plugin.configureServer({ middlewares: { use: (fn) => (middleware = fn) } });
    const res = { setHeader: vi.fn(), end: vi.fn() };
    const next = vi.fn();
    middleware({ url: '/version.json?t=1' }, res, next);
    expect(res.end).toHaveBeenCalledWith(versionJson(goodInfo));
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    middleware({ url: '/index.html' }, res, next);
    middleware({}, res, next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('is wired into vite.config.ts with the version from package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const rootPkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(rootPkg.version).toBe(pkg.version);
    expect(viteConfig.define['import.meta.env.VITE_APP_VERSION']).toBe(JSON.stringify(pkg.version));
    expect(JSON.parse(viteConfig.define['import.meta.env.VITE_APP_COMMIT'])).toMatch(/^(?:[0-9a-f]{7,40}|dev)$/);
    expect(Number.isNaN(Date.parse(JSON.parse(viteConfig.define['import.meta.env.VITE_APP_BUILT_AT'])))).toBe(false);
    expect(viteConfig.plugins.flat().map((plugin) => plugin?.name)).toContain('app-version-json');
  });

  it('has a CHANGELOG entry for the current version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const changelog = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
    expect(changelog).toContain(`## [${pkg.version}]`);
  });
});

describe('version.json check', () => {
  it('passes a good file with the package.json version', () => {
    expect(checkVersionFile(versionJson(goodInfo), '0.1.0')).toEqual({ ok: true, errors: [] });
    expect(checkVersionFile(versionJson({ ...goodInfo, commit: 'dev' }))).toEqual({ ok: true, errors: [] });
  });

  it('fails when the file is missing', () => {
    const result = checkVersionFile(null, '0.1.0');
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('version.json is missing');
  });

  it('fails when it is not JSON', () => {
    expect(checkVersionFile('{nope', '0.1.0').errors).toEqual(['dist/version.json is not valid JSON.']);
  });

  it('fails on bad or missing fields', () => {
    expect(checkVersionFile('[]', '0.1.0').errors[0]).toContain('not a JSON object');
    const result = checkVersionFile(JSON.stringify({ version: '1.0', commit: 'XYZ' }), '0.1.0');
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('"version" must be a SemVer string');
    expect(result.errors.join('\n')).toContain('"commit" must be a hex SHA');
    expect(result.errors.join('\n')).toContain('"builtAt" must be an ISO date');
  });

  it('fails when the version does not match package.json', () => {
    const result = checkVersionFile(versionJson(goodInfo), '0.2.0');
    expect(result.errors).toEqual(['dist/version.json says 0.1.0 but package.json says 0.2.0.']);
  });
});

describe('release notes script', () => {
  const changelog = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '## [0.2.0] - 2027-01-01',
    '',
    '### Added',
    '',
    '- Something new.',
    '',
    '## [0.1.0] - 2026-11-13',
    '',
    '- The first one.',
    '',
    '[Unreleased]: https://example.com/compare',
    '[0.2.0]: https://example.com/0.2.0',
  ].join('\r\n');

  it('reads the version out of a tag', () => {
    expect(versionFromTag('v0.1.0')).toBe('0.1.0');
    expect(versionFromTag('v1.0.0-rc.1')).toBe('1.0.0-rc.1');
    expect(versionFromTag('0.1.0')).toBeNull();
    expect(versionFromTag('v1.0')).toBeNull();
    expect(versionFromTag(undefined)).toBeNull();
  });

  it('takes one version section from the changelog', () => {
    expect(changelogSection(changelog, '0.2.0')).toBe('### Added\n\n- Something new.');
    expect(changelogSection(changelog, '0.1.0')).toBe('- The first one.');
    expect(changelogSection(changelog, 'Unreleased')).toBeNull();
    expect(changelogSection(changelog, '9.9.9')).toBeNull();
    expect(changelogSection('## [1.0.0]\n- last section', '1.0.0')).toBe('- last section');
  });

  it('passes a tag that matches both package.json files and has notes', () => {
    const result = prepareRelease({ tag: 'v0.2.0', frontendVersion: '0.2.0', rootVersion: '0.2.0', changelog });
    expect(result).toEqual({ ok: true, errors: [], notes: '### Added\n\n- Something new.', prerelease: false });
    expect(prepareRelease({ tag: 'v1.0.0-rc.1', frontendVersion: '1.0.0-rc.1', rootVersion: '1.0.0-rc.1', changelog: '## [1.0.0-rc.1]\n- rc' }).prerelease).toBe(true);
  });

  it('fails a tag that does not match, or has no notes', () => {
    expect(prepareRelease({ tag: 'release-1', frontendVersion: '0.2.0', rootVersion: '0.2.0', changelog }).errors[0]).toContain('not v followed by');
    const result = prepareRelease({ tag: 'v0.3.0', frontendVersion: '0.2.0', rootVersion: '0.1.0', changelog });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      "Tag v0.3.0 doesn't match frontend/package.json (0.2.0).",
      "Tag v0.3.0 doesn't match the root package.json (0.1.0).",
      'CHANGELOG.md has no "## [0.3.0]" section with notes in it.',
    ]);
  });

  it('works on the real changelog for the current version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const rootPkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    const real = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
    const result = prepareRelease({ tag: `v${pkg.version}`, frontendVersion: pkg.version, rootVersion: rootPkg.version, changelog: real });
    expect(result.errors).toEqual([]);
    expect(result.notes).toContain('### Added');
  });
});
