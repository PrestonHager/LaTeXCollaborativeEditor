// @vitest-environment node
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSubset, readVegaSource, OUTPUT_PATH } from './basecoat-subset.mjs';
import {
  ASSUMED_BYTES_PER_SECOND,
  ASSUMED_RTT_MS,
  INITIAL_BUDGET_GZIP_BYTES,
  LAZY_FAIL_GZIP_BYTES,
  LAZY_WARN_GZIP_BYTES,
  checkBuild,
  checkDist,
  estimateLoadMs,
  findInitialGraph,
  findStaticImports,
  measureAssets,
  parseIndexHtml,
  toDistPath,
} from './check-bundle-size.mjs';
import { checkChangelogFile, checkPages, checkVersionFile, REQUIRED_PAGES, FORBIDDEN_PATHS } from './check-build-pages.mjs';
import {
  CHANGELOG_FILE,
  VERSION_FILE,
  changelogFilePlugin,
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
  const html = [
    '<link rel="icon" href="./favicon.svg" />',
    '<script type="module" crossorigin src="./assets/index-a.js"></script>',
    '<link rel="modulepreload" crossorigin href="./assets/vendor-b.js">',
    '<link rel="stylesheet" crossorigin href="./assets/index-c.css">',
    '<script src="https://accounts.google.com/gsi/client"></script>',
  ].join('\n');
  const manifest = {
    'index.html': {
      file: 'assets/index-a.js',
      isEntry: true,
      imports: ['_vendor-b.js'],
      dynamicImports: ['src/zip.ts'],
      css: ['assets/index-c.css'],
    },
    '_vendor-b.js': { file: 'assets/vendor-b.js', imports: ['_shared-e.js'] },
    '_shared-e.js': { file: 'assets/shared-e.js', css: ['assets/shared-f.css'] },
    'src/zip.ts': { file: 'assets/zip-d.js', isDynamicEntry: true, imports: ['_vendor-b.js'] },
  };
  const asset = (path, gzipBytes, staticImports = []) => ({ path, bytes: gzipBytes * 3, gzipBytes, staticImports });
  const assets = () => [
    asset('assets/index-a.js', 100_000, ['./vendor-b.js']),
    asset('assets/vendor-b.js', 50_000, ['./shared-e.js']),
    asset('assets/shared-e.js', 10_000),
    asset('assets/shared-f.css', 1_000),
    asset('assets/index-c.css', 10_000),
    asset('assets/zip-d.js', 20_000, ['./vendor-b.js']),
    asset('assets/compile.worker-x.js', 200_000),
  ];

  it('has the Vite manifest turned on, since the check reads it', () => {
    expect(viteConfig.build.manifest).toBe(true);
  });

  it('reads local scripts, preloads and stylesheets from index.html', () => {
    expect(parseIndexHtml(html)).toEqual({
      scripts: ['assets/index-a.js'],
      modulepreloads: ['assets/vendor-b.js'],
      stylesheets: ['assets/index-c.css'],
    });
  });

  it('follows static imports and css in the manifest, but not dynamic imports', () => {
    const files = findInitialGraph(parseIndexHtml(html), manifest);
    expect([...files].sort()).toEqual([
      'assets/index-a.js',
      'assets/index-c.css',
      'assets/shared-e.js',
      'assets/shared-f.css',
      'assets/vendor-b.js',
    ]);
  });

  it('counts only the initial graph against the budget and lists lazy chunks with load times', () => {
    const result = checkBuild({ html, htmlGzipBytes: 5_000, manifest, assets: assets() });
    expect(result.errors).toEqual([]);
    expect(result.initialGzip).toBe(5_000 + 100_000 + 50_000 + 10_000 + 1_000 + 10_000);
    expect(result.lazy.sort()).toEqual(['assets/compile.worker-x.js', 'assets/zip-d.js']);
    expect(result.lines.join('\n')).toContain('assets/compile.worker-x.js: 600.0 kB (gzip 200.0 kB), about 210 ms');
  });

  it('fails when the initial load is over budget', () => {
    const result = checkBuild({ html, htmlGzipBytes: 5_000, manifest, assets: assets() }, { initialBudget: 100_000 });
    expect(result.errors.join('\n')).toContain('over the 100.0 kB budget');
  });

  it('warns about a big lazy chunk and fails on an absurd one', () => {
    const big = checkBuild({ html, htmlGzipBytes: 0, manifest, assets: assets() }, { lazyWarn: 150_000 });
    expect(big.errors).toEqual([]);
    expect(big.warnings.join('\n')).toContain('assets/compile.worker-x.js is 200.0 kB');
    const absurd = checkBuild({ html, htmlGzipBytes: 0, manifest, assets: assets() }, { lazyFail: 150_000 });
    expect(absurd.errors.join('\n')).toContain('over the 150.0 kB limit for one lazy chunk');
  });

  it('fails when a dynamic import ended up in the initial graph', () => {
    const merged = structuredClone(manifest);
    merged['_vendor-b.js'].imports.push('src/zip.ts');
    const list = assets();
    list[1].staticImports.push('./zip-d.js');
    const result = checkBuild({ html, htmlGzipBytes: 0, manifest: merged, assets: list });
    expect(result.errors.join('\n')).toContain('src/zip.ts is imported dynamically');
  });

  it('fails when initial code statically imports a chunk outside the initial graph', () => {
    const list = assets();
    list[0].staticImports.push('./compile.worker-x.js');
    const result = checkBuild({ html, htmlGzipBytes: 0, manifest, assets: list });
    expect(result.errors.join('\n')).toContain('assets/index-a.js statically imports assets/compile.worker-x.js');
  });

  it('fails when index.html loads a file that is not in dist', () => {
    const result = checkBuild({ html, htmlGzipBytes: 0, manifest, assets: assets().filter((a) => a.path !== 'assets/index-c.css') });
    expect(result.errors.join('\n')).toContain("index.html loads assets/index-c.css, but it isn't in dist/");
  });

  it('finds static imports but not dynamic ones', () => {
    const code = 'import{a as b}from"./x-1.js";import"./y-2.js";export{c}from"../z-3.js";const m=import("./lazy-4.js");import.meta.url;';
    expect(findStaticImports(code).sort()).toEqual(['../z-3.js', './x-1.js', './y-2.js']);
  });

  it('turns html refs into dist paths and skips external ones', () => {
    expect(toDistPath('./assets/a.js?v=1')).toBe('assets/a.js');
    expect(toDistPath('/assets/a.js')).toBe('assets/a.js');
    expect(toDistPath('https://cdn.example.com/a.js')).toBeNull();
    expect(toDistPath('//cdn.example.com/a.js')).toBeNull();
    expect(toDistPath(null)).toBeNull();
  });

  it('estimates load time from the assumed speed and round trip', () => {
    expect(estimateLoadMs(ASSUMED_BYTES_PER_SECOND)).toBe(1000 + ASSUMED_RTT_MS);
    // The initial budget is about 200 ms of transfer, which keeps the whole load to a few hundred ms.
    expect(estimateLoadMs(INITIAL_BUDGET_GZIP_BYTES)).toBeLessThanOrEqual(300);
    expect(LAZY_WARN_GZIP_BYTES).toBeLessThan(LAZY_FAIL_GZIP_BYTES);
  });

  it('measures js and css under dist, including subfolders but not .vite', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bundle-size-'));
    try {
      mkdirSync(join(dir, 'assets'));
      mkdirSync(join(dir, '.vite'));
      writeFileSync(join(dir, 'assets', 'app.js'), 'import"./dep.js";' + 'console.log(1);'.repeat(50));
      writeFileSync(join(dir, 'assets', 'app.css'), 'a{color:red}');
      writeFileSync(join(dir, 'assets', 'logo.png'), 'not measured');
      writeFileSync(join(dir, '.vite', 'manifest.js'), 'not measured');
      const files = measureAssets(dir);
      expect(files.map((f) => f.path).sort()).toEqual(['assets/app.css', 'assets/app.js']);
      expect(files.every((f) => f.gzipBytes > 0)).toBe(true);
      expect(files.find((f) => f.path === 'assets/app.js').staticImports).toEqual(['./dep.js']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('checks a dist folder end to end', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bundle-dist-'));
    try {
      mkdirSync(join(dir, 'assets'));
      mkdirSync(join(dir, '.vite'));
      writeFileSync(join(dir, 'index.html'), '<script type="module" src="./assets/main.js"></script>');
      writeFileSync(join(dir, 'assets', 'main.js'), 'const w=new URL("./worker.js",import.meta.url);');
      writeFileSync(join(dir, 'assets', 'worker.js'), 'self.onmessage=()=>{};');
      writeFileSync(join(dir, '.vite', 'manifest.json'), JSON.stringify({ 'index.html': { file: 'assets/main.js', isEntry: true } }));
      const result = checkDist(dir);
      expect(result.errors).toEqual([]);
      expect(result.initial).toEqual(['assets/main.js']);
      expect(result.lazy).toEqual(['assets/worker.js']);
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

  it('copies the root CHANGELOG.md into dist and serves it in dev', () => {
    const source = fileURLToPath(new URL('../../CHANGELOG.md', import.meta.url));
    const text = readFileSync(source, 'utf8');
    const plugin = changelogFilePlugin(source);
    const emitFile = vi.fn();
    plugin.generateBundle.call({ emitFile });
    expect(emitFile).toHaveBeenCalledWith({ type: 'asset', fileName: CHANGELOG_FILE, source: text });

    let middleware;
    plugin.configureServer({ middlewares: { use: (fn) => (middleware = fn) } });
    const res = { setHeader: vi.fn(), end: vi.fn() };
    const next = vi.fn();
    middleware({ url: '/CHANGELOG.md?t=1' }, res, next);
    expect(res.end).toHaveBeenCalledWith(text);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    middleware({ url: '/index.html' }, res, next);
    middleware({}, res, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(viteConfig.plugins.flat().map((p) => p?.name)).toContain('app-changelog-file');
  });

  it('checks dist/CHANGELOG.md', () => {
    expect(checkChangelogFile('# Changelog\n\n## [Unreleased]\n')).toEqual({ ok: true, errors: [] });
    expect(checkChangelogFile(null).errors[0]).toMatch(/CHANGELOG.md is missing/);
    expect(checkChangelogFile('nothing').errors[0]).toMatch(/no "## " version sections/);
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
