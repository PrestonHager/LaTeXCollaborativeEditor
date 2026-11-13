import { returnFocusOnClose } from './focusReturn';
import { baseNameRange, type NameSuggestion } from './nameChecks';

export { baseNameRange };

/**
 * In-app stand-ins for window.confirm, window.prompt and window.alert (#133).
 * Each call builds its own Basecoat <dialog>, shows it, and removes it once it closes.
 * They match the app theme, name the action on the button, and check typed names inline.
 * The browser's own dialogs are banned in src/ (see noNativeDialogs.test.ts), except beforeunload.
 */

export type ConfirmOptions = {
  title: string;
  message: string;
  /** Name the action, like "Delete file". Never just "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  /** Red confirm button, and focus starts on Cancel so Enter doesn't do the risky thing. */
  destructive?: boolean;
};

export type PromptOptions = {
  title: string;
  message?: string;
  /** The text box's label, like "File name". */
  label: string;
  initialValue?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Return a problem to show under the box, or null when the value is fine. Gets the trimmed value. */
  validate?: (value: string) => string | null;
  /**
   * Select only the base name on open, so typing replaces "chapter" in "chapters/chapter.tex".
   * Off selects everything, for names that aren't paths.
   */
  selectBaseName?: boolean;
  /**
   * For a name that's taken, a free one to offer instead (see suggestFreeName in nameChecks.ts).
   * A taken name on open gets swapped for the free one, with a note saying so.
   * A taken name typed in gets a "Use ..." button, and Enter swaps it in rather than failing.
   */
  suggest?: (value: string) => NameSuggestion | null;
};

export type NoticeOptions = { title: string; message: string; closeLabel?: string };

let nextId = 0;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props);
}

function button(label: string, variant?: string): HTMLButtonElement {
  const b = el('button', { type: 'button', className: 'btn', textContent: label });
  if (variant) b.dataset.variant = variant;
  return b;
}

type Shell = {
  dialog: HTMLDialogElement;
  body: HTMLElement;
  footer: HTMLElement;
  /** Show it, and resolve with the value passed to finish(), or the cancel value. */
  run<T>(cancelValue: T, start: (finish: (value: T) => void) => void): Promise<T>;
};

/** The <dialog> every kind shares: title, message, footer, focus return, Escape and backdrop to cancel. */
function shell(kind: string, title: string, message: string | undefined): Shell {
  const id = `app-dialog-${(nextId += 1)}`;
  // dialog-sm is the size for confirm, prompt and notice dialogs (docs/ui-sizing.md).
  const dialog = el('dialog', { className: `dialog dialog-sm app-dialog app-dialog-${kind}` });
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  const header = el('header');
  header.append(el('h2', { id: `${id}-title`, textContent: title }));
  if (message) {
    header.append(el('p', { id: `${id}-message`, className: 'app-dialog-message', textContent: message }));
    dialog.setAttribute('aria-describedby', `${id}-message`);
  }
  const body = el('section');
  const footer = el('footer');
  const box = el('div');
  box.append(header, body, footer);
  dialog.append(box);

  const run = <T>(cancelValue: T, start: (finish: (value: T) => void) => void) =>
    new Promise<T>((resolve) => {
      let result = cancelValue;
      let done = false;
      const focusReturn = returnFocusOnClose(dialog);
      const finish = (value: T) => {
        if (done) return;
        done = true;
        result = value;
        // NOTE: jsdom has no dialog methods, so fall back to the open attribute there.
        if (typeof dialog.close === 'function') dialog.close();
        else {
          dialog.removeAttribute('open');
          dialog.dispatchEvent(new Event('close'));
        }
      };
      // Escape fires cancel. Handle it here so it closes the same way in every browser (and in tests).
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        finish(cancelValue);
      });
      // A click on the dark area around the box cancels, like the other dialogs.
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) finish(cancelValue);
      });
      // Keys typed here are for the dialog, not the app's shortcuts (Ctrl+N would open a second one).
      dialog.addEventListener('keydown', (event) => event.stopPropagation());
      // returnFocusOnClose listens first, so focus is back before the dialog leaves the page.
      dialog.addEventListener('close', () => {
        dialog.remove();
        resolve(result);
      });
      document.body.append(dialog);
      focusReturn.remember();
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      start(finish);
    });

  return { dialog, body, footer, run };
}

