// No console window next to the app in a Windows release build.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    latex_collaborative_editor_lib::run()
}
