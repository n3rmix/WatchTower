# WatchTower

<div align="center">

**Real-Time Global Conflict Monitoring Dashboard**

A comprehensive, data-driven platform for tracking ongoing global conflicts, casualty statistics, and geopolitical analysis from multiple verified sources.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[Features](#features) • [Tech Stack](#tech-stack) • [Installation](#installation) • [Data Sources](#data-sources) • [API](#api-documentation)

</div>

---

## Overview

WatchTower is a real-time conflict monitoring system that aggregates casualty data, armed group information, and geopolitical news from credible international sources. The platform provides transparent, data-backed insights into 9 major global conflicts affecting millions of people worldwide.

**Total Tracked:** 9 active conflicts | 60+ news articles | Live data from UCDP · OHCHR/OCHA — refreshed every hour

---

## Features

### Core Capabilities

- **Real-Time Statistics Dashboard**
  - Total deaths, civilian, military, and children breakdowns
  - 9 active conflicts with live indicators
  - Breakdown by country, region, and casualty type

- **Comprehensive Conflict Details**
  - Descriptions with historical context for each conflict
  - All conflicting parties (countries, armed groups, militias, factions)
  - Transparent data source attribution per conflict row

- **Interactive Data Visualizations**
  - Spinning WebGL globe with pulsing red/orange markers at all 9 active conflict regions
  - Casualty breakdown pie chart (civilian vs military) — sourced exclusively from UCDP + OHCHR/OCHA
  - Deaths by country bar chart — sourced exclusively from UCDP + OHCHR/OCHA
  - Responsive design with tactical/situation room aesthetic

- **Live News Ticker**
  - 60+ articles from 12+ geopolitical news sources
  - Auto-scrolling marquee with clickable links
  - RSS feeds from Foreign Affairs, Foreign Policy, FT, The Economist, and more

- **Hourly Live Data Refresh**
  - Casualty figures pulled from primary sources every hour via APScheduler
  - Two parallel datasets produced each cycle:
    - **All conflicts** (ACLED → UCDP priority) — stat cards and detail table
    - **Chart conflicts** (UCDP + OHCHR/OCHA only) — Casualty Breakdown and Deaths by Country charts
  - Civilian/military/children figures scaled proportionally from live totals
  - Manual refresh available on demand via the header button

- **Visible Update Timestamps & Source Attribution**
  - Header shows "Sources updated" date+time (UTC), active source names, and countdown to next fetch
  - Amber "Data may be stale" badge appears when the last fetch is >2 hours old
  - Each chart shows a timestamp plus source pills (`UCDP` · `OHCHR/OCHA`) directly below the title
  - Every conflict row in the detail table lists its individual data sources

---

## Tracked Conflicts

| Conflict | Region | Total Deaths | Civilian | Military | Children | Status |
|----------|--------|--------------|----------|----------|----------|--------|
| **Syria** | Middle East | 617,000 | 350,000 | 267,000 | 29,500 | Active |
| **Ethiopia** | Africa | 600,000 | 450,000 | 150,000 | 85,000 | Active |
| **Yemen** | Middle East | 377,000 | 150,000 | 227,000 | 11,500 | Active |
| **Ukraine** | Eastern Europe | 185,000 | 12,500 | 172,500 | 580 | Active |
| **DRC** | Africa | 120,000 | 95,000 | 25,000 | 28,000 | Active |
| **Gaza/Palestine** | Middle East | 47,000 | 42,000 | 5,000 | 16,500 | Active |
| **Sudan** | Africa | 15,000 | 13,500 | 1,500 | 4,200 | Active |
| **Myanmar** | Southeast Asia | 8,500 | 7,200 | 1,300 | 980 | Active |
| **Iran** | Middle East | 2,800 | 2,100 | 700 | 320 | Active |

*Figures above are baseline values; live totals are updated every hour from primary sources.*

---

## Data Sources

All casualty statistics are sourced from verified international organizations and monitoring groups.

### Primary Live Sources (queried every hour)

| Source | Coverage | Authentication |
|--------|----------|----------------|
| **UCDP GED** — Uppsala Conflict Data Program | All conflicts — georeferenced event deaths | `UCDP_API_KEY` env var (required since Feb 2026) |
| **OHCHR** — UN Office of the High Commissioner for Human Rights | Ukraine civilian casualties (scraped) | None |
| **OCHA oPt** — UN Office for Coordination of Humanitarian Affairs | Gaza total deaths (scraped) | None |
| **ACLED** — Armed Conflict Location & Event Data | All conflicts (optional upgrade) | `ACLED_EMAIL` + `ACLED_KEY` env vars |

When ACLED credentials are configured, ACLED takes priority over UCDP for the full conflict dataset (table and stat cards). The **Casualty Breakdown** and **Deaths by Country** charts always use UCDP + OHCHR/OCHA exclusively.

If all live sources fail, hardcoded baseline figures (themselves derived from the above sources at a fixed point in time) are used as a fallback.

### Regional Sources (baseline attribution)
- Syrian Observatory for Human Rights, VDC, SNHR
- Gaza Health Ministry, B'Tselem, PCHR
- Yemen Data Project, Kivu Security Tracker
- Iran Human Rights (IHR), Hengaw
- AAPP (Myanmar), TGHAT (Ethiopia)
- Ghent University, Amnesty International, Congo Research Group

### News Sources (12+ RSS Feeds)
- The Cipher Brief, War on the Rocks
- Foreign Affairs, Foreign Policy
- Financial Times, The Economist
- Chatham House, Gefira
- Geopolitical Economy Report, Geopolitical Monitor
- CFR

---

## Tech Stack

### Backend
- **FastAPI** — Modern Python web framework
- **Motor** — Async MongoDB driver
- **MongoDB** — Document database for conflict/news data
- **APScheduler** — Hourly background data refresh
- **Feedparser** — RSS feed parsing
- **BeautifulSoup4** — Web scraping (OHCHR, OCHA)
- **Aiohttp** — Async HTTP client

### Frontend
- **React 19** — UI library
- **React Router** — Navigation
- **Tailwind CSS** — Utility-first styling
- **Recharts** — Data visualization (pie + bar charts)
- **React Fast Marquee** — News ticker
- **Lucide React** — Icon system
- **Axios** — HTTP client
- **Cobe** — Tiny WebGL spinning globe

### Design System
- **Typography:** Barlow Condensed (headings), Manrope (body), JetBrains Mono (data)
- **Theme:** Dark mode tactical/situation room aesthetic
- **Color Palette:** Red (#dc2626) primary, zinc grays
- **Layout:** Bento grid, sharp edges, corner accents

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

**3. Run as background daemons** (survives SSH disconnection)
```bash
# from the repo root
./start.sh      # start backend + frontend in the background
./stop.sh       # stop both

# live logs
tail -f logs/backend.log
tail -f logs/frontend.log
```

- Frontend → http://localhost:3000
- Backend API → http://localhost:8001
- API docs → http://localhost:8001/docs

---

## API Documentation

### `GET /api/conflicts`
All conflict records (ACLED → UCDP priority). Used by the detail table and stat cards.

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
    "description": "...",
    "countries_involved": ["Ukraine", "Russia"],
    "parties_involved": ["Ukrainian Armed Forces", "Russian Armed Forces"],
    "data_sources": ["UCDP GED", "OHCHR", "UN OCHA"],
    "status": "active"
  }
]
```

### `GET /api/chart-conflicts`
Conflict records built from **UCDP + OHCHR/OCHA only** (no ACLED). Used by the Deaths by Country chart.

### `GET /api/stats`
Aggregated casualty statistics from the full conflict dataset.

```json
{
  "total_deaths": 1972300,
  "civilian_deaths": 1122300,
  "military_deaths": 850000,
  "children_deaths": 176580,
  "active_conflicts": 9,
  "total_conflicts": 9,
  "last_fetch_at": "2026-03-18T14:00:00+00:00",
  "sources": ["UCDP", "OHCHR/OCHA"]
}
```

### `GET /api/chart-stats`
Aggregated statistics from the UCDP + OHCHR/OCHA dataset only. Used by the Casualty Breakdown chart.

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

`sources` reflects all sources used for the full dataset; `chart_sources` reflects only the UCDP + OHCHR/OCHA subset shown on charts.

### `GET /api/news`
Aggregated news articles from RSS feeds.

### `POST /api/refresh`
Immediately triggers a full data refresh from all primary sources.

---

## Data Refresh Cycle

```
Startup → Initial fetch from primary sources
    ↓
