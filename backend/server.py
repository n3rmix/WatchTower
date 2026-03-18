from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import re
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict
import uuid
from datetime import datetime, timezone, timedelta
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

# UCDP API configuration
UCDP_API_BASE = "https://ucdpapi.pcr.uu.se/api"
UCDP_VERSION = "23.1"

# Country name mappings for external APIs
UCDP_COUNTRY_MAP = {
    'Ukraine': 'Ukraine',
    'Gaza/Palestine': 'Israel',
    'Sudan': 'Sudan',
    'Myanmar': 'Myanmar (Burma)',
    'Syria': 'Syria',
    'Yemen': 'Yemen (North Yemen)',
    'Ethiopia': 'Ethiopia',
    'DRC (Congo)': 'Democratic Republic of Congo (Zaire)',
    'Iran': 'Iran',
}

ACLED_COUNTRY_MAP = {
    'Ukraine': 'Ukraine',
    'Gaza/Palestine': 'Palestine',
    'Sudan': 'Sudan',
    'Myanmar': 'Myanmar',
    'Syria': 'Syria',
    'Yemen': 'Yemen',
    'Ethiopia': 'Ethiopia',
    'DRC (Congo)': 'Democratic Republic of Congo',
    'Iran': 'Iran',
}

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
    parties_involved: List[str] = []
    data_sources: List[str] = []
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


# ─── Live data fetching helpers ───────────────────────────────────────────────

async def get_acled_credentials():
    """Retrieve stored ACLED email and API key from DB."""
    email_doc = await db.api_keys.find_one({"service_name": "ACLED_EMAIL"})
    key_doc = await db.api_keys.find_one({"service_name": "ACLED"})
    if email_doc and key_doc:
        return email_doc["api_key"], key_doc["api_key"]
    return None, None


async def fetch_ucdp_deaths_for_country(country_name: str, session: aiohttp.ClientSession) -> Optional[int]:
    """Fetch cumulative battle deaths from the UCDP GED API for a single country."""
    try:
        url = f"{UCDP_API_BASE}/gedbattle/{UCDP_VERSION}"
        params = {"pagesize": 1000, "country": country_name}
        async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=20)) as resp:
            if resp.status == 200:
                data = await resp.json()
                results = data.get("Result", [])
                total = sum(int(event.get("best_est", 0) or 0) for event in results)
                logger.info(f"UCDP: {country_name} → {total} battle deaths ({len(results)} events)")
                return total if total > 0 else None
    except Exception as e:
        logger.warning(f"UCDP fetch error for {country_name}: {e}")
    return None


async def fetch_ucdp_data() -> Dict[str, int]:
    """Fetch UCDP battle deaths for all tracked conflicts. Returns {conflict_country: total_deaths}."""
    results: Dict[str, int] = {}
    async with aiohttp.ClientSession(headers={"User-Agent": "WatchTower/1.0"}) as session:
        tasks = []
        keys = []
        for conflict_country, ucdp_country in UCDP_COUNTRY_MAP.items():
            keys.append(conflict_country)
            tasks.append(fetch_ucdp_deaths_for_country(ucdp_country, session))
        totals = await asyncio.gather(*tasks, return_exceptions=True)
        for key, total in zip(keys, totals):
            if isinstance(total, int) and total is not None:
                results[key] = total
    logger.info(f"UCDP fetch complete: {len(results)}/{len(UCDP_COUNTRY_MAP)} countries updated")
    return results


async def fetch_acled_deaths_for_country(
    country_name: str, email: str, api_key: str, session: aiohttp.ClientSession
) -> Optional[int]:
    """Fetch total fatalities for a country from the ACLED API."""
    try:
        url = "https://api.acleddata.com/acled/read"
        params = {
            "key": api_key,
            "email": email,
            "country": country_name,
            "fields": "fatalities",
            "limit": 0,
        }
        async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=30)) as resp:
            if resp.status == 200:
                data = await resp.json()
                total = sum(int(e.get("fatalities", 0) or 0) for e in data.get("data", []))
                logger.info(f"ACLED: {country_name} → {total} fatalities")
                return total if total > 0 else None
    except Exception as e:
        logger.warning(f"ACLED fetch error for {country_name}: {e}")
    return None


