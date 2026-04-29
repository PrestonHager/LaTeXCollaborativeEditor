import { diff_match_patch } from 'diff-match-patch';

export type TextDelta = string;

const dmp = new diff_match_patch();

export function computeSingleDelta(previous: string, next: string): TextDelta | null {
  if (previous === next) return null;
  const patches = dmp.patch_make(previous, next);
  return dmp.patch_toText(patches);
}

export function applyDelta(source: string, delta: TextDelta): string {
  const patches = dmp.patch_fromText(delta);
  const [next] = dmp.patch_apply(patches, source);
  return next;
}
