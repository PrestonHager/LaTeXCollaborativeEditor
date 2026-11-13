// A WebTorrent tracker on 127.0.0.1 for the e2e tests only (issue #167).
// The e2e build points VITE_P2P_RENDEZVOUS here, so the two test browsers find each other
// without the public trackers. Like any tracker it only passes WebRTC offers and answers
// between peers; document content still goes over WebRTC. It is test infrastructure:
// never deployed and never used by the app's users (see docs/deployment.md).
// playwright.config.ts starts it as a webServer. Run it by hand with `node tracker/server.mjs`.
import Server from 'bittorrent-tracker/server';

const host = process.env.E2E_TRACKER_HOST ?? '127.0.0.1';
const port = Number(process.env.E2E_TRACKER_PORT ?? 4185);

// WebSocket only: no UDP or HTTP announce. Stats stay on so /stats.json can say when it's up.
const server = new Server({ udp: false, http: false, ws: true, stats: true });

server.on('error', (err) => {
  console.error(`[tracker] error: ${err.message}`);
  process.exitCode = 1;
});
server.on('warning', (err) => console.warn(`[tracker] warning: ${err.message}`));
server.on('start', (addr) => console.log(`[tracker] peer announced from ${addr}`));

server.listen(port, host, () => {
  console.log(`[tracker] listening on ws://${host}:${port} (stats: http://${host}:${port}/stats.json)`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
