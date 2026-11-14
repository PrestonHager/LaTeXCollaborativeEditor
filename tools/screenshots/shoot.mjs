// Take the docs screenshots in light and dark themes, with callouts on the parts each page talks about.
// Run it from the repo root with `npm run screenshots`, which builds the app first.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const frontendDir = path.join(repoRoot, 'frontend');
const outDir = path.join(repoRoot, 'docs', 'assets', 'screenshots');
// Port 5173 is the dev server's, so preview runs on its own port. Not 4190, browsers block that one.
const PORT = Number(process.env.SCREENSHOT_PORT ?? 4183);
const BASE_URL = `http://127.0.0.1:${PORT}/`;
const VIEWPORT = { width: 1280, height: 800 };
const THEMES = (process.env.SCREENSHOT_THEMES ?? 'light,dark').split(',');

const MAIN_TEX = String.raw`\documentclass{article}
\usepackage{graphicx}
\title{Field Notes}
\author{A. Writer}
\begin{document}
\maketitle

\section{Introduction}
\input{chapters/intro}

\section{Results}
The plot below shows the counts from each site.

\includegraphics[width=0.6\textwidth]{figures/plot.png}

\end{document}
`;

const INTRO_TEX = String.raw`We counted birds at five sites over two weeks.
Each site was visited every morning, and we wrote down every bird we saw or heard.
`;

/** Start `vite preview` on the built app and wait until it answers. */
async function startPreview() {
  if (!existsSync(path.join(frontendDir, 'dist', 'index.html'))) {
    throw new Error('frontend/dist is missing. Run `npm run build` first, or use `npm run screenshots` from the repo root.');
  }
  const vite = path.join(frontendDir, 'node_modules', 'vite', 'bin', 'vite.js');
  const server = spawn(process.execPath, [vite, 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    cwd: frontendDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (chunk) => process.stderr.write(chunk));
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`vite preview exited early (port ${PORT} may be in use)`);
    try {
      const res = await fetch(BASE_URL);
      if (res.ok) return server;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  server.kill();
  throw new Error(`vite preview did not start on ${BASE_URL}`);
}

/**
 * Draw numbered callouts over the page. Each one outlines an element and puts a label next to it.
 * The overlay is a manual popover, so it sits above modal dialogs too.
 */
async function annotate(page, callouts) {
  // Dialogs and menus animate in, so let them settle before we measure anything.
  await page.waitForTimeout(400);
  await page.evaluate((items) => {
    document.getElementById('shot-callouts')?.remove();
    const layer = document.createElement('div');
    layer.id = 'shot-callouts';
    layer.setAttribute('popover', 'manual');
    layer.style.cssText =
      'position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:transparent;pointer-events:none;overflow:visible;';
    document.body.append(layer);
    // Show it before placing labels. A hidden popover has no layout, so labels would measure 0×0.
    layer.showPopover();
    const color = '#e11d48';
    items.forEach((item, i) => {
      const target = document.querySelector(item.selector);
      if (!target) throw new Error(`Callout target not found: ${item.selector}`);
      const r = target.getBoundingClientRect();
      const pad = item.pad ?? 3;
      const box = document.createElement('div');
      box.style.cssText = `position:fixed;left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px;border:2px solid ${color};border-radius:6px;box-sizing:border-box;`;
      layer.append(box);

      const label = document.createElement('div');
      label.style.cssText = `position:fixed;display:flex;align-items:center;gap:6px;background:${color};color:#fff;font:600 13px/1.2 system-ui,sans-serif;padding:4px 8px 4px 4px;border-radius:999px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.3);`;
      const badge = document.createElement('span');
      badge.textContent = String(i + 1);
      badge.style.cssText = `display:inline-grid;place-items:center;width:18px;height:18px;border-radius:50%;background:#fff;color:${color};font-size:12px;`;
      label.append(badge, document.createTextNode(item.label));
      layer.append(label);

      // Now place the label on the side we asked for, and keep it on screen.
      const lw = label.offsetWidth;
      const lh = label.offsetHeight;
      const gap = 8;
      let x = r.left;
      let y = r.bottom + gap;
      const side = item.side ?? 'below';
      if (side === 'above') y = r.top - lh - gap;
      if (side === 'left') {
        x = r.left - lw - gap;
        y = r.top + r.height / 2 - lh / 2;
      }
      if (side === 'right') {
        x = r.right + gap;
        y = r.top + r.height / 2 - lh / 2;
      }
      if (side === 'inside') {
        x = r.left + 12;
        y = r.top + 12;
      }
      x += item.dx ?? 0;
      y += item.dy ?? 0;
      x = Math.max(4, Math.min(window.innerWidth - lw - 4, x));
      y = Math.max(4, Math.min(window.innerHeight - lh - 4, y));
      label.style.left = `${x}px`;
      label.style.top = `${y}px`;
    });
  }, callouts);
}

async function clearCallouts(page) {
  await page.evaluate(() => document.getElementById('shot-callouts')?.remove());
}

/** Save a screenshot as a small palette PNG. */
async function shot(page, name, theme, options = {}) {
  const raw = await page.screenshot({ ...options, animations: 'disabled', caret: 'hide' });
  const file = path.join(outDir, `${name}-${theme}.png`);
  await sharp(raw).png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 }).toFile(file);
  console.log(`  ${path.relative(repoRoot, file)} (${Math.round(statSync(file).size / 1024)} KB)`);
  await clearCallouts(page);
}

