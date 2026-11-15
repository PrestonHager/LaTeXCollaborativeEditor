// Test helpers for the Compile PDF asset tests (#241).
import { sha256Hex } from '../compile/pdf/texAssetCache';
import { parseTexManifest, type TexAssetManifest } from '../compile/pdf/texAssetManifest';

export const ORIGIN = 'https://latex.example';
export const MANIFEST_URL = `${ORIGIN}/app/tex/manifest.json`;

const encoder = new TextEncoder();

/** A manifest over some made-up files, with real hashes, and a fetch that serves them. */
export async function fakeAssets(contents: Record<string, string> = { 'pdftex.wasm': 'wasm-bytes', 'basic.data': 'package-bundle' }) {
  const bodies = new Map<string, Uint8Array>();
  const files = [];
  for (const [name, text] of Object.entries(contents)) {
    const bytes = encoder.encode(text);
    const sha256 = await sha256Hex(bytes);
    const path = `${sha256.slice(0, 8)}/${name}`;
    bodies.set(new URL(path, MANIFEST_URL).href, bytes);
    files.push({ name, path, sha256, size: bytes.length });
  }
  const raw = {
    version: '2026.1-test',
    glue: { name: 'glue.js', path: 'glue/glue.js', sha256: '0'.repeat(64), size: 10 },
    files,
    engines: { pdflatex: Object.keys(contents), xelatex: Object.keys(contents).slice(0, 1) },
  };
  const manifest: TexAssetManifest = parseTexManifest(raw, MANIFEST_URL);
  const requests: string[] = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    const body = bodies.get(url);
    return body ? new Response(body.slice() as Uint8Array<ArrayBuffer>) : new Response('missing', { status: 404 });
  }) as unknown as typeof fetch;
  return { raw, manifest, fetchFn, requests, bodies };
}
