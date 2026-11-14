import { describe, expect, it } from 'vitest';
import { mountAppShell } from '../test/appShell';
import { renderMock } from './hoverPreviewMocks';
import type { CommandId } from './menuBar';

const commandsInPage = new Set(Array.from(mountAppShell().querySelectorAll<HTMLElement>('[data-command]'), (el) => el.dataset.command));
document.body.innerHTML = '';

const PICTURED: CommandId[] = [
  'view.layoutSplit',
  'view.layoutEditorOnly',
  'view.layoutPreviewOnly',
  'view.compileNow',
  'file.newFile',
  'file.newFolder',
  'file.upload',
  'file.saveNow',
  'view.togglePauseSaving',
  'file.export',
  'file.download',
  'file.downloadFile',
  'share.copyLink',
  'app.commandPalette',
  'view.toggleEditorTheme',
  'view.togglePreviewTheme',
];

describe('hover preview pictures', () => {
  it.each(PICTURED)('draws %s, a command in the menus or toolbar', (commandId) => {
    expect(commandsInPage.has(commandId)).toBe(true);
    const mock = renderMock(commandId);
    expect(mock).toBeInstanceOf(HTMLElement);
    expect(mock!.childElementCount).toBeGreaterThan(0);
    // A fresh picture each time, since the card replaces its content.
    expect(renderMock(commandId)).not.toBe(mock);
  });

  it('shows each layout with its panes', () => {
    const panes = (id: CommandId) => Array.from(renderMock(id)!.querySelectorAll('.hpm-panes > .hpm-pane'), (pane) => pane.classList[1]);
    expect(panes('view.layoutSplit')).toEqual(['hpm-editor', 'hpm-preview']);
    expect(panes('view.layoutEditorOnly')).toEqual(['hpm-editor']);
    expect(panes('view.layoutPreviewOnly')).toEqual(['hpm-preview']);
  });

  it('marks the file the command adds, and Share shows the copied link', () => {
    expect(renderMock('file.newFolder')!.querySelector('.is-added')?.textContent).toContain('figures');
    expect(renderMock('file.upload')!.querySelector('.is-added')?.textContent).toContain('figure.png');
    expect(renderMock('share.copyLink')!.textContent).toContain('Copied');
  });

  it('draws one theme for the palette theme commands', () => {
    for (const id of ['view.darkMode', 'view.lightMode', 'view.systemTheme'] as const) {
      expect(renderMock(id)!.classList.contains('hpm-theme')).toBe(true);
    }
  });

  it('leaves commands a picture would not help to their text', () => {
    expect(renderMock('help.documentation')).toBeNull();
    expect(renderMock('edit.undo')).toBeNull();
  });
});
