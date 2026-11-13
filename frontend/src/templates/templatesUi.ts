// The template dialogs (#74): New Project's template picker, Save as Template, and the profile.
// This module, the built-in templates and their CSS load on first use (see app/lazyUi.ts), so none
// of it is in the initial bundle.
import './templates.css';
import type { BlobStore } from '../project/blobStore';
import type { ProjectContent, ProjectDoc } from '../project/projectDoc';
import { STARTER_TEX } from '../project/projectIo';
import { projectNameProblem } from '../ui/nameChecks';
import { returnFocusOnClose } from '../ui/focusReturn';
import { icon, keybindIcons } from '../ui/icons';
import type { ConfirmOptions, PromptOptions } from '../ui/dialogs';
import { describeError } from '../storage/errors';
import type { ProjectSummary, StorageProvider } from '../storage/providers/types';
import { cleanDisplayName, MAX_DISPLAY_NAME_LENGTH, type SettingsStore } from '../state/settings';
import { emptyProfile, isEmptyProfile, type Profile, type ProfileField } from '../state/profile';
import { PAPER_SIZES, PROFILE_LANGUAGES } from './profileOptions';
import { BUILTIN_TEMPLATES, type BuiltinTemplate } from './builtinTemplates';
import { initialValues, parseManifest, placeholderDefs, profileToPlaceholders, usedPlaceholders, type PlaceholderDef } from './placeholders';
import {
  loadBuiltin,
  loadStored,
  projectFromTemplate,
  renameTemplate,
  saveContentAsTemplate,
  saveProjectAsTemplate,
  templateFromZip,
  templateZipEntries,
  type LoadedTemplate,
  type TemplateStore,
  type TemplateSummary,
} from './templateLibrary';
import { createDriveTemplates, type DriveFetch } from './driveTemplates';
import { syncProfile } from './profileSync';

export type TemplatesUiDeps = {
  settings: SettingsStore;
  local: StorageProvider & {
    listTemplates(): Promise<ProjectSummary[]>;
    createTemplate(name: string): Promise<ProjectSummary>;
    deleteTemplate(id: string): Promise<void>;
  };
  drive: StorageProvider & DriveFetch & { isSignedIn(): boolean };
  blobs: BlobStore;
  getProject(): Pick<ProjectDoc, 'entries' | 'getText' | 'getName' | 'getMainFileId' | 'get'>;
  /** Whether the open project saves to Google Drive, so new templates default to Drive too. */
  isDriveProject(): boolean;
  /** How many guests are in the host's room. New Project replaces the project for all of them. */
  guestCount(): number;
  /** Swap in a new project, like File > New did. */
  createProject(content: ProjectContent): Promise<void>;
  /** Open a saved template like a project, so editing it saves back into the template. */
  editTemplate(provider: StorageProvider, id: string): Promise<void>;
  download(name: string, data: Uint8Array, type: string): void;
  notify(message: string, isError?: boolean): void;
  confirmDialog(options: ConfirmOptions): Promise<boolean>;
  promptDialog(options: PromptOptions): Promise<string | null>;
  /** The browser's language, for the date and the language and paper guesses. Tests pin it. */
  locale?: string;
};

// The old starter project, still the first choice: New Project, then Enter-free Create, gives what it always did.
const EMPTY_TEMPLATE: BuiltinTemplate = {
  id: 'builtin:empty',
  name: 'Empty project',
  description: 'Just main.tex with a document class and nothing else.',
  mainFile: 'main.tex',
  placeholders: [],
  files: [{ path: 'main.tex', text: STARTER_TEX }],
};
const BUILTINS = [EMPTY_TEMPLATE, ...BUILTIN_TEMPLATES];

let ids = 0;
const nextId = (prefix: string) => `${prefix}-${(ids += 1)}`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function button(label: string, variant?: string, size?: string): HTMLButtonElement {
  const b = el('button', { type: 'button', className: 'btn', textContent: label });
  if (variant) b.dataset.variant = variant;
  if (size) b.dataset.size = size;
  return b;
}

