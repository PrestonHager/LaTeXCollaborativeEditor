/** A Cache API stand-in for tests (jsdom has none). Keys are URLs; bodies are kept as bytes. */
class FakeCache {
  readonly entries = new Map<string, { body: Uint8Array; headers: [string, string][] }>();

  private url(request: RequestInfo | URL) {
    return typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
  }

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    const entry = this.entries.get(this.url(request));
    return entry ? new Response(entry.body.slice() as Uint8Array<ArrayBuffer>, { headers: entry.headers }) : undefined;
  }

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    this.entries.set(this.url(request), { body: new Uint8Array(await response.arrayBuffer()), headers: [...response.headers] });
  }

  async delete(request: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(this.url(request));
  }

  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
}

export class FakeCacheStorage {
  readonly stores = new Map<string, FakeCache>();

  async open(name: string) {
    let cache = this.stores.get(name);
    if (!cache) this.stores.set(name, (cache = new FakeCache()));
    return cache as unknown as Cache;
  }

  async keys() {
    return [...this.stores.keys()];
  }

  async delete(name: string) {
    return this.stores.delete(name);
  }

  async has(name: string) {
    return this.stores.has(name);
  }

  async match() {
    return undefined;
  }

  asCacheStorage() {
    return this as unknown as CacheStorage;
  }
}
