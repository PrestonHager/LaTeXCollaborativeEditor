declare module 'latex.js' {
  export class HtmlGenerator {
    constructor(options?: { hyphenate?: boolean });
    stylesAndScripts(baseURL?: string): DocumentFragment;
    domFragment(): DocumentFragment;
  }

  export function parse(latex: string, options: { generator: HtmlGenerator }): HtmlGenerator;
}
