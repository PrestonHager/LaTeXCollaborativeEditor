import { filesForEngine, parseTexManifest, texManifestUrl, TexManifestError } from './texAssetManifest';
import { MANIFEST_URL, fakeAssets } from '../../test/texAssets';

const file = (over: Record<string, unknown> = {}) => ({ name: 'a.wasm', path: 'x/a.wasm', sha256: 'a'.repeat(64), size: 3, ...over });
const base = (over: Record<string, unknown> = {}) => ({ version: 'v1', glue: file({ name: 'glue.js', path: 'glue.js' }), files: [file()], engines: { pdflatex: ['a.wasm'] }, ...over });

describe('Compile PDF manifest (#241)', () => {
  it('builds the manifest URL under the app base', () => {
    expect(texManifestUrl('/app/', 'https://latex.example/app/?room=x')).toBe(MANIFEST_URL);
  });

  it('resolves file URLs against the manifest and lists files per engine, glue first', async () => {
    const { manifest } = await fakeAssets();
    expect(manifest.glue.url).toBe('https://latex.example/app/tex/glue/glue.js');
    expect(filesForEngine(manifest, 'pdflatex')!.map((f) => f.name)).toEqual(['glue.js', 'pdftex.wasm', 'basic.data']);
    expect(filesForEngine(manifest, 'xelatex')!.map((f) => f.name)).toEqual(['glue.js', 'pdftex.wasm']);
    expect(filesForEngine(manifest, 'lualatex')).toBeNull();
  });

  it('ignores engines it does not know and drops repeated names', () => {
    const manifest = parseTexManifest(base({ engines: { pdflatex: ['a.wasm', 'a.wasm'], context: ['a.wasm'] } }), MANIFEST_URL);
    expect(manifest.engines).toEqual({ pdflatex: ['a.wasm'] });
  });

  it.each([
    ['not an object', []],
    ['no version', base({ version: '' })],
    ['no files', base({ files: 'x' })],
    ['bad entry', base({ files: [null] })],
    ['bad name', base({ files: [file({ name: '../a' })] })],
    ['no path', base({ files: [file({ path: '' })] })],
    ['bad hash', base({ files: [file({ sha256: 'xyz' })] })],
    ['bad size', base({ files: [file({ size: -1 })] })],
    ['too big', base({ files: [file({ size: 200 * 1024 * 1024 })] })],
    ['bad url', base({ files: [file({ path: 'http://[bad' })] })],
    ['another origin', base({ files: [file({ path: 'https://texlive.example/a.wasm' })] })],
    ['protocol-relative', base({ files: [file({ path: '//cdn.example/a.wasm' })] })],
    ['duplicate names', base({ files: [file(), file()] })],
    ['no engines', base({ engines: null })],
    ['unknown file', base({ engines: { pdflatex: ['b.wasm'] } })],
    ['glue elsewhere', base({ glue: file({ name: 'glue.js', path: 'https://evil.example/glue.js' }) })],
  ])('refuses a manifest with %s', (_label, raw) => {
    expect(() => parseTexManifest(raw, MANIFEST_URL)).toThrow(TexManifestError);
  });
});
