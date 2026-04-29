import { createEditHistory } from './history';

describe('createEditHistory', () => {
  it('records local changes and supports undo/redo', () => {
    const history = createEditHistory({ initialText: 'a', limit: 10 });
    history.record('ab');
    history.record('abc');

    expect(history.canUndo()).toBe(true);
    expect(history.undo()).toBe('ab');
    expect(history.undo()).toBe('a');
    expect(history.canUndo()).toBe(false);

    expect(history.canRedo()).toBe(true);
    expect(history.redo()).toBe('ab');
    expect(history.redo()).toBe('abc');
    expect(history.canRedo()).toBe(false);
  });

  it('rebases on remote text and clears local stacks', () => {
    const history = createEditHistory({ initialText: 'a' });
    history.record('ab');
    history.rebase('remote');

    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
    expect(history.undo()).toBeNull();
  });
});
