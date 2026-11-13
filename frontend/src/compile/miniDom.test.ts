import { createMiniWindow, MiniDocument, MiniElement } from './miniDom';
import { latexSourceToPreviewHtml, projectToPreviewHtml } from './latexJsPreview';
import academicPaperTex from './__fixtures__/academic-paper.tex?raw';

/** Print HTML in a fixed form (sorted attributes, browser-normalized styles) so two DOMs can be compared. */
function canonical(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as HTMLElement;
    const attrs = Array.from(el.attributes)
      .map((attr) => `${attr.name}="${attr.name === 'style' ? el.style.cssText : attr.value}"`)
      .sort()
      .join(' ');
    return `<${el.localName} ${attrs}>${Array.from(el.childNodes).map(walk).join('')}</${el.localName}>`;
  };
  return walk(doc.documentElement);
}

/** Run a compile with the mini DOM standing in for the real one, like in the worker. */
function withMiniDom<T>(run: () => T): T {
  const window = createMiniWindow();
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', window.document);
  try {
    return run();
  } finally {
    vi.unstubAllGlobals();
  }
}

const SAMPLES: Record<string, string> = {
  'academic paper fixture': academicPaperTex,
  'math, lists and links': String.raw`\documentclass{article}
\usepackage{hyperref}
\usepackage{amsmath}
\begin{document}
\title{T}\author{A}\maketitle
\section{One} Inline $\frac{a}{b} + \sqrt{x^2}$ and display
\[ \int_0^1 f(x)\,dx = \sum_{n=1}^\infty \frac{1}{n^2} \]
\begin{itemize}\item a \item b\end{itemize}
\begin{enumerate}\item c\end{enumerate}
\href{https://example.com}{link} \& 5 < 6 > 4 ~ text\footnote{note}
\textbf{bold} \emph{em} \texttt{tt} --- 'quotes'
\begin{center}\textsc{Centered}\end{center}
\begin{quote}A quote\end{quote} \\ \noindent\textit{last}
\end{document}`,
  'verbatim and boxes': String.raw`\documentclass{article}
\begin{document}
\verb|x&y| \begin{description}\item[A] b\end{description}
\begin{flushright}r\end{flushright} \fbox{box} \hspace{1cm} \underline{u} \LaTeX
\end{document}`,
};

describe('miniDom with LaTeX.js', () => {
  for (const [name, source] of Object.entries(SAMPLES)) {
    it(`builds the same preview as a real DOM for the ${name}`, () => {
      const real = latexSourceToPreviewHtml(source);
      const mini = withMiniDom(() => latexSourceToPreviewHtml(source));
      expect(real.errors).toEqual([]);
      expect(mini.errors).toEqual([]);
      expect(canonical(mini.html!)).toBe(canonical(real.html!));
    });
  }

  it('puts project images in without a real DOM', () => {
    const texts = new Map([['main.tex', '\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\n\\includegraphics{a.png}\n\\end{document}']]);
    const input = { mainPath: 'main.tex', texts, binaryPaths: ['a.png'], imageUrls: new Map([['a.png', 'data:image/png;base64,AAAA']]) };
    const real = projectToPreviewHtml(input);
    const mini = withMiniDom(() => projectToPreviewHtml(input));
    expect(mini.html).toContain('src="data:image/png;base64,AAAA"');
    expect(canonical(mini.html!)).toBe(canonical(real.html!));
  });
});

