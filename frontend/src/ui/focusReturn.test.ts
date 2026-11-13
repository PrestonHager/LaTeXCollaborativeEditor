import { returnFocusOnClose } from './focusReturn';
import { createAboutDialog, LICENSE_URL, renderLicenseLine, THIRD_PARTY_NOTICES_URL } from './aboutDialog';
import { mountAppShell } from '../test/appShell';

// jsdom has no showModal, so stand in for it and fire close like a browser does.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

describe('returnFocusOnClose', () => {
  it('puts focus back on the button that opened the dialog', () => {
    mountAppShell();
    const dialog = document.getElementById('upload-dialog') as HTMLDialogElement;
    const opener = document.getElementById('share-btn') as HTMLButtonElement;
    const focusReturn = returnFocusOnClose(dialog);
    opener.focus();
    focusReturn.remember();
    dialog.showModal();
    (document.getElementById('upload-done') as HTMLButtonElement).focus();
    dialog.close();
    expect(document.activeElement).toBe(opener);
  });

  it('uses the menu trigger when a menu item opened it', () => {
    mountAppShell();
    const dialog = document.getElementById('settings-dialog') as HTMLDialogElement;
    const item = document.querySelector<HTMLButtonElement>('[data-command="app.openSettings"]')!;
    const trigger = document.querySelector<HTMLButtonElement>('[aria-controls="menu-edit"]')!;
    const focusReturn = returnFocusOnClose(dialog);
    item.focus();
    focusReturn.remember();
    dialog.close();
    expect(document.activeElement).toBe(trigger);
  });

  it('falls back when the opener is hidden or gone', () => {
    mountAppShell();
    const dialog = document.getElementById('about-dialog') as HTMLDialogElement;
    const fallback = document.getElementById('share-btn') as HTMLButtonElement;
    const focusReturn = returnFocusOnClose(dialog, () => fallback);
    const input = document.querySelector<HTMLInputElement>('.command-palette-input')!;
    input.focus();
    focusReturn.remember();
    dialog.close();
    expect(document.activeElement).toBe(fallback);

    const temp = document.createElement('button');
    document.body.append(temp);
    temp.focus();
    focusReturn.remember();
    temp.remove();
    fallback.blur();
    dialog.close();
    expect(document.activeElement).toBe(fallback);
  });
});

describe('createAboutDialog', () => {
  it('shows the version and closes from its buttons and the backdrop', () => {
    mountAppShell();
    const el = document.getElementById('about-dialog') as HTMLDialogElement;
    const about = createAboutDialog(el, { version: '1.2.3', commit: 'abc1234', builtAt: '2026-11-13T10:00:00.000Z' });
    expect(document.getElementById('about-version')!.textContent).toBe('1.2.3 (commit abc1234, built 2026-11-13)');
    about.open();
    expect(el.open).toBe(true);
    (document.getElementById('about-done') as HTMLButtonElement).click();
    expect(el.open).toBe(false);
    about.open();
    (document.getElementById('about-close') as HTMLButtonElement).click();
    expect(el.open).toBe(false);
    about.open();
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(el.open).toBe(false);
  });

  it('shows the license with links to LICENSE and the third-party notices, once', () => {
    mountAppShell();
    const el = document.getElementById('about-dialog') as HTMLDialogElement;
    createAboutDialog(el, { version: '1.2.3', commit: 'dev', builtAt: '' });
    const body = el.querySelector<HTMLElement>('.about-dialog-body')!;
    renderLicenseLine(body);
    const lines = body.querySelectorAll('.about-license');
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toBe('Free software under GPL-3.0-or-later (third-party licenses)');
    expect(lines[0].previousElementSibling!.querySelector('#about-version')).not.toBeNull();
    const links = [...lines[0].querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([LICENSE_URL, THIRD_PARTY_NOTICES_URL]);
    expect(LICENSE_URL).toBe('https://github.com/PrestonHager/LaTeXCollaborativeEditor/blob/main/LICENSE');
    expect(links.every((a) => a.target === '_blank' && a.rel === 'noreferrer')).toBe(true);
  });

  it('puts the license line first when there is no version line', () => {
    const body = document.createElement('section');
    body.append(document.createElement('ul'));
    renderLicenseLine(body);
    expect(body.firstElementChild!.className).toBe('about-license');
  });
});
