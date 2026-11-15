import { expect, test, type Locator, type Page } from '@playwright/test';

// Phone and tablet layout check (issue #191, the last part of #123).
// At each size: nothing scrolls sideways, the main panes can be reached, every dialog-md and dialog-lg
// dialog opens and fits in the window, and the Menu, More and Share popovers stay on screen.
// It runs in the `mobile-layout` project only (see playwright.config.ts), with Chromium emulating touch.

type Viewport = { name: string; width: number; height: number; phone: boolean };

// The sizes from #123. Under 640px is the phone layout (one pane, Menu and More); 640px and up is the tablet and desktop one.
const VIEWPORTS: Viewport[] = [
  { name: 'small phone', width: 360, height: 640, phone: true },
  { name: 'phone', width: 390, height: 844, phone: true },
  { name: 'tablet portrait', width: 768, height: 1024, phone: false },
  { name: 'tablet landscape', width: 1024, height: 768, phone: false },
];

// Every dialog-md and dialog-lg dialog in index.html, and the menu command that opens it.
// The conflict dialog has no command (it opens when a save conflicts), so the test opens it directly.
const DIALOGS: { id: string; command?: string; via?: 'about' }[] = [
  { id: 'settings-dialog', command: 'app.openSettings' },
  { id: 'upload-dialog', command: 'file.upload' },
  { id: 'export-dialog', command: 'file.export' },
  { id: 'projects-dialog', command: 'file.openLocal' },
  { id: 'accounts-dialog', command: 'app.accounts' },
  { id: 'about-dialog', command: 'help.about' },
  { id: 'changelog-dialog', via: 'about' },
  { id: 'conflict-dialog' },
];

// Half a pixel or so of rounding is fine.
const SLACK = 1;

async function waitForApp(page: Page) {
  await expect(page.locator('#app-loading')).not.toHaveClass(/is-active/);
  await expect(page.locator('#editor-pane .cm-content')).toBeAttached();
}

/** Fail if the page can scroll sideways. */
async function expectNoSidewaysScroll(page: Page, when: string) {
  const sizes = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    view: document.documentElement.clientWidth,
    // The page and the app shell clip their overflow, but focus() can still scroll a clipped box
    // sideways, which shifts everything off screen with no scrollbar to get it back.
    scrolled: [window.scrollX, document.documentElement.scrollLeft, document.body.scrollLeft, document.getElementById('app')?.scrollLeft ?? 0],
  }));
  expect(sizes.doc, `page is wider than the window ${when}`).toBeLessThanOrEqual(sizes.view + SLACK);
  expect(sizes.body, `body is wider than the window ${when}`).toBeLessThanOrEqual(sizes.view + SLACK);
  expect(sizes.scrolled, `page or app shell is scrolled sideways ${when}`).toEqual([0, 0, 0, 0]);
}

/**
 * Fail unless the element is visible and its whole box is inside the window.
 * Drawers, menus and dialogs slide or scale in, so keep checking until the box settles (or time runs out).
 */
async function expectOnScreen(page: Page, locator: Locator, what: string) {
  await expect(locator, `${what} should be visible`).toBeVisible();
  const view = page.viewportSize()!;
  await expect(async () => {
    const box = await locator.boundingBox();
    expect(box, `${what} has no box`).not.toBeNull();
    expect(box!.width, `${what} has no width`).toBeGreaterThan(0);
    expect(box!.x, `${what} starts left of the window`).toBeGreaterThanOrEqual(-SLACK);
    expect(box!.y, `${what} starts above the window`).toBeGreaterThanOrEqual(-SLACK);
    expect(box!.x + box!.width, `${what} runs past the right edge`).toBeLessThanOrEqual(view.width + SLACK);
    expect(box!.y + box!.height, `${what} runs past the bottom edge`).toBeLessThanOrEqual(view.height + SLACK);
  }).toPass({ timeout: 5_000 });
}

/** Fail if something inside the element is wider than it, so it would scroll sideways. */
async function expectNoInnerSidewaysScroll(locator: Locator, what: string) {
  const overflow = await locator.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow, `${what} scrolls sideways`).toBeLessThanOrEqual(SLACK);
}

/** Run a command from the menus the way a person would: Menu on a phone, the matching menu otherwise. */
async function runFromMenu(page: Page, command: string) {
  const collapsed = page.locator('#menu-collapsed-root > .menu-trigger');
  if (await collapsed.isVisible()) {
    await collapsed.click();
    await page.locator(`#menu-all [data-command="${command}"]`).click();
    return;
  }
  const root = page.locator('#menu-bar > .menu-root:not(.menu-root-collapsed)').filter({ has: page.locator(`[data-command="${command}"]`) });
  await root.locator('.menu-trigger').click();
  await root.locator(`[data-command="${command}"]`).click();
}

async function openDialog(page: Page, dialog: (typeof DIALOGS)[number]) {
  if (dialog.command) {
    await runFromMenu(page, dialog.command);
  } else if (dialog.via === 'about') {
    await runFromMenu(page, 'help.about');
    await page.locator('#about-dialog[open] #about-changelog').click();
  } else {
    // The conflict dialog only opens on a real save conflict, so fill it the way conflictDialog.ts does and show it.
    await page.evaluate((id) => {
      const el = document.getElementById(id) as HTMLDialogElement;
      const path = el.querySelector('#conflict-dialog-path');
      if (path) path.textContent = 'chapters/a-rather-long-chapter-file-name.tex';
      el.showModal();
    }, dialog.id);
  }
}

