
# Deployment

Frontend deployment (GitHub Pages)
- Configure the repository Pages source to trigger via GitHub Actions.
- Set Actions secrets/variables as needed for runtime configuration, for example:
  - `VITE_P2P_APP_ID`
  - `VITE_P2P_RENDEZVOUS` (comma-separated WebTorrent tracker URLs, see below)
  - `VITE_STUN_URL`
  - `VITE_TURN_URL` (optional)
  - `VITE_TURN_USERNAME` (optional)
  - `VITE_TURN_CREDENTIAL` (optional)
  - `VITE_GOOGLE_CLIENT_ID`
  - `VITE_GOOGLE_API_KEY`
  - `VITE_GOOGLE_APP_ID` (Google Cloud project number; needed so the Picker grants `drive.file` access to files the app didn't create)
  - `VITE_DOCS_BASE_URL` (optional; leave it unset to use the same-origin `docs/` path)
- The Pages workflow reads `VITE_GOOGLE_CLIENT_ID` and `VITE_GOOGLE_API_KEY` from secrets, and `VITE_P2P_APP_ID`, `VITE_STUN_URL`, `VITE_GOOGLE_APP_ID` and `VITE_DOCS_BASE_URL` from variables (repository or **Production** environment).
  The rendezvous and TURN values aren't passed to the build yet, so production uses the defaults in `bootstrapConfig.ts`.
- The frontend bundle is pure TypeScript/Vite (no Rust wasm); LaTeX preview uses LaTeX.js in the browser.
- The UI is Basecoat (shadcn-style components for plain HTML) on Tailwind CSS v4, with Lucide icons. Tailwind runs as a Vite plugin, so there's no extra build step.
- The app shell (menus, dialogs, command palette) is Basecoat markup in `frontend/index.html`. The TypeScript under `frontend/src/ui/` only attaches behavior to it.
- `npm run build` ends with a bundle size check (`scripts/check-bundle-size.mjs`). If the gzipped JS and CSS go over the budget, it prints a warning (a GitHub annotation in CI) but doesn't fail the build.
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
- Signaling uses Trystero's torrent strategy (`@trystero-p2p/torrent`), so the rendezvous endpoints are WebTorrent trackers, not Nostr relays.
- `VITE_P2P_RENDEZVOUS` is the full tracker list, and Trystero only connects to those.
  If it's unset, the app uses `wss://tracker.webtorrent.dev`, `wss://tracker.openwebtorrent.com`, and `wss://tracker.files.fm:7073/announce`.
- Public trackers come and go. If the console shows `torrent tracker failure` for one, drop it from the list.
- Document content remains peer-to-peer after joining a room.
- LaTeX preview runs in the browser via LaTeX.js inside a sandboxed iframe; assets may be loaded from a CDN.
- Google Drive access tokens last about an hour. The app asks Google Identity Services for a new one (`prompt: ''`, no consent screen) when it runs out. If that fails, it shows a notice and saves to browser storage until you reconnect Drive.
- A project in Drive is a folder, tagged with an `appProperties` flag so the app can list its projects.
  Each project file is a real Drive file inside it, with subfolders kept as they are.
- The app still only asks for the `drive.file` scope. That's enough for every file and folder the app makes.
  It is not enough for files someone adds to a project folder from Drive itself.
  Picking a folder in the Picker only grants the folder, not the files already in it, so those files stay hidden until they're picked.
  We kept `drive.file` instead of asking for full Drive access, which needs a Google security review.
- An old single `.tex` file from before projects opens as a one-file project and keeps saving to that file.
  When you add a second file, the app makes a project folder next to it and moves the file in.
- Drive errors are sorted by Google's error `reason`, not the message text.
  `rateLimitExceeded`, `userRateLimitExceeded`, `backendError`, HTTP 429 and 5xx get retried.
  `storageQuotaExceeded` (a full Drive) and other 403s don't.
- A Drive save writes files before it renames the project folder, so a failed upload never leaves a renamed folder behind.
- Local projects live in IndexedDB (the `latex-editor` database). Old documents in localStorage get moved into one-file projects the first time the app starts.

Networking (STUN/TURN)
- Start with a public STUN server such as `stun:stun.l.google.com:19302`.
- Add TURN as needed for restrictive NAT environments.

Domain and security
- The domain (e.g., latex.prestonhager.com) must be served over HTTPS to enable P2P APIs.
- Keep CORS and CSP policies permissive enough for rendezvous and TURN endpoints while minimizing exposure.
