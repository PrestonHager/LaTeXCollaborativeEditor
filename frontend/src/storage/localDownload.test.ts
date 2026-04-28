import { LocalDownloadStorage } from './localDownload';

describe('LocalDownloadStorage', () => {
  it('creates a temporary link and revokes object URL', () => {
    vi.useFakeTimers();
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-url');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const storage = new LocalDownloadStorage();
    storage.download('doc.tex', 'abc');

    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);

    vi.runAllTimers();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:test-url');
    vi.useRealTimers();
  });
});
