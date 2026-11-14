// Stand-ins for the dialogs, palette and tour, which load on first use instead of in the initial
// bundle. Each one has the same methods main.ts and commands.ts call on the real thing; the
// markup is already in index.html, so nothing is shown until the code arrives. preload() is
// called when the browser is idle and when the pointer reaches the menus, so a first click or
// shortcut normally finds the code loaded. A failed load goes to onError with a retry, which main.ts
// runs when the browser comes back online, or it offers a reload after a deploy.
import { lazyModule } from './lazy';
import type { createCommandPalette, PaletteCommand } from '../ui/commandPalette';
import type { createSettingsDialog } from '../ui/settingsDialog';
import type { createKeybindSettings } from '../ui/keybindSettings';
import type { createTour, TourSeen } from '../ui/tour';
import type { createProjectsDialog } from '../ui/projectsDialog';
import type { createUploadDialog } from '../ui/uploadDialog';
import type { createAboutDialog } from '../ui/aboutDialog';
import type { setupShareButton } from '../ui/shareButton';
import type { createFileViewer, ViewerFile } from '../ui/fileViewer';
import type { ConfirmOptions, NoticeOptions, PromptOptions } from '../ui/dialogs';
import type { TemplatesUiDeps } from '../templates/templatesUi';
import type { BuildInfo } from './buildInfo';
import type { ProjectSummary } from '../storage/providers/types';

/**
 * Says a lazy feature didn't load. `feature` reads as the start of a sentence, like "Settings".
 * `retry` does what was asked again, for when the load failed only because the browser was offline.
 */
export type LazyLoadError = (feature: string, error: unknown, retry?: () => void) => void;

type Loader<T> = { load?: () => Promise<T> };

/** Run `use` on the loaded instance, or report why it couldn't load and how to try again. */
function withInstance<T>(get: () => Promise<T>, feature: string, onError: LazyLoadError, use: (instance: T) => void) {
  void get().then(use, (error: unknown) => onError(feature, error, () => withInstance(get, feature, onError, use)));
}

export function lazyCommandPalette(
  overlay: HTMLElement,
  options: Parameters<typeof createCommandPalette>[1],
  onError: LazyLoadError,
  deps: Loader<typeof import('../ui/commandPalette')> = {},
) {
  // Commands set before the palette loads are kept and handed over when it does.
  let commands: PaletteCommand[] = [];
  const palette = lazyModule(() =>
    (deps.load ?? (() => import('../ui/commandPalette')))().then(({ createCommandPalette }) => {
      const instance = createCommandPalette(overlay, options);
      instance.setCommands(commands);
      return instance;
    }),
  );
  return {
    setCommands(next: PaletteCommand[]) {
      commands = next;
      palette.current()?.setCommands(next);
    },
    toggle: () => withInstance(palette.get, 'The command palette', onError, (instance) => instance.toggle()),
    isOpen: () => palette.current()?.isOpen() ?? false,
    preload: palette.preload,
  };
}

/** The settings dialog and its keybind editor, which lives inside it. They load together. */
export function lazySettings(
  dialog: HTMLDialogElement,
  options: Parameters<typeof createSettingsDialog>[1],
  keybindRoot: HTMLElement,
  keybindOptions: Parameters<typeof createKeybindSettings>[1],
  onError: LazyLoadError,
  deps: Loader<[typeof import('../ui/settingsDialog'), typeof import('../ui/keybindSettings')]> = {},
) {
  const load = deps.load ?? (() => Promise.all([import('../ui/settingsDialog'), import('../ui/keybindSettings')]));
  const settings = lazyModule(() =>
    load().then(([{ createSettingsDialog }, { createKeybindSettings }]) => ({
      dialog: createSettingsDialog(dialog, options),
      keybinds: createKeybindSettings(keybindRoot, keybindOptions),
    })),
  );
  return {
    settingsDialog: {
      open: () => withInstance(settings.get, 'Settings', onError, (instance) => instance.dialog.open()),
      // Until it loads, the dialog can't be open, so there's nothing to redraw.
      refresh: () => settings.current()?.dialog.refresh(),
      isOpen: () => settings.current()?.dialog.isOpen() ?? false,
    },
    keybindSettings: {
      refresh: () => settings.current()?.keybinds.refresh(),
    },
    preload: settings.preload,
  };
}

export function lazyTour(
  card: HTMLElement,
  stepList: HTMLElement,
  options: Parameters<typeof createTour>[2] & { seen: TourSeen },
  onError: LazyLoadError,
  deps: Loader<typeof import('../ui/tour')> = {},
) {
  const tour = lazyModule(() => (deps.load ?? (() => import('../ui/tour')))().then(({ createTour }) => createTour(card, stepList, options)));
  return {
    start: () => withInstance(tour.get, 'The tour', onError, (instance) => instance.start()),
    /** Only fetch the tour for someone who hasn't seen it. */
    startIfNew() {
      if (options.seen.has()) return;
      withInstance(tour.get, 'The tour', onError, (instance) => instance.startIfNew());
    },
    preload: tour.preload,
  };
}

export function lazyProjectsDialog(
  dialog: HTMLDialogElement,
  options: Parameters<typeof createProjectsDialog>[1],
  onError: LazyLoadError,
  deps: Loader<typeof import('../ui/projectsDialog')> = {},
) {
  const projects = lazyModule(() =>
    (deps.load ?? (() => import('../ui/projectsDialog')))().then(({ createProjectsDialog }) => createProjectsDialog(dialog, options)),
  );
  return {
    open: (list: ProjectSummary[]) => withInstance(projects.get, 'The Open dialog', onError, (instance) => instance.open(list)),
    preload: projects.preload,
  };
}

