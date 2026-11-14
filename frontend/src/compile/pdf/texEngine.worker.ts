import { createTexEngineHost } from './texEngineHost';
import { TexAssetCache } from './texAssetCache';
import { parseTexManifest, texManifestUrl, type TexAssetFile } from './texAssetManifest';
import type { TexEngineRequest, TexEngineResponse } from './texEngineProtocol';

/**
 * The Compile PDF worker (issue #241), its own lazy chunk apart from the LaTeX.js compile
 * worker. It's only started by the first Compile PDF, so the initial load doesn't change.
 *
 * It fetches the asset manifest and the engine files from our own origin only, keeps them in
 * the Cache API, and runs the engine on the project files the page sends it. Nothing it is sent
 * goes anywhere else.
 */

declare const WorkerGlobalScope: unknown;

type WorkerScope = { onmessage: unknown; postMessage(message: TexEngineResponse, transfer?: Transferable[]): void; location: Location };

/** Fetch the manifest. A 404 means this site has no engine assets yet, which is a normal state. */
export async function fetchManifest(url: string, fetchFn: typeof fetch = fetch) {
  const response = await fetchFn(url, { credentials: 'same-origin', cache: 'no-cache' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Couldn't load the Compile PDF manifest (HTTP ${response.status}).`);
  return parseTexManifest(await response.json(), url);
}

/**
 * Import the glue module from its own URL on our origin, which `script-src 'self'` allows.
 * Not from a blob: URL of the checked bytes: the CSP doesn't allow blob: scripts, on purpose.
 * The glue's URL is content-hashed, so the file can't change under the same name.
 */
export function importGlueModule(file: TexAssetFile): Promise<unknown> {
  return import(/* @vite-ignore */ file.url);
}

export function serveTexEngine(scope: WorkerScope, base: string = import.meta.env.BASE_URL): void {
  const origin = scope.location.origin;
  const host = createTexEngineHost({
    loadManifest: () => fetchManifest(texManifestUrl(base, scope.location.href)),
    cache: new TexAssetCache({ caches, fetch: (input, init) => fetch(input, init), origin, storage: navigator.storage }),
    importGlue: importGlueModule,
    // The PDF can be large, so hand its buffer over instead of copying it.
    post: (response) => scope.postMessage(response, response.kind === 'result' && response.pdf ? [response.pdf.buffer] : []),
  });
  scope.onmessage = (event: MessageEvent<TexEngineRequest>) => void host.handle(event.data);
}

if (typeof WorkerGlobalScope !== 'undefined') serveTexEngine(self as unknown as WorkerScope);
