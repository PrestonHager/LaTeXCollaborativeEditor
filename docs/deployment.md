# Deployment

## Frontend (GitHub Pages)
1. Configure repository Pages source to GitHub Actions.
2. Set Actions secrets/variables:
   - `VITE_P2P_APP_ID`
   - `VITE_P2P_RENDEZVOUS`
   - `VITE_STUN_URL`
   - `VITE_TURN_URL` (optional)
   - `VITE_TURN_USERNAME` (optional)
   - `VITE_TURN_CREDENTIAL` (optional)
   - `VITE_GOOGLE_CLIENT_ID`
3. Ensure `wasm-pack` is available in the build environment.
4. Build Rust wasm artifact before frontend bundle:
   - `npm run build:wasm`
5. Push to `main`; workflow builds and deploys static `frontend/dist`.

## Runtime architecture
- No custom signaling server is deployed by this repository.
- Peers discover each other through configured public rendezvous endpoints.
- Document content remains peer-to-peer after room join.
- LaTeX preview compilation runs in-browser through `rust-tex` WebAssembly loaded by the frontend compile worker.

## STUN/TURN
- Start with `stun:stun.l.google.com:19302`.
- Add TURN for restrictive NAT environments.

## Domain requirements
- `latex.prestonhager.com` must be served via HTTPS to keep browser P2P APIs available.
- Keep CORS and CSP policies permissive enough for configured rendezvous and TURN endpoints.
