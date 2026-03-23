from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import json
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
UCDP_VERSION = "25.1"
# GED Candidate dataset — near-real-time monthly release, higher version number.
# Versions follow the pattern YY.0.M (e.g. 26.0.3 = March 2026).
# If the env var is not set we compute the two most recent plausible versions
# (current month + previous month) and probe for the latest available one at
# request time to avoid the hardcoded version going stale.
_UCDP_CANDIDATE_VERSION_OVERRIDE = os.environ.get("UCDP_CANDIDATE_VERSION", "")

def _candidate_versions_to_try() -> List[str]:
    """Return candidate version strings newest-first based on today's date."""
    today = datetime.now(timezone.utc).date()
    versions: List[str] = []
    for delta in range(3):            # current month, previous, two months back
        month = today.month - delta
        year  = today.year
        while month <= 0:
            month += 12
            year  -= 1
        versions.append(f"{year % 100}.0.{month}")
    return versions

# Country IDs for the UCDP API Country= parameter (Gleditsch-Ward codes).
# The parameter accepts comma-separated IDs, which is used where a conflict
# spans both an old and a current country code (e.g. Yemen pre/post unification).
UCDP_COUNTRY_MAP = {
    'Ukraine':        '369',
    'Gaza/Palestine': '666',        # Gaza events coded under Israel (GW 666)
    'Sudan':          '625',
    'Myanmar':        '775',
    'Syria':          '652',
    'Yemen':          '678,679',    # North Yemen (678) + unified Yemen (679)
    'Ethiopia':       '530',
    'DRC (Congo)':    '490',
    # Iran excluded: protest crackdowns and shadow-war events fall outside
    # UCDP's battle-deaths methodology; baseline figure is used instead.
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

# UCDP geographic region code → human-readable name
UCDP_REGION_MAP: Dict[int, str] = {
    1: "Europe",
    2: "Middle East",
    3: "Asia",
    4: "Africa",
    5: "Americas",
}

# In-memory cache for treemap data (refreshed hourly alongside other data)
_treemap_cache: Optional[Dict] = None

# Models
class ConflictData(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    country: str
    region: str
    total_deaths: int
    deaths_low: Optional[int] = None
    deaths_high: Optional[int] = None
    intensity_tier: str = "Low"
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



# ─── Live data fetching helpers ───────────────────────────────────────────────

def get_acled_credentials():
    """Return ACLED email and API key from environment variables."""
    email = os.environ.get("ACLED_EMAIL") or None
    key = os.environ.get("ACLED_KEY") or None
    return email, key


def get_ucdp_api_key() -> Optional[str]:
    """Return the UCDP access token from the UCDP_API_KEY environment variable."""
    return os.environ.get("UCDP_API_KEY") or None


async def fetch_ucdp_deaths_for_country(
    country_id: str,
    session: aiohttp.ClientSession,
    api_key: Optional[str] = None,
) -> Optional[Dict]:
    """Fetch cumulative deaths and actor names from the UCDP GED API for a country.

    Returns a dict with keys:
      total       – sum of best-estimate deaths across all events
      low         – sum of low-estimate deaths
      high        – sum of high-estimate deaths
      event_count – total number of GED events
      parties     – sorted list of unique side_a / side_b actor names

    country_id is a comma-separated string of Gleditsch-Ward country codes,
    e.g. '369' for Ukraine or '678,679' for Yemen (spans two GW codes).
    Sends x-ucdp-access-token when an API key is configured (required since Feb 2026).
    Paginates through all result pages.
    """
    try:
        url = f"{UCDP_API_BASE}/gedevents/{UCDP_VERSION}"
        headers: Dict[str, str] = {}
        if api_key:
            headers["x-ucdp-access-token"] = api_key
        page_size = 1000
        page = 1
        total = low = high = event_count = 0
        parties: set = set()
        while True:
            params = {"pagesize": page_size, "page": page, "Country": country_id}
            async with session.get(
                url, params=params, headers=headers, timeout=aiohttp.ClientTimeout(total=30)
            ) as resp:
                if resp.status != 200:
                    logger.warning(f"UCDP returned HTTP {resp.status} for country_id={country_id}")
                    break
                data = await resp.json()
                results = data.get("Result", [])
                if not results:
                    break
                event_count += len(results)
                for event in results:
                    total += int(event.get("best", 0) or 0)
                    low   += int(event.get("low",  0) or 0)
                    high  += int(event.get("high", 0) or 0)
                    for side in ("side_a", "side_b"):
                        name = (event.get(side) or "").strip()
                        if name:
                            parties.add(name)
                if len(results) < page_size:
                    break
                page += 1
        if total <= 0:
            return None
        logger.info(
            f"UCDP: country_id={country_id} → {total} deaths "
            f"(low={low}, high={high}, {event_count} events, {len(parties)} actors, {page} page(s))"
        )
        return {"total": total, "low": low, "high": high, "event_count": event_count, "parties": sorted(parties)}
    except Exception as e:
        logger.warning(f"UCDP fetch error for country_id={country_id}: {e}")
    return None


async def fetch_ucdp_data() -> Dict[str, Dict]:
    """Fetch UCDP GED data for all tracked conflicts.

    Returns {conflict_country: {"total": int, "low": int, "high": int, "parties": List[str]}}.
    """
    api_key = get_ucdp_api_key()
    results: Dict[str, Dict] = {}
    async with aiohttp.ClientSession(headers={"User-Agent": "WatchTower/1.0"}) as session:
        tasks = []
        keys = []
        for conflict_country, ucdp_country in UCDP_COUNTRY_MAP.items():
            keys.append(conflict_country)
            tasks.append(fetch_ucdp_deaths_for_country(ucdp_country, session, api_key))
        raw = await asyncio.gather(*tasks, return_exceptions=True)
        for key, item in zip(keys, raw):
            if isinstance(item, dict):
                results[key] = item
    logger.info(f"UCDP fetch complete: {len(results)}/{len(UCDP_COUNTRY_MAP)} countries updated")
    return results


def compute_intensity_tier(event_count: int, total_deaths: int) -> str:
    """Derive a conflict intensity tier from GED event count and total deaths.

    When UCDP event data is available the score combines activity volume
    (events) and lethality (deaths-per-event).  When only deaths are known
    (no UCDP coverage) a deaths-only threshold is used as a fallback.

    Tiers: Critical · High · Medium · Low
    """
    if event_count > 0:
        death_rate = total_deaths / event_count          # deaths per event
        score = (event_count / 100) + (death_rate * 2)  # weighted composite
        if score >= 50 or total_deaths >= 100_000:
            return "Critical"
        if score >= 10 or total_deaths >= 20_000:
            return "High"
        if score >= 2 or total_deaths >= 5_000:
            return "Medium"
        return "Low"
    # Deaths-only fallback (no UCDP coverage)
    if total_deaths >= 100_000:
        return "Critical"
    if total_deaths >= 20_000:
        return "High"
    if total_deaths >= 5_000:
        return "Medium"
    return "Low"


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


async def scrape_hengaw_iran_deaths() -> Optional[int]:
    """
    Scrape Hengaw war casualty reports for total deaths in Iran.
    Tries the most recent article numbers first, falls back to earlier ones.
    Returns total killed if found, None otherwise.
    """
    # Probe from high to low — Hengaw increments article numbers per report
    article_numbers = list(range(25, 4, -1))
    urls_to_try = [
        f"https://hengaw.net/en/reports-and-statistics-1/2026/03/article-{n}"
        for n in article_numbers
    ]
    patterns = [
        r'(\d[\d,]+)\s+killed(?:,|\s+in|\s+including)',
        r'death\s+toll\s+(?:reaches?|hits?)\s+(\d[\d,]+)',
        r'at\s+least\s+(\d[\d,]+)\s+(?:people\s+)?(?:had\s+been\s+)?killed',
        r'(\d[\d,]+)\s+people\s+(?:had\s+been\s+)?killed',
        r'total(?:.*?)(\d[\d,]+)(?:\s+killed|\s+dead)',
    ]
    try:
        async with aiohttp.ClientSession(headers={"User-Agent": "Mozilla/5.0 (compatible; WatchTower/1.0)"}) as session:
            for url in urls_to_try:
                try:
                    async with session.get(url, timeout=aiohttp.ClientTimeout(total=20)) as resp:
                        if resp.status != 200:
                            continue
                        html = await resp.text()
                        text = BeautifulSoup(html, 'lxml').get_text(" ", strip=True)
                        for pattern in patterns:
                            match = re.search(pattern, text, re.IGNORECASE)
                            if match:
                                num = int(match.group(1).replace(',', ''))
                                if 1_000 < num < 200_000:
                                    logger.info(f"Hengaw Iran war deaths: {num} (from {url})")
                                    return num
                except Exception as e:
                    logger.warning(f"Hengaw scrape attempt failed for {url}: {e}")
    except Exception as e:
        logger.warning(f"Hengaw Iran scrape error: {e}")
    return None


async def scrape_ihr_iran_deaths() -> Optional[int]:
    """
    Scrape Iran Human Rights (IHR) annual report for total execution count.
    Used as fallback if Hengaw war data is unavailable.
    Returns total executions if found, None otherwise.
    """
    urls_to_try = [
        "https://iranhr.net/en/reports/42/",   # 2024 annual report (975 executions)
        "https://iranhr.net/en/articles/",
    ]
    patterns = [
        r'at\s+least\s+(\d[\d,]+)\s+people\s+were\s+executed',
        r'(\d[\d,]+)\s+people\s+were\s+executed',
        r'(\d[\d,]+)\s+executions?\s+(?:in|recorded|were)',
        r'executed\s+(?:at\s+least\s+)?(\d[\d,]+)',
    ]
    try:
        async with aiohttp.ClientSession(headers={"User-Agent": "Mozilla/5.0 (compatible; WatchTower/1.0)"}) as session:
            for url in urls_to_try:
                try:
                    async with session.get(url, timeout=aiohttp.ClientTimeout(total=20)) as resp:
                        if resp.status != 200:
                            continue
                        html = await resp.text()
                        text = BeautifulSoup(html, 'lxml').get_text(" ", strip=True)
                        for pattern in patterns:
                            match = re.search(pattern, text, re.IGNORECASE)
                            if match:
                                num = int(match.group(1).replace(',', ''))
                                if 100 < num < 5_000:
                                    logger.info(f"IHR Iran executions: {num} (from {url})")
                                    return num
                except Exception as e:
                    logger.warning(f"IHR scrape attempt failed for {url}: {e}")
    except Exception as e:
        logger.warning(f"IHR Iran scrape error: {e}")
    return None


async def update_last_fetch_metadata(sources_used: List[str], chart_sources: Optional[List[str]] = None):
    """Store the timestamp of the most recent successful live data fetch."""
    now = datetime.now(timezone.utc)
    await db.system_metadata.update_one(
        {"key": "last_fetch"},
        {"$set": {
            "key": "last_fetch",
            "fetched_at": now.isoformat(),
            "sources": sources_used,
            "chart_sources": chart_sources if chart_sources is not None else sources_used,
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
        'status': 'active',
        'escalation_date': '2022-02-24',   # Full-scale Russian invasion
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
        'status': 'active',
        'escalation_date': '2023-10-07',   # Hamas attack / Israeli ground operation
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
        'status': 'active',
        'escalation_date': '2023-04-15',   # SAF–RSF fighting erupted
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
        'status': 'active',
        'escalation_date': '2023-10-27',   # Operation 1027 — AA/MNDAA/TNL offensive
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
        'status': 'active',
        'escalation_date': '2024-11-27',   # HTS/rebel offensive; Assad fell Dec 2024
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
        'status': 'active',
        'escalation_date': '2024-01-11',   # US/UK airstrikes on Houthi targets began
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
        'status': 'active',
        'escalation_date': '2024-02-01',   # Amhara/Fano offensive resumed
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
        'status': 'active',
        'escalation_date': '2025-01-27',   # M23 captured Goma
    },
    {
        'country': 'Iran',
        'region': 'Middle East',
        'total_deaths': 5900,
        'civilian_deaths': 595,
        'military_deaths': 5305,
        'children_deaths': 127,
        'description': 'US-Israeli air and missile strikes on Iranian military infrastructure beginning February 2026, targeting sites across 26 provinces. Preceded by years of internal repression, protest crackdowns, shadow-war assassinations, and Kurdish insurgencies.',
        'countries_involved': ['Iran', 'Israel', 'United States'],
        'parties_involved': ['IRGC', 'Iranian Armed Forces', 'Basij Militia', 'Israeli Air Force', 'US Forces', 'Kurdish Democratic Party of Iran (KDPI)', 'PJAK', 'Iranian Opposition Groups'],
        'data_sources': ['Hengaw', 'Iran Human Rights (IHR)', 'Amnesty International', 'UN Human Rights'],
        'status': 'active',
        'escalation_date': '2026-02-01',   # US-Israeli airstrikes began
    }
]


def _build_records(
    now: datetime,
    primary_deaths: Dict[str, int],
    ohchr_ukraine_civilian: Optional[int],
    ocha_gaza_total: Optional[int],
    iran_total: Optional[int] = None,
    ucdp_rich: Optional[Dict[str, Dict]] = None,
) -> list:
    """
    Merge live death figures into baseline conflict records.
    primary_deaths: dict of country -> total deaths from the desired source(s).
    """
    conflicts = []
    for base in BASELINE_CONFLICTS:
        record = dict(base)
        country = record['country']
        record['id'] = str(uuid.uuid4())
        record['last_updated'] = now.isoformat()
        record['deaths_low'] = None
        record['deaths_high'] = None

        # Apply UCDP uncertainty bands and live actor names when available
        ucdp_event_count = 0
        if ucdp_rich and country in ucdp_rich:
            ucdp = ucdp_rich[country]
            record['deaths_low'] = ucdp.get('low') or None
            record['deaths_high'] = ucdp.get('high') or None
            ucdp_event_count = ucdp.get('event_count', 0) or 0
            if ucdp.get('parties'):
                record['parties_involved'] = ucdp['parties']

        live_total: Optional[int] = primary_deaths.get(country)

        if live_total is not None:
            old_total = record['total_deaths']
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

        # Override Iran total deaths with Hengaw/IHR figure if available
        if country == 'Iran' and isinstance(iran_total, int):
            old_total = record['total_deaths']
            record['total_deaths'] = iran_total
            if old_total > 0:
                civ_ratio = record['civilian_deaths'] / old_total
                mil_ratio = record['military_deaths'] / old_total
                child_ratio = record['children_deaths'] / old_total
                record['civilian_deaths'] = int(iran_total * civ_ratio)
                record['military_deaths'] = int(iran_total * mil_ratio)
                record['children_deaths'] = int(iran_total * child_ratio)

        # Compute intensity tier after all death figures are finalised
        record['intensity_tier'] = compute_intensity_tier(ucdp_event_count, record['total_deaths'])

        conflicts.append(record)
    return conflicts


async def scrape_conflict_data():
    """
    Build conflict records by querying live primary sources (ACLED, UCDP, OHCHR/OCHA).
    Falls back gracefully to baseline figures when live sources are unavailable.

    Two parallel datasets are produced:
      - conflicts       (ACLED > UCDP priority) — used by the table and stat cards
      - chart_conflicts (UCDP + OHCHR/OCHA only) — used by Casualty Breakdown and
                         Deaths by Country charts
    """
    now = datetime.now(timezone.utc)
    sources_used: List[str] = []

    # ── 1. Try ACLED (highest-quality, requires stored credentials) ──────────
    acled_deaths: Dict[str, int] = {}
    acled_email, acled_key = get_acled_credentials()
    if acled_email and acled_key:
        try:
            acled_deaths = await fetch_acled_data(acled_email, acled_key)
            if acled_deaths:
                sources_used.append("ACLED")
        except Exception as e:
            logger.error(f"ACLED data fetch failed: {e}")

    # ── 2. UCDP free API as fallback / supplement ────────────────────────────
    ucdp_rich: Dict[str, Dict] = {}       # full GED data: total/low/high/parties
    ucdp_totals: Dict[str, int] = {}      # just the best-estimate totals for _build_records
    try:
        ucdp_rich = await fetch_ucdp_data()
        if ucdp_rich:
            ucdp_totals = {k: v["total"] for k, v in ucdp_rich.items()}
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

    # ── 4. Hengaw/IHR scraping for Iran total deaths ─────────────────────────
    iran_total: Optional[int] = None
    try:
        iran_total = await scrape_hengaw_iran_deaths()
        if not isinstance(iran_total, int):
            iran_total = await scrape_ihr_iran_deaths()
        if isinstance(iran_total, int):
            sources_used.append("Hengaw/IHR")
    except Exception as e:
        logger.error(f"Hengaw/IHR Iran scrape failed: {e}")

    if not sources_used:
        sources_used.append("Baseline (live sources unavailable)")
        logger.warning("All live sources failed — using baseline conflict data")

    # ── 5. Build main conflicts (ACLED > UCDP priority) ──────────────────────
    acled_or_ucdp: Dict[str, int] = {**ucdp_totals, **acled_deaths}  # ACLED wins on overlap
    conflicts = _build_records(now, acled_or_ucdp, ohchr_ukraine_civilian, ocha_gaza_total, iran_total, ucdp_rich=ucdp_rich)

    # ── 6. Build chart-only conflicts (UCDP + OHCHR/OCHA + Hengaw/IHR, no ACLED) ──
    chart_conflicts = _build_records(now, ucdp_totals, ohchr_ukraine_civilian, ocha_gaza_total, iran_total, ucdp_rich=ucdp_rich)
    # Chart sources are always UCDP + OHCHR/OCHA — those are the chart data architecture.
    # The baseline figures are themselves derived from UCDP/OHCHR/OCHA at a fixed point in
    # time, so even when live fetches fail the attribution stays correct.
    ucdp_ohchr_active = [s for s in sources_used if s not in ("ACLED", "Baseline (live sources unavailable)")]
    chart_sources = ucdp_ohchr_active if ucdp_ohchr_active else ["UCDP", "OHCHR/OCHA", "Hengaw/IHR"]

    # ── 6. Persist ────────────────────────────────────────────────────────────
    await db.conflicts.delete_many({})
    await db.conflicts.insert_many(conflicts)

    await db.chart_conflicts.delete_many({})
    await db.chart_conflicts.insert_many(chart_conflicts)

    logger.info(f"Stored {len(conflicts)} conflict records (sources: {', '.join(sources_used)})")
    logger.info(f"Stored {len(chart_conflicts)} chart-only records (sources: {', '.join(chart_sources)})")

    await update_last_fetch_metadata(sources_used, chart_sources)
    return conflicts


# ─── Treemap / Human Cost data ────────────────────────────────────────────────

async def fetch_treemap_data() -> Dict:
    """
    Fetch the full UCDP battledeaths dataset and aggregate per conflict for the
    Human Cost treemap.

    Aggregates dyad-year rows into conflict-level totals:
      - total_deaths  : sum of bd_best across all years and dyads
      - last_year     : most recent year with recorded deaths (drives tile colour)
      - region        : UCDP geographic region code → name

    Result is cached in _treemap_cache and refreshed hourly.
    """
    global _treemap_cache

    api_key = get_ucdp_api_key()
    headers = {"x-ucdp-access-token": api_key} if api_key else {}
    url = f"{UCDP_API_BASE}/battledeaths/{UCDP_VERSION}"

    # conflict_id → aggregated record
    conflict_agg: Dict[int, Dict] = {}

    page = 1
    total_pages = 1
    timeout = aiohttp.ClientTimeout(total=180)

    async with aiohttp.ClientSession(timeout=timeout) as session:
        while page <= total_pages:
            params: Dict = {"pagesize": 1000, "page": page}
            try:
                async with session.get(url, params=params, headers=headers) as resp:
                    if resp.status != 200:
                        body = await resp.text()
                        logger.error(
                            f"UCDP battledeaths API error page {page}: "
                            f"HTTP {resp.status} — {body[:200]}"
                        )
                        break
                    payload = await resp.json()
            except Exception as exc:
                logger.error(f"Error fetching UCDP battledeaths page {page}: {exc}")
                break

            total_pages = payload.get("totalpages", 1)
            records = payload.get("Result", [])
            logger.info(
                f"Treemap fetch: page {page}/{total_pages}, "
                f"{len(records)} records"
            )

            for rec in records:
                cid = rec.get("conflict_id")
                if cid is None:
                    continue

                bd = float(rec.get("bd_best") or 0)
                year = int(rec.get("year") or 0)
                region_raw = rec.get("region")
                # region can be int or string depending on API version
                try:
                    region_code = int(region_raw) if region_raw is not None else 0
                except (ValueError, TypeError):
                    region_code = 0

                if cid not in conflict_agg:
                    # UCDP battledeaths rows may not carry conflict_name; fall back
                    # to the 'name' field, then construct "Side A – Side B".
                    conf_name = (
                        rec.get("conflict_name")
                        or rec.get("name")
                        or (
                            f"{rec['side_a']} – {rec['side_b']}"
                            if rec.get("side_a") and rec.get("side_b")
                            else rec.get("side_a") or rec.get("side_b")
                        )
                        or f"Conflict {cid}"
                    )
                    conflict_agg[cid] = {
                        "conflict_id": cid,
                        "name": conf_name,
                        "location": rec.get("location", ""),
                        "region_code": region_code,
                        "total_deaths": 0.0,
                        "last_year": 0,
                    }

                conflict_agg[cid]["total_deaths"] += bd
                if year > conflict_agg[cid]["last_year"]:
                    conflict_agg[cid]["last_year"] = year

            page += 1

    # Discard conflicts with no recorded deaths
    conflicts = [c for c in conflict_agg.values() if c["total_deaths"] > 0]

    # Finalise types
    for c in conflicts:
        c["total_deaths"] = int(round(c["total_deaths"]))
        region_name = UCDP_REGION_MAP.get(c["region_code"], f"Other")
        c["region"] = region_name
        del c["region_code"]

    # Group into regions
    region_map: Dict[str, Dict] = {}
    for c in conflicts:
        rname = c["region"]
        if rname not in region_map:
            region_map[rname] = {
                "name": rname,
                "total_deaths": 0,
                "last_year": 0,
                "conflicts": [],
            }
        region_map[rname]["total_deaths"] += c["total_deaths"]
        if c["last_year"] > region_map[rname]["last_year"]:
            region_map[rname]["last_year"] = c["last_year"]
        region_map[rname]["conflicts"].append(c)

    # Sort conflicts within each region by deaths descending
    for r in region_map.values():
        r["conflicts"].sort(key=lambda x: x["total_deaths"], reverse=True)

    # Sort regions by deaths descending
    sorted_regions = sorted(
        region_map.values(), key=lambda x: x["total_deaths"], reverse=True
    )

    result = {
        "regions": sorted_regions,
        "total_conflicts": len(conflicts),
        "total_deaths": sum(c["total_deaths"] for c in conflicts),
        "year_range": [
            min((c["last_year"] for c in conflicts), default=1946),
            max((c["last_year"] for c in conflicts), default=2024),
        ],
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }

    _treemap_cache = result
    logger.info(
        f"Treemap cache updated: {len(conflicts)} conflicts across "
        f"{len(sorted_regions)} regions, "
        f"total deaths = {result['total_deaths']:,}"
    )
    return result


# ─── Background refresh task ──────────────────────────────────────────────────

async def refresh_all_data():
    """Refresh news, conflict casualty data, and treemap from primary sources."""
    logger.info("Starting hourly data refresh…")
    try:
        await fetch_rss_feeds()
        await scrape_conflict_data()
        await fetch_treemap_data()
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
        "chart_sources": meta.get("chart_sources", meta.get("sources", [])),
        "next_fetch_in_minutes": next_fetch_in_minutes,
    }



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


@api_router.get("/chart-conflicts", response_model=List[ConflictData])
async def get_chart_conflicts():
    """Get conflict data built from UCDP + OHCHR/OCHA only (used by charts)."""
    conflicts = await db.chart_conflicts.find({}, {"_id": 0}).to_list(1000)
    for conflict in conflicts:
        if isinstance(conflict.get('last_updated'), str):
            conflict['last_updated'] = datetime.fromisoformat(conflict['last_updated'])
    return conflicts



@api_router.get("/treemap")
async def get_treemap():
    """
    Return UCDP battledeaths aggregated by conflict for the Human Cost treemap.

    Response shape:
    {
        "regions": [
            {
                "name": "Africa",
                "total_deaths": 1500000,
                "last_year": 2023,
                "conflicts": [
                    {"conflict_id": 123, "name": "...", "total_deaths": 500000,
                     "last_year": 2022, "location": "Ethiopia", "region": "Africa"},
                    ...
                ]
            },
            ...
        ],
        "total_conflicts": 245,
        "total_deaths": 8500000,
        "year_range": [1946, 2023],
        "fetched_at": "..."
    }
    """
    global _treemap_cache
    if _treemap_cache is not None:
        return _treemap_cache

    # Cache miss — fetch synchronously on first request
    try:
        return await fetch_treemap_data()
    except Exception as exc:
        logger.error(f"Treemap fetch failed: {exc}")
        raise HTTPException(status_code=503, detail="Unable to fetch treemap data from UCDP")


@api_router.get("/chart-stats")
async def get_chart_stats():
    """Aggregated casualty stats from UCDP + OHCHR/OCHA data only (used by charts)."""
    conflicts = await db.chart_conflicts.find({}, {"_id": 0}).to_list(1000)
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
        "sources": meta.get("chart_sources", meta.get("sources", [])) if meta else [],
    }


# ─── Humanitarian Clock ────────────────────────────────────────────────────────

# Iran is excluded from the main UCDP_COUNTRY_MAP (protest/shadow-war events
# fall outside GED's battle-deaths methodology) but is valid for the clock's
# "last significant escalation" signal (e.g. Baluchistan, IRGC border ops).
CLOCK_COUNTRY_MAP: Dict[str, str] = {
    **UCDP_COUNTRY_MAP,
    'Iran': '630',
}

async def _fetch_acled_clock_events(
    session: aiohttp.ClientSession,
    email: str,
    api_key: str,
    country_name: str,
    start_date: str,
    end_date: str,
) -> List[Dict]:
    """Fetch ACLED events with fatalities for a country in a date range.

    Returns events as {"date_start": "YYYY-MM-DD", "best": N, "conflict_name": str}
    so the rest of the clock logic (daily map → 7-day window) is reusable.
    """
    try:
        async with session.get(
            "https://api.acleddata.com/acled/read",
            params={
                "key":               api_key,
                "email":             email,
                "country":           country_name,
                "event_date":        f"{start_date}|{end_date}",
                "event_date_where":  "BETWEEN",
                "fields":            "event_date|fatalities|country",
                "limit":             0,
            },
            timeout=aiohttp.ClientTimeout(total=60),
        ) as resp:
            if resp.status != 200:
                logger.warning(f"ACLED clock HTTP {resp.status} for {country_name}")
                return []
            data = await resp.json()
            events = []
            for e in data.get("data", []):
                fat = int(e.get("fatalities", 0) or 0)
                if fat > 0:
                    events.append({
                        "date_start":    (e.get("event_date") or "")[:10],
                        "best":          fat,
                        "conflict_name": e.get("country", country_name),
                    })
            logger.info(
                f"ACLED clock: {country_name} → {len(events)} events "
                f"with fatalities in [{start_date}, {end_date}]"
            )
            return events
    except Exception as exc:
        logger.warning(f"ACLED clock error for {country_name}: {exc}")
        return []


async def _fetch_clock_events(
    session: aiohttp.ClientSession,
    hdrs: Dict[str, str],
    country_code: str,
    start_date: str,
    end_date: str,
    version: str = "",
) -> List[Dict]:
    """Fetch all GED Candidate events for a country over a date range."""
    url = f"{UCDP_API_BASE}/gedevents/{version or _UCDP_CANDIDATE_VERSION_OVERRIDE or _candidate_versions_to_try()[0]}"
    all_events: List[Dict] = []
    pg = 1
    while True:
        try:
            async with session.get(
                url,
                params={
                    "Country":   country_code,
                    "StartDate": start_date,
                    "EndDate":   end_date,
                    "pagesize":  1000,
                    "page":      pg,
                },
                headers=hdrs,
                timeout=aiohttp.ClientTimeout(total=45),
            ) as resp:
                if resp.status != 200:
                    logger.warning(
                        f"Clock events HTTP {resp.status} country={country_code} page={pg}"
                    )
                    break
                data = await resp.json()
                results = data.get("Result", [])
                all_events.extend(results)
                if len(results) < 1000:
                    break
                pg += 1
        except Exception as exc:
            logger.warning(f"Clock events error country={country_code}: {exc}")
            break
    return all_events


@api_router.get("/humanitarian-clock")
async def get_humanitarian_clock(
    threshold: int = 25,
    lookback_days: int = 90,
):
    """Humanitarian Clock — Time-Since-Escalation.

    For each monitored conflict, fetches recent events over the past
    `lookback_days` and slides a 7-day window backward from today to find the
    most recent period where battle/civilian deaths exceeded `threshold`.

    Source priority:
      1. ACLED (near-real-time, daily updates) — used when ACLED_EMAIL + ACLED_KEY are set
      2. UCDP GED Candidate (monthly release)   — used when ACLED is unavailable

    Returns conflicts sorted by days_since_escalation ascending so the most
    urgent appear first. Conflicts near zero are actively escalating; those
    approaching lookback_days are cooling.  When neither source can be reached
    the response includes source_available=false so the UI can show a clear
    error rather than a misleading all-cooling chart.

    threshold    – min deaths in a 7-day window to qualify as significant
    lookback_days – how far back to search (default 90)
    """
    today      = datetime.now(timezone.utc).date()
    start_date = (today - timedelta(days=lookback_days)).isoformat()
    end_date   = today.isoformat()

    acled_email, acled_key = get_acled_credentials()
    ucdp_api_key = get_ucdp_api_key()
    ucdp_hdrs: Dict[str, str] = {}
    if ucdp_api_key:
        ucdp_hdrs["x-ucdp-access-token"] = ucdp_api_key

    country_items = list(ACLED_COUNTRY_MAP.items())  # country label → ACLED name
    # UCDP GW codes for Candidate fallback (include Iran)
    clock_ucdp_map = {**UCDP_COUNTRY_MAP, 'Iran': '630'}

    data_source = "unavailable"

    async with aiohttp.ClientSession(headers={"User-Agent": "WatchTower/1.0"}) as session:

        # ── 1. Try ACLED first (near-real-time, daily data) ───────────────────
        if acled_email and acled_key:
            raw_results = await asyncio.gather(*[
                _fetch_acled_clock_events(
                    session, acled_email, acled_key,
                    acled_name, start_date, end_date,
                )
                for _, acled_name in country_items
            ])
            # Accept ACLED if at least one country returned events
            if any(raw_results):
                data_source = "ACLED"
                logger.info("Humanitarian clock: using ACLED as data source")
            else:
                logger.warning("Humanitarian clock: ACLED returned no events, trying UCDP Candidate")
                raw_results = None
        else:
            raw_results = None

        # ── 2. UCDP GED Candidate (monthly release) ──────────────────────────
        if raw_results is None:
            if _UCDP_CANDIDATE_VERSION_OVERRIDE:
                active_version = _UCDP_CANDIDATE_VERSION_OVERRIDE
            else:
                active_version = _candidate_versions_to_try()[-1]
                for v in _candidate_versions_to_try():
                    try:
                        async with session.get(
                            f"{UCDP_API_BASE}/gedevents/{v}",
                            params={"Country": "369", "pagesize": 1, "page": 1},
                            headers=ucdp_hdrs,
                            timeout=aiohttp.ClientTimeout(total=10),
                        ) as probe_resp:
                            if probe_resp.status == 200:
                                body = await probe_resp.json()
                                if body.get("Result") is not None:
                                    active_version = v
                                    break
                    except Exception:
                        pass

            logger.info(f"Humanitarian clock: trying UCDP Candidate version {active_version}")
            ucdp_country_items = [(k, clock_ucdp_map[k]) for k in ACLED_COUNTRY_MAP if k in clock_ucdp_map]
            ucdp_raw = await asyncio.gather(*[
                _fetch_clock_events(session, ucdp_hdrs, gw_code, start_date, end_date, version=active_version)
                for _, gw_code in ucdp_country_items
            ])
            if any(ucdp_raw):
                data_source = f"UCDP GED Candidate {active_version}"
                country_items = ucdp_country_items
                raw_results = ucdp_raw
                logger.info(f"Humanitarian clock: using UCDP Candidate {active_version}")
            else:
                logger.warning("Humanitarian clock: UCDP Candidate returned no events, trying stable GED")
                raw_results = None

        # ── 3. Fall back to stable UCDP GED v25.1 (relative mode) ────────────
        # The stable dataset ends ~Dec 2024; "days_since" is computed relative
        # to the dataset's own last event date, not today, so ongoing conflicts
        # still show meaningful escalation recency.
        if raw_results is None:
            stable_start = (today - timedelta(days=730)).isoformat()   # 2 years back
            ucdp_country_items = [(k, clock_ucdp_map[k]) for k in ACLED_COUNTRY_MAP if k in clock_ucdp_map]
            ucdp_raw = await asyncio.gather(*[
                _fetch_clock_events(
                    session, ucdp_hdrs, gw_code,
                    stable_start, end_date,
                    version=UCDP_VERSION,
                )
                for _, gw_code in ucdp_country_items
            ])
            if any(ucdp_raw):
                data_source = f"UCDP GED {UCDP_VERSION} (relative)"
                country_items = ucdp_country_items
                raw_results = ucdp_raw
                logger.info(f"Humanitarian clock: using stable UCDP GED {UCDP_VERSION} in relative mode")
            else:
                logger.warning("Humanitarian clock: stable GED also returned no events")
                raw_results = [[] for _ in country_items]

    # In relative mode (stable GED fallback), compute days_since relative to
    # the dataset's own last event date so ongoing conflicts aren't all "cooling".
    relative_mode = data_source.endswith("(relative)")
    if relative_mode:
        all_dates = [
            (ev.get("date_start") or "")[:10]
            for evs in raw_results for ev in evs
            if (ev.get("date_start") or "")[:10]
        ]
        try:
            dataset_end = max(datetime.fromisoformat(d).date() for d in all_dates if d)
        except (ValueError, TypeError):
            dataset_end = today
        effective_lookback = (today - dataset_end).days + lookback_days
    else:
        dataset_end = today
        effective_lookback = lookback_days

    # Build a lookup of known escalation dates from the static baseline so we
    # can fall back to them when no API events qualify for a country.
    static_escalation: Dict[str, str] = {
        entry["country"]: entry["escalation_date"]
        for entry in BASELINE_CONFLICTS
        if entry.get("status") == "active" and entry.get("escalation_date")
    }

    conflicts: List[Dict] = []
    for (country, _), events in zip(country_items, raw_results):
        if not events:
            # No API events at all — check static baseline before giving up
            static_esc_date = None
            static_days = effective_lookback
            if country in static_escalation:
                try:
                    static_dt = datetime.fromisoformat(static_escalation[country]).date()
                    static_days = (today - static_dt).days
                    static_esc_date = static_escalation[country]
                except ValueError:
                    pass
            conflicts.append({
                    "country":               country,
                    "conflict_name":         country,
                    "days_since_escalation": min(static_days, effective_lookback),
                    "last_escalation_date":  static_esc_date,
                    "recent_best_deaths":    0,
                    "total_events":          0,
                    "total_best_deaths":     0,
                    "status":                (
                        "escalating" if static_days <= 7 else
                        "watch"      if static_days <= 21 else
                        "cooling"
                    ),
                    "escalation_from_baseline": static_esc_date is not None,
                })
            continue

        # Build a daily death-count map  (date_str → total best)
        daily: Dict[str, int] = {}
        for ev in events:
            ds = (ev.get("date_start") or "")[:10]
            if ds:
                daily[ds] = daily.get(ds, 0) + int(ev.get("best") or 0)

        dates = sorted(daily.keys(), reverse=True)   # newest first

        # Slide a 7-day window from most recent date backward, find first
        # window whose cumulative deaths >= threshold
        WINDOW = 7
        last_escalation_date: Optional[str] = None
        last_deaths = 0

        for anchor in dates:
            try:
                anchor_dt = datetime.fromisoformat(anchor).date()
            except ValueError:
                continue
            window_start = anchor_dt - timedelta(days=WINDOW)
            w_total = sum(
                v for d, v in daily.items()
                if window_start <= datetime.fromisoformat(d).date() <= anchor_dt
            )
            if w_total >= threshold:
                last_escalation_date = anchor
                last_deaths = w_total
                break

        if last_escalation_date:
            try:
                ref_date = dataset_end  # relative to dataset end, not today
                days_since = (ref_date - datetime.fromisoformat(last_escalation_date).date()).days
            except ValueError:
                days_since = effective_lookback
        else:
            days_since = effective_lookback

        days_since = min(days_since, effective_lookback)

        # ── Static-baseline fallback ──────────────────────────────────────────
        # If no API event qualified (days_since == effective_lookback), check
        # whether the static baseline records a known escalation date that is
        # more recent.  This covers conflicts like Iran whose major 2026
        # escalation post-dates all current UCDP dataset releases.
        escalation_from_baseline = False
        if days_since >= effective_lookback and country in static_escalation:
            try:
                static_dt = datetime.fromisoformat(static_escalation[country]).date()
                static_days = (today - static_dt).days
                if static_days < days_since:
                    last_escalation_date = static_escalation[country]
                    days_since = static_days
                    escalation_from_baseline = True
            except ValueError:
                pass

        conflict_name = (events[0].get("conflict_name") if events else None) or country
        total_best    = sum(int(ev.get("best") or 0) for ev in events)
        status = (
            "escalating" if days_since <= 7 else
            "watch"      if days_since <= 21 else
            "cooling"
        )

        conflicts.append({
            "country":               country,
            "conflict_name":         conflict_name,
            "days_since_escalation": days_since,
            "last_escalation_date":  last_escalation_date,
            "recent_best_deaths":    last_deaths,
            "total_events":          len(events),
            "total_best_deaths":     total_best,
            "status":                status,
            "escalation_from_baseline": escalation_from_baseline,
        })

    conflicts.sort(key=lambda c: c["days_since_escalation"])
    source_available = data_source != "unavailable"
    logger.info(
        f"Humanitarian clock: {len(conflicts)} conflicts, "
        f"threshold={threshold}, lookback={lookback_days}d, "
        f"source={data_source}"
    )

    return {
        "generated_at":    datetime.now(timezone.utc).isoformat(),
        "lookback_days":   effective_lookback,
        "threshold":       threshold,
        "data_source":     data_source,
        "source_available": source_available,
        "relative_mode":   relative_mode,
        "dataset_end_date": dataset_end.isoformat() if relative_mode else None,
        "conflicts":       conflicts if source_available else [],
    }



# ─── Actor Relationship Network ────────────────────────────────────────────────

_actor_network_cache: Optional[Dict] = None
_actor_network_cache_ts: Optional[datetime] = None
_ACTOR_CACHE_TTL = 3600  # 1 hour — same cadence as main data refresh


def _classify_actor_type(name: str) -> str:
    """Map a UCDP actor name to a display category via keyword heuristics."""
    n = (name or "").lower()
    if any(k in n for k in [
        'government of', 'armed forces of', 'military of', 'national army',
        'national defence', 'national defense', 'air force', 'naval force',
        'security forces', 'border guard', 'police', 'gendarmerie',
        'presidential guard', 'national guard', 'ministry of defence',
        'ministry of defense', 'state forces',
    ]):
        return 'government'
    if any(k in n for k in [
        'al-qaeda', 'al qaeda', 'al-qai', 'islamic state', 'isis', 'isil',
        'daesh', 'al-shabaab', 'boko haram', 'jabhat', 'hay\'at tahrir',
        'hayat tahrir', 'jma\'a', 'jamaa', 'ansar al-', 'ahrar al-',
        'hizb-i islami', 'lashkar',
    ]):
        return 'jihadist'
    if any(k in n for k in [
        'militia', 'janjaweed', 'pro-government', 'loyalist', 'paramilitary',
        'wagner', 'auxiliary', 'interahamwe', 'self-defense force',
        'civil defense', 'rapid support', 'shabiha',
    ]):
        return 'militia'
    if any(k in n for k in [
        'liberation', 'resistance', 'rebel', 'opposition', 'revolutionary',
        'insurgent', 'freedom fighters', 'separatist', 'secessionist',
        'partisan', ' front', 'national union', 'people\'s defense',
        'democratic forces', 'movement (', ' army (', 'kna', 'knla',
        'pjak', 'pkk', 'tnla', 'arakan army', 'kia (', 'pdf (',
    ]):
        return 'rebel'
    if any(k in n for k in ['civilians', 'unknown', 'unidentified', 'communal', 'ethnic group']):
        return 'civilian-targeting'
    return 'other'


async def _fetch_ucdp_all_pages(
    session: aiohttp.ClientSession,
    endpoint: str,
    hdrs: Dict,
    extra_params: Optional[Dict] = None,
) -> List[Dict]:
    """Paginate through a UCDP API endpoint and return every record."""
    all_results: List[Dict] = []
    pg = 1
    while True:
        params = {"pagesize": 1000, "page": pg, **(extra_params or {})}
        try:
            async with session.get(
                f"{UCDP_API_BASE}/{endpoint}",
                params=params,
                headers=hdrs,
                timeout=aiohttp.ClientTimeout(total=60),
            ) as resp:
                if resp.status != 200:
                    logger.warning(f"UCDP {endpoint} HTTP {resp.status} page {pg}")
                    break
                data = await resp.json()
                results = data.get("Result", [])
                all_results.extend(results)
                logger.debug(f"UCDP {endpoint} page {pg}: {len(results)} records")
                if len(results) < 1000:
                    break
                pg += 1
        except Exception as exc:
            logger.warning(f"UCDP {endpoint} page {pg} error: {exc}")
            break
    return all_results


@api_router.get("/actor-network")
async def get_actor_network():
    """Actor Relationship Network — directed dyadic conflict graph.

    Returns every UCDP dyad-year record from the Dyadic and Non-State
    datasets (full history).  The frontend handles year-range and minimum-
    deaths filtering client-side for instant temporal scrubbing without
    additional round-trips.

    Each record:
      side_a / side_b     — actor names
      side_a_type / side_b_type — classified actor category
      bd_best             — battle deaths best estimate for that year
      year                — calendar year
      conflict_name       — human-readable label
      region              — UCDP region string
      source              — 'dyadic' | 'nonstate'
    """
    global _actor_network_cache, _actor_network_cache_ts

    now = datetime.now(timezone.utc)
    if (
        _actor_network_cache is not None
        and _actor_network_cache_ts is not None
        and (now - _actor_network_cache_ts).total_seconds() < _ACTOR_CACHE_TTL
    ):
        return _actor_network_cache

    ucdp_api_key = get_ucdp_api_key()
    hdrs: Dict[str, str] = {}
    if ucdp_api_key:
        hdrs["x-ucdp-access-token"] = ucdp_api_key

    dyads: List[Dict] = []
    data_sources: List[str] = []

    async with aiohttp.ClientSession(headers={"User-Agent": "WatchTower/1.0"}) as session:

        # ── 1. State-based dyads via GED gedevents (ucdpdy is not a public endpoint)
        # Fetch GED events per monitored country, then aggregate by (dyad_name, year).
        # GED events carry side_a, side_b, dyad_name, best (deaths), date_start.
        try:
            # All countries in the clock map (includes Iran GW=630)
            all_gw_codes = list({**UCDP_COUNTRY_MAP, 'Iran': '630'}.values())
            ged_tasks = [
                _fetch_ucdp_all_pages(
                    session,
                    f"gedevents/{UCDP_VERSION}",
                    hdrs,
                    {"Country": gw, "StartDate": "2000-01-01"},
                )
                for gw in all_gw_codes
            ]
            ged_results = await asyncio.gather(*ged_tasks, return_exceptions=True)

            # Aggregate individual events → dyad-year buckets
            dyad_year: Dict[tuple, Dict] = {}
            for country_events in ged_results:
                if isinstance(country_events, Exception):
                    continue
                for ev in country_events:
                    ds = (ev.get("date_start") or "")[:10]
                    year = int(ds[:4]) if len(ds) >= 4 else None
                    if not year:
                        continue
                    side_a = (ev.get("side_a") or "").strip()
                    side_b = (ev.get("side_b") or "").strip()
                    if not side_a or not side_b:
                        continue
                    dyad_name = ev.get("dyad_name") or f"{side_a} - {side_b}"
                    key = (dyad_name, year)
                    if key not in dyad_year:
                        dyad_year[key] = {
                            "side_a":        side_a,
                            "side_b":        side_b,
                            "bd_best":       0,
                            "conflict_name": (ev.get("conflict_name") or "").strip(),
                            "region":        (ev.get("region") or "").strip(),
                        }
                    dyad_year[key]["bd_best"] += int(ev.get("best") or 0)

            for (_, year), rec in dyad_year.items():
                dyads.append({
                    "side_a":        rec["side_a"],
                    "side_b":        rec["side_b"],
                    "side_a_type":   _classify_actor_type(rec["side_a"]),
                    "side_b_type":   _classify_actor_type(rec["side_b"]),
                    "bd_best":       rec["bd_best"],
                    "year":          year,
                    "conflict_name": rec["conflict_name"],
                    "region":        rec["region"],
                    "source":        "gedevents",
                })
            data_sources.append(f"UCDP GED {UCDP_VERSION}")
            logger.info(f"Actor network: {len(dyad_year)} state-based dyad-year records from GED")
        except Exception as exc:
            logger.error(f"Actor network: GED dyadic fetch error: {exc}")

        # ── 2. UCDP Non-State dataset ─────────────────────────────────────────
        try:
            raw_ns = await _fetch_ucdp_all_pages(session, f"nonstate/{UCDP_VERSION}", hdrs)
            for r in raw_ns:
                year = r.get("year")
                if not year:
                    continue
                actor_a = (r.get("actor_a") or r.get("side_a") or "").strip()
                actor_b = (r.get("actor_b") or r.get("side_b") or "").strip()
                if not actor_a or not actor_b:
                    continue
                dyads.append({
                    "side_a":        actor_a,
                    "side_b":        actor_b,
                    "side_a_type":   _classify_actor_type(actor_a),
                    "side_b_type":   _classify_actor_type(actor_b),
                    "bd_best":       int(r.get("bd_best") or 0),
                    "year":          int(year),
                    "conflict_name": (r.get("conflict_name") or r.get("dyad_name") or "").strip(),
                    "region":        (r.get("region") or "").strip(),
                    "source":        "nonstate",
                })
            data_sources.append(f"UCDP Non-State {UCDP_VERSION}")
            logger.info(f"Actor network: {len(raw_ns)} non-state records fetched")
        except Exception as exc:
            logger.error(f"Actor network: non-state fetch error: {exc}")

    years = sorted({d["year"] for d in dyads}) if dyads else []
    result = {
        "dyads":         dyads,
        "years":         years,
        "year_min":      min(years) if years else 1946,
        "year_max":      max(years) if years else 2024,
        "total_records": len(dyads),
        "data_sources":  data_sources,
        "generated_at":  now.isoformat(),
    }

    _actor_network_cache    = result
    _actor_network_cache_ts = now
    return result


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
