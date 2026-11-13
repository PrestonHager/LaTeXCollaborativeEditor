// Ties the update check, the prompt and the reload together (issue #121), so main.ts only passes in
// how to save and reload. See docs/versioning.md for the version.json side.
import type { BuildInfo } from './buildInfo';
import { createUpdateChecker, isStaleChunkError, updatePromptText, type UpdateReason } from './updateCheck';
import { createUpdatePrompt } from '../ui/updatePrompt';
import { PROTOCOL_VERSION } from '../collab/messages';
import type { PeerVersion } from '../collab/session';

type UpdateFlowDeps = {
  root: HTMLElement;
  current: BuildInfo;
  /** Poll version.json. False in dev, where there's no deploy to find. */
  poll: boolean;
  baseUrl: string;
  room: () => { isHost: boolean; inRoom: boolean };
  /** Save everything. Resolves to null when it's safe to reload, or why it isn't. */
  flush: () => Promise<string | null>;
  /** Called right before the reload, so the leave prompt stays quiet. */
  beforeReload: () => void;
  reload: () => void;
  showNotice: (message: string) => void;
  fetch?: Parameters<typeof createUpdateChecker>[0]['fetch'];
  win?: Window;
  doc?: Document;
};

export function setupUpdateFlow(deps: UpdateFlowDeps) {
  const win = deps.win ?? window;
  const prompt = createUpdatePrompt(deps.root, {
    onReload: (force) => void reload(force),
  });
  let shownFor: UpdateReason | null = null;
  const warnedPeers = new Set<string>();

  function offer(reason: UpdateReason) {
    // A deploy we found ourselves outranks a peer's hint, so don't swap its text out.
    if (prompt.isOpen() && shownFor === 'deploy' && reason === 'peer') return;
    shownFor = reason;
    const { message, detail } = updatePromptText(reason, deps.room());
    prompt.show(message, detail);
  }

  async function reload(force: boolean) {
    if (!force) {
      const problem = await deps.flush();
      if (problem) {
        prompt.showSaveError(problem);
        return;
      }
    }
    deps.beforeReload();
    deps.reload();
  }

  /** A peer said which build it runs. Only another protocol is worth interrupting for. */
  function onPeerVersion(peer: PeerVersion) {
    if (peer.compatibility !== 'incompatible-protocol' || warnedPeers.has(peer.peerId)) return;
    warnedPeers.add(peer.peerId);
    if (peer.protocol > PROTOCOL_VERSION) offer('peer');
    else deps.showNotice('A collaborator is on an older version of the app. Ask them to reload the page to keep editing together.');
  }

  // After a deploy, an old tab can fail to load a lazy chunk the new build removed.
  const onStaleChunk = (event: Event) => {
    if (event.type === 'vite:preloadError' || isStaleChunkError((event as Event & { reason?: unknown }).reason)) offer('stale-chunk');
  };
  win.addEventListener('vite:preloadError', onStaleChunk);
  win.addEventListener('unhandledrejection', onStaleChunk);

  const checker = createUpdateChecker({
    current: deps.current,
    baseUrl: deps.baseUrl,
    fetch: deps.fetch,
    win,
    doc: deps.doc,
    onUpdate: () => offer('deploy'),
  });
  if (deps.poll) checker.start();

  return { checker, prompt, offer, onPeerVersion, reload };
}
