
# Desktop app (design)

This page is for maintainers and contributors. It isn't in the published docs (see `exclude_docs` in `mkdocs.yml`).

Issue #122 plans native apps for Windows, macOS and Linux, then tablets and phones, without Electron. This page records the framework choice, what each platform needs, and the follow-up work. The first step is a scaffold in `desktop/` that wraps the existing web build. Nothing is signed or published yet.

## Status

| Piece | State |
| --- | --- |
| Framework | Tauri 2 (below) |
| `desktop/` scaffold | Builds on Linux. `cargo check`, `cargo clippy` and `tauri build` (deb, rpm, AppImage) passed on Ubuntu 24.04 |
| CI | `.github/workflows/desktop.yml` builds unsigned Linux, Windows and macOS installers as workflow artifacts |
| Desktop detection in the frontend | `frontend/src/app/desktopShell.ts`. The keymap uses it, Share uses it to offer the system browser when WebRTC is missing, and a lazy chunk (`frontend/src/app/desktopUi.ts`) changes the wording and sends links to the browser |
| Links, wording, offline preview | Done (#181, below): links open in the system browser, the window can't leave the app, text says "this app", and LaTeX.js is bundled |
| WebRTC | Windows and macOS are expected to work but are **not checked yet**. On Linux, the distro WebKitGTK we checked has **no WebRTC** (below) |
| Google sign-in, local folders, updater, signing | Follow-ups (below) |
| First numbers (Linux, from the sandbox) | `.deb` 2.4 MB and `.rpm` 2.4 MB. The AppImage is 78 MB because it carries WebKitGTK and GStreamer. After load, the app used about 420 MB PSS across its three processes, under Xvfb with software rendering. That's not a fair desktop number: measure on real hardware against a browser tab |

## The choice: Tauri 2

The web app stays the main product. The desktop app is a thin native shell around the same static build (`frontend/dist`), so every feature ships to both at once.

| Option | Webview | Fits here? | Notes |
| --- | --- | --- | --- |
| **Tauri 2** | The OS's own: WebView2 (Windows), WKWebView (macOS), WebKitGTK (Linux) | **Yes** | Rust core, installers of a few MB, fast start and low memory. It has official plugins for an updater, file dialogs, the file system, opening URLs and deep links, plus a permission system (capabilities). The same project later targets iOS and Android. Rust is already in our toolchain. |
| Wails (v2, v3 alpha) | Same OS webviews | Close second | Go core, a similar model. No mobile targets, a smaller plugin set, and v3 isn't stable yet. It has the same Linux WebKitGTK WebRTC problem as Tauri. |
| Neutralinojs | Same OS webviews | No | Very small, but the native side is a fixed JS API over a local server, with no updater or signing tools of note and no mobile. |
| Electron, or anything that ships Chromium (NW.js, CEF) | Bundled Chromium | No | Ruled out by #122: heavy, slow to start, uses a lot of memory. Tauri's Chromium (CEF) runtime is still experimental. It's worth watching only as a Linux fallback (below). |
| Flutter, Qt or per-platform native UI | None, or a webview just for the preview | No | We'd have to rewrite the UI and the editor (CodeMirror), and the LaTeX.js preview needs a webview anyway. |
| PWA (installable web app) | The user's browser | Already done | The web app installs from Chrome and Edge (`manifest.webmanifest`). It's a good stopgap, but there's no store listing and only limited file system access. |

Tauri's main risk is that each OS has a different webview. The rest of this page covers the parts where that matters.

## How the shell works

- `desktop/src-tauri/` is a standard Tauri 2 app. `tauri.conf.json` points `build.frontendDist` at `../../frontend/dist`, and `beforeBuildCommand` runs `npm run build:desktop` in `frontend/`: the same build as the website, budget check included, plus LaTeX.js's styles and fonts in `dist/latexjs/` ("Offline preview" below). In development, `npm run dev` in `desktop/` runs `npm run dev:desktop` and opens the Vite dev server (`http://localhost:5173`) in the window.
- The main window is declared in `tauri.conf.json` with `"create": false`, and `src/lib.rs` builds it from that entry (`WebviewWindowBuilder::from_config`), so it can add the link guard and the asset header below.
- The window loads the build from inside the app bundle, never from a remote URL. The page's origin is `tauri://localhost` on macOS and Linux and `https://tauri.localhost` on Windows (`useHttpsScheme: true`).
- **The app keeps its own storage.** IndexedDB and localStorage belong to the app's webview profile, so local projects in the app and in a browser are separate. The profile is tied to the bundle `identifier` and, on Windows, to `useHttpsScheme`. Changing either later would lose every local project, so `desktop/scripts/check-desktop-config.mjs` guards `useHttpsScheme`, and the identifier must never change.
- **Versions.** `tauri.conf.json` reads its `version` from `frontend/package.json`, the one app version (`docs/versioning.md`). So the Prepare release workflow needs no change, and a web build and a desktop build of the same commit always have the same number. The `Cargo.toml` version is a `0.0.0` placeholder that nothing reads, and `desktop/package.json` has no version.
- **Telling the frontend it's in the app.** It's a runtime check, `isDesktopShell()` in `frontend/src/app/desktopShell.ts`: Tauri 2 defines `window.__TAURI_INTERNALS__` in every page it loads, even with no Tauri APIs allowed. A build flag wouldn't help:
  - `VITE_DEPLOY_ENV` already says where a build deploys (production, staging or dev). It also picks the P2P app id, and the desktop app must stay on production's so it can join rooms with website users.
  - A separate desktop build would double the build and test matrix.

  The check adds a few dozen bytes to the initial load. Anything bigger that only the desktop needs, like the updater UI or the folder picker, goes in a lazy chunk loaded behind `isDesktopShell()`. `frontend/src/app/desktopUi.ts` is the first one (links and wording, below).

## Links and navigation

The app has one window, and only the app loads in it (issue #181):

- **In the page:** `desktopUi.ts` catches clicks on links that would leave the app. An `https` link to another site opens in the system browser through `openInSystemBrowser()` (the opener plugin). The app's own pages that open in a new tab on the web (`privacy.html`, `tos.html`) open on the website instead, since the app has no second window; without an https `VITE_DOCS_BASE_URL` they don't open. Commands that opened a tab (Help > Documentation, Report a Bug and the like) call the opener too. If it fails, a notice says so.
- **In the shell, as the guard:** `src/lib.rs` sets `on_navigation` and `on_new_window` on the window. Navigation is allowed only to the app itself (`tauri://localhost`, `http(s)://tauri.localhost`, and the dev server in `tauri dev`) and to the frames the page makes (`about:srcdoc`, `about:blank`, `blob:`). Anything else is cancelled; if it's `https`, Rust opens it in the system browser with the opener's Rust API. Every new-window request (`window.open`, `target="_blank"`, preview links) is denied the same way, with `https` sent to the browser. `http:`, `file:`, `mailto:` and other schemes go nowhere.
- No new permission: the Rust side doesn't go through capabilities, and the page still has only `opener:allow-open-url` for `https://*`.

## Wording

The app keeps its own storage, so "saved in this browser" is wrong there. `localPlace()` in `desktopShell.ts` gives "this browser" or "this app" for text built in code (the profile and template dialogs, notices). The static text in `index.html` (menus, Settings, dialog descriptions) is rewritten once at startup by `applyDesktopWording()` in `desktopUi.ts`: whole sentences where the browser wording doesn't carry over ("shared with its other tabs"), then "this browser" to "this app". It never touches the editor, inputs or anything people typed. "Match this browser" for the language and paper guesses reads "Match this computer".

## Offline preview

On the web, the preview's generated document loads LaTeX.js's styles, fonts and `base.js` from jsDelivr (`latex.js@0.12.6`). The desktop app ships them instead, so the preview works with no network:

- `npm run build:desktop` and `npm run dev:desktop` in `frontend/` run the normal scripts with `VITE_LATEXJS_ASSETS=bundled` (`scripts/with-bundled-latexjs.mjs`, so it works on Windows too). Then `scripts/latexjs-assets.mjs` copies `node_modules/latex.js/dist/{css,fonts,js}` (about 8 MB, mostly fonts) to `dist/latexjs/`, or serves them there in dev. The copied files are static files, not JS chunks, so the bundle budget doesn't count them, and the version is always the npm dependency's.
- `latexJsAssetBase()` (`frontend/src/compile/latexJsAssets.ts`) is `/latexjs/` on the page's origin in that build and the CDN otherwise. It's read in the compile worker too, which is why it's a root path: the desktop page always sits at the root of its origin.
- **CORS.** The preview frame is sandboxed without `allow-same-origin`, so its origin is opaque, and fonts always load with CORS. Tauri answers its own scheme with `Access-Control-Allow-Origin` set to the window's origin, which an opaque origin doesn't match. So `on_web_resource_request` in `src/lib.rs` sets `Access-Control-Allow-Origin: *` on responses under `/latexjs/` only, the same header jsDelivr sends. They're public static files. The dev server does the same for its copy.
- **CSP.** No change. The files come from the app's own origin, which `'self'` already allows in every directive the preview uses, including `base-uri`. jsDelivr stays in the policy for the web build.
- **Exports.** HTML export with Work offline inlines the styles from the app's copy. Without it, or if that fails, the saved file's links are moved to the jsDelivr URLs (`publicLatexJsUrl()`), since `tauri://localhost` means nothing outside the app.
- **Why only the desktop build.** The website is online by definition, and jsDelivr's copy is cached across sites and served from a CDN near the reader; bundling would add 8 MB of fonts to every deploy for no gain there. The web build is byte-for-byte what it was, and `desktop/scripts/check-desktop-config.mjs` checks that the desktop build commands use `build:desktop` and `dev:desktop`.
- The P2P protocol is the same code on both sides, so desktop and web peers meet in the same rooms. The `hello` handshake and `PROTOCOL_VERSION` (`docs/protocol.md`) cover a desktop app that's behind the website because its user hasn't updated.

## WebRTC in each webview

The app's document sync needs `RTCPeerConnection` and DataChannels. It never needs `getUserMedia`, so no camera or microphone permission is involved. Peers find each other through WebTorrent trackers over WebSocket, which every webview supports.

### Windows: WebView2

WebView2 is Chromium, the same engine as Edge, so DataChannels work as they do in Edge. Its user agent says Edge. **To check:** join a room with a browser peer, including through a TURN relay.

### macOS: WKWebView

WKWebView uses the system WebKit, the same engine as Safari. On macOS 11 and later, `RTCPeerConnection` and DataChannels are available to pages without any media permission. The bundle sets `minimumSystemVersion` to 11.0. As in Safari, local IP addresses in ICE candidates are hidden behind mDNS names. Web Safari users already work this way. **To check on a Mac:** a DataChannel loopback, then joining a room with a Chrome peer.

### Linux: WebKitGTK

This is the weak spot. Here's what we checked, on Ubuntu 24.04 with `libwebkit2gtk-4.1-0` 2.52.6 (the version Tauri links against). We used a small WebKitGTK program that creates two `RTCPeerConnection`s and sends a DataChannel message between them:

- `RTCPeerConnection` is **undefined** with the default settings, and still undefined after `enable-webrtc` is turned on. The page is a secure context.
- The library isn't linked against `libgstwebrtc`. Ubuntu builds WebKitGTK without WebRTC (`ENABLE_WEB_RTC` off). Debian is believed to be the same. Fedora, Arch and the GNOME Flatpak runtime were not checked.
- WebKitGTK also leaves WebRTC off at runtime unless the app turns on its `enable-webrtc` setting, and wry (Tauri's webview layer, 0.57) doesn't. So the shell turns it on (`desktop/src-tauri/src/lib.rs`), which is enough on a distro whose WebKitGTK has WebRTC.

So **on most Linux installs today, the desktop app can edit, preview and save, but can't share a room.** Ways out, best first:

1. **DataChannels in Rust, exposed to the page.** Trystero takes an `rtcPolyfill` option, an `RTCPeerConnection` stand-in. The Rust side would run real WebRTC DataChannels (libdatachannel through the `datachannel` crate, or the pure-Rust `webrtc` crate) and pass messages to the page over Tauri IPC. DataChannels are standard DTLS and SCTP, so web peers can't tell the difference. This works on every distro without shipping a browser engine. It needs IPC permissions and `ipc:` in the CSP. Recommended.
2. **Flatpak with a GNOME runtime whose WebKitGTK has WebRTC.** That needs checking. Even if it works, it only covers the Flatpak.
3. **Bundle our own WebKitGTK built with WebRTC** in the AppImage. That's large and means tracking WebKit security updates ourselves.
4. **Tauri's Chromium (CEF) runtime** once it's stable. It's heavier, close to what #122 wants to avoid.

Until then the app says so instead of failing quietly (issue #205). When `RTCPeerConnection` is missing, Share and `?room=` links say "This window can't make peer-to-peer connections, so it can't share or join a room.", the P2P code never loads, and the app offers to open the room (or, for Share, the web app) in the system browser:

- The web app's address comes from `VITE_DOCS_BASE_URL`: the site serves the docs under `/docs/`, so the app is the folder above (`webAppUrl()` in `frontend/src/app/p2pSupport.ts`). The page's own origin, `tauri://localhost`, means nothing to a browser. Without an https docs base, the app only explains.
- The link opens through `tauri-plugin-opener` (`openInSystemBrowser()` in `frontend/src/app/desktopShell.ts`, which calls `__TAURI_INTERNALS__.invoke('plugin:opener|open_url')`). If that fails, the link is copied instead.

## Google sign-in

The web app signs in with Google Identity Services in the page. Google blocks OAuth in embedded webviews: the sign-in page answers `disallowed_useragent` ("Use secure browsers" policy). So the desktop app must sign in through the system browser, the way RFC 8252 describes for native apps:

1. Rust starts a one-shot HTTP listener on `127.0.0.1` at a random free port. `tauri-plugin-oauth` does this, or the app can run its own small listener.
2. The app opens `https://accounts.google.com/o/oauth2/v2/auth` in the default browser (`tauri-plugin-opener`). It sends `redirect_uri=http://127.0.0.1:<port>`, `response_type=code`, the same Drive scopes as the web app (`drive.file`), `code_challenge` (S256 PKCE), `state`, and `access_type=offline` so a refresh token comes back.
3. The listener gets the code and checks `state`. Rust exchanges the code with `code_verifier` at `https://oauth2.googleapis.com/token`. Google's installed-app flow also wants the client's `client_secret`, which for a Desktop client is not treated as secret.
4. Rust keeps the refresh token in the OS keychain (the `keyring` crate). It hands the page only short-lived access tokens, through a narrow IPC command, so the page never sees the refresh token. The Drive provider uses that token in place of the GIS token client.

**The Google Picker** (used to pick Drive files and folders) loads in an iframe from `docs.google.com`, keyed to a browser origin. It may not work from `tauri://localhost` or `https://tauri.localhost`. This needs a test. If it fails, the desktop app needs its own Drive file list (the `drive.file` scope allows listing files the app made) or the browser.

**What the maintainer sets up in Google Cloud** (same project as the web client):

1. APIs & Services > Credentials > Create credentials > OAuth client ID > Application type **Desktop app**. A Web application client won't accept loopback redirects on any port. A Desktop client allows `http://127.0.0.1:<any port>` with no redirect URIs to register.
2. Use the same OAuth consent screen. If it's in production with sensitive scopes, the verified scopes are shared. The Desktop client just appears as another client of the same app.
3. Save the client ID and secret as Actions secrets for the desktop build (planned names: `GOOGLE_DESKTOP_CLIENT_ID`, `GOOGLE_DESKTOP_CLIENT_SECRET`). The Rust side reads them at build time. Leave them out of the web build.
4. If the Picker stays, the desktop app needs an API key that isn't restricted by HTTP referrer, since the app has no web referrer. Restrict it by API (Picker API) instead.

Until this lands, the desktop workflow builds without the Google variables, so Drive shows as not set up in the app.

## Keyboard shortcuts

In a native window, Ctrl+N, Ctrl+W, Ctrl+T and the other keys browsers keep for tabs reach the page, because there's no browser around it. `frontend/src/app/reservedKeys.ts` already has an app-window context for installed web apps. In the desktop app, `detectKeyContext` now returns `appWindow: true` and `desktop: true`, and treats the webview as no particular browser. WebKitGTK's user agent says Safari, which would otherwise wrongly keep Safari's keys. So only the OS's own keys stay reserved (macOS Cmd+Q, Cmd+H and Cmd+M, and Alt+Tab and Alt+F4 elsewhere), the keymap uses each shortcut's main key, and Settings says "Keys shown are for the desktop app."

To check on real systems:

- **macOS:** Tauri adds a default app menu on macOS with key equivalents: Close Window (Cmd+W), Quit, Hide and Minimize, and an Edit menu (Cmd+Z, X, C, V, A) that WKWebView needs for clipboard shortcuts. Check whether Cmd+W reaches the page first. If the menu wins, replace the default menu with one that keeps the Edit menu and drops Close Window's key equivalent.
- **Windows:** WebView2's own "browser accelerator keys" (Ctrl+F, Ctrl+P, Ctrl+R, F5, Ctrl+Shift+I and others). Check which still act after the page calls `preventDefault`, and turn them off in the shell if they get in the way.
- **Linux:** the window has no menu, so only the window manager's keys are kept.

## Storage: local folders (follow-up)

The desktop win is **opening a folder on disk as a project**. It would be a new storage provider next to the browser and Drive ones (`frontend/src/storage/providers/`, coordinated with #47):

- It would use `tauri-plugin-dialog` to pick a folder and `tauri-plugin-fs` to read and write it. Permissions are scoped at runtime to the folders the user picked, never the whole disk.
- It would use the same layout as the `.zip` export (#73), so a folder, a zip and a Drive folder hold the same project.
- It would watch the folder for outside changes (an editor or `git pull`) and go through the existing conflict flow.
- Its code loads lazily, behind `isDesktopShell()`.

Not in this PR.

## Updates

The website's update check reads `version.json` from the site. In the app, that file is the bundled one, so the check never finds anything. Desktop updates use **`tauri-plugin-updater`** instead:

- **Signing.** Updates are signed with a Tauri updater key pair (`tauri signer generate`). The public key goes in `tauri.conf.json` (`plugins.updater.pubkey`). The private key and its password are Actions secrets (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). This key is separate from Apple and Windows code signing. **If it's lost, installed apps can never update again**, so keep a backup outside GitHub.
- **Building.** `bundle.createUpdaterArtifacts: true` makes the update bundles and their `.sig` files.
- **Fitting the release flow** (`docs/versioning.md`). After `release.yml` creates the GitHub release, it calls `desktop.yml` (`workflow_call` with the tag) with the signing secrets. That job uploads the installers, the `.sig` files and a `latest.json` manifest to the release. The updater endpoint is `https://github.com/PrestonHager/LaTeXCollaborativeEditor/releases/latest/download/latest.json`. GitHub's "latest" skips pre-releases, so `-rc` builds don't reach users. A beta channel could use a second manifest later.
- **In the app:** check on start and every few hours, show the existing update card, and on **Restart to update** save first (`flushBeforeReload`) and then install. In the app, the web update card's version check is replaced by the updater. A collaborator on a newer protocol prompts "Update the app" instead of "Reload".

## Releases and signing

**Now:** `.github/workflows/desktop.yml` builds on Linux (Ubuntu 22.04, for older glibc: `.deb`, `.rpm`, AppImage), Windows (`.msi`, NSIS `.exe`) and macOS (a universal `.app` and `.dmg`). It uploads them as workflow artifacts, kept for 14 days. It runs:

- from Actions > **Desktop app** > Run workflow (optionally with a tag);
- on a `vX.Y.Z` tag pushed by hand.

Tags that `tag-release.yml` pushes don't start it on their own, because pushes made with `GITHUB_TOKEN` don't start workflows. So for now, run it by hand with the tag after a release. Wiring it into `release.yml` belongs to the updater follow-up. The builds use the Production environment's `VITE_P2P_APP_ID`, `VITE_STUN_URL` and `VITE_DOCS_BASE_URL`, so the app meets the website's peers.

The builds are unsigned, so people see warnings:

- macOS says the app is from an unidentified developer. It's ad-hoc signed (`signingIdentity: "-"`), so it runs on Apple silicon: right-click > Open, or run `xattr -dr com.apple.quarantine` on the app.
- Windows SmartScreen warns about an unknown publisher.

**Signing, for the maintainer to set up:**

- **macOS (signing and notarization):**
  1. Join the Apple Developer Program.
  2. Create a **Developer ID Application** certificate, export it as a `.p12`, and save it as the secrets `APPLE_CERTIFICATE` (base64 of the `.p12`) and `APPLE_CERTIFICATE_PASSWORD`.
  3. Set `APPLE_SIGNING_IDENTITY` to the certificate's name.
  4. For notarization, add either `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password) and `APPLE_TEAM_ID`, or an App Store Connect API key (`APPLE_API_ISSUER`, `APPLE_API_KEY` and the key file).

  The Tauri CLI reads these from the environment, signs, notarizes and staples. The workflow then passes them to the macOS build step.
- **Windows:** either an OV/EV code-signing certificate (`bundle.windows.certificateThumbprint` plus `timestampUrl`, with the `.pfx` imported on the runner), or Azure Trusted Signing through `bundle.windows.signCommand`. EV certificates and Trusted Signing build SmartScreen reputation fastest.
- **Linux:** there's no OS signing. Publish SHA-256 checksums with the release, and consider Flathub later (which also settles the WebKitGTK question for that package).

## Security

- **Only bundled content.** The window loads `frontend/dist` from the app. There's no remote URL and no `remote` capability, so no web page ever gets Tauri APIs.
- **CSP.** The app uses the web CSP unchanged: the `<meta>` tag in the bundled `index.html`. Tauri's own `app.security.csp` stays `null`. If both were set, the browser would enforce both, and the effective policy would be their intersection. A Tauri copy could only drift from the meta tag, for example when the build adds custom `VITE_P2P_RENDEZVOUS` trackers to the meta tag. Desktop builds must not use the `VITE_DISABLE_CSP=1` rollback switch.

  When a feature needs Tauri IPC from the page, `connect-src` needs `ipc: http://ipc.localhost`. Add it to the meta policy then (it means nothing on the web) and update `frontend/src/security/cspPolicy.test.ts`.
- **Capabilities.** There's one capability, `main-window`. Its only permission is `opener:allow-open-url`, scoped to `https://*`, so the page can open https links in the system browser (issue #205); not even `core:default`. Each follow-up adds only what it uses: `updater:default`, `dialog:allow-open`, `fs` scoped to the picked folders.
- **IPC in the CSP.** The opener goes through Tauri IPC, so the meta policy's `connect-src` has `ipc: http://ipc.localhost` (it means nothing on the web). `frontend/src/security/cspPolicy.test.ts` allows exactly those.
- `withGlobalTauri` is off, and the asset protocol is off. The frontend imports nothing from Tauri; the opener call goes through `__TAURI_INTERNALS__`, which Tauri defines in every page it loads.
- `freezePrototype` is off. Freezing `Object.prototype` breaks code that assigns over an inherited property (the "override mistake"), and LaTeX.js, pdf.js and CodeMirror haven't been tested with it.
- **Links and navigation** are guarded in the shell, not only in the page ("Links and navigation" above). The only header the shell changes is `Access-Control-Allow-Origin: *` on the bundled LaTeX.js files ("Offline preview").
- `desktop/scripts/check-desktop-config.mjs` (`npm run check` in `desktop/`, run by the workflow) fails if any of the above drifts: the one permission, `"create": false` on the window, the `on_navigation` and `on_new_window` guards, `https`-only opening, the CORS header limited to `/latexjs/`, and the `build:desktop` and `dev:desktop` commands.

## Building locally

- **Linux:**
  - Install the system libraries: `sudo apt-get install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev`.
  - Install Rust: rustup, 1.90 or newer.
  - Run `npm ci` in `frontend/` and in `desktop/`.
  - Then run `npm run dev` or `npm run build` in `desktop/`. Installers land in `desktop/src-tauri/target/release/bundle/`.
  - A bare `cargo check` in `desktop/src-tauri/` needs `frontend/dist` to exist, because Tauri embeds it at compile time. Run `npm run build` in `frontend/` first.
- **macOS:** install the Xcode command line tools.
- **Windows:** install the MSVC build tools and the WebView2 runtime (Windows 11 has it built in).

## Roadmap

1. **Scaffold (this PR):** this page, `desktop/`, CI, and desktop detection.
2. **Desktop beta:**
   - check it on the three OSes against the #122 prototype list (open, edit, preview, join a room with a browser peer; startup time and memory against the browser);
   - Linux WebRTC;
   - Google sign-in;
   - external links (done, #181);
   - macOS menu keys;
   - signing.
3. **Desktop 1.0:**
   - local folder projects;
   - the updater;
   - installers attached to every GitHub release;
   - LaTeX.js and its fonts bundled so the preview works offline (done, #181).
4. **Later:** a real TeX engine in the native build (#43), and iOS and Android from the same Tauri project once the web layout works on phones and tablets (#123).

## Follow-up issues

These are listed in the PR that added this page, to be filed:

- Desktop: check the app on Windows, macOS and Linux, and measure startup and memory.
- Desktop: WebRTC on Linux (DataChannels in Rust behind Trystero's `rtcPolyfill`), #176. The notice when WebRTC is missing is done (#205).
- Desktop: Google sign-in through the system browser (loopback and PKCE, a Desktop OAuth client, tokens in the keychain, and the Picker question).
- Desktop: a local folder storage provider.
- Desktop: auto-updater, and installers attached to releases.
- Desktop: macOS notarization and Windows code signing (maintainer setup).
- Desktop: shell polish, #181 (external links in the browser, navigation lock, wording, offline preview assets: done). Still open: the macOS menu and Cmd+W, and the web update card replaced in the app.