async def fetch_acled_data(email: str, api_key: str) -> Dict[str, int]:
    """Fetch ACLED fatalities for all tracked conflicts."""
    results: Dict[str, int] = {}
    async with aiohttp.ClientSession(headers={"User-Agent": "WatchTower/1.0"}) as session:
        tasks = []
        keys = []
        for conflict_country, acled_country in ACLED_COUNTRY_MAP.items():
            keys.append(conflict_country)
            tasks.append(fetch_acled_deaths_for_country(acled_country, email, api_key, session))
        totals = await asyncio.gather(*tasks, return_exceptions=True)
        for key, total in zip(keys, totals):
            if isinstance(total, int) and total is not None:
                results[key] = total
    logger.info(f"ACLED fetch complete: {len(results)}/{len(ACLED_COUNTRY_MAP)} countries updated")
    return results


async def scrape_ohchr_ukraine_civilian_deaths() -> Optional[int]:
    """
    Scrape OHCHR Ukraine monitor page for the latest confirmed civilian death count.
    Returns the number if found, None otherwise.
    """
    urls_to_try = [
        "https://www.ohchr.org/en/news/latest/ukraine",
        "https://ukraine.un.org/en/sdgs",
    ]
    try:
        async with aiohttp.ClientSession(headers={"User-Agent": "Mozilla/5.0 (compatible; WatchTower/1.0)"}) as session:
            for url in urls_to_try:
                try:
                    async with session.get(url, timeout=aiohttp.ClientTimeout(total=20)) as resp:
                        if resp.status == 200:
                            html = await resp.text()
                            text = BeautifulSoup(html, 'lxml').get_text(" ", strip=True)
                            patterns = [
                                r'(\d[\d,]+)\s+civilians?\s+(?:have been\s+)?(?:were\s+)?killed',
                                r'killed\s+(?:at least\s+)?(\d[\d,]+)\s+civilians?',
                                r'civilian\s+(?:deaths?|casualties?|fatalities?)\s*[:\-–]\s*(\d[\d,]+)',
                                r'(\d[\d,]+)\s+civilian\s+deaths?',
                            ]
                            for pattern in patterns:
                                match = re.search(pattern, text, re.IGNORECASE)
                                if match:
                                    num = int(match.group(1).replace(',', ''))
                                    if 1000 < num < 1_000_000:  # Sanity check
                                        logger.info(f"OHCHR Ukraine civilian deaths: {num}")
                                        return num
                except Exception as e:
                    logger.warning(f"OHCHR scrape attempt failed for {url}: {e}")
    except Exception as e:
        logger.warning(f"OHCHR Ukraine scrape error: {e}")
    return None


async def scrape_ocha_gaza_deaths() -> Optional[int]:
    """
    Scrape OCHA oPt pages for the latest Gaza total death count.
    Returns the number if found, None otherwise.
    """
    urls_to_try = [
        "https://www.ochaopt.org/content/hostilities-gaza-strip-and-israel-flash-update",
        "https://www.ochaopt.org/",
    ]
    try:
        async with aiohttp.ClientSession(headers={"User-Agent": "Mozilla/5.0 (compatible; WatchTower/1.0)"}) as session:
            for url in urls_to_try:
                try:
                    async with session.get(url, timeout=aiohttp.ClientTimeout(total=20)) as resp:
                        if resp.status == 200:
                            html = await resp.text()
                            text = BeautifulSoup(html, 'lxml').get_text(" ", strip=True)
                            patterns = [
                                r'(\d[\d,]+)\s+Palestinians?\s+(?:have been\s+)?(?:were\s+)?killed',
                                r'(\d[\d,]+)\s+people\s+(?:have been\s+)?killed\s+in\s+Gaza',
                                r'killed\s+(?:at least\s+)?(\d[\d,]+)\s+Palestinians?',
                                r'total\s+(?:deaths?|fatalities?|killed)\s*[:\-–]\s*(\d[\d,]+)',
                            ]
                            for pattern in patterns:
                                match = re.search(pattern, text, re.IGNORECASE)
                                if match:
                                    num = int(match.group(1).replace(',', ''))
                                    if 1000 < num < 500_000:  # Sanity check
                                        logger.info(f"OCHA Gaza total deaths: {num}")
                                        return num
                except Exception as e:
                    logger.warning(f"OCHA scrape attempt failed for {url}: {e}")
    except Exception as e:
        logger.warning(f"OCHA Gaza scrape error: {e}")
    return None


