//! The desktop shell. It opens one window on the bundled frontend build (frontend/dist, served
//! from inside the app, never from a remote URL). The opener lets the page open https links in the
//! system browser; the dialog, fs and persisted-scope plugins let it open folders the person picks
//! as projects (issue #178), and nothing else on disk. Google sign-in runs here too, through the
//! system browser, with the refresh token in the OS keychain (issue #177, src/google_auth.rs), and
//! signed updates through the updater plugin when a release build configures it (#179, src/updates.rs).
//! Where the webview has no RTCPeerConnection (distro WebKitGTK), the page's WebRTC peer
//! connections run here instead, over IPC (#176, src/native_rtc.rs).
//! See docs/desktop.md for the plan.

mod google_auth;
pub mod native_rtc;
mod updates;

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
        // Local folder projects (#178). The fs capability allows no path on its own: only folders
        // picked in the dialog join its scope, and persisted-scope remembers them across restarts.
        // persisted-scope reads the fs plugin's scope, so it comes after it.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        // Google sign-in (#177). Each command needs its allow-* permission in the capability.
        .manage(google_auth::GoogleAuth::default())
        // WebRTC DataChannels for webviews without RTCPeerConnection (#176). Host candidates
        // are mDNS names, like a browser's, so local IPs don't reach the trackers.
        .manage(native_rtc::NativeRtc::new(true))
        .invoke_handler(tauri::generate_handler![
            google_auth::google_sign_in,
            google_auth::google_access_token,
            google_auth::google_sign_out,
            updates::update_check,
            updates::update_install,
            native_rtc::commands::rtc_create,
            native_rtc::commands::rtc_create_data_channel,
            native_rtc::commands::rtc_create_description,
            native_rtc::commands::rtc_set_description,
            native_rtc::commands::rtc_add_ice_candidate,
            native_rtc::commands::rtc_send,
            native_rtc::commands::rtc_close
        ])
        .setup(|app| {
            // Updates (#179): only release builds add plugins.updater (a public key and the
            // GitHub Releases endpoint) with --config. Without it there's no updater to register.
            let updater = updates::configured(app.config());
            #[cfg(desktop)]
            if updater {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            app.manage(updates::Updates::new(updater));
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
        // Tells the page, before its scripts run, whether this build can sign in to Google (#177),
        // so Accounts can say "Not configured" without an IPC round trip, and that the shell can
        // run WebRTC for it (#176). Only booleans: the client id and secret stay on the Rust side.
        .initialization_script(desktop_info_script(google_auth::Client::from_env().is_some()))
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

/// The one global the shell sets in the page (frontend/src/app/desktopShell.ts reads it): whether
/// this build can sign in to Google (#177), and that the shell can run WebRTC for the page (#176),
/// which the page only uses when its webview has no RTCPeerConnection.
fn desktop_info_script(google_sign_in: bool) -> String {
    format!(
        "Object.defineProperty(window,'__LCE_DESKTOP__',{{value:Object.freeze({{googleSignIn:{google_sign_in},nativeRtc:true}})}});"
    )
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
    fn the_page_only_learns_whether_google_sign_in_is_set_up() {
        assert_eq!(
            desktop_info_script(true),
            "Object.defineProperty(window,'__LCE_DESKTOP__',{value:Object.freeze({googleSignIn:true,nativeRtc:true})});"
        );
        assert!(desktop_info_script(false).contains("googleSignIn:false"));
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
