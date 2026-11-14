# Docs folder

## Published user site (MkDocs)

The **built documentation** is the **user guide**: getting started, editing, collaboration, storage, interface, and shortcuts. Those pages are listed in `mkdocs.yml` under `nav`.

`mkdocs build` (and the deploys, `release.yml` and the staging `Dockerfile`) **exclude** some Markdown from the published site (see `exclude_docs` in `mkdocs.yml`) so the public site stays end-user focused. Excluded files remain in this folder for **contributors and operators** (protocol, deployment checklist, DoD, internal notes).

## Maintainer references (not in the MkDocs nav)

| File | Purpose |
|------|--------|
| `protocol.md` | P2P / rendezvous protocol notes — update when collaboration behavior changes (`AGENTS.md`). |
| `deployment.md` | Hosting, env vars, CI build — update when deployment or CI changes. |
| `dod-checklist.md` | v1 definition of done. |
| `site-plan.md` | Internal planning notes. |
| `ui-sizing.md` | Dialog and popover size scale (`dialog-sm`, `dialog-md`, `dialog-lg`, `dialog-palette`), height and scroll rules, breakpoints, and the mobile plan for #123. Read it before adding a dialog. |
| `compatibility-baseline.md` | How the preview copes with the Overleaf-style corpus in `frontend/dev/corpus/` (#197). Rerun with `npm run test:corpus` in `frontend/`; update with `npm run corpus:update` when engine work moves a result. |

## Local preview

From the repository root:

```bash
pip install -r requirements-docs.txt
mkdocs serve
```

Open the URL MkDocs prints (often `http://127.0.0.1:8000/`). See `deployment.md` for CI and GitHub Pages.

## Screenshots and diagrams

Screenshots come from a script, so you don't take them by hand.
Run `npm run screenshots` from the repository root.
It writes light and dark PNGs into `assets/screenshots/`.
See `deployment.md` for the details and options.

Diagrams are Mermaid fences (```` ```mermaid ````) right in the Markdown.
The UI map and user flows are in `how-it-fits.md`, and the P2P sequence diagrams are in `protocol.md`.
