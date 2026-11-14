import { lazyAboutDialog, lazyCommandPalette, lazyDialogs, lazyFileViewer, lazyProjectsDialog, lazySettings, lazyShareButton, lazyTemplates, lazyTour, lazyUploadDialog } from './lazyUi';
import { mountAppShell } from '../test/appShell';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const el = () => document.createElement('div');
const dialogEl = () => document.createElement('dialog');

describe('lazyCommandPalette', () => {
  const fakePalette = () => ({ setCommands: vi.fn(), toggle: vi.fn(), isOpen: vi.fn(() => true) });

  it('keeps commands until it loads, then hands them over and toggles', async () => {
    const palette = fakePalette();
    const createCommandPalette = vi.fn(() => palette);
    const load = vi.fn(async () => ({ createCommandPalette }) as never);
    const onError = vi.fn();
    const lazy = lazyCommandPalette(el(), { onSelect: vi.fn() }, onError, { load });
    const commands = [{ id: 'app.commandPalette', label: 'Palette' }] as never;
    lazy.setCommands(commands);
    expect(lazy.isOpen()).toBe(false);
    expect(load).not.toHaveBeenCalled();

    lazy.toggle();
    await settle();
    expect(palette.setCommands).toHaveBeenCalledWith(commands);
    expect(palette.toggle).toHaveBeenCalledTimes(1);
    expect(lazy.isOpen()).toBe(true);

    // Once loaded, calls go straight through.
    const next = [] as never;
    lazy.setCommands(next);
    expect(palette.setCommands).toHaveBeenLastCalledWith(next);
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports a failed load and tries again next time', async () => {
    const palette = fakePalette();
    const error = new Error('offline');
    const load = vi.fn().mockRejectedValueOnce(error).mockResolvedValue({ createCommandPalette: () => palette });
    const onError = vi.fn();
    const lazy = lazyCommandPalette(el(), { onSelect: vi.fn() }, onError, { load });
    lazy.toggle();
    await settle();
    expect(onError).toHaveBeenCalledWith('The command palette', error, expect.any(Function));
    lazy.toggle();
    await settle();
    expect(palette.toggle).toHaveBeenCalledTimes(1);
  });

  it('hands back a retry that does what was asked once it loads', async () => {
    const palette = fakePalette();
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ createCommandPalette: () => palette });
    const onError = vi.fn();
    lazyCommandPalette(el(), { onSelect: vi.fn() }, onError, { load }).toggle();
    await settle();
    const retry = onError.mock.calls[0][2] as () => void;
    retry();
    await settle();
    expect(palette.toggle).toHaveBeenCalledTimes(1);
  });

  it('preloads without opening', async () => {
    const palette = fakePalette();
    const load = vi.fn(async () => ({ createCommandPalette: () => palette }) as never);
    const lazy = lazyCommandPalette(el(), { onSelect: vi.fn() }, vi.fn(), { load });
    lazy.preload();
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    expect(palette.toggle).not.toHaveBeenCalled();
  });
});

