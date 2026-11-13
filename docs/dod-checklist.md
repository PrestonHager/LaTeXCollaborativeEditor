
# v1 Definition of Done

Overview
- This checklist defines the minimum criteria for a stable v1 release of the live, peer-to-peer LaTeX editor project. Each item should be checked off once verified in a test or demo environment.

Checklist
- [ ] Sharing and session bootstrap: a link that creates/joins the same room across two browsers works reliably.
- [x] Host reload: reloading the host tab after Share rejoins the same room, and New link starts a fresh one.
- [x] Host reload with guests: a guest still connected while the host reloads keeps syncing in both directions, and edits it made while the host was away reach the host.
- [x] Real-time collaboration: concurrent edits synchronize in both directions with acceptable latency.
- [ ] Editor readiness: the editor shows LaTeX syntax highlighting and line numbers.
- [x] Diagnostics: compile errors are parsed and highlighted inline on the correct editor lines.
- [x] Preview: edits trigger an updated, correctly typeset preview using LaTeX.js.
- [ ] Preview worker: the compile runs in a Web Worker, typing stays smooth on a big document, and a `picture` still renders (it compiles on the main thread).
- [x] Preview sandbox: the rendered preview runs inside a sandboxed iframe (`allow-scripts` only, no `allow-same-origin`) to isolate execution, `javascript:`/`vbscript:`/`data:` links are stripped, and the LaTeX.js CDN styles and fonts still load. In-page links scroll inside the frame; other links go to the app by `postMessage`, which checks the sender is the preview frame and opens only `http`/`https`/`mailto`, only with transient user activation (or at most one per 1.5 s without the API), with `noopener,noreferrer` (no `allow-popups`).
- [ ] Projects: you can create a project, add files and folders, rename, move and delete them, and set the main file.
- [ ] Project images: an uploaded image used with `\includegraphics` shows up in the preview, and `\input` and `\bibliography` resolve against the file tree.
- [ ] PDF and EPS figures: a PDF used with `\includegraphics` shows in the preview (page 1, or `page=`, with `trim`/`viewport`), drawn by pdf.js from the lazy `pdfRender-*.js` chunk with its worker `pdf.worker.min-*.js` served from our own origin (no CDN, no CSP violations). A project with no PDF or EPS file doesn't load either. An EPS figure shows a dashed box the size of its `%%BoundingBox` with "EPS can't be previewed; convert it to PDF.", and the ⓘ list says so.
- [ ] Project sync: a second peer joining the room sees the full file tree and gets uploaded images over WebRTC, with progress, and files over 10 MB are refused.
- [ ] Export: the project can be downloaded as a .zip (empty folders included), and a .zip can be uploaded as a new project.
- [ ] Export dialog: File > Export… lists the formats from the exporter registry (`frontend/src/export/registry.ts`) with progress and cancel. Project .zip, single file, flattened `.tex`, HTML (offline, with styles and fonts inlined), and a preview-quality PDF through the browser's print dialog all work in the browser with no server. The PDF prints from a hidden frame sandboxed with `allow-same-origin allow-modals` and no `allow-scripts`; the HTML export only fetches the LaTeX.js CDN assets. The **Save to** menu offers Download and Google Drive and remembers the choice in settings (`exportDestination`). Drive uploads go to the project's tagged `exports` folder (skipped when the project opens), the top of My Drive, or a folder picked with the Picker, with progress, readable errors and a link to the file. Drive shows as "(sign-in needed)", "(host only)" for guests, "(not set up)" with no Google keys, and "(not for PDF)" for the print-only PDF. `\newpage` and friends show as a dashed "page break" line in the preview and the HTML export, and the line is not printed.
- [ ] Templates: File > New Project opens the template picker (dialog-lg, a lazy chunk) with the built-in templates (Empty project, Blank article, Technical report, Letter, Beamer slides, Thesis), My templates in this browser, and My templates in Google Drive when connected. Placeholders (`{{name}}`, `{{affiliation}}`, `{{email}}`, `{{orcid}}`, `{{address}}`, `{{date}}`, `{{language}}`, `{{paper}}` and a template's own from `template.json`) are filled from the profile and escaped. File > Save as Template copies every file into a template in IndexedDB or the Drive `Templates` folder; Edit, Rename, Delete, Export .zip and Import .zip work. Each built-in template previews without errors, and compiles in a real TeX (pdfLaTeX, or LuaLaTeX, plus biber for the report and thesis). Offline before the picker loaded, New Project still offers an empty project.
- [ ] Profile: Edit > Profile… saves to settings and, with Drive connected, to `Templates/profile.json`; Clear profile removes both. The profile is never sent to peers; only the display name is.
- [ ] Migration: documents saved before projects (local docs, a linked Drive file, and saved sessions) still open as one-file projects.
- [ ] Drive projects: a project saved to Google Drive shows up as a folder with the same file tree.
- [ ] Cloud integration: Google Drive Connect, autosave, and Save Now features work as expected.
- [ ] Pause Saving: while paused, nothing is written by autosave or Save Now, the status says "Saving paused", leaving the page warns about unsaved edits, and resuming saves them.
- [ ] Leave and update: closing or reloading right after typing on a project saved in the browser doesn't ask "Leave site?" and keeps the edit; unsaved Drive edits, a failed save, a held conflict or files in flight do ask. A new deploy shows the update card, and Reload to update saves first and never triggers "Leave site?".
- [ ] Local Drive testing: Drive connect and the Picker work on `http://localhost:5173` with development keys from `.env.development.local`.
- [ ] Storage errors: an expired Drive session, a blocked sign-in popup, or full browser storage shows a clear message and never overwrites the wrong file.
- [ ] Drive save errors: a full Drive shows "Google Drive is full" right away without retries, and a Drive rate limit gets retried.
- [ ] Drive token expiry: after the hour-long token runs out, autosave gets a new one silently, or shows a notice and switches to saving in the browser.
- [ ] Drive sign-out: File > Disconnect Google Drive revokes the token and switches saving to the browser without losing edits, and Settings shows who's signed in.
- [ ] Settings: themes, layout, shortcuts and the tour flag live in one versioned `latex-editor.settings` key, apart from the session and the project. Older keys (`latex-editor.keybinds`, `latex-editor.tour-seen`, the themes in `latex_editor_app_session_v1`) move over once without losing anything. Guests keep their own settings, settings are never sent to peers, other open tabs follow a change, and Export, Import (validated) and Reset (all or one section) work. Blocked storage keeps settings for the tab only.
- [ ] Drive token storage: the token is only in `sessionStorage`, never in `localStorage`, and a reload in the same tab stays signed in.
- [ ] Renames: renaming a project or file never leaves a duplicate in Drive or in browser storage, and a failed save keeps what already made it.
- [ ] Drive add files: a file put in a project folder from drive.google.com (also in a subfolder made there) comes into the project at the same path with File > Add Files from Drive, and the next save doesn't write it back. Guests see the command turned off. A picked file that meets an unsaved project file of the same name goes through the conflict dialog, never a silent overwrite.
- [ ] Drive conflicts: a file changed in Drive since the last load or save is never overwritten silently. Saving pauses for that file only, and the conflict dialog's Keep mine, Take theirs, and Save mine as a copy each work.
- [x] Networking: no repository-owned signaling server is required for connection setup.
- [ ] Content Security Policy: on the production domain, the console shows no CSP violations while loading the app, compiling (LaTeX.js CSS, fonts and `base.js` from jsDelivr still load in the preview), signing in to Google, opening the Drive Picker, saving to Drive, and sharing a room through the trackers. `privacy.html` and `tos.html` keep their styling under their own tighter policy. `src/security/cspPolicy.test.ts` passes, and `VITE_DISABLE_CSP=1 npm run build` leaves every CSP tag out of `dist/`.
- [ ] TURN credentials: `docs/deployment.md` says the TURN credentials in the bundle are public, and any TURN server in use has short-lived or origin-restricted credentials and a usage cap.
- [ ] Rendezvous: the app only contacts the trackers in `VITE_P2P_RENDEZVOUS` (or the defaults), and the console shows no relay errors on load.
- [ ] Privacy: Rendezvous metadata does not carry document payload content.
- [ ] Message validation: malformed or oversized peer messages, file chunks, and unsafe file paths are dropped, snapshots and metadata are only taken from the host, and only a few files transfer at once (see `docs/protocol.md`).
- [x] Accessibility: connections work on localhost and the production domain (e.g. https://latex.example.com).
- [x] Deployment: the app deploys successfully to GitHub Pages or the chosen static hosting.
- [ ] Staging and releases: every push to `main` deploys to the staging site on its own origin (or the Deploy staging run says it was skipped because staging isn't set up), the staging site shows the Staging badge and has `noindex`, and its peers never meet production's. Production only changes from a `vX.Y.Z` release: Prepare release opens a release PR, merging it tags the merge commit, and the Release workflow tests it, deploys it to Pages and makes the GitHub release (see `docs/deployment.md` and `docs/versioning.md`).
- [ ] Legal pages: `npm run build` passes its page check, and the Privacy and ToS links in the footer and About dialog open `privacy.html` and `tos.html` on the deployed site, not a 404.
- [ ] Installing: `npm run build` passes its manifest check, Chrome or Edge offers to install the app (DevTools > Application > Manifest shows no errors), and in the installed window Ctrl+N opens New file. In a normal tab the menus show Alt+N instead.
- [ ] Versioning: the About dialog and footer show the version and commit, the bug form prefills `App version: X.Y.Z+sha`, `npm run build` fails without a valid `dist/version.json`, peers exchange `hello` with their versions (an older peer without it still syncs), and a `vX.Y.Z` release makes a GitHub release from `CHANGELOG.md` and deploys that tag to production (see `docs/versioning.md`).
- [ ] Changelog: Help > About > View changelog shows `CHANGELOG.md` newest first with the running version marked, `dist/CHANGELOG.md` ships (the page check fails without it), and the update prompt's What's new shows the new deploy's changelog with "New in the update" on newer sections, or the bundled one plus a GitHub link if it can't be fetched.
- [ ] Presence: two tabs in a room each show the other's avatar next to Share (tooltip with name and file), a dot on that file, and a named caret in the editor; the e2e-sync jobs check this in chromium, firefox and webkit. Presence messages are rate-limited, size-capped and checked field by field (see "Presence (awareness)" in `docs/protocol.md`), a peer's presence clears when it leaves or after 30 s of silence, and a tab on a build from before presence still syncs with one that has it. Only the display name, colour, a random presence id with the time you started sharing, the open file id and cursor are sent. A peer keeps its colour across a reload, two peers in a room never share a colour (up to eight), and a remote caret's name label on line 1 shows below the caret instead of being clipped.
- [ ] Trystero 0.26: Share shows a `?room=` link with no console errors, two tabs on the same build sync text and an uploaded image (the e2e-sync jobs), and after a deploy a tab still on the Trystero 0.24 build (protocol 1) gets the update prompt and syncs again once reloaded.
- [x] Bundle size: `npm run build` passes the bundle check in `scripts/check-bundle-size.mjs`: the initial load (index.html, entry JS and CSS) is under the 225 kB gzip budget, no lazy chunk is over 5 MB, and no lazy chunk is in the initial load. Lazy chunks over 1 MB are explained in the PR.
- [x] Load time: `npm run test:load-time` shows the editor interactive in under a second at 10 Mbps with a 50 ms round trip.
- [ ] Docs: every menu item, dialog, shortcut, palette command, and status message has a docs section, and `mkdocs build --strict` passes.
- [ ] Docs diagrams: the UI map, user flows, and state diagrams in `how-it-fits.md` and the sequence diagrams in `protocol.md` render and match the code.
- [ ] Screenshots: `npm run screenshots` regenerates every docs screenshot, in light and dark, with one command.
- [ ] UI: menus, the command palette, and the settings dialog open above the editor and preview, work by keyboard, and look right in light and dark themes.
- [ ] Help: Help has docs, shortcuts, bug report, private security report, feature request, tour, and About; `?` links and error notices open the right docs section; the bug form only prefills browser, OS, and app version; and the first-run tour shows once, can be skipped, and reopens from Help.

- [ ] Security policy: `SECURITY.md` shows on the repo's Security tab, private vulnerability reporting is on, and the issue forms, Help menu, and docs all send security reports to the private form. Dependabot alerts and secret scanning with push protection are on.

Verification guidance
- Prefer automated tests where possible; accompany with manual QA for session join, realtime sync, and preview rendering.
- `npm run test:e2e` runs a Playwright test in `e2e/` that opens a host and a guest in two browser contexts, shares a room, and checks the file tree, an uploaded image, and edits in both directions. It runs in Chromium, Firefox and WebKit, plus a Chromium host with a Firefox guest, as one CI job per browser. It goes through public relays, so those jobs are non-blocking.
- Maintain a runbook for reproducible test scenarios (local, remote, and cross-browser) in `docs/qa-runbook.md`.

## Verification log

Run on 2026-11-09 for issue #19.
Production (https://latex.prestonhager.com/) was on commit `5cf418c` (the merge of #50), deployed by Pages run 42647772880.
The local build was the same commit, served with `npm run preview -- --port 4185 --strictPort`.
Both were tested in the desktop app's built-in browser (Chromium), with two tabs in the same room.
Nobody signed in to Google, so every Drive item still needs the owner.
A box above is only checked when it was actually seen working.

- Sharing and session bootstrap: partly verified.
  Share made a room link, and a second tab opened from it connected and got the document, on production and on the local build.
  Both tabs were in one browser, so two separate browsers or machines still need the owner.
- Host reload: verified on production.
  After Share, reloading the host tab came back with the same room link and reconnected.
  New link gave a different room id.
- Host reload with guests: verified on production.
  The guest typed while the host tab was reloading, and that text showed up on the host after it came back.
  Host edits after the reload reached the guest.
- Real-time collaboration: verified on production and locally.
  Edits from host to guest and guest to host showed up within about two seconds.
- Editor readiness: failed.
  Line numbers show, but there's no syntax highlighting on production or locally.
  `frontend/src/ui/editor.ts` adds the `stex` language but no `syntaxHighlighting(...)` style, so CodeMirror never colors the tokens.
- Diagnostics: verified on production.
  `\foo{` on line 4 put an error marker on line 4 and the footer said `unknown macro: \foo (main.tex line 4)`.
- Preview: verified on production and locally.
  Bold text and math typeset in the preview a moment after typing.
- Preview sandbox: verified on production.
  The iframe has `sandbox="allow-scripts"` only.
  `\href` to `javascript:` and `data:` came out as `<a>` with no `href`, and an `https:` link kept its `href`.
  KaTeX math and the LaTeX.js fonts rendered, so the CDN styles loaded.
- Projects: partly verified on production.
  New file and New folder worked.
  Rename, move, delete and set main weren't tried, since they go through `prompt()` and `confirm()` dialogs (see #20).
- Project images: partly verified on production.
  An uploaded PNG used with `\includegraphics` showed in the preview, and `\input{chapter}` pulled in `chapter.tex`.
  `\bibliography` wasn't tried.
- Project sync: partly verified on production.
  The guest saw the new file, folder and image, and the image showed in the guest's preview.
  An 11 MB file was left out of the upload.
  The image was too small to see a progress bar.
- Export: needs the owner.
  Downloading a .zip wasn't tried here. `zip.test.ts` and `projectIo.test.ts` cover the code.
- Export dialog: partly verified with Playwright against `vite preview` (Chromium).
  A project with an empty folder, `\input` and `\newpage` exported to `.zip`, and uploading that zip gave the same files and folders; exporting again gave an identical zip.
  Flattened `.tex` had the chapter in place and comments removed. HTML with Work offline inlined the styles and fonts (the CDN was served from `node_modules` in the test, since the sandbox blocks it).
  The PDF's print document rendered to two A4 pages, split at the `\newpage`. The real print dialog and Save as PDF weren't driven, since headless Chromium has none.
- Export to Google Drive: needs the owner. Real Drive can't be reached from the test sandbox.
  `driveUpload.test.ts` and `destinations.test.ts` cover the upload, the exports folder, the Picker folder and the error messages with a fake Drive and a fake `XMLHttpRequest`.
  In Playwright (Chromium, a build with placeholder Google keys), the Save to menu showed "(sign-in needed)", "(not for PDF)" with PDF picked, and "(host only)" for a guest; the choice survived a reload; Export with Drive and Google blocked showed the sign-in message and exported nothing; Download of HTML had the dashed "page break" line on screen, and printing it gave two pages with no line.
- Templates: partly verified with Playwright against `vite preview` (Chromium, light and dark, 1280x800 and 390x844, LaTeX.js served from `node_modules`).
  Each built-in template was created from the picker with a test profile and previewed with no errors (the ⓘ list shows what the preview approximated). Save as Template turned the profile name into `{{name}}`, and the saved template showed in My templates and filled the name back in.
  `templateLibrary.test.ts`, `templatesUi.test.ts`, `driveTemplates.test.ts` and `placeholders.test.ts` cover saving, loading, zip export and import, escaping, the Drive folder layout and profile sync with a fake Drive.
  Needs the owner: compiling each built-in template once with pdfLaTeX or LuaLaTeX (TeX isn't available in the sandbox), and the real Drive `Templates` folder and `profile.json`.
- Migration: needs the owner.
  It needs real data saved by an older version.
- Drive projects: needs the owner (Google sign-in).
- Cloud integration: needs the owner (Google sign-in).
  The production bundle has a Google client id.
  It had no `VITE_GOOGLE_APP_ID`, since the Pages workflow didn't pass it until this change.
  The `VITE_GOOGLE_APP_ID` repo variable is set to `latex-collaborative-edit`, which looks like a project id.
  The Picker wants the numeric project number, so check that value.
- Local Drive testing: needs the owner (dev keys and a Google sign-in on port 5173).
- Storage errors: needs the owner (Google sign-in, and filling browser storage).
- Drive token expiry: needs the owner (an hour-long Drive session).
- Renames: needs the owner (Google sign-in for the Drive half).
- Drive add files: needs the owner (Google sign-in and the real Picker). `driveAddFiles.test.ts`, `googlePicker.test.ts`, and `googleDrive.test.ts` cover it with fakes.
- Networking: verified on production.
  Peers found each other through public Nostr relays used by Trystero, with no server from this repo.
  The configured WebTorrent trackers aren't the ones being used, which is #26.
- Privacy: not verified.
  The relay traffic wasn't inspected.
  In the code, document text and files only go over the WebRTC data channel, and the relays only carry Trystero's connection setup.
- Accessibility: verified.
  Two tabs connected on `http://localhost:4185` (local build) and on `https://latex.prestonhager.com`.
  The dev server on 5173 wasn't tried.
- Deployment: verified.
  The last three Pages runs passed, the latest on `5cf418c`, and the custom domain serves over HTTPS with a valid certificate.
  `/docs/` returns the MkDocs site.
- Bundle size: verified locally after the initial-load trim, which lowered the budget from 250 kB to 225 kB.
  `npm run build` reported an initial load of 208.6 kB gzip, down from 241.8 kB (index.html 9.8 kB, entry JS 180.7 kB, CSS 15.7 kB, shared helpers 2.4 kB).
  The biggest lazy chunks are the compile worker (191.4 kB gzip) and the P2P transport with Trystero (22.6 kB gzip), which loads on the first join or when the pointer reaches Share.
- Load time: verified locally with `npm run test:load-time`.
  At 10 Mbps and a 50 ms round trip the editor was interactive in a median of 480 ms after the trim, against 576 ms for the same machine before it (986 ms against 1161 ms with 4x CPU slowdown).
- UI: failed.
  Menus, the command palette (Ctrl+P) and the settings dialog all open above the editor and preview, and the menus and palette work by keyboard.
  With the app theme on Light and the preview theme on Match system while the OS is dark, the preview turns dark but the LaTeX text stays black, so it's unreadable.
  With the app on Dark, the same preview setting shows a white page, so the dark preview never really applies.

Other things seen
- Leaving or reloading right after typing shows a "Leave site?" dialog, which is #31. (Since #121 it only shows when something could be lost.)
- Each compile with a project image asks the server for `/lcimg1` and gets a 404, before the image is swapped in as a data URL.
- The console fills with failed Nostr relay connections, which goes with #26.
