import { StateEffect, StateField, RangeSetBuilder } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import { linter, type Diagnostic } from '@codemirror/lint';

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
    for (const diagnostic of diagnostics) {
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

const diagnosticsLinter = linter((view): Diagnostic[] => {
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
});

export const diagnosticsExtensions = [diagnosticsField, lineDecorationsField, diagnosticsLinter];

export function setEditorDiagnostics(view: EditorView, diagnostics: EditorDiagnostic[]) {
  view.dispatch({
    effects: setDiagnosticsEffect.of(diagnostics),
  });
}
