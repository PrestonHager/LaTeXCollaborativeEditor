# QA runbook

How to check that two people can share a project and edit it together.
Run the automated test first, then the manual checks before a release.

## Automated two-browser test

The test lives in `e2e/` with its own `package.json`, so Playwright never ends up in the app bundle.
It starts a WebTorrent tracker on `ws://127.0.0.1:4185` (see "Local tracker" below), builds the app into `frontend/dist-e2e/` with that tracker as its only rendezvous, serves it with `vite preview` on `http://127.0.0.1:4184/`, and opens two separate browser contexts.
The host uploads an image and clicks Share, then the guest opens the room link.
It checks that the guest sees the file tree, that edits sync both ways, and that the image shows up on the guest.

It runs as four Playwright projects, since WebRTC differs between engines:

- `chromium`, `firefox` and `webkit`: host and guest both in that browser.
- `chromium-host-firefox-guest`: the host in Chromium and the guest in Firefox.

Set it up once:

```sh
npm ci --prefix frontend
npm ci --prefix e2e
npx --prefix e2e playwright install chromium firefox webkit
```

Then run all four from the repo root:

```sh
npm run test:e2e
```

To run one project, go into `e2e/` and pass `--project`, for example `cd e2e && npx playwright test --project=firefox`.
You only need the browsers for the projects you run.

A run usually takes under a minute per project.
Each step waits up to 90 seconds, and a failed run is retried once locally and twice in CI.
In CI the `e2e-sync` job runs once per project, as `e2e-sync (<project>)`, so each browser passes or fails on its own.
Those jobs are still non-blocking, so look at a job's report if it goes red.
The report and traces land in `e2e/playwright-report/` and `e2e/test-results/`, and CI uploads them as `e2e-report-<project>`.

To point the test at an app that's already running, set `E2E_BASE_URL`, for example `E2E_BASE_URL=https://latex.prestonhager.com/ npm run test:e2e`.
That site uses the trackers it was built with, so no local tracker starts.
To use another port for the local server, set `E2E_PORT`.

### Local tracker

Peers find each other through a WebTorrent tracker, and the public ones made CI flaky (issue #167), so the test runs its own.
`e2e/tracker/server.mjs` runs the `bittorrent-tracker` package's server, WebSocket only, on `127.0.0.1`.
Playwright starts it as a `webServer` before the app and waits for `http://127.0.0.1:4185/stats.json`, which also shows how many peers have announced.
Its log lines show up in the test output as `[WebServer] [tracker] ...`.

- It's test infrastructure, not a signaling server for users. It's a dev dependency of `e2e/` only, nothing in `frontend/` imports it, and it never deploys.
  Like the public trackers, it only passes WebRTC offers and answers between the peers. The document still goes over WebRTC.
- The e2e build sets `VITE_P2P_RENDEZVOUS=ws://127.0.0.1:4185`, and the `csp` plugin in `frontend/vite.config.ts` adds that origin to the CSP `connect-src`, in the e2e build only.
  It builds to `frontend/dist-e2e/` (gitignored), so it never mixes with `frontend/dist/`. Production builds keep the default trackers and CSP, and `src/security/cspPolicy.test.ts` checks the shipped policy doesn't allow the local tracker.
- STUN stays as it is (`VITE_STUN_URL`, or Google's server by default). Both browsers run on the same machine, so WebRTC connects with host candidates and doesn't need STUN to answer.
  The test passes in a sandbox that blocks Google's STUN server, so it doesn't depend on it.
- Set `E2E_TRACKER_PORT` if 4185 is taken.
- Set `E2E_PUBLIC_TRACKERS=1` to build with the public trackers instead and start no local tracker, for example to check that they still work.

### Using a browser that's already installed

Each Playwright release pins its own browser builds. If that build isn't downloaded and you can't run `playwright install`, point Chromium at one that is with `E2E_CHROMIUM_EXECUTABLE`:

```sh
cd e2e && E2E_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium npx playwright test --project=chromium
```

It applies to the `chromium` and `chromium-host-firefox-guest` projects. The browser should be close to the pinned version.

## Load time check

This checks how long a first visit takes before you can type in the editor, over a throttled connection.
It's in `e2e/perf/` with its own config, so `npm run test:e2e`, CI and `npm run build` don't run it.
With the same one-time setup as above, run it from the repo root:

```sh
npm run test:load-time
```

It builds the app, serves it with `vite preview`, and loads it three times in fresh browser contexts with the cache off.
The defaults match the bundle budget in `frontend/scripts/check-bundle-size.mjs`: 10 Mbps down and a 50 ms round trip.
It prints the median time from navigation to an editor that accepts typing, and fails if that's over 1000 ms.
Change the conditions with environment variables:

- `LOAD_TIME_MBPS` (default 10) and `LOAD_TIME_RTT_MS` (default 50) for the network.
- `LOAD_TIME_CPU` for Chrome's CPU slowdown, for example 4 for a mid-range phone (default 1, no slowdown).
- `LOAD_TIME_RUNS` (default 3) and `LOAD_TIME_MAX_MS` (default 1000).
- `E2E_BASE_URL` to measure a deployed site instead, for example `E2E_BASE_URL=https://latex.prestonhager.com/ npm run test:load-time`.

The time depends on the machine, so compare runs on the same one.

## Local manual check

1. Run `npm run dev` and open `http://localhost:5173/` in one browser.
2. Click Share and open the link in a second browser, or a private window.
3. Check that the status pill says Connected on both sides.
4. Check that the guest sees the same file tree, including folders.
5. Type in each window and check the other one updates within a second or two.
6. Upload an image on the host and open it on the guest.
7. Reload the host tab and check that the guest reconnects and keeps syncing.

## Remote check

Do the same steps against the deployed site with two people on different networks, for example one on home Wi-Fi and one on a phone hotspot.
If the peers never connect, it's usually a strict NAT and needs a TURN server, see `docs/deployment.md`.
Note the network types in the PR or release notes.

## Cross-browser check

Run the local or remote steps with the host and guest in different browsers.
Try at least these pairs:

- Chrome and Firefox
- Chrome and Safari (or another WebKit browser)
- Firefox and Safari

Also check that the preview renders and the menus work in each browser.
The automated test covers each engine on its own and a Chromium host with a Firefox guest.
It uses Playwright's own builds, so the other pairs and the branded browsers still need a manual check.
