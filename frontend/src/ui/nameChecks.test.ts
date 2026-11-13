import { MAX_PATH_LENGTH } from '../project/paths';
import { MAX_PROJECT_NAME_LENGTH } from '../project/projectDoc';
import { pathProblem, projectNameProblem } from './nameChecks';

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
});
