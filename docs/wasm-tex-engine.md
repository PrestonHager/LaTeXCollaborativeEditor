# Spike: a WASM TeX engine for "Compile PDF"

This is an internal design note for issue #198 (part of #43), and is not published on the docs site.
It records what a time-boxed spike found about running a real TeX engine in the browser,
recommends an approach, and lists the follow-up issues. It doesn't change production behaviour.

Written 2026-11-14 against `staging` at version 0.1.1.

## Summary

- **Keep LaTeX.js for the live preview, and add a separate "Compile PDF" action that runs a real
  TeX engine compiled to WebAssembly.** The preview stays instant and small. Compile PDF is the
  "what Overleaf would produce" answer, and it costs a large one-time download that the person opts into.
- **Engine: BusyTeX builds (TeX Live 2026), with the WASM and package files served as static
  files from our own origin.** BusyTeX is the only maintained line that has pdfTeX, XeTeX and
  LuaTeX together, and it is what the active projects (texlyre-busytex, Siglum) are built on.
  Keep our own thin worker glue, so we aren't tied to one wrapper's licence or package server.
  `@typeward/texlive-wasm` (MIT, about 1 to 5 MB per engine) is the one to watch, but it is pre-alpha.
- **Package files are only ever fetched from our own static host, never from a third-party
  TeX Live server.** They are cached with the Cache API, keyed by content hash. The document
  goes into the worker's in-memory filesystem and never leaves the browser.
- **The prototype could not be run in this spike's sandbox** (see [Prototype](#prototype)), so
  the timings here are published or third-party figures. The download sizes were measured. The
  first follow-up is to run the planned prototype somewhere that can download the engine assets.

## Why a real engine

The compatibility baseline (`docs/compatibility-baseline.md`) has 1 pass and 6 fails out of 7
Overleaf-style documents in the LaTeX.js preview. The failures are things LaTeX.js was never
meant to do: TikZ, beamer, custom classes, `fontspec`, biblatex with Biber, and real page breaking.
Adding more shims to the adapter makes the preview a better approximation, but no amount of it
reaches "the same PDF Overleaf makes". That needs TeX itself.

The two jobs pull in opposite directions:

| | Live preview (LaTeX.js) | Compile PDF (WASM TeX) |
|---|---|---|
| When it runs | On every edit, debounced | When the person asks |
| Speed | Tens of ms | Seconds for the first compile, then about 1 s |
| Download | In the app (lazy compile worker) | Tens to hundreds of MB, once, then cached |
| Output | HTML that reflows, follows the theme and zoom | The real PDF, paged |
| Coverage | The subset the adapter handles | Whatever the shipped TeX Live subset has |

Having both is also how the comparable editors do it (TeXlyre, Siglum and Overleaf's own
"Recompile" are all on-demand). The preview stays the default, and nothing about it changes.

## The engines compared

Status as of 2026-11-14. "Checked" means it was read from the npm registry, the package
tarball or the project's own page. The rest is from the project's README or third-party reports.