/** Ask yes or no. Resolves true only for the confirm button. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  const { dialog, body, footer, run } = shell('confirm', options.title, options.message);
  body.remove();
  const cancel = button(options.cancelLabel ?? 'Cancel', 'outline');
  const ok = button(options.confirmLabel, options.destructive ? 'destructive' : undefined);
  footer.append(cancel, ok);
  if (options.destructive) dialog.setAttribute('role', 'alertdialog');
  return run(false, (finish) => {
    cancel.addEventListener('click', () => finish(false));
    ok.addEventListener('click', () => finish(true));
    (options.destructive ? cancel : ok).focus();
  });
}

/** Ask for a name. Resolves with the trimmed value, or null when canceled. */
export function promptDialog(options: PromptOptions): Promise<string | null> {
  const { dialog, body, footer, run } = shell('prompt', options.title, options.message);
  const id = dialog.getAttribute('aria-labelledby')!.replace(/-title$/, '');
  const form = el('form', { className: 'app-dialog-form', noValidate: true });
  form.id = `${id}-form`;
  const label = el('label', { className: 'label', htmlFor: `${id}-input`, textContent: options.label });
  const input = el('input', {
    id: `${id}-input`,
    type: 'text',
    className: 'app-dialog-input',
    value: options.initialValue ?? '',
    autocomplete: 'off',
    spellcheck: false,
  });
  const error = el('p', { id: `${id}-error`, className: 'app-dialog-error', hidden: true });
  error.setAttribute('role', 'alert');
  input.setAttribute('aria-describedby', `${id}-error`);
  form.append(label, input, error);
  body.append(form);
  const cancel = button(options.cancelLabel ?? 'Cancel', 'outline');
  const ok = button(options.confirmLabel);
  ok.type = 'submit';
  ok.setAttribute('form', form.id);
  footer.append(cancel, ok);

  const problem = () => options.validate?.(input.value.trim()) ?? null;
  const suggestion = (message: string | null) => (message && options.suggest?.(input.value.trim())) || null;
  const selectName = () => {
    const [start, end] = options.selectBaseName === false ? [0, input.value.length] : baseNameRange(input.value);
    input.setSelectionRange(start, end);
  };
  /** Show what's wrong under the box, with a button for a free name when there is one. */
  const showProblem = (message: string | null, offer: NameSuggestion | null = null) => {
    error.replaceChildren(message ?? '');
    error.hidden = !message;
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
    if (!offer) return;
    const use = button(`Use ${offer.value}`, 'link');
    use.dataset.size = 'sm';
    use.classList.add('app-dialog-suggest');
    use.addEventListener('click', () => useSuggestion(offer));
    error.append(' ', use);
  };
  /**
   * Put the free name in the box with its base name selected, and keep saying why until they type.
   * The box is fine now, so it isn't marked invalid.
   */
  const useSuggestion = (offer: NameSuggestion) => {
    input.value = offer.value;
    showProblem(offer.message);
    input.removeAttribute('aria-invalid');
    input.focus();
    selectName();
  };

  return run<string | null>(null, (finish) => {
    // Say what's wrong as they type, once they've started. An empty box on open isn't an error yet.
    input.addEventListener('input', () => {
      const message = problem();
      showProblem(message, suggestion(message));
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const message = problem();
      const offer = suggestion(message);
      // Enter on a taken name fills in the free one, and a second Enter takes it.
      if (offer) {
        useSuggestion(offer);
        return;
      }
      showProblem(message);
      if (message) {
        input.focus();
        return;
      }
      finish(input.value.trim());
    });
    cancel.addEventListener('click', () => finish(null));
    // A default name that's already taken, like a second chapter.tex, starts as the next free one.
    const offer = input.value.trim() ? suggestion(problem()) : null;
    if (offer) useSuggestion(offer);
    else {
      input.focus();
      selectName();
    }
  });
}

/** A short message with one button, in place of window.alert. */
export function noticeDialog(options: NoticeOptions): Promise<void> {
  const { footer, body, run } = shell('notice', options.title, options.message);
  body.remove();
  const close = button(options.closeLabel ?? 'OK');
  footer.append(close);
  return run<void>(undefined, (finish) => {
    close.addEventListener('click', () => finish(undefined));
    close.focus();
  });
}
