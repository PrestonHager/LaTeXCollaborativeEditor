self.onmessage = async (event: MessageEvent<{ source: string }>) => {
  const source = event.data.source;
  try {
    const escaped = source
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
    const html = `<html><body style="font-family:monospace;white-space:pre-wrap;padding:16px">${escaped}</body></html>`;
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    postMessage({ ok: true, pdfDataUrl: dataUrl });
  } catch (error) {
    postMessage({ ok: false, error: String(error) });
  }
};
