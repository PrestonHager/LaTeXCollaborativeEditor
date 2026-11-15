# Spike: a LaTeX language server in the browser

This is an internal design note for issue #195 (part of #71). It isn't published on the docs site (see `exclude_docs` in `mkdocs.yml`).
It records what a time-boxed spike found about running a real LaTeX language server in the browser, recommends whether to adopt one, and lists the follow-up issues.
It doesn't change production behaviour.

Written 2026-11-14 against `staging` at version 0.1.1, with the built-in sources from #192, #193 and #194 merged and #246, #247 and #248 in review (PRs #252, #256 and #258).

## Summary

- **Recommendation: keep the built-in completion sources, and don't adopt a language server now.**
  The built-in sources already cover what #71 asks of a language server: completion, project labels and citations, package-aware commands, diagnostics, go to definition, find references, rename, outline and hover. They're about 29 kB gzip, loaded lazily.
  The cheapest real language server is at least **7 MB gzip** before any code: TexLab embeds its completion database. It also needs a fork to run without threads, a file system or child processes.
- **TexLab (Rust):** possible, but it needs a fork. The patches are a message-pump main loop, no thread pool, and no file watcher, temp files, child processes or IPC socket. The embedded completion data alone is 6.97 MB gzip (24.2 MB raw).
- **Digestif (Lua) on wasmoon:** blocked as is. Digestif needs LPeg and LuaFileSystem, which are C modules, and wasmoon ships plain Lua 5.4 with neither. It would need a custom Emscripten build of Lua with LPeg linked in, or a pure-Lua LPeg port (LuLPeg), which is much slower. Wasmoon itself is small (111 kB gzip WASM plus 39 kB gzip JS), and Digestif's data is 593 kB gzip.
- **`@codemirror/lsp-client`:** a good fit if we ever do adopt a server. Its `Transport` is three string methods (`send`, `subscribe`, `unsubscribe`), so a worker's `postMessage` drops straight in. It's 16.6 kB gzip, plus `marked` (15.3 kB gzip) for Markdown hovers. It already has the completion, hover, diagnostics, go-to-definition, references and rename UI we built ourselves.
- **The most useful thing to take from TexLab is its data, not its server.** Its `completion.json.gz` covers 5,250 packages and classes (165,749 commands, 5,703 environments) under GPL-3.0, the same licence as this repo. Split per package and loaded on demand as static files, it would fill the "load the rest on demand" item in #71 without a server.

## What was checked, and how

