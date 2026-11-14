import type { TexEngine } from '../../project/texEngine';

// Messages between the main thread and the Compile PDF worker (issue #241). Plain data only,
// so they survive the structured clone. Project files go in; the PDF and log come out.
// Nothing here leaves the browser: the worker only fetches engine assets from our own origin.

export type CompileFile = { path: string; data: Uint8Array | string };

export type TexCompileRequest = {
  kind: 'compile';
  id: number;
  engine: TexEngine;
  mainPath: string;
  files: CompileFile[];
  /** Most passes to run while the .aux keeps changing. Defaults to 3. */
  maxPasses?: number;
};

/** Ask what the first compile with `engine` would download, without downloading it. */
export type TexSizeRequest = { kind: 'size'; id: number; engine: TexEngine };

export type TexEngineRequest = TexCompileRequest | TexSizeRequest;

export type TexStage = 'download' | 'load' | 'compile';

export type TexEngineResponse =
  | { kind: 'progress'; id: number; stage: TexStage; loaded?: number; total?: number; pass?: number }
  | { kind: 'size'; id: number; bytes: number; available: boolean }
  | { kind: 'result'; id: number; pdf: Uint8Array | null; log: string; passes: number; exitCode: number }
  | { kind: 'error'; id: number; message: string; reason: TexErrorReason };

/**
 * Why a compile didn't run: `unavailable` (no engine assets on this site yet), `memory` (the
 * engine ran out of memory), `download` (an asset couldn't be fetched or failed its checksum),
 * or `engine` (anything else).
 */
export type TexErrorReason = 'unavailable' | 'memory' | 'download' | 'engine';
