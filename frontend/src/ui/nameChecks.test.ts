import { MAX_PATH_LENGTH } from '../project/paths';
import { MAX_PROJECT_NAME_LENGTH } from '../project/projectDoc';
import { nextFreeName, pathProblem, projectNameProblem, suggestFreeName } from './nameChecks';

describe('name checks', () => {
  const taken = (path: string) => ['main.tex', 'figures', 'figures/a.png'].includes(path);

  it('accepts a free path, with folders', () => {
    expect(pathProblem('intro.tex', taken)).toBeNull();
    expect(pathProblem(' chapters / intro.tex ', taken)).toBeNull();
  });

  it('says what is wrong with a bad path', () => {
    expect(pathProblem('', taken)).toBe('Enter a name.');
    expect(pathProblem(' / ', taken)).toBe('Enter a name.');
    expect(pathProblem('.', taken)).toBe('Enter a name.');
    expect(pathProblem('a\\b.tex', taken)).toBe("Names can't contain a backslash.");
    expect(pathProblem('what?.tex', taken)).toBe("Names can't contain ?.");
    expect(pathProblem('tab\there', taken)).toBe("Names can't contain control characters.");
    expect(pathProblem('../up.tex', taken)).toBe('Names can\'t use ".." to leave the project.');
    expect(pathProblem('a'.repeat(MAX_PATH_LENGTH + 1), taken)).toBe(`Keep the path to ${MAX_PATH_LENGTH} characters or fewer.`);
    expect(pathProblem('main.tex', taken)).toBe('main.tex already exists.');
    expect(pathProblem('figures', taken)).toBe('figures already exists.');
  });

  it('lets a rename keep its own name but not move a folder into itself', () => {
    expect(pathProblem('figures', taken, 'figures')).toBeNull();
    expect(pathProblem('figures/old', taken, 'figures')).toBe('A folder cannot be moved inside itself.');
    expect(pathProblem('main.tex', taken, 'figures/a.png')).toBe('main.tex already exists.');
  });

  it('checks project names for empty and too long', () => {
    expect(projectNameProblem('Thesis')).toBeNull();
    expect(projectNameProblem('   ')).toBe('Enter a name.');
    expect(projectNameProblem('x'.repeat(MAX_PROJECT_NAME_LENGTH))).toBeNull();
    expect(projectNameProblem('x'.repeat(MAX_PROJECT_NAME_LENGTH + 1))).toMatch(/^Keep the name to 200 characters or fewer/);
  });

  describe('free names', () => {
    it('counts up in the base name, keeping the folder and extension', () => {
      const used = new Set(['chapter (2).tex', 'figures (2)', 'figures (3)']);
      const free = (value: string) => !used.has(value);
      expect(nextFreeName('chapter.tex', free)).toBe('chapter (3).tex');
      expect(nextFreeName('figures', free)).toBe('figures (4)');
      expect(nextFreeName('a/b/fig.final.png', free)).toBe('a/b/fig.final (2).png');
      expect(nextFreeName('src/.latexmkrc', free)).toBe('src/.latexmkrc (2)');
      // A number already there counts on, rather than adding a second one.
      expect(nextFreeName('notes (7).tex', free)).toBe('notes (8).tex');
      expect(nextFreeName('x', () => false)).toBeNull();
    });

    it('suggests a free name only for a name that is taken', () => {
      const toPath = (value: string) => (value.endsWith('.tex') ? value : `${value}.tex`);
      expect(suggestFreeName('main', toPath, taken)).toEqual({ value: 'main (2)', message: "main.tex already exists, so here's main (2).tex instead." });
      expect(suggestFreeName('main.tex', (value) => value, taken)?.value).toBe('main (2).tex');
      expect(suggestFreeName('figures', (value) => value, taken)).toEqual({ value: 'figures (2)', message: "figures already exists, so here's figures (2) instead." });
      // Free, empty, or wrong in a way a number won't fix.
      expect(suggestFreeName('intro.tex', (value) => value, taken)).toBeNull();
      expect(suggestFreeName('', (value) => value, taken)).toBeNull();
      expect(suggestFreeName('a:b', (value) => value, taken)).toBeNull();
      expect(suggestFreeName('main.tex', (value) => value, () => true)).toBeNull();
    });

    it('lets a rename keep its own name, and never suggests moving a folder inside itself', () => {
      expect(suggestFreeName('figures', (value) => value, taken, 'figures')).toBeNull();
      expect(suggestFreeName('figures/a.png', (value) => value, taken, 'figures')).toBeNull();
      expect(suggestFreeName('main.tex', (value) => value, taken, 'intro.tex')?.value).toBe('main (2).tex');
    });
  });
});
