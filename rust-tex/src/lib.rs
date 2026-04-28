use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn compile_latex_to_html_preview(source: &str) -> String {
    format!("<html><body><pre>{}</pre></body></html>", html_escape(source))
}

fn html_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::compile_latex_to_html_preview;

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
}
