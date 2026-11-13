/**
 * Turn \includegraphics options like [width=0.5\textwidth] or [height=3cm] into inline CSS for
 * the preview's <img>. Only the size options are read: width, height (and totalheight), scale
 * and keepaspectratio. Anything else is ignored.
 */

// Line-width macros become a percent of the box the image sits in.
const RELATIVE_WIDTHS = new Set(['textwidth', 'linewidth', 'columnwidth', 'hsize']);

// TeX points are a little smaller than CSS points (1/72.27in vs 1/72in), so units without a CSS
// equivalent go to CSS points. cm, mm, in, em, ex and px mean the same thing in both.
const TEX_PT = 72 / 72.27;
const TO_CSS_PT: Record<string, number> = {
  pt: TEX_PT,
  bp: 1,
  pc: 12 * TEX_PT,
  dd: (1238 / 1157) * TEX_PT,
  cc: 12 * (1238 / 1157) * TEX_PT,
  sp: TEX_PT / 65536,
};
const CSS_UNITS = new Set(['cm', 'mm', 'in', 'em', 'ex', 'px']);

const round = (value: number) => Math.round(value * 100) / 100;

/** Split key=value options on top-level commas, so a braced value can hold a comma. */
function splitOptions(options: string): Map<string, string> {
  const result = new Map<string, string>();
  let depth = 0;
  let start = 0;
  const parts: string[] = [];
  for (let i = 0; i <= options.length; i += 1) {
    const ch = options[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if ((ch === ',' && depth === 0) || i === options.length) {
      parts.push(options.slice(start, i));
      start = i + 1;
    }
  }
  for (const part of parts) {
    const eq = part.indexOf('=');
    const key = (eq < 0 ? part : part.slice(0, eq)).trim().toLowerCase();
    if (!key) continue;
    let value = eq < 0 ? '' : part.slice(eq + 1).trim();
    if (value.startsWith('{') && value.endsWith('}')) value = value.slice(1, -1).trim();
    result.set(key, value);
  }
  return result;
}

/**
 * Read a TeX length as a CSS length. Returns null for anything we can't size, like \textheight
 * or a length from \newlength.
 */
export function texLengthToCss(value: string): string | null {
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))?\s*(?:\\([a-zA-Z]+)|([a-zA-Z]{2}))$/.exec(value.trim());
  if (!match) return null;
  const [, number, macro, unit] = match;
  // A bare macro like \textwidth means one of it, but a bare unit like "cm" means nothing.
  if (number === undefined && !macro) return null;
  const factor = number === undefined ? 1 : Number.parseFloat(number);
  if (!Number.isFinite(factor) || factor <= 0) return null;
  if (macro) return RELATIVE_WIDTHS.has(macro) ? `${round(factor * 100)}%` : null;
  const lower = unit.toLowerCase();
  if (CSS_UNITS.has(lower)) return `${round(factor)}${lower}`;
  if (lower in TO_CSS_PT) return `${round(factor * TO_CSS_PT[lower])}pt`;
  return null;
}

/** Build the inline style for an image from its \includegraphics options (the part inside [ ]). */
export function graphicsOptionsToCss(options: string | undefined): string {
  const parsed = splitOptions(options ?? '');
  const width = parsed.has('width') ? texLengthToCss(parsed.get('width')!) : null;
  const rawHeight = parsed.get('height') ?? parsed.get('totalheight');
  // A percent height has nothing to be a percent of in the preview, so leave it out.
  const height = rawHeight === undefined ? null : texLengthToCss(rawHeight);
  const usableHeight = height && !height.endsWith('%') ? height : null;
  const keepAspect = parsed.has('keepaspectratio') && parsed.get('keepaspectratio') !== 'false';

  const style = ['max-width:100%'];
  if (width) style.push(`width:${width}`);
  if (usableHeight) {
    style.push(`height:${usableHeight}`);
    // With only a height, or with keepaspectratio, the picture must not stretch, even when
    // max-width squeezes it.
    if (!width || keepAspect) style.push('object-fit:contain');
  }
  if (!width && !usableHeight && parsed.has('scale')) {
    const scale = Number.parseFloat(parsed.get('scale')!);
    if (Number.isFinite(scale) && scale > 0 && scale !== 1) style.push(`zoom:${round(scale)}`);
  }
  return `${style.join(';')};`;
}
