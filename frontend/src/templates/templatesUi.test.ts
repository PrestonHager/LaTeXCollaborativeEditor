import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import * as Y from 'yjs';
import { resetDbForTests } from '../storage/idb';
import { LocalAppStorageProvider } from '../storage/providers/localAppStorage';
import { BlobStore } from '../project/blobStore';
import { ProjectDoc, type ProjectContent } from '../project/projectDoc';
import { createSettingsStore } from '../state/settings';
import { emptyProfile } from '../state/profile';
import { createZip } from '../project/zip';
import { STARTER_TEX } from '../project/projectIo';
import { createTemplatesUi, type TemplatesUiDeps } from './templatesUi';
import { serializeProfile } from './profileSync';

type DriveCall = { url: string; method: string };

function setup(options: { guests?: number; driveSignedIn?: boolean; driveFiles?: { id: string; name: string; tag: string; text?: string }[] } = {}) {
  const settings = createSettingsStore({ storage: null, target: null });
  const local = new LocalAppStorageProvider();
  const blobs = new BlobStore();
  const project = new ProjectDoc(new Y.Doc());
  project.replaceAll({ name: 'My paper', mainPath: 'main.tex', files: [{ path: 'main.tex', kind: 'text', text: '\\author{Ann Lee}\\begin{document}x\\end{document}' }] });
  const driveCalls: DriveCall[] = [];
  const driveFiles = options.driveFiles ?? [];
  const drive = {
    label: 'Google Drive',
    isSignedIn: () => Boolean(options.driveSignedIn),
    driveFetch: vi.fn(async (url: string, init: RequestInit) => {
      const method = init.method ?? 'GET';
      driveCalls.push({ url, method });
      const q = new URL(url).searchParams.get('q');
      if (q) {
        const tag = /key='([^']+)'/.exec(q)?.[1];
        return new Response(JSON.stringify({ files: driveFiles.filter((file) => file.tag === tag) }));
      }
      if (url.includes('alt=media')) return new Response(driveFiles.find((file) => url.includes(file.id))?.text ?? '');
      return new Response('{}');
    }),
  } as unknown as TemplatesUiDeps['drive'];
  const deps = {
    settings,
    local,
    drive,
    blobs,
    getProject: () => project,
    isDriveProject: () => false,
    guestCount: () => options.guests ?? 0,
    createProject: vi.fn(async (_content: ProjectContent) => {}),
    editTemplate: vi.fn(async () => {}),
    download: vi.fn(),
    notify: vi.fn(),
    confirmDialog: vi.fn(async () => true),
    promptDialog: vi.fn(async (): Promise<string | null> => 'Renamed'),
    locale: 'en-GB',
  } satisfies TemplatesUiDeps;
  return { deps, ui: createTemplatesUi(deps), settings, local, project, driveCalls };
}

const dialog = (kind: string) => document.querySelector<HTMLDialogElement>(`.template-dialog-${kind}`);
const items = () => [...document.querySelectorAll<HTMLElement>('.template-dialog-picker .template-item')];
const item = (name: string) => items().find((node) => node.querySelector('.template-item-name')?.textContent === name);
const field = (key: string) => document.querySelector<HTMLInputElement & HTMLSelectElement>(`[data-key="${key}"]`);
const buttonNamed = (root: ParentNode, label: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === label)!;
const type = (control: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  control.value = value;
  control.dispatchEvent(new Event('input', { bubbles: true }));
};
const submit = (button: HTMLButtonElement) => document.getElementById(button.getAttribute('form')!)!.dispatchEvent(new Event('submit', { cancelable: true }));

