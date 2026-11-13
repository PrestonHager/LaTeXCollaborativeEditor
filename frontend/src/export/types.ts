import type { BlobStore } from '../project/blobStore';
import type { ProjectDoc } from '../project/projectDoc';
import type { ProjectPreviewInput, ProjectPreviewResult } from '../compile/latexJsPreview';

/** The project an exporter reads. Exporters never change it. */
export type ExportSource = {
  project: Pick<ProjectDoc, 'entries' | 'getText' | 'findByPath' | 'folderPaths' | 'textFiles' | 'getMainFileId' | 'get'>;
  blobs: Pick<BlobStore, 'get' | 'has'>;
  /** The project name, for file names. Never empty. */
  name: string;
  /** The file open in the editor, if any. */
  activePath: string | null;
};

/** Whether an exporter can run right now, and if not, why. A warning still lets it run. */
export type Availability = { ok: true; warning?: string } | { ok: false; reason: string };

export type ExportChoice = { value: string; label: string };

/** One thing to ask before an export runs. The Export dialog builds its controls from these. */
export type ExportOption =
  | { id: string; kind: 'checkbox'; label: string; description?: string; default: boolean }
  | { id: string; kind: 'select'; label: string; description?: string; choices: ExportChoice[]; default: string };

export type ExportOptionValues = Record<string, string | boolean>;

export type ExportFile = { name: string; data: Blob };

/**
 * What an export made. Most give one file to save. The print exporter hands its document to
 * the browser's print dialog itself, so it gives none and says so in `message`.
 */
export type ExportOutput = { files: ExportFile[]; warnings: string[]; message?: string };

/** The heavy or browser-only parts, passed in so tests can fake them. */
export type ExportServices = {
  /** Typeset the project with LaTeX.js, in a Web Worker when it can. */
  compile(input: ProjectPreviewInput, signal: AbortSignal): Promise<ProjectPreviewResult>;
  /** Fetch a style sheet or font, to bundle it into a standalone file. */
  fetch(url: string, signal: AbortSignal): Promise<Response>;
  /** Open the browser's print dialog for an HTML document. */
  print(html: string, signal: AbortSignal): Promise<void>;
};

export type ExportRun = {
  signal: AbortSignal;
  /** How far along it is, 0 to 1, and what it's doing. */
  onProgress(fraction: number, label?: string): void;
  services: ExportServices;
};

/**
 * One export format. Add a new format by writing one of these and listing it in registry.ts;
 * the Export dialog, menu and palette pick it up from there.
 */
export type Exporter = {
  id: string;
  label: string;
  /** One sentence for the dialog. */
  description: string;
  /** A lucide icon name, for the dialog. */
  icon: string;
  fileExtension: string;
  /** 'preview' marks output that only looks like LaTeX.js, not like a real TeX build. */
  quality?: 'preview';
  /**
   * True when it hands its document to the browser's print dialog instead of making a file.
   * There's nothing to upload then, so the Export dialog only offers Download.
   */
  printsOnly?: boolean;
  available(source: ExportSource): Availability;
  options(source: ExportSource): ExportOption[];
  run(source: ExportSource, options: ExportOptionValues, run: ExportRun): Promise<ExportOutput>;
};

/** Thrown, or checked for, when the person pressed Cancel. */
export function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Export canceled', 'AbortError');
}

export const isAbortError = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/** The default value of every option, for running an exporter without asking. */
export function defaultOptions(options: ExportOption[]): ExportOptionValues {
  return Object.fromEntries(options.map((option) => [option.id, option.default]));
}

/** A file name that's safe on every OS, from the project name. */
export function safeFileName(name: string, extension: string): string {
  const base = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/^[\s.]+|[\s.]+$/g, '') || 'project';
  return `${base}${extension}`;
}
