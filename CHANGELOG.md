# Changelog

All notable changes to this project are written down here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
See [docs/versioning.md](docs/versioning.md) for how to bump the version and cut a release.

## [Unreleased]

### Added

- **What's new.** Help → About → View changelog shows this changelog in the app, newest first, and marks the version you're on. The update prompt's What's new shows the new version's changelog, with what's new in it marked.
- **Update prompt.** When a new version is deployed, a small card offers to reload. It saves your changes first, and won't reload if the save fails. It also shows when a collaborator is on a newer, incompatible version.

### Changed

- **Breaking for open shared sessions:** the peer-to-peer library (Trystero) moved to 0.26, which changes how peers talk to each other. Tabs on the old build and tabs on this build can't sync with each other, so everyone in a session needs to reload. Open tabs see the update prompt and can reload from there. The P2P protocol version is now 2.
- **In-app dialogs replace the browser's prompt and confirm boxes.** Renaming, creating, deleting, starting a new link and replacing the project now ask in a dialog that matches the theme, names the action on its button, and checks file and project names as you type. Risky actions have a red button with focus on Cancel.

### Fixed

- The "Leave site?" box no longer shows just because you typed in the last 4 seconds. Edits are written to this browser as you leave, and the box only shows when something could really be lost.

## [0.1.0] - 2026-11-13

The first numbered release. It covers everything built so far.

### Added

- **Version numbers.** The About dialog and the footer show the version and commit, and the bug report form carries them. Each build ships a `version.json`, and peers say which build they run when they connect.
- **Peer-to-peer collaboration.** Share a link and edit the same project at the same time, browser to browser over WebRTC. There is no signaling server of our own: peers meet through public WebTorrent trackers (Trystero), and document content only travels between peers.
  - Yjs keeps edits in sync, with a shared undo and redo history.
  - The host's room and document survive a reload, so guest links keep working.
  - Connection badges show Not sharing, Waiting for peers, Connected, Relayed and Reconnecting, with the peer count.
  - Every incoming peer message is checked for shape and size before it's used.
  - Guests can't replace the shared project, and the host confirms Open and Import while guests are connected.
- **Projects.** A project is a folder of files with a main `.tex` file, not a single document.
  - Upload images and other binary files. They're shared between peers by hash, in chunks.
  - Rename, move, and make folders. Download the project as a `.zip`, empty folders included, or open one.
- **LaTeX preview** with LaTeX.js, in a Web Worker so typing stays smooth, inside a sandboxed iframe.
  - `\input`, `\include`, `\includegraphics` (with width, height and scale) and a simple bibliography.
  - Errors are mapped back to the original source lines and shown in the editor.
  - KaTeX fonts fill in math glyphs Computer Modern lacks, and preview text stays readable in every theme.
- **Editor.** CodeMirror with LaTeX syntax highlighting, light and dark themes, and keyboard shortcuts.
- **Saving.** Projects autosave to browser storage (IndexedDB) or to Google Drive with the `drive.file` scope.
  - Drive saves detect conflicts before overwriting and retry rate limits and server errors.
  - Pause Saving, Drive sign-out, and a Drive token kept per tab.
- **Interface.** Basecoat and Tailwind UI with menus, a command palette, in-app help links, and a first-run tour.
- **Docs and policies.** User docs (MkDocs) published under `/docs/`, Privacy and Terms of Service pages, a security policy, and issue forms.

[Unreleased]: https://github.com/PrestonHager/LaTeXCollaborativeEditor/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/PrestonHager/LaTeXCollaborativeEditor/releases/tag/v0.1.0
