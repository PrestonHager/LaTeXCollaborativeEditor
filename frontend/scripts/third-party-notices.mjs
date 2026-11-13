/**
 * Writes dist/third-party-licenses.txt and checks every runtime dependency's license.
 *
 * The app is GPL-3.0-or-later (../LICENSE). The build minifies dependencies into dist/ and drops
 * their license comments, but MIT, BSD, ISC and Apache-2.0 ask that the notice travels with the
 * code. So the build ships one text file with every production package's name, version, license
 * and license text. The About dialog links to it.
 *
 * It also fails the build if a production dependency has a license that isn't on the
 * GPLv3-compatible list below, so a new dependency can't slip in unnoticed (docs/licensing.md).
 *
 * Run from frontend/ after a build: node scripts/third-party-notices.mjs
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const NOTICES_FILE = 'third-party-licenses.txt';

/**
 * SPDX ids that can be combined with GPL-3.0-or-later code. Permissive licenses, plus MPL-2.0
 * (section 3.3) and the GPL family itself. AGPL-3.0 can be combined under GPLv3 section 13, but
 * keeps its own terms, so it's listed separately in docs/licensing.md, not here.
 */
export const GPL3_COMPATIBLE = new Set([
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MPL-2.0',
  'Python-2.0',
  'Unlicense',
  'WTFPL',
  'Zlib',
  'LGPL-2.1-or-later',
  'LGPL-3.0-only',
  'LGPL-3.0-or-later',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
]);

/**
 * Packages whose package.json has no usable license field, with the license we checked by hand.
 * Each one says where it was checked (docs/licensing.md has the details).
 */
export const LICENSE_OVERRIDES = {
  // Readme.md says "(The MIT License)". Its package.json has no license field.
  stdin: 'MIT',
  // Hyphenation patterns for Hypher (BSD-3-Clause), converted from TeX's hyph-utf8 patterns.
  // The npm packages have no license field; the upstream patterns are under permissive terms.
  'hyphenation.de': 'MIT',
  'hyphenation.en-us': 'MIT',
};

const MIT_PERMISSION = [
  'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and',
  'associated documentation files (the "Software"), to deal in the Software without restriction,',
  'including without limitation the rights to use, copy, modify, merge, publish, distribute,',
  'sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is',
  'furnished to do so, subject to the following conditions:',
  '',
  'The above copyright notice and this permission notice shall be included in all copies or',
  'substantial portions of the Software.',
  '',
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT',
  'NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND',
  'NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,',
  'DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT',
  'OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.',
].join('\n');

/**
 * Code that a dependency bundled into its own dist/ files, so it isn't in node_modules and the
 * walk below can't see it. latex.js's dist/latex.mjs has KaTeX 0.13.13 (its devDependency) inside.
 */
export const BUNDLED_EXTRAS = [
  {
    name: 'katex',
    version: '0.13.13',
    license: 'MIT',
    text: `Bundled inside latex.js.\n\nThe MIT License (MIT)\n\nCopyright (c) 2013-2020 Khan Academy and other contributors\n\n${MIT_PERMISSION}`,
  },
];

/** Read a package's license as an SPDX-ish string, or null. Handles the old object and array forms. */
export function licenseOf(pkg) {
  if (LICENSE_OVERRIDES[pkg.name]) return LICENSE_OVERRIDES[pkg.name];
  const { license, licenses } = pkg;
  if (typeof license === 'string' && license.trim()) return license.trim();
  if (license && typeof license === 'object' && license.type) return String(license.type);
  if (Array.isArray(licenses) && licenses.length) return licenses.map((entry) => entry.type ?? entry).join(' OR ');
  return null;
}

/** Normalize a few common non-SPDX spellings ("MPL 2.0", "Apache 2.0", "BSD"). */
function normalizeId(id) {
  const clean = id.trim().replace(/^\(+|\)+$/g, '');
  const aliases = { 'MPL 2.0': 'MPL-2.0', 'Apache 2.0': 'Apache-2.0', 'Apache License 2.0': 'Apache-2.0' };
  return aliases[clean] ?? clean;
}

