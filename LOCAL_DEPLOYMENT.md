# Local Deployment Guide

Complete guide to running Project WATCHTOWER on your local machine.

---

## Prerequisites

### Required Software

1. **Node.js** (v18 or higher)
   - Download from [nodejs.org](https://nodejs.org/)
   - Verify: `node --version`

2. **Yarn** (Package Manager)
   ```bash
   npm install -g yarn
   yarn --version
   ```

3. **Python** (3.11 or higher)
   - Download from [python.org](https://www.python.org/)
   - Verify: `python --version` or `python3 --version`

4. **MongoDB** (Database)
   - See detailed setup below

---

## Database Setup (MongoDB)

### Option 1: MongoDB Locally (Recommended for Development)

#### macOS (using Homebrew)

```bash
# Install MongoDB
brew tap mongodb/brew
brew install mongodb-community@7.0

# Start MongoDB service
brew services start mongodb-community@7.0

# Verify MongoDB is running
mongosh --eval "db.version()"
```

#### Ubuntu/Debian Linux

```bash
# Import MongoDB public GPG key
wget -qO - https://www.mongodb.org/static/pgp/server-7.0.asc | sudo apt-key add -

# Add MongoDB repository
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu $(lsb_release -cs)/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list

# Install MongoDB
sudo apt-get update
sudo apt-get install -y mongodb-org

# Start MongoDB
sudo systemctl start mongod
sudo systemctl enable mongod

# Verify
mongosh --eval "db.version()"
```

#### Windows

1. Download MongoDB Community Server from [mongodb.com](https://www.mongodb.com/try/download/community)
2. Run the installer (choose "Complete" installation)
3. Install as a Windows Service
4. MongoDB Compass (GUI) will be included
5. Verify in PowerShell:
   ```powershell
   mongosh --eval "db.version()"
   ```

#### Using Docker (Cross-Platform)

```bash
# Pull MongoDB image
docker pull mongo:7.0

# Run MongoDB container
docker run -d \
  --name mongodb \
  -p 27017:27017 \
  -e MONGO_INITDB_ROOT_USERNAME=admin \
  -e MONGO_INITDB_ROOT_PASSWORD=password \
  -v mongodb_data:/data/db \
  mongo:7.0

# Verify
docker exec -it mongodb mongosh
```

**Connection string for Docker:**
```
MONGO_URL=mongodb://admin:password@localhost:27017
```

---

### Option 2: MongoDB Atlas (Cloud - Free Tier)

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register)
2. Create a free account
3. Create a new cluster (M0 Free tier)
4. Click "Connect" → "Connect your application"
5. Copy the connection string:
   ```
   mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```

---

## Installation Steps

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/project-watchtower.git
cd project-watchtower
```

### 2. Backend Setup

```bash
# Navigate to backend directory
cd backend

# Create virtual environment (recommended)
python3 -m venv venv

# Activate virtual environment
# On macOS/Linux:
source venv/bin/activate
# On Windows:
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create .env file
cat > .env << EOF
MONGO_URL=mongodb://localhost:27017
DB_NAME=conflict_tracker
CORS_ORIGINS=*
EOF

# If using MongoDB Atlas, edit .env:
# MONGO_URL=mongodb+srv://username:password@cluster0.xxxxx.mongodb.net
```

### 3. Frontend Setup

```bash
# Open new terminal and navigate to frontend
cd frontend

# Install dependencies
yarn install

# Create .env file
cat > .env << EOF
REACT_APP_BACKEND_URL=http://localhost:8001
EOF
```

---

## Running the Application

### Start Backend (Terminal 1)

```bash
cd backend

# Activate virtual environment if not already active
source venv/bin/activate  # macOS/Linux
# or
venv\Scripts\activate     # Windows

# Start the server
python -m uvicorn server:app --reload --host 0.0.0.0 --port 8001
```

You should see:
```
INFO:     Uvicorn running on http://0.0.0.0:8001
INFO:     Application startup complete.
INFO:     Starting data refresh...
INFO:     Stored 60 articles in database
INFO:     Stored 9 conflict records in database
```

**Backend is now running at:** `http://localhost:8001`

### Start Frontend (Terminal 2)

```bash
cd frontend

# Start development server
yarn start
```

The app will automatically open at: `http://localhost:3000`

---

## Verify Installation

### 1. Check Backend API

```bash
# Test basic endpoint
curl http://localhost:8001/api/

# Get conflict statistics
curl http://localhost:8001/api/stats

# Get all conflicts
curl http://localhost:8001/api/conflicts
```

### 2. Check Database

```bash
# Connect to MongoDB
mongosh

# Switch to database
use conflict_tracker

# Check collections
show collections

# View conflict data
db.conflicts.find().pretty()

# Count documents
db.conflicts.countDocuments()  # Should return 9
db.news_articles.countDocuments()  # Should return ~60

# Exit
exit
```

### 3. Check Frontend

Open browser and navigate to:
- **Dashboard:** http://localhost:3000
- You should see:
  - Global statistics cards
  - 7 active conflicts indicator
  - Casualty breakdown chart
  - Deaths by country chart
  - News ticker at bottom

---

## Database Management

### MongoDB Compass (GUI Tool)

1. Download [MongoDB Compass](https://www.mongodb.com/try/download/compass)
2. Connect to: `mongodb://localhost:27017`
3. Browse collections:
   - `conflict_tracker.conflicts` (9 documents)
   - `conflict_tracker.news_articles` (~60 documents)
   - `conflict_tracker.api_keys` (user configurations)

### Manual Database Reset

```bash
# Connect to MongoDB
mongosh

# Drop database (to start fresh)
use conflict_tracker
db.dropDatabase()

# Restart backend - it will recreate and populate
```

### Backup Database

```bash
# Backup
mongodump --db=conflict_tracker --out=/path/to/backup

# Restore
mongorestore --db=conflict_tracker /path/to/backup/conflict_tracker
```

---

## Troubleshooting

### MongoDB Connection Issues

**Error:** `pymongo.errors.ServerSelectionTimeoutError`

**Solutions:**
1. Verify MongoDB is running:
   ```bash
   # macOS/Linux
   ps aux | grep mongod
   
   # Check service status
   brew services list  # macOS
   sudo systemctl status mongod  # Linux
   ```

2. Check connection string in `/app/backend/.env`:
   ```
   MONGO_URL=mongodb://localhost:27017
   ```

3. Test connection:
   ```bash
   mongosh
   ```

### Port Already in Use

**Error:** `Address already in use`

**Backend (port 8001):**
```bash
# Find process using port
lsof -i :8001  # macOS/Linux
netstat -ano | findstr :8001  # Windows

# Kill process
kill -9 <PID>  # macOS/Linux
taskkill /PID <PID> /F  # Windows
```

**Frontend (port 3000):**
```bash
lsof -i :3000  # macOS/Linux
netstat -ano | findstr :3000  # Windows
```

### Python Dependencies Issues

```bash
# Upgrade pip
pip install --upgrade pip

# Install specific versions
pip install fastapi==0.110.1
pip install motor==3.3.1

# Clear cache and reinstall
pip cache purge
pip install -r requirements.txt --no-cache-dir
```

### Frontend Build Issues

```bash
# Clear cache
yarn cache clean

# Remove node_modules and reinstall
rm -rf node_modules
yarn install

# Try legacy peer deps
yarn install --legacy-peer-deps
```

### Data Not Loading

1. **Check backend logs** in terminal running uvicorn
2. **Verify MongoDB has data:**
   ```bash
   mongosh
   use conflict_tracker
   db.conflicts.countDocuments()
   ```
3. **Force refresh:** Click the refresh button in dashboard header
4. **Check browser console** (F12) for errors

---

## Environment Variables Reference

### Backend (.env)

```bash
# MongoDB Connection
MONGO_URL=mongodb://localhost:27017          # Local MongoDB
# MONGO_URL=mongodb+srv://user:pass@cluster  # MongoDB Atlas

# Database Name
DB_NAME=conflict_tracker

# CORS (allow all origins for development)
CORS_ORIGINS=*
```

### Frontend (.env)

```bash
# Backend API URL
REACT_APP_BACKEND_URL=http://localhost:8001
```

---

## Development Workflow

### Hot Reload

Both backend and frontend support hot reload:
- **Backend:** FastAPI with `--reload` flag auto-restarts on file changes
- **Frontend:** React dev server auto-refreshes browser

### Making Changes

1. **Update conflict data:** Edit `/app/backend/server.py` → `scrape_conflict_data()`
2. **Update UI:** Edit files in `/app/frontend/src/`
3. **Add RSS feeds:** Edit `RSS_FEEDS` array in `server.py`
4. **Modify styling:** Edit `/app/frontend/src/App.css` or `/app/frontend/src/index.css`

### Testing Changes

```bash
# Backend API test
curl http://localhost:8001/api/conflicts | python -m json.tool

# Frontend rebuild
cd frontend
yarn build
```

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

# Serve static build
npx serve -s build -p 3000
```

---

## Quick Start Commands (Summary)

```bash
# Terminal 1: Start MongoDB (if not running as service)
mongod --dbpath /path/to/data

# Terminal 2: Start Backend
cd backend
source venv/bin/activate
python -m uvicorn server:app --reload --port 8001

# Terminal 3: Start Frontend
cd frontend
yarn start

# Open browser
open http://localhost:3000
```

---

## Next Steps

- ✅ Application running locally
- 📊 Data automatically refreshes every 5 minutes
- 🔧 Configure API keys via Settings page
- 🌐 Deploy to production (see deployment guides)

---

## Support

If you encounter issues:
1. Check logs in both terminal windows
2. Verify MongoDB is running
3. Check `.env` files are correctly configured
4. Review [GitHub Issues](https://github.com/YOUR_USERNAME/project-watchtower/issues)

**Happy monitoring! 🌍**
