use base64::Engine;
use serde::Serialize;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
struct CompileResponse {
    ok: bool,
    engine: String,
    pdf_data_url: Option<String>,
    diagnostics: Option<String>,
    error: Option<String>,
}

#[wasm_bindgen]
pub fn compile_latex_to_html_preview(source: &str) -> String {
    format!("<html><body><pre>{}</pre></body></html>", html_escape(source))
}

#[wasm_bindgen]
pub fn compile_latex_to_pdf_preview(source: &str) -> String {
    #[cfg(feature = "tectonic")]
    {
        return compile_with_tectonic(source);
    }

    #[cfg(not(feature = "tectonic"))]
    {
        return compile_with_mock(source);
    }
}

fn compile_with_mock(source: &str) -> String {
    let pdf = build_minimal_pdf(source);
    let base64 = base64::engine::general_purpose::STANDARD.encode(pdf.as_bytes());
    let payload = CompileResponse {
        ok: true,
        engine: "mock".to_string(),
        pdf_data_url: Some(format!("data:application/pdf;base64,{base64}")),
        diagnostics: Some("Rendered by mock Rust PDF engine. Enable `tectonic` feature for real LaTeX compilation.".to_string()),
        error: None,
    };
    serde_json::to_string(&payload).unwrap_or_else(|err| {
        format!(
            "{{\"ok\":false,\"engine\":\"mock\",\"error\":\"Failed to encode compile response: {}\"}}",
            json_escape(&err.to_string())
        )
    })
}

#[cfg(feature = "tectonic")]
fn compile_with_tectonic(source: &str) -> String {
    let _tectonic_marker = std::any::type_name::<tectonic::Error>();
    let payload = CompileResponse {
        ok: false,
        engine: "tectonic".to_string(),
        pdf_data_url: None,
        diagnostics: None,
        error: Some(format!(
            "Tectonic integration is feature-enabled but not yet wired for browser wasm resource loading. Input length: {} bytes.",
            source.len()
        )),
    };
    serde_json::to_string(&payload).unwrap_or_else(|_| {
        "{\"ok\":false,\"engine\":\"tectonic\",\"error\":\"Failed to encode compile response\"}".to_string()
    })
}

fn build_minimal_pdf(source: &str) -> String {
    let escaped = pdf_escape(source);
    let text_object = format!(
        "BT\n/F1 14 Tf\n72 760 Td\n({}) Tj\nET",
        escaped.replace('\n', ") Tj\n0 -18 Td\n(")
    );
    let stream_len = text_object.len();
    format!(
        "%PDF-1.4\n\
1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n\
2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n\
3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n\
4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n\
5 0 obj\n<< /Length {stream_len} >>\nstream\n{text_object}\nendstream\nendobj\n\
xref\n0 6\n0000000000 65535 f \n0000000010 00000 n \n0000000062 00000 n \n0000000121 00000 n \n0000000247 00000 n \n0000000317 00000 n \n\
trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n430\n%%EOF\n"
    )
}

fn pdf_escape(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('(', "\\(")
        .replace(')', "\\)")
}

fn html_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn json_escape(input: &str) -> String {
    input.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(test)]
mod tests {
    use super::{compile_latex_to_html_preview, compile_latex_to_pdf_preview};

    #[test]
    fn renders_preview_wrapper() {
        let html = compile_latex_to_html_preview("\\textbf{Hi}");
        assert!(html.contains("textbf"));
    }

    #[test]
    fn escapes_html_characters() {
        let html = compile_latex_to_html_preview("<script>alert(1)</script>");
        assert!(html.contains("&lt;script&gt;alert(1)&lt;/script&gt;"));
        assert!(!html.contains("<script>"));
    }

    #[test]
    fn returns_structured_pdf_response() {
        let payload = compile_latex_to_pdf_preview("\\section{Hello}");
        assert!(payload.contains("\"ok\":true"));
        assert!(payload.contains("\"pdf_data_url\":\"data:application/pdf;base64,"));
    }
}