async def update_last_fetch_metadata(sources_used: List[str]):
    """Store the timestamp of the most recent successful live data fetch."""
    now = datetime.now(timezone.utc)
    await db.system_metadata.update_one(
        {"key": "last_fetch"},
        {"$set": {
            "key": "last_fetch",
            "fetched_at": now.isoformat(),
            "sources": sources_used,
        }},
        upsert=True,
    )
    return now


# ─── RSS news fetching ────────────────────────────────────────────────────────

async def fetch_rss_feeds():
    """Fetch news from RSS feeds."""
    all_articles = []

    async with aiohttp.ClientSession() as session:
        for feed_url in RSS_FEEDS:
            try:
                async with session.get(feed_url, timeout=aiohttp.ClientTimeout(total=10)) as response:
                    if response.status == 200:
                        content = await response.text()
                        feed = feedparser.parse(content)

                        for entry in feed.entries[:10]:
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

    if all_articles:
        await db.news_articles.delete_many({})
        await db.news_articles.insert_many(all_articles)
        logger.info(f"Stored {len(all_articles)} articles in database")

    return all_articles


# ─── Conflict data with live source integration ───────────────────────────────

# Baseline conflict data used as fallback when live sources are unavailable.
BASELINE_CONFLICTS = [
    {
        'country': 'Ukraine',
        'region': 'Eastern Europe',
        'total_deaths': 185000,
        'civilian_deaths': 12500,
        'military_deaths': 172500,
        'children_deaths': 580,
        'description': 'Ongoing military conflict between Russia and Ukraine since February 2022, involving large-scale conventional warfare, territorial disputes, and widespread civilian impact.',
        'countries_involved': ['Ukraine', 'Russia'],
        'parties_involved': ['Ukrainian Armed Forces', 'Russian Armed Forces', 'Wagner Group', 'Ukrainian Territorial Defense', 'Donetsk People\'s Republic', 'Luhansk People\'s Republic'],
        'data_sources': ['OHCHR', 'Ukraine MOD', 'Mediazona', 'BBC Russia'],
        'status': 'active'
    },
    {
        'country': 'Gaza/Palestine',
        'region': 'Middle East',
        'total_deaths': 47000,
        'civilian_deaths': 42000,
        'military_deaths': 5000,
        'children_deaths': 16500,
        'description': 'Israeli-Palestinian conflict escalated in October 2023, resulting in extensive military operations in Gaza with severe humanitarian consequences and high civilian casualties.',
        'countries_involved': ['Palestine', 'Israel'],
        'parties_involved': ['Israeli Defense Forces (IDF)', 'Hamas', 'Palestinian Islamic Jihad', 'Al-Qassam Brigades', 'Israeli Security Forces'],
        'data_sources': ['Gaza Health Ministry', 'OCHA', 'B\'Tselem', 'PCHR'],
        'status': 'active'
    },
    {
        'country': 'Sudan',
        'region': 'Africa',
        'total_deaths': 15000,
        'civilian_deaths': 13500,
        'military_deaths': 1500,
        'children_deaths': 4200,
        'description': 'Internal armed conflict between rival military factions (SAF and RSF) since April 2023, causing mass displacement and humanitarian crisis across multiple regions.',
        'countries_involved': ['Sudan'],
        'parties_involved': ['Sudanese Armed Forces (SAF)', 'Rapid Support Forces (RSF)', 'Sudan Liberation Movement', 'Justice and Equality Movement'],
        'data_sources': ['ACLED', 'Sudan Doctors Syndicate', 'WHO', 'OCHA Sudan'],
        'status': 'active'
    },
    {
        'country': 'Myanmar',
        'region': 'Southeast Asia',
        'total_deaths': 8500,
        'civilian_deaths': 7200,
        'military_deaths': 1300,
        'children_deaths': 980,
        'description': 'Civil conflict following 2021 military coup, with armed resistance groups fighting against military junta, resulting in widespread violence and displacement.',
        'countries_involved': ['Myanmar'],
        'parties_involved': ['Myanmar Military (Tatmadaw)', 'People\'s Defense Forces (PDF)', 'Arakan Army', 'Karen National Union', 'Kachin Independence Army', 'National Unity Government'],
        'data_sources': ['AAPP', 'UCDP', 'UN Human Rights Office', 'Myanmar Witness'],
        'status': 'active'
    },
    {
        'country': 'Syria',
        'region': 'Middle East',
        'total_deaths': 617000,
        'civilian_deaths': 350000,
        'military_deaths': 267000,
        'children_deaths': 29500,
        'description': 'Multi-sided civil war since 2011 involving government forces, opposition groups, and international actors, creating one of the worst humanitarian crises of the century.',
        'countries_involved': ['Syria', 'Turkey', 'Russia', 'Iran', 'United States'],
        'parties_involved': ['Syrian Government Forces', 'Syrian Democratic Forces (SDF)', 'Hayat Tahrir al-Sham (HTS)', 'Free Syrian Army', 'ISIS remnants', 'Turkish Armed Forces', 'Russian Forces', 'Iranian Forces', 'Hezbollah', 'US Coalition'],
        'data_sources': ['Syrian Observatory for Human Rights', 'VDC', 'SNHR', 'WHO Syria'],
        'status': 'ongoing'
    },
    {
        'country': 'Yemen',
        'region': 'Middle East',
        'total_deaths': 377000,
        'civilian_deaths': 150000,
        'military_deaths': 227000,
        'children_deaths': 11500,
        'description': 'Civil war since 2014 between Houthi forces and government-allied coalition, involving Saudi Arabia and UAE, causing severe famine and disease outbreaks.',
        'countries_involved': ['Yemen', 'Saudi Arabia', 'UAE', 'Iran'],
        'parties_involved': ['Houthi Movement (Ansar Allah)', 'Yemeni Government Forces', 'Saudi-led Coalition', 'Southern Transitional Council', 'Al-Qaeda in Arabian Peninsula', 'UAE Forces', 'Yemeni Armed Forces'],
        'data_sources': ['ACLED', 'Yemen Data Project', 'OCHA Yemen', 'WHO Yemen'],
        'status': 'ongoing'
    },
    {
        'country': 'Ethiopia',
        'region': 'Africa',
        'total_deaths': 600000,
        'civilian_deaths': 450000,
        'military_deaths': 150000,
        'children_deaths': 85000,
        'description': 'Tigray conflict (2020-2022) and ongoing ethnic tensions across regions, involving federal forces and regional militias, with massive civilian casualties and displacement.',
        'countries_involved': ['Ethiopia', 'Eritrea'],
        'parties_involved': ['Ethiopian National Defense Force', 'Tigray Defense Forces', 'Eritrean Defense Forces', 'Amhara Regional Forces', 'Fano Militia', 'Oromo Liberation Army'],
        'data_sources': ['ACLED', 'Ghent University Study', 'TGHAT', 'Amnesty International'],
        'status': 'active'
    },
    {
        'country': 'DRC (Congo)',
        'region': 'Africa',
        'total_deaths': 120000,
        'civilian_deaths': 95000,
        'military_deaths': 25000,
        'children_deaths': 28000,
        'description': 'Eastern DRC insurgency involving multiple armed groups, resource conflicts, and cross-border violence with Rwanda and Uganda, creating persistent humanitarian emergency.',
        'countries_involved': ['DRC', 'Rwanda', 'Uganda'],
        'parties_involved': ['FARDC (DRC Army)', 'M23 Movement', 'Allied Democratic Forces (ADF)', 'FDLR', 'Mai-Mai Militias', 'MONUSCO', 'Rwandan Defense Forces', 'Ugandan Forces'],
        'data_sources': ['ACLED', 'Kivu Security Tracker', 'OCHA DRC', 'Congo Research Group'],
        'status': 'active'
    },
    {
        'country': 'Iran',
        'region': 'Middle East',
        'total_deaths': 2800,
        'civilian_deaths': 2100,
        'military_deaths': 700,
        'children_deaths': 320,
        'description': 'Internal civil unrest and government crackdowns following nationwide protests since 2022, shadow war with Israel involving targeted assassinations and sabotage operations, tensions with US including sanctions and regional proxy conflicts, and Kurdish insurgencies.',
        'countries_involved': ['Iran', 'Israel', 'United States'],
        'parties_involved': ['Iranian Security Forces', 'IRGC', 'Basij Militia', 'Kurdish Democratic Party of Iran (KDPI)', 'Komala', 'Free Life Party of Kurdistan (PJAK)', 'Iranian Opposition Groups', 'Mossad', 'Israeli Defense Forces', 'US Forces'],
        'data_sources': ['Iran Human Rights (IHR)', 'Hengaw', 'Amnesty International', 'UN Human Rights'],
        'status': 'active'
    }
]


