import { isDangerousUrl, latexSourceToPreviewHtml, projectToPreviewHtml, LATEX_JS_ASSET_BASE, PAGE_BREAK_CLASS } from './latexJsPreview';

describe('latexSourceToPreviewHtml', () => {
  it('turns \\newpage, \\clearpage and \\pagebreak on their own line into print page breaks', () => {
    const { html, errors, changes } = latexSourceToPreviewHtml(
      '\\documentclass{article}\\begin{document}\nA\n\\newpage\nB\n  \\clearpage % next\n\\begin{itemize}\\item a\n\\pagebreak[4]\n\\item b\\end{itemize}\nC \\newpage D\n% \\newpage\n\\end{document}',
    );
    expect(errors).toEqual([]);
    expect(changes).toEqual([]);
    const doc = new DOMParser().parseFromString(html!, 'text/html');
    const breaks = Array.from(doc.querySelectorAll(`.${PAGE_BREAK_CLASS}`));
    expect(breaks).toHaveLength(3);
    expect(breaks[0].getAttribute('style')).toContain('break-after:page');
    expect(breaks[0].previousElementSibling?.textContent).toBe('A');
    expect(breaks[2].closest('li')).not.toBeNull();
    // Mid-line ones and commented-out ones aren't touched, and the marker never shows.
    expect(doc.body.textContent).not.toContain('lcpagebreak');
    expect(doc.body.textContent).toContain('C D');
  });

  it('returns HTML for minimal valid LaTeX', () => {
    const { html, errors } = latexSourceToPreviewHtml(
      '\\documentclass{article}\\begin{document}Hi\\end{document}',
    );
    expect(errors).toEqual([]);
    expect(html).toBeTruthy();
    expect(html).toContain(LATEX_JS_ASSET_BASE);
  });

  it('strips javascript: and similar URLs from \\href and \\url', () => {
    const { html, errors } = latexSourceToPreviewHtml(
      String.raw`\documentclass{article}\usepackage{hyperref}\begin{document}` +
        String.raw`\href{javascript:alert(1)}{a} \url{JaVaScript:alert(2)} ` +
        String.raw`\href{vbscript:x}{b} \href{data:text/html,hi}{c} ` +
        String.raw`\href{https://ok.example}{d}\end{document}`,
    );
    expect(errors).toEqual([]);
    // The \url text still shows the URL, so we only check the href attributes.
    expect(html).not.toMatch(/href="\s*(javascript|vbscript|data):/i);
    expect(html).toContain('>a</a>');
    expect(html).toContain('href="https://ok.example"');
    expect(html).toContain(LATEX_JS_ASSET_BASE);
  });

  it('keeps \\ref as an in-page link but leaves an unknown label as plain ??', () => {
    const { html, errors } = latexSourceToPreviewHtml(
      String.raw`\documentclass{article}\begin{document}` +
        String.raw`\section{A}\label{a}See \ref{b} and \ref{missing}.\section{B}\label{b}\end{document}`,
    );
    expect(errors).toEqual([]);
    expect(html).toContain('<a href="#sec-2">2</a>');
    expect(html).toContain('id="sec-2"');
    expect(html).not.toContain('href="#"');
    expect(html).toContain('<a>??</a>');
  });

  it('reports no changes when nothing was changed', () => {
    const { html, changes } = latexSourceToPreviewHtml(
      '\\documentclass{article}\\begin{document}Hi\\end{document}',
    );
    expect(changes).toEqual([]);
    expect(html).not.toContain('lc-preview-note');
  });

  it('lists what was stripped or rewritten, but keeps the list out of the document', () => {
    const { html, errors, changes } = latexSourceToPreviewHtml(
      [
        '\\documentclass{article}',
        '\\usepackage{geometry}',
        '\\begin{document}',
        'Hi\\footnote{x}.',
        '\\end{document}',
      ].join('\n'),
    );
    expect(errors).toEqual([
      { line: 2, severity: 'info', message: 'The preview leaves out the geometry package. The preview uses its own page size and margins.' },
    ]);
    expect(changes).toHaveLength(2);
    expect(changes[0]).toBe("Removed packages the preview can't load: geometry.");
    expect(html).not.toContain('Preview is approximate');
    expect(html).not.toContain('lc-preview-note');
    expect(html).not.toContain('<details');
  });

  it('keeps the change notes when the parse fails', () => {
    const { html, changes } = latexSourceToPreviewHtml('\\usepackage{geometry}\n\\invalidtokenalone');
    expect(html).toBeNull();
    expect(changes).toEqual(["Removed packages the preview can't load: geometry."]);
  });

  it('returns the changes for a whole project, with or without a document', () => {
    const texts = new Map([['main.tex', '\\documentclass{article}\n\\usepackage{geometry}\n\\begin{document}Hi\\end{document}']]);
    const ok = projectToPreviewHtml({ mainPath: 'main.tex', texts, binaryPaths: [], imageUrls: new Map() });
    expect(ok.changes).toEqual(["Removed packages the preview can't load: geometry."]);
    expect(ok.html).not.toContain('Preview is approximate');
    texts.set('main.tex', '\\usepackage{geometry}\n\\invalidtokenalone');
    const failed = projectToPreviewHtml({ mainPath: 'main.tex', texts, binaryPaths: [], imageUrls: new Map() });
    expect(failed.html).toBeNull();
    expect(failed.changes).toEqual(["Removed packages the preview can't load: geometry."]);
  });

  it('puts package notes on the file and line that load the package, after the parse error', () => {
    const texts = new Map([
      ['main.tex', '\\documentclass{article}\n\\input{preamble}\n\\begin{document}\n\\begin{tikzpicture}\\end{tikzpicture}\n\\end{document}'],
      ['preamble.tex', '% packages\n\\usepackage{xcolor}\n\\usepackage{tikz}'],
    ]);
    const { html, errors } = projectToPreviewHtml({ mainPath: 'main.tex', texts, binaryPaths: [], imageUrls: new Map() });
    expect(html).toBeNull();
    expect(errors.map((e) => [e.path, e.line, e.severity])).toEqual([
      ['main.tex', 4, 'error'],
      ['preamble.tex', 3, 'warning'],
    ]);
    expect(errors[1].message).toContain('tikzpicture');
  });

  it('returns structured error when parse fails', () => {
    const { html, errors } = latexSourceToPreviewHtml('\\invalidtokenalone');
    expect(html).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(1);
    expect(errors[0].severity).toBe('error');
    expect(errors[0].message.length).toBeGreaterThan(0);
  });

  it('uses the line from the LaTeX.js error location', () => {
    const { errors } = latexSourceToPreviewHtml(
      '\\documentclass{article}\n\\begin{document}\nHi\n\\invalidtokenalone\n\\end{document}',
    );
    expect(errors[0].line).toBe(4);
  });

  it('clamps error lines to the end of the source', () => {
    const { errors } = latexSourceToPreviewHtml(
      '\\documentclass{article}\n\\begin{document}\n\\begin{itemize}',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBeGreaterThanOrEqual(1);
    expect(errors[0].line).toBeLessThanOrEqual(3);
  });
});

describe('isDangerousUrl', () => {
  it('flags script and data schemes, even with odd casing or whitespace', () => {
    expect(isDangerousUrl('javascript:alert(1)')).toBe(true);
    expect(isDangerousUrl(' JaVa\tScRipt:alert(1)')).toBe(true);
    expect(isDangerousUrl('vbscript:msgbox')).toBe(true);
    expect(isDangerousUrl('data:text/html,<script>')).toBe(true);
  });

  it('allows normal links', () => {
    expect(isDangerousUrl('https://example.com')).toBe(false);
    expect(isDangerousUrl('mailto:a@example.com')).toBe(false);
    expect(isDangerousUrl('#section')).toBe(false);
  });
});

describe('projectToPreviewHtml figures', () => {
  const doc = (body: string) => new Map([['main.tex', `\\documentclass{article}\\usepackage{graphicx}\\begin{document}\n${body}\n\\end{document}`]]);
  const parse = (html: string | null) => new DOMParser().parseFromString(html!, 'text/html');

  it('asks for each PDF page once, and leaves the image empty until it is drawn', () => {
    const texts = doc('\\includegraphics{plot.pdf}\\includegraphics[width=2cm]{plot}\\includegraphics[page=2]{plot}');
    const result = projectToPreviewHtml({ mainPath: 'main.tex', texts, binaryPaths: ['plot.pdf'], imageUrls: new Map() });
    expect(result.errors).toEqual([]);
    expect(result.pdfFigures).toEqual([
      { path: 'plot.pdf', renderKey: 'p1', page: 1, crop: null },
      { path: 'plot.pdf', renderKey: 'p2', page: 2, crop: null },
    ]);
    const imgs = parse(result.html).querySelectorAll('img');
    expect(imgs).toHaveLength(3);
    for (const img of imgs) {
      expect(img.getAttribute('src')).toBeNull();
      expect(img.getAttribute('alt')).toBe('plot.pdf');
    }
    expect(result.changes).toEqual([]);
  });

  it('shows a drawn PDF page at its natural size, unless the options size it', () => {
    const texts = doc('\\includegraphics{plot.pdf}\\includegraphics[width=2cm]{plot.pdf}');
    const pdfImages = new Map([['plot.pdf#p1', { url: 'data:image/png;base64,AAAA', width: 144, height: 96 }]]);
    const result = projectToPreviewHtml({ mainPath: 'main.tex', texts, binaryPaths: ['plot.pdf'], imageUrls: new Map(), pdfImages });
    const [natural, sized] = parse(result.html).querySelectorAll('img');
    expect(natural.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(natural.getAttribute('style')).toBe('max-width:100%;width:144pt;aspect-ratio:144/96;');
    expect(sized.getAttribute('style')).toBe('max-width:100%;width:2cm;');
  });

  it('notes a trim without clip, and puts a box with the reason in place of a PDF that failed', () => {
    const texts = doc('\\includegraphics[trim=1 2 3 4]{plot.pdf}\\includegraphics[page=9]{plot.pdf}');
    const pdfImages = new Map([
      ['plot.pdf#p1;trim=1,2,3,4', { url: 'data:image/png;base64,AAAA', width: 10, height: 10 }],
      ['plot.pdf#p9', { error: 'It has no page 9 (it has 2).' }],
    ]);
    const result = projectToPreviewHtml({ mainPath: 'main.tex', texts, binaryPaths: ['plot.pdf'], imageUrls: new Map(), pdfImages });
    expect(result.changes).toEqual([
      'Cut PDF figures off at their trim or viewport, as if clip were set.',
      "Couldn't draw the PDF figure plot.pdf: It has no page 9 (it has 2).",
    ]);
    const box = parse(result.html).querySelector('.lc-figure-placeholder')!;
    expect(box.textContent).toContain('It has no page 9');
    expect(box.getAttribute('role')).toBe('img');
  });

  it('puts a box the size of the %%BoundingBox in place of an EPS figure', () => {
    const texts = doc('\\includegraphics{wave.eps}\\includegraphics[width=0.5\\textwidth]{wave}\\includegraphics[height=1cm]{none.eps}');
    const epsBoxes = new Map([
      ['wave.eps', { width: 144, height: 72 }],
      ['none.eps', null],
    ]);
    const result = projectToPreviewHtml({ mainPath: 'main.tex', texts, binaryPaths: ['wave.eps', 'none.eps'], imageUrls: new Map(), epsBoxes });
    const boxes = [...parse(result.html).querySelectorAll('.lc-figure-placeholder')];
    expect(boxes).toHaveLength(3);
    expect(boxes[0].textContent).toBe("wave.epsEPS can't be previewed; convert it to PDF.");
    expect(boxes[0].getAttribute('style')).toContain('width:144pt;aspect-ratio:144/72;');
    expect(boxes[1].getAttribute('style')).toContain('width:50%;aspect-ratio:144/72;');
    expect(boxes[1].getAttribute('style')).not.toContain('144pt');
    // No box in the file: a 4 by 3 shape, with the height from the options.
    expect(boxes[2].getAttribute('style')).toContain('height:1cm;aspect-ratio:288/216;');
    expect(boxes[2].getAttribute('style')).not.toContain('object-fit');
    expect(result.changes).toEqual([
      "Showed EPS figures as empty boxes of the same size, since the preview can't draw PostScript. Convert them to PDF to see them.",
    ]);
  });

  it('keeps an empty image for an EPS file whose bytes have not arrived', () => {
    const result = projectToPreviewHtml({ mainPath: 'main.tex', texts: doc('\\includegraphics{wave.eps}'), binaryPaths: ['wave.eps'], imageUrls: new Map() });
    const img = parse(result.html).querySelector('img')!;
    expect(img.getAttribute('alt')).toBe('wave.eps');
    expect(img.getAttribute('src')).toBeNull();
    expect(result.changes).toEqual([]);
  });
});
