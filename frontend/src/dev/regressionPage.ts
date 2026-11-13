import { inlineMarkdown, itemKey, parseChecklist } from './checklist';

export const PROGRESS_KEY = 'regression-checklist-progress';

/** Read saved ticks. Storage can be missing or blocked, so fall back to nothing ticked. */
function readProgress(storage: Storage | null): Set<string> {
  try {
    const saved = JSON.parse(storage?.getItem(PROGRESS_KEY) ?? '[]');
    return new Set(Array.isArray(saved) ? saved.filter((key): key is string => typeof key === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeProgress(storage: Storage | null, done: Set<string>) {
  try {
    storage?.setItem(PROGRESS_KEY, JSON.stringify([...done]));
  } catch {
    // Ticks just won't survive a reload, which is fine for a dev page.
  }
}

/** Render the checklist into root, with ticks saved in storage so a reload keeps your place. */
export function mountChecklist(root: HTMLElement, markdown: string, storage: Storage | null) {
  const checklist = parseChecklist(markdown);
  const done = readProgress(storage);
  const total = checklist.sections.reduce((sum, section) => sum + section.items.length, 0);

  // First, the header with the title, the intro and a progress count.
  const sectionsHtml = checklist.sections
    .map((section, sectionIndex) => {
      const notes = section.notes.map((note) => `<p class="text-sm text-muted-foreground">${inlineMarkdown(note)}</p>`).join('');
      const items = section.items
        .map((item, itemIndex) => {
          const id = `item-${sectionIndex}-${itemIndex}`;
          return `<li class="flex items-start gap-3 py-1.5">
            <input type="checkbox" class="input mt-0.5" id="${id}" data-key="${encodeURIComponent(itemKey(section.title, item))}">
            <label for="${id}" class="text-sm leading-6">${inlineMarkdown(item)}</label>
          </li>`;
        })
        .join('');
      return `<section class="space-y-2" data-section>
        <h2 class="text-lg font-semibold">${inlineMarkdown(section.title)} <span class="badge" data-variant="outline" data-section-count></span></h2>
        ${notes}
        <ul class="list-none p-0 m-0">${items}</ul>
      </section>`;
    })
    .join('');
  root.innerHTML = `
    <header class="space-y-2">
      <h1 class="text-2xl font-semibold">${inlineMarkdown(checklist.title)}</h1>
      ${checklist.intro.map((line) => `<p class="text-sm text-muted-foreground">${inlineMarkdown(line)}</p>`).join('')}
      <div class="flex flex-wrap items-center gap-3 pt-2">
        <span class="badge" data-progress-text></span>
        <button type="button" class="btn" data-variant="outline" data-size="sm" data-reset>Clear all ticks</button>
      </div>
    </header>
    ${sectionsHtml}`;

  const boxes = Array.from(root.querySelectorAll<HTMLInputElement>('input[data-key]'));
  const progressText = root.querySelector<HTMLElement>('[data-progress-text]')!;

  // Then keep the counts in step with the boxes.
  const refresh = () => {
    progressText.textContent = `${boxes.filter((box) => box.checked).length} of ${total} done`;
    root.querySelectorAll<HTMLElement>('[data-section]').forEach((section) => {
      const sectionBoxes = Array.from(section.querySelectorAll<HTMLInputElement>('input[data-key]'));
      section.querySelector('[data-section-count]')!.textContent =
        `${sectionBoxes.filter((box) => box.checked).length}/${sectionBoxes.length}`;
    });
  };

  for (const box of boxes) {
    const key = decodeURIComponent(box.dataset.key!);
    box.checked = done.has(key);
    box.addEventListener('change', () => {
      if (box.checked) done.add(key);
      else done.delete(key);
      writeProgress(storage, done);
      refresh();
    });
  }

  // Finally, the reset button clears every tick.
  root.querySelector('[data-reset]')!.addEventListener('click', () => {
    done.clear();
    boxes.forEach((box) => (box.checked = false));
    writeProgress(storage, done);
    refresh();
  });

  refresh();
  return { total };
}
