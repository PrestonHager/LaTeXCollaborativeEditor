import type { ProjectEntry } from '../project/projectDoc';
import { basename, dirname, isInside, isPreviewableImage, isPdf } from '../project/paths';
import { fileIcons, icon, renderStaticIcons } from './icons';
import type { CommandId } from './menuBar';

export type FileTreeState = {
  entries: ProjectEntry[];
  folders: string[];
  activeId: string | null;
  mainId: string | null;
  /** Transfer progress by content hash, for files still coming from a peer. */
  progress: Map<string, number>;
  /** True for a guest that hasn't got the host's project yet. */
  waiting: boolean;
  /** Peers who have each file open, by file id. Each gets a dot in their colour. */
  viewers?: Map<string, { name: string; color: string }[]>;
};

/** Dots shown per file. More viewers than this still get named in the label. */
const MAX_DOTS = 3;

/** A dot per peer who has the file open, in their colour, with their names for screen readers and hover. */
function viewerDots(viewers: { name: string; color: string }[]): HTMLElement {
  const dots = document.createElement('span');
  dots.className = 'file-row-peers';
  const label = `Open by ${viewers.map((viewer) => viewer.name).join(', ')}`;
  dots.setAttribute('role', 'img');
  dots.setAttribute('aria-label', label);
  dots.title = label;
  for (const viewer of viewers.slice(0, MAX_DOTS)) {
    const dot = document.createElement('span');
    dot.className = 'file-row-peer-dot';
    dot.style.backgroundColor = viewer.color;
    dots.append(dot);
  }
  return dots;
}

type FileTreeOptions = {
  onOpen: (entry: ProjectEntry) => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
  onSetMain: (entry: ProjectEntry) => void;
  /** Move a file or folder into another folder ('' is the project root). */
  onMove: (path: string, folder: string) => void;
  onUpload: (files: File[], folder: string) => void;
  onCommand: (commandId: CommandId) => void;
};

type Row = { path: string; depth: number; folder: boolean; entry?: ProjectEntry };

const DRAG_TYPE = 'application/x-latex-project-path';

/**
 * Wire up the file tree in index.html. The rows change with every file op, so they're cloned
 * from the row template in index.html and filled in here.
 */
