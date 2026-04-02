# CLAUDE.md — WatchTower

> **Purpose:** Provides every future Claude session with authoritative context about this codebase — architecture, conventions, data flows, and gotchas — so zero time is wasted rediscovering the obvious.

---

## Project Overview

**WatchTower** is a real-time global conflict monitoring dashboard. It aggregates casualty data, armed group information, and geopolitical news from credible international sources and presents them in a tactical situation-room UI.

- **Audience:** Analysts, researchers, journalists, and policy professionals
- **Design philosophy:** Dark-mode situation room aesthetic — maximum data density, sharp edges, monospace typography, red accents
- **Live tracking:** 9 active conflicts + full UCDP historical dataset (1946–present, ~200+ conflicts)
- **Data refresh:** Hourly via APScheduler; manual refresh available via `POST /api/refresh`

---

## Repository Structure

```
WatchTower/
├── backend/
│   ├── server.py              # SINGLE-FILE backend — all routes, scheduler, scrapers
│   ├── requirements.txt
│   ├── .env                   # Local secrets (never commit)
│   └── venv/                  # Python virtual environment (gitignored)
│
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Dashboard.js           # Main dashboard — stat cards, globe, charts, table
│   │   │   ├── HumanCost.js           # /human-cost — UCDP treemap 1946–present
│   │   │   └── ActorTracker.js        # /actor-tracker — one-sided violence profiling
│   │   ├── components/
│   │   │   ├── Header.js              # App header — timestamps, source pills, refresh button
│   │   │   ├── ConflictTable.js       # Conflict detail table with source attribution
│   │   │   ├── ConflictGlobe.js       # Cobe WebGL spinning globe with pulsing markers
│   │   │   ├── CasualtyHeatmap.js     # 9×4 grid heatmap (conflict × casualty type)
│   │   │   └── NewsTicker.js          # React Fast Marquee news feed
│   │   ├── App.js                     # Route definitions (React Router)
│   │   ├── App.css                    # Global styles — tactical theme overrides
│   │   └── index.css                  # CSS custom properties, font imports
│   ├── public/
│   ├── package.json
│   ├── .env                           # REACT_APP_BACKEND_URL (never commit)
│   └── node_modules/                  # gitignored
│
├── start.sh                   # Starts backend + frontend as background daemons
├── stop.sh                    # Stops both processes
├── LOCAL_DEPLOYMENT.md        # Full setup guide — MongoDB options, troubleshooting
├── README.md
└── .gitignore
```

**Critical architecture note:** The entire backend is **one file** (`backend/server.py`). All FastAPI routes, APScheduler setup, MongoDB operations, UCDP/ACLED/OHCHR/OCHA fetch logic, RSS parsing, and baseline conflict data live there. When working on the backend, this is always the file.

---

## Tech Stack

### Backend

| Package | Version/Notes | Role |
|---|---|---|
| Python | 3.11+ | Runtime |
| FastAPI | Latest | API framework |
| Uvicorn | — | ASGI server (`--reload` in dev) |
| Motor | Async | MongoDB driver |
| MongoDB | 7.0 | Primary data store |
| APScheduler | — | Hourly background scheduler |
| Feedparser | — | RSS feed parsing |
| BeautifulSoup4 | — | Web scraping (OHCHR, OCHA oPt) |
| Aiohttp | — | Async HTTP client for UCDP/ACLED |
| python-dotenv | — | `.env` loading |

### Frontend

| Package | Version/Notes | Role |
|---|---|---|
| React | 19 | UI framework |
| React Router | — | Client-side routing |
| Tailwind CSS | — | Utility-first styling |
| Recharts | — | Pie chart + bar chart + per-year bar in ActorTracker |
| Cobe | — | Tiny WebGL spinning globe |
| React Fast Marquee | — | News ticker |
| Lucide React | — | Icon system |
| Axios | — | HTTP client for API calls |
| Yarn | — | Package manager (always use Yarn, not npm) |

### Infrastructure

| Component | Details |
|---|---|
| Database | MongoDB — 4 collections (see below) |
| Backend port | `8001` |
| Frontend port | `3000` (CRA dev server) |
| Process management | `start.sh` / `stop.sh` shell scripts; logs in `logs/` |

---

## Environment Variables

### `backend/.env`

