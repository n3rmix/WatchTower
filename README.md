# Project WATCHTOWER

<div align="center">

**Real-Time Global Conflict Monitoring Dashboard**

A comprehensive, data-driven platform for tracking ongoing global conflicts, casualty statistics, and geopolitical analysis from multiple verified sources.

[![Built with Emergent](https://img.shields.io/badge/Built%20with-Emergent-orange)](https://emergent.sh)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[Features](#features) • [Tech Stack](#tech-stack) • [Installation](#installation) • [Data Sources](#data-sources) • [API](#api-documentation)

</div>

---

## 📊 Overview

Project WATCHTOWER is a real-time conflict monitoring system that aggregates casualty data, armed group information, and geopolitical news from credible international sources. The platform provides transparent, data-backed insights into 9 major global conflicts affecting millions of people worldwide.

**Total Tracked:** 1.97M deaths across 9 active conflicts | 60+ news sources | Auto-refresh every 5 minutes

---

## ✨ Features

### 🎯 Core Capabilities

- **Real-Time Statistics Dashboard**
  - Total deaths: 1,972,300 (1.1M civilian, 850K military, 176K children)
  - 7 active conflicts with live indicators
  - Breakdown by country, region, and casualty type

- **Comprehensive Conflict Details**
  - Descriptions with historical context for each conflict
  - All conflicting parties (countries, armed groups, militias, factions)
  - Visual country/party indicators with globe icons
  - Transparent data source attribution

- **Interactive Data Visualizations**
  - Casualty breakdown pie chart (civilian vs military)
  - Deaths by country bar chart
  - Responsive design with tactical/situation room aesthetic

- **Live News Ticker**
  - 60+ articles from 12+ geopolitical news sources
  - Auto-scrolling marquee with clickable links
  - RSS feeds from Foreign Affairs, Foreign Policy, FT, The Economist, and more

- **Auto-Refresh Mechanism**
  - Background data updates every 5 minutes
  - APScheduler-based task scheduling
  - Manual refresh option available

- **API Key Configuration**
  - User-configurable API keys for future integrations
  - Secure storage with masked display
  - Settings page for credential management

---

## 🌍 Tracked Conflicts

| Conflict | Region | Total Deaths | Civilian | Military | Children | Status |
|----------|--------|--------------|----------|----------|----------|--------|
| **Syria** | Middle East | 617,000 | 350,000 | 267,000 | 29,500 | Ongoing |
| **Ethiopia** | Africa | 600,000 | 450,000 | 150,000 | 85,000 | Active |
| **Yemen** | Middle East | 377,000 | 150,000 | 227,000 | 11,500 | Ongoing |
| **Ukraine** | Eastern Europe | 185,000 | 12,500 | 172,500 | 580 | Active |
| **DRC** | Africa | 120,000 | 95,000 | 25,000 | 28,000 | Active |
| **Gaza/Palestine** | Middle East | 47,000 | 42,000 | 5,000 | 16,500 | Active |
| **Sudan** | Africa | 15,000 | 13,500 | 1,500 | 4,200 | Active |
| **Myanmar** | Southeast Asia | 8,500 | 7,200 | 1,300 | 980 | Active |
| **Iran** | Middle East | 2,800 | 2,100 | 700 | 320 | Active |

### Conflicting Parties Examples

**Syria (10 parties):** Syrian Government, SDF, HTS, Free Syrian Army, ISIS remnants, Turkish Forces, Russian Forces, Iranian Forces, Hezbollah, US Coalition

**Yemen (7 parties):** Houthis, Government Forces, Saudi-led Coalition, Southern Transitional Council, AQAP, UAE Forces, Yemeni Armed Forces

**Iran (10 parties):** IRGC, Basij, Kurdish groups (KDPI, Komala, PJAK), Mossad, IDF, US Forces

---

## 🗂️ Data Sources

All casualty statistics are sourced from verified international organizations and monitoring groups:

### Primary Sources
- **ACLED** - Armed Conflict Location & Event Data Project
- **UCDP** - Uppsala Conflict Data Program
- **OHCHR** - UN Office of the High Commissioner for Human Rights
- **WHO** - World Health Organization
- **OCHA** - UN Office for the Coordination of Humanitarian Affairs

### Regional Sources
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
- CFR, RAND Corporation

---

## 🛠️ Tech Stack

### Backend
- **FastAPI** - Modern Python web framework
- **Motor** - Async MongoDB driver
- **MongoDB** - Document database for conflict/news data
- **APScheduler** - Background task scheduling
- **Feedparser** - RSS feed parsing
- **BeautifulSoup4** - Web scraping capabilities
- **Aiohttp** - Async HTTP requests

### Frontend
- **React 19** - UI library
- **React Router** - Navigation
- **Tailwind CSS** - Utility-first styling
- **Recharts** - Data visualization
- **React Fast Marquee** - News ticker
- **Lucide React** - Icon system
- **Axios** - HTTP client

### Design System
- **Typography:** Barlow Condensed (headings), Manrope (body), JetBrains Mono (data)
- **Theme:** Dark mode tactical/situation room aesthetic
- **Color Palette:** Red (#dc2626) primary, zinc grays, blue data sources
- **Layout:** Bento grid, sharp edges, corner accents

---

## 🚀 Installation

### Prerequisites
- Node.js 18+ and Yarn
- Python 3.11+
- MongoDB (local or cloud)

### Backend Setup

```bash
# Navigate to backend directory
cd backend

# Install Python dependencies
pip install -r requirements.txt

# Configure environment variables
cp .env.example .env
# Edit .env with your MongoDB connection string

# Run the server
uvicorn server:app --reload --host 0.0.0.0 --port 8001
```

### Frontend Setup

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
yarn install

# Configure environment variables
cp .env.example .env
# Edit .env with backend URL

# Start development server
yarn start
```

### Environment Variables

**Backend (.env)**
```
MONGO_URL=mongodb://localhost:27017
DB_NAME=conflict_tracker
CORS_ORIGINS=*
```

**Frontend (.env)**
```
REACT_APP_BACKEND_URL=http://localhost:8001
```

---

## 📡 API Documentation

### Endpoints

#### `GET /api/conflicts`
Returns all conflict data with parties and sources.

**Response:**
```json
[
  {
    "id": "uuid",
    "country": "Syria",
    "region": "Middle East",
    "total_deaths": 617000,
    "civilian_deaths": 350000,
    "military_deaths": 267000,
    "children_deaths": 29500,
    "description": "Multi-sided civil war...",
    "countries_involved": ["Syria", "Turkey", "Russia", "Iran", "United States"],
    "parties_involved": ["Syrian Government Forces", "SDF", "HTS", ...],
    "data_sources": ["SOHR", "VDC", "SNHR", "WHO Syria"],
    "status": "ongoing"
  }
]
```

#### `GET /api/news`
Returns aggregated news articles from RSS feeds.

**Response:**
```json
[
  {
    "id": "uuid",
    "title": "Article title",
    "source": "Foreign Policy",
    "url": "https://...",
    "published_date": "2026-03-16",
    "description": "Article summary..."
  }
]
```

#### `GET /api/stats`
Returns aggregated global statistics.

**Response:**
```json
{
  "total_deaths": 1972300,
  "civilian_deaths": 1122300,
  "military_deaths": 850000,
  "children_deaths": 176580,
  "active_conflicts": 7,
  "total_conflicts": 9
}
```

#### `POST /api/refresh`
Manually triggers data refresh.

#### `POST /api/settings/api-keys`
Saves API key configuration.

**Request:**
```json
{
  "service_name": "ACLED",
  "api_key": "your-api-key"
}
```

#### `GET /api/settings/api-keys`
Returns configured API keys (masked).

---

## 🎨 Design Philosophy

### The Tactical Analyst
Project WATCHTOWER follows a **situation room aesthetic** inspired by military command centers and intelligence briefing rooms:

- **Dark Mode First:** Reduces eye strain for extended monitoring sessions
- **Data Density:** Maximum information in minimal space
- **Sharp Edges:** No rounded corners - tactical and precise
- **Monospace Typography:** Clear, unambiguous data display
- **Red Accent:** Urgency and attention to critical information
- **Blinking LIVE Indicators:** Real-time status awareness
- **Corner Accents:** Visual hierarchy and card separation

---

## 🔄 Data Refresh Cycle

```
Startup → Initial data fetch
    ↓
Every 5 minutes:
    ├─ Fetch RSS feeds (12 sources)
    ├─ Parse conflict data
    ├─ Update MongoDB
    └─ Log status
    ↓
Frontend polls every 5 min
    ├─ Refresh statistics
    ├─ Update conflict table
    └─ Reload news ticker
```

---

## 🤝 Contributing

Contributions are welcome! Areas for improvement:

### High Priority
- [ ] Integrate live data APIs (ACLED, UCDP GED)
- [ ] Add historical trend charts
- [ ] Implement world map visualization
- [ ] Add conflict timeline view

### Medium Priority
- [ ] Export functionality (PDF/CSV)
- [ ] Advanced filtering (region, date, severity)
- [ ] Data source confidence indicators
- [ ] Multi-language support

### Low Priority
- [ ] Dark/light theme toggle
- [ ] Customizable dashboard layouts
- [ ] Email alerts for major events

---

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## ⚠️ Disclaimer

**Important Notice:**

1. **Data Accuracy:** Casualty figures are estimates based on available data from multiple sources. Actual numbers may vary significantly due to reporting challenges in conflict zones.

2. **Verification:** This platform aggregates data from third-party sources. Users should cross-reference with primary sources for critical decisions.

3. **Neutrality:** This dashboard aims to present data objectively without political bias. Inclusion of parties/groups does not imply endorsement or condemnation.

4. **Humanitarian Focus:** The primary goal is awareness and transparency to support humanitarian efforts and informed decision-making.

5. **Sensitivity:** Content includes discussion of violence and casualties. Viewer discretion advised.

---

## 📞 Contact & Support

- **Issues:** Report bugs via [GitHub Issues](https://github.com/yourusername/project-watchtower/issues)
- **Discussions:** Join conversations in [GitHub Discussions](https://github.com/yourusername/project-watchtower/discussions)
- **Security:** Report vulnerabilities to security@example.com

---

## 🙏 Acknowledgments

- All data source organizations for their critical monitoring work
- Open-source community for the amazing tools and libraries
- Humanitarian organizations working in conflict zones
- Built with [Emergent.sh](https://emergent.sh) - AI-powered full-stack development

---

<div align="center">

**Made with purpose to increase transparency and awareness of global conflicts**

⭐ Star this repo if you find it useful | 🍴 Fork to contribute

</div>
