import { expect, test, type Page } from '@playwright/test';

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

test('host and guest sync files and edits both ways', async ({ browser }) => {
  // Each context has its own storage, like two separate browsers.
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const stamp = Date.now().toString(36);

  try {
    // First, the host opens the app and uploads an image.
    await host.goto('/');
    await waitForApp(host);
    await expect(fileRow(host, 'main.tex')).toBeVisible();

    await host.locator('#file-pane [data-command="file.upload"]').click();
    await host.locator('#upload-input').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: PIXEL_PNG });
    await expect(host.locator('#upload-results')).toContainText('pixel.png: added');
    await host.locator('#upload-done').click();
    await expect(fileRow(host, 'pixel.png')).toBeVisible();

    // Now the host shares, and we read the room link from the page since the clipboard may be blocked.
    await host.locator('#share-btn').click();
    const shareLink = host.locator('#share-link');
    await expect(shareLink).toHaveAttribute('href', /[?&]room=/);
    const roomUrl = (await shareLink.getAttribute('href'))!;

    // Then the guest opens the link and both sides wait to find each other through the relays.
    await guest.goto(roomUrl);
    await waitForApp(guest);
    await expect(host.locator('#connection-status')).toHaveText('Connected');
    await expect(guest.locator('#connection-status')).toHaveText('Connected');

    // The guest should see the whole file tree.
    await expect(fileRow(guest, 'main.tex')).toBeVisible();
    await expect(fileRow(guest, 'pixel.png')).toBeVisible();

    // Check that an edit on the host reaches the guest.
    await fileRow(guest, 'main.tex').locator('.file-row-main').click();
    const hostEdit = `% host edit ${stamp}`;
    await typeAtEnd(host, hostEdit);
    await expect(editor(guest)).toContainText(hostEdit);

    // Check that an edit on the guest reaches the host.
    const guestEdit = `% guest edit ${stamp}`;
    await typeAtEnd(guest, guestEdit);
    await expect(editor(host)).toContainText(guestEdit);

    // Finally, the guest opens the image, which comes over WebRTC from the host.
    await fileRow(guest, 'pixel.png').locator('.file-row-main').click();
    const image = guest.locator('#file-viewer img.file-viewer-image');
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  } finally {
    await guestContext.close();
    await hostContext.close();
  }
});
