import { basename, isPdf, isPreviewableImage, mimeType } from '../project/paths';

export type ViewerFile = {
  path: string;
  size?: number;
  /** The file's bytes, or null while they're still coming from a peer. */
  bytes: Uint8Array | null;
  /** Transfer progress from 0 to 1, when known. */
  progress?: number;
};

function formatSize(bytes?: number) {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Show images and PDFs from the project instead of opening them as text.
 * Other binary files get a short note and a download button.
 */
export function createFileViewer(root: HTMLElement, options: { onDownload: (path: string) => void }) {
  const body = root.querySelector<HTMLElement>('#file-viewer-body')!;
  const empty = root.querySelector<HTMLElement>('#file-viewer-empty')!;
  const title = root.querySelector<HTMLElement>('#file-viewer-title')!;
  const message = root.querySelector<HTMLElement>('#file-viewer-message')!;
  const progressBar = root.querySelector<HTMLElement>('#file-viewer-progress')!;
  let objectUrl: string | null = null;
  let shownPath: string | null = null;
  let shownBytes: Uint8Array | null = null;

  root.querySelector('#file-viewer-download')!.addEventListener('click', () => {
    if (shownPath) options.onDownload(shownPath);
  });

  const releaseUrl = () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  };

  const showNote = (heading: string, text: string, progress?: number) => {
    body.replaceChildren();
    body.hidden = true;
    empty.hidden = false;
    title.textContent = heading;
    message.textContent = text;
    progressBar.hidden = progress === undefined;
    if (progress !== undefined) progressBar.querySelector('span')!.style.width = `${Math.round(progress * 100)}%`;
  };

  return {
    show(file: ViewerFile) {
      root.hidden = false;
      // Skip the rebuild when nothing changed, so an image doesn't flicker on every tree update.
      if (file.path === shownPath && file.bytes && file.bytes === shownBytes) return;
      shownPath = file.path;
      shownBytes = file.bytes;
      releaseUrl();
      const name = basename(file.path);
      if (!file.bytes) {
        const percent = file.progress !== undefined ? ` (${Math.round(file.progress * 100)}%)` : '';
        showNote(name, `Getting this file from a peer${percent}...`, file.progress ?? 0);
        return;
      }
      if (!isPreviewableImage(file.path) && !isPdf(file.path)) {
        showNote(name, `${formatSize(file.size ?? file.bytes.length)}. This file type can't be shown here.`);
        return;
      }
      empty.hidden = true;
      body.hidden = false;
      objectUrl = URL.createObjectURL(new Blob([file.bytes as BlobPart], { type: mimeType(file.path) }));
      if (isPdf(file.path)) {
        // The browser's own PDF viewer handles this. It's built for PDFs from anywhere on the web.
        const frame = document.createElement('iframe');
        frame.className = 'file-viewer-pdf';
        frame.title = name;
        frame.src = objectUrl;
        body.replaceChildren(frame);
        return;
      }
      const img = document.createElement('img');
      img.className = 'file-viewer-image';
      img.alt = name;
      img.src = objectUrl;
      body.replaceChildren(img);
    },
    hide() {
      root.hidden = true;
      shownPath = null;
      shownBytes = null;
      body.replaceChildren();
      releaseUrl();
    },
  };
}