export function createFileTree(pane: HTMLElement, options: FileTreeOptions) {
  const list = pane.querySelector<HTMLUListElement>('#file-tree')!;
  const emptyState = pane.querySelector<HTMLElement>('#file-tree-empty')!;
  const waitingState = pane.querySelector<HTMLElement>('#file-tree-waiting')!;
  const dropOverlay = pane.querySelector<HTMLElement>('#file-drop-overlay')!;
  const template = document.querySelector<HTMLTemplateElement>('#file-tree-row-template')!;
  const collapsed = new Set<string>();
  let state: FileTreeState = { entries: [], folders: [], activeId: null, mainId: null, progress: new Map(), waiting: false };
  // New files and uploads go into the folder picked last.
  let currentFolder = '';
  let dragDepth = 0;

  pane.querySelectorAll<HTMLButtonElement>('[data-command]').forEach((button) => {
    button.addEventListener('click', () => options.onCommand(button.dataset.command as CommandId));
  });

  /** Lay out folders first, then files, depth first, skipping anything inside a collapsed folder. */
  const buildRows = (): Row[] => {
    const children = new Map<string, Row[]>();
    const add = (row: Row) => {
      const parent = dirname(row.path);
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent)!.push(row);
    };
    for (const folder of state.folders) {
      add({ path: folder, depth: folder.split('/').length - 1, folder: true, entry: state.entries.find((e) => e.path === folder && e.kind === 'folder') });
    }
    for (const entry of state.entries) {
      if (entry.kind !== 'folder') add({ path: entry.path, depth: entry.path.split('/').length - 1, folder: false, entry });
    }
    const rows: Row[] = [];
    const walk = (dir: string) => {
      const kids = (children.get(dir) ?? []).sort((a, b) => Number(b.folder) - Number(a.folder) || basename(a.path).localeCompare(basename(b.path)));
      for (const row of kids) {
        rows.push(row);
        if (row.folder && !collapsed.has(row.path)) walk(row.path);
      }
    };
    walk('');
    return rows;
  };

  const rowIcon = (row: Row) => {
    if (row.folder) return icon(collapsed.has(row.path) ? fileIcons.Folder : fileIcons.FolderOpen);
    if (isPreviewableImage(row.path) || isPdf(row.path)) return icon(fileIcons.FileImage);
    return icon(row.entry?.kind === 'text' ? fileIcons.FileText : fileIcons.File);
  };

  const renderRow = (row: Row): HTMLLIElement => {
    const li = template.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
    renderStaticIcons(li);
    const main = li.querySelector<HTMLButtonElement>('.file-row-main')!;
    li.dataset.path = row.path;
    li.dataset.kind = row.folder ? 'folder' : 'file';
    li.style.setProperty('--depth', String(row.depth));
    const name = li.querySelector('.file-row-name')!;
    name.textContent = basename(row.path);
    const viewers = row.entry ? state.viewers?.get(row.entry.id) : undefined;
    if (viewers?.length) name.after(viewerDots(viewers));
    li.querySelector('.file-row-icon')!.append(rowIcon(row));
    main.title = row.path;

    if (row.folder) {
      li.setAttribute('aria-expanded', String(!collapsed.has(row.path)));
      li.classList.toggle('is-current-folder', row.path === currentFolder);
    } else {
      li.querySelector<HTMLElement>('.file-row-chevron')!.style.visibility = 'hidden';
    }
    const isActive = !!row.entry && row.entry.id === state.activeId;
    li.classList.toggle('is-active', isActive);
    li.setAttribute('aria-selected', String(isActive));
    const isMain = !!row.entry && row.entry.id === state.mainId;
    li.querySelector<HTMLElement>('.file-row-main-badge')!.hidden = !isMain;

    // Only .tex files can be the main file, and only when they aren't already.
    const mainButton = li.querySelector<HTMLButtonElement>('[data-action="main"]')!;
    mainButton.hidden = row.folder || isMain || !row.path.endsWith('.tex');

    // Show progress for a file whose bytes are still coming from a peer.
    const hash = row.entry?.hash;
    const progress = hash !== undefined ? state.progress.get(hash) : undefined;
    const bar = li.querySelector<HTMLElement>('.file-row-progress')!;
    bar.hidden = progress === undefined;
    if (progress !== undefined) bar.querySelector('span')!.style.width = `${Math.round(progress * 100)}%`;

    main.addEventListener('click', () => {
      if (row.folder) {
        currentFolder = row.path;
        if (collapsed.has(row.path)) collapsed.delete(row.path);
        else collapsed.add(row.path);
        render(state);
        return;
      }
      currentFolder = dirname(row.path);
      if (row.entry) options.onOpen(row.entry);
    });
    li.querySelector('[data-action="rename"]')!.addEventListener('click', () => options.onRename(row.path));
    li.querySelector('[data-action="delete"]')!.addEventListener('click', () => options.onDelete(row.path));
    mainButton.addEventListener('click', () => row.entry && options.onSetMain(row.entry));
    main.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData(DRAG_TYPE, row.path);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    return li;
  };

  /** Find the folder a drop lands in: the folder row, the folder of a file row, or the root. */
  const dropFolder = (target: EventTarget | null): string => {
    const row = (target as HTMLElement | null)?.closest?.<HTMLElement>('.file-row');
    if (!row?.dataset.path) return '';
    return row.dataset.kind === 'folder' ? row.dataset.path : dirname(row.dataset.path);
  };

  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

  pane.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    dragDepth += 1;
    dropOverlay.hidden = false;
  });
  pane.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropOverlay.hidden = true;
  });
  pane.addEventListener('dragover', (event) => {
    const types = Array.from(event.dataTransfer?.types ?? []);
    if (types.includes('Files') || types.includes(DRAG_TYPE)) event.preventDefault();
  });
  pane.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    dropOverlay.hidden = true;
    const folder = dropFolder(event.target);
    const moved = event.dataTransfer?.getData(DRAG_TYPE);
    if (moved) {
      // Dropping a folder into itself or where it already is does nothing.
      if (dirname(moved) !== folder && folder !== moved && !isInside(folder, moved)) options.onMove(moved, folder);
      return;
    }
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) options.onUpload(files, folder);
  });

  function render(next: FileTreeState) {
    state = next;
    if (currentFolder && !state.folders.includes(currentFolder)) currentFolder = '';
    const rows = buildRows();
    list.replaceChildren(...rows.map(renderRow));
    waitingState.hidden = !state.waiting;
    emptyState.hidden = state.waiting || rows.length > 0;
  }

  return {
    render,
    /** The folder new files should go in. */
    currentFolder: () => currentFolder,
    /** Open every folder on the way to path, so a newly opened file is visible. */
    reveal(path: string) {
      for (let dir = dirname(path); dir; dir = dirname(dir)) collapsed.delete(dir);
    },
  };
}
