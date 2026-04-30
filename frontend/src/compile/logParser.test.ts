import { parseLatexLog } from './logParser';

describe('parseLatexLog', () => {
  it('parses bang errors with line references', () => {
    const log = [
      '! Undefined control sequence.',
      'l.12 \\badcommand',
    ].join('\n');
    const diagnostics = parseLatexLog(log);
    expect(diagnostics[0]).toMatchObject({
      line: 12,
      severity: 'error',
      message: 'Undefined control sequence.',
    });
  });

  it('parses warnings and box messages', () => {
    const log = [
      'LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right. on input line 8.',
      'Overfull \\hbox (5.0pt too wide) in paragraph at lines 21--21',
    ].join('\n');
    const diagnostics = parseLatexLog(log);
    expect(diagnostics).toEqual([
      expect.objectContaining({ line: 8, severity: 'warning' }),
      expect.objectContaining({ line: 21, severity: 'info' }),
    ]);
  });

  it('parses LaTeX Error with on input line in same row', () => {
    const log = 'LaTeX Error: Badness on input line 3.';
    const diagnostics = parseLatexLog(log);
    expect(diagnostics[0]).toMatchObject({
      line: 3,
      severity: 'error',
      message: 'Badness on input line 3.',
    });
  });

  it('parses LaTeX Error using l.x reference in following lines', () => {
    const log = ['LaTeX Error: Missing begin document.', 'l.9'].join('\n');
    const diagnostics = parseLatexLog(log);
    expect(diagnostics[0]).toMatchObject({
      line: 9,
      severity: 'error',
      message: 'Missing begin document.',
    });
  });

  it('defaults bang error line to 1 when no reference is found', () => {
    const log = ['! Mystery error.', 'No line ref here'].join('\n');
    const diagnostics = parseLatexLog(log);
    expect(diagnostics[0]).toMatchObject({
      line: 1,
      severity: 'error',
      message: 'Mystery error.',
    });
  });

  it('defaults LaTeX Error line to 1 when no reference is found', () => {
    const log = 'LaTeX Error: Orphan error without refs.';
    const diagnostics = parseLatexLog(log);
    expect(diagnostics[0]).toMatchObject({ line: 1, severity: 'error' });
  });
});
