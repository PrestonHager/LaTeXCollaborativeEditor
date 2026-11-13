import { flattenedTexExporter, projectZipExporter, singleFileExporter } from './sourceExporters';
import { htmlExporter, previewPdfExporter } from './htmlExporters';
import type { ExportFile, ExportOptionValues, ExportOutput, ExportRun, ExportSource, Exporter } from './types';

/**
 * Every export format, in the order the Export dialog lists them. To add a format, write an
 * Exporter (see types.ts) and put it here. The real TeX PDF goes here once the in-browser
 * compiler (#43) lands.
 */
export const exporters: readonly Exporter[] = [projectZipExporter, previewPdfExporter, htmlExporter, flattenedTexExporter, singleFileExporter];

export function findExporter(id: string, list: readonly Exporter[] = exporters): Exporter | undefined {
  return list.find((exporter) => exporter.id === id);
}

/** Where a finished export goes. Only Download for now; a storage provider can be one later (#47). */
export type ExportDestination = { id: string; label: string; save(file: ExportFile): Promise<void> | void };

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
): Promise<ExportOutput> {
  const availability = exporter.available(source);
  if (!availability.ok) throw new Error(availability.reason);
  run.onProgress(0, 'Starting...');
  const output = await exporter.run(source, options, run);
  if (run.signal.aborted) throw new DOMException('Export canceled', 'AbortError');
  for (const file of output.files) await destination.save(file);
  run.onProgress(1, 'Done');
  return output;
}
