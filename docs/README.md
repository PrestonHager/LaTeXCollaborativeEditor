# Docs folder

## Published user site (MkDocs)

The **built documentation** is the **user guide**: getting started, editing, collaboration, storage, interface, and shortcuts. Those pages are listed in `mkdocs.yml` under `nav`.

`mkdocs build` (and `pages.yml`) **exclude** some Markdown from the published site (see `exclude_docs` in `mkdocs.yml`) so the public site stays end-user focused. Excluded files remain in this folder for **contributors and operators** (protocol, deployment checklist, DoD, internal notes).

## Maintainer references (not in the MkDocs nav)

| File | Purpose |
|------|--------|
| `protocol.md` | P2P / rendezvous protocol notes — update when collaboration behavior changes (`AGENTS.md`). |
| `deployment.md` | Hosting, env vars, CI build — update when deployment or CI changes. |
| `dod-checklist.md` | v1 definition of done. |
| `site-plan.md` | Internal planning notes. |

## Local preview

From the repository root:

```bash
pip install -r requirements-docs.txt
mkdocs serve
```

Open the URL MkDocs prints (often `http://127.0.0.1:8000/`). See `deployment.md` for CI and GitHub Pages.