describe('MiniDocument', () => {
  const doc = () => MiniDocument.createHTMLDocument('Title');

  it('sets up a page with head, title and body', () => {
    const d = doc();
    expect(d.title).toBe('Title');
    expect(d.head?.localName).toBe('head');
    expect(d.body?.localName).toBe('body');
    expect(d.compatMode).toBe('CSS1Compat');
    expect(d.implementation.createHTMLDocument().title).toBe('');
  });

  it('moves fragment children in and keeps siblings in order', () => {
    const d = doc();
    const body = d.body!;
    const frag = d.createDocumentFragment();
    frag.append('a', d.createElement('b'));
    body.appendChild(frag);
    expect(frag.hasChildNodes()).toBe(false);
    const b = body.lastChild!;
    b.before('x');
    b.after(d.createComment('c'));
    expect(body.innerHTML).toBe('ax<b></b><!--c-->');
    expect(b.previousSibling?.textContent).toBe('x');
    expect(b.nextSibling?.nodeType).toBe(8);
    expect(body.textContent).toBe('ax');
    b.replaceWith(d.createElement('i'));
    expect(body.innerHTML).toBe('ax<i></i><!--c-->');
    body.replaceChild(d.createTextNode('y'), body.firstChild!);
    body.removeChild(body.lastChild!);
    expect(body.innerHTML).toBe('yx<i></i>');
    body.firstChild!.remove();
    expect(body.childNodes).toHaveLength(2);
    expect(body.contains(body.lastChild)).toBe(true);
    expect(body.contains(d.createElement('p'))).toBe(false);
    body.textContent = 'reset';
    expect(body.innerHTML).toBe('reset');
  });

  it('reflects attributes, classes and styles', () => {
    const d = doc();
    const el = d.createElement('A');
    el.className = 'one';
    el.classList.add('two');
    expect(el.classList.toggle('one')).toBe(false);
    expect(el.classList.toggle('three')).toBe(true);
    el.classList.remove('two');
    expect(el.classList.contains('three')).toBe(true);
    (el as unknown as { href: string }).href = 'https://x/?a=1&b="2"';
    el.style.setProperty('--size', '2px');
    (el.style as unknown as Record<string, string>).marginRight = '1em';
    expect(el.style.getPropertyValue('margin-right')).toBe('1em');
    expect(el.getAttribute('style')).toBe('--size: 2px; margin-right: 1em;');
    expect(el.tagName).toBe('A');
    expect(el.outerHTML).toBe('<a class="three" href="https://x/?a=1&amp;b=&quot;2&quot;" style="--size: 2px; margin-right: 1em;"></a>');
    expect(el.attributes.map((attr) => attr.name)).toEqual(['class', 'href', 'style']);
    el.style.removeProperty('--size');
    el.style = 'color: red';
    expect(el.style.cssText).toBe('color: red;');
    el.removeAttribute('style');
    el.removeAttribute('href');
    expect(el.hasAttribute('style')).toBe(false);
    expect((el as unknown as { id: string }).id).toBe('');
  });

  it('keeps case for SVG and escapes text but not script', () => {
    const d = doc();
    const svg = d.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttributeNS(null, 'viewBox', '0 0 1 1');
    expect(svg.tagName).toBe('svg');
    expect(svg.getAttribute('viewBox')).toBe('0 0 1 1');
    const script = d.createElement('script');
    script.textContent = 'a < b';
    const p = d.createElement('p');
    p.textContent = 'a < b & c\u00a0d';
    d.body!.append(svg, script, p, d.createElement('br'));
    expect(d.body!.innerHTML).toBe('<svg viewBox="0 0 1 1"></svg><script>a < b</script><p>a &lt; b &amp; c&nbsp;d</p><br>');
  });

  it('finds elements with simple selectors and clones them', () => {
    const d = doc();
    const div = d.createElement('div');
    div.setAttribute('id', 'main');
    div.className = 'box';
    const span = div.appendChild(d.createElement('span'));
    span.appendChild(d.createTextNode('hi'));
    d.body!.appendChild(div);
    expect(d.querySelector('#main')).toBe(div);
    expect(d.querySelector('.box')).toBe(div);
    expect(d.querySelectorAll('span, div')).toHaveLength(2);
    expect(d.getElementById('main')).toBe(div);
    expect(d.getElementsByTagName('SPAN')).toEqual([span]);
    expect(d.querySelectorAll('*').length).toBeGreaterThan(4);
    const copy = div.cloneNode(true) as MiniElement;
    expect(copy.outerHTML).toBe(div.outerHTML);
    expect((div.cloneNode() as MiniElement).childNodes).toHaveLength(0);
    const text = span.firstChild as unknown as { nodeValue: string; length: number; textContent: string };
    text.nodeValue = 'hey';
    expect(text.length).toBe(3);
    text.textContent = 'yo';
    expect(span.parentElement).toBe(div);
    expect(div.children).toEqual([span]);
    expect(span.textContent).toBe('yo');
  });
});
