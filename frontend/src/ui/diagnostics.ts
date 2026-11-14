import { StateEffect, StateField, RangeSetBuilder, type EditorState, type Extension, type Transaction } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, gutter } from '@codemirror/view';
import type { Diagnostic } from '@codemirror/lint';

export type EditorDiagnostic = {
  line: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  raw?: string;
  /** Where the problem starts on its line, from 0. Without it, the whole line is marked. */
  column?: number;
  /** How many characters from `column` to mark. */
  length?: number;
  /** What it's about, like `cite:knuth`, so the same problem from the preview and the project checks shows once. */
  subject?: string;
};

/** The preview's diagnostics, set after each compile. */
const setDiagnosticsEffect = StateEffect.define<EditorDiagnostic[]>();
/** The project checks' diagnostics (issue #246), set by projectDiagnostics.ts in the lazy completion chunk. */
const setProjectDiagnosticsEffect = StateEffect.define<EditorDiagnostic[]>();

function diagnosticsState(effectType: typeof setDiagnosticsEffect) {
  return StateField.define<EditorDiagnostic[]>({
    create: () => [],
    update(value, transaction) {
      for (const effect of transaction.effects) {
        if (effect.is(effectType)) return effect.value;
      }
      return value;
    },
  });
}

const diagnosticsField = diagnosticsState(setDiagnosticsEffect);
const projectDiagnosticsField = diagnosticsState(setProjectDiagnosticsEffect);

/** Both sets, the preview's first. A project check the preview already made on that line is left out. */
function allDiagnostics(state: EditorState): EditorDiagnostic[] {
  const preview = state.field(diagnosticsField);
  const project = state.field(projectDiagnosticsField);
  if (!project.length) return [...preview];
  const seen = new Set(preview.filter((d) => d.subject).map((d) => `${d.line}:${d.subject}`));
  return [...preview, ...project.filter((d) => !d.subject || !seen.has(`${d.line}:${d.subject}`))];
}

const lineDecorationsField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(_decorations, transaction) {
    const diagnostics = allDiagnostics(transaction.state);
    const builder = new RangeSetBuilder<Decoration>();
    // RangeSetBuilder needs ranges in order, and diagnostics can come in any order.
    for (const diagnostic of diagnostics.sort((a, b) => a.line - b.line)) {
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
  return allDiagnostics(view.state).map((diagnostic) => {
    const line = view.state.doc.line(Math.min(Math.max(diagnostic.line, 1), view.state.doc.lines));
    const from = diagnostic.column === undefined ? line.from : Math.min(line.from + diagnostic.column, line.to);
    const to = diagnostic.column === undefined ? line.to : Math.min(from + (diagnostic.length ?? 0), line.to);
    return {
      from,
      to,
      severity: diagnostic.severity,
      message: diagnostic.message,
    };
  });
}

/** The diagnostics state and the line highlights. These work without @codemirror/lint. */
export const diagnosticsExtensions = [diagnosticsField, projectDiagnosticsField, lineDecorationsField];

/** Whether a transaction set either set of diagnostics, so the linter reads them again. */
export function setsDiagnostics(transaction: Transaction): boolean {
  return transaction.effects.some((effect) => effect.is(setDiagnosticsEffect) || effect.is(setProjectDiagnosticsEffect));
}

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
  return [lintGutter(), linter(diagnosticsToLint, { needsRefresh: (update) => update.transactions.some(setsDiagnostics) })];
}

export function setEditorDiagnostics(view: EditorView, diagnostics: EditorDiagnostic[]) {
  view.dispatch({
    effects: setDiagnosticsEffect.of(diagnostics),
  });
}

/** Sets the open file's project diagnostics, kept apart from the preview's so neither replaces the other. */
export function setProjectDiagnostics(view: EditorView, diagnostics: EditorDiagnostic[]) {
  view.dispatch({ effects: setProjectDiagnosticsEffect.of(diagnostics) });
}
