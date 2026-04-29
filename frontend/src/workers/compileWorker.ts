const LATEX_JS_CDN_BASE = 'https://cdn.jsdelivr.net/npm/latex.js@0.12.6/dist/';

function buildLatexPreviewHtml(source: string): string {
  const jsonSource = JSON.stringify(source);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <base href="${LATEX_JS_CDN_BASE}" />
    <script src="${LATEX_JS_CDN_BASE}latex.js"></script>
    <title>LaTeX Preview</title>
    <style>body{margin:16px}</style>
  </head>
  <body>
    <p>Rendering LaTeX preview...</p>
    <script>
      (function () {
        const latexSource = ${jsonSource};
        try {
          let generator = new latexjs.HtmlGenerator({ hyphenate: false });
          generator = latexjs.parse(latexSource, { generator: generator });
          document.head.appendChild(generator.stylesAndScripts("${LATEX_JS_CDN_BASE}"));
          document.body.innerHTML = "";
          document.body.appendChild(generator.domFragment());
        } catch (error) {
          document.body.innerHTML =
            "<pre style='color:#b00020;white-space:pre-wrap'>LaTeX compile error:\\n" +
            String(error) +
            "</pre>";
        }
      })();
    </script>
  </body>
</html>`;
}

self.onmessage = async (event: MessageEvent<{ source: string }>) => {
  const source = event.data.source;
  try {
    const html = buildLatexPreviewHtml(source);
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    postMessage({
      ok: true,
      previewUrl: dataUrl,
      diagnostics: 'Rendered HTML preview via latex.js browser extension.',
    });
  } catch (error) {
    postMessage({ ok: false, error: String(error) });
  }
};
