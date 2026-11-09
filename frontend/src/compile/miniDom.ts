/**
 * A tiny DOM, just enough for LaTeX.js and KaTeX to build the preview inside a worker and
 * for us to serialize it. Workers have no DOM, and a full one like linkedom costs about
 * 100 kB gzipped, so we keep our own. It isn't a general DOM: no parsing, no events, and
 * querySelector only knows `*`, `tag`, `#id` and `.class`.
 */

const HTML_NS = 'http://www.w3.org/1999/xhtml';
const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);
// Properties that just mirror an attribute of the same name.
const REFLECTED = ['id', 'href', 'src', 'title', 'type', 'rel', 'name', 'alt', 'lang', 'dir', 'charset', 'target'];

const escapeText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
const escapeAttr = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/ /g, '&nbsp;');
const toKebab = (prop: string) => (prop.startsWith('--') ? prop : prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));

type Child = MiniNode | string;

export class MiniNode {
  parentNode: MiniNode | null = null;
  childNodes: MiniNode[] = [];
  readonly nodeType: number;
  readonly nodeName: string;
  ownerDocument: MiniDocument | null;

  constructor(nodeType: number, nodeName: string, ownerDocument: MiniDocument | null) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.ownerDocument = ownerDocument;
  }

  get firstChild(): MiniNode | null {
    return this.childNodes[0] ?? null;
  }

  get lastChild(): MiniNode | null {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }

  get nextSibling(): MiniNode | null {
    const siblings = this.parentNode?.childNodes;
    return siblings ? (siblings[siblings.indexOf(this) + 1] ?? null) : null;
  }

  get previousSibling(): MiniNode | null {
    const siblings = this.parentNode?.childNodes;
    return siblings ? (siblings[siblings.indexOf(this) - 1] ?? null) : null;
  }

  get parentElement(): MiniElement | null {
    return this.parentNode instanceof MiniElement ? this.parentNode : null;
  }

  get children(): MiniElement[] {
    return this.childNodes.filter((node): node is MiniElement => node instanceof MiniElement);
  }

  get textContent(): string {
    return this.childNodes.map((node) => (node.nodeType === 8 ? '' : node.textContent)).join('');
  }

  set textContent(value: string) {
    for (const node of this.childNodes) node.parentNode = null;
    this.childNodes = [];
    if (value) this.appendChild(this.doc().createTextNode(value));
  }

  hasChildNodes(): boolean {
    return this.childNodes.length > 0;
  }

  contains(node: MiniNode | null): boolean {
    for (let current = node; current; current = current.parentNode) if (current === this) return true;
    return false;
  }

  appendChild<T extends MiniNode>(child: T): T {
    return this.insertBefore(child, null);
  }

  insertBefore<T extends MiniNode>(child: T, ref: MiniNode | null): T {
    // A fragment moves its children in, and the fragment itself stays out of the tree.
    const incoming = child.nodeType === 11 ? [...child.childNodes] : [child];
    for (const node of incoming) {
      node.parentNode?.removeChild(node);
      const index = ref ? this.childNodes.indexOf(ref) : -1;
      this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, node);
      node.parentNode = this;
    }
    return child;
  }

  removeChild<T extends MiniNode>(child: T): T {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  replaceChild<T extends MiniNode>(child: MiniNode, old: T): T {
    this.insertBefore(child, old);
    return this.removeChild(old);
  }

  append(...nodes: Child[]): void {
    for (const node of this.toNodes(nodes)) this.appendChild(node);
  }

  remove(): void {
    this.parentNode?.removeChild(this);
  }

  before(...nodes: Child[]): void {
    const parent = this.parentNode;
    for (const node of this.toNodes(nodes)) parent?.insertBefore(node, this);
  }

  after(...nodes: Child[]): void {
    const parent = this.parentNode;
    const next = this.nextSibling;
    for (const node of this.toNodes(nodes)) parent?.insertBefore(node, next);
  }

  replaceWith(...nodes: Child[]): void {
    this.before(...nodes);
    this.remove();
  }

  cloneNode(deep = false): MiniNode {
    const copy = this.cloneShallow();
    if (deep) for (const node of this.childNodes) copy.appendChild(node.cloneNode(true));
    return copy;
  }

  querySelector(selector: string): MiniElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): MiniElement[] {
    const found: MiniElement[] = [];
    const visit = (node: MiniNode) => {
      for (const child of node.children) {
        if (child.matches(selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }

  getElementsByTagName(tag: string): MiniElement[] {
    return this.querySelectorAll(tag);
  }

  getElementById(id: string): MiniElement | null {
    return this.querySelectorAll('*').find((el) => el.getAttribute('id') === id) ?? null;
  }

  /** Serialize this node, as outerHTML would. */
  serialize(): string {
    return this.childNodes.map((node) => node.serialize()).join('');
  }

  protected cloneShallow(): MiniNode {
    return new MiniNode(this.nodeType, this.nodeName, this.ownerDocument);
  }

  private doc(): MiniDocument {
    return this.ownerDocument ?? (this as unknown as MiniDocument);
  }

  private toNodes(nodes: Child[]): MiniNode[] {
    return nodes.map((node) => (typeof node === 'string' ? this.doc().createTextNode(node) : node));
  }
}

export class MiniText extends MiniNode {
  data: string;

  constructor(data: string, ownerDocument: MiniDocument | null, nodeType = 3) {
    super(nodeType, nodeType === 8 ? '#comment' : '#text', ownerDocument);
    this.data = data;
  }

  get nodeValue(): string {
    return this.data;
  }

  set nodeValue(value: string) {
    this.data = value;
  }

  get length(): number {
    return this.data.length;
  }

  override get textContent(): string {
    return this.data;
  }

  override set textContent(value: string) {
    this.data = value;
  }

  override serialize(): string {
    if (this.nodeType === 8) return `<!--${this.data}-->`;
    const parent = this.parentNode;
    return parent instanceof MiniElement && RAW_TEXT_ELEMENTS.has(parent.localName) ? this.data : escapeText(this.data);
  }

  protected override cloneShallow(): MiniNode {
    return new MiniText(this.data, this.ownerDocument, this.nodeType);
  }
}

export class MiniFragment extends MiniNode {
  constructor(ownerDocument: MiniDocument | null) {
    super(11, '#document-fragment', ownerDocument);
  }

  protected override cloneShallow(): MiniNode {
    return new MiniFragment(this.ownerDocument);
  }
}

/** Inline styles.Plain property sets like style.marginRight = '1em' go through a Proxy. */
class MiniStyle {
  readonly props = new Map<string, string>();

  setProperty(prop: string, value: string | null): void {
    const name = toKebab(prop);
    if (value === null || value === '') this.props.delete(name);
    else this.props.set(name, String(value));
  }

  getPropertyValue(prop: string): string {
    return this.props.get(toKebab(prop)) ?? '';
  }

  removeProperty(prop: string): string {
    const value = this.getPropertyValue(prop);
    this.props.delete(toKebab(prop));
    return value;
  }

  get cssText(): string {
    return [...this.props].map(([name, value]) => `${name}: ${value};`).join(' ');
  }

  set cssText(text: string) {
    this.props.clear();
    for (const part of String(text).split(';')) {
      const colon = part.indexOf(':');
      if (colon > 0) this.setProperty(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
    }
  }
}

const createStyle = (): MiniStyle =>
  new Proxy(new MiniStyle(), {
    get(target, prop, receiver) {
      if (typeof prop !== 'string' || prop in target) return Reflect.get(target, prop, receiver);
      return target.getPropertyValue(prop);
    },
    set(target, prop, value, receiver) {
      if (typeof prop !== 'string' || prop in target) return Reflect.set(target, prop, value, receiver);
      target.setProperty(prop, value);
      return true;
    },
  });

export class MiniElement extends MiniNode {
  readonly namespaceURI: string;
  readonly localName: string;
  readonly attrs = new Map<string, string>();
  private readonly styles = createStyle();

  constructor(localName: string, namespaceURI: string, ownerDocument: MiniDocument | null) {
    super(1, namespaceURI === HTML_NS ? localName.toUpperCase() : localName, ownerDocument);
    this.localName = namespaceURI === HTML_NS ? localName.toLowerCase() : localName;
    this.namespaceURI = namespaceURI;
  }

  get tagName(): string {
    return this.nodeName;
  }

  get style(): MiniStyle {
    return this.styles;
  }

  set style(text: string) {
    this.styles.cssText = text;
  }

  get className(): string {
    return this.getAttribute('class') ?? '';
  }

  set className(value: string) {
    this.setAttribute('class', value);
  }

  get classList() {
    const list = () => this.className.split(/\s+/).filter(Boolean);
    const save = (names: string[]) => this.setAttribute('class', names.join(' '));
    return {
      contains: (name: string) => list().includes(name),
      add: (...names: string[]) => save([...new Set([...list(), ...names])]),
      remove: (...names: string[]) => save(list().filter((name) => !names.includes(name))),
      toggle: (name: string) => {
        const has = list().includes(name);
        save(has ? list().filter((other) => other !== name) : [...list(), name]);
        return !has;
      },
    };
  }

  get attributes(): { name: string; value: string }[] {
    return [...this.allAttributes()].map(([name, value]) => ({ name, value }));
  }

  getAttribute(name: string): string | null {
    const key = this.attrName(name);
    if (key === 'style') return this.styles.props.size ? this.styles.cssText : null;
    return this.attrs.get(key) ?? null;
  }

  setAttribute(name: string, value: unknown): void {
    const key = this.attrName(name);
    if (key === 'style') this.styles.cssText = String(value);
    else this.attrs.set(key, String(value));
  }

  setAttributeNS(_ns: string | null, name: string, value: unknown): void {
    this.setAttribute(name, value);
  }

  removeAttribute(name: string): void {
    const key = this.attrName(name);
    if (key === 'style') this.styles.props.clear();
    else this.attrs.delete(key);
  }

  hasAttribute(name: string): boolean {
    return this.getAttribute(name) !== null;
  }

  matches(selector: string): boolean {
    return selector.split(',').some((part) => {
      const s = part.trim();
      if (s === '*') return true;
      if (s.startsWith('#')) return this.getAttribute('id') === s.slice(1);
      if (s.startsWith('.')) return this.classList.contains(s.slice(1));
      return this.localName.toLowerCase() === s.toLowerCase();
    });
  }

  get innerHTML(): string {
    return super.serialize();
  }

  get outerHTML(): string {
    return this.serialize();
  }

  override serialize(): string {
    const attrs = [...this.allAttributes()].map(([name, value]) => ` ${name}="${escapeAttr(value)}"`).join('');
    const open = `<${this.localName}${attrs}>`;
    if (this.namespaceURI === HTML_NS && VOID_ELEMENTS.has(this.localName)) return open;
    return `${open}${super.serialize()}</${this.localName}>`;
  }

  protected override cloneShallow(): MiniNode {
    const copy = new MiniElement(this.localName, this.namespaceURI, this.ownerDocument);
    for (const [name, value] of this.allAttributes()) copy.setAttribute(name, value);
    return copy;
  }

  private *allAttributes(): Iterable<[string, string]> {
    yield* this.attrs;
    if (this.styles.props.size) yield ['style', this.styles.cssText];
  }

  private attrName(name: string): string {
    return this.namespaceURI === HTML_NS ? name.toLowerCase() : name;
  }
}

// Add id, href and friends as properties that read and write their attribute.
for (const prop of REFLECTED) {
  Object.defineProperty(MiniElement.prototype, prop, {
    get(this: MiniElement) {
      return this.getAttribute(prop) ?? '';
    },
    set(this: MiniElement, value: unknown) {
      this.setAttribute(prop, value);
    },
  });
}

export class MiniDocument extends MiniNode {
  readonly compatMode = 'CSS1Compat';
  readonly implementation = {
    createHTMLDocument: (title?: string) => MiniDocument.createHTMLDocument(title),
  };

  constructor() {
    super(9, '#document', null);
  }

  /** Make an empty page with html, head, title and body, like a browser does. */
  static createHTMLDocument(title?: string): MiniDocument {
    const doc = new MiniDocument();
    const html = doc.appendChild(doc.createElement('html'));
    const head = html.appendChild(doc.createElement('head'));
    html.appendChild(doc.createElement('body'));
    if (title !== undefined) head.appendChild(doc.createElement('title')).textContent = title;
    return doc;
  }

  get documentElement(): MiniElement | null {
    return this.children[0] ?? null;
  }

  get head(): MiniElement | null {
    return this.documentElement?.children.find((el) => el.localName === 'head') ?? null;
  }

  get body(): MiniElement | null {
    return this.documentElement?.children.find((el) => el.localName === 'body') ?? null;
  }

  get title(): string {
    return this.querySelector('title')?.textContent ?? '';
  }

  createElement(tag: string): MiniElement {
    return new MiniElement(tag, HTML_NS, this);
  }

  createElementNS(ns: string | null, tag: string): MiniElement {
    return new MiniElement(tag, ns ?? HTML_NS, this);
  }

  createTextNode(text: string): MiniText {
    return new MiniText(String(text), this);
  }

  createComment(text: string): MiniText {
    return new MiniText(String(text), this, 8);
  }

  createDocumentFragment(): MiniFragment {
    return new MiniFragment(this);
  }
}

/**
 * A stand-in for `window`. LaTeX.js checks nodes with `instanceof window.Element` and friends,
 * so those need to point at our classes.
 */
export function createMiniWindow() {
  return {
    document: MiniDocument.createHTMLDocument(''),
    Node: MiniNode,
    Element: MiniElement,
    SVGElement: MiniElement,
    Text: MiniText,
    DocumentFragment: MiniFragment,
  };
}
