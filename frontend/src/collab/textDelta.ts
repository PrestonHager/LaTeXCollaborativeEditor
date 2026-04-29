export type TextDelta = {
  index: number;
  deleteCount: number;
  insert: string;
};

export function computeSingleDelta(previous: string, next: string): TextDelta | null {
  if (previous === next) return null;

  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) {
    start += 1;
  }

  let endPrev = previous.length - 1;
  let endNext = next.length - 1;
  while (endPrev >= start && endNext >= start && previous[endPrev] === next[endNext]) {
    endPrev -= 1;
    endNext -= 1;
  }

  const deleteCount = Math.max(0, endPrev - start + 1);
  const insert = next.slice(start, endNext + 1);
  return { index: start, deleteCount, insert };
}

export function applyDelta(source: string, delta: TextDelta): string {
  const safeIndex = Math.min(Math.max(0, delta.index), source.length);
  const deleteEnd = Math.min(source.length, safeIndex + Math.max(0, delta.deleteCount));
  return source.slice(0, safeIndex) + delta.insert + source.slice(deleteEnd);
}