| | SwiftLaTeX | BusyTeX (upstream) | texlyre-busytex | Siglum (`@siglum/engine`) | `@typeward/texlive-wasm` | glyphtex-engine | texlive.js |
|---|---|---|---|---|---|---|---|
| Engines | pdfTeX, XeTeX (+ dvipdfm) | pdfTeX, XeTeX, LuaHBTeX, bibtex8, xdvipdfmx, makeindex | Same as BusyTeX, plus Biber as its own module | pdfTeX, XeTeX | pdfTeX, XeTeX, LuaHBTeX, bibtexu, Biber, xdvipdfmx, makeindex | XeTeX only (Tectonic), BibTeX | pdfTeX 1.40.11 |
| TeX Live | 2020 | 2026 build (README still says 2023) | 2026 | 2026 | 2026 (a hard fork) | Tectonic bundle | 2016 |
| Licence of the glue | AGPL-3.0 | MIT (scripts only; binaries keep TeX Live licences) | AGPL-3.0-or-later (checked) | MIT (checked) | MIT (checked) | MIT (checked) | GPL-2.0 (checked) |
| Maintenance | Last commit June 2024, last release Feb 2022 | Active (commits Aug to Nov 2026) | Active (1.4.1 on 2026-10-16; 16 versions since Jan 2026, checked) | Very active (0.2.2 on 2026-11-05, checked) | Pre-alpha (0.2.4-alpha, 2026-07-14, checked) | New (0.1.6, July 2026, checked) | Unmaintained |
| Engine download | Not published | Not published (native builds are 48 MB) | About 32 MB of WASM | Not published | 1.3 MB pdfTeX, 2.8 MB XeTeX, 4.8 MB LuaTeX (README) | 3.7 MB, 1.4 MB gzipped (measured) | 3.2 MB asm.js, 0.65 MB gzipped (measured) |
| Package files | One file at a time from texlive.swiftlatex.com, or a self-hosted Python server | Preloaded Emscripten `.data` bundles (basic, recommended, extra, science) | Same bundles, 90 to 400 MB, from GitHub Releases; optional on-demand server | Bundles from packages.siglum.org by default; on-demand needs their Bun proxy | A preloaded TDS tarball, then OPFS, then a CDN, all pinned by SHA-256 | One 16 MB bundle (13 MB gzipped, measured) plus 18 small package sets (9.7 MB in total) | 61 MB tree, one file at a time over sync XHR |
| Works from plain static files | No (needs its server) | Yes | Yes | Only with the bundled packages | Yes | Yes | Yes |
| COOP/COEP needed | No | Not documented | Not documented | Optional (faster lazy files with SharedArrayBuffer) | Not documented | No (README) | No |
| Verdict | Avoid: TL 2020, stale, needs a server | **Base to build on** | Good reference; AGPL | Good reference; its hosting model doesn't fit | Watch; adopt if it reaches beta | Fallback for a quick XeTeX-only demo | Avoid |

Notes:

- **Cold start isn't published by any of them.** The only number found is for Tectonic under a
  WASI runtime (not a browser): 1.36 s to start the engine cold and 51 ms with a compile cache
  (`mgilbir/tecgonic`). Expect the first Compile PDF to be dominated by the download, not the engine.
  Siglum documents a heap of about 512 MB during a compile, which phones may not have.
- **The 5 MB lazy-chunk ceiling in `scripts/check-bundle-size.mjs` doesn't fit any of these.**
  The WASM and package files must be static assets fetched at runtime, not JS chunks. The worker
  glue itself is small and can be a normal lazy chunk.
- **Other names that came up** but weren't checked: TeXbrain, StellarLatex, corca-ai/fastlatex,
  youfoundjk/texcore, `wasmtex`, `@arnon3339/thtex` (XeTeX, 76 MB npm package with the engine and
  a 14.5 MB TeX tree inside). `@lsd-cat/tstex` claims pdfLaTeX in pure TypeScript (GPL-3.0-or-later,
  November 2026); it's too new to judge, but it's worth a look in the follow-up benchmark.

## Licensing

The project is GPL-3.0-or-later.

- **pdfTeX** is GPL-2.0-or-later, so it can be distributed under GPL-3.0. **XeTeX** is MIT/X11.
  **LuaTeX** is GPL-2.0-or-later. The TeX Live package files carry their own free licences
  (mostly LPPL, plus GPL, public-domain and font licences). None of this conflicts with GPL-3.0-or-later.
- **MIT glue** (BusyTeX scripts, Siglum, typeward, glyphtex) is the cleanest to combine.
- **AGPL-3.0 glue** (texlyre-busytex, SwiftLaTeX) can be combined with a GPL-3.0 work (GPL-3.0 §13),
  but the AGPL part keeps its network-interaction terms. Our source is public, so this is easy to
  meet, but it is a decision for the maintainer, not a default. Writing our own glue avoids it.
- **Serving the engine binaries means we distribute them.** For the GPL parts (pdfTeX, LuaTeX,
  xdvipdfmx) we must offer the corresponding source: the exact BusyTeX commit, its TeX Live
  sources and the build script. The plan is to build the assets in CI from a pinned commit and
  link the source from the About dialog and from a notices file next to the assets.

## Where package files come from

