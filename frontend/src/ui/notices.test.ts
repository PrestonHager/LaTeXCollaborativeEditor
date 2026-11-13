import { createNotice, helpForMessage } from './notices';
import { mountAppShell } from '../test/appShell';

describe('helpForMessage', () => {
  it('matches problems to the docs that explain them', () => {
    expect(helpForMessage('Save Error: Browser storage is full. Download a copy, then clear old local docs.')?.topic).toBe('storageFull');
    expect(helpForMessage('Sign-in popup was blocked. Allow popups for this site and try again.')?.topic).toBe('popupsBlocked');
    expect(helpForMessage('Drive: Session expired. Use File > Connect Google Drive to sign in again.')?.topic).toBe('driveSignIn');
    expect(helpForMessage('Google Drive sign-in expired, so edits are saving in this browser.')?.topic).toBe('driveSignIn');
    const saveFailed = helpForMessage('Save Error: Network request failed.');
    expect(saveFailed).toMatchObject({ topic: 'autosave', report: 'storage' });
    expect(saveFailed?.summary).not.toContain('Network');
  });

  it('leaves ordinary statuses alone', () => {
    expect(helpForMessage('Saved to Browser storage')).toBeNull();
    expect(helpForMessage('Autosave On')).toBeNull();
  });
});

describe('createNotice', () => {
  const setup = () => {
    mountAppShell();
    const root = document.getElementById('app-notice')!;
    const notice = createNotice(root, {
      getDocsBase: () => 'https://docs.test/',
      getBugUrl: (help) => `https://bugs.test/?area=${help.report}`,
      timeoutMs: 1000,
    });
    const learn = root.querySelector<HTMLAnchorElement>('[data-notice-learn]')!;
    const report = root.querySelector<HTMLAnchorElement>('[data-notice-report]')!;
    return { root, notice, learn, report };
  };

  afterEach(() => vi.useRealTimers());

  it('shows a plain message and clears it after a while', () => {
    vi.useFakeTimers();
    const { root, notice, learn, report } = setup();
    notice.show('Uploaded 2 file(s)');
    expect(notice.text()).toBe('Uploaded 2 file(s)');
    expect(learn.hidden).toBe(true);
    expect(report.hidden).toBe(true);
    expect(root.classList.contains('is-error')).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(notice.text()).toBe('');
  });

  it('adds Learn more and Report this links for errors', () => {
    vi.useFakeTimers();
    const { root, notice, learn, report } = setup();
    notice.show('Saving failed', { isError: true, help: { topic: 'autosave', report: 'storage' } });
    expect(root.classList.contains('is-error')).toBe(true);
    expect(learn.hidden).toBe(false);
    expect(learn.href).toBe('https://docs.test/saving-and-storage/#autosave-and-save-now');
    expect(report.hidden).toBe(false);
    expect(report.href).toBe('https://bugs.test/?area=storage');
    // Notices with links stay up twice as long.
    vi.advanceTimersByTime(1000);
    expect(notice.text()).toBe('Saving failed');
    vi.advanceTimersByTime(1000);
    expect(notice.text()).toBe('');
    expect(learn.hidden).toBe(true);
  });

  it('keeps sticky notices until cleared, without a report link when there is no area', () => {
    vi.useFakeTimers();
    const { notice, learn, report } = setup();
    notice.show('Popup blocked', { isError: true, sticky: true, help: { topic: 'popupsBlocked' } });
    vi.advanceTimersByTime(60_000);
    expect(notice.text()).toBe('Popup blocked');
    expect(learn.hidden).toBe(false);
    expect(report.hidden).toBe(true);
    notice.clear();
    expect(notice.text()).toBe('');
  });

  it('shows an action button that runs once and clears the notice', () => {
    vi.useFakeTimers();
    const { root, notice } = setup();
    const button = root.querySelector<HTMLButtonElement>('[data-notice-action]')!;
    const run = vi.fn();
    notice.show('Deleted a.tex', { action: { label: 'Undo', run } });
    expect(button.hidden).toBe(false);
    expect(button.textContent).toBe('Undo');
    vi.advanceTimersByTime(1000);
    expect(notice.text()).toBe('Deleted a.tex');
    button.click();
    expect(run).toHaveBeenCalledTimes(1);
    expect(notice.text()).toBe('');
    expect(button.hidden).toBe(true);
    // A later notice without one hides it.
    notice.show('Saved');
    expect(button.hidden).toBe(true);
  });
});
