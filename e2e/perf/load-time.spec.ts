import { expect, test } from '@playwright/test';

// Loads the built app over a throttled connection and reports how long until the editor can be typed in.
// The defaults match the assumptions in frontend/scripts/check-bundle-size.mjs: 10 Mbps down and a 50 ms round trip.
// Override them with LOAD_TIME_MBPS, LOAD_TIME_RTT_MS and LOAD_TIME_CPU (Chrome's CPU slowdown factor, 1 = none).
// LOAD_TIME_MAX_MS fails the test above that time (default 1000 ms, loose on purpose since machines differ).
const mbps = Number(process.env.LOAD_TIME_MBPS ?? 10);
const rttMs = Number(process.env.LOAD_TIME_RTT_MS ?? 50);
const cpuRate = Number(process.env.LOAD_TIME_CPU ?? 1);
const maxMs = Number(process.env.LOAD_TIME_MAX_MS ?? 1000);
const runs = Number(process.env.LOAD_TIME_RUNS ?? 3);

test('editor is interactive quickly on a throttled connection', async ({ browser }) => {
  const results: { interactiveMs: number; transferKb: number }[] = [];
  for (let run = 0; run < runs; run++) {
    // A fresh context each run, so nothing is cached, like a first visit.
    const context = await browser.newContext();
    await context.addInitScript(() => localStorage.setItem('latex-editor.tour-seen', '1'));
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: rttMs,
      downloadThroughput: (mbps * 1_000_000) / 8,
      uploadThroughput: (mbps * 1_000_000) / 8 / 4,
    });
    if (cpuRate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });

    let transferBytes = 0;
    cdp.on('Network.loadingFinished', (event) => {
      transferBytes += event.encodedDataLength;
    });

    await page.goto('/', { waitUntil: 'commit' });
    // Check on every frame inside the page and read the time there, measured from the start of
    // navigation, so Playwright's polling interval doesn't add to the number.
    const ready = await page.waitForFunction(
      () => {
        const el = document.querySelector('#editor-pane .cm-content');
        const loading = document.getElementById('app-loading');
        const usable =
          el?.getAttribute('contenteditable') === 'true' &&
          el.getBoundingClientRect().height > 0 &&
          !loading?.classList.contains('is-active');
        return usable ? performance.now() : false;
      },
      null,
      { polling: 'raf' },
    );
    const interactiveMs = Math.round((await ready.jsonValue()) as number);
    const editor = page.locator('#editor-pane .cm-content');
    const transferAtInteractive = transferBytes;

    // Check it really takes input.
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('%ready');
    await expect(editor).toContainText('%ready');

    results.push({ interactiveMs, transferKb: Math.round(transferAtInteractive / 1000) });
    await context.close();
  }

  const times = results.map((r) => r.interactiveMs).sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const summary =
    `Editor interactive at ${mbps} Mbps, ${rttMs} ms RTT, CPU x${cpuRate}: ` +
    `median ${median} ms over ${runs} runs (${times.join(', ')} ms), ` +
    `about ${results[0].transferKb} kB transferred by then`;
  console.log(summary);
  test.info().annotations.push({ type: 'load-time', description: summary });
  expect(median, summary).toBeLessThanOrEqual(maxMs);
});
