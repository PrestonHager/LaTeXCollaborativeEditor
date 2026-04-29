type FileMenuActions = {
  onOpenLocal: () => void;
  onDownload: () => void;
  onConnectDrive: () => Promise<void> | void;
  onSaveNow: () => Promise<void> | void;
};

export function createFileMenu(container: HTMLElement, actions: FileMenuActions) {
  const menu = document.createElement('div');
  menu.className = 'file-menu';

  const openLocal = document.createElement('button');
  openLocal.textContent = 'Open Local Doc';
  openLocal.onclick = actions.onOpenLocal;

  const download = document.createElement('button');
  download.textContent = 'Download .tex';
  download.onclick = actions.onDownload;

  const connectDrive = document.createElement('button');
  connectDrive.textContent = 'Connect Google Drive';
  connectDrive.onclick = () => void actions.onConnectDrive();

  const saveNow = document.createElement('button');
  saveNow.textContent = 'Save Now';
  saveNow.onclick = () => void actions.onSaveNow();

  menu.append(openLocal, download, connectDrive, saveNow);
  container.appendChild(menu);

  return {
    setSaveNowEnabled(enabled: boolean) {
      saveNow.disabled = !enabled;
    },
  };
}
