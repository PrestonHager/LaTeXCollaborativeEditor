import { createPreviewChanges, previewChangesElements, previewChangesLabel } from './previewChanges';

function setup() {
  document.body.innerHTML = `
    <div id="preview-changes" hidden>
      <button id="preview-changes-btn" type="button" aria-expanded="false"><span id="preview-changes-count"></span></button>
      <div id="preview-changes-popover" aria-hidden="true">
        <p id="preview-changes-summary"></p>
        <ul id="preview-changes-list"></ul>
        <a id="learn" href="https://example.test/whats-supported/">What's supported</a>
      </div>
    </div>
    <button id="elsewhere" type="button">Elsewhere</button>`;
  const els = previewChangesElements();
  return { els, changes: createPreviewChanges(els) };
}

const press = (target: Element, key: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

describe('preview changes button', () => {
  it('names the number of changes', () => {
    expect(previewChangesLabel(1)).toBe('Preview is approximate: 1 change');
    expect(previewChangesLabel(3)).toBe('Preview is approximate: 3 changes');
  });

  it('shows only when there are changes', () => {
    const { els, changes } = setup();
    expect(els.root.hidden).toBe(true);
    changes.setChanges(['Removed \\vspace.', 'Footnotes show inline.', 'Removed packages: geometry.']);
    expect(els.root.hidden).toBe(false);
    expect(els.button.getAttribute('aria-label')).toBe('Preview is approximate: 3 changes');
    expect(els.button.dataset.tooltip).toBe('Preview is approximate: 3 changes');
    expect(els.count.textContent).toBe('3');
    changes.setChanges([]);
    expect(els.root.hidden).toBe(true);
  });

  it('lists the changes as text, never as markup', () => {
    const { els, changes } = setup();
    const sneaky = 'Removed \\foo{<img src=x onerror=alert(1)>}.';
    changes.setChanges(['Removed \\vspace.', sneaky]);
    const items = Array.from(els.list.querySelectorAll('li'), (li) => li.textContent);
    expect(items).toEqual(['Removed \\vspace.', sneaky]);
    expect(els.list.querySelector('img')).toBeNull();
    expect(els.summary.textContent).toContain('these 2 changes');
    changes.setChanges(['Removed \\vspace.']);
    expect(els.list.querySelectorAll('li')).toHaveLength(1);
    expect(els.summary.textContent).toContain('this change');
  });

  it('opens and closes from the button', () => {
    const { els, changes } = setup();
    changes.setChanges(['Removed \\vspace.']);
    els.button.click();
    expect(changes.isOpen).toBe(true);
    expect(els.button.getAttribute('aria-expanded')).toBe('true');
    expect(els.popover.getAttribute('aria-hidden')).toBe('false');
    els.button.click();
    expect(changes.isOpen).toBe(false);
    expect(els.popover.getAttribute('aria-hidden')).toBe('true');
  });

  it('closes with Escape and puts focus back on the button', () => {
    const { els, changes } = setup();
    changes.setChanges(['Removed \\vspace.']);
    els.button.click();
    const learn = document.getElementById('learn')!;
    learn.focus();
    press(learn, 'Escape');
    expect(changes.isOpen).toBe(false);
    expect(document.activeElement).toBe(els.button);
    // Other keys, and Escape while closed, do nothing.
    els.button.click();
    press(els.button, 'Enter');
    expect(changes.isOpen).toBe(true);
    changes.close();
    press(els.button, 'Escape');
    expect(changes.isOpen).toBe(false);
  });

  it('closes on a click outside, but not on one inside', () => {
    const { els, changes } = setup();
    changes.setChanges(['Removed \\vspace.']);
    els.button.click();
    els.list.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(changes.isOpen).toBe(true);
    document.getElementById('elsewhere')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(changes.isOpen).toBe(false);
  });

  it('closes when focus leaves it or the window loses focus (a click in the preview frame)', () => {
    const { els, changes } = setup();
    changes.setChanges(['Removed \\vspace.']);
    els.button.click();
    els.button.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.getElementById('learn') }));
    expect(changes.isOpen).toBe(true);
    els.button.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.getElementById('elsewhere') }));
    expect(changes.isOpen).toBe(false);
    els.button.click();
    window.dispatchEvent(new Event('blur'));
    expect(changes.isOpen).toBe(false);
  });

  it('closes and hides when the changes go away', () => {
    const { els, changes } = setup();
    changes.setChanges(['Removed \\vspace.']);
    els.button.click();
    changes.setChanges([]);
    expect(changes.isOpen).toBe(false);
    expect(els.root.hidden).toBe(true);
  });

  it('says which part is missing from the page', () => {
    document.body.innerHTML = '';
    expect(() => previewChangesElements()).toThrow('Missing #preview-changes');
  });
});