async def scrape_conflict_data():
    """
    Build conflict records by querying live primary sources (ACLED, UCDP, OHCHR/OCHA).
    Falls back gracefully to baseline figures when live sources are unavailable.
    """
    now = datetime.now(timezone.utc)
    sources_used: List[str] = []

    # ── 1. Try ACLED (highest-quality, requires stored credentials) ──────────
    acled_deaths: Dict[str, int] = {}
    acled_email, acled_key = await get_acled_credentials()
    if acled_email and acled_key:
        try:
            acled_deaths = await fetch_acled_data(acled_email, acled_key)
            if acled_deaths:
                sources_used.append("ACLED")
        except Exception as e:
            logger.error(f"ACLED data fetch failed: {e}")

    # ── 2. UCDP free API as fallback / supplement ────────────────────────────
    ucdp_deaths: Dict[str, int] = {}
    try:
        ucdp_deaths = await fetch_ucdp_data()
        if ucdp_deaths:
            sources_used.append("UCDP")
    except Exception as e:
        logger.error(f"UCDP data fetch failed: {e}")

    # ── 3. OHCHR/OCHA scraping for Ukraine civilian & Gaza total ─────────────
    ohchr_ukraine_civilian: Optional[int] = None
    ocha_gaza_total: Optional[int] = None
    try:
        ohchr_ukraine_civilian, ocha_gaza_total = await asyncio.gather(
            scrape_ohchr_ukraine_civilian_deaths(),
            scrape_ocha_gaza_deaths(),
            return_exceptions=True,
        )
        if isinstance(ohchr_ukraine_civilian, int) or isinstance(ocha_gaza_total, int):
            sources_used.append("OHCHR/OCHA")
    except Exception as e:
        logger.error(f"OHCHR/OCHA scrape failed: {e}")

    if not sources_used:
        sources_used.append("Baseline (live sources unavailable)")
        logger.warning("All live sources failed — using baseline conflict data")

    # ── 4. Merge live numbers into conflict records ──────────────────────────
    conflicts = []
    for base in BASELINE_CONFLICTS:
        record = dict(base)
        country = record['country']
        record['id'] = str(uuid.uuid4())
        record['last_updated'] = now.isoformat()

        # Determine best total deaths figure
        # Priority: ACLED > UCDP > baseline
        live_total: Optional[int] = acled_deaths.get(country) or ucdp_deaths.get(country)

        if live_total is not None:
            old_total = record['total_deaths']
            # Scale civilian/military proportionally from the live total
            if old_total > 0:
                civ_ratio = record['civilian_deaths'] / old_total
                mil_ratio = record['military_deaths'] / old_total
                child_ratio = record['children_deaths'] / old_total
                record['total_deaths'] = live_total
                record['civilian_deaths'] = int(live_total * civ_ratio)
                record['military_deaths'] = int(live_total * mil_ratio)
                record['children_deaths'] = int(live_total * child_ratio)
            else:
                record['total_deaths'] = live_total

        # Override Ukraine civilian deaths with OHCHR figure if available
        if country == 'Ukraine' and isinstance(ohchr_ukraine_civilian, int):
            record['civilian_deaths'] = ohchr_ukraine_civilian
            # Recalculate total if OHCHR civilian > current civilian
            if ohchr_ukraine_civilian > record['civilian_deaths']:
                record['total_deaths'] = max(record['total_deaths'],
                                             ohchr_ukraine_civilian + record['military_deaths'])

        # Override Gaza total deaths with OCHA figure if available
        if country == 'Gaza/Palestine' and isinstance(ocha_gaza_total, int):
            old_total = record['total_deaths']
            record['total_deaths'] = ocha_gaza_total
            if old_total > 0:
                civ_ratio = record['civilian_deaths'] / old_total
                mil_ratio = record['military_deaths'] / old_total
                child_ratio = record['children_deaths'] / old_total
                record['civilian_deaths'] = int(ocha_gaza_total * civ_ratio)
                record['military_deaths'] = int(ocha_gaza_total * mil_ratio)
                record['children_deaths'] = int(ocha_gaza_total * child_ratio)

        conflicts.append(record)

    # ── 5. Persist ────────────────────────────────────────────────────────────
    await db.conflicts.delete_many({})
    await db.conflicts.insert_many(conflicts)
    logger.info(f"Stored {len(conflicts)} conflict records (sources: {', '.join(sources_used)})")

    await update_last_fetch_metadata(sources_used)
    return conflicts


