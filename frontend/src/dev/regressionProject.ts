import type { BlobStore } from '../project/blobStore';
import type { ProjectContent } from '../project/projectDoc';
import { contentFromFiles } from '../project/projectIo';

// NOTE: main.ts only imports this in dev builds, so production never ships the test project.
const ROOT = '../../dev/regression/project/';

// Pull the test project in at build time. Text comes in as strings, images as data URLs.
// The .py file is there for \lstinputlisting. EPS figures are plain PostScript text, so they come in as strings too.
const texts = import.meta.glob<string>('../../dev/regression/project/**/*.{tex,bib,py,eps}', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const images = import.meta.glob<string>('../../dev/regression/project/**/*.{png,pdf}', {
  query: '?inline',
  import: 'default',
  eager: true,
});

export const REGRESSION_PROJECT_NAME = 'Regression test project';

/** Turn a base64 data URL back into its bytes. */
export function dataUrlBytes(url: string): Uint8Array {
  const binary = atob(url.slice(url.indexOf(',') + 1));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** Build the regression test project from dev/regression/project, with main.tex as the main file. */
export function regressionProject(blobs: BlobStore): Promise<ProjectContent> {
  const encoder = new TextEncoder();
  const files = [
    ...Object.entries(texts).map(([path, text]) => ({ path: path.slice(ROOT.length), data: encoder.encode(text) })),
    ...Object.entries(images).map(([path, url]) => ({ path: path.slice(ROOT.length), data: dataUrlBytes(url) })),
  ];
  return contentFromFiles(REGRESSION_PROJECT_NAME, files, [], blobs, 'main.tex');
}
