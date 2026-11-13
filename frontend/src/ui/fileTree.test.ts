import { mountAppShell } from '../test/appShell';
import { createFileTree, type FileTreeState } from './fileTree';
import type { ProjectEntry } from '../project/projectDoc';

const entries: ProjectEntry[] = [
  { id: 'f', path: 'figures', kind: 'folder' },
  { id: 'p', path: 'figures/plot.png', kind: 'binary', hash: 'h1', size: 3 },
  { id: 'i', path: 'chapters/intro.tex', kind: 'text' },
  { id: 'm', path: 'main.tex', kind: 'text' },
  { id: 'd', path: 'data.bin', kind: 'binary', hash: 'h2' },
];

const state = (overrides: Partial<FileTreeState> = {}): FileTreeState => ({
  entries,
  folders: ['chapters', 'figures'],
  activeId: 'm',
  mainId: 'm',
  progress: new Map(),
  waiting: false,
  ...overrides,
});

function setup() {
  mountAppShell();
  const options = {
    onOpen: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onSetMain: vi.fn(),
    onMove: vi.fn(),
    onUpload: vi.fn(),
    onCommand: vi.fn(),
  };
  const tree = createFileTree(document.getElementById('file-pane')!, options);
  const rows = () => Array.from(document.querySelectorAll<HTMLElement>('#file-tree .file-row'));
  const row = (path: string) => rows().find((el) => el.dataset.path === path)!;
  return { tree, options, rows, row };
}

/** jsdom has no DragEvent, so fake one with a dataTransfer. */
function dragEvent(type: string, data: { types: string[]; files?: File[]; getData?: (type: string) => string }) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
  event.dataTransfer = { types: data.types, files: data.files ?? [], getData: data.getData ?? (() => ''), setData: vi.fn() };
  return event;
}

