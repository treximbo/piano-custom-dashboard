Piano Conversion Viewer (Web)

Quick start
1) Create venv and install deps
   ```bash
   python3 -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   pip install flask
   ```
2) Run the app
   ```bash
   python app.py
   ```
3) Open http://localhost:5000

Usage
- Paste a Bearer token from your network tab into the form. The server does not store it; it is used for a single call.
- Optionally set environment defaults:
  - PIANO_EXP_ID, PIANO_AID, PIANO_BEARER
- Load local sample: click "Load sampleData.json". This fetches from the project root, so ensure the file exists there.
- Generate CSVs: click "Generate CSV bundle" to download all CSVs built from the currently displayed data.

Files
- app.py — Flask server with /api/report and /api/csv
- piano_lib.py — Reusable functions: fetch and CSV builders
- static/ — Frontend: index.html, styles.css, script.js
- sampleData.json — Your example response (used by the "Load sample" button)

Deploy
- The app uses a Procfile for simple PaaS hosting. Ensure env vars are set for tokens in production and consider adding authentication if exposed publicly.

Render (recommended)
- Connect this repo as a Web Service in Render.
- Build command: `pip install -r requirements.txt`
- Start command: `gunicorn -w 2 -b 0.0.0.0:$PORT app:app`
- PORT is injected by Render; `app.py` already respects it.

Auto-deploys from GitHub
- Render watches the default branch (main) by default.
- Any push to `main` triggers a new deploy automatically. You can change this in Render → Settings → Auto Deploy.
- If you use feature branches, open a PR and merge to `main` to deploy.
- To deploy immediately without waiting for auto-build, use Render’s “Manual Deploy” → “Clear build cache & deploy” if needed.

Environment variables
- Set in Render → Environment:
  - `PIANO_EXP_ID`, `PIANO_AID` (defaults), optionally `PIANO_BEARER` for server-side fetches (not recommended for user-owned tokens).
  - `TRENDS_CACHE_TTL` (seconds) to control server-side caching for trends.

Notes
- If Piano requires IP allowlisting, use Render’s Static Outbound IP add-on or verify the current egress IP (Render shell: `curl -s https://api.ipify.org`).
- For security, consider enabling a simple auth gate before exposing publicly.