async function closeDialogs(page: Page) {
  // Escape closes the top dialog. The conflict dialog ignores it on purpose, so close any that are left directly.
  for (let i = 0; i < 3 && (await page.locator('dialog[open]').count()) > 0; i += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
  await page.evaluate(() => document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((d) => d.close()));
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test.beforeEach(async ({ context, page }) => {
      // A first visit, so mark the tour as seen or it would sit on top of everything.
      await context.addInitScript(() => {
        localStorage.setItem('latex-editor.settings', JSON.stringify({ version: 1, values: { tourSeen: true }, updatedAt: {} }));
      });
      await page.goto('/');
      await waitForApp(page);
    });

    test('nothing scrolls sideways and the main panes are reachable', async ({ page }) => {
      await expectNoSidewaysScroll(page, 'on load');
      const editor = page.locator('#editor-pane');
      const preview = page.locator('#preview-pane');
      const files = page.locator('#file-pane');

      if (viewport.phone) {
        // One pane at a time, switched from the bar, and the file list as a drawer (#185).
        await expectOnScreen(page, page.locator('#phone-bar'), 'the pane bar');
        await expect(editor).toBeVisible();
        await expect(preview).toBeHidden();

        await page.locator('#phone-show-preview').click();
        await expect(preview).toBeVisible();
        await expect(editor).toBeHidden();
        await expectNoSidewaysScroll(page, 'showing the preview');

        await page.locator('#phone-show-editor').click();
        await expect(editor).toBeVisible();
        await expect(preview).toBeHidden();

        await page.locator('#phone-files').click();
        await expect(page.locator('#phone-files')).toHaveAttribute('aria-expanded', 'true');
        await expectOnScreen(page, files, 'the Files drawer');
        await expect(files.locator('.file-row[data-path="main.tex"]')).toBeVisible();
        await expectNoSidewaysScroll(page, 'with the Files drawer open');
        await page.keyboard.press('Escape');
        await expect(page.locator('#phone-files')).toHaveAttribute('aria-expanded', 'false');
      } else {
        // Tablets keep the split: files, editor and preview side by side.
        await expect(page.locator('#phone-bar')).toBeHidden();
        for (const [pane, name] of [
          [files, 'the Files pane'],
          [editor, 'the editor'],
          [preview, 'the preview'],
        ] as const) {
          await expect(pane, `${name} should be visible`).toBeVisible();
          const box = (await pane.boundingBox())!;
          expect(box.width, `${name} is too narrow to use`).toBeGreaterThan(100);
          expect(box.x + box.width, `${name} runs past the right edge`).toBeLessThanOrEqual(viewport.width + SLACK);
        }
      }
      await expectOnScreen(page, page.locator('#share-btn'), 'the Share button');
      await expectOnScreen(page, page.locator('#toolbar'), 'the toolbar');
    });

    for (const dialog of DIALOGS) {
      test(`#${dialog.id} opens and fits`, async ({ page }) => {
        await openDialog(page, dialog);
        // Basecoat's <dialog> has no box of its own; the panel is the <div> inside it.
        const box = page.locator(`#${dialog.id}[open] > div`).first();
        await expectOnScreen(page, box, `#${dialog.id}`);
        await expectNoInnerSidewaysScroll(box, `#${dialog.id}`);
        // The footer buttons stay in view, since the body scrolls instead.
        const footer = box.locator(':scope > footer');
        if ((await footer.count()) > 0) await expectOnScreen(page, footer, `#${dialog.id} footer`);
        await expectNoSidewaysScroll(page, `with #${dialog.id} open`);
        await closeDialogs(page);
      });
    }

    test('Menu, More and Share popovers stay on screen', async ({ page }) => {
      const popovers: { trigger: Locator; popover: Locator; name: string }[] = [];
      if (viewport.phone) {
        await expect(page.locator('#menu-collapsed-root')).toBeVisible();
        popovers.push({ trigger: page.locator('#menu-collapsed-root > .menu-trigger'), popover: page.locator('#menu-all'), name: 'Menu' });
        popovers.push({ trigger: page.locator('.toolbar-more > .menu-trigger'), popover: page.locator('#toolbar-more-menu'), name: 'More actions' });
      } else {
        await expect(page.locator('#menu-collapsed-root')).toBeHidden();
        await expect(page.locator('.toolbar-more')).toBeHidden();
        for (const root of await page.locator('#menu-bar > .menu-root:not(.menu-root-collapsed)').all()) {
          const name = (await root.getAttribute('data-menu-label')) ?? 'menu';
          popovers.push({ trigger: root.locator(':scope > .menu-trigger'), popover: root.locator(':scope > .menu-popover'), name });
        }
      }
      popovers.push({ trigger: page.locator('#share-btn'), popover: page.locator('#share-popover'), name: 'Share' });

      for (const { trigger, popover, name } of popovers) {
        await trigger.click();
        await expect(popover, `${name} should open`).toHaveAttribute('aria-hidden', 'false');
        await expectOnScreen(page, popover, `the ${name} popover`);
        await expectNoSidewaysScroll(page, `with ${name} open`);
        await page.keyboard.press('Escape');
        await expect(popover).toHaveAttribute('aria-hidden', 'true');
      }
    });
  });
}
