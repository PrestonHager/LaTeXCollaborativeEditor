/**
 * Whether Compile PDF is turned on for this build (issue #242). It needs the TeX engine files
 * hosted next to the app (the asset-hosting issue), so it's off until a deploy sets
 * `VITE_COMPILE_PDF=1`. Off, the command still shows, and says why it isn't available yet.
 * On, a site without `tex/manifest.json` says the same thing, so turning it on early is safe.
 */
export function isCompilePdfEnabled(env: { VITE_COMPILE_PDF?: string; DEV?: boolean } = import.meta.env): boolean {
  return String(env.VITE_COMPILE_PDF ?? '') === '1';
}

/** What Compile PDF says while it's off, or when the site has no engine files. */
export const NOT_AVAILABLE_TITLE = "Compile PDF isn't available yet";
export const NOT_AVAILABLE_MESSAGE =
  "Compile PDF runs a real TeX engine in your browser, but this site doesn't host the engine files yet. The live preview still works, and File > Export has a preview-quality PDF.";
