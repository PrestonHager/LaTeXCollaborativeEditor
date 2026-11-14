import type { ProjectSummary } from '../storage/providers/types';
import { statusLabels, type ProviderId, type ProviderRegistry } from '../storage/providers/registry';
import { icon, renderStaticIcons, storageIcons } from './icons';
import { returnFocusOnClose } from './focusReturn';

type ProjectsDialogOptions = {
  onPick: (project: ProjectSummary) => void;
  onImportZip: () => void;
  /** Where File > Open Project's providers come from. Without it the dialog only lists projects. */
  registry?: ProviderRegistry;
  /** A provider was picked in the first step. Browser storage calls open() back with its projects. */
  onProvider?: (id: ProviderId) => void;
};

const DESCRIPTIONS = {
  providers: 'Where is the project saved?',
  projects: 'Projects saved in this browser.',
};

/** Wire up the "Open a project" dialog in index.html. Rows are cloned from its item template. */
export function createProjectsDialog(dialog: HTMLDialogElement, options: ProjectsDialogOptions) {
  const list = dialog.querySelector<HTMLElement>('#projects-list')!;
  const empty = dialog.querySelector<HTMLElement>('#projects-empty')!;
  const providers = dialog.querySelector<HTMLElement>('#projects-providers')!;
  const back = dialog.querySelector<HTMLButtonElement>('#projects-back')!;
  const description = dialog.querySelector<HTMLElement>('#projects-dialog-description')!;
  const template = document.querySelector<HTMLTemplateElement>('#project-item-template')!;
  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  // The providers from the last chooseProvider, so Back can show them again.
  let lastProviders: ProviderId[] = [];

  const close = () => dialog.close();
  const focusReturn = returnFocusOnClose(dialog);
  dialog.querySelector('#projects-done')!.addEventListener('click', close);
  dialog.querySelector('#projects-close')!.addEventListener('click', close);
  dialog.querySelector('#projects-import-zip')!.addEventListener('click', () => {
    close();
    options.onImportZip();
  });
  back.addEventListener('click', () => showProviders(lastProviders));
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  renderStaticIcons(back);

  function show() {
    if (dialog.open) return;
    focusReturn.remember();
    dialog.showModal();
  }

  function showProviders(ids: ProviderId[]) {
    const registry = options.registry;
    if (!registry) return;
    lastProviders = ids;
    providers.replaceChildren(
      ...ids.map((id) => {
        const entry = registry.get(id);
        const item = template.content.firstElementChild!.cloneNode(true) as HTMLButtonElement;
        item.dataset.provider = id;
        item.querySelector('figure')!.replaceChildren(icon(storageIcons[entry.icon] ?? storageIcons['hard-drive']));
        item.querySelector('.project-item-name')!.textContent = entry.name;
        const status = entry.status();
        const account = entry.account();
        item.querySelector('.project-item-date')!.textContent = !entry.needsSignIn
          ? 'Projects saved on this device'
          : status === 'connected' && account
            ? `Signed in as ${account}`
            : status === 'connected'
              ? 'Signed in'
              : `${statusLabels[status]}. You'll be asked to sign in.`;
        item.addEventListener('click', () => {
          // Browser storage swaps to its list here. Anything else opens its own picker, so this closes.
          if (entry.needsSignIn) close();
          options.onProvider?.(id);
        });
        return item;
      }),
    );
    providers.hidden = false;
    back.hidden = true;
    list.hidden = true;
    empty.hidden = true;
    description.textContent = DESCRIPTIONS.providers;
    show();
    providers.querySelector<HTMLElement>('button')?.focus();
  }

  return {
    /** Ask which provider the project is in. Each choice goes to options.onProvider. */
    chooseProvider: showProviders,
    open(projects: ProjectSummary[]) {
      // Came from the provider step: offer the way back.
      back.hidden = !(dialog.open && !providers.hidden);
      providers.hidden = true;
      list.hidden = false;
      description.textContent = DESCRIPTIONS.projects;
      list.replaceChildren(
        ...projects.map((project) => {
          const item = template.content.firstElementChild!.cloneNode(true) as HTMLButtonElement;
          renderStaticIcons(item);
          item.querySelector('.project-item-name')!.textContent = project.name || 'Untitled';
          item.querySelector('.project-item-date')!.textContent = project.updatedAt ? `Edited ${dateFormat.format(project.updatedAt)}` : '';
          item.addEventListener('click', () => {
            close();
            options.onPick(project);
          });
          return item;
        }),
      );
      empty.hidden = projects.length > 0;
      show();
      if (!back.hidden) (list.querySelector<HTMLElement>('button') ?? back).focus();
    },
  };
}
