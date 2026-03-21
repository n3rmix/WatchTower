# Local Deployment Guide

Complete guide to running WatchTower on your local machine.

---

## Prerequisites

### Required Software

1. **Node.js** (v18 or higher)
   - Download from [nodejs.org](https://nodejs.org/)
   - Verify: `node --version`

2. **Yarn** (package manager)
   ```bash
   npm install -g yarn
   yarn --version
   ```

3. **Python** (3.11 or higher)
   - Download from [python.org](https://www.python.org/)
   - Verify: `python3 --version`

4. **MongoDB** — see setup options below

### API Keys

| Key | Required | Where to get it |
|-----|----------|----------------|
| `UCDP_API_KEY` | **Yes** | Request free at [ucdp.uu.se](https://ucdp.uu.se) — email the UCDP team describing your use case |
| `ACLED_EMAIL` + `ACLED_KEY` | No (optional upgrade) | Register free at [acleddata.com](https://acleddata.com) |

---

## Database Setup (MongoDB)

### Option 1: Local MongoDB (recommended for development)

#### macOS (Homebrew)

```bash
brew tap mongodb/brew
brew install mongodb-community@7.0
brew services start mongodb-community@7.0
mongosh --eval "db.version()"   # verify
```

#### Ubuntu / Debian

```bash
wget -qO - https://www.mongodb.org/static/pgp/server-7.0.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu $(lsb_release -cs)/mongodb-org/7.0 multiverse" \
  | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt-get update && sudo apt-get install -y mongodb-org
sudo systemctl start mongod && sudo systemctl enable mongod
mongosh --eval "db.version()"   # verify
```

#### Windows

1. Download the MongoDB Community Server installer from [mongodb.com](https://www.mongodb.com/try/download/community)
2. Run the installer — choose "Complete" and install as a Windows Service
3. Verify in PowerShell: `mongosh --eval "db.version()"`

#### Docker (cross-platform)

```bash
docker run -d \
  --name mongodb \
  -p 27017:27017 \
  -v mongodb_data:/data/db \
  mongo:7.0

# verify
docker exec -it mongodb mongosh
```

### Option 2: MongoDB Atlas (cloud, free tier)

1. Create a free account at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register)
2. Create an M0 (free) cluster
3. Click **Connect → Connect your application** and copy the connection string:
   ```
   mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/watchtower.git
cd watchtower
```

### 2. Backend setup

```bash
cd backend

# Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate        # macOS/Linux
# venv\Scripts\activate         # Windows

# Install dependencies
pip install -r requirements.txt

# Create .env
cat > .env << 'EOF'
# MongoDB
MONGO_URL=mongodb://localhost:27017
DB_NAME=conflict_tracker

# CORS (allow all origins in development)
CORS_ORIGINS=*

# UCDP access token — required for live data (request free at ucdp.uu.se)
UCDP_API_KEY=your-ucdp-access-token

# ACLED credentials — optional, improves data quality for the detail table
# ACLED_EMAIL=your@email.com
# ACLED_KEY=your-acled-api-key
EOF
```

If using MongoDB Atlas, replace `MONGO_URL` with your Atlas connection string.

### 3. Frontend setup

```bash
cd frontend
yarn install

cat > .env << 'EOF'
REACT_APP_BACKEND_URL=http://localhost:8001
EOF
```

---

## Running the Application

### Start the backend (Terminal 1)

```bash
cd backend
source venv/bin/activate        # macOS/Linux
python -m uvicorn server:app --reload --host 0.0.0.0 --port 8001
```

Expected startup output:

```
INFO:     Uvicorn running on http://0.0.0.0:8001
INFO:     Application startup complete.
INFO:     Starting hourly data refresh…
INFO:     UCDP fetch complete: 9/9 countries updated
INFO:     Stored 9 conflict records (sources: UCDP, OHCHR/OCHA)
INFO:     Stored 9 chart-only records (sources: UCDP, OHCHR/OCHA)
INFO:     Stored ~60 news articles
```

Backend is available at `http://localhost:8001`.

### Start the frontend (Terminal 2)

```bash
cd frontend
yarn start
```

The app opens automatically at `http://localhost:3000`.

---

## Verify the Installation

### Check the backend API

```bash
curl http://localhost:8001/api/
curl http://localhost:8001/api/stats
curl http://localhost:8001/api/last-update
```

### Check the database

```bash
mongosh
use conflict_tracker
show collections
# Expected: chart_conflicts, conflicts, news_articles, system_metadata
db.conflicts.countDocuments()        # → 9
db.chart_conflicts.countDocuments()  # → 9
db.news_articles.countDocuments()    # → ~60
exit
```

### Check the frontend

Open `http://localhost:3000`. You should see:

- Header with "Sources updated" timestamp and `UCDP · OHCHR/OCHA` source pills
- Four stat cards (Total Deaths, Civilian, Military, Children)
- Spinning WebGL globe with 9 pulsing red markers at conflict regions
- Active conflicts counter (9)
- Casualty Breakdown pie chart with `UCDP · OHCHR/OCHA` source pills
- Deaths by Country bar chart with `UCDP · OHCHR/OCHA` source pills
- Conflict detail table (9 rows)
- Scrolling news ticker

---

## Environment Variables Reference

### Backend (`backend/.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONGO_URL` | Yes | — | MongoDB connection string |
| `DB_NAME` | Yes | — | Database name (e.g. `conflict_tracker`) |
| `CORS_ORIGINS` | No | `*` | Comma-separated allowed origins |
| `UCDP_API_KEY` | Yes | — | UCDP access token (`x-ucdp-access-token` header) |
| `ACLED_EMAIL` | No | — | ACLED account email (optional higher-quality data) |
| `ACLED_KEY` | No | — | ACLED API key |

### Frontend (`frontend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `REACT_APP_BACKEND_URL` | Yes | Backend base URL (e.g. `http://localhost:8001`) |

---

## Database Collections

| Collection | Description |
|-----------|-------------|
| `conflicts` | Full conflict dataset (ACLED → UCDP priority) — detail table + stat cards |
| `chart_conflicts` | UCDP + OHCHR/OCHA only — Casualty Breakdown + Deaths by Country charts |
| `news_articles` | RSS articles (~60 documents, refreshed hourly) |
| `system_metadata` | Last fetch timestamp, sources used, chart sources |

---

## Database Management

### MongoDB Compass (GUI)

1. Download [MongoDB Compass](https://www.mongodb.com/try/download/compass)
2. Connect to `mongodb://localhost:27017`
3. Browse the `conflict_tracker` database and its collections

### Reset the database

```bash
mongosh
use conflict_tracker
db.dropDatabase()
exit
# Restart the backend — it will repopulate on startup
```

### Backup and restore

```bash
# Backup
mongodump --db=conflict_tracker --out=/path/to/backup

# Restore
mongorestore --db=conflict_tracker /path/to/backup/conflict_tracker
```

---

## Triggering a Manual Refresh

Click the **refresh button** (↻) in the dashboard header, or call the API directly:

```bash
curl -X POST http://localhost:8001/api/refresh
```

This immediately re-fetches all live sources (UCDP, OHCHR, OCHA, RSS) and updates both MongoDB collections.

---

## Troubleshooting

### MongoDB connection error (`ServerSelectionTimeoutError`)

1. Confirm MongoDB is running:
   ```bash
   brew services list         # macOS
   sudo systemctl status mongod  # Linux
   docker ps                  # Docker
   ```
2. Verify `MONGO_URL` in `backend/.env`
3. Test the connection: `mongosh`

### Port already in use

```bash
# Find and kill the process on port 8001
lsof -i :8001         # macOS/Linux
kill -9 <PID>

# Or port 3000 for the frontend
lsof -i :3000
```

### UCDP returns no data (HTTP 401 / 403)

Confirm `UCDP_API_KEY` is set in `backend/.env` and is valid. The backend logs will show:

```
UCDP returned HTTP 401 for Ukraine
```

Request a new token at [ucdp.uu.se](https://ucdp.uu.se) if your current one is invalid or expired.

### Charts show no data / source pills missing

1. Check backend logs for UCDP fetch errors
2. Confirm `db.chart_conflicts.countDocuments()` returns 9 in `mongosh`
3. Force a refresh: `curl -X POST http://localhost:8001/api/refresh`

### Python dependency issues

```bash
pip install --upgrade pip
pip install -r requirements.txt --no-cache-dir
```

### Frontend build issues

```bash
yarn cache clean
rm -rf node_modules
yarn install
```

---

## Development Workflow

Both servers support hot reload:

- **Backend** — FastAPI with `--reload` auto-restarts on file changes
- **Frontend** — React dev server auto-refreshes the browser

### Common edit locations

| Task | File |
|------|------|
| Add/edit conflict baseline data | `backend/server.py` → `BASELINE_CONFLICTS` |
| Tune UCDP/OHCHR/OACA fetch logic | `backend/server.py` → `fetch_ucdp_data()`, `scrape_ohchr_*`, `scrape_oaca_*` |
| Add RSS feed sources | `backend/server.py` → `RSS_FEEDS` |
| Edit dashboard layout | `frontend/src/pages/Dashboard.js` |
| Edit header | `frontend/src/components/Header.js` |
| Edit conflict table | `frontend/src/components/ConflictTable.js` |
| Edit globe markers / animation | `frontend/src/components/ConflictGlobe.js` |
| Edit styles | `frontend/src/App.css`, `frontend/src/index.css` |

---

## Production Build

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001 --workers 4
```

### Frontend

```bash
cd frontend
yarn build
npx serve -s build -p 3000
```

---

## Quick-Start Summary

```bash
# Terminal 1 — MongoDB (if not running as a service)
mongod --dbpath /path/to/data

# Terminal 2 — Backend
cd backend && source venv/bin/activate
python -m uvicorn server:app --reload --port 8001

# Terminal 3 — Frontend
cd frontend && yarn start

# Open
open http://localhost:3000
```

---

## Support

1. Check logs in both terminal windows
2. Verify MongoDB is running and the database has 9 documents in `conflicts`
3. Confirm `UCDP_API_KEY` is set and valid
4. Review [GitHub Issues](https://github.com/YOUR_USERNAME/watchtower/issues)