# ─── Background refresh task ──────────────────────────────────────────────────

async def refresh_all_data():
    """Refresh both news articles and conflict casualty data from primary sources."""
    logger.info("Starting hourly data refresh…")
    try:
        await fetch_rss_feeds()
        await scrape_conflict_data()
        logger.info("Hourly data refresh completed successfully")
    except Exception as e:
        logger.error(f"Error during data refresh: {e}")


# ─── API Routes ───────────────────────────────────────────────────────────────

@api_router.get("/")
async def root():
    return {"message": "Conflict-as-a-Service API", "status": "operational"}


@api_router.get("/conflicts", response_model=List[ConflictData])
async def get_conflicts():
    """Get all conflict data."""
    conflicts = await db.conflicts.find({}, {"_id": 0}).to_list(1000)
    for conflict in conflicts:
        if isinstance(conflict.get('last_updated'), str):
            conflict['last_updated'] = datetime.fromisoformat(conflict['last_updated'])
    return conflicts


@api_router.get("/news", response_model=List[NewsArticle])
async def get_news():
    """Get all news articles."""
    articles = await db.news_articles.find({}, {"_id": 0}).sort("fetched_at", -1).to_list(100)
    for article in articles:
        if isinstance(article.get('fetched_at'), str):
            article['fetched_at'] = datetime.fromisoformat(article['fetched_at'])
    return articles