type Modal = {
  dialog: HTMLDialogElement;
  body: HTMLElement;
  footer: HTMLElement;
  close(): void;
  /** Resolves once the dialog has closed and left the page. */
  closed: Promise<void>;
};

/** A Basecoat dialog that removes itself when it closes. Escape and a click outside close it. */
function modal(size: 'dialog-md' | 'dialog-lg', kind: string, title: string, description: string): Modal {
  const id = nextId('template-dialog');
  const dialog = el('dialog', { className: `dialog ${size} template-dialog template-dialog-${kind}` });
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  dialog.setAttribute('aria-describedby', `${id}-description`);
  const header = el('header', {}, el('h2', { id: `${id}-title`, textContent: title }), el('p', { id: `${id}-description`, textContent: description }));
  const body = el('section', { className: 'template-dialog-body' });
  const footer = el('footer');
  const closeX = button('', 'ghost', 'icon-sm');
  closeX.setAttribute('aria-label', 'Close');
  closeX.append(icon(keybindIcons.X));
  dialog.append(el('div', {}, header, body, footer, closeX));
  const focusReturn = returnFocusOnClose(dialog);
  const close = () => {
    // NOTE: jsdom has no dialog methods, so fall back to the open attribute there.
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else {
      dialog.removeAttribute('open');
      dialog.dispatchEvent(new Event('close'));
    }
  };
  const closed = new Promise<void>((resolve) => dialog.addEventListener('close', () => {
    dialog.remove();
    resolve();
  }, { once: true }));
  closeX.addEventListener('click', close);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  // Keys typed here are for the dialog, not the app's shortcuts.
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  document.body.append(dialog);
  focusReturn.remember();
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  return { dialog, body, footer, close, closed };
}

type Field = { def: PlaceholderDef; control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement };

/** A labeled control for one placeholder or profile field. */
function fieldFor(def: PlaceholderDef, value: string): { row: HTMLElement; field: Field } {
  const id = nextId('template-field');
  let control: Field['control'];
  if (def.options) {
    const select = el('select', { id, className: 'select' });
    select.append(...def.options.map((option) => el('option', { value: option.value, textContent: option.label })));
    // Keep an unlisted value (from a template.json default) choosable instead of silently swapping it.
    if (value && !def.options.some((option) => option.value === value)) select.append(el('option', { value, textContent: value }));
    select.value = value || def.options[0]?.value || '';
    control = select;
  } else if (def.multiline) {
    control = el('textarea', { id, className: 'app-dialog-input template-textarea', value, rows: 3, spellcheck: false });
  } else {
    control = el('input', { id, type: 'text', className: 'app-dialog-input', value, autocomplete: 'off', spellcheck: false });
  }
  control.dataset.key = def.key;
  const row = el('div', { className: 'template-field' }, el('label', { className: 'label', htmlFor: id, textContent: def.label }), control);
  if (def.hint) {
    const hint = el('p', { id: `${id}-hint`, className: 'template-hint', textContent: def.hint });
    control.setAttribute('aria-describedby', hint.id);
    row.append(hint);
  }
  return { row, field: { def, control } };
}

const profileDefs = (): PlaceholderDef[] => [
  { key: 'name', label: 'Name', profile: 'name' },
  { key: 'affiliation', label: 'Affiliation', profile: 'affiliation', hint: 'University, company or group.' },
  { key: 'email', label: 'Email', profile: 'email' },
  { key: 'orcid', label: 'ORCID iD', profile: 'orcid', hint: 'Like 0000-0002-1825-0097.' },
  { key: 'address', label: 'Postal address', profile: 'address', multiline: true, hint: 'One line per line. Letters use it.' },
  { key: 'language', label: 'Document language', profile: 'language', options: [{ value: '', label: 'Match this browser' }, ...PROFILE_LANGUAGES] },
  { key: 'paper', label: 'Paper size', profile: 'paper', options: [{ value: '', label: 'Match this browser' }, ...PAPER_SIZES] },
];

/** The safe file name for a template .zip. */
const zipName = (name: string) => `${name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'template'}.template.zip`;

