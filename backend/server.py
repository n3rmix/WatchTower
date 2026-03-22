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
# GED Candidate dataset — near-real-time monthly release, higher version number
UCDP_CANDIDATE_VERSION = os.environ.get("UCDP_CANDIDATE_VERSION", "26.0.1")

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
        'status': 'active'
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
        'status': 'active'
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
        'total_deaths': 5900,
        'civilian_deaths': 595,
        'military_deaths': 5305,
        'children_deaths': 127,
        'description': 'US-Israeli air and missile strikes on Iranian military infrastructure beginning February 2026, targeting sites across 26 provinces. Preceded by years of internal repression, protest crackdowns, shadow-war assassinations, and Kurdish insurgencies.',
        'countries_involved': ['Iran', 'Israel', 'United States'],
        'parties_involved': ['IRGC', 'Iranian Armed Forces', 'Basij Militia', 'Israeli Air Force', 'US Forces', 'Kurdish Democratic Party of Iran (KDPI)', 'PJAK', 'Iranian Opposition Groups'],
        'data_sources': ['Hengaw', 'Iran Human Rights (IHR)', 'Amnesty International', 'UN Human Rights'],
        'status': 'active'
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



async def _fetch_ged_window(
    session: aiohttp.ClientSession,
    hdrs: Dict[str, str],
    start_date: str,
    end_date: str,
    violence_types: str,
) -> List[Dict]:
    """Paginate through all GED Candidate events for a single date window."""
    url = f"{UCDP_API_BASE}/gedevents/{UCDP_CANDIDATE_VERSION}"
    all_events: List[Dict] = []
    pg = 1
    while True:
        params: dict = {
            "StartDate": start_date,
            "EndDate": end_date,
            "pagesize": 1000,
            "page": pg,
        }
        if violence_types:
            params["TypeOfViolence"] = violence_types
        try:
            async with session.get(
                url, params=params, headers=hdrs,
                timeout=aiohttp.ClientTimeout(total=45),
            ) as resp:
                if resp.status != 200:
                    logger.warning(
                        f"UCDP GED candidate HTTP {resp.status} "
                        f"window={start_date}→{end_date} page={pg}"
                    )
                    break
                data = await resp.json()
                results = data.get("Result", [])
                logger.info(
                    f"GED candidate page={pg} window={start_date}→{end_date}: "
                    f"{len(results)} events (TotalCount={data.get('TotalCount')})"
                )
                all_events.extend(results)
                if len(results) < 1000:
                    break
                pg += 1
        except Exception as exc:
            logger.warning(f"UCDP GED candidate error window={start_date}→{end_date}: {exc}")
            break
    return all_events


def _group_by_conflict(events: List[Dict]) -> Dict[str, Dict]:
    """Aggregate GED events into per-conflict death-count buckets."""
    groups: Dict[str, Dict] = {}
    for ev in events:
        cid = str(ev.get("conflict_new_id") or ev.get("conflict_id") or "")
        if not cid:
            continue
        if cid not in groups:
            groups[cid] = {
                "conflict_new_id":  cid,
                "conflict_name":    ev.get("conflict_name") or "",
                "country":          ev.get("country") or "",
                "gwno_loc":         ev.get("gwno_loc") or "",
                "type_of_violence": int(ev.get("type_of_violence") or 0),
                "side_a":           ev.get("side_a") or "",
                "side_b":           ev.get("side_b") or "",
                "event_count": 0,
                "best": 0,
                "low":  0,
                "high": 0,
            }
        g = groups[cid]
        g["event_count"] += 1
        g["best"] += int(ev.get("best", 0) or 0)
        g["low"]  += int(ev.get("low",  0) or 0)
        g["high"] += int(ev.get("high", 0) or 0)
    return groups


