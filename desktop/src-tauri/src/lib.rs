//! The desktop shell. It opens one window on the bundled frontend build (frontend/dist, served
//! from inside the app, never from a remote URL). Its only plugin is the opener, which the page
//! uses to open https links in the system browser.
//! See docs/desktop.md for the plan.

use tauri::webview::NewWindowResponse;
use tauri::{Manager, Url, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

/// Where the build serves its own copy of LaTeX.js's styles and fonts (issue #181). Matches
/// `LATEX_JS_BUNDLED_PATH` in frontend/src/compile/latexJsAssets.ts.
const LATEXJS_PATH: &str = "/latexjs/";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            create_main_window(app)?;
            #[cfg(target_os = "linux")]
            enable_webrtc(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the desktop app");
}

/// The main window comes from tauri.conf.json (`"create": false` there), built here so it gets
/// the link and asset handlers below (docs/desktop.md, "Links" and "Offline preview").
fn create_main_window(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .cloned()
        .ok_or("tauri.conf.json has no \"main\" window")?;
    let dev_url = if tauri::is_dev() { app.config().build.dev_url.clone() } else { None };
    let nav_handle = app.handle().clone();
    let popup_handle = app.handle().clone();
    let nav_dev_url = dev_url.clone();

    WebviewWindowBuilder::from_config(app.handle(), &config)?
        // Nothing but the app itself loads in this window. An https link opens in the
        // system browser instead; anything else (http, file, custom schemes) goes nowhere.
        .on_navigation(move |url| {
            if is_app_url(url, nav_dev_url.as_ref()) {
                return true;
            }
            open_https(&nav_handle, url);
            false
        })
        // window.open and target="_blank": the app has one window, so https goes to the
        // browser and nothing else opens.
        .on_new_window(move |url, _features| {
            open_https(&popup_handle, &url);
            NewWindowResponse::Deny
        })
        // The preview frame is sandboxed (opaque origin), and fonts always load with CORS, so
        // the bundled LaTeX.js assets must allow any origin, as the CDN does. They're public
        // static files; nothing else gets this header changed.
        .on_web_resource_request(|request, response| {
            if request.uri().path().starts_with(LATEXJS_PATH) {
                response.headers_mut().insert(
                    tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN,
                    tauri::http::HeaderValue::from_static("*"),
                );
            }
        })
        .build()?;
    Ok(())
}

/// The app's own pages: the bundled build (tauri://localhost, or http(s)://tauri.localhost on
/// Windows), the dev server in `tauri dev`, and the frames the page makes itself (about:srcdoc,
/// about:blank and blob: URLs).
fn is_app_url(url: &Url, dev_url: Option<&Url>) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "about" | "blob" => true,
        "http" | "https" => {
            url.host_str() == Some("tauri.localhost")
                || dev_url.is_some_and(|dev| dev.origin() == url.origin())
        }
        _ => false,
    }
}

/// Open an https URL in the system browser. Anything else is dropped.
fn open_https<R: tauri::Runtime>(app: &tauri::AppHandle<R>, url: &Url) {
    if url.scheme() != "https" {
        return;
    }
    if let Err(error) = app.opener().open_url(url.as_str(), None::<&str>) {
        eprintln!("Could not open {url} in the system browser: {error}");
    }
}

/// WebKitGTK leaves WebRTC off unless the app turns on its `enable-webrtc` setting, and wry
/// doesn't. Even then RTCPeerConnection only exists if the system's WebKitGTK was built with
/// WebRTC, which Ubuntu 24.04's isn't (docs/desktop.md, "Linux WebKitGTK").
///
/// The setting is read when a page's script globals are made, and the window may already be
/// loading the app, so the page is reloaded once after the change.
#[cfg(target_os = "linux")]
fn enable_webrtc(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use webkit2gtk::{SettingsExt, WebViewExt};

    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    window.with_webview(|webview| {
        let view = webview.inner();
        if let Some(settings) = WebViewExt::settings(&view) {
            if !settings.enables_webrtc() {
                settings.set_enable_webrtc(true);
                view.reload();
            }
        }
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn only_the_app_loads_in_the_window() {
        let dev = url("http://localhost:5173/");
        assert!(is_app_url(&url("tauri://localhost/index.html"), None));
        assert!(is_app_url(&url("https://tauri.localhost/privacy.html"), None));
        assert!(is_app_url(&url("about:srcdoc"), None));
        assert!(is_app_url(&url("http://localhost:5173/?room=x"), Some(&dev)));
        assert!(!is_app_url(&url("http://localhost:5173/"), None));
        assert!(!is_app_url(&url("http://localhost:8080/"), Some(&dev)));
        assert!(!is_app_url(&url("tauri://evil.example/"), None));
        assert!(!is_app_url(&url("https://example.com/"), None));
        assert!(!is_app_url(&url("file:///etc/passwd"), None));
        assert!(!is_app_url(&url("data:text/html,hi"), None));
    }
}
