
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
- [x] Preview sandbox: the rendered preview runs inside a sandboxed iframe (`allow-scripts` only, no `allow-same-origin`) to isolate execution, `javascript:`/`vbscript:`/`data:` links are stripped, and the LaTeX.js CDN styles and fonts still load.
- [ ] Projects: you can create a project, add files and folders, rename, move and delete them, and set the main file.
- [ ] Project images: an uploaded image used with `\includegraphics` shows up in the preview, and `\input` and `\bibliography` resolve against the file tree.
- [ ] Project sync: a second peer joining the room sees the full file tree and gets uploaded images over WebRTC, with progress, and files over 10 MB are refused.
- [ ] Export: the project can be downloaded as a .zip, and a .zip can be uploaded as a new project.
- [ ] Migration: documents saved before projects (local docs, a linked Drive file, and saved sessions) still open as one-file projects.
- [ ] Drive projects: a project saved to Google Drive shows up as a folder with the same file tree.
- [ ] Cloud integration: Google Drive Connect, autosave, and Save Now features work as expected.
- [ ] Local Drive testing: Drive connect and the Picker work on `http://localhost:5173` with development keys from `.env.development.local`.
- [ ] Storage errors: an expired Drive session, a blocked sign-in popup, or full browser storage shows a clear message and never overwrites the wrong file.
- [ ] Drive save errors: a full Drive shows "Google Drive is full" right away without retries, and a Drive rate limit gets retried.
- [ ] Drive token expiry: after the hour-long token runs out, autosave gets a new one silently, or shows a notice and switches to saving in the browser.
- [ ] Drive sign-out: File > Disconnect Google Drive revokes the token and switches saving to the browser without losing edits, and Settings shows who's signed in.
- [ ] Drive token storage: the token is only in `sessionStorage`, never in `localStorage`, and a reload in the same tab stays signed in.
- [ ] Renames: renaming a project or file never leaves a duplicate in Drive or in browser storage, and a failed save keeps what already made it.
- [x] Networking: no repository-owned signaling server is required for connection setup.
- [ ] Rendezvous: the app only contacts the trackers in `VITE_P2P_RENDEZVOUS` (or the defaults), and the console shows no relay errors on load.
- [ ] Privacy: Rendezvous metadata does not carry document payload content.
- [ ] Message validation: malformed or oversized peer messages, file chunks, and unsafe file paths are dropped, snapshots and metadata are only taken from the host, and only a few files transfer at once (see `docs/protocol.md`).
- [x] Accessibility: connections work on localhost and the production domain (e.g. https://latex.example.com).
- [x] Deployment: the app deploys successfully to GitHub Pages or the chosen static hosting.
- [x] Bundle size: `npm run build` reports the gzipped JS and CSS under the budget in `scripts/check-bundle-size.mjs`, or the PR explains why it went over.
- [ ] UI: menus, the command palette, and the settings dialog open above the editor and preview, work by keyboard, and look right in light and dark themes.

Verification guidance
- Prefer automated tests where possible; accompany with manual QA for session join, realtime sync, and preview rendering.
- Maintain a runbook for reproducible test scenarios (local, remote, and cross-browser).

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
- Bundle size: verified locally.
  `npm run build` reported 364.9 kB gzip out of the 400 kB budget.
- UI: failed.
  Menus, the command palette (Ctrl+P) and the settings dialog all open above the editor and preview, and the menus and palette work by keyboard.
  With the app theme on Light and the preview theme on Match system while the OS is dark, the preview turns dark but the LaTeX text stays black, so it's unreadable.
  With the app on Dark, the same preview setting shows a white page, so the dark preview never really applies.

Other things seen
- Leaving or reloading right after typing shows a "Leave site?" dialog, which is #31.
- Each compile with a project image asks the server for `/lcimg1` and gets a 404, before the image is swapped in as a data URL.
- The console fills with failed Nostr relay connections, which goes with #26.
