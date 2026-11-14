#!/usr/bin/env node
// Interop check for the desktop app's native WebRTC (issue #176): a real Chromium peer connection
// talks to src-tauri/src/native_rtc.rs (through examples/rtc_interop.rs) over loopback, with full
// SDP like Trystero's torrent strategy, and sends a 16 KiB message and a short one that come back.
//
// Needs Playwright with Chromium. Run in desktop/:
//   cargo build --manifest-path src-tauri/Cargo.toml --example rtc_interop && node scripts/rtc-interop.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const binary = join(here, '..', 'src-tauri', 'target', 'debug', 'examples', process.platform === 'win32' ? 'rtc_interop.exe' : 'rtc_interop');

// MDNS=0 turns off Chromium's mDNS host names, for networks where multicast doesn't work (CI
// containers); by default Chromium hides its IP behind a .local name, as it does for real users.
const browser = await chromium.launch({ args: process.env.MDNS === '0' ? ['--disable-features=WebRtcHideLocalIpsWithMdns'] : [] });

/** Wait for Chromium's ICE gathering the way Trystero does without trickle. */
const gatherInPage = `new Promise((resolve) => {
  const pc = window.pc;
  if (pc.iceGatheringState === 'complete') resolve();
  pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && resolve());
  pc.addEventListener('icecandidate', (event) => event.candidate && setTimeout(resolve, 500));
  setTimeout(resolve, 5000);
})`;

async function run(rustOffers) {
  const rust = spawn(binary, rustOffers ? ['--offer'] : [], { stdio: ['pipe', 'pipe', 'inherit'] });
  // Lines can come before anyone asks for them, so keep them.
  const queued = [];
  const waiting = [];
  createInterface({ input: rust.stdout }).on('line', (line) => (waiting.length ? waiting.shift().resolve(line) : queued.push(line)));
  rust.on('exit', (code) => waiting.splice(0).forEach(({ reject }) => reject(new Error(`rtc_interop exited with ${code}`))));
  const nextLine = () =>
    queued.length ? Promise.resolve(JSON.parse(queued.shift())) : new Promise((resolve, reject) => waiting.push({ resolve: (line) => resolve(JSON.parse(line)), reject }));
  const page = await browser.newPage();
  try {
    await page.goto('about:blank');
    await page.evaluate(() => {
      window.pc = new RTCPeerConnection({ iceServers: [] });
      window.received = [];
      const setup = (dc) => {
        window.dc = dc;
        dc.binaryType = 'arraybuffer';
        dc.onmessage = (event) => window.received.push(new Uint8Array(event.data));
      };
      window.pc.ondatachannel = (event) => setup(event.channel);
      window.setupChannel = setup;
    });
    if (rustOffers) {
      const offer = await nextLine();
      const answer = await page.evaluate(
        async ([offer, gather]) => {
          await window.pc.setRemoteDescription(offer);
          await window.pc.setLocalDescription();
          await eval(gather);
          return { type: 'answer', sdp: window.pc.localDescription.sdp };
        },
        [offer, gatherInPage],
      );
      rust.stdin.write(`${JSON.stringify(answer)}\n`);
    } else {
      const offer = await page.evaluate(async (gather) => {
        window.setupChannel(window.pc.createDataChannel('data'));
        await window.pc.setLocalDescription();
        await eval(gather);
        return { type: 'offer', sdp: window.pc.localDescription.sdp };
      }, gatherInPage);
      rust.stdin.write(`${JSON.stringify(offer)}\n`);
      const answer = await nextLine();
      await page.evaluate((answer) => window.pc.setRemoteDescription(answer), answer);
    }
    return await page.evaluate(async () => {
      const deadline = Date.now() + 15000;
      while (window.dc?.readyState !== 'open' && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      if (window.dc?.readyState !== 'open') return { connection: window.pc.connectionState, open: false };
      const big = new Uint8Array(16 * 1024).map((_, i) => i % 251);
      window.dc.send(big);
      window.dc.send(new TextEncoder().encode('hello'));
      while (window.received.length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      const decoder = new TextDecoder();
      const [first, second] = window.received;
      return {
        connection: window.pc.connectionState,
        open: true,
        bigEchoed: first?.length === big.length + 5 && decoder.decode(first.slice(0, 5)) === 'echo:' && first.slice(5).every((b, i) => b === big[i]),
        small: second ? decoder.decode(second) : null,
      };
    });
  } finally {
    rust.kill();
    await page.close();
  }
}

try {
  for (const rustOffers of [false, true]) {
    const result = await run(rustOffers);
    const who = rustOffers ? 'native_rtc offers, Chromium answers' : 'Chromium offers, native_rtc answers';
    console.log(who, JSON.stringify(result));
    if (result.connection !== 'connected' || !result.bigEchoed || result.small !== 'echo:hello') {
      console.error(`Interop check failed: ${who}.`);
      process.exitCode = 1;
    }
  }
  if (!process.exitCode) console.log('Chromium <-> native_rtc: connected both ways, 16 KiB and short messages echoed.');
} finally {
  await browser.close();
}
