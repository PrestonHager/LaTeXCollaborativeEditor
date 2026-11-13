import { StateEffect, StateField, RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, gutter } from '@codemirror/view';
import type { Diagnostic } from '@codemirror/lint';

export type EditorDiagnostic = {
  line: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  raw?: string;
};

const setDiagnosticsEffect = StateEffect.define<EditorDiagnostic[]>();

const diagnosticsField = StateField.define<EditorDiagnostic[]>({
  create: () => [],
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setDiagnosticsEffect)) {
        return effect.value;
      }
    }
    return value;
  },
});

const lineDecorationsField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(_decorations, transaction) {
    const diagnostics = transaction.state.field(diagnosticsField);
    const builder = new RangeSetBuilder<Decoration>();
    // RangeSetBuilder needs ranges in order, and diagnostics can come in any order.
    for (const diagnostic of [...diagnostics].sort((a, b) => a.line - b.line)) {
      const line = transaction.state.doc.line(Math.min(Math.max(diagnostic.line, 1), transaction.state.doc.lines));
      const className =
        diagnostic.severity === 'error'
          ? 'cm-error-line'
          : diagnostic.severity === 'warning'
            ? 'cm-warning-line'
            : 'cm-info-line';
      builder.add(line.from, line.from, Decoration.line({ class: className }));
    }
    return builder.finish();
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Lint markers for the diagnostics in the field, read by @codemirror/lint's linter. */
export function diagnosticsToLint(view: EditorView): Diagnostic[] {
  const diagnostics = view.state.field(diagnosticsField);
  return diagnostics.map((diagnostic) => {
    const line = view.state.doc.line(Math.min(Math.max(diagnostic.line, 1), view.state.doc.lines));
    return {
      from: line.from,
      to: line.to,
      severity: diagnostic.severity,
      message: diagnostic.message,
    };
  });
}

/** The diagnostics state and the line highlights. These work without @codemirror/lint. */
export const diagnosticsExtensions = [diagnosticsField, lineDecorationsField];

/**
 * An empty gutter as wide as the lint gutter, so the text doesn't shift when the real one arrives
 * from loadLintExtensions(). The width matches @codemirror/lint's own theme.
 */
export const lintGutterPlaceholder: Extension = [
  gutter({ class: 'cm-gutter-lint' }),
  EditorView.baseTheme({ '.cm-gutter-lint': { width: '1.4em' } }),
];

type LintModule = Pick<typeof import('@codemirror/lint'), 'linter' | 'lintGutter'>;

/**
 * The lint gutter and the hover tooltips for diagnostics. @codemirror/lint isn't needed to show the
 * editor, so it loads just after the page does (about 5 kB gzipped off the initial load).
 */
export async function loadLintExtensions(load: () => Promise<LintModule> = () => import('@codemirror/lint')): Promise<Extension> {
  const { linter, lintGutter } = await load();
  return [lintGutter(), linter(diagnosticsToLint)];
}

export function setEditorDiagnostics(view: EditorView, diagnostics: EditorDiagnostic[]) {
  view.dispatch({
    effects: setDiagnosticsEffect.of(diagnostics),
  });
}
