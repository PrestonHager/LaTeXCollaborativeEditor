import { flattenedTexExporter, projectZipExporter, singleFileExporter } from './sourceExporters';
import { htmlExporter, previewPdfExporter } from './htmlExporters';
import { throwIfAborted, type ExportFile, type ExportOptionValues, type ExportOutput, type ExportRun, type ExportSource, type Exporter } from './types';

/**
 * Every export format, in the order the Export dialog lists them. To add a format, write an
 * Exporter (see types.ts) and put it here. The real TeX PDF goes here once the in-browser
 * compiler (#43) lands.
 */
export const exporters: readonly Exporter[] = [projectZipExporter, previewPdfExporter, htmlExporter, flattenedTexExporter, singleFileExporter];

export function findExporter(id: string, list: readonly Exporter[] = exporters): Exporter | undefined {
  return list.find((exporter) => exporter.id === id);
}

/** A file a destination saved, with a link to it when there is one (like a Drive file). */
export type SavedExport = { name: string; url?: string };

/** Progress and Cancel for a destination's save, like an upload. */
export type SaveRun = { signal: AbortSignal; onProgress(fraction: number, label?: string): void };

/** Where a finished export goes: Download or Google Drive (see export/destinations.ts). */
export type ExportDestination = {
  id: string;
  label: string;
  save(file: ExportFile, run: SaveRun): Promise<SavedExport | void> | SavedExport | void;
  /** The notice once everything is saved. Defaults to "Downloaded a, b". */
  doneMessage?(saved: SavedExport[]): string;
};

export type ExportResult = ExportOutput & { saved: SavedExport[] };

/**
 * Run one exporter and hand what it made to the destination. Throws the exporter's error,
 * or an AbortError after Cancel.
 */
export async function runExport(
  exporter: Exporter,
  source: ExportSource,
  options: ExportOptionValues,
  run: ExportRun,
  destination: ExportDestination,
): Promise<ExportResult> {
  const availability = exporter.available(source);
  if (!availability.ok) throw new Error(availability.reason);
  run.onProgress(0, 'Starting...');
  const output = await exporter.run(source, options, run);
  throwIfAborted(run.signal);
  const saved: SavedExport[] = [];
  for (const file of output.files) {
    saved.push((await destination.save(file, run)) || { name: file.name });
    throwIfAborted(run.signal);
  }
  run.onProgress(1, 'Done');
  return { ...output, saved };
}

/** Save to the person's computer through the browser's download. */
export function downloadDestination(download: (name: string, data: Blob, type: string) => void): ExportDestination {
  return { id: 'download', label: 'Download', save: (file) => download(file.name, file.data, file.data.type) };
}
