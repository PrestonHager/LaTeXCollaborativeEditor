// Read dev/regression/checklist.md into sections and items.
// It only understands what the checklist uses: one # title, ## sections, - [ ] items and plain lines.

export type ChecklistSection = { title: string; notes: string[]; items: string[] };
export type Checklist = { title: string; intro: string[]; sections: ChecklistSection[] };

const ITEM = /^- \[[ xX]\] (.+)$/;

export function parseChecklist(markdown: string): Checklist {
  const checklist: Checklist = { title: 'Regression checklist', intro: [], sections: [] };
  let section: ChecklistSection | null = null;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('## ')) {
      section = { title: line.slice(3).trim(), notes: [], items: [] };
      checklist.sections.push(section);
    } else if (line.startsWith('# ')) {
      checklist.title = line.slice(2).trim();
    } else if (ITEM.test(line) && section) {
      section.items.push(line.replace(ITEM, '$1'));
    } else {
      (section ? section.notes : checklist.intro).push(line);
    }
  }
  return checklist;
}

/** Turn the bits of inline Markdown the checklist uses into HTML: `code`, **bold** and bare links. */
export function inlineMarkdown(text: string): string {
  // First, escape everything, so the checklist text can never inject markup.
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // Then pull out code spans, so the bold and link rules don't touch what's inside them.
  const codes: string[] = [];
  const withoutCode = escaped.replace(/`([^`]+)`/g, (_, code: string) => `\u0000${codes.push(code) - 1}\u0000`);
  const html = withoutCode
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\bhttps?:\/\/[^\s<]+[^\s<.,)]/g, (url) => `<a href="${url}" target="_blank" rel="noreferrer">${url}</a>`);
  // Finally, put the code spans back.
  return html.replace(/\u0000(\d+)\u0000/g, (_, index: string) => `<code>${codes[Number(index)]}</code>`);
}

/** A stable key for an item, so a saved tick survives other items moving around. */
export const itemKey = (section: string, item: string) => `${section} :: ${item}`;