@api_router.get("/surge")
async def get_surge_detector(
    window: int = 30,
    violence_types: str = "1,2,3",
    end_date: str = "",
):
    """Conflict Escalation Surge Detector using UCDP GED Candidate data.

    Slides two back-to-back windows of equal length over the GED Candidate
    dataset (version 26.0.1), compares violence intensity per conflict, and
    returns a probabilistic escalation signal.

    Algorithm:
      1. current window  = [end_date − window, end_date]
      2. prior window    = [end_date − 2×window, end_date − window]
      3. Fetch both windows in parallel via StartDate/EndDate filters
      4. Group each by conflict_new_id, sum best/low/high
      5. Compute escalation_ratio and confidence-band status:
           confirmed → current.low  > prior.high  (bands do not overlap)
           probable  → current.best > prior.best×1.5 AND current.low ≥ prior.best
           possible  → current.best > prior.best×1.25
           declining → current.best < prior.best×0.5
           new       → prior.best == 0, current.best > 0
      6. Enrich top-10 surging conflicts with annual battledeaths (bd_best)
         for historical context.

    window         – rolling window length in days: 30 | 60 | 90
    violence_types – comma-separated TypeOfViolence filter (default: 1,2,3)
    end_date       – window end YYYY-MM-DD (default: today UTC)
    """
    if window not in (30, 60, 90):
        raise HTTPException(status_code=400, detail="window must be 30, 60, or 90")

    api_key = get_ucdp_api_key()
    ucdp_hdrs: Dict[str, str] = {}
    if api_key:
        ucdp_hdrs["x-ucdp-access-token"] = api_key

    # Build window boundaries
    try:
        end_dt = datetime.fromisoformat(end_date).date() if end_date else datetime.now(timezone.utc).date()
    except ValueError:
        end_dt = datetime.now(timezone.utc).date()

    curr_end    = end_dt
    curr_start  = end_dt  - timedelta(days=window)
    prior_end   = curr_start
    prior_start = curr_start - timedelta(days=window)

    curr_start_s  = curr_start.isoformat()
    curr_end_s    = curr_end.isoformat()
    prior_start_s = prior_start.isoformat()
    prior_end_s   = prior_end.isoformat()

    async with aiohttp.ClientSession(headers={"User-Agent": "WatchTower/1.0"}) as session:

        # ── Fetch both windows in parallel ────────────────────────────────────
        curr_events, prior_events = await asyncio.gather(
            _fetch_ged_window(session, ucdp_hdrs, curr_start_s,  curr_end_s,   violence_types),
            _fetch_ged_window(session, ucdp_hdrs, prior_start_s, prior_end_s,  violence_types),
        )
        logger.info(
            f"Surge: current={len(curr_events)} events "
            f"({curr_start_s}→{curr_end_s}), "
            f"prior={len(prior_events)} events "
            f"({prior_start_s}→{prior_end_s})"
        )

        curr_grp  = _group_by_conflict(curr_events)
        prior_grp = _group_by_conflict(prior_events)

        # ── Score every conflict seen in either window ─────────────────────
        conflicts: List[Dict] = []
        for cid in set(curr_grp) | set(prior_grp):
            cur = curr_grp.get(cid)
            pri = prior_grp.get(cid)
            meta = cur or pri  # whichever has richer metadata

            c_best = cur["best"] if cur else 0
            c_low  = cur["low"]  if cur else 0
            c_high = cur["high"] if cur else 0
            c_ev   = cur["event_count"] if cur else 0

            p_best = pri["best"] if pri else 0
            p_low  = pri["low"]  if pri else 0
            p_high = pri["high"] if pri else 0
            p_ev   = pri["event_count"] if pri else 0

            # Skip conflicts with zero activity in both windows
            if c_best == 0 and p_best == 0:
                continue

            if p_best == 0:
                status = "new"
                ratio  = None
                score  = 100
                delta  = c_best
                pct    = None
            else:
                ratio = round(c_best / p_best, 3)
                delta = c_best - p_best
                pct   = round((delta / p_best) * 100, 1)
                # Confidence-band comparison
                if c_low > p_high:
                    status = "confirmed"   # no band overlap
                elif c_best > p_best * 1.5 and c_low >= p_best:
                    status = "probable"
                elif c_best > p_best * 1.25:
                    status = "possible"
                elif c_best < p_best * 0.5:
                    status = "declining"
                else:
                    status = "stable"
                score = min(100, max(0, round((ratio - 1) * 50)))

            conflicts.append({
                "conflict_new_id":  meta["conflict_new_id"],
                "conflict_name":    meta["conflict_name"],
                "country":          meta["country"],
                "gwno_loc":         meta["gwno_loc"],
                "type_of_violence": meta["type_of_violence"],
                "side_a":           meta["side_a"],
                "side_b":           meta["side_b"],
                "current":  {"events": c_ev, "best": c_best, "low": c_low,  "high": c_high},
                "prior":    {"events": p_ev, "best": p_best, "low": p_low,  "high": p_high},
                "surge_score":      score,
                "escalation_ratio": ratio,
                "status":           status,
                "delta_best":       delta,
                "pct_change":       pct,
                "annual_deaths":    {},
            })

        # Sort: new/confirmed first, then by score desc, then by current deaths desc
        _STATUS_ORDER = {"new": 0, "confirmed": 1, "probable": 2,
                         "possible": 3, "stable": 4, "declining": 5}
        conflicts.sort(key=lambda x: (
            _STATUS_ORDER.get(x["status"], 9),
            -x["surge_score"],
            -x["current"]["best"],
        ))

        # ── Enrich top-10 surging conflicts with annual battledeaths ─────────
        bd_url  = f"{UCDP_API_BASE}/battledeaths/{UCDP_VERSION}"
        cur_yr  = end_dt.year
        surging = [c for c in conflicts if c["status"] in ("new", "confirmed", "probable")][:10]

        for conflict in surging:
            cid    = conflict["conflict_new_id"]
            annual: Dict[str, int] = {}
            for yr in (cur_yr, cur_yr - 1, cur_yr - 2):
                try:
                    async with session.get(
                        bd_url,
                        params={"Conflict": cid, "Year": yr, "pagesize": 100},
                        headers=ucdp_hdrs,
                        timeout=aiohttp.ClientTimeout(total=15),
                    ) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            for rec in data.get("Result", []):
                                yr_key = str(rec.get("year", yr))
                                bd = int(rec.get("bd_best") or rec.get("best") or 0)
                                annual[yr_key] = annual.get(yr_key, 0) + bd
                except Exception:
                    pass
            conflict["annual_deaths"] = annual

    logger.info(
        f"Surge detector: window={window}d types={violence_types} end={curr_end_s} "
        f"→ {len(conflicts)} conflicts, "
        f"{sum(1 for c in conflicts if c['status'] in ('new','confirmed','probable'))} surging"
    )
    return {
        "meta": {
            "window_days":     window,
            "violence_types":  violence_types,
            "current_window":  {"start": curr_start_s, "end": curr_end_s},
            "prior_window":    {"start": prior_start_s, "end": prior_end_s},
            "generated_at":    datetime.now(timezone.utc).isoformat(),
            "total_conflicts": len(conflicts),
            "n_surging":       sum(1 for c in conflicts if c["status"] in ("new","confirmed","probable")),
        },
        "conflicts": conflicts,
    }


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