describe('lazySettings', () => {
  const setup = () => {
    const dialog = { open: vi.fn(), refresh: vi.fn(), isOpen: vi.fn(() => true) };
    const keybinds = { refresh: vi.fn() };
    const createSettingsDialog = vi.fn(() => dialog);
    const createKeybindSettings = vi.fn(() => keybinds);
    const load = vi.fn(async () => [{ createSettingsDialog }, { createKeybindSettings }] as never);
    const onError = vi.fn();
    const lazy = lazySettings(dialogEl(), {} as never, el(), {} as never, onError, { load });
    return { dialog, keybinds, load, onError, lazy, createSettingsDialog, createKeybindSettings };
  };

  it('does nothing for refreshes before it loads', () => {
    const { lazy, load } = setup();
    expect(lazy.settingsDialog.isOpen()).toBe(false);
    lazy.settingsDialog.refresh();
    lazy.keybindSettings.refresh();
    expect(load).not.toHaveBeenCalled();
  });

  it('loads the dialog and the keybind editor together on open', async () => {
    const { lazy, dialog, keybinds, createSettingsDialog, createKeybindSettings } = setup();
    lazy.settingsDialog.open();
    await settle();
    expect(createSettingsDialog).toHaveBeenCalledTimes(1);
    expect(createKeybindSettings).toHaveBeenCalledTimes(1);
    expect(dialog.open).toHaveBeenCalled();
    expect(lazy.settingsDialog.isOpen()).toBe(true);
    lazy.settingsDialog.refresh();
    lazy.keybindSettings.refresh();
    expect(dialog.refresh).toHaveBeenCalled();
    expect(keybinds.refresh).toHaveBeenCalled();
  });

  it('reports a failed load as Settings', async () => {
    const error = new Error('offline');
    const onError = vi.fn();
    const lazy = lazySettings(dialogEl(), {} as never, el(), {} as never, onError, { load: () => Promise.reject(error) });
    lazy.settingsDialog.open();
    await settle();
    expect(onError).toHaveBeenCalledWith('Settings', error, expect.any(Function));
  });
});

describe('lazyTour', () => {
  const setup = (seen: boolean) => {
    const tour = { start: vi.fn(), startIfNew: vi.fn() };
    const load = vi.fn(async () => ({ createTour: () => tour }) as never);
    const lazy = lazyTour(el(), el(), { seen: { has: () => seen, mark: vi.fn() } }, vi.fn(), { load });
    return { tour, load, lazy };
  };

  it("doesn't fetch the tour for someone who has seen it", async () => {
    const { lazy, load } = setup(true);
    lazy.startIfNew();
    await settle();
    expect(load).not.toHaveBeenCalled();
  });

  it('starts it for a first-time visitor', async () => {
    const { lazy, tour } = setup(false);
    lazy.startIfNew();
    await settle();
    expect(tour.startIfNew).toHaveBeenCalled();
  });

  it('starts it on request', async () => {
    const { lazy, tour } = setup(true);
    lazy.start();
    await settle();
    expect(tour.start).toHaveBeenCalled();
  });
});

