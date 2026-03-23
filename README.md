# WatchTower

<div align="center">

**Real-Time Global Conflict Monitoring Dashboard**

A comprehensive, data-driven platform for tracking ongoing global conflicts, casualty statistics, and geopolitical analysis from multiple verified sources.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[Features](#features) • [Tech Stack](#tech-stack) • [Installation](#installation) • [Data Sources](#data-sources) • [API](#api-documentation)



</div>

---

## Overview

WatchTower is a real-time conflict monitoring system that aggregates casualty data, armed group information, and geopolitical news from credible international sources. The platform provides transparent, data-backed insights into 9 major global conflicts affecting millions of people worldwide — plus a full historical perspective across every UCDP-tracked conflict since 1946.

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
  - Spinning WebGL globe with pulsing markers at all 9 active conflict regions, alongside a **casualty heatmap** — a 9-conflict × 4-metric grid (Total / Civilian / Military / Children) with cells coloured black→red by column-normalised intensity and hover tooltips showing raw counts and percentage of column maximum
  - Casualty breakdown pie chart (civilian vs military) — sourced exclusively from UCDP + OHCHR/OCHA
  - Deaths by country bar chart — sourced exclusively from UCDP + OHCHR/OCHA
  - Responsive design with tactical/situation room aesthetic

- **Human Cost Treemap** (`/human-cost`)
  - Zoomable treemap spanning **every UCDP-tracked conflict since 1946** (~200+ conflicts across 5 world regions)
  - **Tile area ∝ cumulative `bd_best` battle-deaths** since each conflict's onset — giving an immediate proportional view of global suffering
  - **Drill-down:** top-level tiles are world regions (Africa, Asia, Middle East, Europe, Americas); click any region to zoom into its individual conflicts at full canvas size; breadcrumb + back button to return
  - **Colour temperature** encodes recency — cool blue for conflicts last active decades ago, deep red for conflicts with deaths recorded in 2023–24
  - Floating hover tooltip showing conflict name, location, cumulative deaths, and last recorded year
  - Colour-scale legend with year labels rendered beneath the chart

- **Actor Accountability Tracker** (`/actor-tracker`)
  - Dedicated view for One-Sided Violence perpetrator profiling backed by the UCDP datasets
  - **Step 1 — Configure:** Select a country (all 8 UCDP-covered conflicts) and any combination of years (2015–2024 multi-select)
  - **Step 2 — Actors:** Queries `GET /api/onesided` and lists every perpetrator found in the UCDP One-Sided Violence dataset for that country/year range — actor name, UCDP `actor_id`, total civilian deaths, uncertainty range, and years active
  - **Step 3 — Profile:** Click any actor to cross-reference against `GET /api/gedevents` (`TypeOfViolence=3`) and generate a full accountability profile:
    - Summary stats: GED event count, total deaths, civilian deaths, verified source organisations
    - Per-year deaths bar chart (Recharts)
    - Paginated evidence table: date, location (ADM1/ADM2), best/low/high estimates, civilian deaths, source office, and clickable `source_article` links — all fields required for CTI advisories, sanctions screening, and ICC referral documentation

- **Live News Ticker**
  - 60+ articles from 12+ geopolitical news sources
  - Auto-scrolling marquee with clickable links
  - RSS feeds from Foreign Affairs, Foreign Policy, FT, The Economist, and more

- **Hourly Live Data Refresh**
  - Casualty figures pulled from primary sources every hour via APScheduler
  - Three datasets produced each cycle:
    - **All conflicts** (ACLED → UCDP priority) — stat cards and detail table
    - **Chart conflicts** (UCDP + OHCHR/OCHA only) — Casualty Breakdown and Deaths by Country charts
    - **Treemap data** — full UCDP battledeaths dataset aggregated by conflict, cached for the Human Cost page
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

### `GET /api/treemap`
Full UCDP battledeaths dataset (1946–present) aggregated by conflict for the Human Cost treemap. Served from an in-memory cache that is refreshed hourly; first request triggers a live fetch if the cache is cold.

```json
{
  "regions": [
    {
      "name": "Africa",
      "total_deaths": 3500000,
      "last_year": 2023,
      "conflicts": [
        {
          "conflict_id": 336,
          "name": "Ethiopia (OAU)",
          "location": "Ethiopia",
          "region": "Africa",
          "total_deaths": 1500000,
          "last_year": 2022
        }
      ]
    }
  ],
  "total_conflicts": 245,
  "total_deaths": 8500000,
  "year_range": [1946, 2023],
  "fetched_at": "2026-03-23T10:00:00+00:00"
}
```

Regions are sorted by `total_deaths` descending; conflicts within each region are likewise sorted. `last_year` is the most recent year in which `bd_best > 0` for that conflict or region, and drives the cool→warm colour scale on the treemap.

### `GET /api/onesided?gwno=&years=`
Queries the **UCDP One-Sided Violence dataset** for a country and multi-year range. Returns actors who perpetrate systematic violence against civilians, aggregated across all requested years.

| Parameter | Description |
|-----------|-------------|
| `gwno` | Gleditsch-Ward code(s), comma-separated (e.g. `369` for Ukraine, `678,679` for Yemen) |
| `years` | Comma-separated year integers, e.g. `2020,2021,2022` |

```json
{
  "total_actors": 3,
  "actors": [
    {
      "actor_id": "1234",
      "actor_name": "Russian Armed Forces",
      "years_active": [2022, 2023],
      "total_deaths": 8200,
      "deaths_low": 6100,
      "deaths_high": 10400,
      "per_year": { "2022": 5300, "2023": 2900 }
    }
  ]
}
```

### `GET /api/gedevents?actor=&gwno=&years=`
Cross-references an actor (identified from `/api/onesided`) against the **UCDP Georeferenced Event Dataset** filtered to `TypeOfViolence=3` (one-sided violence). Returns up to 1 000 event records sorted newest-first, deduplicated by event ID, with full source traceability for CTI advisories and compliance reporting.

| Parameter | Description |
|-----------|-------------|
| `actor` | Actor name string (`side_a` from the onesided dataset) |
| `gwno` | Optional GW code(s) to narrow by country |
| `years` | Optional comma-separated years |

```json
{
  "total_events": 47,
  "total_deaths": 1830,
  "civilian_deaths": 1830,
  "source_offices": ["OHCHR", "UN News", "Reuters"],
  "events": [
    {
      "id": "12345",
      "date_start": "2023-04-12",
      "date_end": "2023-04-12",
      "adm_1": "Kharkivska",
      "adm_2": "Kharkiv",
      "best": 12,
      "low": 9,
      "high": 15,
      "deaths_civilians": 12,
      "source_office": "OHCHR",
      "source_article": "https://...",
      "source_headline": "UN verifies 12 civilian deaths in Kharkiv strike"
    }
  ]
}
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
    ├─ Store fetch timestamp, sources, chart_sources in system_metadata
    └─ Rebuild treemap cache (UCDP battledeaths, all conflicts 1946–present)

Frontend polls every 5 min (Dashboard):
    ├─ GET /api/conflicts       → detail table
    ├─ GET /api/chart-conflicts → Deaths by Country chart
    ├─ GET /api/stats           → stat cards
    ├─ GET /api/chart-stats     → Casualty Breakdown chart
    ├─ GET /api/news            → news ticker
    └─ GET /api/last-update     → header timestamps + source pills

Human Cost Treemap (/human-cost) — on page load:
    └─ GET /api/treemap
          └─ UCDP battledeaths/25.1 (paginated, all years)
               → aggregated by conflict_id (sum bd_best, max year, region)
               → grouped into 5 UCDP geographic regions
               → returned as sorted region + conflict tree

Actor Accountability Tracker (/actor-tracker) — on demand:
    ├─ GET /api/onesided?gwno=&years=
    │     └─ UCDP One-Sided Violence dataset → actor list
    └─ GET /api/gedevents?actor=&gwno=&years=
          └─ UCDP GED (TypeOfViolence=3) → event-level evidence table
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
- [x] Casualty heatmap (conflicts × categories)
- [x] Actor accountability tracker (UCDP One-Sided Violence + GED cross-reference)
- [x] Human Cost treemap — all UCDP conflicts 1946–present, proportional by cumulative deaths
- [ ] Conflict timeline view

**Medium Priority**
- [ ] Export functionality (PDF/CSV) — especially useful for Actor Tracker compliance reports
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