/**
 * Is an SPDX expression compatible with GPL-3.0-or-later? `A OR B` needs one side to be,
 * `A AND B` needs both. Parentheses are ignored, which is fine for the flat expressions npm uses.
 */
export function isGpl3Compatible(expression) {
  if (!expression) return false;
  return expression
    .replace(/[()]/g, ' ')
    .split(/\s+OR\s+/i)
    .some((alternative) => alternative.split(/\s+AND\s+/i).every((id) => GPL3_COMPATIBLE.has(normalizeId(id))));
}

/** Find a package folder the way Node does: in nested node_modules first, then up the tree. */
export function resolvePackageDir(name, fromDir, rootDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dir === rootDir) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent.endsWith('node_modules') ? dirname(parent) : parent;
  }
}

/**
 * Every package the app depends on at run time (`dependencies`, recursively), sorted by name.
 * Dev dependencies don't ship and are left out. So are optional ones: the only ones here are
 * Node-only native builds (pdf.js's canvas), and leaving them out keeps the file the same on
 * every platform.
 */
export function collectProductionPackages(appDir) {
  const root = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
  const seen = new Map();
  const visit = (deps, fromDir) => {
    for (const name of Object.keys(deps ?? {})) {
      const dir = resolvePackageDir(name, fromDir, appDir);
      if (!dir || seen.has(dir)) continue;
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      seen.set(dir, { name: pkg.name ?? name, version: pkg.version ?? '', license: licenseOf(pkg), dir });
      visit(pkg.dependencies, dir);
    }
  };
  visit(root.dependencies, appDir);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/** The text of a package's LICENSE, LICENCE, COPYING or NOTICE files, or null. */
export function readLicenseText(dir) {
  const files = readdirSync(dir)
    .filter((file) => /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i.test(file))
    .sort();
  if (!files.length) return null;
  return files.map((file) => readFileSync(join(dir, file), 'utf8').trim()).join('\n\n');
}

/** Build the notices file and the list of problems (incompatible or unknown licenses). */
export function buildNotices(packages, readText = (pkg) => readLicenseText(pkg.dir)) {
  const problems = packages
    .filter((pkg) => !isGpl3Compatible(pkg.license))
    .map((pkg) => `${pkg.name}@${pkg.version} has license "${pkg.license ?? 'none'}", which isn't on the GPLv3-compatible list.`);
  const rule = '='.repeat(72);
  const sections = packages.map((pkg) => {
    const source = LICENSE_OVERRIDES[pkg.name] ? 'checked by hand, see docs/licensing.md' : 'from its package.json';
    const text = readText(pkg) ?? `No license file in the package. License ${source}: ${pkg.license ?? 'none'}.`;
    return `${rule}\n${pkg.name}@${pkg.version} (${pkg.license ?? 'unknown'})\n${rule}\n\n${text}\n`;
  });
  const header = [
    'LaTeX Collaborative Editor is free software under the GNU General Public License,',
    'version 3 or (at your option) any later version. Source and license:',
    'https://github.com/PrestonHager/LaTeXCollaborativeEditor',
    '',
    'It includes the third-party packages below, under their own licenses.',
    'LaTeX.js loads its CSS and fonts (Computer Modern Unicode and KaTeX fonts, SIL Open Font',
    'License 1.1) from the jsDelivr CDN at run time; see docs/licensing.md.',
    '',
  ].join('\n');
  return { text: `${header}\n${sections.join('\n')}`, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
  const distDir = join(appDir, 'dist');
  if (!existsSync(distDir)) {
    console.error('No dist/. Run the build first.');
    process.exit(1);
  }
  const packages = [...collectProductionPackages(appDir), ...BUNDLED_EXTRAS];
  const { text, problems } = buildNotices(packages, (pkg) => pkg.text ?? readLicenseText(pkg.dir));
  writeFileSync(join(distDir, NOTICES_FILE), text);
  console.log(`Wrote dist/${NOTICES_FILE} with ${packages.length} packages.`);
  problems.forEach((line) => console.error(`ERROR: ${line} See docs/licensing.md.`));
  if (problems.length) process.exit(1);
}
