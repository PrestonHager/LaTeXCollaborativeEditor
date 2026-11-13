import { BlobStore } from '../project/blobStore';
import { REGRESSION_PROJECT_NAME, dataUrlBytes, regressionProject } from './regressionProject';
import { projectToPreviewHtml } from '../compile/latexJsPreview';
import { parseEpsBoundingBox } from '../compile/epsBoundingBox';

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
      'chapters/packages.tex',
      'chapters/text.tex',
      'figures/chart.pdf',
      'figures/quadrants.png',
      'figures/wave.eps',
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

  it('compiles the PDF and EPS figures, asking for each PDF page and boxing the EPS file', async () => {
    const blobs = new BlobStore();
    const content = await regressionProject(blobs);
    const texts = new Map(content.files.filter((file) => file.kind === 'text').map((file) => [file.path, file.text ?? '']));
    // jsdom can't measure the picture, so compile the figures chapter up to it.
    const figures = texts.get('chapters/figures.tex')!;
    texts.set('figures-only.tex', `\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\n${figures.slice(0, figures.indexOf('\\subsection{Pictures}'))}\n\\end{document}`);
    const eps = content.files.find((file) => file.path === 'figures/wave.eps')!;
    const binaryPaths = content.files.filter((file) => file.kind === 'binary').map((file) => file.path);
    const drawn = { url: 'data:image/png;base64,AAAA', width: 144, height: 96 };
    const result = projectToPreviewHtml({
      mainPath: 'figures-only.tex',
      texts,
      binaryPaths,
      imageUrls: new Map(),
      epsBoxes: new Map([['figures/wave.eps', parseEpsBoundingBox(blobs.peek(eps.hash!)!)]]),
      pdfImages: new Map([['figures/chart.pdf#p1', drawn], ['figures/chart.pdf#p2', drawn], ['figures/chart.pdf#p1;trim=90,8,18,11', drawn]]),
    });
    expect(result.errors).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.pdfFigures!.map((figure) => figure.renderKey)).toEqual(['p1', 'p2', 'p1;trim=90,8,18,11']);
    const doc = new DOMParser().parseFromString(result.html!, 'text/html');
    expect(doc.querySelectorAll('img[alt="figures/chart.pdf"][src^="data:image/png"]').length).toBe(3);
    const boxes = doc.querySelectorAll('.lc-figure-placeholder');
    expect(boxes.length).toBe(2);
    expect(boxes[0].getAttribute('style')).toContain('width:144pt;aspect-ratio:144/72;');
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
