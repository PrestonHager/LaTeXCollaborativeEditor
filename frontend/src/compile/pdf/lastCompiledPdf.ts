import { textRev } from '../../storage/projectSaver';

/**
 * The last PDF Compile PDF made in this tab (issue #242), so File > Export can save it and the
 * PDF view can show it again. It's kept in memory only: never stored, never sent to peers.
 * `sourceKey` says which project contents it was made from, so Export can tell when it's stale.
 */
export type CompiledPdf = { bytes: Uint8Array; sourceKey: string; mainPath: string; engine: string; madeAt: number };

let last: CompiledPdf | null = null;

export function setLastCompiledPdf(pdf: CompiledPdf | null) {
  last = pdf;
}

export function lastCompiledPdf(): CompiledPdf | null {
  return last;
}

type SourceProject = {
  entries(): { path: string; kind: string; hash?: string; id: string }[];
  getText(id: string): { toString(): string };
};

/** A fingerprint of every file's path and contents, to tell whether a compiled PDF is still current. */
export function compiledSourceKey(project: SourceProject, mainPath: string): string {
  const parts = project.entries().map((entry) => `${entry.path}:${entry.kind === 'text' ? textRev(project.getText(entry.id).toString()) : (entry.hash ?? '')}`);
  return [mainPath, ...parts].join('|');
}
