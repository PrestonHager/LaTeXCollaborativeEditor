import { highlightingFor } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { createEditorPane } from './editor';
import { latexHighlightStyle } from './syntaxHighlight';

function ruleFor(className: string): string {
  const rules = latexHighlightStyle.module?.getRules() ?? '';
  return rules.split('}').find((r) => r.includes(`.${className}`)) ?? '';
}

describe('latexHighlightStyle', () => {
  it.each([
    ['tagName', tags.tagName, '--editor-keyword'],
    ['atom', tags.atom, '--editor-string'],
    ['string', tags.string, '--editor-string'],
    ['keyword', tags.keyword, '--editor-number'],
    ['number', tags.number, '--editor-number'],
    ['math variable', tags.special(tags.variableName), '--editor-number'],
    ['bracket', tags.bracket, '--editor-operator'],
    ['comment', tags.comment, '--editor-comment'],
  ])('colors %s with a theme CSS variable', (_name, tag, variable) => {
    const cls = latexHighlightStyle.style([tag]);
    expect(cls).toBeTruthy();
    expect(ruleFor(cls!)).toContain(`var(${variable})`);
  });
});

describe('editor syntax highlighting', () => {
  it('renders LaTeX tokens with highlight classes', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createEditorPane(container);
    editor.setText('\\begin{document} % note\n$x^2$\n');
    const view = editor.getView();

    const spanText = (tag: Parameters<typeof latexHighlightStyle.style>[0][number]) => {
      const cls = latexHighlightStyle.style([tag]);
      return Array.from(container.querySelectorAll(`.cm-line span.${cls}`)).map((el) => el.textContent);
    };

    expect(highlightingFor(view.state, [tags.tagName])).toBe(latexHighlightStyle.style([tags.tagName]));
    expect(spanText(tags.tagName)).toContain('\\begin');
    expect(spanText(tags.atom)).toContain('document');
    expect(spanText(tags.comment)).toContain('% note');
    expect(spanText(tags.keyword)).toContain('$');

    view.destroy();
    container.remove();
  });
});