describe('template dialogs', () => {
  beforeEach(async () => {
    resetDbForTests();
    globalThis.indexedDB = new IDBFactory();
    localStorage.clear();
    document.body.replaceChildren();
  });

  it('lists the built-in templates first, with Empty project chosen, and creates the old starter project', async () => {
    const { ui, deps } = setup();
    const closed = ui.openNew();
    await vi.waitFor(() => expect(field('project_name')).not.toBeNull());
    expect(items().map((node) => node.querySelector('.template-item-name')!.textContent)).toEqual(['Empty project', 'Blank article', 'Technical report', 'Letter', 'Beamer slides', 'Thesis']);
    expect(items()[0].getAttribute('aria-selected')).toBe('true');
    expect(dialog('picker')!.textContent).toContain('This template has no placeholders to fill in.');
    await vi.waitFor(() => expect(dialog('picker')!.textContent).toContain('None yet. Use File > Save as Template'));
    expect(dialog('picker')!.textContent).toContain('Connect Google Drive');
    submit(buttonNamed(dialog('picker')!, 'Create project'));
    await closed;
    expect(deps.createProject).toHaveBeenCalledWith({ name: '', mainPath: 'main.tex', files: [{ path: 'main.tex', kind: 'text', text: STARTER_TEX }] });
    expect(dialog('picker')).toBeNull();
  });

  it('fills placeholders from the profile, escapes what was typed, and can save it to the profile', async () => {
    const { ui, deps, settings } = setup();
    settings.set('profile', { ...emptyProfile(), name: 'Ann Lee', affiliation: 'Uni' });
    const closed = ui.openNew();
    await vi.waitFor(() => expect(item('Technical report')).toBeDefined());
    item('Technical report')!.click();
    await vi.waitFor(() => expect(field('report_number')).not.toBeNull());
    // Template fields first, then the profile, then the choices.
    const keys = [...document.querySelectorAll<HTMLElement>('.template-details [data-key]')].map((node) => node.dataset.key);
    expect(keys).toEqual(['project_name', 'title', 'report_number', 'name', 'affiliation', 'email', 'date', 'paper', 'language']);
    expect(field('name')!.value).toBe('Ann Lee');
    expect(field('paper')!.value).toBe('a4paper');
    expect(field('language')!.value).toBe('british');
    type(field('name')!, 'Ann & Co_#1');
    type(field('title')!, '50% done');
    type(field('project_name')!, 'Report one');
    document.querySelector<HTMLInputElement>('.template-check input')!.checked = true;
    submit(buttonNamed(dialog('picker')!, 'Create project'));
    await closed;
    const content = deps.createProject.mock.calls[0][0];
    expect(content.name).toBe('Report one');
    const main = content.files.find((file) => file.path === 'main.tex')!.text!;
    expect(main).toContain('\\author{Ann \\& Co\\_\\#1\\\\ Uni\\\\');
    expect(main).toContain('\\title{50\\% done\\\\');
    expect(main).toContain('\\documentclass[11pt,a4paper]{article}');
    expect(main).toContain('\\usepackage[british]{babel}');
    expect(content.files.some((file) => file.path === 'refs.bib')).toBe(true);
    expect(settings.get('profile')).toMatchObject({ name: 'Ann & Co_#1', affiliation: 'Uni' });
  });

  it('warns when guests are in the room, and the arrow keys move through the list without creating', async () => {
    const { ui, deps } = setup({ guests: 2 });
    void ui.openNew();
    await vi.waitFor(() => expect(field('project_name')).not.toBeNull());
    expect(dialog('picker')!.querySelector('.template-warning')!.textContent).toContain('Everyone in the room');
    expect(buttonNamed(dialog('picker')!, 'Create project').dataset.variant).toBe('destructive');
    items()[0].focus();
    items()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(items()[1].getAttribute('aria-selected')).toBe('true');
    items()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(items()[5].getAttribute('aria-selected')).toBe('true');
    items()[5].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(deps.createProject).not.toHaveBeenCalled();
    buttonNamed(dialog('picker')!, 'Cancel').click();
    expect(dialog('picker')).toBeNull();
  });

  it('saves the project as a template, turning profile details into placeholders, and then offers it', async () => {
    const { ui, deps, settings, local } = setup();
    settings.set('profile', { ...emptyProfile(), name: 'Ann Lee' });
    const closed = ui.saveAsTemplate();
    const save = dialog('save')!;
    expect(save.textContent).toContain('Turn my profile details into placeholders (1 found)');
    expect(field('template_name')!.value).toBe('My paper');
    type(field('template_name')!, '');
    submit(buttonNamed(save, 'Save template'));
    expect(save.querySelector('.app-dialog-error')!.textContent).not.toBe('');
    type(field('template_name')!, 'Paper');
    type(field('template_description')!, 'For papers');
    submit(buttonNamed(save, 'Save template'));
    await closed;
    expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining('Saved the template Paper in this browser'));
    const [summary] = await local.listTemplates();
    expect(new TextDecoder().decode(await local.readFile(summary.id, 'main.tex'))).toBe('\\author{{{name}}}\\begin{document}x\\end{document}');

    // It shows up in the picker, and making a project fills the name back in.
    const picked = ui.openNew();
    await vi.waitFor(() => expect(item('Paper')).toBeDefined());
    item('Paper')!.click();
    await vi.waitFor(() => expect(field('name')).not.toBeNull());
    expect(dialog('picker')!.textContent).toContain('For papers');
    submit(buttonNamed(dialog('picker')!, 'Create project'));
    await picked;
    expect(deps.createProject.mock.calls[0][0].files[0].text).toBe('\\author{Ann Lee}\\begin{document}x\\end{document}');
  });

  it('edits, renames, exports and deletes a saved template', async () => {
    const { ui, deps, local } = setup();
    const { id } = await local.createTemplate('Mine');
    await local.writeFile(id, 'main.tex', '\\documentclass{article}');
    void ui.openNew();
    await vi.waitFor(() => expect(item('Mine')).toBeDefined());
    item('Mine')!.click();
    await vi.waitFor(() => expect(buttonNamed(dialog('picker')!, 'Rename')).toBeDefined());

    buttonNamed(dialog('picker')!, 'Rename').click();
    await vi.waitFor(() => expect(item('Renamed')).toBeDefined());
    expect(deps.promptDialog).toHaveBeenCalledWith(expect.objectContaining({ title: 'Rename template', initialValue: 'Mine' }));
    await vi.waitFor(() => expect(item('Renamed')!.getAttribute('aria-selected')).toBe('true'));

    buttonNamed(dialog('picker')!, 'Export .zip').click();
    await vi.waitFor(() => expect(deps.download).toHaveBeenCalled());
    expect(deps.download.mock.calls[0][0]).toBe('Renamed.template.zip');
    expect(deps.download.mock.calls[0][2]).toBe('application/zip');

    await vi.waitFor(() => expect(buttonNamed(dialog('picker')!, 'Delete')).toBeDefined());
    buttonNamed(dialog('picker')!, 'Delete').click();
    await vi.waitFor(() => expect(item('Renamed')).toBeUndefined());
    expect(deps.confirmDialog).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete Renamed?', destructive: true }));
    expect(await local.listTemplates()).toEqual([]);
  });

  it('opens a saved template for editing, and copies a built-in one to customize it', async () => {
    const { ui, deps, local } = setup();
    const { id } = await local.createTemplate('Mine');
    await local.writeFile(id, 'main.tex', 'x');
    let closed = ui.openNew();
    await vi.waitFor(() => expect(item('Mine')).toBeDefined());
    item('Mine')!.click();
    await vi.waitFor(() => expect(buttonNamed(dialog('picker')!, 'Edit')).toBeDefined());
    buttonNamed(dialog('picker')!, 'Edit').click();
    await closed;
    expect(deps.editTemplate).toHaveBeenCalledWith(local, id);

    closed = ui.openNew();
    await vi.waitFor(() => expect(item('Letter')).toBeDefined());
    item('Letter')!.click();
    await vi.waitFor(() => expect(buttonNamed(dialog('picker')!, 'Customize')).toBeDefined());
    buttonNamed(dialog('picker')!, 'Customize').click();
    await closed;
    const copy = (await local.listTemplates()).find((template) => template.name === 'My letter')!;
    expect(deps.editTemplate).toHaveBeenLastCalledWith(local, copy.id);
    expect(new TextDecoder().decode(await local.readFile(copy.id, 'letter.tex'))).toContain('{{recipient}}');
  });

  it('imports a template .zip into My templates', async () => {
    const { ui, deps, local } = setup();
    void ui.openNew();
    await vi.waitFor(() => expect(field('project_name')).not.toBeNull());
    const zip = await createZip([
      { path: 'template.json', data: new TextEncoder().encode('{"name":"Shared","description":"From a friend","placeholders":[]}') },
      { path: 'main.tex', data: new TextEncoder().encode('\\documentclass{article}') },
    ]);
    const input = dialog('picker')!.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [new File([zip as BlobPart], 'shared.zip')] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(item('Shared')).toBeDefined());
    expect(deps.notify).toHaveBeenCalledWith('Imported Shared (in this browser).');
    expect(await local.listTemplates()).toHaveLength(1);
  });

  it('edits the profile and the separate display name, and clears the profile', async () => {
    const { ui, deps, settings } = setup();
    settings.set('displayName', 'Quiet Otter');
    let closed = ui.editProfile();
    const profileDialog = dialog('profile')!;
    expect(field('display_name')!.value).toBe('Quiet Otter');
    type(field('name')!, 'Ann Lee');
    field('language')!.value = 'french';
    type(field('display_name')!, 'Ann');
    submit(buttonNamed(profileDialog, 'Save profile'));
    await closed;
    expect(settings.get('profile')).toMatchObject({ name: 'Ann Lee', language: 'french' });
    expect(settings.get('displayName')).toBe('Ann');
    expect(deps.notify).toHaveBeenCalledWith('Saved your profile in this browser.');

    closed = ui.editProfile();
    buttonNamed(dialog('profile')!, 'Clear profile').click();
    await closed;
    expect(settings.get('profile')).toEqual(emptyProfile());
    // The display name is its own setting, so clearing the private profile leaves it.
    expect(settings.get('displayName')).toBe('Ann');
    expect(deps.confirmDialog).toHaveBeenCalledWith(expect.objectContaining({ title: 'Clear your profile?', destructive: true }));
  });

  it('with Drive connected, lists Drive templates, pulls a newer profile and deletes it on clear', async () => {
    const saved = serializeProfile({ profile: { ...emptyProfile(), name: 'From Drive' }, updatedAt: Date.now() + 1000 });
    const { ui, settings, driveCalls, deps } = setup({
      driveSignedIn: true,
      driveFiles: [
        { id: 'dt1', name: 'Drive one', tag: 'latexTemplate' },
        { id: 'pf', name: 'profile.json', tag: 'latexProfile', text: saved },
      ],
    });
    void ui.openNew();
    await vi.waitFor(() => expect(item('Drive one')).toBeDefined());
    await vi.waitFor(() => expect(settings.get('profile').name).toBe('From Drive'));
    buttonNamed(dialog('picker')!, 'Cancel').click();

    const closed = ui.editProfile();
    buttonNamed(dialog('profile')!, 'Clear profile').click();
    await closed;
    await vi.waitFor(() => expect(driveCalls).toContainEqual({ url: 'https://www.googleapis.com/drive/v3/files/pf', method: 'DELETE' }));
    expect(deps.notify).toHaveBeenCalledWith('Cleared your profile here and in Google Drive.');
  });
});
