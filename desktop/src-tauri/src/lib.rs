//! The desktop shell. It opens one window on the bundled frontend build (frontend/dist, served
//! from inside the app, never from a remote URL) and adds no commands or plugins yet.
//! See docs/desktop.md for the plan.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "linux")]
            enable_webrtc(app)?;
            #[cfg(not(target_os = "linux"))]
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the desktop app");
}

/// WebKitGTK leaves WebRTC off unless the app turns on its `enable-webrtc` setting, and wry
/// doesn't. Even then RTCPeerConnection only exists if the system's WebKitGTK was built with
/// WebRTC, which Ubuntu 24.04's isn't (docs/desktop.md, "Linux WebKitGTK").
///
/// The setting is read when a page's script globals are made, and the window may already be
/// loading the app, so the page is reloaded once after the change.
#[cfg(target_os = "linux")]
fn enable_webrtc(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::Manager;
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
