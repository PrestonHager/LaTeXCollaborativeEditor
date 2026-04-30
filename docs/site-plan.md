Site Plan: Docs under /docs/

- Objective: Provide a user-friendly, static documentation site accessible at /docs/ to help users understand protocol, deployment, and features.
- Framework recommendation: MkDocs with Material for MkDocs (Python-based, simple to install, great Markdown support, good theming). Alternatives: Docusaurus (React) if a richer UI is desired, or VitePress (Vue) for a lightweight MD-based site.
- Why MkDocs (recommended):
  - Very low maintenance for pure documentation, fast build times, easy hosting as static assets.
  - Can be hosted as static assets alongside the main site under /docs/.
  - The existing docs are Markdown; MkDocs naturally consumes Markdown and provides a clean UI with search.
- Site layout (proposed):
  - /docs/index.md: Overview and quick start
  - /docs/protocol.md: Serverless P2P Protocol details (current content rewritten)
  - /docs/deployment.md: Deployment steps and runtime details (current content rewritten)
  - /docs/dod-checklist.md: Definition of Done (current content rewritten)
  - /docs/contributing.md: How to contribute to docs
- Deployment steps for enabling /docs/
  - Add a lightweight MkDocs build step to CI (or pre-build script) that outputs to a static folder.
  - Ensure the hosting environment serves /docs/ as static content (e.g., GitHub Pages, Netlify, Vercel, or an existing host).
- Next actions: confirm framework choice and confirm hosting setup. After confirmation, I can scaffold the site with MkDocs (or your chosen framework) and wire it into the repo.
