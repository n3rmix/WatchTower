# Quick Reference Card

Essential commands for Project WATCHTOWER local development.

---

## 🚀 Start Application

```bash
# Terminal 1: Backend
cd backend
source venv/bin/activate  # or venv\Scripts\activate on Windows
uvicorn server:app --reload --port 8001

# Terminal 2: Frontend  
cd frontend
yarn start

# Open: http://localhost:3000
```

---

## 💾 Database Commands

```bash
# Check MongoDB is running
mongosh

# View data
use conflict_tracker
db.conflicts.find().pretty()
db.news_articles.countDocuments()

# Reset database
db.dropDatabase()

# Backup
mongodump --db=conflict_tracker --out=./backup

# Restore
mongorestore --db=conflict_tracker ./backup/conflict_tracker
```

---

## 🔍 Testing Commands

```bash
# Test backend API
curl http://localhost:8001/api/stats
curl http://localhost:8001/api/conflicts
curl http://localhost:8001/api/news

# Check backend logs
tail -f backend.log

# Frontend console
# Open browser DevTools (F12)
```

---

## 🛠️ Troubleshooting

```bash
# Port already in use
lsof -i :8001  # Find process on port 8001
kill -9 <PID>  # Kill process

# MongoDB not running
brew services start mongodb-community@7.0  # macOS
sudo systemctl start mongod  # Linux

# Clear caches
pip cache purge  # Python
yarn cache clean  # Node

# Reinstall dependencies
pip install -r requirements.txt --no-cache-dir
rm -rf node_modules && yarn install
```

---

## 📝 Common File Locations

```
/app/backend/server.py          # Main backend logic
/app/backend/.env               # Backend environment
/app/frontend/src/App.js        # Main React component
/app/frontend/src/pages/Dashboard.js  # Dashboard page
/app/frontend/.env              # Frontend environment
/app/README.md                  # Project documentation
/app/LOCAL_DEPLOYMENT.md        # Full setup guide
```

---

## 🔄 Git Commands

```bash
# View status
git status
git log --oneline -5

# Push to GitHub
git add .
git commit -m "Your message"
git push origin main

# View recent changes
git diff HEAD~1 HEAD
```

---

## ⚙️ Environment Variables

**Backend (.env):**
```bash
MONGO_URL=mongodb://localhost:27017
DB_NAME=conflict_tracker
CORS_ORIGINS=*
```

**Frontend (.env):**
```bash
REACT_APP_BACKEND_URL=http://localhost:8001
```

---

## 📊 Data Refresh

- **Auto:** Every 5 minutes (APScheduler)
- **Manual:** Click refresh button in dashboard
- **Force:** Restart backend server

---

## 🌐 URLs

- Frontend: http://localhost:3000
- Backend API: http://localhost:8001
- API Docs: http://localhost:8001/docs
- MongoDB: mongodb://localhost:27017

---

**Need help?** See [LOCAL_DEPLOYMENT.md](LOCAL_DEPLOYMENT.md) for detailed instructions.