```env
MONGO_URL=mongodb://localhost:27017        # or Atlas connection string
DB_NAME=conflict_tracker
CORS_ORIGINS=*                             # comma-separated in production
UCDP_API_KEY=your-ucdp-access-token       # REQUIRED — x-ucdp-access-token header
ACLED_EMAIL=your@email.com                # optional — improves detail table quality
ACLED_KEY=your-acled-api-key              # optional
```

### `frontend/.env`

```env
REACT_APP_BACKEND_URL=http://localhost:8001
```

> **Note:** `REACT_APP_` prefix is mandatory — this is a CRA-style project. Any new env vars exposed to the frontend must use this prefix.

---

## Database Schema

### Collections in `conflict_tracker`

**`conflicts`** — Full dataset (ACLED → UCDP priority). Used by detail table and stat cards.
```json
{
  "id": "uuid-string",
  "country": "Ukraine",
  "region": "Eastern Europe",
  "total_deaths": 185000,
  "civilian_deaths": 12500,
  "military_deaths": 172500,
  "children_deaths": 580,
  "description": "...",
  "countries_involved": ["Ukraine", "Russia"],
  "parties_involved": ["Ukrainian Armed Forces", "Russian Armed Forces"],
  "data_sources": ["UCDP GED", "OHCHR", "UN OCHA"],
  "status": "active"
}
```

**`chart_conflicts`** — UCDP + OHCHR/OCHA only. Used exclusively by the Casualty Breakdown pie chart and Deaths by Country bar chart. Never mix this with ACLED data.

**`news_articles`** — ~60 RSS articles, refreshed hourly.

**`system_metadata`** — Single document storing last fetch timestamp, active sources array, chart sources array, and `next_fetch_in_minutes`.

---

## API Reference (Quick Index)

| Endpoint | Used By | Source Priority |
|---|---|---|
| `GET /api/conflicts` | Detail table, stat cards | ACLED → UCDP fallback |
| `GET /api/chart-conflicts` | Deaths by Country chart | UCDP + OHCHR/OCHA only |
| `GET /api/stats` | Stat cards aggregates | Full dataset |
| `GET /api/chart-stats` | Casualty Breakdown chart | UCDP + OHCHR/OCHA only |
| `GET /api/treemap` | `/human-cost` page | UCDP battledeaths (1946–present) |
| `GET /api/onesided?gwno=&years=` | `/actor-tracker` Step 2 | UCDP One-Sided Violence |
| `GET /api/gedevents?actor=&gwno=&years=` | `/actor-tracker` Step 3 | UCDP GED TypeOfViolence=3 |
| `GET /api/news` | News ticker | RSS feeds |
| `GET /api/last-update` | Header timestamps | `system_metadata` |
| `POST /api/refresh` | Manual trigger | All sources |

**Source separation rule:** Charts (`/api/chart-*`) must **always** use UCDP + OHCHR/OCHA only. Never route ACLED data into chart endpoints. This is intentional for source transparency.

---

## Data Flow Architecture

```
Startup / Hourly Scheduler (APScheduler)
  │
  ├─ UCDP GED API          → total deaths per country (paginated, auth via x-ucdp-access-token)
  ├─ ACLED API (optional)  → total fatalities per country (requires ACLED_EMAIL + ACLED_KEY)
  ├─ OHCHR scrape          → Ukraine civilian death count (BeautifulSoup4)
  ├─ OCHA oPt scrape       → Gaza total death count (BeautifulSoup4)
  └─ RSS feeds (12 sources)→ ~60 news articles (Feedparser)
        │
        ├─ Build `conflicts`       → ACLED priority, UCDP fallback → write to MongoDB
        ├─ Build `chart_conflicts` → UCDP + OHCHR/OCHA only → write to MongoDB
        ├─ Scale civilian/military/children proportionally from live totals
        ├─ Write timestamp + sources to `system_metadata`
        └─ Rebuild treemap cache (UCDP battledeaths/25.1, all years, in-memory)

Frontend polling (every 5 min on Dashboard):
  GET /api/conflicts, /chart-conflicts, /stats, /chart-stats, /news, /last-update

Human Cost page (on mount):
  GET /api/treemap → served from in-memory cache; first cold request triggers live fetch

Actor Tracker (on-demand, two-step):
  Step 2: GET /api/onesided?gwno=&years=
  Step 3: GET /api/gedevents?actor=&gwno=&years=
```

---

## Frontend Conventions

