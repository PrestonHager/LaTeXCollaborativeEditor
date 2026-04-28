export function createPreviewPane(container: HTMLElement) {
  const frame = document.createElement('iframe');
  frame.className = 'preview';
  frame.title = 'PDF Preview';
  container.appendChild(frame);

  return {
    setPdf(dataUrl: string) { frame.src = dataUrl; },
  };
}