/** Click something that opens the app's prompt dialog, type the answer, and submit it. */
async function clickAndAnswer(page, selector, answer) {
  await page.click(selector);
  const prompt = page.locator('dialog.app-dialog-prompt[open]');
  await prompt.locator('input').fill(answer);
  await prompt.locator('button[type="submit"]').click();
  await prompt.waitFor({ state: 'detached' });
}

/** Replace the open file's text, the way a paste would. */
async function setEditorText(page, text) {
  await page.click('.cm-content');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(text);
}

async function waitForCompile(page) {
  await page.waitForFunction(() => document.getElementById('compile-status')?.textContent === 'Compiled');
  // Give the preview frame a moment to pull in its fonts and styles.
  await page.waitForTimeout(1500);
}

/** Make a small bar chart PNG in the page, to upload as a figure. */
async function makePlotPng(page) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 280;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 480, 280);
    ctx.strokeStyle = '#333';
    ctx.beginPath();
    ctx.moveTo(40, 20);
    ctx.lineTo(40, 250);
    ctx.lineTo(460, 250);
    ctx.stroke();
    const values = [120, 180, 90, 210, 150];
    values.forEach((v, i) => {
      ctx.fillStyle = '#2563eb';
      ctx.fillRect(70 + i * 78, 250 - v, 50, v);
      ctx.fillStyle = '#333';
      ctx.font = '14px sans-serif';
      ctx.fillText(`Site ${i + 1}`, 72 + i * 78, 270);
    });
    return canvas.toDataURL('image/png');
  });
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