export function lazyUploadDialog(
  dialog: HTMLDialogElement,
  options: Parameters<typeof createUploadDialog>[1],
  onError: LazyLoadError,
  deps: Loader<typeof import('../ui/uploadDialog')> = {},
) {
  const upload = lazyModule(() =>
    (deps.load ?? (() => import('../ui/uploadDialog')))().then(({ createUploadDialog }) => createUploadDialog(dialog, options)),
  );
  return {
    open: (folder?: string) => withInstance(upload.get, 'The upload dialog', onError, (instance) => instance.open(folder)),
    preload: upload.preload,
  };
}

/**
 * The template picker, Save as Template and the profile (#74), with the built-in templates. Unlike
 * the others, a failed load rejects instead of going to onError: New Project falls back to an
 * empty project when offline, and the command runner reports the rest (app/commands.ts).
 */
export function lazyTemplates(options: TemplatesUiDeps, deps: Loader<typeof import('../templates/templatesUi')> = {}) {
  const ui = lazyModule(() => (deps.load ?? (() => import('../templates/templatesUi')))().then(({ createTemplatesUi }) => createTemplatesUi(options)));
  return {
    openNew: () => ui.get().then((instance) => instance.openNew()),
    saveAsTemplate: () => ui.get().then((instance) => instance.saveAsTemplate()),
    editProfile: () => ui.get().then((instance) => instance.editProfile()),
    preload: ui.preload,
  };
}

export function lazyAboutDialog(
  dialog: HTMLDialogElement,
  info: BuildInfo,
  actions: Parameters<typeof createAboutDialog>[2],
  onError: LazyLoadError,
  deps: Loader<typeof import('../ui/aboutDialog')> = {},
) {
  const about = lazyModule(() => (deps.load ?? (() => import('../ui/aboutDialog')))().then(({ createAboutDialog }) => createAboutDialog(dialog, info, actions)));
  return {
    open: () => withInstance(about.get, 'About', onError, (instance) => instance.open()),
    preload: about.preload,
  };
}

/**
 * The Share button's popover (issue #231). The button is on screen from the start, so until the
 * popover's code loads, a click loads it and then opens it. Until then the popover stays closed and
 * out of the tab order, as setupShareButton leaves it. The code is preloaded when the pointer or
 * focus reaches Share, with the P2P code.
 */
export function lazyShareButton(
  config: Parameters<typeof setupShareButton>[0],
  onError: LazyLoadError,
  deps: Loader<typeof import('../ui/shareButton')> = {},
) {
  const share = lazyModule(() => (deps.load ?? (() => import('../ui/shareButton')))().then(({ setupShareButton }) => setupShareButton(config)));
  config.button.dataset.sharing = String(Boolean(config.guestRoomId));
  config.popover.inert = true;
  // Once loaded, setupShareButton's own click handler takes over.
  config.button.addEventListener('click', () => {
    if (!share.current()) withInstance(share.get, 'Sharing', onError, (instance) => instance.open());
  });
  return {
    copyOrOpen: () => withInstance(share.get, 'Sharing', onError, (instance) => instance.copyOrOpen()),
    preload: share.preload,
  };
}

/**
 * The in-app confirm, prompt and notice dialogs (ui/dialogs.ts, issue #231). They're already
 * promises, so these wait for the code and then show the dialog. If it can't load, onError says so
 * and the dialog counts as cancelled: confirm gives false and prompt null, so nothing destructive runs.
 */
export function lazyDialogs(onError: LazyLoadError, deps: Loader<typeof import('../ui/dialogs')> = {}) {
  const dialogs = lazyModule(deps.load ?? (() => import('../ui/dialogs')));
  const run = <T>(cancelled: T, show: (module: typeof import('../ui/dialogs')) => Promise<T>): Promise<T> =>
    dialogs.get().then(show, (error: unknown) => {
      onError('The dialog', error);
      return cancelled;
    });
  return {
    confirmDialog: (options: ConfirmOptions) => run(false, (module) => module.confirmDialog(options)),
    promptDialog: (options: PromptOptions) => run<string | null>(null, (module) => module.promptDialog(options)),
    noticeDialog: (options: NoticeOptions) => run<void>(undefined, (module) => module.noticeDialog(options)),
    preload: dialogs.preload,
  };
}


/**
 * The viewer for images, PDFs and other binary files (issue #231). Until it loads, only the latest
 * show or hide is kept, and it runs once the code is in, so the viewer always ends up showing the
 * file that's open now.
 */
export function lazyFileViewer(
  root: HTMLElement,
  options: Parameters<typeof createFileViewer>[1],
  onError: LazyLoadError,
  deps: Loader<typeof import('../ui/fileViewer')> = {},
) {
  type Viewer = ReturnType<typeof createFileViewer>;
  const viewer = lazyModule(() => (deps.load ?? (() => import('../ui/fileViewer')))().then(({ createFileViewer }) => createFileViewer(root, options)));
  let pending: ((instance: Viewer) => void) | null = null;
  let loading = false;
  const load = () => {
    loading = true;
    viewer.get().then(
      (loaded) => {
        loading = false;
        const next = pending;
        pending = null;
        next?.(loaded);
      },
      (error: unknown) => {
        loading = false;
        onError('The file viewer', error, () => {
          if (!loading && pending) load();
        });
      },
    );
  };
  const run = (use: (instance: Viewer) => void) => {
    const instance = viewer.current();
    if (instance) {
      use(instance);
      return;
    }
    pending = use;
    if (!loading) load();
  };
  return {
    show: (file: ViewerFile) => run((instance) => instance.show(file)),
    hide: () => {
      // Nothing to hide before the viewer has shown anything.
      if (!viewer.current() && pending === null) return;
      run((instance) => instance.hide());
    },
    preload: viewer.preload,
  };
}
