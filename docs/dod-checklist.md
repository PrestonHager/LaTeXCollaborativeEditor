
# v1 Definition of Done

Overview
- This checklist defines the minimum criteria for a stable v1 release of the live, peer-to-peer LaTeX editor project. Each item should be checked off once verified in a test or demo environment.

Checklist
- [ ] Sharing and session bootstrap: a link that creates/joins the same room across two browsers works reliably.
- [ ] Real-time collaboration: concurrent edits synchronize in both directions with acceptable latency.
- [ ] Editor readiness: the editor shows LaTeX syntax highlighting and line numbers.
- [ ] Diagnostics: compile errors are parsed and highlighted inline on the correct editor lines.
- [ ] Preview: edits trigger an updated, correctly typeset preview using LaTeX.js.
- [ ] Preview sandbox: the rendered preview runs inside a sandboxed iframe to isolate execution.
- [ ] Export: the local editor content can be downloaded as a .tex file.
- [ ] Cloud integration: Google Drive Connect, autosave, and Save Now features work as expected.
- [ ] Networking: no repository-owned signaling server is required for connection setup.
- [ ] Privacy: Rendezvous metadata does not carry document payload content.
- [ ] Accessibility: connections work on localhost and the production domain (e.g. https://latex.example.com).
- [ ] Deployment: the app deploys successfully to GitHub Pages or the chosen static hosting.

Verification guidance
- Prefer automated tests where possible; accompany with manual QA for session join, realtime sync, and preview rendering.
- Maintain a runbook for reproducible test scenarios (local, remote, and cross-browser).
