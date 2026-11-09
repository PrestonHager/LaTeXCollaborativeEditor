import type { ProjectSummary } from '../storage/providers/types';
import { renderStaticIcons } from './icons';

type ProjectsDialogOptions = {
  onPick: (project: ProjectSummary) => void;
  onImportZip: () => void;
};

/** Wire up the "Open a project" dialog in index.html. Rows are cloned from its item template. */
export function createProjectsDialog(dialog: HTMLDialogElement, options: ProjectsDialogOptions) {
  const list = dialog.querySelector<HTMLElement>('#projects-list')!;
  const empty = dialog.querySelector<HTMLElement>('#projects-empty')!;
  const template = document.querySelector<HTMLTemplateElement>('#project-item-template')!;
  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  const close = () => dialog.close();
  dialog.querySelector('#projects-done')!.addEventListener('click', close);
  dialog.querySelector('#projects-close')!.addEventListener('click', close);
  dialog.querySelector('#projects-import-zip')!.addEventListener('click', () => {
    close();
    options.onImportZip();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });

  return {
    open(projects: ProjectSummary[]) {
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
      dialog.showModal();
    },
  };
}