### Routing (`App.js`)
```
/                → Dashboard (main landing)
/human-cost      → HumanCost treemap page
/actor-tracker   → ActorTracker perpetrator profiling
```

### API calls
All HTTP requests use **Axios**. The base URL always comes from `process.env.REACT_APP_BACKEND_URL`. Never hardcode `localhost:8001` in component files.

```js
// Correct pattern
const res = await axios.get(`${process.env.REACT_APP_BACKEND_URL}/api/conflicts`);

// Wrong
const res = await axios.get('http://localhost:8001/api/conflicts');
```

### Charting
- **Recharts** for: Casualty Breakdown pie chart, Deaths by Country bar chart, per-year deaths bar chart in ActorTracker
- **Cobe** for: the spinning WebGL globe in `ConflictGlobe.js`
- Custom canvas/D3-style code for: the casualty heatmap (`CasualtyHeatmap.js`) and the zoomable treemap (`HumanCost.js`)

### Design system
- **Fonts:** Barlow Condensed (headings), Manrope (body), JetBrains Mono (numeric data)
- **Primary color:** `#dc2626` (red-600)
- **Background palette:** Zinc grays (dark mode only — no light mode)
- **No rounded corners** anywhere — sharp edges are intentional
- **LIVE indicator:** CSS blink animation on active conflict badges
- **Data density:** Prefer bento-grid layouts; pack maximum information per viewport

### Source pills pattern
Charts must always display source attribution pills (`UCDP · OHCHR/OCHA`) directly below the chart title, alongside a "last updated" timestamp. This is a transparency requirement, not a cosmetic detail.

---

## Backend Conventions

### Single-file structure (`server.py`)
Key sections in order:
1. Imports + env loading
2. FastAPI app init + CORS config
3. MongoDB client (Motor async)
4. `BASELINE_CONFLICTS` dict — hardcoded fallback data, keyed by country name
5. `RSS_FEEDS` list — all 12+ feed URLs
6. Fetch functions: `fetch_ucdp_data()`, `fetch_acled_data()`, `scrape_ohchr_*()`, `scrape_oaca_*()`
7. Scheduler setup (APScheduler) + `refresh_all_data()` orchestrator
8. FastAPI route handlers
9. Startup event (triggers initial fetch)

### UCDP authentication
UCDP requires an access token since Feb 2026. Pass as header:
```python
headers = {"x-ucdp-access-token": os.getenv("UCDP_API_KEY")}
```
HTTP 401/403 from UCDP means the token is missing or expired. Check logs: `UCDP returned HTTP 401 for <country>`.

### Fallback behavior
If all live sources fail, `BASELINE_CONFLICTS` hardcoded figures are used. These are historically sourced values — not invented numbers. The fallback must always be preserved; never delete it.

### Source priority rule (enforced in code)
```
conflicts collection:   ACLED data (if available) > UCDP data
chart_conflicts:        UCDP + OHCHR/OCHA ONLY — ACLED never enters here
```

### Async pattern
All database operations use Motor (async). All external HTTP calls use aiohttp. Never use `requests` (sync) inside async route handlers.

---

## Development Workflow

### Starting the app locally
```bash
# Terminal 1 — Backend
cd backend && source venv/bin/activate
python -m uvicorn server:app --reload --host 0.0.0.0 --port 8001

# Terminal 2 — Frontend
cd frontend && yarn start

# Or use the convenience scripts from repo root:
./start.sh   # background daemons
./stop.sh    # kill both
tail -f logs/backend.log
tail -f logs/frontend.log
```

### Hot reload
- **Backend:** `--reload` flag restarts on file save (single file: `server.py`)
- **Frontend:** CRA dev server auto-refreshes on save

### Verify data is live
```bash
curl http://localhost:8001/api/stats        # check active_conflicts = 9
curl http://localhost:8001/api/last-update  # check fetched_at is recent
curl -X POST http://localhost:8001/api/refresh  # force immediate re-fetch
```

### Database inspection
```bash
mongosh
use conflict_tracker
db.conflicts.countDocuments()        # → 9
db.chart_conflicts.countDocuments()  # → 9
db.news_articles.countDocuments()    # → ~60
db.system_metadata.findOne()         # → fetch timestamp, sources
```

### Package management
- Frontend: always `yarn` (never `npm install`)
- Backend: `pip install -r requirements.txt` inside the venv

---

## Common Edit Locations

