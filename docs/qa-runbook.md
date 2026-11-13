# QA runbook

How to check that two people can share a project and edit it together.
Run the automated test first, then the manual checks before a release.

## Automated two-browser test

The test lives in `e2e/` with its own `package.json`, so Playwright never ends up in the app bundle.
It builds the app, serves it with `vite preview` on `http://127.0.0.1:4184/`, and opens two separate browser contexts.
The host uploads an image and clicks Share, then the guest opens the room link.
It checks that the guest sees the file tree, that edits sync both ways, and that the image shows up on the guest.

Set it up once:

```sh
npm ci --prefix frontend
npm ci --prefix e2e
npx --prefix e2e playwright install chromium
```

Then run it from the repo root:

```sh
npm run test:e2e
```

A run usually takes under a minute.
Peers find each other through public relays, so a slow or broken relay can make the test time out.
Each step waits up to 90 seconds, and a failed run is retried once locally and twice in CI.
In CI the `e2e-sync` job is non-blocking for the same reason, so look at its report if it goes red.
The report and traces land in `e2e/playwright-report/` and `e2e/test-results/`.

To point the test at an app that's already running, set `E2E_BASE_URL`, for example `E2E_BASE_URL=https://latex.prestonhager.com/ npm run test:e2e`.
To use another port for the local server, set `E2E_PORT`.

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
The automated test only covers Chromium for now.
