type TextChangedHandler = (text: string, sync?: boolean) => void;

export function createEditorPane(container: HTMLElement) {
  const textarea = document.createElement('textarea');
  textarea.className = 'editor';
  textarea.value = '\\documentclass{article}\n\\begin{document}\nHello, collaborative LaTeX!\n\\end{document}\n';
  container.appendChild(textarea);

  const handlers: TextChangedHandler[] = [];
  let suppress = false;

  textarea.addEventListener('input', () => {
    if (suppress) return;
    handlers.forEach((h) => h(textarea.value, true));
  });

  return {
    onTextChanged(handler: TextChangedHandler) { handlers.push(handler); },
    getText() { return textarea.value; },
    focus() { textarea.focus(); },
    selectAll() {
      textarea.focus();
      textarea.setSelectionRange(0, textarea.value.length);
    },
    setText(value: string, shouldSync = false) {
      suppress = true;
      textarea.value = value;
      suppress = false;
      handlers.forEach((h) => h(value, shouldSync));
    },
  };
}
