import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// A 1x1 PNG, small enough to send over WebRTC in one chunk.
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const fileRow = (page: Page, path: string) => page.locator(`#file-tree li[data-path="${path}"]`);
const editor = (page: Page) => page.locator('#editor-pane .cm-content');

// Wait for the loading screen to go away and the editor to show up.
async function waitForApp(page: Page) {
  await expect(page.locator('#app-loading')).not.toHaveClass(/is-active/);
  await expect(editor(page)).toBeVisible();
}

// Put the cursor at the end of the open file and type a new line.
async function typeAtEnd(page: Page, text: string) {
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(`\n${text}`);
}

test('host and guest sync files and edits both ways', async ({ browser, guestBrowser }) => {
  // Each context has its own storage, like two separate browsers.
  // In a mixed project the guest's context comes from a different engine.
  const hostContext = await browser.newContext();
  const guestContext = await guestBrowser.newContext();
  // Both are first visits, so mark the first-run tour as seen, or it would sit on top of the app.
  // Each also gets a display name, which is what peers see in the presence avatars (issue #22).
  const names = new Map([
    [hostContext, 'Host Person'],
    [guestContext, 'Guest Person'],
  ]);
  for (const [context, displayName] of names) {
    await context.addInitScript((name) => {
      localStorage.setItem('latex-editor.settings', JSON.stringify({ version: 1, values: { tourSeen: true, displayName: name }, updatedAt: {} }));
    }, displayName);
  }
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const stamp = Date.now().toString(36);

  try {
    // Sharing is off until the host starts it (issue #224), so watch for tracker connections.
    const sockets: string[] = [];
    host.on('websocket', (socket) => sockets.push(socket.url()));
    const shareLink = host.locator('#share-link');
    /** Open the Share popover and check nothing has connected. Hovering Share only preloads the P2P code. */
    const expectNotSharing = async () => {
      await expect(host.locator('#connection-status')).toHaveText('Not sharing');
      await host.locator('#share-btn').click();
      await expect(host.locator('#share-popover')).toHaveAttribute('aria-hidden', 'false');
      await expect(host.locator('#share-start-btn')).toBeVisible();
      await expect(shareLink).toBeHidden();
      // Give a join a moment to show up if one were going to.
      await host.waitForTimeout(1_000);
      expect(sockets).toEqual([]);
    };

    // First, the host opens the app. Opening Share doesn't start anything.
    await host.goto('/');
    await waitForApp(host);
    await expect(fileRow(host, 'main.tex')).toBeVisible();
    await expectNotSharing();

    // Start sharing makes the link. We read it from the page since the clipboard may be blocked.
    await host.locator('#share-start-btn').click();
    await expect(shareLink).toHaveAttribute('href', /[?&]room=/);
    const roomUrl = (await shareLink.getAttribute('href'))!;

    // A reload doesn't rejoin on its own. It offers the same link instead.
    sockets.length = 0;
    await host.reload();
    await waitForApp(host);
    await expectNotSharing();
    await host.locator('#share-resume-btn').click();
    await expect(shareLink).toHaveAttribute('href', roomUrl);
    await host.keyboard.press('Escape');
    await expect(host.locator('#share-popover')).toHaveAttribute('aria-hidden', 'true');

    // Then the host uploads an image.
    // The file pane also has an Upload button for empty projects, so use the one in its header.
    await host.locator('#file-pane .file-pane-actions [data-command="file.upload"]').click();
    await host.locator('#upload-input').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: PIXEL_PNG });
    await expect(host.locator('#upload-results')).toContainText('pixel.png: added');
    await host.locator('#upload-done').click();
    await expect(fileRow(host, 'pixel.png')).toBeVisible();

    // Then the guest opens the link and both sides wait to find each other through the relays.
    await guest.goto(roomUrl);
    await waitForApp(guest);
    // The badge adds the peer count (and says Relayed through TURN), so only match the start of it.
    await expect(host.locator('#connection-status')).toHaveText(/Connected|Relayed/);
    await expect(guest.locator('#connection-status')).toHaveText(/Connected|Relayed/);

    // The guest should see the whole file tree.
    await expect(fileRow(guest, 'main.tex')).toBeVisible();
    await expect(fileRow(guest, 'pixel.png')).toBeVisible();

    // Each side sees the other in the avatars next to Share, and a dot on the file they have open.
    // The tooltip says who and where. This only needs presence messages, not editor focus.
    await expect(guest.locator('#presence-bar .presence-avatar:not(.is-self)')).toHaveAttribute('data-tooltip', 'Host Person · in main.tex');
    await expect(host.locator('#presence-bar .presence-avatar:not(.is-self)')).toHaveAttribute('data-tooltip', /^Guest Person · /);
    await expect(fileRow(guest, 'main.tex').locator('.file-row-peers')).toHaveAttribute('aria-label', 'Open by Host Person');

    // Check that an edit on the host reaches the guest.
    await fileRow(guest, 'main.tex').locator('.file-row-main').click();
    const hostEdit = `% host edit ${stamp}`;
    await typeAtEnd(host, hostEdit);
    await expect(editor(guest)).toContainText(hostEdit);
    // Typing sent the host's cursor, so its caret shows in the guest's editor with the host's name.
    await expect(editor(guest).locator('.cm-ySelectionInfo')).toHaveText('Host Person');

    // Check that an edit on the guest reaches the host.
    const guestEdit = `% guest edit ${stamp}`;
    await typeAtEnd(guest, guestEdit);
    await expect(editor(host)).toContainText(guestEdit);

    // Finally, the guest opens the image, which comes over WebRTC from the host.
    await fileRow(guest, 'pixel.png').locator('.file-row-main').click();
    const image = guest.locator('#file-viewer img.file-viewer-image');
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);

    // Stop sharing asks first, since the guest is connected, then really leaves the room.
    await host.locator('#share-btn').click();
    await host.locator('#share-stop-btn').click();
    await host.getByRole('alertdialog').getByRole('button', { name: 'Stop sharing' }).click();
    await expect(host.locator('#connection-status')).toHaveText('Not sharing');
    await expect(host.locator('#share-start-btn')).toBeVisible();
    await expect(host.locator('#share-resume-btn')).toBeHidden();
    await expect(guest.locator('#connection-status')).not.toHaveText(/Connected|Relayed/);
  } finally {
    await guestContext.close();
    await hostContext.close();
  }
});
