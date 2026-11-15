import { LATEX_JS_PACKAGES, knownPackages, packageDiagnostic, packageSupport } from './previewPackages';
import docs from '../../../docs/editing-and-preview.md?raw';

describe('previewPackages', () => {
  it('gives info for packages the preview leaves out or stands in for, and a warning for missing output', () => {
    expect(packageDiagnostic('fontenc')).toEqual({ severity: 'info', message: 'The preview leaves out the fontenc package. The preview reads Unicode already.' });
    expect(packageDiagnostic('cleveref').message).toBe('The preview uses a stand-in for the cleveref package. \\cref shows as a plain reference.');
    expect(packageDiagnostic('pgfplots').severity).toBe('warning');
    expect(packageSupport('nothing-like-this').kind).toBe('missing');
  });

  it('has no entry for a package LaTeX.js loads itself', () => {
    for (const name of LATEX_JS_PACKAGES) expect(knownPackages().has(name), name).toBe(false);
  });

  it('lists every package in docs/editing-and-preview.md, in the table for its severity', () => {
    const section = docs.slice(docs.indexOf('### Packages'), docs.indexOf('Comments, `\\verb`'));
    const warnings = section.slice(section.indexOf('A **warning**'));
    const infos = section.slice(0, section.indexOf('A **warning**'));
    for (const name of LATEX_JS_PACKAGES) expect(infos, name).toContain(`\`${name}\``);
    for (const [name, { kind }] of knownPackages()) expect(kind === 'missing' ? warnings : infos, name).toContain(`\`${name}\``);
  });
});
