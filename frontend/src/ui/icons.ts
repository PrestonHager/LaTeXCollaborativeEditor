// Import icons by name so the bundler only keeps the ones we use. Icons that only lazy parts of the
// app show are imported there instead (commandIcons.ts, exportDialog.ts, keybindSettings.ts), so
// they stay out of the initial load (issue #231).
import {
  createElement,
  createIcons,
  BookOpen,
  Columns2,
  Command,
  FileOutput,
  FilePlus,
  PanelLeft,
  PanelRight,
  Play,
  Save,
  Share2,
  Upload,
  CircleHelp,
  MoveHorizontal,
  ZoomIn,
  ZoomOut,
  Info,
  Check,
  ChevronRight,
  Copy,
  Download,
  File,
  FileArchive,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  PencilLine,
  Search,
  Star,
  Trash2,
  Users,
  X,
  FileImage,
  Ellipsis,
  Menu,
  type IconNode,
} from 'lucide';
import type { CommandId } from './menuBar';


/**
 * Icons for the toolbar's commands, which show from the start (index.html). The menus' and the
 * palette's icons are in commandIcons.ts, a lazy chunk (issue #231).
 */
export const toolbarCommandIcons = {
  'app.commandPalette': Command,
  'share.copyLink': Share2,
  'file.saveNow': Save,
  'file.newFile': FilePlus,
  'file.upload': Upload,
  'file.export': FileOutput,
  'view.compileNow': Play,
  'view.layoutSplit': Columns2,
  'view.layoutEditorOnly': PanelLeft,
  'view.layoutPreviewOnly': PanelRight,
  'help.documentation': BookOpen,
} satisfies Partial<Record<CommandId, IconNode>>;

// Icons the HTML asks for with <i data-lucide="name">. Add one here when you use a new name.
const staticIcons = {
  CircleHelp,
  Ellipsis,
  Menu,
  MoveHorizontal,
  ZoomIn,
  ZoomOut,
  Info,
  Play,
  Save,
  Check,
  ChevronRight,
  Copy,
  Download,
  File,
  FileArchive,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  PencilLine,
  Search,
  Share2,
  Star,
  Trash2,
  Upload,
  Users,
  X,
};

/** Icons for file tree rows, picked by kind. */
export const fileIcons = { File, FileImage, FileText, Folder, FolderOpen };

/** Build an SVG icon. Icons are decorative, so screen readers skip them. */
export function icon(node: IconNode, className = 'size-4'): SVGElement {
  return createElement(node, { class: className, 'aria-hidden': 'true' });
}

/** Icon for a toolbar command, or null for a command that isn't on the toolbar. */
export function toolbarCommandIcon(commandId: CommandId): SVGElement | null {
  const node = (toolbarCommandIcons as Partial<Record<CommandId, IconNode>>)[commandId];
  return node ? icon(node) : null;
}

/** An empty box the size of an icon, where a menu item's icon goes once commandIcons.ts loads. */
export function iconSlot(): HTMLElement {
  const slot = document.createElement('span');
  slot.className = 'size-4 shrink-0 inline-block';
  slot.setAttribute('aria-hidden', 'true');
  slot.dataset.iconSlot = '';
  return slot;
}

/** Replace every <i data-lucide> placeholder under root with its SVG. */
export function renderStaticIcons(root: Element | Document = document) {
  createIcons({ icons: staticIcons, root, attrs: { class: 'size-4', 'aria-hidden': 'true' } });
}
