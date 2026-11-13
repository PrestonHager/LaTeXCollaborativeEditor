import '../style.css';
import checklistMarkdown from '../../dev/regression/checklist.md?raw';
import { mountChecklist } from './regressionPage';

// Match the OS theme, since this page has no settings of its own.
if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) document.documentElement.classList.add('dark');

let storage: Storage | null = null;
try {
  storage = window.localStorage;
} catch {
  // Some private modes block storage, so ticks just won't be saved.
}
mountChecklist(document.getElementById('checklist')!, checklistMarkdown, storage);
