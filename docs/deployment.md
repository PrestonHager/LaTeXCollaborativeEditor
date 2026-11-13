
# Deployment

Frontend deployment (GitHub Pages)
- Configure the repository Pages source to trigger via GitHub Actions.
- Set Actions secrets/variables as needed for runtime configuration, for example:
  - `VITE_P2P_APP_ID`
  - `VITE_P2P_RENDEZVOUS` (comma-separated WebTorrent tracker URLs, see below)
  - `VITE_STUN_URL`
  - `VITE_TURN_URL` (optional)
  - `VITE_TURN_USERNAME` (optional)
  - `VITE_TURN_CREDENTIAL` (optional; public once built, see "TURN credentials are public" below)
  - `VITE_GOOGLE_CLIENT_ID`
  - `VITE_GOOGLE_API_KEY`
  - `VITE_GOOGLE_APP_ID` (Google Cloud project number; needed so the Picker grants `drive.file` access to files the app didn't create)
  - `VITE_DOCS_BASE_URL` (optional; leave it unset to use the same-origin `docs/` path)
  - `VITE_DISABLE_CSP` (optional; `1` ships without the Content Security Policy, see "Turning the CSP off" below)
- The Pages workflow reads `VITE_GOOGLE_CLIENT_ID` and `VITE_GOOGLE_API_KEY` from secrets, and `VITE_P2P_APP_ID`, `VITE_STUN_URL`, `VITE_GOOGLE_APP_ID`, `VITE_DOCS_BASE_URL` and `VITE_DISABLE_CSP` from variables (repository or **Production** environment).
  The rendezvous and TURN values aren't passed to the build yet, so production uses the defaults in `bootstrapConfig.ts`.
- The frontend bundle is pure TypeScript/Vite (no Rust wasm); LaTeX preview uses LaTeX.js in the browser.
- The UI is Basecoat (shadcn-style components for plain HTML) on Tailwind CSS v4, with Lucide icons. Tailwind runs as a Vite plugin, so there's no extra build step.
- The app shell (menus, dialogs, command palette) is Basecoat markup in `frontend/index.html`. The TypeScript under `frontend/src/ui/` only attaches behavior to it.
- Vite builds every page in `BUILD_PAGES` in `frontend/vite.config.ts`: `index.html`, `privacy.html` and `tos.html`. A new top-level HTML page that should ship has to be added there, or it won't reach `dist/`. `regression.html` is dev-only and stays off the list.
- After `vite build`, `npm run build` runs `scripts/check-build-pages.mjs`. It fails the build if `dist/` is missing a page from that list or has `regression.html` or a `dev/` folder.
- The build bakes in the version from `frontend/package.json`, the short commit SHA (`git rev-parse --short HEAD`, else `$GITHUB_SHA`, else `dev`) and the build time, and writes them to `dist/version.json`.
  The page check fails the build if `version.json` is missing, malformed, or doesn't match `package.json`.
- The build also copies the repo-root `CHANGELOG.md` to `dist/CHANGELOG.md` (`changelogFilePlugin` in `scripts/build-info.mjs`), read from the root file each build, so there's no second copy in the repo. The page check fails the build if it's missing.
  The update prompt's **What's new** fetches it next to `index.html` with a cache-busting query and `cache: 'no-store'`, so an open tab can show what the new deploy changed. CSP `connect-src 'self'` already covers it. A host that doesn't serve it only loses that: the dialog falls back to the changelog bundled in the running build and links to the latest on GitHub.
  The Pages workflow's checkout has the git history it needs, so no extra setup is needed. See `docs/versioning.md`.
- `npm run build` ends with a bundle size check (`scripts/check-bundle-size.mjs`). It splits the build in two:
  - **Initial load**: `index.html` plus everything it loads before the editor is usable (the entry script, its static imports and modulepreloads, and the linked CSS).
    The script finds these from `dist/index.html` and the Vite manifest (`dist/.vite/manifest.json`, turned on with `build.manifest` in `vite.config.ts`).
    The budget is **250 kB gzipped**, and going over it fails the build.
  - **Lazy chunks**: dynamic imports and workers, like `compile.worker-*.js`. They load on demand and in parallel from the GitHub Pages CDN, so there's no total cap.
    Each one warns above 1 MB gzipped and fails the build above 5 MB.
    The build also fails if a lazy chunk ended up in the initial load, either because a module that's imported dynamically is also imported statically, or because initial code statically imports a chunk outside the initial graph.
  - Where 250 kB comes from: the goal is an editor you can type in within a few hundred milliseconds.
    Assume 10 Mbps (typical broadband or fast 4G, about 1.25 MB/s) and about 300 ms in total.
    Take off about 100 ms for latency and for parsing and running the script, which leaves about 200 ms of transfer, or 250 kB at 1.25 MB/s.
    GitHub Pages serves gzip, so gzip size is what goes over the wire.
  - The check prints each file with an estimated load time at 10 Mbps and a 50 ms round trip. In CI, warnings and errors show up as annotations on the run.
  - To measure real time to interactive on a throttled connection, run `npm run test:load-time` from the repo root (see `docs/qa-runbook.md`). The build doesn't run it.
- We only pull in the Basecoat components we use. `src/styles/basecoat-vega.css` is generated from Basecoat's Vega style. When you start using a new component, add it to `COMPONENTS` in `scripts/basecoat-subset.mjs` and the imports in `src/style.css`, then run `npm run basecoat:subset`. A test fails if the generated file is out of date.
- Push to main; the CI workflow builds the Vite app into `frontend/dist`, runs MkDocs into `frontend/dist/docs`, and deploys that folder as the Pages artifact.
- Documentation is served at **`/docs/`** (for example `https://latex.prestonhager.com/docs/` when using a custom domain, or `https://<owner>.github.io/<repo>/docs/` on the default GitHub Pages host).
- **MkDocs `site_url`:** `mkdocs.yml` uses a plain string (for local `mkdocs serve`). In CI, **`DOCS_SITE_URL`** (repository or **Production** environment) is resolved and **`scripts/set_mkdocs_site_url.py`** rewrites `site_url` before `mkdocs build`. Use the full public docs URL including path and trailing slash (e.g. `https://latex.prestonhager.com/docs/`). If unset, CI falls back to the default `github.io` project URL under `/docs/`. Align with the Pages site URL after deploy (`environment.url` is the **site root**; MkDocs needs the **docs** subtree URL).

Local development
- The dev server always runs on `http://localhost:5173`. It won't pick another port if that one is taken, since Google OAuth only allows exact origins.
- Use a separate Google Cloud project (or at least a separate OAuth client and API key) for development.
- In that project, add `http://localhost:5173` to the OAuth client's Authorized JavaScript origins. If the API key has website restrictions, allow `http://localhost:5173/*` too.
- Copy `frontend/.env.development.example` to `frontend/.env.development.local` and fill in the dev keys. Vite loads it only for `npm run dev`, and it overrides `frontend/.env`.
- `.local` env files are gitignored, so the dev keys stay out of the repo.
- Never put a client secret in any env file. Anything starting with `VITE_` can end up in the browser bundle.
- In VS Code, the **Dev server + Chrome** or **Dev server + Edge** launch configs start Vite and open a debug browser once it's ready. **Debug current test file** runs Vitest on the open file with breakpoints.

Runtime architecture (summary)
- There is no custom signaling server in this repository.
- Peers discover each other via configured public rendezvous endpoints.
- Signaling uses Trystero's torrent strategy (`@trystero-p2p/torrent`, 0.26), so the rendezvous endpoints are WebTorrent trackers, not Nostr relays.
- Trystero's wire format changed in 0.25, so a deploy that moves between Trystero 0.24 and 0.26 (P2P protocol 1 to 2) splits open sessions: tabs on the old build and on the new one find each other but can't sync. The update prompt polls `version.json` and asks open tabs to reload, and once everyone has reloaded they sync again. Mention it in the changelog for any Trystero bump that changes the wire format.
- `VITE_P2P_RENDEZVOUS` is the full tracker list, and Trystero only connects to those.
  If it's unset, the app uses `wss://tracker.webtorrent.dev`, `wss://tracker.openwebtorrent.com`, and `wss://tracker.files.fm:7073/announce`.
- Public trackers come and go. If the console shows `torrent tracker failure` for one, drop it from the list.
- Document content remains peer-to-peer after joining a room.
- Every peer checks the messages it gets and drops bad ones, since anyone with the room link can join. The limits are in `docs/protocol.md`. Nothing about this needs a server or any config.
- LaTeX preview runs in the browser via LaTeX.js inside a sandboxed iframe; assets may be loaded from a CDN.
- The compile runs in a module worker, built to its own `dist/assets/compile.worker-*.js` file.
  It's a plain static file, so static hosting still works. It's a lazy chunk, so it has the per-chunk limit but doesn't count toward the initial-load budget.
- Google Drive access tokens last about an hour. The app asks Google Identity Services for a new one (`prompt: ''`, no consent screen) when it runs out. If that fails, it shows a notice and saves to browser storage until you reconnect Drive.
- The Drive access token is kept in `sessionStorage` (`drive_session_token`), so it lasts for one tab and survives a reload, but not a new tab.
  Older builds kept it in `localStorage` as `drive_access_token`; the app deletes that key on load.
- **File > Disconnect Google Drive** calls `google.accounts.oauth2.revoke` and clears the token.
- The signed-in email comes from the Drive `about` endpoint, which works with the `drive.file` scope, so no extra scope is needed.
- Pause Saving stops autosave and Save Now for the host. It's stored in the browser session under the old `saveNowEnabled` key (false means paused), so older saved sessions still load.
- A project in Drive is a folder, tagged with an `appProperties` flag so the app can list its projects.
  Each project file is a real Drive file inside it, with subfolders kept as they are.
- The app still only asks for the `drive.file` scope. That's enough for every file and folder the app makes.
  It is not enough for files someone adds to a project folder from Drive itself.
  Picking a folder in the Picker only grants the folder, not the files already in it, so those files stay hidden until they're picked.
  **File > Add Files from Drive** opens the Picker on the project folder (`DocsView.setParent`) with multi-select on and folders selectable.
  After the pick it lists the folder again and adds the new files at their Drive paths, so it needs `VITE_GOOGLE_API_KEY` and `VITE_GOOGLE_APP_ID` like the other Picker commands.
  We kept `drive.file` instead of asking for full Drive access, which needs a Google security review.
- An old single `.tex` file from before projects opens as a one-file project and keeps saving to that file.
  When you add a second file, the app makes a project folder next to it and moves the file in.
- Drive errors are sorted by Google's error `reason`, not the message text.
  `rateLimitExceeded`, `userRateLimitExceeded`, `backendError`, HTTP 429 and 5xx get retried.
  `storageQuotaExceeded` (a full Drive) and other 403s don't.
- A Drive save writes files before it renames the project folder, so a failed upload never leaves a renamed folder behind.
- Before overwriting a Drive file, the app makes one `files.get` call for its `version` and `md5Checksum` and compares them with what it saw last.
  A changed checksum stops the save for that file and asks the user what to keep.
  No extra scopes or settings are needed for this.
- Local projects live in IndexedDB (the `latex-editor` database). Old documents in localStorage get moved into one-file projects the first time the app starts.

Networking (STUN/TURN)
- Start with a public STUN server such as `stun:stun.l.google.com:19302`.
- Add TURN as needed for restrictive NAT environments.

TURN credentials are public
- `VITE_TURN_USERNAME` and `VITE_TURN_CREDENTIAL` are built into the JavaScript bundle, like every `VITE_` value.
  The app is static, so there's nowhere to hide them: anyone can open the site, read them, and relay their own traffic through your TURN server on your bill.
  Treat them as public, not as secrets. Keeping them in GitHub secrets only keeps them out of the repo, not out of the bundle.
- Don't put long-lived TURN credentials (a coturn `static-auth-secret` user, or a provider's account password) in these variables.
- Use short-lived credentials instead:
  - A hosted TURN service that issues time-limited credentials (Cloudflare, Twilio, Metered and Xirsys all do). Prefer one that can also limit use to the site's origin or cap usage.
  - Or coturn's TURN REST API (`use-auth-secret`), where the username carries an expiry time. Without a server of our own, that means building with a credential that expires, and rebuilding and redeploying before it does.
