import { compiledSourceKey, lastCompiledPdf } from '../compile/pdf/lastCompiledPdf';
import { mainPath } from './sourceExporters';
import { safeFileName, throwIfAborted, type Exporter } from './types';

/**
 * The PDF from the last Compile PDF (issue #242), the real TeX output. Unlike the
 * preview-quality PDF, it's the file TeX made, so it's only offered once Compile PDF has run
 * in this tab. If the project changed since, it still saves, with a warning.
 */
export const compiledPdfExporter: Exporter = {
  id: 'pdf-compiled',
  label: 'PDF (Compile PDF)',
  description: 'The PDF the last Compile PDF made with a real TeX engine, page for page as TeX laid it out.',
  icon: 'file-check',
  fileExtension: '.pdf',
  available(source) {
    const pdf = lastCompiledPdf();
    if (!pdf) return { ok: false, reason: 'Run View > Compile PDF first. This saves the PDF it makes.' };
    const main = mainPath(source);
    if (!main || compiledSourceKey(source.project, main) !== pdf.sourceKey) {
      return { ok: true, warning: 'The project changed since the last Compile PDF. Run it again to include your latest edits.' };
    }
    return { ok: true };
  },
  options: () => [],
  async run(source, _options, run) {
    const pdf = lastCompiledPdf();
    if (!pdf) throw new Error('Run View > Compile PDF first.');
    throwIfAborted(run.signal);
    run.onProgress(1);
    return { files: [{ name: safeFileName(source.name, '.pdf'), data: new Blob([pdf.bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }) }], warnings: [] };
  },
};
