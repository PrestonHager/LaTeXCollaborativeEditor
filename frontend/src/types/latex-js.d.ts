declare module 'latex.js' {
  export class HtmlGenerator {
    constructor(options?: { hyphenate?: boolean; documentClass?: string });
    stylesAndScripts(baseURL?: string): DocumentFragment;
    domFragment(): DocumentFragment;
    htmlDocument(baseUrl?: string): Document;
  }

  export function parse(latex: string, options: { generator: HtmlGenerator }): HtmlGenerator;
}
