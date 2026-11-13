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

## License

GPL-3.0-or-later. See [LICENSE](LICENSE) for the full text, and [docs/licensing.md](docs/licensing.md) for the dependency audit and third-party notices.

```text
Copyright (C) 2026 Preston Hager and contributors

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
```
