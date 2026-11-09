import {
  createElement,
  createIcons,
  BookOpen,
  Check,
  ClipboardPaste,
  CloudUpload,
  Columns2,
  Command,
  Copy,
  Download,
  FilePlus,
  FolderInput,
  FolderOpen,
  HardDrive,
  Info,
  Link,
  PanelLeft,
  PanelRight,
  PencilLine,
  Play,
  Redo2,
  Save,
  Scissors,
  Search,
  Share2,
  SunMoon,
  Palette,
  TextSelect,
  Trash2,
  Undo2,
  Settings,
  Moon,
  Sun,
  Monitor,
  X,
  TextCursorInput,
  SquarePen,
  type IconNode,
} from 'lucide';
import type { CommandId } from './menuBar';

// Import icons by name so the bundler only keeps the ones we use.
const commandIcons: Record<CommandId, IconNode> = {
  'app.commandPalette': Command,
  'app.openSettings': Settings,
  'file.new': FilePlus,
  'file.rename': SquarePen,
  'share.copyLink': Share2,
  'view.darkMode': Moon,
  'view.lightMode': Sun,
  'view.systemTheme': Monitor,
  'view.focusEditor': TextCursorInput,
  'file.openLocal': FolderOpen,
  'file.openDrive': HardDrive,
  'file.download': Download,
  'file.connectDrive': Link,
  'file.saveToDrive': CloudUpload,
  'file.moveDrive': FolderInput,
  'file.renameDrive': PencilLine,
  'file.saveNow': Save,
  'file.clearLocalDocs': Trash2,
  'edit.undo': Undo2,
  'edit.redo': Redo2,
  'edit.cut': Scissors,
  'edit.copy': Copy,
  'edit.paste': ClipboardPaste,
  'edit.selectAll': TextSelect,
  'view.toggleEditorTheme': SunMoon,
  'view.togglePreviewTheme': Palette,
  'view.toggleSaveNow': Save,
  'view.compileNow': Play,
  'view.layoutSplit': Columns2,
  'view.layoutEditorOnly': PanelLeft,
  'view.layoutPreviewOnly': PanelRight,
  'help.documentation': BookOpen,
  'help.about': Info,
};

// Icons the HTML asks for with <i data-lucide="name">. Add one here when you use a new name.
const staticIcons = { Check, Search, Share2, X };

/** Build an SVG icon. Icons are decorative, so screen readers skip them. */
export function icon(node: IconNode, className = 'size-4'): SVGElement {
  return createElement(node, { class: className, 'aria-hidden': 'true' });
}

/** Icon for a menu or palette command. */
export function commandIcon(commandId: CommandId): SVGElement {
  return icon(commandIcons[commandId]);
}

/** Replace every <i data-lucide> placeholder under root with its SVG. */
export function renderStaticIcons(root: Element | Document = document) {
  createIcons({ icons: staticIcons, root, attrs: { class: 'size-4', 'aria-hidden': 'true' } });
}
