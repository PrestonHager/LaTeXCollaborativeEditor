import type { TexEngine } from '../../project/texEngine';

/**
 * The small interface the Compile PDF worker drives (issue #241). An engine build (BusyTeX
 * today, maybe typeward or another later) ships a glue module that exports `createTexEngine`
 * returning one of these. Swapping engines means shipping another glue module and manifest;
 * nothing else in the app changes.
 *
 * Paths are project paths ("chapters/intro.tex"), relative to the engine's working directory.
 */
export interface TexEngineBackend {
  /** Start the engine with its asset files (WebAssembly, formats, package bundles) by name. Called once per worker. */
  load(assets: ReadonlyMap<string, Uint8Array>, engine: TexEngine): Promise<void>;
  /** Put a project file in the engine's in-memory filesystem. Folders are made as needed. */
  writeFile(path: string, data: Uint8Array | string): void;
  /** A file the engine wrote (the PDF, the log, the .aux), or null when there's none. */
  readFile(path: string): Uint8Array | null;
  /** Run one pass of `engine` on the main file. A non-zero exit code means TeX stopped on an error. */
  run(engine: TexEngine, mainPath: string): Promise<{ exitCode: number }>;
  /** Forget the project's files and outputs between compiles, keeping the loaded engine. */
  clearProject(): void;
}

/** What a glue module exports. */
export type TexEngineGlue = { createTexEngine: () => Promise<TexEngineBackend> };

export function isTexEngineGlue(value: unknown): value is TexEngineGlue {
  return !!value && typeof (value as TexEngineGlue).createTexEngine === 'function';
}
