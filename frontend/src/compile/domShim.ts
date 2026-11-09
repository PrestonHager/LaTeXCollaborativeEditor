import { createMiniWindow } from './miniDom';

type Scope = { document?: unknown; window?: unknown };

/**
 * Give a worker a global `document` and `window`, since LaTeX.js and KaTeX build their
 * output with them. Does nothing when a real DOM is already there.
 */
export function installDomShim(scope: Scope = globalThis as Scope): void {
  if (scope.document) return;
  const window = createMiniWindow();
  scope.window = window;
  scope.document = window.document;
}