The app is static, with no server of ours. Staging is on Coolify, and production moves from GitHub
Pages to Coolify too (issue #249, `docs/deployment.md`), which lifts the Pages limits below. The options:

1. **A third-party TeX Live server** (texlive.swiftlatex.com, packages.siglum.org, CTAN mirrors).
   Rejected. It is a server we don't control, CTAN mirrors don't send CORS headers, and each
   per-file request tells that server which packages the document uses. That isn't document
   content, but it's more than we should hand to someone else.
2. **Static bundles on our own origin.** Recommended. A CI job builds the WASM and a few
   package bundles from a pinned BusyTeX/TeX Live commit and publishes them under a versioned,
   content-hashed path (for example `tex/<hash>/pdftex.wasm` and `tex/<hash>/texlive-basic.data`).
   They fall under `connect-src 'self'` with no CSP change, and the files never change once
   published, so they cache well.
   On Coolify the bundles live in an S3 bucket (SeaweedFS) that the app's nginx proxies and caches under
   `/tex/` (issue #244, `docs/deployment.md`, "Compile PDF engine on S3 storage"), so they're
   still same-origin.
3. **Per-file lazy loading from our own origin** (a file index plus one request per `.sty`, like
   texlive.js or typeward's FetchFS). Good for a large tree without a large first download. It
   needs synchronous reads inside the engine, which means either `SharedArrayBuffer` with COOP/COEP
   (which would break the Google Drive picker and sign-in popups) or Asyncify, which makes the
   engine slower and larger. Keep it as a later step if bundles prove too big.

**Size limits to check before committing to GitHub Pages**: a published site is limited to about
1 GB and a single file to 100 MB, with a soft bandwidth limit. The "basic + recommended" bundles
fit; "extra" (up to about 400 MB) is a stretch and may need splitting by topic, the way
glyphtex splits its package sets. Coolify has no such limit. Pick the first bundle split from what
the corpus actually opens: running each corpus document under a native TeX Live with `-recorder`
lists every file it reads.

Only package files are ever downloaded. The project's own files are written into the worker's
in-memory filesystem from the open project, the same way the compile worker gets them today,
and nothing in this path sends them anywhere. That keeps the guardrails: document content stays
in the browser and on the peers, and rendezvous metadata is untouched.

## Caching

- **Cache API** for the WASM and bundles, in a cache named for the asset version (for example
  `tex-assets-v1`). Responses are stored as they came, so the browser's own decoding and
  `WebAssembly.compileStreaming` still work. Look entries up by the content-hashed URL. When the
  version changes, delete the old caches.
- **IndexedDB** only for small metadata (which bundles are installed, their sizes, when they were
  last used), next to the app's other stores. It's a poor fit for 100 MB blobs. Emscripten's
  `EM_PRELOAD_CACHE` already uses it, but that isn't something we can manage or clear.
- **OPFS** is the right place if we move to per-file lazy loading (typeward does this).
- Ask for `navigator.storage.persist()` the first time someone installs the engine, and show
  how much it takes, with a way to remove it, next to the existing storage settings. Safari evicts
  unpersisted storage after seven days without a visit.
- Keep a compiled `WebAssembly.Module` in memory for the tab's lifetime, and keep the worker
  alive between compiles, so the second compile skips instantiation.

## How it would fit in the app

- **A new lazy chunk, `texEngine.worker.ts`**, separate from the LaTeX.js compile worker. It
  loads only after the first Compile PDF, so the initial load (about 214.8 of 225 kB gzipped
  after #231) doesn't change. The command that starts it is a dynamic import.
- **CSP:** add `'wasm-unsafe-eval'` to `script-src` in `index.html`. Without it a page can't
  compile WebAssembly under our policy. Check whether a dedicated worker served from GitHub Pages
  (which sends no CSP header) needs it too, and add it to the desktop CSP in `desktop/`.
  Don't add COOP/COEP.
- **Output:** the PDF goes to the existing pdf.js renderer (`src/compile/pdfRender.ts`) and the
  Export menu. The TeX log is parsed into diagnostics in the existing lint format, mapped to file
  and line.
- **Engine choice:** pdfLaTeX by default; XeLaTeX or LuaLaTeX from a `% !TEX program = xelatex`
  magic comment or a project setting (the corpus marks each document's compiler the same way).
  Run BibTeX or Biber and rerun until the `.aux` files stop changing, capped at a few passes.
- **Collaboration:** each peer compiles on its own. PDFs aren't sent over P2P, and the protocol
  doesn't change. Sharing a compiled PDF with peers could come later as a separate question.
- **Desktop:** the Tauri shell can ship the assets inside the app, or later call a local TeX Live
  if one is installed. typeward already has a Tauri file system backend.
- **Mobile:** gate Compile PDF on available memory, and say so plainly on phones, where a 500 MB
  heap may fail.

## Prototype

The plan was a dev-only page (like `regression.html`, never built) that, behind a
`VITE_WASM_TEX_SPIKE=1` flag, loads an engine in a worker as a lazy chunk, compiles one corpus
document (`custom-class` or `article`) and reports the download size, instantiation time, first
compile and warm compile.

It wasn't practical in the spike's sandbox:

- The modern engines keep their WASM and data on GitHub Releases or their own hosts
  (texlyre-busytex, typeward, Siglum's packages.siglum.org), and the sandbox's network policy
  blocked all of them.
- texlive.js was reachable but its 2016 tree lacks `booktabs`, `xcolor` and the T1 fonts, so it
  can't compile any corpus document.
- glyphtex-engine was reachable (it ships everything inside the npm package), but installing and
  running a third-party engine was refused by the sandbox's permission policy.

So nothing is added to `frontend/` in this PR. The measured figures above are file sizes from
the published packages. The prototype is follow-up 1.

## Risks and costs

| Risk | Impact | Mitigation |
|---|---|---|
| First download is large (30 MB of engine plus 50 to 400 MB of packages) | Slow first compile, mobile data use | Opt-in, with the size shown first; content-hashed static files; Cache API with persistent storage; small bundles first |
| Hosting limits on GitHub Pages (site size, 100 MB files, bandwidth) | Can't ship the bigger bundles | Split bundles; measure what the corpus needs; staging on Coolify has no such limit |
| Memory (about 512 MB heap) | Crashes or a killed tab on phones | Check `deviceMemory`, catch out-of-memory, say so plainly |
| GPL source obligation for the binaries we serve | Licence compliance | Build in CI from pinned sources; publish a notices file and a source link |
| Upstream churn (all the live options are under a year old or pre-1.0) | Breakage, rework | Our own glue behind a small interface; pin exact versions; the corpus as a regression test |
| Engine output differs from Overleaf's (TeX Live year, missing packages, no shell escape, no `minted`) | People still see differences | State it in the docs; report missing files as diagnostics; track the corpus in a "Compile PDF" column |
| CSP needs `'wasm-unsafe-eval'` | A slightly wider script policy | It allows only WebAssembly compilation, not JS `eval` |
| Two renderers to maintain | Ongoing cost | The preview stays the approximation; Compile PDF is the reference, and the corpus compares the two |
| Maintenance cost of a CI asset build | CI time, storage | Build only when the pinned version changes; cache the output |

## Follow-up issues

1. **Prototype and benchmark the engines.** Run the planned dev-only page in an environment that
   can download the release assets. Compile the corpus with BusyTeX (pdfTeX and XeTeX), typeward
   and glyphtex in Chromium, Firefox and Safari. Record the download size, instantiation time,
   first and warm compile, and peak memory. Confirm the engine choice.
2. **Build and host the TeX assets.** A CI job builds the WASM and package bundles from a pinned
   BusyTeX/TeX Live commit, writes content-hashed files and a manifest, publishes them with the
   site (production and staging), and publishes the corresponding-source notice. Size the first
   bundle split from `-recorder` file lists for the corpus.
3. **Engine worker and asset cache.** `texEngine.worker.ts` as its own lazy chunk; Cache API
   storage keyed by content hash; `storage.persist()`; a way to see and remove the download;
   cleanup of old versions. Unit tests for the cache.
4. **CSP for WebAssembly.** Add `'wasm-unsafe-eval'` to the web and desktop CSPs, with the
   check in `src/security/csp` and `desktop/` `npm run check` updated.
5. **The Compile PDF command and view.** Menu, palette and shortcut; a first-run dialog with the
   download size; progress; the PDF in the pdf.js viewer; the TeX log as diagnostics; Export the
   PDF. Update the regression checklist and the user docs.
6. **Compiler selection and bibliographies.** The magic comment and a project setting for
   pdfLaTeX, XeLaTeX or LuaLaTeX; BibTeX and Biber passes; reruns.
7. **Corpus "Compile PDF" column.** Run the corpus through the engine in an e2e job and add the
   result to `docs/compatibility-baseline.md`.
8. **Desktop and mobile.** Ship or reuse the assets in the Tauri app; gate the feature on memory.
