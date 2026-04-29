# Collaborative LaTeX Editor

Browser-first collaborative LaTeX editor with peer-to-peer sync and client-side preview.

## Quick start
1. Install dependencies:
   - `npm install` (repo root)
   - `npm --prefix frontend install`
2. Copy `frontend/.env.example` to `frontend/.env` and fill values.
3. Start app: `npm run dev`
4. Run full tests: `npm test`

## Notes
- Document sync is peer-to-peer using a serverless rendezvous workflow over public P2P bootstrap infrastructure.
- Share URLs use a `room` query parameter that maps to the P2P session topic.
- Use File menu to open local docs, open from Google Drive, and manage Drive files (rename/move folder) after connecting.
- Google Drive Picker actions require both `VITE_GOOGLE_CLIENT_ID` and `VITE_GOOGLE_API_KEY` in `frontend/.env`.
- Deployed site includes legal pages at `privacy.html` and `tos.html`.