export function createTemplatesUi(deps: TemplatesUiDeps) {
  const driveTemplates = createDriveTemplates(deps.drive);
  const localStore: TemplateStore = {
    source: 'local',
    label: 'In this browser',
    provider: deps.local,
    list: () => deps.local.listTemplates(),
    create: (name) => deps.local.createTemplate(name),
    remove: (id) => deps.local.deleteTemplate(id),
  };
  const driveStore: TemplateStore = {
    source: 'drive',
    label: 'In Google Drive',
    provider: deps.drive,
    list: () => driveTemplates.listTemplates(),
    create: (name) => driveTemplates.createTemplate(name),
    remove: (id) => driveTemplates.deleteTemplate(id),
  };
  const storeFor = (source: TemplateSummary['source']) => (source === 'drive' ? driveStore : localStore);
  /** Where new templates go: Drive when the project is on Drive and Drive is connected. */
  const defaultStore = () => (deps.isDriveProject() && deps.drive.isSignedIn() ? driveStore : localStore);

  const profile = () => deps.settings.get('profile');

  /** Bring the profile in step with Drive, if Drive is connected. Failures only go to the console. */
  async function syncWithDrive(): Promise<boolean> {
    if (!deps.drive.isSignedIn()) return false;
    try {
      const result = await syncProfile({ profile: profile(), updatedAt: deps.settings.updatedAt().profile ?? 0 }, driveTemplates);
      if (result.action === 'pulled') {
        deps.settings.set('profile', result.profile);
        return true;
      }
    } catch (error) {
      console.warn('Could not sync the profile with Google Drive', error);
    }
    return false;
  }

  // --- Profile ---------------------------------------------------------------------------------

  async function editProfile(): Promise<void> {
    const m = modal(
      'dialog-md',
      'profile',
      'Your profile',
      'Templates fill in {{name}}, {{affiliation}} and the rest from these. Saved in this browser, and in your Google Drive Templates folder while Drive is connected. Never sent to people in your room.',
    );
    let touched = false;
    const fields: Field[] = [];
    const form = el('form', { className: 'template-form', noValidate: true });
    form.id = nextId('template-profile-form');
    for (const def of profileDefs()) {
      const { row, field } = fieldFor(def, profile()[def.profile!]);
      fields.push(field);
      form.append(row);
    }
    // The display name (#22) lives in its own setting and is the one thing peers see. It's edited
    // here too, but never filled in from the private profile, so nothing private gets shared by default.
    const shared = fieldFor(
      { key: 'display_name', label: 'Name in shared rooms', hint: 'People in your room see this next to your cursor. It is the only thing about you they get; the details below stay private.' },
      deps.settings.get('displayName'),
    );
    const sharedInput = shared.field.control as HTMLInputElement;
    sharedInput.placeholder = 'An animal name is picked when you first share';
    sharedInput.maxLength = MAX_DISPLAY_NAME_LENGTH;
    form.prepend(el('div', { className: 'template-shared-name' }, shared.row));
    form.addEventListener('input', () => (touched = true));
    const fill = (next: Profile) => {
      for (const { def, control } of fields) control.value = next[def.profile!];
    };
    m.body.append(form);
    const clear = button('Clear profile', 'destructive');
    const cancel = button('Cancel', 'outline');
    const save = button('Save profile');
    save.type = 'submit';
    save.setAttribute('form', form.id);
    m.footer.append(clear, el('span', { className: 'template-footer-actions' }, cancel, save));
    cancel.addEventListener('click', m.close);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const next = emptyProfile();
      for (const { def, control } of fields) next[def.profile as ProfileField] = control.value;
      deps.settings.set('profile', next);
      const displayName = cleanDisplayName(sharedInput.value);
      if (displayName) deps.settings.set('displayName', displayName);
      m.close();
      void syncWithDrive();
      deps.notify(deps.drive.isSignedIn() ? 'Saved your profile in this browser and Google Drive.' : 'Saved your profile in this browser.');
    });
    clear.addEventListener('click', async () => {
      const ok = await deps.confirmDialog({
        title: 'Clear your profile?',
        message: deps.drive.isSignedIn()
          ? 'This removes your details from this browser and deletes the copy in your Google Drive Templates folder. Projects you already made keep their text.'
          : 'This removes your details from this browser. If you saved them to Google Drive before, connect Drive and clear again to delete that copy too.',
        confirmLabel: 'Clear profile',
        destructive: true,
      });
      if (!ok) return;
      deps.settings.set('profile', emptyProfile());
      fill(emptyProfile());
      m.close();
      if (deps.drive.isSignedIn()) {
        try {
          await driveTemplates.deleteProfile();
          deps.notify('Cleared your profile here and in Google Drive.');
        } catch (error) {
          deps.notify(`Cleared your profile here, but not in Google Drive: ${describeError(error)}`, true);
        }
      } else deps.notify('Cleared your profile in this browser.');
    });
    (fields[0].control as HTMLElement).focus();
    // A newer profile from Drive fills the form, unless they've started typing.
    void syncWithDrive().then((pulled) => {
      if (pulled && !touched) fill(profile());
    });
    await m.closed;
  }

  // --- New Project picker ------------------------------------------------------------------------

  async function openNew(): Promise<void> {
    const guests = deps.guestCount();
    const m = modal('dialog-lg', 'picker', 'New project', 'Pick a template. Your profile fills in the details, and you can change them for this project.');
    const list = el('div', { className: 'template-list', role: 'listbox' });
    list.setAttribute('aria-label', 'Templates');
    const details = el('div', { className: 'template-details' });
    m.body.append(list, details);

    const importButton = button('Import .zip', 'outline');
    const profileButton = button('Edit profile', 'ghost');
    const cancel = button('Cancel', 'outline');
    const create = button('Create project', guests > 0 ? 'destructive' : undefined);
    const zipInput = el('input', { type: 'file', accept: '.zip,application/zip', hidden: true });
    m.footer.append(el('span', { className: 'template-footer-tools' }, importButton, profileButton, zipInput), el('span', { className: 'template-footer-actions' }, cancel, create));
    if (guests > 0) {
      const warning = el('p', { className: 'template-warning', textContent: 'Everyone in the room gets the new project. This one stays saved where it is.' });
      warning.setAttribute('role', 'note');
      m.footer.before(warning);
    }
    cancel.addEventListener('click', m.close);

    type Entry = { summary: TemplateSummary; builtin?: BuiltinTemplate; stored?: ProjectSummary };
    let selected: Entry | null = null;
    let loaded: LoadedTemplate | null = null;
    let fields: Field[] = [];
    let nameInput: HTMLInputElement | null = null;
    let saveToProfile: HTMLInputElement | null = null;
    let touched = false;
    let loadToken = 0;
    const items = new Map<HTMLElement, Entry>();

    const groups: Record<'builtin' | 'local' | 'drive', HTMLElement> = {
      builtin: el('div', { className: 'template-group' }),
      local: el('div', { className: 'template-group' }),
      drive: el('div', { className: 'template-group' }),
    };
    const groupTitles = { builtin: 'Built-in', local: 'My templates in this browser', drive: 'My templates in Google Drive' };
    for (const key of ['builtin', 'local', 'drive'] as const) {
      const heading = el('h3', { className: 'template-group-title', textContent: groupTitles[key] });
      groups[key].append(heading);
      groups[key].setAttribute('role', 'group');
      groups[key].setAttribute('aria-label', groupTitles[key]);
      list.append(groups[key]);
    }

    const itemFor = (entry: Entry): HTMLElement => {
      const item = el('div', { className: 'template-item', role: 'option', tabIndex: -1 });
      item.id = nextId('template-option');
      item.setAttribute('aria-selected', 'false');
      item.append(el('span', { className: 'template-item-name', textContent: entry.summary.name }));
      if (entry.summary.description) item.append(el('span', { className: 'template-item-description', textContent: entry.summary.description }));
      item.addEventListener('click', () => void select(item));
      items.set(item, entry);
      return item;
    };

    const note = (text: string, isError = false) => el('p', { className: `template-group-note${isError ? ' is-error' : ''}`, textContent: text });

    const fillGroup = async (key: 'local' | 'drive') => {
      const group = groups[key];
      const store = storeFor(key);
      group.querySelectorAll('.template-item, .template-group-note').forEach((node) => {
        if (selected && items.get(node as HTMLElement) === selected) selected = null;
        items.delete(node as HTMLElement);
        node.remove();
      });
      if (key === 'drive' && !deps.drive.isSignedIn()) {
        group.append(note('Connect Google Drive (File > Connect Google Drive) to see templates saved there.'));
        return;
      }
      group.append(note('Loading…'));
      try {
        const summaries = await store.list();
        group.querySelector('.template-group-note')?.remove();
        if (!summaries.length) group.append(note(key === 'local' ? 'None yet. Use File > Save as Template on any project.' : 'None yet.'));
        for (const summary of summaries) group.append(itemFor({ summary: { source: key, id: summary.id, name: summary.name, updatedAt: summary.updatedAt }, stored: summary }));
      } catch (error) {
        group.querySelector('.template-group-note')?.remove();
        group.append(note(describeError(error), true));
      }
    };

    for (const template of BUILTINS) groups.builtin.append(itemFor({ summary: { source: 'builtin', id: template.id, name: template.name, description: template.description }, builtin: template }));

    const itemList = () => [...list.querySelectorAll<HTMLElement>('.template-item')];

    /** Show a template's details and placeholder fields. Values already typed carry over by key. */
    async function select(item: HTMLElement, focus = true) {
      const entry = items.get(item);
      if (!entry) return;
      for (const other of itemList()) {
        other.setAttribute('aria-selected', String(other === item));
        other.tabIndex = other === item ? 0 : -1;
      }
      list.setAttribute('aria-activedescendant', item.id);
      if (focus) item.focus();
      selected = entry;
      const token = (loadToken += 1);
      create.disabled = true;
      details.replaceChildren(el('p', { className: 'template-hint', textContent: 'Loading the template…' }));
      try {
        const next = entry.builtin ? loadBuiltin(entry.builtin) : await loadStored(storeFor(entry.summary.source), entry.stored!, deps.blobs);
        if (token !== loadToken) return;
        loaded = next;
        renderDetails(next, entry);
        create.disabled = false;
      } catch (error) {
        if (token !== loadToken) return;
        loaded = null;
        details.replaceChildren(el('p', { className: 'template-group-note is-error', textContent: `Couldn't open this template. ${describeError(error)}` }));
      }
    }

    function renderDetails(template: LoadedTemplate, entry: Entry) {
      const previous = new Map(fields.map(({ def, control }) => [def.key, control.value]));
      const previousName = nameInput?.value ?? '';
      const defs = placeholderDefs(template.manifest);
      const texts = template.content.files.flatMap((file) => (file.kind === 'text' && file.text ? [file.text] : []));
      // The template's own fields (like the title) first, then your details, then the choices.
      const rank = (def: PlaceholderDef) => (def.options ? 2 : template.manifest.placeholders.some((own) => own.key === def.key) ? 0 : 1);
      const used = usedPlaceholders(texts, defs).sort((a, b) => rank(a) - rank(b));
      const start = initialValues(used, profile(), deps.locale);
      const fileCount = template.content.files.filter((file) => file.kind !== 'folder').length;

      const heading = el('div', { className: 'template-details-heading' }, el('h3', { textContent: template.summary.name }));
      const meta = el('p', { className: 'template-hint', textContent: `${fileCount} file${fileCount === 1 ? '' : 's'}${template.content.mainPath ? `, main file ${template.content.mainPath}` : ''}.` });
      const description = template.manifest.description ? el('p', { className: 'template-description', textContent: template.manifest.description }) : null;

      const actions = el('div', { className: 'template-actions' });
      const exportButton = button('Export .zip', 'outline', 'sm');
      exportButton.addEventListener('click', () => void exportZip(template));
      if (entry.builtin) {
        if (entry.builtin !== EMPTY_TEMPLATE) {
          const customize = button('Customize', 'outline', 'sm');
          customize.title = 'Save a copy in My templates and open it for editing';
          customize.addEventListener('click', () => void customizeBuiltin(template));
          actions.append(customize);
        }
      } else {
        const edit = button('Edit', 'outline', 'sm');
        edit.addEventListener('click', () => void editStored(entry));
        const rename = button('Rename', 'outline', 'sm');
        rename.addEventListener('click', () => void renameStored(entry));
        const remove = button('Delete', 'outline', 'sm');
        remove.classList.add('template-delete');
        remove.addEventListener('click', () => void deleteStored(entry));
        actions.append(edit, rename);
        actions.append(remove);
      }
      actions.prepend(exportButton);

      const form = el('form', { className: 'template-form', noValidate: true });
      form.id = nextId('template-create-form');
      fields = [];
      for (const def of used) {
        const { row, field } = fieldFor(def, touched && previous.has(def.key) ? previous.get(def.key)! : start[def.key]);
        fields.push(field);
        form.append(row);
      }
      const nameField = fieldFor({ key: 'project_name', label: 'Project name', hint: 'Leave it empty to name the project when you first save it.' }, previousName);
      nameInput = nameField.field.control as HTMLInputElement;
      nameInput.placeholder = 'Untitled';
      const nameError = el('p', { className: 'app-dialog-error', hidden: true });
      nameError.setAttribute('role', 'alert');
      nameField.row.append(nameError);
      form.prepend(nameField.row);
      nameInput.addEventListener('input', () => {
        const problem = nameInput!.value.trim() ? projectNameProblem(nameInput!.value.trim()) : null;
        nameError.textContent = problem ?? '';
        nameError.hidden = !problem;
      });

      const profileFields = used.filter((def) => def.profile && !def.options);
      saveToProfile = null;
      const extras: HTMLElement[] = [];
      if (profileFields.length) {
        saveToProfile = el('input', { type: 'checkbox', className: 'input' });
        extras.push(el('label', { className: 'label template-check' }, saveToProfile, 'Save changed details to my profile'));
      }
      if (!used.length) extras.push(el('p', { className: 'template-hint', textContent: 'This template has no placeholders to fill in.' }));
      form.addEventListener('input', () => (touched = true));
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        void createFromSelected();
      });
      create.type = 'submit';
      create.setAttribute('form', form.id);

      details.replaceChildren(...[heading, description, meta, actions, form, ...extras].filter((node): node is HTMLElement => Boolean(node)));
    }

    async function createFromSelected() {
      if (!loaded) return;
      const projectName = nameInput?.value.trim() ?? '';
      const problem = projectName ? projectNameProblem(projectName) : null;
      if (problem) {
        nameInput?.focus();
        return;
      }
      const defs = fields.map((field) => field.def);
      const values = Object.fromEntries(fields.map(({ def, control }) => [def.key, control.value]));
      if (saveToProfile?.checked) {
        const next = { ...profile() };
        for (const { def, control } of fields) if (def.profile && !def.options) next[def.profile] = control.value.trim();
        deps.settings.set('profile', next);
        void syncWithDrive();
      }
      const content = projectFromTemplate(loaded, defs, values, projectName);
      create.disabled = true;
      try {
        await deps.createProject(content);
        m.close();
      } catch (error) {
        create.disabled = false;
        deps.notify(describeError(error), true);
      }
    }

    async function exportZip(template: LoadedTemplate) {
      try {
        const { createZip } = await import('../project/zip');
        const { files, folders, skipped } = await templateZipEntries(template, deps.blobs);
        deps.download(zipName(template.summary.name), await createZip(files, folders), 'application/zip');
        deps.notify(skipped.length ? `Exported ${template.summary.name}, without ${skipped.join(', ')} (not loaded yet).` : `Exported ${template.summary.name} as a .zip.`);
      } catch (error) {
        deps.notify(describeError(error), true);
      }
    }

    async function customizeBuiltin(template: LoadedTemplate) {
      const store = defaultStore();
      try {
        const summary = await saveContentAsTemplate(store, { manifest: { ...template.manifest, name: `My ${template.manifest.name.toLowerCase()}` }, content: template.content }, deps.blobs);
        m.close();
        await deps.editTemplate(store.provider, summary.id);
        deps.notify(`Saved a copy as ${summary.name} (${store.label.toLowerCase()}). Edits now save to the template.`);
      } catch (error) {
        deps.notify(describeError(error), true);
      }
    }

    async function editStored(entry: Entry) {
      const store = storeFor(entry.summary.source);
      m.close();
      await deps.editTemplate(store.provider, entry.summary.id);
      deps.notify(`Editing the template ${entry.summary.name}. Changes save to the template, not to a project.`);
    }

    async function renameStored(entry: Entry) {
      const store = storeFor(entry.summary.source);
      const name = await deps.promptDialog({
        title: 'Rename template',
        label: 'Template name',
        initialValue: entry.summary.name,
        confirmLabel: 'Rename',
        selectBaseName: false,
        validate: projectNameProblem,
      });
      if (name === null || name === entry.summary.name) return;
      try {
        await renameTemplate(store, entry.summary.id, name);
        await fillGroup(entry.summary.source as 'local' | 'drive');
        const again = itemList().find((item) => items.get(item)?.summary.id === entry.summary.id);
        if (again) await select(again);
      } catch (error) {
        deps.notify(describeError(error), true);
      }
    }

    async function deleteStored(entry: Entry) {
      const store = storeFor(entry.summary.source);
      const ok = await deps.confirmDialog({
        title: `Delete ${entry.summary.name}?`,
        message: store.source === 'drive' ? 'The template folder goes to your Google Drive trash. Projects made from it stay.' : 'This deletes the template from this browser. Projects made from it stay.',
        confirmLabel: 'Delete template',
        destructive: true,
      });
      if (!ok) return;
      try {
        await store.remove(entry.summary.id);
        await fillGroup(store.source);
        const first = itemList()[0];
        if (first) await select(first);
      } catch (error) {
        deps.notify(describeError(error), true);
      }
    }

    importButton.addEventListener('click', () => zipInput.click());
    zipInput.addEventListener('change', () => {
      const file = zipInput.files?.[0];
      zipInput.value = '';
      if (file) void importZip(file);
    });

    async function importZip(file: File) {
      const store = defaultStore();
      try {
        const { readZip } = await import('../project/zip');
        const template = await templateFromZip(file.name, await readZip(new Uint8Array(await file.arrayBuffer())), deps.blobs);
        const summary = await saveContentAsTemplate(store, template, deps.blobs);
        await fillGroup(store.source);
        const item = itemList().find((node) => items.get(node)?.summary.id === summary.id);
        if (item) await select(item);
        deps.notify(`Imported ${summary.name} (${store.label.toLowerCase()}).`);
      } catch (error) {
        deps.notify(`Couldn't import ${file.name}: ${describeError(error)}`, true);
      }
    }

    profileButton.addEventListener('click', async () => {
      await editProfile();
      // The fields this template fills from the profile pick up the new values, unless they were typed over.
      if (selected && loaded && !touched) renderDetails(loaded, selected);
    });

    // Arrow keys move through the list, Home and End jump. Enter only picks; Create makes the project.
    list.addEventListener('keydown', (event) => {
      const all = itemList();
      const index = all.indexOf(document.activeElement as HTMLElement);
      const to = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: all.length - 1 }[event.key];
      if (to === undefined || !all.length) return;
      event.preventDefault();
      void select(all[Math.max(0, Math.min(all.length - 1, to))]);
    });

    void select(itemList()[0]);
    void fillGroup('local');
    void fillGroup('drive');
    void syncWithDrive().then((pulled) => {
      if (pulled && selected && loaded && !touched) renderDetails(loaded, selected);
    });
    await m.closed;
  }

  // --- Save as Template --------------------------------------------------------------------------

  async function saveAsTemplate(): Promise<void> {
    const project = deps.getProject();
    const current = profile();
    const texts = project.entries().filter((entry) => entry.kind === 'text').map((entry) => project.getText(entry.id).toString());
    const found = isEmptyProfile(current) ? 0 : texts.reduce((count, text) => count + profileToPlaceholders(text, current).count, 0);
    const existing = project.entries().find((entry) => entry.path === 'template.json' && entry.kind === 'text');
    const manifest = existing ? parseManifest(project.getText(existing.id).toString()) : null;

    const m = modal('dialog-md', 'save', 'Save as template', 'Copies every file and folder of this project into a new template you can start projects from.');
    const form = el('form', { className: 'template-form', noValidate: true });
    form.id = nextId('template-save-form');
    const name = fieldFor({ key: 'template_name', label: 'Template name' }, manifest?.name ?? (project.getName() || 'My template'));
    const description = fieldFor({ key: 'template_description', label: 'Description', multiline: true, hint: 'One or two lines saying what it is for.' }, manifest?.description ?? '');
    const where = fieldFor(
      {
        key: 'template_store',
        label: 'Save to',
        options: [
          { value: 'local', label: 'This browser' },
          { value: 'drive', label: deps.drive.isSignedIn() ? 'Google Drive (Templates folder)' : 'Google Drive (connect it first)' },
        ],
      },
      defaultStore().source,
    );
    const whereSelect = where.field.control as HTMLSelectElement;
    if (!deps.drive.isSignedIn()) (whereSelect.options[1] as HTMLOptionElement).disabled = true;
    const nameError = el('p', { className: 'app-dialog-error', hidden: true });
    nameError.setAttribute('role', 'alert');
    name.row.append(nameError);
    form.append(name.row, description.row, where.row);
    let replace: HTMLInputElement | null = null;
    if (found > 0) {
      replace = el('input', { type: 'checkbox', className: 'input', checked: true });
      form.append(el('label', { className: 'label template-check' }, replace, `Turn my profile details into placeholders (${found} found)`));
    }
    form.append(
      el('p', {
        className: 'template-hint',
        textContent:
          'Write {{name}}, {{affiliation}}, {{email}}, {{orcid}}, {{address}}, {{date}}, {{language}} or {{paper}} in any file, and new projects get them filled in. Add your own placeholders in the template.json it makes.',
      }),
    );
    m.body.append(form);
    const cancel = button('Cancel', 'outline');
    const save = button('Save template');
    save.type = 'submit';
    save.setAttribute('form', form.id);
    m.footer.append(el('span', { className: 'template-footer-actions' }, cancel, save));
    cancel.addEventListener('click', m.close);
    const nameControl = name.field.control as HTMLInputElement;
    nameControl.focus();
    nameControl.select();

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const templateName = nameControl.value.trim();
      const problem = projectNameProblem(templateName);
      nameError.textContent = problem ?? '';
      nameError.hidden = !problem;
      if (problem) {
        nameControl.focus();
        return;
      }
      const store = whereSelect.value === 'drive' && deps.drive.isSignedIn() ? driveStore : localStore;
      const mainId = project.getMainFileId();
      const mainFile = mainId ? project.get(mainId)?.path : undefined;
      save.disabled = true;
      save.textContent = 'Saving…';
      try {
        const { summary, skipped } = await saveProjectAsTemplate(
          store,
          project,
          deps.blobs,
          { name: templateName, description: description.field.control.value.trim(), placeholders: manifest?.placeholders ?? [], mainFile },
          replace?.checked ? (text) => profileToPlaceholders(text, current).text : undefined,
        );
        m.close();
        const missing = skipped.length ? ` ${skipped.join(', ')} hadn't arrived yet, so ${skipped.length === 1 ? "it isn't" : "they aren't"} in it.` : '';
        deps.notify(`Saved the template ${summary.name} ${store.source === 'drive' ? 'in your Google Drive Templates folder' : 'in this browser'}. Find it in File > New Project.${missing}`);
      } catch (error) {
        save.disabled = false;
        save.textContent = 'Save template';
        deps.notify(describeError(error), true);
      }
    });
    await m.closed;
  }

  return { openNew, saveAsTemplate, editProfile };
}

export type TemplatesUi = ReturnType<typeof createTemplatesUi>;
