// Template placeholders (#74). A template's text files can hold {{name}}, {{affiliation}} and the
// like; making a project from it swaps each one for a value, escaped so it's safe LaTeX.
import type { Profile, ProfileField } from '../state/profile';
import { guessLanguage, guessPaper, PAPER_SIZES, PROFILE_LANGUAGES } from './profileOptions';

/** One placeholder a template asks for. Standard ones come from the profile; templates add their own. */
export type PlaceholderDef = {
  key: string;
  label: string;
  /** The starting value when the profile has nothing for it. */
  default?: string;
  /** A short hint shown under the field. */
  hint?: string;
  /** Several lines. They go into LaTeX joined with \\ (a line break). */
  multiline?: boolean;
  /** Pick from a list. The value goes in as is, since it's one of the listed ones. */
  options?: { value: string; label: string }[];
  /** Put the value in without escaping, for values that are LaTeX on purpose. */
  raw?: boolean;
  /** The profile field that fills it in. */
  profile?: ProfileField;
};

/** What a template folder's template.json says (see docs/saving-and-storage.md). */
export type TemplateManifest = {
  format: typeof TEMPLATE_FORMAT;
  version: number;
  name: string;
  description: string;
  /** The file to compile. Without one, the app guesses as it does for any project. */
  mainFile?: string;
  /** The template's own placeholders. The standard ones don't need to be listed. */
  placeholders: PlaceholderDef[];
};

export const TEMPLATE_FORMAT = 'latex-editor-template';
export const TEMPLATE_VERSION = 1;
/** The file in a template's folder that describes it. It never goes into projects made from it. */
export const TEMPLATE_FILE = 'template.json';

const KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
// {{key}}, with optional spaces inside the braces. Anything else between {{ and }} is left alone,
// so real LaTeX like {{\bf x}} or \frac{{a}}{b} is safe unless `a` is a placeholder name.
const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

/** Placeholders every template can use. Their values come from the profile. */
export const STANDARD_PLACEHOLDERS: readonly PlaceholderDef[] = [
  { key: 'name', label: 'Your name', profile: 'name' },
  { key: 'affiliation', label: 'Affiliation', profile: 'affiliation', hint: 'University, company or group.' },
  { key: 'email', label: 'Email', profile: 'email' },
  { key: 'orcid', label: 'ORCID iD', profile: 'orcid', hint: 'Like 0000-0002-1825-0097.' },
  { key: 'address', label: 'Your address', profile: 'address', multiline: true },
  { key: 'date', label: 'Date' },
  { key: 'language', label: 'Language', profile: 'language', options: [...PROFILE_LANGUAGES], hint: 'Sets hyphenation and words like "Contents" (babel).' },
  { key: 'paper', label: 'Paper size', profile: 'paper', options: [...PAPER_SIZES] },
];

const LATEX_SPECIALS: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  '&': '\\&',
  '%': '\\%',
  $: '\\$',
  '#': '\\#',
  _: '\\_',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
};

/** Escape the characters LaTeX treats as special, so typed text shows exactly as typed. */
export function escapeLatex(text: string): string {
  return text.replace(/[\\{}&%$#_~^]/g, (char) => LATEX_SPECIALS[char]);
}

/** The text a value becomes in the file: escaped (unless raw), with multiline values joined by \\. */
export function formatValue(def: Pick<PlaceholderDef, 'multiline' | 'raw' | 'options'>, value: string): string {
  if (def.options) return def.options.some((option) => option.value === value) ? value : (def.options[0]?.value ?? '');
  const lines = value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const escape = def.raw ? (line: string) => line : escapeLatex;
  return def.multiline ? lines.map(escape).join(' \\\\ ') : escape(lines.join(' '));
}

/** The placeholder names a text uses, in order of first use. */
export function placeholdersIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(PLACEHOLDER)) if (!found.includes(match[1])) found.push(match[1]);
  return found;
}

/**
 * Every placeholder a template can fill: the standard ones, then its own (which can relabel a
 * standard one). Only these are replaced, so other {{...}} text stays as it was.
 */
export function placeholderDefs(manifest: Pick<TemplateManifest, 'placeholders'> | null): PlaceholderDef[] {
  const defs = new Map(STANDARD_PLACEHOLDERS.map((def) => [def.key, { ...def }]));
  for (const def of manifest?.placeholders ?? []) defs.set(def.key, { ...defs.get(def.key), ...def });
  return [...defs.values()];
}

/** The placeholders a set of files uses, in the order they first appear, with their definitions. */
export function usedPlaceholders(texts: string[], defs: PlaceholderDef[]): PlaceholderDef[] {
  const byKey = new Map(defs.map((def) => [def.key, def]));
  const used: PlaceholderDef[] = [];
  for (const key of texts.flatMap(placeholdersIn)) {
    const def = byKey.get(key);
    if (def && !used.includes(def)) used.push(def);
  }
  return used;
}