async function shootTheme(browser, theme) {
  console.log(`${theme} theme`);
  const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: theme, deviceScaleFactor: 1 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE_URL });
  const page = await context.newPage();

  // The app asks with its own dialogs (ui/dialogs.ts), so only beforeunload comes through here.
  page.on('dialog', (dialog) => dialog.accept());

  await page.goto(BASE_URL);
  await page.waitForSelector('#app-loading:not(.is-active)', { state: 'attached' });
  await page.waitForSelector('.cm-content');

  // First, build a small project: a name, two folders, a chapter, and a figure.
  await clickAndAnswer(page, '#doc-title', 'Field Notes');
  // Naming the first project starts the welcome tour. Skip it so it doesn't cover the buttons.
  const skipTour = page.locator('#tour:not([hidden]) [data-tour-skip]');
  await skipTour.waitFor({ timeout: 5000 }).then(() => skipTour.click(), () => {});
  await clickAndAnswer(page, '.file-pane-actions [data-command="file.newFolder"]', 'figures');
  await clickAndAnswer(page, '.file-pane-actions [data-command="file.newFolder"]', 'chapters');
  await clickAndAnswer(page, '.file-pane-actions [data-command="file.newFile"]', 'chapters/intro.tex');
  await setEditorText(page, INTRO_TEX);

  // Upload the figure through the dialog, and keep the dialog open for its screenshot.
  const plot = await makePlotPng(page);
  await page.click('.file-pane-actions [data-command="file.upload"]');
  await page.selectOption('#upload-folder', 'figures');
  await page.setInputFiles('#upload-input', { name: 'plot.png', mimeType: 'image/png', buffer: plot });
  await page.waitForFunction(() => document.querySelector('#upload-results li')?.textContent?.includes('added'));
  await annotate(page, [
    { selector: '#upload-folder', label: 'Pick the folder', side: 'right' },
    { selector: '#upload-drop', label: 'Drop files or click to pick', side: 'right' },
    { selector: '#upload-results', label: 'What happened to each file', side: 'right', pad: 6 },
  ]);
  await shot(page, 'upload', theme);
  await page.click('#upload-done');

  // Now open main.tex and fill it in.
  await page.click('.file-row[data-path="main.tex"] .file-row-main');
  await setEditorText(page, MAIN_TEX);
  await waitForCompile(page);
  await page.waitForFunction(() => /Saved/.test(document.getElementById('autosave-status')?.textContent ?? ''), null, { timeout: 30_000 });

  // The main screen, with every area labeled.
  await page.mouse.move(640, 790);
  await annotate(page, [
    { selector: '#doc-title', label: 'Project name', side: 'below' },
    { selector: '#menu-bar', label: 'Menus', side: 'below', dx: 60 },
    { selector: '#share-btn', label: 'Share', side: 'below' },
    { selector: '.status-badges', label: 'Status pills', side: 'below', dx: -40 },
    { selector: '#file-pane', label: 'Files', side: 'inside', dy: 420 },
    { selector: '#editor-pane', label: 'Editor', side: 'inside', dy: 380, dx: 300 },
    { selector: '#preview-pane', label: 'Preview', side: 'inside', dy: 560, dx: 380 },
    { selector: '.footer', label: 'Diagnostics', side: 'above', pad: 1 },
  ]);
  await shot(page, 'overview', theme);

  // The Files panel, with a row's buttons showing.
  await page.hover('.file-row[data-path="chapters/intro.tex"] .file-row-main');
  await annotate(page, [
    { selector: '.file-pane-actions [data-command="file.newFile"]', label: 'New file', side: 'right', dy: -30, dx: 90 },
    { selector: '.file-pane-actions [data-command="file.newFolder"]', label: 'New folder', side: 'right', dx: 60 },
    { selector: '.file-pane-actions [data-command="file.upload"]', label: 'Upload files', side: 'right', dy: 30, dx: 30 },
    { selector: '.file-row[data-path="chapters/intro.tex"] .file-row-actions', label: 'Main file, rename, delete', side: 'right', pad: 2 },
    { selector: '.file-row[data-path="main.tex"] .file-row-main-badge', label: 'The main file', side: 'right', dx: 60 },
  ]);
  await shot(page, 'files', theme);

  // A preview error: an environment that never ends.
  await page.mouse.move(640, 790);
  await page.click('.cm-content');
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.insertText('\\begin{itemize}\n');
  await page.waitForFunction(() => (document.getElementById('diagnostics')?.textContent ?? '').length > 0);
  await page.waitForTimeout(800);
  await annotate(page, [
    { selector: '#compile-status', label: 'Compile status', side: 'below', dx: -60 },
    { selector: '.cm-gutters', label: 'Error marker on the line', side: 'right', dy: 120, pad: 0 },
    { selector: '#diagnostics', label: 'First error, with file and line', side: 'above', pad: 2, dx: 120, dy: -16 },
  ]);
  await shot(page, 'diagnostics', theme);

  // A footnote is one of the things LaTeX.js can't place, so the preview's info button shows. Open its list.
  await setEditorText(page, MAIN_TEX.replace('from each site.', 'from each site.\\footnote{Site 3 was flooded on day 9.}'));
  await waitForCompile(page);
  await page.waitForSelector('#preview-changes:not([hidden])');
  await page.click('#preview-changes-btn');
  await page.waitForSelector('#preview-changes-popover[aria-hidden="false"]');
  await page.mouse.move(640, 790);
  const pane = await page.locator('#preview-pane').boundingBox();
  await shot(page, 'preview-changes', theme, { clip: { x: pane.x, y: pane.y, width: pane.width, height: 260 } });
  await page.keyboard.press('Escape');

  await setEditorText(page, MAIN_TEX);
  await waitForCompile(page);

  // The Open a project dialog, which lists what autosave just wrote.
  await page.keyboard.press('ControlOrMeta+O');
  await page.waitForSelector('#projects-dialog[open] .project-item');
  await annotate(page, [
    { selector: '#projects-list .project-item', label: 'Click a project to open it', side: 'right', pad: 4 },
    { selector: '#projects-import-zip', label: 'Or make one from a .zip', side: 'below' },
  ]);
  await shot(page, 'projects', theme);
  await page.click('#projects-done');

  // The Export dialog, with HTML picked so its option shows.
  await page.keyboard.press('ControlOrMeta+Shift+E');
  await page.waitForSelector('#export-dialog[open] #export-format option', { state: 'attached' });
  await page.selectOption('#export-format', 'html');
  await page.selectOption('#export-destination', 'download');
  await annotate(page, [
    { selector: '#export-format', label: 'Pick a format', side: 'above', pad: 2, dx: 120, dy: -14 },
    { selector: '#export-destination', label: 'Where it goes', side: 'above', pad: 2, dx: 120, dy: -14 },
    { selector: '#export-options', label: 'Its options', side: 'right', pad: 4 },
    { selector: '#export-run', label: 'Export', side: 'right' },
  ]);
  await shot(page, 'export', theme);
  await page.click('#export-cancel');

  // The File menu.
  await page.click('.menu-trigger[aria-controls="menu-file"]');
  await page.waitForSelector('#menu-file[aria-hidden="false"]');
  await annotate(page, [
    { selector: '[data-command="file.new"]', label: 'Start or open projects', side: 'right', pad: 1 },
    { selector: '#menu-file [data-command="file.newFile"]', label: 'Add files to this project', side: 'right', pad: 1 },
    { selector: '[data-command="file.download"]', label: 'Download', side: 'right', pad: 1 },
    { selector: '[data-command="file.connectDrive"]', label: 'Google Drive', side: 'right', pad: 1 },
    { selector: '[data-command="file.saveNow"]', label: 'Save right away', side: 'right', pad: 1 },
  ]);
  await shot(page, 'file-menu', theme);
  await page.keyboard.press('Escape');

  // The hover preview card (#89): rest the mouse on View > Split View.
  await page.mouse.move(VIEWPORT.width - 10, VIEWPORT.height - 10);
  await page.click('.menu-trigger[aria-controls="menu-view"]');
  await page.waitForSelector('#menu-view[aria-hidden="false"]');
  await page.hover('#menu-view [data-command="view.layoutSplit"]');
  await page.waitForSelector('#hover-preview:not([hidden]) .hover-preview-mock');
  const card = await page.locator('#hover-preview').boundingBox();
  const menu = await page.locator('#menu-view').boundingBox();
  const clipX = Math.max(0, menu.x - 16);
  await shot(page, 'hover-preview', theme, {
    clip: { x: clipX, y: 0, width: card.x + card.width + 16 - clipX, height: Math.max(menu.y + menu.height, card.y + card.height) + 16 },
  });
  await page.mouse.move(VIEWPORT.width - 10, VIEWPORT.height - 10);
  await page.keyboard.press('Escape');

  // The command palette.
  await page.keyboard.press('ControlOrMeta+P');
  await page.waitForSelector('#command-palette[aria-hidden="false"]');
  await page.keyboard.type('save');
  await page.waitForTimeout(200);
  await annotate(page, [
    { selector: '.command-palette-input', label: 'Type to filter', side: 'right', dx: -200 },
    { selector: '.command-palette-list', label: 'Up, Down, then Enter', side: 'right', pad: 2 },
  ]);
  await shot(page, 'palette', theme);
  await page.keyboard.press('Escape');

  // The settings dialog.
  await page.keyboard.press('ControlOrMeta+,');
  await page.waitForSelector('#settings-dialog[open] #settings-editor-theme');
  await annotate(page, [
    // At 1280px Settings is two columns, so the labels sit in the margins outside the box, not over it.
    { selector: '.settings-row:has(#settings-editor-theme)', label: 'App and editor theme', side: 'left', dx: -12 },
    { selector: '.settings-row:has(#settings-preview-theme)', label: 'Preview theme', side: 'left', dx: -12 },
    { selector: '.settings-row:has(#settings-pause-saving)', label: 'Pause saving', side: 'left', dx: -12 },
    { selector: '#settings-keybinds', label: 'Keyboard shortcuts', side: 'right', dx: 12 },
    { selector: '#settings-clear-local', label: 'Deletes every local project', side: 'left', dx: -12 },
  ]);
  await shot(page, 'settings', theme);
  await page.click('#settings-done');

  // Share, which joins a room and shows the link. Do this last since it starts networking.
  await page.click('#share-btn');
  await page.waitForFunction(() => (document.getElementById('share-link')?.textContent ?? '').includes('room='));
  await page.waitForTimeout(500);
  // Keep the room id out of the picture, since it's random every time.
  await page.evaluate(() => {
    const link = document.getElementById('share-link');
    if (link) link.textContent = link.textContent.replace(/room=[^&]+/, 'room=...');
  });
  await annotate(page, [
    { selector: '#share-btn', label: 'Share copies the link', side: 'below', dy: 20 },
    { selector: '#new-link-btn', label: 'New link drops everyone', side: 'below', dy: 60 },
    { selector: '#share-link', label: 'The link to send', side: 'below', dy: 100 },
    { selector: '#connection-status', label: 'Connection status', side: 'below', dx: -100 },
  ]);
  await shot(page, 'share', theme);

  // The status pills and notice, cropped to the header.
  await annotate(page, [
    // The pills wrap under the share link at 1280px, so the notice label goes beside it, not below.
    { selector: '#app-notice', label: 'Notices', side: 'right' },
    { selector: '#connection-status', label: 'Connection', side: 'below', dy: 8 },
    { selector: '#compile-status', label: 'Compile', side: 'below', dy: 44 },
    { selector: '#autosave-status', label: 'Autosave', side: 'below', dy: 80 },
  ]);
  await shot(page, 'status', theme, { clip: { x: 480, y: 0, width: 800, height: 180 } });

  await context.close();
}

/** Download Playwright's Chromium if it's missing, unless we were told to use a browser that's already installed. */
function installChromium() {
  if (process.env.SCREENSHOT_CHANNEL || process.env.SCREENSHOT_CHROMIUM) return;
  const cli = path.join(here, 'node_modules', 'playwright', 'cli.js');
  const result = spawnSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('playwright install chromium failed. Set SCREENSHOT_CHROMIUM or SCREENSHOT_CHANNEL to use an installed browser.');
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  installChromium();
  const server = await startPreview();
  // SCREENSHOT_CHROMIUM points at a Chromium already on the machine, for when `playwright install` can't download one.
  const browser = await chromium.launch({
    channel: process.env.SCREENSHOT_CHANNEL || undefined,
    executablePath: process.env.SCREENSHOT_CHROMIUM || undefined,
  });
  try {
    for (const theme of THEMES) await shootTheme(browser, theme);
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
