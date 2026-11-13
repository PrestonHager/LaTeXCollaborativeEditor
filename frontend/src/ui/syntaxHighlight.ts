import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/*
 * Token colors for the stex (LaTeX) mode. Each color is a CSS variable from style.css,
 * so switching the editor theme (data-editor-theme on <html>) recolors tokens with no
 * CodeMirror reconfigure.
 *
 * What stex emits, and where it lands:
 * - `\command`, `\\`, `^`, `_` in math   -> tagName  -> keyword color
 * - arguments of \begin, \label, \cite, \usepackage... -> atom -> string color
 * - math delimiters (`$`, `\[`, `\(`) and math letters, numbers -> keyword / variableName.special / number -> number color
 * - `{` `}` `[` `]`                      -> bracket  -> operator color
 * - `% comment`                          -> comment  -> comment color
 */
export const latexHighlightStyle = HighlightStyle.define([
  { tag: tags.tagName, color: 'var(--editor-keyword)' },
  { tag: [tags.atom, tags.string], color: 'var(--editor-string)' },
  { tag: [tags.keyword, tags.number, tags.special(tags.variableName)], color: 'var(--editor-number)' },
  { tag: tags.bracket, color: 'var(--editor-operator)' },
  { tag: tags.comment, color: 'var(--editor-comment)', fontStyle: 'italic' },
]);

export const latexSyntaxHighlighting = syntaxHighlighting(latexHighlightStyle);