describe('file tree', () => {
  it('lists folders first, then files, nested by depth, with the main and active file marked', () => {
    const t = setup();
    t.tree.render(state());
    expect(t.rows().map((row) => row.dataset.path)).toEqual(['chapters', 'chapters/intro.tex', 'figures', 'figures/plot.png', 'data.bin', 'main.tex']);
    expect(t.row('chapters/intro.tex').style.getPropertyValue('--depth')).toBe('1');
    expect(t.row('main.tex').classList.contains('is-active')).toBe(true);
    expect(t.row('main.tex').querySelector<HTMLElement>('.file-row-main-badge')!.hidden).toBe(false);
    // Only other .tex files get the "set as main" button.
    expect(t.row('main.tex').querySelector<HTMLElement>('[data-action="main"]')!.hidden).toBe(true);
    expect(t.row('chapters/intro.tex').querySelector<HTMLElement>('[data-action="main"]')!.hidden).toBe(false);
    expect(t.row('data.bin').querySelector<HTMLElement>('[data-action="main"]')!.hidden).toBe(true);
    expect(t.row('main.tex').querySelector('svg')).toBeTruthy();
    expect((document.getElementById('file-tree-empty') as HTMLElement).hidden).toBe(true);
  });

  it('opens files, collapses folders, and remembers the current folder', () => {
    const t = setup();
    t.tree.render(state());
    t.row('chapters/intro.tex').querySelector<HTMLButtonElement>('.file-row-main')!.click();
    expect(t.options.onOpen).toHaveBeenCalledWith(entries[2]);
    expect(t.tree.currentFolder()).toBe('chapters');

    t.row('figures').querySelector<HTMLButtonElement>('.file-row-main')!.click();
    expect(t.tree.currentFolder()).toBe('figures');
    expect(t.rows().map((row) => row.dataset.path)).not.toContain('figures/plot.png');
    expect(t.row('figures').getAttribute('aria-expanded')).toBe('false');
    t.tree.reveal('figures/plot.png');
    t.tree.render(state());
    expect(t.rows().map((row) => row.dataset.path)).toContain('figures/plot.png');
    // A folder that's gone resets the current folder.
    t.tree.render(state({ folders: ['chapters'] }));
    expect(t.tree.currentFolder()).toBe('');
  });

  it('runs row actions and pane commands', () => {
    const t = setup();
    t.tree.render(state());
    const intro = t.row('chapters/intro.tex');
    intro.querySelector<HTMLButtonElement>('[data-action="rename"]')!.click();
    intro.querySelector<HTMLButtonElement>('[data-action="delete"]')!.click();
    intro.querySelector<HTMLButtonElement>('[data-action="main"]')!.click();
    expect(t.options.onRename).toHaveBeenCalledWith('chapters/intro.tex');
    expect(t.options.onDelete).toHaveBeenCalledWith('chapters/intro.tex');
    expect(t.options.onSetMain).toHaveBeenCalledWith(entries[2]);
    document.querySelector<HTMLButtonElement>('#file-pane [data-command="file.upload"]')!.click();
    expect(t.options.onCommand).toHaveBeenCalledWith('file.upload');
  });

  it('shows transfer progress and the empty and waiting states', () => {
    const t = setup();
    t.tree.render(state({ progress: new Map([['h1', 0.4]]) }));
    const bar = t.row('figures/plot.png').querySelector<HTMLElement>('.file-row-progress')!;
    expect(bar.hidden).toBe(false);
    expect(bar.querySelector('span')!.style.width).toBe('40%');
    t.tree.render(state({ entries: [], folders: [] }));
    expect((document.getElementById('file-tree-empty') as HTMLElement).hidden).toBe(false);
    t.tree.render(state({ entries: [], folders: [], waiting: true }));
    expect((document.getElementById('file-tree-empty') as HTMLElement).hidden).toBe(true);
    expect((document.getElementById('file-tree-waiting') as HTMLElement).hidden).toBe(false);
  });

  it('uploads dropped files into the folder they land on', () => {
    const t = setup();
    t.tree.render(state());
    const pane = document.getElementById('file-pane')!;
    const overlay = document.getElementById('file-drop-overlay')!;
    const file = new File(['x'], 'a.png');
    pane.dispatchEvent(dragEvent('dragenter', { types: ['Files'] }));
    expect(overlay.hidden).toBe(false);
    const over = dragEvent('dragover', { types: ['Files'] });
    pane.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    pane.dispatchEvent(dragEvent('dragleave', { types: ['Files'] }));
    expect(overlay.hidden).toBe(true);
    t.row('figures/plot.png').dispatchEvent(dragEvent('drop', { types: ['Files'], files: [file] }));
    expect(t.options.onUpload).toHaveBeenCalledWith([file], 'figures');
    pane.dispatchEvent(dragEvent('drop', { types: ['Files'], files: [file] }));
    expect(t.options.onUpload).toHaveBeenLastCalledWith([file], '');
  });

  it('moves rows dragged onto folders, but not into themselves', () => {
    const t = setup();
    t.tree.render(state());
    const source = t.row('main.tex').querySelector('.file-row-main')!;
    source.dispatchEvent(dragEvent('dragstart', { types: [] }));
    const drop = (target: Element, path: string) =>
      target.dispatchEvent(dragEvent('drop', { types: ['application/x-latex-project-path'], getData: () => path }));
    drop(t.row('figures'), 'main.tex');
    expect(t.options.onMove).toHaveBeenCalledWith('main.tex', 'figures');
    drop(t.row('figures'), 'figures');
    drop(t.row('figures/plot.png'), 'figures/plot.png');
    expect(t.options.onMove).toHaveBeenCalledTimes(1);
  });

  it('shows a dot in each peer colour on the file they have open, with their names', () => {
    const t = setup();
    const viewers = new Map([
      ['m', [{ name: 'Ada', color: '#dc2626' }, { name: 'Grace', color: '#2563eb' }, { name: 'Alan', color: '#15803d' }, { name: 'Barbara', color: '#9333ea' }]],
    ]);
    t.tree.render(state({ viewers }));
    const peers = t.row('main.tex').querySelector<HTMLElement>('.file-row-peers')!;
    expect(peers.getAttribute('aria-label')).toBe('Open by Ada, Grace, Alan, Barbara');
    // At most three dots, so a busy file doesn't push its name out.
    const dots = peers.querySelectorAll<HTMLElement>('.file-row-peer-dot');
    expect(dots).toHaveLength(3);
    expect(dots[0].style.backgroundColor).toBe('rgb(220, 38, 38)');
    expect(t.row('chapters/intro.tex').querySelector('.file-row-peers')).toBeNull();
    expect(t.row('chapters').querySelector('.file-row-peers')).toBeNull();
  });
});
