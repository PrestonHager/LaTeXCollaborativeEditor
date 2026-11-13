import checklistMarkdown from '../../dev/regression/checklist.md?raw';
import { inlineMarkdown, itemKey, parseChecklist } from './checklist';

describe('parseChecklist', () => {
  it('reads the title, intro, sections, notes and items', () => {
    const checklist = parseChecklist(
      ['# My list', '', 'Intro line.', '', '## First', 'A note.', '- [ ] One', '- [x] Two', '', '## Second', '- [ ] Three'].join('\n'),
    );
    expect(checklist).toEqual({
      title: 'My list',
      intro: ['Intro line.'],
      sections: [
        { title: 'First', notes: ['A note.'], items: ['One', 'Two'] },
        { title: 'Second', notes: [], items: ['Three'] },
      ],
    });
  });

  it('keeps a default title and handles Windows line endings', () => {
    const checklist = parseChecklist('## Only\r\n- [ ] Item\r\n');
    expect(checklist.title).toBe('Regression checklist');
    expect(checklist.sections[0].items).toEqual(['Item']);
  });

  it('parses the real checklist into sections that all have items', () => {
    const checklist = parseChecklist(checklistMarkdown);
    expect(checklist.sections.length).toBeGreaterThan(5);
    for (const section of checklist.sections) expect(section.items.length).toBeGreaterThan(0);
    // Two items with the same text in one section would share a saved tick.
    const keys = checklist.sections.flatMap((section) => section.items.map((item) => itemKey(section.title, item)));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('inlineMarkdown', () => {
  it('renders code, bold and links', () => {
    expect(inlineMarkdown('Run `npm run dev` then **Save**.')).toBe('Run <code>npm run dev</code> then <strong>Save</strong>.');
    expect(inlineMarkdown('Open http://localhost:5173.')).toBe(
      'Open <a href="http://localhost:5173" target="_blank" rel="noreferrer">http://localhost:5173</a>.',
    );
  });

  it('escapes HTML and leaves code spans alone', () => {
    expect(inlineMarkdown('<b>hi</b> & "x"')).toBe('&lt;b&gt;hi&lt;/b&gt; &amp; &quot;x&quot;');
    expect(inlineMarkdown('`**not bold** <i>`')).toBe('<code>**not bold** &lt;i&gt;</code>');
  });
});