/** Today's date the way this browser writes it, like "13 November 2026". */
export const formatToday = (now = new Date(), locale?: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(now);

/**
 * The starting value of each placeholder: the profile, then the template's default, then a guess
 * (today's date, the browser's language and paper size).
 */
export function initialValues(defs: PlaceholderDef[], profile: Profile, locale?: string, now = new Date()): Record<string, string> {
  const values: Record<string, string> = {};
  for (const def of defs) {
    const fromProfile = def.profile ? profile[def.profile] : '';
    let value = fromProfile || def.default || '';
    if (!value && def.key === 'date') value = formatToday(now, locale);
    if (!value && def.key === 'language') value = guessLanguage(locale);
    if (!value && def.key === 'paper') value = guessPaper(locale);
    values[def.key] = value;
  }
  return values;
}

/** Replace each known placeholder in a text with its formatted value. Unknown names stay as they are. */
export function fillPlaceholders(text: string, defs: PlaceholderDef[], values: Record<string, string>): string {
  const byKey = new Map(defs.map((def) => [def.key, def]));
  return text.replace(PLACEHOLDER, (whole, key: string) => {
    const def = byKey.get(key);
    return def ? formatValue(def, values[key] ?? '') : whole;
  });
}

/**
 * Turn profile values found in a text back into placeholders, for Save as Template. Only values
 * of 3 or more characters count, so an initial or a short word doesn't get swapped by accident.
 */
export function profileToPlaceholders(text: string, profile: Profile): { text: string; count: number } {
  let count = 0;
  let out = text;
  for (const def of STANDARD_PLACEHOLDERS) {
    if (!def.profile || def.options || def.multiline) continue;
    const value = profile[def.profile];
    if (value.length < 3) continue;
    const needle = escapeLatex(value);
    const parts = out.split(needle);
    count += parts.length - 1;
    out = parts.join(`{{${def.key}}}`);
  }
  return { text: out, count };
}

// Longest values kept from a template.json, so a hostile file can't blow up the dialog.
const MAX_LABEL = 80;
const MAX_DEFAULT = 2000;
const MAX_PLACEHOLDERS = 40;

const str = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');

/** Read a template.json. Anything malformed gets dropped rather than guessed at; a broken file gives null. */
export function parseManifest(text: string, fallbackName = 'Untitled template'): TemplateManifest | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const file = raw as Record<string, unknown>;
  if (file.format !== undefined && file.format !== TEMPLATE_FORMAT) return null;
  const placeholders: PlaceholderDef[] = [];
  for (const item of Array.isArray(file.placeholders) ? file.placeholders.slice(0, MAX_PLACEHOLDERS) : []) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const key = str(entry.key, 40);
    if (!KEY.test(key)) continue;
    const def: PlaceholderDef = { key, label: str(entry.label, MAX_LABEL) || key };
    if (typeof entry.default === 'string') def.default = str(entry.default, MAX_DEFAULT);
    if (typeof entry.hint === 'string') def.hint = str(entry.hint, 200);
    if (entry.multiline === true) def.multiline = true;
    if (entry.raw === true) def.raw = true;
    if (Array.isArray(entry.options)) {
      const options = entry.options
        .map((option) => (typeof option === 'string' ? { value: option, label: option } : option))
        .filter((option): option is { value: string; label: string } => typeof option?.value === 'string')
        .slice(0, 50)
        .map((option) => ({ value: str(option.value, 100), label: str(option.label, MAX_LABEL) || str(option.value, 100) }));
      if (options.length) def.options = options;
    }
    placeholders.push(def);
  }
  return {
    format: TEMPLATE_FORMAT,
    version: typeof file.version === 'number' ? file.version : TEMPLATE_VERSION,
    name: str(file.name, 200).trim() || fallbackName,
    description: str(file.description, 1000).trim(),
    ...(typeof file.mainFile === 'string' && file.mainFile ? { mainFile: str(file.mainFile, 500) } : {}),
    placeholders,
  };
}

/** Write a template.json, pretty-printed so it's easy to edit by hand. Standard placeholder fields stay out. */
export function serializeManifest(manifest: Omit<TemplateManifest, 'format' | 'version'>): string {
  const placeholders = manifest.placeholders.map(({ profile: _profile, ...def }) => def);
  return `${JSON.stringify({ format: TEMPLATE_FORMAT, version: TEMPLATE_VERSION, name: manifest.name, description: manifest.description, ...(manifest.mainFile ? { mainFile: manifest.mainFile } : {}), placeholders }, null, 2)}\n`;
}
