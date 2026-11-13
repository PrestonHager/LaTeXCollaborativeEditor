/**
 * Read the size of an EPS figure from its %%BoundingBox comment, so the preview can hold the
 * right amount of room for it. The preview can't draw PostScript, so this is all it reads.
 */

/** An EPS figure's box, in big points (1/72 in). */
export type EpsBox = { width: number; height: number };

// DSC comments live in the header, or in the trailer when the header says (atend).
const SCAN_BYTES = 16 * 1024;

const BOX_LINE = /^%%(HiRes)?BoundingBox:[ \t]*(.*)$/gm;

/** The PostScript part of the file. A DOS EPS wraps it in a binary header that points to it. */
function postScriptSection(bytes: Uint8Array): Uint8Array {
  if (bytes.length >= 12 && bytes[0] === 0xc5 && bytes[1] === 0xd0 && bytes[2] === 0xd3 && bytes[3] === 0xc6) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const start = view.getUint32(4, true);
    const length = view.getUint32(8, true);
    if (start < bytes.length) return bytes.subarray(start, Math.min(bytes.length, start + length));
  }
  return bytes;
}

const latin1 = (bytes: Uint8Array) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 1) text += String.fromCharCode(bytes[i]);
  return text;
};

/** Find the box in one piece of DSC text. HiRes wins when both are there. */
function findBox(text: string): EpsBox | 'atend' | null {
  let plain: EpsBox | 'atend' | null = null;
  for (const [, hiRes, rest] of text.replace(/\r\n?/g, '\n').matchAll(BOX_LINE)) {
    if (rest.trim() === '(atend)') {
      plain ??= 'atend';
      continue;
    }
    const numbers = rest.trim().split(/\s+/).map(Number);
    if (numbers.length !== 4 || numbers.some((n) => !Number.isFinite(n))) continue;
    const [llx, lly, urx, ury] = numbers;
    const box = { width: urx - llx, height: ury - lly };
    if (box.width <= 0 || box.height <= 0) continue;
    if (hiRes) return box;
    if (plain === null || plain === 'atend') plain = box;
  }
  return plain;
}

/** The figure's size from %%BoundingBox (or %%HiResBoundingBox), or null when there's none. */
export function parseEpsBoundingBox(bytes: Uint8Array): EpsBox | null {
  const ps = postScriptSection(bytes);
  const head = findBox(latin1(ps.subarray(0, SCAN_BYTES)));
  if (head && head !== 'atend') return head;
  if (ps.length <= SCAN_BYTES && head !== 'atend') return null;
  const tail = findBox(latin1(ps.subarray(Math.max(0, ps.length - SCAN_BYTES))));
  return tail && tail !== 'atend' ? tail : null;
}
