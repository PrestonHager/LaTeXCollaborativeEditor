type FileMenuActions = {
  onOpenLocal: () => void;
  onOpenDrive: () => Promise<void> | void;
  onDownload: () => void;
  onConnectDrive: () => Promise<void> | void;
  onSaveToDrive: () => Promise<void> | void;
  onMoveDrive: () => Promise<void> | void;
  onRenameDrive: () => Promise<void> | void;
  onSaveNow: () => Promise<void> | void;
  mode?: 'host' | 'client';
};

export function createFileMenu(container: HTMLElement, actions: FileMenuActions) {
  const menu = document.createElement('div');
  menu.className = 'file-menu';
  const mode = actions.mode ?? 'host';

  const openLocal = document.createElement('button');
  openLocal.textContent = 'Open Local Doc';
  openLocal.onclick = actions.onOpenLocal;

  const download = document.createElement('button');
  download.textContent = 'Download .tex';
  download.onclick = actions.onDownload;

  const openDrive = document.createElement('button');
  openDrive.textContent = 'Open from Google Drive';
  openDrive.onclick = () => void actions.onOpenDrive();

  const connectDrive = document.createElement('button');
  connectDrive.textContent = 'Connect Google Drive';
  connectDrive.onclick = () => void actions.onConnectDrive();

  const saveToDrive = document.createElement('button');
  saveToDrive.textContent = 'Save to Google Drive';
  saveToDrive.onclick = () => void actions.onSaveToDrive();

  const moveDrive = document.createElement('button');
  moveDrive.textContent = 'Move to Drive Folder';
  moveDrive.onclick = () => void actions.onMoveDrive();

  const renameDrive = document.createElement('button');
  renameDrive.textContent = 'Rename in Drive';
  renameDrive.onclick = () => void actions.onRenameDrive();

  const saveNow = document.createElement('button');
  saveNow.textContent = 'Save Now';
  saveNow.onclick = () => void actions.onSaveNow();

  if (mode === 'client') {
    menu.append(download);
  } else {
    menu.append(openLocal, openDrive, download, connectDrive, saveToDrive, moveDrive, renameDrive, saveNow);
  }
  container.appendChild(menu);

  return {
    setSaveNowEnabled(enabled: boolean) {
      saveNow.disabled = !enabled;
    },
  };
}
