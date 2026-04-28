# Deployment

## Frontend (GitHub Pages)
1. Configure repository Pages source to GitHub Actions.
2. Set Actions secrets/variables:
   - `VITE_SIGNALING_URL`
   - `VITE_GOOGLE_CLIENT_ID`
3. Push to `main`; workflow builds and deploys static `frontend/dist`.

## Signaling service
Deploy a minimal stateless WebSocket relay to Fly.io, Render, or Cloudflare Workers.

## STUN/TURN
- Start with `stun:stun.l.google.com:19302`.
- Add TURN for restrictive NAT environments.
