# WatchTower

<div align="center">

**Real-Time Global Conflict Death Counter**

A data-driven platform tracking ongoing global conflict death tolls in real time, interpolated from verified international sources.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[Features](#features) • [Tech Stack](#tech-stack) • [Installation](#installation) • [Data Sources](#data-sources) • [API](#api-documentation)

</div>

---

## Overview

WatchTower is a real-time conflict death counter that aggregates casualty data from credible international sources and projects live estimates forward using conflict-specific daily death rates. It tracks 14 conflicts — active and recently concluded — giving an honest, continuously updated picture of the human cost of war.

**Total Tracked:** 14 conflicts | Live estimates interpolated from verified baselines | Data from UCDP · ACLED · UN OHCHR · OCHA — refreshed every hour

---

## Features

### Live Death Counter

- **Real-time hero counter** — total estimated deaths across all tracked conflicts, animated to the second using per-conflict daily death rates
- **Children counter** — running estimate of child deaths across all conflicts, sourced from UNICEF, Save the Children, and conflict-specific monitors
- **Stat pills** — Deaths in 2026 (YTD), active conflicts, global deaths per day
- **Rate indicators** — deaths per hour and deaths per minute

### GDELT Alert Ticker

- Breaking geopolitical headlines pulled from GDELT DOC 2.0
- Auto-scrolling feed of media-detected conflict escalation signals

### Children Breakdown

- Per-conflict child death estimates with horizontal bar chart scaled to the highest-casualty conflict
- Child daily rate used to interpolate forward from the verified baseline figure

### Conflict Grid

- One card per tracked conflict: flag, region, estimated total deaths, progress bar relative to highest-toll conflict, daily rate, start date, methodology note, and source link
- Sorted by death toll descending

### Source Transparency

- Header shows "Sources updated" timestamp (UTC), active data source names, and a live countdown to the next hourly fetch
- Amber "Data may be stale" badge when last fetch is >2 hours old
- Every conflict card links directly to its primary source

### Hourly Live Data Refresh

- Casualty figures pulled from primary sources every hour via APScheduler
- API figures override hardcoded baselines only when the API value is higher — prevents regression when methodologies differ (e.g. Sudan: API 70 k vs counter 150 k)
- Manual refresh available via the header button

---

## Tracked Conflicts

| Conflict | Region | Status |
|----------|--------|--------|
| Ukraine–Russia War | Europe | Active |
| Sudan Civil War | Africa | Active |
| Gaza — Palestine | Middle East | Active |
| Myanmar Civil War | Asia | Active |
| Nigeria — Multi-Conflict | Africa | Active |
| Syria | Middle East | Active |
| Somalia — al-Shabaab | Africa | Active |
| Haiti — Gang Violence | Americas | Active |
| Ethiopia (Tigray & Amhara) | Africa | Active |
| Mexico — Cartel Wars | Americas | Active |
| Lebanon — Israel War | Middle East | Active |
| Iran War (US–Israel) | Middle East | Active |
| Twelve-Day War (Iran–Israel) | Middle East | Ended |
| Iran — Protest Crackdown | Middle East | Ended |

*Baselines anchored April 1, 2026. Live totals interpolated forward using per-conflict daily death rates.*

---

## Data Sources

### Primary Live Sources (queried every hour)

| Source | Coverage | Authentication |
|--------|----------|----------------|
| **UCDP GED** — Uppsala Conflict Data Program | All conflicts — georeferenced event deaths | `UCDP_API_KEY` env var (required since Feb 2026) |
| **OHCHR** — UN Office of the High Commissioner for Human Rights | Ukraine civilian casualties (scraped) | None |
| **OCHA oPt** — UN Office for Coordination of Humanitarian Affairs | Gaza total deaths (scraped) | None |
| **ACLED** — Armed Conflict Location & Event Data | All conflicts (optional upgrade) | `ACLED_EMAIL` + `ACLED_KEY` env vars |
| **GDELT DOC 2.0** — Global Database of Events, Language and Tone | Breaking conflict headlines | None (public API) |

When ACLED credentials are configured, ACLED takes priority over UCDP for the full conflict dataset. The API figure overrides the hardcoded baseline only when it is higher than the projected hardcoded estimate at the snapshot date.

If all live sources fail, hardcoded baseline figures (derived from the above sources at a fixed point in time) are used as a fallback.

### Baseline Attribution (per-conflict)

- UNICEF, Save the Children, AAPP (children figures)
- Lebanese Health Ministry, WHO EMRO, UNIFIL (Lebanon)
- Gaza Health Ministry, WHO (Gaza)
- HRANA, Iran Human Rights (Iran)
- INEGI, ACLED (Mexico)
- BINUH, ACLED (Haiti)
- PMC/NIH Tigray Study, HRW (Ethiopia)

---

## Tech Stack

### Backend
- **FastAPI** — Python web framework
- **Motor** — Async MongoDB driver
- **MongoDB** — Document database for conflict/news data
- **APScheduler** — Hourly background data refresh
- **Feedparser** — RSS feed parsing
- **BeautifulSoup4** — Web scraping (OHCHR, OCHA)
- **Aiohttp** — Async HTTP client for UCDP / ACLED / GDELT DOC 2.0

### Frontend
- **React 19** — UI library
- **Tailwind CSS** — Utility-first styling
- **React Fast Marquee** — GDELT alert ticker
- **Lucide React** — Icon system
- **Axios** — HTTP client

### Design System
- **Typography:** Barlow Condensed (headings), Manrope (body), JetBrains Mono (data)
- **Theme:** Dark mode tactical/situation room aesthetic
- **Color Palette:** Red (`#dc2626`) primary, zinc grays
- **Layout:** Sharp edges, no rounded corners, maximum data density

---

## Installation

For the complete step-by-step guide including MongoDB setup and troubleshooting, see **[LOCAL_DEPLOYMENT.md](LOCAL_DEPLOYMENT.md)**.

### Prerequisites
- Node.js 18+ and Yarn
- Python 3.11+
- MongoDB (local or cloud)
- UCDP API access token ([request free at ucdp.uu.se](https://ucdp.uu.se))

### Quick Setup

**1. Backend**
```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# Create .env — see LOCAL_DEPLOYMENT.md for all options
cat > .env << 'EOF'
MONGO_URL=mongodb://localhost:27017
DB_NAME=conflict_tracker
CORS_ORIGINS=*
UCDP_API_KEY=your-ucdp-access-token
EOF
```

**2. Frontend**
```bash
cd frontend
yarn install
echo "REACT_APP_BACKEND_URL=http://localhost:8001" > .env
```

**3. Run**
```bash
# Background daemons (from repo root)
./start.sh      # start backend + frontend
./stop.sh       # stop both

# Or manually
cd backend && source venv/bin/activate
export OPENSSL_CONF="$(pwd)/openssl_atlas.cnf"
python -m uvicorn server:app --reload --host 0.0.0.0 --port 8001

cd frontend && yarn start

# Logs
tail -f logs/backend.log
tail -f logs/frontend.log
```

- Frontend → http://localhost:3000
- Backend API → http://localhost:8001
- API docs → http://localhost:8001/docs

---

## API Documentation

### `GET /api/conflicts`
All conflict records (ACLED → UCDP priority). Used to override hardcoded baselines when the API figure is higher.

```json
[
  {
    "id": "uuid",
    "country": "Ukraine",
    "region": "Eastern Europe",
    "total_deaths": 185000,
    "civilian_deaths": 12500,
    "military_deaths": 172500,
    "children_deaths": 580,
    "data_sources": ["UCDP GED", "OHCHR", "UN OCHA"],
    "status": "active"
  }
]
```

### `GET /api/last-update`
Metadata about the most recent data fetch.

```json
{
  "fetched_at": "2026-03-18T14:00:00+00:00",
  "sources": ["UCDP", "OHCHR/OCHA"],
  "chart_sources": ["UCDP", "OHCHR/OCHA"],
  "next_fetch_in_minutes": 47
}
```

### `GET /api/news`
Aggregated news articles from RSS feeds (~60 articles, 12+ sources).

### `POST /api/refresh`
Immediately triggers a full data refresh from all primary sources.

---

## Data Refresh Cycle

```
Startup → Initial fetch from primary sources
    ↓
Every hour (APScheduler):
    ├─ Query UCDP GED API (x-ucdp-access-token header)
    ├─ Query ACLED API (if ACLED_EMAIL + ACLED_KEY are set)
    ├─ Scrape OHCHR (Ukraine civilian death count)
    ├─ Scrape OCHA oPt (Gaza total death count)
    ├─ Fetch RSS feeds (12+ sources, ~60 articles)
    ├─ Build conflict dataset (ACLED > UCDP priority)
    ├─ Persist to MongoDB
    └─ Store fetch timestamp + sources in system_metadata

Counter page (/) — on mount + every 60s check:
    ├─ GET /api/conflicts    → baseline override (API wins only if higher)
    └─ GET /api/last-update  → "sources updated" timestamp

  Between fetches: per-conflict daily rates tick the counter forward
  every second via requestAnimationFrame / setInterval.
```

---

## Design Philosophy

WatchTower follows a **situation room aesthetic** inspired by military command centers:

- **Dark Mode First** — Reduces eye strain for extended monitoring sessions
- **Data Density** — Maximum information in minimal space
- **Sharp Edges** — No rounded corners; tactical and precise
- **Monospace Typography** — Clear, unambiguous data display
- **Red Accent** — Urgency and attention to critical information

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

## Disclaimer

1. **Data Accuracy:** Casualty figures are estimates based on available data from multiple sources. Actual numbers may vary due to reporting challenges in conflict zones.
2. **Verification:** This platform aggregates data from third-party sources. Cross-reference with primary sources for critical decisions.
3. **Neutrality:** This dashboard aims to present data objectively without political bias. Inclusion of parties/groups does not imply endorsement or condemnation.
4. **Humanitarian Focus:** The primary goal is awareness and transparency to support humanitarian efforts and informed decision-making.
5. **Sensitivity:** Content includes discussion of violence and casualties. Viewer discretion advised.

---

<div align="center">

**Made with purpose to increase transparency and awareness of global conflicts**

</div>
