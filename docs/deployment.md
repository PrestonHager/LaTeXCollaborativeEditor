
# Deployment

Frontend deployment (GitHub Pages)
- Configure the repository Pages source to trigger via GitHub Actions.
- Set Actions secrets/variables as needed for runtime configuration, for example:
  - `VITE_P2P_APP_ID`
  - `VITE_P2P_RENDEZVOUS`
  - `VITE_STUN_URL`
  - `VITE_TURN_URL` (optional)
  - `VITE_TURN_USERNAME` (optional)
  - `VITE_TURN_CREDENTIAL` (optional)
  - `VITE_GOOGLE_CLIENT_ID`
  - `VITE_GOOGLE_API_KEY`
- Ensure wasm tooling (e.g., wasm-pack) is available in the build environment.
- Build the Rust wasm artifact before the frontend bundle, e.g. `npm run build:wasm`.
- Push to main; the CI workflow builds the Vite app into `frontend/dist`, runs MkDocs into `frontend/dist/docs`, and deploys that folder as the Pages artifact.
- Documentation is served at **`/docs/`** (for example `https://latex.prestonhager.com/docs/` when using a custom domain, or `https://<owner>.github.io/<repo>/docs/` on the default GitHub Pages host).
- **MkDocs `site_url`:** set the Actions variable **`DOCS_SITE_URL`** (repository or **Production** environment, matching the `environment` on the build job) to the full public URL of the docs site, including path and a trailing slash (e.g. `https://latex.prestonhager.com/docs/`). If unset, CI falls back to the default `github.io` project URL under `/docs/`. Align this with the Pages site URL shown after deploy (`environment.url` / `steps.deployment.outputs.page_url` on the deploy job is the **site root**; MkDocs needs the **docs** subtree URL).

Runtime architecture (summary)
- There is no custom signaling server in this repository.
- Peers discover each other via configured public rendezvous endpoints.
- Document content remains peer-to-peer after joining a room.
- LaTeX preview runs in the browser via LaTeX.js inside a sandboxed iframe; assets may be loaded from a CDN.

Networking (STUN/TURN)
- Start with a public STUN server such as `stun:stun.l.google.com:19302`.
- Add TURN as needed for restrictive NAT environments.

Domain and security
- The domain (e.g., latex.prestonhager.com) must be served over HTTPS to enable P2P APIs.
- Keep CORS and CSP policies permissive enough for rendezvous and TURN endpoints while minimizing exposure.
