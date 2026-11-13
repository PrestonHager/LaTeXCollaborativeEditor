// A tiny Markdown renderer for CHANGELOG.md (issue #140). The file is Keep a Changelog format and only
// uses headings, lists, paragraphs, bold, inline code and links, so that's all this handles.
// It builds DOM nodes with createElement and textContent and never sets innerHTML, so raw HTML in
// the file shows as text. Loaded lazily with the changelog dialog, so it stays out of the initial load.
import { compareVersions } from '../app/buildInfo';
import { REPO_URL } from './issueLinks';

/** Relative links in the changelog point at the file on GitHub, like docs/versioning.md does there. */
export const REPO_BLOB_BASE = `${REPO_URL}/blob/main/`;

/** Reference-style link definitions at the bottom of the file: `[0.1.0]: <url>`. */
const DEFINITION = /^ {0,3}\[([^\]]+)\]:\s*(\S+)\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST_ITEM = /^(\s*)[-*+]\s+(.*)$/;
/** `## [0.1.0] - 2026-11-13`, `## 0.1.0 - 2026-11-13`, `## [Unreleased]`. */
const RELEASE_HEADING = /^\[?([^\]\s]+)\]?(?:\s+[-–—]\s+(.+))?$/;

export type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: ListItem[] };

export type ListItem = { text: string; children: ListItem[] };

export type Release = {
  /** "Unreleased" or the version without a leading v, e.g. 0.1.0. */
  version: string;
  /** YYYY-MM-DD from the heading, or "" when there isn't one. */
  date: string;
  unreleased: boolean;
  blocks: Block[];
};

export type Changelog = {
  releases: Release[];
  /** Lowercased reference label to URL. */
  links: Map<string, string>;
};

/** Split Markdown lines into headings, paragraphs and (nested) lists. Link definitions are skipped. */
export function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  // The open list: a stack of [indent, items] so deeper indents nest under the last item.
  let stack: { indent: number; items: ListItem[] }[] = [];

  const endParagraph = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };
  const endList = () => {
    if (stack.length) blocks.push({ kind: 'list', items: stack[0].items });
    stack = [];
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      endParagraph();
      continue;
    }
    if (DEFINITION.test(line)) continue;
    const heading = HEADING.exec(line);
    if (heading) {
      endParagraph();
      endList();
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      endParagraph();
      const indent = item[1].length;
      const entry: ListItem = { text: item[2], children: [] };
      if (!stack.length) stack.push({ indent, items: [] });
      while (stack.length > 1 && indent < stack[stack.length - 1].indent) stack.pop();
      const top = stack[stack.length - 1];
      const parent = top.items[top.items.length - 1];
      if (indent > top.indent && parent) {
        stack.push({ indent, items: parent.children });
        parent.children.push(entry);
      } else {
        top.items.push(entry);
      }
      continue;
    }
    // An indented line right after a list item carries on that item.
    if (stack.length && /^\s/.test(line) && !paragraph.length) {
      const items = stack[stack.length - 1].items;
      items[items.length - 1].text += ` ${line.trim()}`;
      continue;
    }
    endList();
    paragraph.push(line.trim());
  }
  endParagraph();
  endList();
  return blocks;
}

/** Read the whole file: one release per `##` heading. The `#` title and intro above them are dropped. */
export function parseChangelog(text: string): Changelog {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const links = new Map<string, string>();
  for (const line of lines) {
    const def = DEFINITION.exec(line);
    if (def) links.set(def[1].toLowerCase(), def[2]);
  }

  const releases: Release[] = [];
  let current: { release: Release; lines: string[] } | null = null;
  const finish = () => {
    if (current) current.release.blocks = parseBlocks(current.lines);
  };
  for (const line of lines) {
    const heading = /^##\s+(.*?)\s*$/.exec(line);
    if (heading) {
      finish();
      const match = RELEASE_HEADING.exec(heading[1]);
      const name = (match?.[1] ?? heading[1]).replace(/^v(?=\d)/, '');
      const unreleased = name.toLowerCase() === 'unreleased';
      const release: Release = { version: unreleased ? 'Unreleased' : name, date: match?.[2]?.trim() ?? '', unreleased, blocks: [] };
      releases.push(release);
      current = { release, lines: [] };
      continue;
    }
    current?.lines.push(line);
  }
  finish();
  return { releases: sortNewestFirst(releases), links };
}

