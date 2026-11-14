
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
| WebRTC | Windows and macOS use the webview's own and are expected to work, but are **not checked yet**. On Linux, where the distro WebKitGTK has **no WebRTC**, the shell runs real WebRTC data channels in Rust behind Trystero's `rtcPolyfill` (#176, "WebRTC in the shell" below). Checked against Chromium both ways; **needs real hardware** (#174) |
| Local folders | Done (#178, below): open a folder on this computer as a project, save to one, and outside edits go to the conflict flow. **Not yet checked on real hardware** (#174) |
| Google sign-in | Done (#177, below): through the system browser, loopback and PKCE in Rust, the refresh token in the OS keychain. Needs the maintainer's Desktop OAuth client, and **checking on real hardware** (#174) |
| Updater, installers on releases | Done (#179, below): signed updates from GitHub Releases, and every release gets the installers, `.sig` files, checksums and `latest.json`. Needs the maintainer's updater key pair |
| Code signing (Apple, Windows) | Follow-up (below) |
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

- **In the page:** `desktopUi.ts` catches clicks on links that would leave the app. An `https` link to another site opens in the system browser through `openInSystemBrowser()` (the opener plugin). The app's own pages that open in a new tab on the web (`privacy.html`, `tos.html`) open on the website instead, since the app has no second window; without an https `VITE_DOCS_BASE_URL` they don't open. If the opener fails, it logs a warning. Commands that open a tab (Help > Documentation, Report a Bug and the like) still call `window.open`, which the shell turns into the system browser (next point); that keeps `main.ts` free of desktop code, since the initial load is at its budget.
- **In the shell, as the guard:** `src/lib.rs` sets `on_navigation` and `on_new_window` on the window. Navigation is allowed only to the app itself (`tauri://localhost`, `http(s)://tauri.localhost`, and the dev server in `tauri dev`) and to the frames the page makes (`about:srcdoc`, `about:blank`, `blob:`). Anything else is cancelled; if it's `https`, Rust opens it in the system browser with the opener's Rust API. Every new-window request (`window.open`, `target="_blank"`, preview links) is denied the same way, with `https` sent to the browser. `http:`, `file:`, `mailto:` and other schemes go nowhere.
- No new permission: the Rust side doesn't go through capabilities, and the page still has only `opener:allow-open-url` for `https://*`.

## Wording

The app keeps its own storage, so "saved in this browser" is wrong there. `localPlace()` in `desktopShell.ts` gives "this browser" or "this app" for text built in code (the profile and template dialogs, notices). The static text in `index.html` (menus, Settings, dialog descriptions) is rewritten once at startup by `applyDesktopWording()` in `desktopUi.ts`: whole sentences where the browser wording doesn't carry over ("shared with its other tabs"), then "this browser" to "this app". It never touches the editor, inputs or anything people typed. "Match this browser" for the language and paper guesses reads "Match this computer".

## Offline preview

On the web, the preview's generated document loads LaTeX.js's styles, fonts and `base.js` from jsDelivr (`latex.js@0.12.6`). The desktop app ships them instead, so the preview works with no network:

- `npm run build:desktop` and `npm run dev:desktop` in `frontend/` run the normal scripts with `LATEXJS_ASSETS=bundled` (`scripts/with-bundled-latexjs.mjs`, so it works on Windows too). That isn't a `VITE_` variable on purpose: the plugin turns it into one compile-time constant, `__LATEXJS_BUNDLED__`, so the `import.meta.env` object in the initial bundle doesn't grow. Then `scripts/latexjs-assets.mjs` copies `node_modules/latex.js/dist/{css,fonts,js}` (about 8 MB, mostly fonts) to `dist/latexjs/`, or serves them there in dev. The copied files are static files, not JS chunks, so the bundle budget doesn't count them, and the version is always the npm dependency's.
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

So on most Linux installs the webview can't make peer connections. Ways out we looked at, best first:

1. **DataChannels in Rust, exposed to the page.** Done (#176), below.
2. **Flatpak with a GNOME runtime whose WebKitGTK has WebRTC.** That needs checking. Even if it works, it only covers the Flatpak.
3. **Bundle our own WebKitGTK built with WebRTC** in the AppImage. That's large and means tracking WebKit security updates ourselves.
4. **Tauri's Chromium (CEF) runtime** once it's stable. It's heavier, close to what #122 wants to avoid.

### WebRTC in the shell

Issue #176. Where the webview has no `RTCPeerConnection`, the shell runs the page's WebRTC peer connections in Rust, and the page drives them over Tauri IPC:

- **Rust** (`desktop/src-tauri/src/native_rtc.rs`) uses `webrtc-rs` 0.17 (the `webrtc` crate, pure Rust: ICE, DTLS, SCTP), so these are standard WebRTC data channels and **browser peers can't tell the difference**. It covers what Trystero uses: ordered binary data channels, offers and answers, rollback, ICE restart, trickled or gathered candidates, and the connection, ICE and gathering states. No audio or video: `npm run check` fails if the module touches tracks.
- **The page** (`frontend/src/net/nativeRtc.ts`, a 2.7 kB lazy chunk) is an `RTCPeerConnection` and `RTCDataChannel` stand-in. `p2pTransport.ts` passes it to Trystero as `rtcPolyfill`, only when the window has no `RTCPeerConnection` and the shell says it can do this (`__LCE_DESKTOP__.nativeRtc`, read by `desktopNativeRtc()`). Everything above Trystero (the sync protocol, `PROTOCOL_VERSION`, rooms) is the same code as in a browser. In a browser, or in the app on Windows and macOS, it never loads.
- **IPC.** Seven app commands (`rtc_create`, `rtc_create_data_channel`, `rtc_create_description`, `rtc_set_description`, `rtc_add_ice_candidate`, `rtc_send`, `rtc_close`), each with its `allow-*` permission. Events (states, candidates, channels opening and closing) come back on one Tauri channel per peer connection, and incoming messages on a second one as raw bytes (`[channel id u16][payload]`). Outgoing messages go in ordered batches as a raw request body (`[channel u16][length u32][bytes]`, repeated), one IPC call at a time, so they keep their order; each message is capped at 64 KiB (Trystero sends 16 KiB chunks). The page keeps `signalingState` and `localDescription` in step itself, since Trystero reads them right after each `await`; when gathering finishes, the shell sends the local SDP with its candidates. `connect-src` already has `ipc: http://ipc.localhost`, so the CSP doesn't change.
- **Privacy.** Host candidates are gathered as mDNS `.local` names, like browsers do, so local IP addresses don't go out through the public trackers; mDNS names from browser peers are resolved. At most 64 peer connections at once; only `stun:`, `stuns:`, `turn:` and `turns:` ICE servers are passed on.
- **Peer to peer only.** Document content still goes straight between peers, encrypted by DTLS. The shell is only the page's network stack: there's no server, and signaling stays the page's own (Trystero over the WebTorrent trackers, `docs/protocol.md`).
- **What doesn't work yet:** `getStats()` returns nothing, so the status bar can't say a connection is relayed through TURN; it still works through one.
- **Checks.** `cargo test` has two native peers connect over loopback the way Trystero does (no trickle) and swap a short and a 16 KiB message. `frontend/src/net/nativeRtc.test.ts` runs Trystero's own `peer.mjs` over the stand-in with a fake shell. `desktop/scripts/rtc-interop.mjs` (`cargo build --example rtc_interop` in `src-tauri/`, then `node scripts/rtc-interop.mjs` with Playwright's Chromium) connects a real Chromium to the Rust side, each side offering in turn, with Chromium's mDNS host names, and checks both messages come back; it passed in the sandbox. Run it after changing `native_rtc.rs`.
- **To check on real hardware (#174):** the Linux app joining a room with Chrome, Firefox and Safari peers on another machine, through NAT and through a TURN relay; a 20 MB file; leaving and rejoining.

Before this, the app said so instead of failing quietly (issue #205), and it still does wherever neither the webview nor the shell can make peer connections. When `RTCPeerConnection` is missing and the shell doesn't offer its own, Share and `?room=` links say "This window can't make peer-to-peer connections, so it can't share or join a room.", the P2P code never loads, and the app offers to open the room (or, for Share, the web app) in the system browser:

- The web app's address comes from `VITE_DOCS_BASE_URL`: the site serves the docs under `/docs/`, so the app is the folder above (`webAppUrl()` in `frontend/src/app/p2pSupport.ts`). The page's own origin, `tauri://localhost`, means nothing to a browser. Without an https docs base, the app only explains.
- The link opens through `tauri-plugin-opener` (`openInSystemBrowser()` in `frontend/src/app/desktopShell.ts`, which calls `__TAURI_INTERNALS__.invoke('plugin:opener|open_url')`). If that fails, the link is copied instead.

## Google sign-in

Issue #177. The web app signs in with Google Identity Services in the page. Google blocks OAuth in embedded webviews: the sign-in page answers `disallowed_useragent` ("Use secure browsers" policy). So the desktop app signs in through the **system browser**, the way RFC 8252 describes for native apps, all in Rust (`desktop/src-tauri/src/google_auth.rs`):

1. **Connect** (File > Connect Google Drive, or Accounts) calls the `google_sign_in` command. Rust binds a one-shot listener on `127.0.0.1` at a free port, makes a PKCE verifier (32 random bytes) with its S256 challenge, and a random `state`.
2. It opens `https://accounts.google.com/o/oauth2/v2/auth` in the default browser through `tauri-plugin-opener`'s Rust API, with `redirect_uri=http://127.0.0.1:<port>`, `response_type=code`, the web app's only scope (`drive.file`), `code_challenge`, `state`, `access_type=offline` and `prompt=consent` (so Google always returns a refresh token), plus the remembered email as `login_hint`. The client secret is never in that URL.
3. The listener answers each request with a small static page (its own `default-src 'none'` CSP). It ignores anything but `GET /` with the right `state` (a favicon, a stale or forged redirect), and gives up after 5 minutes. A second Connect click cancels a sign-in still waiting. `error=access_denied` reports "Access was denied".
4. Rust exchanges the code with the `code_verifier` at `https://oauth2.googleapis.com/token` (with the client secret, which Google's installed-app flow wants), using `reqwest` over the OS's TLS (`native-tls`).
5. The **refresh token goes into the OS keychain** (the `keyring` crate: Keychain on macOS, Credential Manager on Windows, the Secret Service on Linux, through `zbus` with no system library), under `io.github.prestonhager.latexcollaborativeeditor.google`. The command returns only `{ accessToken, expiresIn }` to the page.
6. When the access token runs out, or on the next start, the Drive provider calls `google_access_token`: Rust reads the keychain's refresh token and asks Google for a new access token, with no browser. If Google answers `invalid_grant` (revoked, or six months unused), Rust deletes the keychain entry and the app shows Drive as **Expired** with Connect.
7. **Log out** calls `google_sign_out`: Rust deletes the keychain entry, then revokes the refresh token with Google (best effort, 5 s).

In the page, `frontend/src/storage/providers/desktopGoogleAuth.ts` (a lazy chunk, loaded only in the app) wraps the three commands and turns their short error codes into words. `googleDrive.ts` uses it in place of GIS when `isDesktopShell()`: no GIS script loads, and Drive API calls are the web app's, with the access token. The access token sits in `sessionStorage` like on the web; nothing like a refresh token is ever in the page, IndexedDB or `localStorage`. **Keep me signed in on this browser** doesn't show in the app: the keychain always keeps the sign-in, and Log out clears it.

**Is it set up?** The shell tells the page with one initialization script, `window.__LCE_DESKTOP__ = { googleSignIn: true|false }` (frozen, read by `desktopGoogleClient()` in `desktopShell.ts`), so Accounts can say **Not configured** without an IPC call. The client id and secret stay in Rust.

**The Google Picker.** The Picker loads in an iframe from `docs.google.com` keyed to a web origin and an HTTP-referrer-restricted API key. The app's origin is `tauri://localhost` or `https://tauri.localhost`, which Google can't register as a JavaScript origin, so **the desktop app doesn't use the Picker**:

- **File > Open from Google Drive** lists the Drive projects the app made, in the Open dialog ("Projects this app saved in your Google Drive."). The `drive.file` scope covers every project folder the app made, so this needs no API key and no extra scope.
- **Add Files from Drive**, **Move Project Folder in Drive**, and **Export to Drive into a picked folder** need the Picker (to grant `drive.file` access to files the app didn't make, or to pick a folder). In the app they say "The Google Drive picker doesn't work in the desktop app. Use the web app for this." Opening a Drive file the app didn't make is a web-only feature for the same reason.
- If a later check on real hardware shows the Picker works from the app's origin, it can come back behind the same `ensureDrivePickerConfig()`.

**Permissions.** The three commands are the app's own, declared in `build.rs` (`AppManifest::commands`), so each needs its `allow-*` permission in `capabilities/main-window.json`: `allow-google-sign-in`, `allow-google-access-token` and `allow-google-sign-out`. No plugin permission is added; the opener's Rust API opens the consent page without going through the page's `opener:allow-open-url`. The CSP is unchanged: Rust makes the token requests, and the page only calls the Drive API, as on the web.

**What the maintainer sets up in Google Cloud** (same project as the web client):

1. APIs & Services > Credentials > Create credentials > OAuth client ID > Application type **Desktop app**, named for example "LaTeX Collaborative Editor (desktop)". A Web application client won't accept loopback redirects on any port. A Desktop client allows `http://127.0.0.1:<any port>` with no redirect URIs to register.
2. It uses the same OAuth consent screen, so the verified `drive.file` scope is shared; the Desktop client is just another client of the same app.
3. Save its client ID and secret as the repository (or Production environment) **Actions secrets** `GOOGLE_DESKTOP_CLIENT_ID` and `GOOGLE_DESKTOP_CLIENT_SECRET`. `.github/workflows/desktop.yml` passes them to the Rust build, which bakes them in with `option_env!`. Google doesn't treat a Desktop client's secret as confidential (it ships in every copy of the app, and PKCE protects the code), but it still never goes in the repository, and `npm run check` in `desktop/` fails on anything that looks like a client id or secret in the shell's sources.
4. No API key is needed for the app, since it doesn't load the Picker.
5. **Local builds:** set the same two variables in the environment before `npm run build` or `npm run dev` in `desktop/` (or `cargo check`). They're also read at run time, which wins over the built-in ones, so `GOOGLE_DESKTOP_CLIENT_ID=… npm run dev` works without a rebuild of the Rust side.

Without the variables, the app builds and runs, and Accounts shows Google Drive as **Not configured**.

**To check on real hardware (#174):** the consent page opening in each OS's default browser and the redirect coming back (including with a browser that blocks `127.0.0.1` redirects, like some hardened Firefox setups); the keychain on each OS (macOS asks once to allow access; on Linux the Secret Service needs a running keyring daemon, like GNOME Keyring or KWallet; with none, Connect says it couldn't use the keychain); a restart coming back signed in without the browser; Log out removing the keychain item.

## Keyboard shortcuts

In a native window, Ctrl+N, Ctrl+W, Ctrl+T and the other keys browsers keep for tabs reach the page, because there's no browser around it. `frontend/src/app/reservedKeys.ts` already has an app-window context for installed web apps. In the desktop app, `detectKeyContext` now returns `appWindow: true` and `desktop: true`, and treats the webview as no particular browser. WebKitGTK's user agent says Safari, which would otherwise wrongly keep Safari's keys. So only the OS's own keys stay reserved (macOS Cmd+Q, Cmd+H and Cmd+M, and Alt+Tab and Alt+F4 elsewhere), the keymap uses each shortcut's main key, and Settings says "Keys shown are for the desktop app."

To check on real systems:

- **macOS:** Tauri adds a default app menu on macOS with key equivalents: Close Window (Cmd+W), Quit, Hide and Minimize, and an Edit menu (Cmd+Z, X, C, V, A) that WKWebView needs for clipboard shortcuts. Check whether Cmd+W reaches the page first. If the menu wins, replace the default menu with one that keeps the Edit menu and drops Close Window's key equivalent.
- **Windows:** WebView2's own "browser accelerator keys" (Ctrl+F, Ctrl+P, Ctrl+R, F5, Ctrl+Shift+I and others). Check which still act after the page calls `preventDefault`, and turn them off in the shell if they get in the way.
- **Linux:** the window has no menu, so only the window manager's keys are kept.

## Storage: local folders

Issue #178. The desktop app can **open a folder on this computer as a project**, or save the open project to one. It's a storage provider next to the browser and Drive ones, with the same interface (`StorageProvider`, #47) and an entry in the provider registry (#200):

- **Where it is in the app.** File > Open Project lists **Folder on this computer** next to this app's storage and Drive. The Accounts panel has a row for it with **Save to a Folder**. The command palette has **Open Folder as Project** and **Save to a Folder**. None of this exists on the website: the entry, the commands and the code only appear in the desktop app.
- **Code.** `frontend/src/storage/providers/localFolder.ts` (the provider, over a small `FolderFs` interface) and `frontend/src/app/desktopFolders.ts` (the registry entry, the commands, reopening and the watcher) are one lazy chunk. `main.ts` imports it only behind `isDesktopShell()`, so neither it nor `@tauri-apps/plugin-fs` and `@tauri-apps/plugin-dialog` is in the website's initial load (they add about 0.5 kB to it, for the hooks in `main.ts`, `commands.ts` and the registry).
- **Layout.** The folder holds the project's files as they are, the same layout as the `.zip` export (#73): no metadata file, so a folder, a zip and a Drive folder hold the same project, and git and other editors see plain files. The project's display name and main file are kept in the app (`localStorage` key `latex_editor_folder_projects`, keyed by the folder's path), not in the folder; without them the folder's name and the usual main file guess are used.
- **What's left out.** Hidden files and folders (`.git`, `.vscode`), `node_modules` and TeX build output (`.aux`, `.log`, `.synctex.gz` and the like) don't open, and saving never touches them, because the project doesn't know them. Files over the app's file size limit don't open. A folder with more than 5,000 files is refused, so picking a home folder by mistake fails fast.
- **Versions and conflicts.** A file's version is its modified time and size. Saving checks it first, like Drive's: if the file changed on disk since the app read or wrote it, that file's save is held and the existing conflict dialog asks which copy to keep. Saving into a folder that already has files asks first, then replaces files with the project's names and leaves the rest.
- **Outside edits.** While a folder project is open, the fs plugin's watcher (`notify`, debounced 400 ms) reports changes. A file the project has that changed on disk goes into the conflict flow: with no unsaved edits in the app, it reloads quietly ("Loaded main.tex from the project folder"), the way `git pull` should feel; with unsaved edits, the conflict dialog asks. The app's own writes are recognised by their version and skipped. Files added outside the app show a notice to open the folder again; files deleted outside are written back by the next save, since the project still has them. If the watch can't start (for example Linux's inotify limit), saving still works and conflicts still show up on the next save.
- **Deleting.** Deleting a file in the app deletes it on disk; the fs plugin has no trash. Undo writes it back, as for browser storage.
- **Restarts.** The session remembers the folder (`providerMode: 'folder'`). On the next start the app waits for the folder chunk, checks the folder is still there and reachable, and goes back to saving there. If it's gone, edits save in the app and a status says to open it again.
- **Privacy.** The folder's path never leaves the computer. Guests only see "Host: computer folder" (`ProjectState.currentStorageLabel`); the P2P protocol is unchanged.

### Permissions

The page gets the folder dialog and a fixed list of fs commands, with **no path scope of their own** (`capabilities/main-window.json`):

| Permission | Why |
| --- | --- |
| `dialog:allow-open` | The native folder picker. Picking a folder with `recursive: true` adds that folder and everything under it to the fs scope at runtime. Nothing else ever does. |
| `fs:deny-default` | Denies the app's own webview data folders even if someone picks a folder that contains them. |
| `fs:allow-exists`, `fs:allow-stat`, `fs:allow-read-dir`, `fs:allow-read-file` | Open the project and check versions. |
| `fs:allow-write-file`, `fs:allow-mkdir`, `fs:allow-rename`, `fs:allow-remove` | Save, make folders, move and delete, as the project changes. |
| `fs:allow-watch`, `fs:allow-unwatch` | Outside edits. The Rust crate has the `watch` feature for this. |

So the page can only reach folders the person picked in the dialog. `tauri-plugin-persisted-scope` saves those picks in the app's data folder and restores them on start, so the last project reopens; nothing else is persisted. The fs plugin's default `requireLiteralLeadingDot` keeps hidden files out of the scope's globs too. There's no `fs:default`, no `fs:scope-*` set, and no `plugins.fs.scope` in `tauri.conf.json`. `desktop/scripts/check-desktop-config.mjs` checks the list exactly (plain strings, in order, no object form that could add a path), that `plugins.fs.scope` is unset, and that `src/lib.rs` registers dialog, fs and persisted-scope in that order (persisted-scope reads the fs plugin's scope).

**To check on real hardware (#174):** the dialog on each OS, Windows paths (`C:\...`) and network drives, macOS's file access prompts for Desktop and Documents (the app isn't sandboxed, so no security-scoped bookmarks are needed), the watcher with `git pull` and with editors that save by rename (Vim, VS Code), and a restart reopening the folder.

## Updates

Issue #179. The website's update check reads `version.json` from the site. In the app, that file is the bundled one, so the check never finds anything. Desktop updates use **`tauri-plugin-updater`** instead, driven from Rust (`desktop/src-tauri/src/updates.rs`):

- **The page never talks to the updater plugin.** It gets two app commands, `update_check` (returns `{ version, notes }` or nothing) and `update_install` (downloads, checks the signature against the public key, installs and restarts). So the capability has `allow-update-check` and `allow-update-install`, and no `updater:*` permission.
- **Signing.** Updates are signed with a Tauri updater key pair (`tauri signer generate`). It's separate from Apple and Windows code signing. The plugin refuses any download whose signature doesn't match the public key built into the app. **If the private key is lost, installed apps can never update again**, so keep a backup outside GitHub.
- **The config is added at release time.** `tauri.conf.json` has no `plugins.updater` and no `createUpdaterArtifacts`. `desktop/scripts/updater-config.mjs` writes an overlay with `bundle.createUpdaterArtifacts: true`, the public key, the one endpoint and Windows' passive install mode; `desktop.yml` passes it with `tauri build --config` only when the private key and the public key are both set. Without them (a local build, a pull request, or before the maintainer sets up the key) the build succeeds with no updater: Rust registers the plugin only when the config has a public key, and `update_check` answers "none". `npm run check` fails if `tauri.conf.json` gains updater settings, if the endpoint isn't the https GitHub one, or if `src/lib.rs` registers the plugin unconditionally.
- **Where updates come from.** The endpoint is `https://github.com/PrestonHager/LaTeXCollaborativeEditor/releases/latest/download/latest.json`. GitHub's "latest" skips pre-releases, so `-rc` builds don't reach users. A beta channel could use a second manifest later. Production is moving to Coolify (#249), which could serve the manifest too, but GitHub Releases needs no deploy step, keeps the files next to the tag, and doesn't change when the site's host does, so it stays the source.
- **Releases.** `release.yml` calls `desktop.yml` (`workflow_call`, `release: true`, `secrets: inherit`) after it creates the GitHub release. The three OS builds run in the Production environment; then the `publish` job runs `desktop/scripts/release-assets.mjs`, which copies the installers out of the artifacts with names GitHub keeps (spaces become `-`), writes `SHA256SUMS.txt`, and, when the build signed anything, `latest.json`. It uploads them to the release with `gh release upload --clobber`, so rerunning a release replaces them. `latest.json` lists each bundle under `{os}-{arch}-{bundle}` (like `windows-x86_64-msi`, `linux-x86_64-deb`) plus the default `{os}-{arch}` (AppImage, NSIS, the macOS `.app.tar.gz`, which serves both Mac archs since it's universal), the way the plugin looks them up; the notes are the CHANGELOG section. If the desktop job fails, the website release is already out, and the previous `latest.json` simply stays the newest one.
- **In the app** (`frontend/src/app/desktopUpdates.ts`, part of the desktop chunk): it checks 10 seconds after start and every 6 hours. When the shell finds a newer release, the usual update card shows with **Restart to update**: the app saves first (`flushBeforeReload`, so held conflicts and uploads still block), then the shell installs and restarts. A failed install (for example a signature mismatch) shows its reason on the card, with **Restart anyway** to try again. The web card's `version.json` polling is off in the app. A collaborator on a newer protocol shows the card with "Restart to update".
- **Linux packages.** The AppImage updates itself. A `.deb` or `.rpm` install updates through the matching package when the build signed it (the plugin installs it with `pkexec`); otherwise people install the new package from the release.

**What the maintainer sets up** (once):

1. On a trusted machine, run `npx tauri signer generate -w ~/.tauri/latex-editor-updater.key` in `desktop/` and pick a password.
2. Save the private key's contents as the Actions secret `TAURI_SIGNING_PRIVATE_KEY` and the password as `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, in the **Production** environment (or the repository).
3. Save the public key's contents (`.key.pub`) as the Actions **variable** `TAURI_UPDATER_PUBKEY` in the same place. It isn't secret.
4. Back up the private key and password outside GitHub.

The first release after that is the first one installed apps can update **from** onward: apps built before the key existed have no updater, so people install that release by hand once.

**To check on real hardware (#174):** install release N, publish N+1, and see the card, the restart and the new version on each OS; a tampered `latest.json` signature refused; the `.deb` path on Ubuntu.

## Releases and signing

**Now:** `.github/workflows/desktop.yml` builds on Linux (Ubuntu 22.04, for older glibc: `.deb`, `.rpm`, AppImage), Windows (`.msi`, NSIS `.exe`) and macOS (a universal `.app` and `.dmg`). It runs:

- from `release.yml` for every release, which attaches the installers, their updater `.sig` files, `SHA256SUMS.txt` and `latest.json` to the GitHub release ("Updates" above);
- from Actions > **Desktop app** > Run workflow (optionally with a tag), which only uploads workflow artifacts, kept for 14 days. A manual run doesn't use the Production environment, because Production only allows deployments from `main` and tags, which refused a run on `staging` before any runner started. So it builds with no Production variables or secrets: unsigned installers, no updater, Google Drive not configured, and the default P2P app id. That's enough to check that the app builds on each OS. Only a release (`release.yml`, `release: true`) runs in Production.

Release builds use the Production environment's `VITE_P2P_APP_ID`, `VITE_STUN_URL` and `VITE_DOCS_BASE_URL`, so the app meets the website's peers.

The builds aren't code-signed for Windows or macOS yet (the updater's signature is separate), so people see warnings:

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
- **Linux:** there's no OS signing. Every release has `SHA256SUMS.txt` (#179). Consider Flathub later (which also settles the WebKitGTK question for that package).

## Security

- **Only bundled content.** The window loads `frontend/dist` from the app. There's no remote URL and no `remote` capability, so no web page ever gets Tauri APIs.
- **CSP.** The app uses the web CSP unchanged: the `<meta>` tag in the bundled `index.html`. Tauri's own `app.security.csp` stays `null`. If both were set, the browser would enforce both, and the effective policy would be their intersection. A Tauri copy could only drift from the meta tag, for example when the build adds custom `VITE_P2P_RENDEZVOUS` trackers to the meta tag. Desktop builds must not use the `VITE_DISABLE_CSP=1` rollback switch.

  When a feature needs Tauri IPC from the page, `connect-src` needs `ipc: http://ipc.localhost`. Add it to the meta policy then (it means nothing on the web) and update `frontend/src/security/cspPolicy.test.ts`.
- **Capabilities.** There's one capability, `main-window`, and not even `core:default`. It has `opener:allow-open-url`, scoped to `https://*`, so the page can open https links in the system browser (issue #205); for local folder projects (#178) `dialog:allow-open` and a fixed list of fs commands with no path scope, so only folders picked in the dialog are reachable ("Storage: local folders" above); for Google sign-in (#177) the app's three sign-in commands ("Google sign-in" above); and for updates (#179) the app's two update commands, with no `updater:*` permission ("Updates" above); and for WebRTC on Linux (#176) the seven `rtc_*` commands ("WebRTC in the shell" above). Each follow-up adds only what it uses.
- **WebAssembly in the CSP.** The meta policy's `script-src` has `'wasm-unsafe-eval'` for Compile PDF's WebAssembly TeX engine (issue #240). The desktop app gets it from the same tag, with no Tauri CSP to change, and `npm run check` fails if it's missing or if `'unsafe-eval'` ever appears. It allows WebAssembly compilation only, not JavaScript `eval`. The engine worker loads from the app's own origin and gets no CSP header from Tauri, so it needs nothing more. WKWebView (macOS 11+) and WebView2 know the keyword; on Linux it needs WebKitGTK 2.38 or later.
- **IPC in the CSP.** The opener goes through Tauri IPC, so the meta policy's `connect-src` has `ipc: http://ipc.localhost` (it means nothing on the web). `frontend/src/security/cspPolicy.test.ts` allows exactly those.
- `withGlobalTauri` is off, and the asset protocol is off. The initial load imports nothing from Tauri; the opener call goes through `__TAURI_INTERNALS__`, which Tauri defines in every page it loads. The folder code uses `@tauri-apps/plugin-fs` and `@tauri-apps/plugin-dialog` from a lazy chunk.
- `freezePrototype` is off. Freezing `Object.prototype` breaks code that assigns over an inherited property (the "override mistake"), and LaTeX.js, pdf.js and CodeMirror haven't been tested with it.
- **Links and navigation** are guarded in the shell, not only in the page ("Links and navigation" above). The only header the shell changes is `Access-Control-Allow-Origin: *` on the bundled LaTeX.js files ("Offline preview"). The only script it adds to the page is the `__LCE_DESKTOP__` flags ("Google sign-in", "WebRTC in the shell").
- `desktop/scripts/check-desktop-config.mjs` (`npm run check` in `desktop/`, run by the workflow) fails if any of the above drifts: the exact permission list, the app commands in `build.rs` and `invoke_handler`, that the page's token type never carries a refresh token, the `drive.file` scope, the one initialization script, no OAuth client in the sources, no updater settings in `tauri.conf.json` and only the GitHub endpoint in the release overlay, the shell WebRTC's mDNS mode and no media, `"create": false` on the window, the `on_navigation` and `on_new_window` guards, `https`-only opening, the CORS header limited to `/latexjs/`, and the `build:desktop` and `dev:desktop` commands.

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
   - Linux WebRTC (done, #176, needs checking on hardware);
   - Google sign-in (done, #177, needs the Desktop OAuth client and checking on hardware);
   - external links (done, #181);
   - macOS menu keys;
   - signing.
3. **Desktop 1.0:**
   - local folder projects (done, #178, needs checking on hardware);
   - the updater (done, #179, needs the maintainer's key pair);
   - installers attached to every GitHub release (done, #179);
   - LaTeX.js and its fonts bundled so the preview works offline (done, #181).
4. **Later:** a real TeX engine in the native build (#43), and iOS and Android from the same Tauri project once the web layout works on phones and tablets (#123).

## Follow-up issues

These are listed in the PR that added this page, to be filed:

- Desktop: check the app on Windows, macOS and Linux, and measure startup and memory.
- Desktop: WebRTC on Linux (DataChannels in Rust behind Trystero's `rtcPolyfill`), #176 (done). The notice when WebRTC is missing is done (#205).
- Desktop: Google sign-in through the system browser (loopback and PKCE, a Desktop OAuth client, tokens in the keychain, and the Picker question), #177 (done).
- Desktop: a local folder storage provider, #178 (done).
- Desktop: auto-updater, and installers attached to releases, #179 (done).
- Desktop: macOS notarization and Windows code signing (maintainer setup).
- Desktop: shell polish, #181 (external links in the browser, navigation lock, wording, offline preview assets: done). Still open: the macOS menu and Cmd+W, and the web update card replaced in the app.
