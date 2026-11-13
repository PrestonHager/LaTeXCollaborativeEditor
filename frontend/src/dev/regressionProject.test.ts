import { BlobStore } from '../project/blobStore';
import { REGRESSION_PROJECT_NAME, dataUrlBytes, regressionProject } from './regressionProject';
import { projectToPreviewHtml } from '../compile/latexJsPreview';

describe('regressionProject', () => {
  it('loads every file in dev/regression/project with main.tex as the main file', async () => {
    const blobs = new BlobStore();
    const content = await regressionProject(blobs);
    expect(content.name).toBe(REGRESSION_PROJECT_NAME);
    expect(content.mainPath).toBe('main.tex');
    const paths = content.files.map((file) => file.path).sort();
    expect(paths).toEqual([
      'chapters/code.tex',
      'chapters/figures.tex',
      'chapters/hello.py',
      'chapters/math.tex',
      'chapters/text.tex',
      'figures/quadrants.png',
      'main.tex',
      'refs.bib',
      ...['abbrv', 'alpha', 'apalike', 'biblatex', 'citations', 'ieeetr', 'natbib', 'unknown', 'unsrt'].map((name) => `styles/${name}.tex`),
    ]);
  });

  it('keeps text as text and puts the image bytes in the blob store', async () => {
    const blobs = new BlobStore();
    const content = await regressionProject(blobs);
    const main = content.files.find((file) => file.path === 'main.tex')!;
    expect(main.kind).toBe('text');
    expect(main.text).toContain('\\input{chapters/text}');
    const image = content.files.find((file) => file.path === 'figures/quadrants.png')!;
    expect(image.kind).toBe('binary');
    expect(blobs.has(image.hash!)).toBe(true);
  });

  it('references only files that exist in the project', async () => {
    const content = await regressionProject(new BlobStore());
    const paths = new Set(content.files.map((file) => file.path));
    const texts = content.files.filter((file) => file.kind === 'text').map((file) => file.text ?? '');
    // Skip commented-out lines, since main.tex has a deliberately missing \input there.
    const live = texts.flatMap((text) => text.split('\n').filter((line) => !line.trimStart().startsWith('%')));
    for (const line of live) {
      for (const [, name] of line.matchAll(/\\(?:input|include)\{([^}]+)\}/g)) {
        expect(paths.has(name.endsWith('.tex') ? name : `${name}.tex`)).toBe(true);
      }
    }
  });

  it('compiles the code listings chapter with nothing missing', async () => {
    const content = await regressionProject(new BlobStore());
    const texts = new Map(content.files.filter((file) => file.kind === 'text').map((file) => [file.path, file.text ?? '']));
    // jsdom can't measure the picture in the figures chapter, so compile this chapter on its own.
    texts.set('code-only.tex', '\\documentclass{article}\n\\begin{document}\n\\input{chapters/code}\n\\end{document}');
    const result = projectToPreviewHtml({ mainPath: 'code-only.tex', texts, binaryPaths: [], imageUrls: new Map() });
    expect(result.errors).toEqual([]);
    expect(result.missing).toEqual([]);
    const doc = new DOMParser().parseFromString(result.html!, 'text/html');
    expect(doc.querySelectorAll('pre.lc-listing').length).toBe(6);
    expect(doc.body.textContent).toContain('Listing 3: A minted listing');
  });

  it('compiles every bibliography style file, with notes only in unknown.tex', async () => {
    const content = await regressionProject(new BlobStore());
    const texts = new Map(content.files.filter((file) => file.kind === 'text').map((file) => [file.path, file.text ?? '']));
    const binaryPaths = content.files.filter((file) => file.kind === 'binary').map((file) => file.path);
    for (const mainPath of [...texts.keys()].filter((path) => path.startsWith('styles/') && path !== 'styles/citations.tex')) {
      const result = projectToPreviewHtml({ mainPath, texts, binaryPaths, imageUrls: new Map() });
      expect(result.html, mainPath).toContain('References');
      expect(result.missing, mainPath).toEqual([]);
      expect(result.errors.map((error) => error.severity), mainPath).toEqual(mainPath === 'styles/unknown.tex' ? ['warning', 'info'] : []);
    }
  });
});

describe('dataUrlBytes', () => {
  it('decodes a base64 data URL', () => {
    expect(Array.from(dataUrlBytes('data:image/png;base64,AQID'))).toEqual([1, 2, 3]);
  });
});
