import type { CommandId } from './menuBar';

export type PaletteCommand = {
  id: CommandId;
  label: string;
  section: string;
  shortcut?: string;
  enabled: boolean;
};

type PaletteOptions = {
  onSelect: (commandId: CommandId) => void;
};

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

export function createCommandPalette(options: PaletteOptions) {
  const overlay = document.createElement('div');
  overlay.className = 'command-palette-overlay';
  overlay.setAttribute('aria-hidden', 'true');

  const panel = document.createElement('div');
  panel.className = 'command-palette';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Command palette');

  const input = document.createElement('input');
  input.className = 'command-palette-input';
  input.type = 'text';
  input.placeholder = 'Type a command...';
  input.autocomplete = 'off';

  const list = document.createElement('div');
  list.className = 'command-palette-list';

  panel.append(input, list);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  let commands: PaletteCommand[] = [];
  let filtered: PaletteCommand[] = [];
  const recentOrder: CommandId[] = [];
  let activeIndex = 0;
  let isOpen = false;

  const markRecent = (commandId: CommandId) => {
    const existing = recentOrder.indexOf(commandId);
    if (existing >= 0) recentOrder.splice(existing, 1);
    recentOrder.unshift(commandId);
    if (recentOrder.length > 12) recentOrder.length = 12;
  };

  const render = () => {
    list.replaceChildren();
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'command-palette-empty';
      empty.textContent = 'No commands found.';
      list.appendChild(empty);
      return;
    }

    let currentSection = '';
    filtered.forEach((command, index) => {
      if (command.section !== currentSection) {
        currentSection = command.section;
        const sectionHeader = document.createElement('div');
        sectionHeader.className = 'command-palette-section';
        sectionHeader.textContent = command.section;
        list.appendChild(sectionHeader);
      }
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'command-palette-item';
      if (index === activeIndex) row.classList.add('is-active');
      if (!command.enabled) row.disabled = true;

      const left = document.createElement('span');
      left.className = 'command-palette-main';
      left.textContent = `${command.section}: ${command.label}`;

      const right = document.createElement('span');
      right.className = 'command-palette-shortcut';
      right.textContent = command.shortcut ?? '';

      row.append(left, right);
      row.onclick = () => {
        if (!command.enabled) return;
        markRecent(command.id);
        options.onSelect(command.id);
        close();
      };
      list.appendChild(row);
    });
  };

  const applyFilter = () => {
    const query = input.value.trim().toLowerCase();
    const base = commands
      .map((command) => {
      const haystack = `${command.section} ${command.label} ${command.shortcut ?? ''}`.toLowerCase();
      const score = fuzzyScore(query, haystack);
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

  const open = () => {
    isOpen = true;
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    input.value = '';
    applyFilter();
    input.focus();
  };

  const close = () => {
    isOpen = false;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
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
      if (!selected || !selected.enabled) return;
      markRecent(selected.id);
      options.onSelect(selected.id);
      close();
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
