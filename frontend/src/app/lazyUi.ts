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
