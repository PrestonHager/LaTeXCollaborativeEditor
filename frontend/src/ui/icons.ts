import {
  createElement,
  createIcons,
  BookOpen,
  FlaskConical,
  ListChecks,
  ChevronRight,
  File,
  FileArchive,
  FileDown,
  FileCode,
  FileOutput,
  Printer,
  FileImage,
  FileText,
  Folder,
  FolderPlus,
  Star,
  Upload,
  Users,
  Check,
  ClipboardPaste,
  CloudUpload,
  Columns2,
  Command,
  Copy,
  Download,
  FilePlus,
  FileInput,
  FolderInput,
  FolderOpen,
  HardDrive,
  Info,
  Link,
  PanelLeft,
  PanelRight,
  Pause,
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
  Unlink,
  Settings,
  Moon,
  Sun,
  Monitor,
  X,
  TextCursorInput,
  SquarePen,
  Keyboard,
  Bug,
  ShieldExclamationPoint,
  Lightbulb,
  Signpost,
  CircleHelp,
  Plus,
  TriangleAlert,
  LayoutTemplate,
  UserPen,
  type IconNode,
} from 'lucide';
import type { CommandId } from './menuBar';

// Import icons by name so the bundler only keeps the ones we use.
const commandIcons: Record<CommandId, IconNode> = {
  'app.commandPalette': Command,
  'app.openSettings': Settings,
  'app.editProfile': UserPen,
  'file.new': FilePlus,
  'file.rename': SquarePen,
  'file.saveAsTemplate': LayoutTemplate,
  'share.copyLink': Share2,
  'view.darkMode': Moon,
  'view.lightMode': Sun,
  'view.systemTheme': Monitor,
  'view.focusEditor': TextCursorInput,
  'file.openLocal': FolderOpen,
  'file.openDrive': HardDrive,
  'file.download': Download,
  'file.connectDrive': Link,
  'file.disconnectDrive': Unlink,
  'file.saveToDrive': CloudUpload,
  'file.moveDrive': FolderInput,
  'file.addFromDrive': FileInput,
  'file.renameDrive': PencilLine,
  'file.saveNow': Save,
  'file.clearLocalDocs': Trash2,
  'file.newFile': FilePlus,
  'file.newFolder': FolderPlus,
  'file.upload': Upload,
  'file.importZip': FileArchive,
  'file.downloadFile': FileDown,
  'file.export': FileOutput,
  'edit.undo': Undo2,
  'edit.redo': Redo2,
  'edit.cut': Scissors,
  'edit.copy': Copy,
  'edit.paste': ClipboardPaste,
  'edit.selectAll': TextSelect,
  'view.toggleEditorTheme': SunMoon,
  'view.togglePreviewTheme': Palette,
  'view.togglePauseSaving': Pause,
  'view.compileNow': Play,
  'view.layoutSplit': Columns2,
  'view.layoutEditorOnly': PanelLeft,
  'view.layoutPreviewOnly': PanelRight,
  'help.documentation': BookOpen,
  'help.shortcuts': Keyboard,
  'help.tour': Signpost,
  'help.reportBug': Bug,
  'help.reportSecurity': ShieldExclamationPoint,
  'help.requestFeature': Lightbulb,
  'help.about': Info,
  'dev.openTestProject': FlaskConical,
  'dev.openChecklist': ListChecks,
};

// Icons the HTML asks for with <i data-lucide="name">. Add one here when you use a new name.
const staticIcons = {
  CircleHelp,
  Info,
  Play,
  Save,
  Check,
  ChevronRight,
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

/** Icons for the Export dialog's formats, by the name an exporter gives (see src/export/types.ts). */
export const exportIcons: Record<string, IconNode> = {
  'file-archive': FileArchive,
  'file-code': FileCode,
  'file-down': FileDown,
  'file-text': FileText,
  printer: Printer,
};

/** Icons for the keybind list in Settings. */
export const keybindIcons = { Plus, X, TriangleAlert };

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
