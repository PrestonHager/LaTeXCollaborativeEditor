declare module '../wasm/rust_tex_pkg/rust_tex' {
  export default function init(input?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module): Promise<void>;
  export function compile_latex_to_html_preview(source: string): string;
  export function compile_latex_to_pdf_preview(source: string): string;
}
