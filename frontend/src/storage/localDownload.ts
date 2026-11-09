export class LocalDownloadStorage {
  download(fileName: string, data: string | Uint8Array, type = 'text/plain;charset=utf-8') {
    const blob = new Blob([data as BlobPart], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