The sandbox could clone repositories and install npm packages, and had Rust 1.97 with the `wasm32-wasip1` and `wasm32-unknown-unknown` targets.
It was not allowed to run third-party code: building the TexLab clone (its build scripts) and running wasmoon in Node were both refused.
So the sizes below are measured from the files, and the TexLab and Digestif findings come from reading their source.
Startup times weren't measured. That's the first follow-up, for somewhere that may run them (a maintainer's machine, or CI).

| Option | Version checked | Download (gzip) | Startup | Runs as is? |
|---|---|---|---|---|
| Built-in sources (this repo) | `staging` + #252/#256/#258 | **≈29 kB**: `latexCompletion` 17.4, `projectCompletion` 3.6, `latexPackageData` 3.3, `latexCompletionData` 3.1, `outline` 1.9 | Already measured by the bundle check; they load after first paint | Yes |
| TexLab → WASM | `e4cae29` (2026-11-07) | **≥ 6.97 MB** (embedded `completion.json.gz`) + code, not built | Not measured; it also has to gunzip and parse 24 MB of JSON at start | No: needs a fork (below) |
| Digestif on wasmoon | Digestif `452ba56`, wasmoon 1.16.0 | 111 kB WASM + 39 kB JS + 593 kB data + ~155 kB Lua source | Not measured | No: no LPeg or LFS in wasmoon |
| `@codemirror/lsp-client` | 6.3.0 | 16.6 kB + `marked` 15.3 kB (the other deps are already in the app) | n/a | Yes, client side |

`vscode-languageserver-protocol` is a dependency of `@codemirror/lsp-client`, but only its types are imported, so it adds nothing at runtime.

## TexLab

[TexLab](https://github.com/latex-lsp/texlab) is the most complete LaTeX language server, a Rust workspace of 24 crates (about 36,000 lines).
These are the parts that won't run in a browser, from the source at `e4cae29`:

- **Main loop.** `main.rs` starts with `lsp_server::Connection::stdio()`, which reads stdin and writes stdout on two threads, and joins them. In a worker it would use `Connection::memory()`, or a small loop driven by `postMessage`.
- **Thread pool.** `server.rs` builds a `threadpool::ThreadPool` and runs requests on it. `crossbeam-channel` carries messages between them. `wasm32-wasip1` has no threads. `wasm32-wasip1-threads` does, but needs `SharedArrayBuffer`, so cross-origin isolation (COOP and COEP headers). Production is on GitHub Pages, which can't set headers, so requests would have to run inline on one thread.
- **File system.** `base-db` watches the workspace with `notify` and `notify-debouncer-full`, and discovers dependencies by reading the disk (`deps/discover.rs`, `workspace.rs`). `distro` looks for a TeX distribution with `kpsewhich`. `tempfile` is used for builds. In the browser, every file would come in as an LSP `didOpen` or `didChange` from the Yjs project, with discovery and the distro turned off.
- **Child processes.** `commands/build.rs`, `fwd_search.rs` and `clean.rs` run `latexmk` and viewers. `diagnostics/chktex.rs` runs ChkTeX. `formatting/latexindent.rs` runs latexindent. All of these would be compiled out behind a feature flag.
- **IPC.** The `ipc` crate opens a local socket for inverse search. It would be compiled out.
- **Data.** `completion-data` does `include_bytes!("../data/completion.json.gz")`, which is 6,970,534 bytes. That's in the binary, so it sets the floor on the download. It could be moved out and fetched per package, which is a bigger change to the crate.

Estimate: a fork with a `browser` feature that does the above is about a week of work. It would have to follow upstream (weekly commits). The download stays in the megabytes even with the data split out, since the code includes `rowan`, `regex`, `serde_json`, `citeproc` and a BibTeX formatter.
What it would add over the built-in sources is a real LaTeX parser (fewer regex edge cases), BibTeX formatting, citation previews through citeproc, folding, and inlay hints.

## Digestif

[Digestif](https://github.com/astoff/digestif) (GPL-3.0, with some data files under their own licences, listed in its `LICENSE.md`) is about 5,500 lines of Lua with 22 tag files of data (2.7 MB raw, 593 kB gzip).

- Its rockspec needs `lpeg >= 1.0` and `luafilesystem >= 1.8`. The parser is built on LPeg (45 uses across the modules). `data.lua` and `Manuscript.lua` list directories with `lfs.dir`, and `config.lua` runs `kpsewhich` with `io.popen`.
- [wasmoon](https://github.com/ceifa/wasmoon) 1.16.0 ships Lua 5.4 alone. There's no LPeg in its `glue.wasm`, and there's no `io.popen`.
- So Digestif needs one of these:
  - A custom Emscripten build of Lua 5.4 with LPeg linked in. That means maintaining our own WASM build.
  - LuLPeg, a pure-Lua LPeg port, which is reported to be several times slower.
- It also needs `lfs` and `kpsewhich` stubbed out, with files fed in from the project.
- Once that's done, the download is small (about 0.9 MB gzip in all), but its coverage is narrower than TexLab's: 22 packages in the data, against TexLab's 5,250.

## Connecting a server to CodeMirror

If a server is ever adopted, `@codemirror/lsp-client` is the client to use:

- The worker side is `self.onmessage = (e) => server.handle(e.data)`, and the client side is a `Transport` whose `send` posts to the worker and whose `subscribe` adds a `message` listener. Nothing goes over the network, so the P2P-only rule holds.
- A custom `Workspace` subclass would map the Yjs project to LSP documents. It sends `didOpen` for every `.tex`, `.bib` and `.sty` file, and `didChange` on each Yjs update (local or from a peer), so the server sees the whole project, as the built-in index does now.
- It would replace our own `labelNavigation.ts`, `projectDiagnostics.ts` and the completion sources. The UI it brings (references panel, rename dialog, hover) uses `showDialog` and `showPanel`, so its sizes would need checking against `docs/ui-sizing.md`.
- Typing never waits on it: requests are async, and if the worker dies, completion just stops, as #71 requires.

## Why not now

- **Size.** The 225 kB initial budget isn't at risk either way, since a server would be a lazy worker. But 7 MB or more on first use, on every device, is 250 times what the built-in sources cost. They already answer #71's "done when" list.
- **Maintenance.** A TexLab fork, or a custom Lua build, is a second toolchain (Rust or Emscripten) in CI and in `docs/deployment.md`, with upstream to track.
- **Accuracy gap.** The regex-based index misses some things a real parser gets right: nested braces in keys, `\newcommand` bodies spread over lines, `\input` without braces, and `\include` paths relative to the including file. These are cheaper to fix in our parser than to replace it.

## Follow-up issues

1. **Measure wasmoon and LuLPeg startup** in a browser where running them is allowed: engine start time, and time to parse a 1,000-line document with LuLPeg. This would close the one gap in this spike. Low priority, since the recommendation doesn't depend on it.
2. **Package data from TexLab's `completion.json.gz`.** A build script splits it into one small JSON file per package under `public/` (static, same origin). `latexCompletion.ts` fetches a package's file the first time a project loads it, and keeps the 27 bundled packages and classes as the offline fallback. Check the licence: GPL-3.0, the same as this repo.
3. **Move the project index into a worker** if large projects make it slow. `ProjectIndex` is already pure and cached per file, so it can move as is. That is also the step that would make a later language server a drop-in.
4. **Tighten the built-in parser** for the gaps above: `\input` without braces, `\include` relative to the including file, multi-line definitions, and labels in `\newcommand` bodies used with literal arguments.
5. **Revisit a real server** (TexLab with a `browser` feature) only if (2) to (4) leave real gaps people hit. If so, the client is `@codemirror/lsp-client` over `postMessage`, as above.
