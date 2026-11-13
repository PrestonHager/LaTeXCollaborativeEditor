/**
 * The browser's own prompt/confirm/alert don't match the app, can't check names, and can be turned off (#133).
 * Use confirmDialog/promptDialog/noticeDialog from src/ui/dialogs.ts instead.
 * beforeunload is the one native dialog left, and the browser draws that from event.preventDefault(), not a call.
 */
// Every source file under src/, read as text by Vite. Test files are left out below.
const SOURCES = import.meta.glob<string>(['../**/*.{ts,tsx,js,mjs}', '!../**/*.test.*'], { query: '?raw', import: 'default', eager: true });

// window.confirm(, globalThis.alert(, self.prompt(, or a bare confirm( that isn't a method call like options.confirm(.
const NATIVE_CALL = /(?:\b(?:window|globalThis|self|top|parent)\s*\.\s*|(?<![\w$.]))(?:prompt|confirm|alert)\s*\(/;

/** Drop comments so a note like "instead of a confirm() popup" doesn't count. Strings stay, since code can hide in them. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** Report each line with a native dialog call, as "file:line: code". */
function findNativeDialogs(files: { path: string; source: string }[]): string[] {
  return files.flatMap(({ path, source }) =>
    stripComments(source)
      .split('\n')
      .flatMap((line, i) => (NATIVE_CALL.test(line) ? [`${path}:${i + 1}: ${line.trim()}`] : [])),
  );
}

describe('no native dialogs', () => {
  it('src/ has no window.prompt, window.confirm or window.alert outside tests', () => {
    const files = Object.entries(SOURCES).map(([path, source]) => ({ path, source }));
    expect(files.some(({ path }) => path.endsWith('/main.ts'))).toBe(true);
    expect(files.length).toBeGreaterThan(20);
    expect(findNativeDialogs(files)).toEqual([]);
  });

  it('catches every spelling, and leaves our own helpers alone', () => {
    const check = (source: string) => findNativeDialogs([{ path: 'x.ts', source }]).length > 0;
    for (const bad of ["window.confirm('Sure?')", 'if (!confirm(msg)) return;', "const n = prompt('Name', '');", 'alert(1);', 'globalThis.alert ( "x" )', 'self.prompt()']) {
      expect(check(bad), bad).toBe(true);
    }
    for (const fine of ['await confirmDialog(options);', 'options.confirm(message);', 'promptDialog({})', 'const confirmed = true;', '// a confirm() popup', '/* window.alert(1) */', 'noticeDialog({ title })']) {
      expect(check(fine), fine).toBe(false);
    }
  });
});
