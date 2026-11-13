# Licensing

This page is for maintainers and contributors. It isn't published on the docs site.
It records how the project is licensed, what we checked about dependencies, and what a new dependency has to meet.
It's the maintainer's working understanding, not legal advice.

## The project license

The project is **GPL-3.0-or-later**: the GNU General Public License, version 3, or (at your option) any later version.

- `LICENSE` at the repo root is the full, unmodified GPLv3 text (the FSF's `gpl-3.0.txt`, MD5 `1ebbd3e34237af26da5dc08a4e440464`, the same file Debian ships as `/usr/share/common-licenses/GPL-3`).
- `package.json`, `frontend/package.json` and `e2e/package.json` say `"license": "GPL-3.0-or-later"`, and so do the root entries of their lockfiles.
- The README and the docs FAQ have the standard notice. Help > About shows the license with a link to `LICENSE` on GitHub and to the third-party notices.
- We don't put SPDX headers in every file. The `LICENSE` file and the `license` fields cover the whole repository.

## Third-party notices

The build minifies dependencies into `dist/` and drops their license comments, but MIT, BSD, ISC and Apache-2.0 ask for their notice to go with the code.
So `npm run build` runs `frontend/scripts/third-party-notices.mjs` after `vite build`. It:

- walks `frontend/package.json` `dependencies` recursively through `node_modules` (dev dependencies don't ship, so they're left out, and so are optional Node-only native builds like pdf.js's canvas),
- writes `dist/third-party-licenses.txt` with each package's name, version, license and license file text, plus KaTeX, which latex.js bundles inside its own `dist/` (`BUNDLED_EXTRAS`),
- **fails the build** if a production package's license isn't on its GPLv3-compatible list (`GPL3_COMPATIBLE`), or has no license at all.

Help > About links to the file. A package with no `license` field that we checked by hand goes in `LICENSE_OVERRIDES` with a comment, and in the audit below.

## Adding a dependency

Every runtime dependency must be GPLv3-compatible.
Permissive licenses are fine: MIT, ISC, BSD-2/3-Clause, 0BSD, Apache-2.0, BlueOak-1.0.0, CC0-1.0, Unlicense, Zlib, and similar. So are MPL-2.0 (section 3.3) and LGPL/GPL-3.0.
Not compatible: GPL-2.0-only, SSPL, the Commons Clause, "non-commercial" licenses, and anything with no license.
If the build check rejects a package, don't widen `GPL3_COMPATIBLE` to make it pass. Check the license, and if it really is compatible, add it with a note here.

Dev-only tools (Vitest, Playwright, Tailwind's build plugin) don't ship in `dist/`, so their licenses don't need to be GPL-compatible, but they still need to allow our use.

## Audit (November 2026)

Run with `npx license-checker --production --summary` in `frontend/` and `npx license-checker --summary` in `e2e/`, and by reading each package's `package.json` and license file.

### Frontend runtime dependencies (99 packages)

| License | Count | Notes |
| --- | --- | --- |
| MIT | 71 | CodeMirror, Lezer, Yjs, y-codemirror.next, Trystero (`@trystero-p2p/*`), Basecoat (`basecoat-css`), latex.js and most of their dependencies. |
| ISC | 16 | Lucide icons and small utilities. |
| BlueOak-1.0.0 | 5 | `jackspeak`, `minipass`, `path-scurry`, `package-json-from-dist`, `sax`. Permissive. They're Node-side dependencies of latex.js (via `js-beautify` and `svgdom`) and mostly don't reach the browser bundle. |
| Apache-2.0 | 2 | **pdf.js** (`pdfjs-dist`) and `@swc/helpers`. Apache-2.0 is compatible with GPLv3 (not GPLv2). Its NOTICE requirement is met by the notices file. |
| BSD-3-Clause | 1 | `hypher`, latex.js's hyphenation engine. |
| 0BSD | 1 | `tslib`. |
| No license field | 3 | See below. |

license-checker also lists `frontend@0.1.0` as `UNLICENSED`. That's our own package: license-checker reports every `"private": true` package that way, whatever its `license` field says.

Packages with no license field, checked by hand (`LICENSE_OVERRIDES`):

- **`stdin`** (a latex.js CLI dependency): its `Readme.md` has the MIT License text.
- **`hyphenation.en-us`** and **`hyphenation.de`** (latex.js's hyphenation patterns, bundled into the compile worker): the npm packages by Bram Stein have no license field or file. They're converted from TeX's hyphenation patterns (the `hyph-utf8` / `tex-hyphen` collection), which are distributed under permissive terms (the German patterns under MIT; the US English patterns under a permissive "copy and distribute" notice). We list them as MIT. **To confirm:** the maintainer should check the upstream pattern headers if this ever matters. If one turned out not to be compatible, the fix is to stop shipping hyphenation (latex.js works without it).

Other things worth knowing:

- **KaTeX** (MIT) isn't in `node_modules`: latex.js bundles KaTeX 0.13.13 into `dist/latex.mjs`. The notices file adds it by hand.
- **latex.js's CSS and fonts** load from jsDelivr at run time (`LATEX_JS_ASSET_BASE` in `src/compile/latexJsAssets.ts`), so `dist/` doesn't include them. They're the Computer Modern Unicode fonts and the KaTeX fonts, under the **SIL Open Font License 1.1** (`latex.js/dist/fonts/OFL.txt`). The FSF lists the OFL as a free license that isn't GPL-compatible, which doesn't matter for fonts that are only used, not linked into the program. The OFL allows bundling the fonts with software, which the HTML export does when it inlines them into the exported file.
- **pdf.js** (Apache-2.0) ships its worker as `pdf.worker.min-*.js` from our own origin. Its standard fonts and CMaps aren't used.

### e2e dev dependencies (83 packages, not shipped)

MIT (64), Apache-2.0 (9: Playwright and a few utilities), ISC (6), BSD-3-Clause (1), `(MIT OR WTFPL)` (1), `(BSD-2-Clause OR MIT OR Apache-2.0)` (1), and **MPL-2.0** (1: `node-datachannel`, under `bittorrent-tracker`, which the sync test uses as a local tracker; license-checker shows it as "Custom" because its `package.json` says `MPL 2.0`).
None of them ship in the site. All allow use in tests.
