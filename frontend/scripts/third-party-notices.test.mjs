// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUNDLED_EXTRAS,
  buildNotices,
  collectProductionPackages,
  isGpl3Compatible,
  licenseOf,
  readLicenseText,
  resolvePackageDir,
} from './third-party-notices.mjs';

const writePkg = (dir, pkg, files = {}) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
};

describe('isGpl3Compatible', () => {
  it('accepts permissive licenses, MPL-2.0 and OR/AND expressions', () => {
    for (const id of ['MIT', 'ISC', 'Apache-2.0', 'BSD-3-Clause', '0BSD', 'BlueOak-1.0.0', 'MPL 2.0', 'GPL-3.0-or-later']) {
      expect(isGpl3Compatible(id)).toBe(true);
    }
    expect(isGpl3Compatible('(MIT OR WTFPL)')).toBe(true);
    expect(isGpl3Compatible('(GPL-2.0-only OR MIT)')).toBe(true);
    expect(isGpl3Compatible('MIT AND Apache-2.0')).toBe(true);
  });

  it('rejects unknown, missing and incompatible licenses', () => {
    expect(isGpl3Compatible(null)).toBe(false);
    expect(isGpl3Compatible('UNLICENSED')).toBe(false);
    expect(isGpl3Compatible('GPL-2.0-only')).toBe(false);
    expect(isGpl3Compatible('SSPL-1.0')).toBe(false);
    expect(isGpl3Compatible('MIT AND SSPL-1.0')).toBe(false);
  });
});

describe('licenseOf', () => {
  it('reads string, object and array forms, and the hand-checked overrides', () => {
    expect(licenseOf({ name: 'a', license: ' MIT ' })).toBe('MIT');
    expect(licenseOf({ name: 'a', license: { type: 'ISC' } })).toBe('ISC');
    expect(licenseOf({ name: 'a', licenses: [{ type: 'MIT' }, 'Apache-2.0'] })).toBe('MIT OR Apache-2.0');
    expect(licenseOf({ name: 'a' })).toBeNull();
    expect(licenseOf({ name: 'stdin' })).toBe('MIT');
    expect(licenseOf({ name: 'hyphenation.en-us' })).toBe('MIT');
  });
});

describe('collectProductionPackages', () => {
  let root;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'notices-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('walks dependencies (nested first), skips dev and missing ones, and reads license files', () => {
    writePkg(root, { name: 'app', dependencies: { a: '1', missing: '1' }, devDependencies: { dev: '1' } });
    writePkg(join(root, 'node_modules', 'a'), { name: 'a', version: '1.0.0', license: 'MIT', dependencies: { b: '1', c: '1' } }, { LICENSE: 'A license' });
    writePkg(join(root, 'node_modules', 'a', 'node_modules', 'b'), { name: 'b', version: '2.0.0', license: 'ISC' }, { 'COPYING.txt': 'B copying' });
    writePkg(join(root, 'node_modules', 'b'), { name: 'b', version: '1.0.0', license: 'ISC' });
    writePkg(join(root, 'node_modules', 'c'), { name: 'c', version: '3.0.0', license: 'SSPL-1.0', dependencies: { a: '1' } });
    writePkg(join(root, 'node_modules', 'dev'), { name: 'dev', version: '1.0.0', license: 'MIT' });

    const packages = collectProductionPackages(root);
    expect(packages.map((pkg) => `${pkg.name}@${pkg.version}`)).toEqual(['a@1.0.0', 'b@2.0.0', 'c@3.0.0']);
    expect(resolvePackageDir('nope', root, root)).toBeNull();
    expect(readLicenseText(packages[1].dir)).toBe('B copying');
    expect(readLicenseText(join(root, 'node_modules', 'c'))).toBeNull();

    const { text, problems } = buildNotices([...packages, ...BUNDLED_EXTRAS], (pkg) => pkg.text ?? readLicenseText(pkg.dir));
    expect(text).toContain('GNU General Public License');
    expect(text).toContain('a@1.0.0 (MIT)\n');
    expect(text).toContain('A license');
    expect(text).toContain('No license file in the package. License from its package.json: SSPL-1.0.');
    expect(text).toContain('katex@0.13.13 (MIT)');
    expect(problems).toEqual(['c@3.0.0 has license "SSPL-1.0", which isn\'t on the GPLv3-compatible list.']);
  });

  it('says when a license was checked by hand', () => {
    const { text, problems } = buildNotices([{ name: 'stdin', version: '0.0.1', license: 'MIT' }, { name: 'x', version: '1', license: null }], () => null);
    expect(text).toContain('License checked by hand, see docs/licensing.md: MIT.');
    expect(text).toContain('x@1 (unknown)');
    expect(problems).toHaveLength(1);
  });

  it('passes for the real frontend dependencies', () => {
    const appDir = fileURLToPath(new URL('..', import.meta.url));
    const packages = collectProductionPackages(appDir);
    expect(packages.map((pkg) => pkg.name)).toEqual(expect.arrayContaining(['latex.js', 'pdfjs-dist', 'yjs', 'basecoat-css']));
    expect(buildNotices(packages, () => '').problems).toEqual([]);
  });
});
