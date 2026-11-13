// The "What's new" changelog dialog (issue #140, markup in index.html #changelog-dialog).
// Help → About → View changelog opens it with the changelog bundled in this build.
// "What's new" on the update prompt opens it with the new deploy's CHANGELOG.md, fetched from
// next to index.html (the build copies it there), falling back to the bundled one.
// This file is small and in the initial load; the changelog text and its renderer (changelogView.ts)
// are imported only when the dialog first opens.
import { returnFocusOnClose } from './focusReturn';
import { whenOnline } from '../app/lazy';

type FetchLike = (input: string, init?: RequestInit) => Promise<{ ok: boolean; text: () => Promise<string> }>;

type ChangelogView = {
  renderChangelog: (container: HTMLElement, currentVersion: string) => void;
  renderUpdateChangelog: (container: HTMLElement, currentVersion: string, url: string, fetchImpl?: FetchLike) => Promise<unknown>;
};

/** Which changelog to show: the one in this build, or the newly deployed one. */
export type ChangelogSource = 'build' | 'update';

type ChangelogDialogOptions = {
  /** The running version (buildInfo), so its section gets marked. */
  version: string;
  /** Where the deployed CHANGELOG.md lives, e.g. `${import.meta.env.BASE_URL}CHANGELOG.md`. */
  updateUrl?: string;
  /** Load the renderer. Defaults to the lazy chunk; tests pass their own. */
  load?: () => Promise<ChangelogView>;
  fetch?: FetchLike;
  now?: () => number;
};

const DESCRIPTIONS: Record<ChangelogSource, string> = {
  build: 'Changes in each version, newest first.',
  update: "What's in the new version, newest first.",
};

export function createChangelogDialog(dialog: HTMLDialogElement, options: ChangelogDialogOptions) {
  const find = <T extends HTMLElement>(selector: string) => {
    const el = dialog.querySelector<T>(selector);
    if (!el) throw new Error(`Changelog dialog markup is missing ${selector}`);
    return el;
  };
  const body = find<HTMLElement>('#changelog-body');
  const description = find<HTMLElement>('#changelog-dialog-description');
  const importView = options.load ?? (() => whenOnline(() => import('./changelogView')));
  // Keep the loaded module, and forget a failed load so the next open tries again.
  let viewPromise: Promise<ChangelogView> | null = null;
  const load = () => {
    viewPromise ??= importView().catch((error: unknown) => {
      viewPromise = null;
      throw error;
    });
    return viewPromise;
  };
  const focusReturn = returnFocusOnClose(dialog);
  // The bundled changelog never changes, so it's drawn once. The update's is fetched on each open.
  let rendered: { source: ChangelogSource; done: Promise<void> } | null = null;

  const close = () => {
    // NOTE: jsdom has no dialog methods, so fall back to the open attribute there.
    if (typeof dialog.close === 'function') dialog.close();
    else {
      dialog.removeAttribute('open');
      dialog.dispatchEvent(new Event('close'));
    }
  };
  // Keys typed here are for the dialog, not the app's shortcuts (same as the dialogs in dialogs.ts).
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  find('#changelog-done').addEventListener('click', close);
  find('#changelog-close').addEventListener('click', close);
  // Close when a click starts and ends on the backdrop, like the settings dialog.
  let backdropPress = false;
  dialog.addEventListener('pointerdown', (event) => {
    backdropPress = event.target === dialog;
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog && backdropPress) close();
    backdropPress = false;
  });

  const message = (text: string) => {
    const p = dialog.ownerDocument.createElement('p');
    p.className = 'changelog-empty';
    p.textContent = text;
    return p;
  };

  /** The deployed file, with a query that gets past GitHub Pages' cache like version.json does. */
  const updateUrl = () => {
    const base = options.updateUrl ?? 'CHANGELOG.md';
    return `${base}${base.includes('?') ? '&' : '?'}t=${(options.now ?? Date.now)()}`;
  };

  const render = async (source: ChangelogSource) => {
    description.textContent = DESCRIPTIONS[source];
    body.setAttribute('aria-busy', 'true');
    body.replaceChildren(message('Loading the changelog...'));
    try {
      const view = await load();
      if (source === 'update') await view.renderUpdateChangelog(body, options.version, updateUrl(), options.fetch);
      else view.renderChangelog(body, options.version);
      body.scrollTop = 0;
    } catch {
      rendered = null;
      body.replaceChildren(message("Couldn't load the changelog. Check your connection and try again."));
    } finally {
      body.removeAttribute('aria-busy');
    }
  };

  return {
    /** Open the dialog. Resolves once the changelog is drawn (or failed to load). */
    open(source: ChangelogSource = 'build'): Promise<void> {
      focusReturn.remember();
      if (!dialog.open) {
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
      }
      if (!rendered || rendered.source !== source || source === 'update') rendered = { source, done: render(source) };
      return rendered.done;
    },
    close,
    isOpen: () => dialog.open,
    /**
     * Load the renderer ahead of time. A deploy replaces the old lazy chunks, so a tab that waits
     * until the update prompt to load it would find it gone. main.ts calls this when the tab is idle.
     */
    preload(): Promise<void> {
      return load().then(
        () => undefined,
        () => undefined,
      );
    },
  };
}
