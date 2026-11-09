import type { CommandId } from './menuBar';
import { commandIcon } from './icons';

export type PaletteCommand = {
  id: CommandId;
  label: string;
  section: string;
  shortcut?: string;
  /** One line saying what the command does. Search matches it too. */
  description?: string;
  enabled: boolean;
};

type PaletteOptions = {
  onSelect: (commandId: CommandId) => void;
};

/**
 * Score a command for a query. Labels match loosely, but descriptions only match whole
 * words, since a fuzzy match on a long sentence would match almost anything.
 */
export function scoreCommand(query: string, command: PaletteCommand): number | null {
  const labelScore = fuzzyScore(query, `${command.section} ${command.label} ${command.shortcut ?? ''}`.toLowerCase());
  if (labelScore !== null) return labelScore;
  const description = (command.description ?? '').toLowerCase();
  const words = query.split(/\s+/).filter(Boolean);
  return words.length && words.every((word) => description.includes(word)) ? 1 : null;
}

function fuzzyScore(query: string, text: string): number | null {
  if (!query) return 0;
  let queryIndex = 0;
  let start = -1;
  let end = -1;
  let contiguousBonus = 0;
  let previousMatchIndex = -2;

  for (let i = 0; i < text.length && queryIndex < query.length; i += 1) {
    if (text[i] !== query[queryIndex]) continue;
    if (start === -1) start = i;
    end = i;
    if (i === previousMatchIndex + 1) contiguousBonus += 3;
    previousMatchIndex = i;
    queryIndex += 1;
  }

  if (queryIndex !== query.length || start === -1 || end === -1) return null;
  const span = end - start + 1;
  const compactness = Math.max(0, 100 - span);
  const startBonus = Math.max(0, 40 - start);
  return contiguousBonus + compactness + startBonus;
}

/**
 * Wire up the Basecoat command palette in the page (see index.html). The shell is HTML,
 * and only the result rows get rendered here since they change on every keystroke.
 */
export function createCommandPalette(overlay: HTMLElement, options: PaletteOptions) {
  const input = overlay.querySelector<HTMLInputElement>('.command-palette-input');
  const list = overlay.querySelector<HTMLElement>('.command-palette-list');
  if (!input || !list) throw new Error('Command palette markup is missing its input or list');

  let commands: PaletteCommand[] = [];
  let filtered: PaletteCommand[] = [];
  const recentOrder: CommandId[] = [];
  let activeIndex = 0;
  let isOpen = false;
  let returnFocus: HTMLElement | null = null;

  const markRecent = (commandId: CommandId) => {
    const existing = recentOrder.indexOf(commandId);
    if (existing >= 0) recentOrder.splice(existing, 1);
    recentOrder.unshift(commandId);
    if (recentOrder.length > 12) recentOrder.length = 12;
  };

  const render = () => {
    list.replaceChildren();
    input.removeAttribute('aria-activedescendant');
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'command-palette-empty';
      empty.textContent = 'No commands found.';
      list.appendChild(empty);
      return;
    }

    // Start a new group each time the section changes, since recent commands can mix sections.
    let currentSection = '';
    let group: HTMLElement = list;
    filtered.forEach((command, index) => {
      if (command.section !== currentSection) {
        currentSection = command.section;
        group = document.createElement('div');
        group.setAttribute('role', 'group');
        const sectionHeader = document.createElement('div');
        sectionHeader.className = 'command-palette-section';
        sectionHeader.setAttribute('role', 'heading');
        sectionHeader.textContent = command.section;
        group.appendChild(sectionHeader);
        list.appendChild(group);
      }
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'command-palette-item';
      row.setAttribute('role', 'menuitem');
      row.id = `command-palette-item-${index}`;
      // Focus stays in the search box, so tell screen readers which row the arrow keys are on.
      if (index === activeIndex) {
        row.classList.add('is-active', 'active');
        input.setAttribute('aria-activedescendant', row.id);
      }
      if (!command.enabled) row.disabled = true;

      const left = document.createElement('span');
      left.className = 'command-palette-main';
      const label = document.createElement('span');
      label.className = 'command-palette-label';
      label.textContent = `${command.section}: ${command.label}`;
      left.appendChild(label);
      if (command.description) {
        const description = document.createElement('span');
        description.className = 'command-palette-description';
        description.textContent = command.description;
        left.appendChild(description);
      }

      row.append(commandIcon(command.id), left);
      if (command.shortcut) {
        const right = document.createElement('span');
        right.className = 'command-palette-shortcut';
        right.dataset.shortcut = '';
        right.textContent = command.shortcut;
        row.appendChild(right);
      }
      row.onclick = () => run(command);
      group.appendChild(row);
    });
  };

  const applyFilter = () => {
    const query = input.value.trim().toLowerCase();
    const base = commands
      .map((command) => {
      const score = scoreCommand(query, command);
      if (score === null) return null;
      return { command, score };
      })
      .filter((entry): entry is { command: PaletteCommand; score: number } => entry !== null);
    filtered = base.sort((a, b) => {
      const aRecent = recentOrder.indexOf(a.command.id);
      const bRecent = recentOrder.indexOf(b.command.id);
      const aWeight = aRecent === -1 ? Number.MAX_SAFE_INTEGER : aRecent;
      const bWeight = bRecent === -1 ? Number.MAX_SAFE_INTEGER : bRecent;
      if (aWeight !== bWeight) return aWeight - bWeight;
      if (a.score !== b.score) return b.score - a.score;
      const sectionCmp = a.command.section.localeCompare(b.command.section);
      if (sectionCmp !== 0) return sectionCmp;
      return a.command.label.localeCompare(b.command.label);
    }).map((entry) => entry.command);
    activeIndex = 0;
    render();
  };

  // Close first so focus goes back where it was, then run it. A command that opens a dialog takes focus from there.
  const run = (command: PaletteCommand) => {
    if (!command.enabled) return;
    markRecent(command.id);
    close();
    options.onSelect(command.id);
  };

  const open = () => {
    const active = document.activeElement;
    returnFocus = active instanceof HTMLElement && !overlay.contains(active) ? active : null;
    isOpen = true;
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    input.value = '';
    applyFilter();
    input.focus();
  };

  const close = () => {
    if (!isOpen) return;
    isOpen = false;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  };

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  input.addEventListener('input', applyFilter);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!filtered.length) return;
      activeIndex = Math.min(filtered.length - 1, activeIndex + 1);
      render();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!filtered.length) return;
      activeIndex = Math.max(0, activeIndex - 1);
      render();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const selected = filtered[activeIndex];
      if (selected) run(selected);
    }
  });

  return {
    setCommands(nextCommands: PaletteCommand[]) {
      commands = nextCommands;
      applyFilter();
    },
    open,
    close,
    toggle() {
      if (isOpen) close();
      else open();
    },
    isOpen() {
      return isOpen;
    },
  };
}
