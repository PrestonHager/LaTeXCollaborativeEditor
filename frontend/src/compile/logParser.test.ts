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
});
