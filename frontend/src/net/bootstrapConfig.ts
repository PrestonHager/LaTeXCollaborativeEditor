export type BootstrapConfig = {
  appId: string;
  rendezvous: string[];
  iceServers: Array<{ urls: string; username?: string; credential?: string }>;
  environment: 'localhost' | 'production';
};

const parseCsv = (value?: string) =>
  (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

/** Hostnames that always mean this machine: `localhost`, any 127.x.x.x address, and IPv6 `::1`. */
export function isLocalhostOrigin(origin: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  );
}

export function getBootstrapConfig(origin = window.location.origin): BootstrapConfig {
  const environment = isLocalhostOrigin(origin) ? 'localhost' : 'production';

  // These are WebTorrent trackers for Trystero's torrent strategy. Nostr relays won't work here.
  const defaultRendezvous = [
    'wss://tracker.webtorrent.dev',
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.files.fm:7073/announce',
  ];

  const rendezvous = parseCsv(import.meta.env.VITE_P2P_RENDEZVOUS).length
    ? parseCsv(import.meta.env.VITE_P2P_RENDEZVOUS)
    : defaultRendezvous;

  const iceServers: Array<{ urls: string; username?: string; credential?: string }> = [
    { urls: import.meta.env.VITE_STUN_URL ?? 'stun:stun.l.google.com:19302' },
  ];

  const turnUrl = import.meta.env.VITE_TURN_URL;
  const turnUsername = import.meta.env.VITE_TURN_USERNAME;
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL;
  if (turnUrl && turnUsername && turnCredential) {
    iceServers.push({
      urls: turnUrl,
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return {
    appId: import.meta.env.VITE_P2P_APP_ID ?? 'latex-collaborative-editor',
    rendezvous,
    iceServers,
    environment,
  };
}
