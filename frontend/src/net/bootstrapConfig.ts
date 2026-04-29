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

export function getBootstrapConfig(origin = window.location.origin): BootstrapConfig {
  const isLocalhost = origin.includes('localhost');
  const environment = isLocalhost ? 'localhost' : 'production';

  const defaultRendezvous = isLocalhost
    ? ['wss://tracker.openwebtorrent.com', 'wss://tracker.btorrent.xyz']
    : ['wss://tracker.openwebtorrent.com', 'wss://tracker.webtorrent.dev'];

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