- Rotate the credential on a schedule and right away if usage spikes. Rotating means updating the variables and redeploying, since the old bundle keeps the old values.
- Set a bandwidth or quota limit on the TURN account, so abuse costs a capped amount.
- A fetch-at-runtime credential endpoint would fix this properly, but it needs a server, which this repository deliberately doesn't have.
- `SECURITY.md` lists this as a known issue ([#24](https://github.com/PrestonHager/LaTeXCollaborativeEditor/issues/24)), so reports of it are out of scope.

Content Security Policy
- `frontend/index.html` sets a Content-Security-Policy in a `<meta http-equiv>` tag, since GitHub Pages can't send response headers.
  It only allows the app itself, LaTeX.js on jsDelivr (pinned to `latex.js@0.12.6`), Google sign-in, the Picker and the Drive API, and the WebTorrent trackers.
  `src/security/cspPolicy.test.ts` fails if a URL in `src/` isn't allowed, so a new CDN, API or tracker needs a matching change to the policy.
  It also fails on any host in the policy that isn't used in `src/` or listed in `GOOGLE_RUNTIME_SOURCES` there.
- Google's scripts load more at runtime than our code names, so these are allowed up front (`GOOGLE_RUNTIME_SOURCES`): `www.gstatic.com` and `ssl.gstatic.com` for scripts and styles, `*.gstatic.com` and `*.googleusercontent.com` for images, `drive.google.com` and `content.googleapis.com` for frames, and `content.googleapis.com` for connections.
- `privacy.html` and `tos.html` have their own much tighter policy (`default-src 'none'`, only the inline body style and the favicon), since they're static.
- The sandboxed preview iframe uses `srcdoc`, so it inherits the same policy. That's why `style-src` has `'unsafe-inline'` (our theme and KaTeX font `<style>` tags, and LaTeX.js's `style` attributes), `img-src` has `data:` (project images), and `base-uri` allows the LaTeX.js CDN path (its `<base>` tag).
  `script-src` has no `'unsafe-inline'` or `'unsafe-eval'`, so a peer's document can't run inline script in the preview, and an injected `<img>` to another host is blocked, so it can't ping a tracker either.
  The one inline script we add to the preview, `PREVIEW_LINK_SCRIPT` in `src/ui/preview.ts`, is allowed by its `sha256-` hash in `script-src`. It's a fixed string (the scroll position goes in a `data-scroll` attribute), so if you edit it, `cspPolicy.test.ts` fails and prints the new hash to put in `index.html`.
- `frame-src` and `img-src` allow `blob:` for the PDF and image viewer, and `object-src` allows `blob:` too, because Chrome's PDF viewer in that iframe counts as a plugin.
- `connect-src` lists the default trackers. If `VITE_P2P_RENDEZVOUS` lists others, the `csp` plugin in `vite.config.ts` adds their origins at build time.
  STUN and TURN aren't covered by CSP, so `VITE_STUN_URL` and `VITE_TURN_URL` need no change.
- A meta tag can't set `frame-ancestors`, `report-uri`/`report-to` or `sandbox`; browsers ignore them there.
  So the CSP doesn't stop other sites from framing the app (clickjacking), and GitHub Pages can't send `X-Frame-Options` either.
  If the site moves behind a host or proxy that can set headers (Cloudflare, Netlify, a custom server), send the same policy as a header and add `frame-ancestors 'none'`.
- `upgrade-insecure-requests` is left out on purpose: it would break `npm run dev` and `vite preview` on `http://localhost`.
- After changing the policy, check the browser console on the live site for "violates the following Content Security Policy directive" while signing in to Google, opening the Picker, sharing a room and compiling.

Turning the CSP off (rollback)
- If the CSP breaks something in production, set the repository (or **Production** environment) variable `VITE_DISABLE_CSP` to `1` and rerun the Pages workflow.
  The `csp` plugin in `vite.config.ts` then leaves the CSP meta tag out of every page. Nothing else changes. Locally, `VITE_DISABLE_CSP=1 npm run build` does the same.
- Then find what was blocked, with the CSP still on (`npm run dev`, `npm run preview`, or the live site before the rollback):
  1. Open DevTools > Console and do the thing that broke (for example sign in to Google or open the Picker).
  2. Look for errors like `Loading the script 'https://host/path' violates the following Content Security Policy directive: "script-src ..."`. The URL is what was blocked, and the directive name (`script-src`, `connect-src`, `frame-src`, `img-src`, `style-src`, `font-src`) is where it goes.
     The **Issues** tab groups the same reports under "Content Security Policy".
  3. Add that origin (`https://host`, or a path prefix ending in `/` if only one path is needed) to that directive in `frontend/index.html`. Don't add whole schemes like `https:` or `*`.
  4. If no URL in `src/` names it (a host Google loads by itself), add it to `GOOGLE_RUNTIME_SOURCES` in `src/security/cspPolicy.test.ts` too, then run `npm run test:run`.
- After the fix is deployed, delete `VITE_DISABLE_CSP` (or set it to anything but `1`) and rerun the workflow to turn the CSP back on.

Domain and security
- The domain (e.g., latex.prestonhager.com) must be served over HTTPS to enable P2P APIs.
- `getBootstrapConfig` treats `localhost`, `*.localhost`, `127.x.x.x` and `[::1]` as local and everything else as production.

Documentation
- The user docs are MkDocs Material, built from `docs/` by `mkdocs.yml`. Run `mkdocs build --strict` before a PR, it fails on broken links and missing images.
- Diagrams are Mermaid, in ```` ```mermaid ```` fences. `pymdownx.superfences` has a `mermaid` custom fence, and Material loads Mermaid from a CDN in the browser. There's no build step for them.
- `protocol.md` and this page are excluded from the published site, but GitHub renders their Mermaid too.
- The theme has light and dark schemes, so screenshots can come in both. Use `![...](assets/screenshots/name-light.png#only-light)` and `![...](assets/screenshots/name-dark.png#only-dark)` next to each other.

Screenshots
- The docs screenshots live in `docs/assets/screenshots/`, one light and one dark PNG per shot.
- They're made by a Playwright script in `tools/screenshots/`. It has its own `package.json`, so Playwright never lands in the frontend's dependencies or bundle.
- To regenerate them, install the frontend once (`npm --prefix frontend ci`), then run `npm run screenshots` from the repo root.
- That builds the app, installs the screenshot tool, downloads Playwright's Chromium if it's missing, starts `vite preview` on port 4183, and writes the PNGs.
- Set `SCREENSHOT_PORT` if 4183 is taken (pick a port browsers allow, 4190 is on their blocked list), `SCREENSHOT_THEMES=light` to do one theme, or `SCREENSHOT_CHANNEL=msedge` (or `chrome`) to use an installed browser instead of downloading Chromium.
- The script builds a small sample project, opens each dialog, and draws numbered callouts over the buttons each docs page talks about. The PNGs are palette-compressed with `sharp` to keep them small.
- The Share shot joins a real room through the public trackers, so it needs a network connection. The room id is blanked out of the picture.
- Rerun it when the UI changes, and before a release. It's not in CI yet.

Security
- `SECURITY.md` at the repository root is the security policy. GitHub shows it on the Security tab and links it from new issues.
- Vulnerabilities are reported through GitHub's private vulnerability reporting ([form](https://github.com/PrestonHager/LaTeXCollaborativeEditor/security/advisories/new)), which must stay turned on in **Settings > Code security**.
  The issue chooser (`.github/ISSUE_TEMPLATE/config.yml`), the top of the bug and feature forms, and **Help > Report a Security Issue** all point there.
- `.github/dependabot.yml` checks npm in `frontend/`, `e2e/` and `tools/screenshots/`, and the GitHub Actions versions, every week.
  Dependabot alerts and security updates, and secret scanning with push protection, are switched on in **Settings > Code security** too. The `.env` files hold Google and TURN keys, so keep push protection on.
- Only the live site and `main` get security fixes. There are no release branches.

Versions and releases
- How to version, write the changelog, tag and release is in [`docs/versioning.md`](versioning.md).
- Every merge to `main` still deploys to Pages. A release is a `vX.Y.Z` tag on a commit that's already on `main`.
- Pushing the tag runs `.github/workflows/release.yml`. It checks the tag against both `package.json` files, runs the tests and build, and creates the GitHub release from the `CHANGELOG.md` section. It needs no secrets: the default `GITHUB_TOKEN` with `contents: write` is enough.
- `dist/version.json` is served with GitHub Pages' default caching (about 10 minutes), so anything that polls it adds a cache-busting query and `cache: 'no-store'`.
  The app's update check (`frontend/src/app/updateCheck.ts`) does both. It fetches `version.json` next to `index.html` on load, every 15 minutes, and when the tab gets focus or becomes visible (at most once a minute). A different build shows the "new version" card. Failed checks back off up to an hour, a 404 stops checking, and `npm run dev` never checks.
  Other static hosts need to serve `version.json` from the same folder as `index.html`. Without it the app works, it just never offers updates.
