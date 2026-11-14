fn main() {
    // Google sign-in (issue #177): the Desktop OAuth client comes from the build environment.
    // Rebuild when it changes, since src/google_auth.rs reads it with option_env!.
    println!("cargo:rerun-if-env-changed=GOOGLE_DESKTOP_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=GOOGLE_DESKTOP_CLIENT_SECRET");
    // The app's own commands (Google sign-in, #177; updates, #179; WebRTC, #176) get allow-* permissions, so the capability must grant each one
    // (capabilities/main-window.json); without a grant the page can't call it.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "google_sign_in",
            "google_access_token",
            "google_sign_out",
            "update_check",
            "update_install",
            "rtc_create",
            "rtc_create_data_channel",
            "rtc_create_description",
            "rtc_set_description",
            "rtc_add_ice_candidate",
            "rtc_send",
            "rtc_close",
        ]),
    ))
    .expect("failed to run the Tauri build script");
}