@api_router.post("/refresh")
async def manual_refresh():
    """Manually trigger data refresh."""
    try:
        await refresh_all_data()
        return {"status": "success", "message": "Data refreshed successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@api_router.get("/last-update")
async def get_last_update():
    """Return the timestamp and sources of the most recent live data fetch."""
    meta = await db.system_metadata.find_one({"key": "last_fetch"}, {"_id": 0})
    if not meta:
        return {"fetched_at": None, "sources": [], "next_fetch_in_minutes": None}

    fetched_at_str = meta.get("fetched_at")
    next_fetch_in_minutes: Optional[int] = None
    if fetched_at_str:
        last_dt = datetime.fromisoformat(fetched_at_str)
        next_fetch_dt = last_dt + timedelta(hours=1)
        delta = next_fetch_dt - datetime.now(timezone.utc)
        next_fetch_in_minutes = max(0, int(delta.total_seconds() / 60))

    return {
        "fetched_at": fetched_at_str,
        "sources": meta.get("sources", []),
        "next_fetch_in_minutes": next_fetch_in_minutes,
    }


@api_router.post("/settings/api-keys")
async def save_api_key(api_key_data: APIKeyCreate):
    """Save or update an API key configuration."""
    key_dict = api_key_data.model_dump()
    key_dict['id'] = str(uuid.uuid4())
    key_dict['created_at'] = datetime.now(timezone.utc).isoformat()
    await db.api_keys.update_one(
        {"service_name": api_key_data.service_name},
        {"$set": key_dict},
        upsert=True,
    )
    return {"status": "success", "message": f"API key for {api_key_data.service_name} saved"}


@api_router.get("/settings/api-keys", response_model=List[APIKeyResponse])
async def get_api_keys():
    """Get all configured API keys (masked)."""
    keys = await db.api_keys.find({}, {"_id": 0}).to_list(100)
    masked_keys = []
    for key in keys:
        raw = key['api_key']
        masked = raw[:4] + "*" * (len(raw) - 8) + raw[-4:] if len(raw) > 8 else "****"
        masked_keys.append({"service_name": key['service_name'], "api_key_masked": masked})
    return masked_keys


@api_router.get("/stats")
async def get_stats():
    """Get aggregated casualty statistics."""
    conflicts = await db.conflicts.find({}, {"_id": 0}).to_list(1000)
    meta = await db.system_metadata.find_one({"key": "last_fetch"}, {"_id": 0})

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
        "total_conflicts": len(conflicts),
        "last_fetch_at": meta.get("fetched_at") if meta else None,
        "sources": meta.get("sources", []) if meta else [],
    }


# ─── App setup ────────────────────────────────────────────────────────────────

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

scheduler = AsyncIOScheduler()


@app.on_event("startup")
async def startup_event():
    await refresh_all_data()
    # Refresh from primary sources every hour
    scheduler.add_job(refresh_all_data, 'interval', hours=1)
    scheduler.start()
    logger.info("Scheduler started — data will refresh from primary sources every hour")


@app.on_event("shutdown")
async def shutdown_event():
    scheduler.shutdown()
    client.close()
    logger.info("Application shutdown complete")
