//! App updates (issue #179, docs/desktop.md "Updates"), through tauri-plugin-updater.
//!
//! The page never talks to the updater plugin. It gets two app commands: `update_check` (is a
//! newer signed release out?) and `update_install` (download it, check its signature against the
//! public key in the config, install and restart). So no `updater:*` permission is granted.
//!
//! The updater's config (public key and endpoint) isn't in tauri.conf.json: release builds add it
//! with `--config` from desktop/scripts/updater-config.mjs, only when the signing key is there. A
//! build without it (local, or a PR) has no updater, and update_check always answers "none".

use serde::Serialize;
use tauri::{AppHandle, Runtime, State};
#[cfg(desktop)]
use tauri_plugin_updater::UpdaterExt;
use tokio::sync::Mutex;

/// What the page learns about an update: its version, and the release notes when there are any.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct UpdateInfo {
    pub version: String,
    pub notes: Option<String>,
}

/// Whether this build has an updater, and the update the last check found.
pub struct Updates {
    enabled: bool,
    #[cfg(desktop)]
    pending: Mutex<Option<tauri_plugin_updater::Update>>,
    #[cfg(not(desktop))]
    #[allow(dead_code)]
    pending: Mutex<()>,
}

impl Updates {
    pub fn new(enabled: bool) -> Self {
        Updates {
            enabled,
            pending: Mutex::default(),
        }
    }
}

/// The release build adds `plugins.updater` (src/lib.rs registers the plugin only then).
pub fn configured(config: &tauri::Config) -> bool {
    config.plugins.0.get("updater").is_some_and(|value| {
        value
            .get("pubkey")
            .is_some_and(|key| key.as_str().is_some_and(|k| !k.is_empty()))
    })
}

/// Is a newer release out? `None` when not, or when this build has no updater.
#[tauri::command]
pub async fn update_check<R: Runtime>(
    app: AppHandle<R>,
    updates: State<'_, Updates>,
) -> Result<Option<UpdateInfo>, String> {
    if !updates.enabled {
        return Ok(None);
    }
    #[cfg(desktop)]
    {
        let found = app
            .updater()
            .map_err(|e| e.to_string())?
            .check()
            .await
            .map_err(|e| e.to_string())?;
        let info = found.as_ref().map(|update| UpdateInfo {
            version: update.version.clone(),
            notes: update.body.clone(),
        });
        *updates.pending.lock().await = found;
        Ok(info)
    }
    #[cfg(not(desktop))]
    {
        let _ = app;
        Ok(None)
    }
}

/// Download and install the update the last check found, then restart. The page saves first.
#[tauri::command]
pub async fn update_install<R: Runtime>(
    app: AppHandle<R>,
    updates: State<'_, Updates>,
) -> Result<(), String> {
    if !updates.enabled {
        return Err("no_update".into());
    }
    #[cfg(desktop)]
    {
        // Take it out, so two clicks can't install twice. Check again if the last check is gone.
        let mut pending = updates.pending.lock().await;
        let update = match pending.take() {
            Some(update) => update,
            None => app
                .updater()
                .map_err(|e| e.to_string())?
                .check()
                .await
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "no_update".to_string())?,
        };
        // The plugin checks the download's signature against the public key before installing.
        update
            .download_and_install(|_, _| {}, || {})
            .await
            .map_err(|e| e.to_string())?;
        app.restart();
    }
    #[cfg(not(desktop))]
    {
        let _ = app;
        Err("no_update".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config_with(plugins: serde_json::Value) -> tauri::Config {
        let mut config: tauri::Config =
            serde_json::from_value(serde_json::json!({ "identifier": "x.y.z" })).unwrap();
        config.plugins = serde_json::from_value(plugins).unwrap();
        config
    }

    #[test]
    fn the_updater_runs_only_with_a_public_key_in_the_config() {
        assert!(!configured(&config_with(serde_json::json!({}))));
        assert!(!configured(&config_with(
            serde_json::json!({ "updater": { "endpoints": [] } })
        )));
        assert!(!configured(&config_with(
            serde_json::json!({ "updater": { "pubkey": "" } })
        )));
        assert!(configured(&config_with(
            serde_json::json!({ "updater": { "pubkey": "dW50cnVzdGVk", "endpoints": [] } })
        )));
    }

    #[test]
    fn update_info_is_all_the_page_sees() {
        let info = UpdateInfo {
            version: "0.2.0".into(),
            notes: None,
        };
        assert_eq!(
            serde_json::to_string(&info).unwrap(),
            r#"{"version":"0.2.0","notes":null}"#
        );
    }
}