describe('lazyProjectsDialog and lazyUploadDialog', () => {
  it('open the dialog with its arguments once loaded', async () => {
    const projects = { open: vi.fn() };
    const upload = { open: vi.fn() };
    const lazyProjects = lazyProjectsDialog(dialogEl(), {} as never, vi.fn(), { load: async () => ({ createProjectsDialog: () => projects }) as never });
    const lazyUpload = lazyUploadDialog(dialogEl(), {} as never, vi.fn(), { load: async () => ({ createUploadDialog: () => upload }) as never });
    const list = [{ id: 'p1', name: 'One' }] as never;
    lazyProjects.open(list);
    lazyUpload.open('figures');
    await settle();
    expect(projects.open).toHaveBeenCalledWith(list);
    expect(upload.open).toHaveBeenCalledWith('figures');
  });

  it('report failed loads by name', async () => {
    const onError = vi.fn();
    const error = new Error('offline');
    lazyProjectsDialog(dialogEl(), {} as never, onError, { load: () => Promise.reject(error) }).open([]);
    lazyUploadDialog(dialogEl(), {} as never, onError, { load: () => Promise.reject(error) }).open();
    await settle();
    expect(onError).toHaveBeenCalledWith('The Open dialog', error, expect.any(Function));
    expect(onError).toHaveBeenCalledWith('The upload dialog', error, expect.any(Function));
  });

  it('load the real modules by default', async () => {
    // Without index.html's markup some of these throw while being created. preload() swallows
    // that, so this only checks the default loaders import cleanly and don't call onError.
    const onError = vi.fn();
    lazyProjectsDialog(dialogEl(), { onPick: vi.fn(), onImportZip: vi.fn() }, onError).preload();
    lazyUploadDialog(dialogEl(), { getFolders: () => [], upload: vi.fn() }, onError).preload();
    lazyCommandPalette(el(), { onSelect: vi.fn() }, onError).preload();
    lazyTour(el(), el(), { seen: { has: () => true, mark: vi.fn() } }, onError).preload();
    lazySettings(dialogEl(), {} as never, el(), {} as never, onError).preload();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('lazyAboutDialog', () => {
  const info = { version: '0.1.0', commit: 'abc1234', builtAt: '' };

  it('fills in the version and opens once loaded, from the real module', async () => {
    mountAppShell();
    HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    const dialog = document.getElementById('about-dialog') as HTMLDialogElement;
    const about = lazyAboutDialog(dialog, info, {}, vi.fn());
    about.open();
    await vi.waitFor(() => expect(dialog.open).toBe(true));
    expect(dialog.querySelector('#about-version')?.textContent).toContain('0.1.0');
  });

  it('reports a failed load with a retry', async () => {
    const onError = vi.fn();
    const error = new Error('offline');
    const about = lazyAboutDialog(dialogEl(), info, {}, onError, { load: () => Promise.reject(error) });
    about.preload();
    about.open();
    await settle();
    expect(onError).toHaveBeenCalledWith('About', error, expect.any(Function));
  });
});

describe('lazyTemplates', () => {
  it('loads the template dialogs once and runs each one', async () => {
    const instance = { openNew: vi.fn(async () => {}), saveAsTemplate: vi.fn(async () => {}), editProfile: vi.fn(async () => {}) };
    const createTemplatesUi = vi.fn(() => instance);
    const load = vi.fn(async () => ({ createTemplatesUi }) as never);
    const options = {} as never;
    const templates = lazyTemplates(options, { load });
    await templates.openNew();
    await templates.saveAsTemplate();
    await templates.editProfile();
    templates.preload();
    expect(load).toHaveBeenCalledTimes(1);
    expect(createTemplatesUi).toHaveBeenCalledWith(options);
    expect(instance.openNew).toHaveBeenCalled();
    expect(instance.saveAsTemplate).toHaveBeenCalled();
    expect(instance.editProfile).toHaveBeenCalled();
  });

  it('rejects when the code cannot load, so New Project can fall back', async () => {
    const error = new TypeError('Failed to fetch dynamically imported module');
    const templates = lazyTemplates({} as never, { load: () => Promise.reject(error) });
    await expect(templates.openNew()).rejects.toBe(error);
  });
});

describe('lazyShareButton', () => {
  const shareConfig = () => {
    const button = document.createElement('button');
    const popover = el();
    return { button, popover, config: { button, popover, guestRoomId: 'room-1' } as never };
  };

  it('keeps the popover closed and out of the tab order, then loads and opens on the first click', async () => {
    const instance = { open: vi.fn(), copyOrOpen: vi.fn() };
    const setupShareButton = vi.fn(() => instance);
    const { button, popover, config } = shareConfig();
    const onError = vi.fn();
    lazyShareButton(config, onError, { load: async () => ({ setupShareButton }) as never });
    expect(popover.inert).toBe(true);
    expect(button.dataset.sharing).toBe('true');
    expect(setupShareButton).not.toHaveBeenCalled();
    button.click();
    await settle();
    expect(setupShareButton).toHaveBeenCalledWith(config);
    expect(instance.open).toHaveBeenCalledTimes(1);
    // From then on the real popover's own click handler runs, so the stand-in stays out of the way.
    button.click();
    await settle();
    expect(instance.open).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('copies the link through the loaded popover, and reports a failed load', async () => {
    const instance = { open: vi.fn(), copyOrOpen: vi.fn() };
    const error = new Error('chunk gone');
    const load = vi.fn().mockRejectedValueOnce(error).mockResolvedValue({ setupShareButton: () => instance });
    const onError = vi.fn();
    const share = lazyShareButton(shareConfig().config, onError, { load });
    share.copyOrOpen();
    await settle();
    expect(onError).toHaveBeenCalledWith('Sharing', error, expect.any(Function));
    share.copyOrOpen();
    await settle();
    expect(instance.copyOrOpen).toHaveBeenCalledTimes(1);
  });
});

describe('lazyDialogs', () => {
  it('shows the dialogs once their code loads', async () => {
    const module = { confirmDialog: vi.fn(async () => true), promptDialog: vi.fn(async () => 'name'), noticeDialog: vi.fn(async () => {}) };
    const onError = vi.fn();
    const dialogs = lazyDialogs(onError, { load: async () => module as never });
    await expect(dialogs.confirmDialog({ title: 'Delete?', message: 'Sure?' } as never)).resolves.toBe(true);
    await expect(dialogs.promptDialog({ title: 'Name' } as never)).resolves.toBe('name');
    await expect(dialogs.noticeDialog({ title: 'Done', message: 'Saved' })).resolves.toBeUndefined();
    expect(module.confirmDialog).toHaveBeenCalledWith({ title: 'Delete?', message: 'Sure?' });
    expect(onError).not.toHaveBeenCalled();
  });

  it('counts a dialog that cannot load as cancelled, and says why', async () => {
    const error = new Error('chunk gone');
    const onError = vi.fn();
    const dialogs = lazyDialogs(onError, { load: () => Promise.reject(error) });
    await expect(dialogs.confirmDialog({ title: 'Delete?' } as never)).resolves.toBe(false);
    await expect(dialogs.promptDialog({ title: 'Name' } as never)).resolves.toBeNull();
    await expect(dialogs.noticeDialog({ title: 'Done', message: 'Saved' })).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith('The dialog', error);
  });
});

describe('lazyFileViewer', () => {
  const fakeViewer = () => ({ show: vi.fn(), hide: vi.fn() });

  it('runs only the latest show or hide once it loads, then calls straight through', async () => {
    const viewer = fakeViewer();
    let resolve!: (module: never) => void;
    const load = vi.fn(() => new Promise<never>((done) => (resolve = done)));
    const lazy = lazyFileViewer(el(), { onDownload: vi.fn() }, vi.fn(), { load });
    lazy.hide();
    expect(load).not.toHaveBeenCalled();
    lazy.show({ path: 'a.png', bytes: null });
    lazy.show({ path: 'b.png', bytes: null });
    expect(load).toHaveBeenCalledTimes(1);
    resolve({ createFileViewer: () => viewer } as never);
    await settle();
    expect(viewer.show).toHaveBeenCalledTimes(1);
    expect(viewer.show).toHaveBeenCalledWith({ path: 'b.png', bytes: null });
    lazy.hide();
    expect(viewer.hide).toHaveBeenCalledTimes(1);
  });

  it('reports a failed load with a retry', async () => {
    const viewer = fakeViewer();
    const error = new Error('offline');
    const load = vi.fn().mockRejectedValueOnce(error).mockResolvedValue({ createFileViewer: () => viewer });
    const onError = vi.fn();
    const lazy = lazyFileViewer(el(), { onDownload: vi.fn() }, onError, { load });
    lazy.show({ path: 'a.pdf', bytes: null });
    await settle();
    expect(onError).toHaveBeenCalledWith('The file viewer', error, expect.any(Function));
    lazy.show({ path: 'b.pdf', bytes: null });
    await settle();
    expect(viewer.show).toHaveBeenCalledWith({ path: 'b.pdf', bytes: null });
  });
});

describe('lazyFileViewer retry', () => {
  it('shows the file that was asked for when the retry runs', async () => {
    const viewer = { show: vi.fn(), hide: vi.fn() };
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ createFileViewer: () => viewer });
    const onError = vi.fn();
    lazyFileViewer(el(), { onDownload: vi.fn() }, onError, { load }).show({ path: 'a.png', bytes: null });
    await settle();
    (onError.mock.calls[0][2] as () => void)();
    await settle();
    expect(viewer.show).toHaveBeenCalledWith({ path: 'a.png', bytes: null });
  });
});