/** Unreleased first, then versions newest first. Anything that isn't SemVer keeps its place after them. */
export function sortNewestFirst(releases: Release[]): Release[] {
  const unreleased = releases.filter((r) => r.unreleased);
  const versioned = releases.filter((r) => !r.unreleased && compareVersions(r.version, r.version) !== null);
  const other = releases.filter((r) => !r.unreleased && compareVersions(r.version, r.version) === null);
  versioned.sort((a, b) => compareVersions(b.version, a.version)!);
  return [...unreleased, ...versioned, ...other];
}

/**
 * Turn a link target into a safe absolute URL, or null to show the text without a link.
 * http(s) and mailto pass through, relative paths go to the file on GitHub, anything else is dropped.
 */
export function resolveHref(href: string): string | null {
  const target = href.trim();
  if (!target) return null;
  if (/^(?:https?:|mailto:)/i.test(target)) return target;
  // Any other scheme (javascript:, data:, ...) or a protocol-relative //host is not followed.
  if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('//')) return null;
  const path = target.startsWith('#') ? `CHANGELOG.md${target}` : target.replace(/^\/+/, '');
  const url = new URL(path, REPO_BLOB_BASE).href;
  return url.startsWith(REPO_BLOB_BASE) ? url : null;
}

function makeLink(doc: Document, href: string | null, label: string, links: Map<string, string>): Node {
  const url = href === null ? null : resolveHref(href);
  if (!url) {
    const span = doc.createElement('span');
    appendInline(span, label, links, false);
    return span;
  }
  const a = doc.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  appendInline(a, label, links, false);
  return a;
}

/** Find the `]` that closes the `[` at `start`, allowing nested brackets. */
function closingBracket(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '[') depth++;
    else if (text[i] === ']' && --depth === 0) return i;
  }
  return -1;
}

/**
 * Append inline Markdown to `parent`: **bold**, `code`, [text](url), [text][ref] and [ref].
 * Everything else, raw HTML included, goes in as plain text.
 */
export function appendInline(parent: HTMLElement, text: string, links: Map<string, string>, allowLinks = true) {
  const doc = parent.ownerDocument;
  let plain = '';
  const flush = () => {
    if (plain) parent.append(doc.createTextNode(plain));
    plain = '';
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length && /[\\`*_[\]()#+\-.!<>]/.test(text[i + 1])) {
      plain += text[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i) {
        flush();
        const code = doc.createElement('code');
        code.textContent = text.slice(i + 1, end);
        parent.append(code);
        i = end + 1;
        continue;
      }
    }
    if (ch === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        const strong = doc.createElement('strong');
        appendInline(strong, text.slice(i + 2, end), links, allowLinks);
        parent.append(strong);
        i = end + 2;
        continue;
      }
    }
    if (ch === '[' && allowLinks) {
      const close = closingBracket(text, i);
      if (close > i) {
        const label = text.slice(i + 1, close);
        const rest = text.slice(close + 1);
        const inline = /^\(\s*((?:[^\s()]|\([^\s()]*\))*)(?:\s+"[^"]*")?\s*\)/.exec(rest);
        const full = /^\[([^\]]*)\]/.exec(rest);
        if (inline) {
          flush();
          parent.append(makeLink(doc, inline[1], label, links));
          i = close + 1 + inline[0].length;
          continue;
        }
        const ref = full ? (full[1] || label) : label;
        const url = links.get(ref.toLowerCase());
        if (url !== undefined) {
          flush();
          parent.append(makeLink(doc, url, label, links));
          i = close + 1 + (full ? full[0].length : 0);
          continue;
        }
      }
    }
    plain += ch;
    i++;
  }
  flush();
}

function renderList(doc: Document, items: ListItem[], links: Map<string, string>): HTMLUListElement {
  const ul = doc.createElement('ul');
  for (const item of items) {
    const li = doc.createElement('li');
    appendInline(li, item.text, links);
    if (item.children.length) li.append(renderList(doc, item.children, links));
    ul.append(li);
  }
  return ul;
}

/**
 * Render blocks into `parent`. `headingOffset` shifts heading levels, so a `###` section heading
 * inside a release sits under the release's own heading (### + 1 = h4).
 */
export function renderBlocks(parent: HTMLElement, blocks: Block[], links: Map<string, string>, headingOffset = 0) {
  const doc = parent.ownerDocument;
  for (const block of blocks) {
    if (block.kind === 'heading') {
      const level = Math.min(6, Math.max(1, block.level + headingOffset));
      const h = doc.createElement(`h${level}`);
      appendInline(h, block.text, links);
      parent.append(h);
    } else if (block.kind === 'paragraph') {
      const p = doc.createElement('p');
      appendInline(p, block.text, links);
      parent.append(p);
    } else {
      parent.append(renderList(doc, block.items, links));
    }
  }
}
