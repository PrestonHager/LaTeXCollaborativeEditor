// The little pictures in the hover preview card (#89). Plain boxes and lines drawn with CSS, so
// they follow the app theme and cost almost nothing. Loads on first hover (see main.ts), not
// with the page. Commands without a picture here fall back to their description text.
import './hoverPreviewMocks.css';
import type { CommandId } from './menuBar';

type Child = Node | string;

function box(className: string, ...children: Child[]): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  el.append(...children);
  return el;
}

const lines = (count: number) => Array.from({ length: count }, (_, i) => box(`hpm-line hpm-line-${i % 3}`));

/** A few lines of source, like the editor. */
const editorPane = () => box('hpm-pane hpm-editor', ...lines(4));
/** A typeset page, like the preview. */
const previewPane = () => box('hpm-pane hpm-preview', box('hpm-page', box('hpm-heading'), ...lines(3)));

/** The app window in one of its layouts. */
function layout(panes: HTMLElement[]): HTMLElement {
  return box('hpm-window', box('hpm-titlebar', box('hpm-dot'), box('hpm-dot'), box('hpm-dot')), box('hpm-panes', ...panes));
}

/** The file list, with the row the command adds marked as new. */
function fileTree(rows: { name: string; folder?: boolean; added?: boolean }[]): HTMLElement {
  return box(
    'hpm-tree',
    ...rows.map((row) =>
      box(`hpm-row${row.added ? ' is-added' : ''}`, box(row.folder ? 'hpm-folder' : 'hpm-file'), row.name, ...(row.added ? [box('hpm-tag', 'new')] : [])),
    ),
  );
}

/** One thing turning into another, like source into a page. */
const flow = (from: HTMLElement, to: HTMLElement) => box('hpm-flow', from, box('hpm-arrow', '→'), to);

const chips = (labels: string[], active?: string) => box('hpm-chips', ...labels.map((label) => box(`hpm-chip${label === active ? ' is-active' : ''}`, label)));

/** A small window in a theme: the editor and the page in dark or light colors. */
const themed = (theme: 'dark' | 'light' | 'system') =>
  box(`hpm-theme hpm-theme-${theme}`, box('hpm-theme-swatch', box('hpm-line hpm-line-0'), box('hpm-line hpm-line-1')), theme[0].toUpperCase() + theme.slice(1));

const themeCycle = () => box('hpm-flow', themed('dark'), box('hpm-arrow', '→'), themed('light'), box('hpm-arrow', '→'), themed('system'));

const BASE_FILES = [{ name: 'main.tex' }, { name: 'refs.bib' }];

const MOCKS: Partial<Record<CommandId, () => HTMLElement>> = {
  'view.layoutSplit': () => layout([editorPane(), previewPane()]),
  'view.layoutEditorOnly': () => layout([editorPane()]),
  'view.layoutPreviewOnly': () => layout([previewPane()]),
  'view.compileNow': () => flow(editorPane(), previewPane()),
  'file.newFile': () => fileTree([...BASE_FILES, { name: 'untitled.tex', added: true }]),
  'file.newFolder': () => fileTree([{ name: 'figures', folder: true, added: true }, ...BASE_FILES]),
  'file.upload': () => fileTree([...BASE_FILES, { name: 'figure.png', added: true }]),
  'file.saveNow': () => box('hpm-status', box('hpm-check', '✓'), 'Saved just now'),
  'view.togglePauseSaving': () => box('hpm-status is-paused', box('hpm-check', 'Ⅱ'), 'Saving paused'),
  'file.export': () => flow(previewPane(), chips(['.zip', 'PDF', 'HTML', '.tex'], 'PDF')),
  'file.download': () => flow(fileTree(BASE_FILES), chips(['project.zip'], 'project.zip')),
  'file.downloadFile': () => flow(fileTree([{ name: 'main.tex', added: true }]), chips(['main.tex'], 'main.tex')),
  'share.copyLink': () =>
    box(
      'hpm-share',
      box('hpm-field', box('hpm-link', '…/?room=7f3a9c'), box('hpm-tag', 'Copied')),
      box('hpm-peers', box('hpm-avatar hpm-avatar-0', 'A'), box('hpm-avatar hpm-avatar-1', 'B'), 'Others join with the link'),
    ),
  'app.commandPalette': () =>
    box('hpm-palette', box('hpm-search', 'comp'), box('hpm-option is-active', 'Compile Now'), box('hpm-option', 'Command Palette')),
  'view.toggleEditorTheme': themeCycle,
  'view.togglePreviewTheme': themeCycle,
  'view.darkMode': () => themed('dark'),
  'view.lightMode': () => themed('light'),
  'view.systemTheme': () => themed('system'),
};

/** The picture for a command, or null to show just its description. */
export function renderMock(commandId: CommandId): HTMLElement | null {
  return MOCKS[commandId]?.() ?? null;
}