Every hour (APScheduler):
    ├─ Query UCDP GED API (gedevents endpoint, x-ucdp-access-token header)
    │     └─ Total deaths per country (paginated)
    ├─ Query ACLED API (if ACLED_EMAIL + ACLED_KEY are set)
    │     └─ Total fatalities per country
    ├─ Scrape OHCHR (Ukraine civilian death count)
    ├─ Scrape OCHA oPt (Gaza total death count)
    ├─ Fetch RSS feeds (12 sources, ~60 articles)
    ├─ Build two conflict datasets:
    │     ├─ conflicts       → ACLED > UCDP priority (table + stat cards)
    │     └─ chart_conflicts → UCDP + OHCHR/OCHA only (charts)
    ├─ Proportionally scale civilian/military/children from live totals
    ├─ Persist both datasets to MongoDB
    └─ Store fetch timestamp, sources, chart_sources in system_metadata

Frontend polls every 5 min:
    ├─ GET /api/conflicts       → detail table
    ├─ GET /api/chart-conflicts → Deaths by Country chart
    ├─ GET /api/stats           → stat cards
    ├─ GET /api/chart-stats     → Casualty Breakdown chart
    ├─ GET /api/news            → news ticker
    └─ GET /api/last-update     → header timestamps + source pills
```

---

## Design Philosophy

WatchTower follows a **situation room aesthetic** inspired by military command centers and intelligence briefing rooms:

- **Dark Mode First** — Reduces eye strain for extended monitoring sessions
- **Data Density** — Maximum information in minimal space
- **Sharp Edges** — No rounded corners; tactical and precise
- **Monospace Typography** — Clear, unambiguous data display
- **Red Accent** — Urgency and attention to critical information
- **Blinking LIVE Indicators** — Real-time status awareness

---

## Contributing

Contributions are welcome. Areas for improvement:

**High Priority**
- [ ] Historical trend charts
- [x] World map / globe visualization
- [ ] Conflict timeline view

**Medium Priority**
- [ ] Export functionality (PDF/CSV)
- [ ] Advanced filtering (region, date, severity)
- [ ] Data source confidence indicators
- [ ] Multi-language support

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
