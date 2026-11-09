// Newer Node (22+ with webstorage on by default, seen on 26) has its own
// localStorage/sessionStorage globals that hide the ones jsdom provides.
// Without --localstorage-file they throw on use, so we put jsdom's back.
declare const jsdom: { window: Window } | undefined;

if (typeof jsdom !== 'undefined') {
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      enumerable: true,
      get: () => jsdom!.window[key],
    });
  }
}
