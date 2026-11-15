import { enginePackageMessage, engineFromProgram, isTexEngine, packageEngines, readMagicComments, resolveEngine } from './texEngine';

describe('TeX engine selection (#199)', () => {
  it('knows the three engines and the program names editors write', () => {
    expect(isTexEngine('xelatex')).toBe(true);
    expect(isTexEngine('tectonic')).toBe(false);
    expect(isTexEngine(3)).toBe(false);
    expect(engineFromProgram('XeLaTeX')).toBe('xelatex');
    expect(engineFromProgram(' luatex ')).toBe('lualatex');
    expect(engineFromProgram('latex')).toBe('pdflatex');
    expect(engineFromProgram('pdftex')).toBe('pdflatex');
    expect(engineFromProgram('context')).toBeNull();
  });

  it('reads % !TEX program and root comments near the top, first one wins', () => {
    const text = ['%!TEX TS-program = xelatex', '% !TeX program = lualatex', '%  !TEX root = ../main.tex  ', '\\section{One}'].join('\n');
    expect(readMagicComments(text)).toEqual({ program: { value: 'xelatex', line: 1 }, root: { value: '../main.tex', line: 3 } });
    expect(readMagicComments('\\documentclass{article}\n% TEX program = xelatex')).toEqual({});
    expect(readMagicComments('% !TEX program =')).toEqual({});
    expect(readMagicComments(`% !TEX root = ${'a'.repeat(600)}`)).toEqual({});
  });

  it('only looks at the first 20 lines', () => {
    const late = `${'\n'.repeat(25)}% !TEX program = xelatex`;
    expect(readMagicComments(late)).toEqual({});
  });

  it('lets the magic comment win over the setting, then the setting over the default', () => {
    expect(resolveEngine('lualatex', '% !TEX program = xelatex\n')).toEqual({ engine: 'xelatex', source: 'magic' });
    expect(resolveEngine('lualatex', '% !TEX program = context\n')).toEqual({ engine: 'lualatex', source: 'project' });
    expect(resolveEngine(null, 'x')).toEqual({ engine: 'pdflatex', source: 'default' });
    expect(resolveEngine(undefined, undefined)).toEqual({ engine: 'pdflatex', source: 'default' });
  });

  it('says which packages need which engine', () => {
    expect(packageEngines('fontspec')).toEqual(['xelatex', 'lualatex']);
    expect(packageEngines('amsmath')).toBeNull();
    expect(enginePackageMessage('fontspec', 'xelatex')).toBeNull();
    expect(enginePackageMessage('amsmath', 'pdflatex')).toBeNull();
    expect(enginePackageMessage('fontspec', 'pdflatex')).toContain('needs XeLaTeX or LuaLaTeX');
    expect(enginePackageMessage('luacode', 'xelatex')).toContain('% !TEX program = lualatex');
    expect(enginePackageMessage('xeCJK', 'lualatex')).toContain('needs XeLaTeX');
  });
});