| Task | File | Function/Section |
|---|---|---|
| Add/edit conflict baseline fallback data | `backend/server.py` | `BASELINE_CONFLICTS` dict |
| Change UCDP fetch logic / pagination | `backend/server.py` | `fetch_ucdp_data()` |
| Change OHCHR scraping | `backend/server.py` | `scrape_ohchr_*()` |
| Add/remove RSS feed sources | `backend/server.py` | `RSS_FEEDS` list |
| Change data refresh interval | `backend/server.py` | APScheduler `IntervalTrigger` |
| Dashboard layout (stat cards, charts) | `frontend/src/pages/Dashboard.js` | — |
| Globe markers / animation | `frontend/src/components/ConflictGlobe.js` | Cobe config |
| Heatmap color scale or metrics | `frontend/src/components/CasualtyHeatmap.js` | normalization logic |
| Treemap drill-down logic | `frontend/src/pages/HumanCost.js` | region/conflict zoom state |
| Actor Tracker evidence table | `frontend/src/pages/ActorTracker.js` | Step 3 profile section |
| Header timestamps + source pills | `frontend/src/components/Header.js` | — |
| Global dark theme / fonts | `frontend/src/index.css` | CSS custom properties |
| Tactical aesthetic overrides | `frontend/src/App.css` | — |

---

## Known Constraints & Gotchas

1. **UCDP API key required.** Without `UCDP_API_KEY`, all live data fetches fail and baseline fallback activates. The API endpoint changed in Feb 2026 to require the `x-ucdp-access-token` header.

2. **Treemap data is in-memory cached.** The treemap endpoint (`/api/treemap`) reads from a Python dict populated at startup and refreshed hourly. If the backend restarts mid-session, the first treemap request triggers a live UCDP fetch — may take several seconds.

3. **Chart data isolation is strict.** `chart_conflicts` and `chart-stats` endpoints are intentionally decoupled from ACLED. Any PR that routes ACLED data into chart endpoints breaks source transparency and should be rejected.

4. **Civilian/military/children figures are proportionally scaled.** UCDP reports total deaths; civilian/military/children breakdowns are derived by applying historical proportions from the `BASELINE_CONFLICTS` ratios to the live totals. They are estimates, not independently sourced.

5. **OCHA oPt scraping is fragile.** The UN OCHA Gaza page structure changes periodically. If Gaza figures stop updating, the OCHA scraper is the first suspect. Check `scrape_oaca_*()` in `server.py`.

6. **`REACT_APP_` prefix is mandatory.** CRA convention — env vars without this prefix are invisible to the frontend bundle. Adding new config to `frontend/.env`? Prefix it.

7. **No TypeScript.** The frontend is plain JavaScript (`.js` files). Do not introduce TypeScript without project-level discussion — it would require a full CRA migration.

8. **No test suite currently exists.** No `pytest` tests, no Jest tests. When adding significant logic, consider adding inline assertions or simple smoke tests at minimum.

9. **GW codes for UCDP queries.** The `/api/onesided` and `/api/gedevents` endpoints use Gleditsch-Ward country codes, not ISO codes. Common ones: Ukraine = `369`, Yemen = `678,679`, DRC = `490`, Syria = `652`, Sudan = `625`, Ethiopia = `530`, Myanmar = `775`, Gaza/Palestine = `666`.

---

## Pages & Features Quick Reference

| Route | Component | Data Source | Key Feature |
|---|---|---|---|
| `/` | `Dashboard.js` | All API endpoints | Stat cards, globe, heatmap, pie chart, bar chart, conflict table, news ticker |
| `/human-cost` | `HumanCost.js` | `GET /api/treemap` | Zoomable treemap, 200+ conflicts since 1946, colour = recency |
| `/actor-tracker` | `ActorTracker.js` | `GET /api/onesided`, `GET /api/gedevents` | 3-step wizard: configure → actor list → evidence profile |

---

## Production Notes

```bash
# Backend (multi-worker)
uvicorn server:app --host 0.0.0.0 --port 8001 --workers 4

# Frontend (static build)
yarn build
npx serve -s build -p 3000
```

No containerisation or CI/CD pipeline exists yet. `start.sh` / `stop.sh` handle process management for the current deployment model (direct process on host).

---

*Generated by Claude — based on full review of `README.md`, `LOCAL_DEPLOYMENT.md`, and codebase architecture as of March 2026.*