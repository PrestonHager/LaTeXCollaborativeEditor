import { setupUpdateFlow } from './updateFlow';
import { mountAppShell } from '../test/appShell';
import { PROTOCOL_VERSION } from '../collab/messages';
import type { BuildInfo } from './buildInfo';
import type { PeerVersion } from '../collab/session';

const current: BuildInfo = { version: '0.1.0', commit: 'abc1234', builtAt: '2026-11-13T10:00:00.000Z' };
const newer: BuildInfo = { ...current, commit: 'def5678' };

function setup(over: Partial<Parameters<typeof setupUpdateFlow>[0]> = {}) {
  mountAppShell();
  const root = document.getElementById('update-prompt') as HTMLElement;
  const win = new EventTarget() as unknown as Window;
  const beforeReload = vi.fn();
  const reload = vi.fn();
  const deps = {
    root,
    current,
    poll: false,
    baseUrl: 'https://example.com/',
    room: () => ({ isHost: true, inRoom: false }),
    flush: vi.fn(async (): Promise<string | null> => null),
    beforeReload,
    reload,
    showNotice: vi.fn(),
    fetch: vi.fn(async () => ({ ok: true, status: 200, json: async () => newer })),
    win,
    doc: Object.assign(new EventTarget(), { visibilityState: 'visible' }) as unknown as Document,
    ...over,
  };
  const flow = setupUpdateFlow(deps);
  const button = (name: string) => root.querySelector<HTMLButtonElement>(`[data-update-${name}]`)!;
  return { flow, deps, root, win, button, beforeReload, reload };
}

const peer = (over: Partial<PeerVersion>): PeerVersion => ({
  peerId: 'p1',
  protocol: PROTOCOL_VERSION,
  appVersion: '0.1.0',
  compatibility: 'same-build',
  ...over,
});

describe('setupUpdateFlow', () => {
  it('shows the prompt for a new deploy without taking focus', async () => {
    const { flow, root } = setup();
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    await flow.checker.check();
    expect(root.hidden).toBe(false);
    expect(root.textContent).toContain('A new version of the app is available.');
    expect(document.activeElement).toBe(input);
  });

  it('starts polling only when asked to', async () => {
    const { flow, deps } = setup({ poll: true });
    expect(flow.checker.isRunning()).toBe(true);
    await vi.waitFor(() => expect(deps.fetch).toHaveBeenCalled());
    flow.checker.stop();
    expect(setup().flow.checker.isRunning()).toBe(false);
  });

  it('saves, then reloads, on Reload', async () => {
    const { flow, deps, button, beforeReload, reload } = setup();
    flow.offer('deploy');
    button('reload').click();
    expect(button('reload').disabled).toBe(true);
    await vi.waitFor(() => expect(reload).toHaveBeenCalled());
    expect(deps.flush).toHaveBeenCalled();
    expect(beforeReload.mock.invocationCallOrder[0]).toBeLessThan(reload.mock.invocationCallOrder[0]);
  });

  it("doesn't reload when the save fails, and offers Reload anyway", async () => {
    const { flow, deps, root, button } = setup({ flush: vi.fn(async () => "Couldn't save: network.") });
    flow.offer('deploy');
    button('reload').click();
    await vi.waitFor(() => expect(button('anyway').hidden).toBe(false));
    expect(deps.reload).not.toHaveBeenCalled();
    expect(root.classList.contains('is-error')).toBe(true);
    expect(root.textContent).toContain("Couldn't save: network.");
    button('anyway').click();
    await vi.waitFor(() => expect(deps.reload).toHaveBeenCalled());
    expect(deps.flush).toHaveBeenCalledTimes(1);
  });

  it('hides on Later', () => {
    const { flow, root, button } = setup();
    flow.offer('deploy');
    button('later').click();
    expect(root.hidden).toBe(true);
  });

  it('asks to reload when a peer speaks a newer protocol, and only once per peer', () => {
    const { flow, root, button } = setup({ room: () => ({ isHost: false, inRoom: true }) });
    flow.onPeerVersion(peer({ compatibility: 'different-build', appVersion: '0.2.0' }));
    expect(root.hidden).toBe(true);
    flow.onPeerVersion(peer({ compatibility: 'incompatible-protocol', protocol: PROTOCOL_VERSION + 1 }));
    expect(root.textContent).toContain('A collaborator is on a newer version');
    expect(root.textContent).toContain('rejoin the room');
    button('later').click();
    flow.onPeerVersion(peer({ compatibility: 'incompatible-protocol', protocol: PROTOCOL_VERSION + 1 }));
    expect(root.hidden).toBe(true);
  });

  it('keeps the deploy wording when a peer also says so', () => {
    const { flow, root } = setup();
    flow.offer('deploy');
    flow.onPeerVersion(peer({ compatibility: 'incompatible-protocol', protocol: PROTOCOL_VERSION + 1 }));
    expect(root.textContent).toContain('A new version of the app is available.');
  });

  it('tells the newer side to wait for a peer on an older protocol', () => {
    const { flow, root, deps } = setup();
    flow.onPeerVersion(peer({ compatibility: 'incompatible-protocol', protocol: PROTOCOL_VERSION - 1 }));
    expect(root.hidden).toBe(true);
    expect(deps.showNotice).toHaveBeenCalledWith(expect.stringMatching(/older version/));
  });

  it('offers a reload when a lazy chunk from the old build is gone', () => {
    const { win, root } = setup();
    win.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new Error('Unrelated') }));
    expect(root.hidden).toBe(true);
    win.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new TypeError('Failed to fetch dynamically imported module: x.js') }));
    expect(root.textContent).toContain("couldn't load");
    root.hidden = true;
    win.dispatchEvent(new Event('vite:preloadError'));
    expect(root.hidden).toBe(false);
  });
});
