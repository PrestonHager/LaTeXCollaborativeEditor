import {
  basename,
  dirname,
  extension,
  guessMainFile,
  isInside,
  isPdf,
  isPreviewableImage,
  isTextPath,
  joinPath,
  mimeType,
  normalizePath,
  replacePrefix,
  uniquePath,
} from './paths';

describe('project paths', () => {
  it('normalizes typed and zipped paths, and refuses ones that climb out', () => {
    expect(normalizePath(' figures\\plot.png ')).toBe('figures/plot.png');
    expect(normalizePath('/a//./b/')).toBe('a/b');
    expect(normalizePath('../secret')).toBeNull();
    expect(normalizePath('  / ')).toBeNull();
  });

  it('splits and joins paths', () => {
    expect(dirname('a/b/c.tex')).toBe('a/b');
    expect(dirname('c.tex')).toBe('');
    expect(basename('a/b/c.tex')).toBe('c.tex');
    expect(joinPath('', 'x')).toBe('x');
    expect(joinPath('a', 'x')).toBe('a/x');
    expect(extension('a/B.PNG')).toBe('png');
    expect(extension('.bashrc')).toBe('');
    expect(isInside('a/b', 'a')).toBe(true);
    expect(isInside('ab', 'a')).toBe(false);
    expect(replacePrefix('a/b/c', 'a/b', 'z')).toBe('z/c');
    expect(replacePrefix('a/b', 'a/b', 'z')).toBe('z');
    expect(replacePrefix('other', 'a', 'z')).toBe('other');
  });

  it('tells text, images and PDFs apart', () => {
    expect(isTextPath('refs.bib')).toBe(true);
    expect(isTextPath('style.sty')).toBe(true);
    expect(isTextPath('plot.png')).toBe(false);
    expect(isPreviewableImage('x.svg')).toBe(true);
    expect(isPreviewableImage('x.eps')).toBe(false);
    expect(isPdf('x.PDF')).toBe(true);
    expect(mimeType('x.jpg')).toBe('image/jpeg');
    expect(mimeType('x.tex')).toBe('text/plain');
    expect(mimeType('x.bin')).toBe('application/octet-stream');
  });

  it('guesses the main file from \\documentclass, preferring shallow main.tex', () => {
    expect(
      guessMainFile([
        { path: 'chapters/intro.tex', text: 'Intro' },
        { path: 'paper.tex', text: '\\documentclass{article}' },
        { path: 'main.tex', text: '\\documentclass{article}' },
      ]),
    ).toBe('main.tex');
    expect(guessMainFile([{ path: 'b.tex', text: 'x' }, { path: 'a.tex', text: 'y' }])).toBe('a.tex');
    expect(guessMainFile([{ path: 'refs.bib' }])).toBeNull();
  });

  it('makes names unique by numbering them', () => {
    const taken = new Set(['a/plot.png', 'a/plot (2).png', 'README']);
    expect(uniquePath('a/plot.png', taken)).toBe('a/plot (3).png');
    expect(uniquePath('README', taken)).toBe('README (2)');
    expect(uniquePath('free.tex', taken)).toBe('free.tex');
  });
});
