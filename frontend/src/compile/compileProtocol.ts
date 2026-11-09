import type { ProjectPreviewInput, ProjectPreviewResult } from './latexJsPreview';

// Messages between the compile scheduler and its worker. Everything in them is plain data,
// strings and Maps, so it survives the structured clone.
export type CompileRequest = { id: number; input: ProjectPreviewInput };
export type CompileResponse = { id: number; result: ProjectPreviewResult } | { id: number; error: string };

/** Where the worker file leaves its compiler when the main thread loads it instead. */
export const MAIN_THREAD_COMPILE_KEY = '__latexPreviewCompile';

export type CompileFn = (input: ProjectPreviewInput) => ProjectPreviewResult;
