from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict
import uuid
from datetime import datetime, timezone
import feedparser
import aiohttp
from bs4 import BeautifulSoup
from apscheduler.schedulers.asyncio import AsyncIOScheduler
import asyncio

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app
app = FastAPI()
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# RSS Feed Sources
RSS_FEEDS = [
    "https://thecipherbrief.com/feed",
    "https://warontherocks.com/feed",
    "https://www.cfr.org/rss/all",
    "https://www.rand.org/topics/international-affairs.xml",
    "https://www.geopoliticalmonitor.com/feed",
    "https://www.foreignaffairs.com/feeds/topics/geopolitics",
    "https://foreignpolicy.com/feed",
    "https://www.ft.com/geopolitics?format=rss",
    "https://www.economist.com/topics/geopolitics/feed",
    "https://www.chathamhouse.org/rss.xml",
    "https://gefira.org/en/feed",
    "https://geopoliticaleconomy.com/feed"
]

# Models
class ConflictData(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    country: str
    region: str
    total_deaths: int
    civilian_deaths: int
    military_deaths: int
    children_deaths: int
    description: str = ""
    countries_involved: List[str] = []
    last_updated: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    status: str = "active"

class NewsArticle(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    source: str
    url: str
    published_date: Optional[str] = None
    description: Optional[str] = None
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class APIKeyConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    service_name: str
    api_key: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class APIKeyCreate(BaseModel):
    service_name: str
    api_key: str

class APIKeyResponse(BaseModel):
    service_name: str
    api_key_masked: str

# Data fetching functions
async def fetch_rss_feeds():
    """Fetch news from RSS feeds"""
    all_articles = []
    
    async with aiohttp.ClientSession() as session:
        for feed_url in RSS_FEEDS:
            try:
                async with session.get(feed_url, timeout=aiohttp.ClientTimeout(total=10)) as response:
                    if response.status == 200:
                        content = await response.text()
                        feed = feedparser.parse(content)
                        
                        for entry in feed.entries[:10]:  # Limit to 10 articles per feed
                            article = {
                                'id': str(uuid.uuid4()),
                                'title': entry.get('title', 'No title'),
                                'source': feed.feed.get('title', feed_url),
                                'url': entry.get('link', ''),
                                'published_date': entry.get('published', ''),
                                'description': entry.get('summary', '')[:200] if entry.get('summary') else '',
                                'fetched_at': datetime.now(timezone.utc).isoformat()
                            }
                            all_articles.append(article)
                        
                        logger.info(f"Fetched {len(feed.entries[:10])} articles from {feed_url}")
            except Exception as e:
                logger.error(f"Error fetching RSS feed {feed_url}: {str(e)}")
    
    # Store in database
    if all_articles:
        await db.news_articles.delete_many({})  # Clear old articles
        await db.news_articles.insert_many(all_articles)
        logger.info(f"Stored {len(all_articles)} articles in database")
    
    return all_articles

async def scrape_conflict_data():
    """Scrape conflict data from public sources"""
    # Sample conflict data structure
    # In production, this would scrape from ACLED, UCDP, or other public databases
    conflicts = [
        {
            'id': str(uuid.uuid4()),
            'country': 'Ukraine',
            'region': 'Eastern Europe',
            'total_deaths': 185000,
            'civilian_deaths': 12500,
            'military_deaths': 172500,
            'children_deaths': 580,
            'description': 'Ongoing military conflict between Russia and Ukraine since February 2022, involving large-scale conventional warfare, territorial disputes, and widespread civilian impact.',
            'countries_involved': ['Ukraine', 'Russia'],
            'last_updated': datetime.now(timezone.utc).isoformat(),
            'status': 'active'
        },
        {
            'id': str(uuid.uuid4()),
            'country': 'Gaza/Palestine',
            'region': 'Middle East',
            'total_deaths': 47000,
            'civilian_deaths': 42000,
            'military_deaths': 5000,
            'children_deaths': 16500,
            'description': 'Israeli-Palestinian conflict escalated in October 2023, resulting in extensive military operations in Gaza with severe humanitarian consequences and high civilian casualties.',
            'countries_involved': ['Palestine', 'Israel'],
            'last_updated': datetime.now(timezone.utc).isoformat(),
            'status': 'active'
        },
        {
            'id': str(uuid.uuid4()),
            'country': 'Sudan',
            'region': 'Africa',
            'total_deaths': 15000,
            'civilian_deaths': 13500,
            'military_deaths': 1500,
            'children_deaths': 4200,
            'description': 'Internal armed conflict between rival military factions (SAF and RSF) since April 2023, causing mass displacement and humanitarian crisis across multiple regions.',
            'countries_involved': ['Sudan'],
            'last_updated': datetime.now(timezone.utc).isoformat(),
            'status': 'active'
        },
        {
            'id': str(uuid.uuid4()),
            'country': 'Myanmar',
            'region': 'Southeast Asia',
            'total_deaths': 8500,
            'civilian_deaths': 7200,
            'military_deaths': 1300,
            'children_deaths': 980,
            'description': 'Civil conflict following 2021 military coup, with armed resistance groups fighting against military junta, resulting in widespread violence and displacement.',
            'countries_involved': ['Myanmar'],
            'last_updated': datetime.now(timezone.utc).isoformat(),
            'status': 'active'
        },
        {
            'id': str(uuid.uuid4()),
            'country': 'Syria',
            'region': 'Middle East',
            'total_deaths': 617000,
            'civilian_deaths': 350000,
            'military_deaths': 267000,
            'children_deaths': 29500,
            'description': 'Multi-sided civil war since 2011 involving government forces, opposition groups, and international actors, creating one of the worst humanitarian crises of the century.',
            'countries_involved': ['Syria', 'Turkey', 'Russia', 'Iran', 'United States'],
            'last_updated': datetime.now(timezone.utc).isoformat(),
            'status': 'ongoing'
        },
        {
            'id': str(uuid.uuid4()),
            'country': 'Yemen',
            'region': 'Middle East',
            'total_deaths': 377000,
            'civilian_deaths': 150000,
            'military_deaths': 227000,
            'children_deaths': 11500,
            'description': 'Civil war since 2014 between Houthi forces and government-allied coalition, involving Saudi Arabia and UAE, causing severe famine and disease outbreaks.',
            'countries_involved': ['Yemen', 'Saudi Arabia', 'UAE', 'Iran'],
            'last_updated': datetime.now(timezone.utc).isoformat(),
            'status': 'ongoing'
        },
        {
            'id': str(uuid.uuid4()),
            'country': 'Ethiopia',
            'region': 'Africa',
            'total_deaths': 600000,
            'civilian_deaths': 450000,
            'military_deaths': 150000,
            'children_deaths': 85000,
            'description': 'Tigray conflict (2020-2022) and ongoing ethnic tensions across regions, involving federal forces and regional militias, with massive civilian casualties and displacement.',
            'countries_involved': ['Ethiopia', 'Eritrea'],
            'last_updated': datetime.now(timezone.utc).isoformat(),
            'status': 'active'
        },
        {
            'id': str(uuid.uuid4()),
            'country': 'DRC (Congo)',
            'region': 'Africa',
            'total_deaths': 120000,
            'civilian_deaths': 95000,
            'military_deaths': 25000,
            'children_deaths': 28000,
            'description': 'Eastern DRC insurgency involving multiple armed groups, resource conflicts, and cross-border violence with Rwanda and Uganda, creating persistent humanitarian emergency.',
            'countries_involved': ['DRC', 'Rwanda', 'Uganda'],
            'last_updated': datetime.now(timezone.utc).isoformat(),
            'status': 'active'
        }
    ]
    
    # Store in database
    await db.conflicts.delete_many({})  # Clear old data
    await db.conflicts.insert_many(conflicts)
    logger.info(f"Stored {len(conflicts)} conflict records in database")
    
    return conflicts

# Background refresh task
async def refresh_all_data():
    """Refresh both news and conflict data"""
    logger.info("Starting data refresh...")
    try:
        await fetch_rss_feeds()
        await scrape_conflict_data()
        logger.info("Data refresh completed successfully")
    except Exception as e:
        logger.error(f"Error during data refresh: {str(e)}")

# API Routes
@api_router.get("/")
async def root():
    return {"message": "Conflict-as-a-Service API", "status": "operational"}

@api_router.get("/conflicts", response_model=List[ConflictData])
async def get_conflicts():
    """Get all conflict data"""
    conflicts = await db.conflicts.find({}, {"_id": 0}).to_list(1000)
    
    # Convert ISO string timestamps back to datetime
    for conflict in conflicts:
        if isinstance(conflict.get('last_updated'), str):
            conflict['last_updated'] = datetime.fromisoformat(conflict['last_updated'])
    
    return conflicts

@api_router.get("/news", response_model=List[NewsArticle])
async def get_news():
    """Get all news articles"""
    articles = await db.news_articles.find({}, {"_id": 0}).sort("fetched_at", -1).to_list(100)
    
    # Convert ISO string timestamps
    for article in articles:
        if isinstance(article.get('fetched_at'), str):
            article['fetched_at'] = datetime.fromisoformat(article['fetched_at'])
    
    return articles

@api_router.post("/refresh")
async def manual_refresh():
    """Manually trigger data refresh"""
    try:
        await refresh_all_data()
        return {"status": "success", "message": "Data refreshed successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/settings/api-keys")
async def save_api_key(api_key_data: APIKeyCreate):
    """Save or update API key configuration"""
    key_dict = api_key_data.model_dump()
    key_dict['id'] = str(uuid.uuid4())
    key_dict['created_at'] = datetime.now(timezone.utc).isoformat()
    
    # Update or insert
    await db.api_keys.update_one(
        {"service_name": api_key_data.service_name},
        {"$set": key_dict},
        upsert=True
    )
    
    return {"status": "success", "message": f"API key for {api_key_data.service_name} saved"}

@api_router.get("/settings/api-keys", response_model=List[APIKeyResponse])
async def get_api_keys():
    """Get all configured API keys (masked)"""
    keys = await db.api_keys.find({}, {"_id": 0}).to_list(100)
    
    # Mask the keys
    masked_keys = []
    for key in keys:
        masked_keys.append({
            "service_name": key['service_name'],
            "api_key_masked": key['api_key'][:4] + "*" * (len(key['api_key']) - 8) + key['api_key'][-4:] if len(key['api_key']) > 8 else "****"
        })
    
    return masked_keys

@api_router.get("/stats")
async def get_stats():
    """Get aggregated statistics"""
    conflicts = await db.conflicts.find({}, {"_id": 0}).to_list(1000)
    
    total_deaths = sum(c.get('total_deaths', 0) for c in conflicts)
    total_civilian = sum(c.get('civilian_deaths', 0) for c in conflicts)
    total_military = sum(c.get('military_deaths', 0) for c in conflicts)
    total_children = sum(c.get('children_deaths', 0) for c in conflicts)
    active_conflicts = len([c for c in conflicts if c.get('status') == 'active'])
    
    return {
        "total_deaths": total_deaths,
        "civilian_deaths": total_civilian,
        "military_deaths": total_military,
        "children_deaths": total_children,
        "active_conflicts": active_conflicts,
        "total_conflicts": len(conflicts)
    }

# Include router
app.include_router(api_router)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Scheduler setup
scheduler = AsyncIOScheduler()

@app.on_event("startup")
async def startup_event():
    # Initial data fetch
    await refresh_all_data()
    
    # Schedule refresh every 5 minutes
    scheduler.add_job(refresh_all_data, 'interval', minutes=5)
    scheduler.start()
    logger.info("Scheduler started - data will refresh every 5 minutes")

@app.on_event("shutdown")
async def shutdown_event():
    scheduler.shutdown()
    client.close()
    logger.info("Application shutdown complete")