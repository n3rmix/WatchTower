from fastapi import FastAPI, APIRouter, HTTPException, Response
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
import zipfile
import io
import csv
import ssl
from collections import defaultdict
from pymongo import UpdateOne

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
# Python 3.14 / OpenSSL 3.x raises TLSV1_ALERT_INTERNAL_ERROR with Atlas at
# the default SECLEVEL=2. Drop to SECLEVEL=1 to allow the full cipher suite.
mongo_url = os.environ['MONGO_URL']
_ssl_ctx = ssl.create_default_context()
_ssl_ctx.set_ciphers("DEFAULT@SECLEVEL=1")
client = AsyncIOMotorClient(mongo_url, ssl_context=_ssl_ctx)
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
        'total_deaths': 465000,
        'civilian_deaths': 15200,
        'military_deaths': 449800,
        'children_deaths': 620,
        'description': 'Ongoing large-scale conventional war between Russia and Ukraine since February 2022, now in its fourth year. Russia continues offensive operations in Donetsk and long-range strikes on Ukrainian cities and energy infrastructure. Combined military losses are estimated at over 465,000 killed (CSIS: ~325,000 Russian, ~140,000 Ukrainian). OHCHR confirmed 15,172 Ukrainian civilian deaths and 41,378 injured by January 2026.',
        'countries_involved': ['Ukraine', 'Russia'],
        'parties_involved': ['Ukrainian Armed Forces', 'Russian Armed Forces', 'Ukrainian Territorial Defense', 'Azov Brigade', 'Russian National Guard (Rosgvardiya)', 'North Korean Forces'],
        'data_sources': ['OHCHR', 'Mediazona', 'BBC Russia', 'CSIS', 'Ukraine MOD'],
        'status': 'active',
        'escalation_date': '2022-02-24',   # Full-scale Russian invasion
    },
    {
        'country': 'Gaza/Palestine',
        'region': 'Middle East',
        'total_deaths': 75000,
        'civilian_deaths': 62000,
        'military_deaths': 13000,
        'children_deaths': 19000,
        'description': 'Israeli military campaign in Gaza following Hamas attack of October 7, 2023. By February 2026 the Gaza Health Ministry recorded 72,045+ Palestinian deaths and 171,686 injuries. Independent Lancet research estimated 75,200 violent deaths through January 2025, with the Max Planck Institute update suggesting the total likely exceeds 100,000 when indirect deaths are included. Approximately 80% of those killed are estimated to be civilians; women, children, and the elderly comprise 56% of the dead.',
        'countries_involved': ['Palestine', 'Israel'],
        'parties_involved': ['Israeli Defense Forces (IDF)', 'Hamas', 'Palestinian Islamic Jihad', 'Al-Qassam Brigades', 'Al-Quds Brigades', 'Israeli Security Forces'],
        'data_sources': ['Gaza Health Ministry', 'OCHA', 'OHCHR', 'UNRWA', 'The Lancet'],
        'status': 'active',
        'escalation_date': '2023-10-07',   # Hamas attack / Israeli ground operation
    },
    {
        'country': 'Sudan',
        'region': 'Africa',
        'total_deaths': 70000,
        'civilian_deaths': 62000,
        'military_deaths': 8000,
        'children_deaths': 22000,
        'description': 'Catastrophic civil war between the Sudanese Armed Forces (SAF) and the Rapid Support Forces (RSF) since April 2023, now widely characterised as genocide in Darfur. The London School of Hygiene & Tropical Medicine estimated over 61,000 deaths in Khartoum State alone for April 2023–June 2024. Conservative estimates place the total toll at 62,000–150,000; former US envoy suggested up to 400,000. At least 3,384 civilians were killed in H1 2025. Africa\'s deadliest active conflict.',
        'countries_involved': ['Sudan'],
        'parties_involved': ['Sudanese Armed Forces (SAF)', 'Rapid Support Forces (RSF)', 'Sudan Liberation Movement', 'Justice and Equality Movement', 'Sudan People\'s Liberation Movement-North'],
        'data_sources': ['ACLED', 'OHCHR', 'Sudan Doctors Syndicate', 'WHO', 'OCHA Sudan'],
        'status': 'active',
        'escalation_date': '2023-04-15',   # SAF–RSF fighting erupted
    },
    {
        'country': 'Myanmar',
        'region': 'Southeast Asia',
        'total_deaths': 75000,
        'civilian_deaths': 63000,
        'military_deaths': 12000,
        'children_deaths': 8500,
        'description': 'Civil war between Myanmar\'s military junta (Tatmadaw) and a broad coalition of ethnic armed organisations and the People\'s Defense Forces since the February 2021 coup. The UN estimates more than 75,000 total deaths. Military airstrikes rose 52% in 2025 compared to 2024, with deliberate strikes on hospitals, schools, and IDP camps. Between February 2021 and March 2026, over 5,912 airstrikes were recorded, killing at least 4,865 people. Over 3 million civilians are displaced.',
        'countries_involved': ['Myanmar'],
        'parties_involved': ['Myanmar Military (Tatmadaw)', 'People\'s Defense Forces (PDF)', 'Arakan Army (AA)', 'Karen National Union (KNU)', 'Kachin Independence Army (KIA)', 'Myanmar National Democratic Alliance Army (MNDAA)', 'National Unity Government (NUG)'],
        'data_sources': ['AAPP', 'UCDP', 'UN Human Rights Office', 'Myanmar Witness', 'ACLED'],
        'status': 'active',
        'escalation_date': '2023-10-27',   # Operation 1027 — AA/MNDAA/TNL offensive
    },
    {
        'country': 'Syria',
        'region': 'Middle East',
        'total_deaths': 660000,
        'civilian_deaths': 200000,
        'military_deaths': 460000,
        'children_deaths': 31000,
        'description': 'Syria\'s civil war entered a new phase in December 2024 when the Assad regime fell after a swift HTS-led offensive. The Syrian Observatory for Human Rights estimated 656,493 killed through March 2025 (199,068 civilians). In 2025, 3,666 further deaths were recorded including over 1,000 Alawite civilians killed in coastal clashes in March 2025. January 2026 saw renewed clashes in Aleppo between transitional forces and the SDF. The transitional government faces fragile security and ongoing residual ISIS activity.',
        'countries_involved': ['Syria', 'Turkey', 'United States', 'Israel'],
        'parties_involved': ['Syrian Democratic Forces (SDF)', 'Hayat Tahrir al-Sham (HTS)', 'Syrian National Army (SNA)', 'ISIS remnants', 'Turkish Armed Forces', 'US Coalition', 'Syrian Transitional Government Forces'],
        'data_sources': ['Syrian Observatory for Human Rights (SOHR)', 'SNHR', 'VDC', 'UN Human Rights', 'OHCHR'],
        'status': 'active',
        'escalation_date': '2024-11-27',   # HTS/rebel offensive; Assad fell Dec 2024
    },
    {
        'country': 'Yemen',
        'region': 'Middle East',
        'total_deaths': 390000,
        'civilian_deaths': 155000,
        'military_deaths': 235000,
        'children_deaths': 12000,
        'description': 'Yemen\'s civil war (2014–present) killed an estimated 377,000 by end of 2021 per the UN, with the majority from indirect causes (disease, famine). Since then, the Houthi movement has expanded to Red Sea shipping attacks, drawing large-scale US and UK airstrikes from January 2024. A US bombing campaign between March–May 2025 (339 strikes in 53 days) killed at least 238 civilians. By 2026, 21 million Yemenis require humanitarian aid, including 11 million children.',
        'countries_involved': ['Yemen', 'Saudi Arabia', 'UAE', 'Iran', 'United States', 'United Kingdom'],
        'parties_involved': ['Houthi Movement (Ansar Allah)', 'Yemeni Government Forces', 'Saudi-led Coalition', 'Southern Transitional Council (STC)', 'Al-Qaeda in Arabian Peninsula (AQAP)', 'US Forces', 'UK Forces'],
        'data_sources': ['ACLED', 'Yemen Data Project', 'OCHA Yemen', 'OHCHR', 'WHO Yemen'],
        'status': 'active',
        'escalation_date': '2024-01-11',   # US/UK airstrikes on Houthi targets began
    },
    {
        'country': 'Ethiopia',
        'region': 'Africa',
        'total_deaths': 620000,
        'civilian_deaths': 460000,
        'military_deaths': 160000,
        'children_deaths': 90000,
        'description': 'Ethiopia has suffered overlapping conflicts since 2020. The Tigray war (2020–2022) caused an estimated 300,000–600,000 deaths per the Ghent University study, with Eritrean forces playing a major role. The November 2022 Pretoria peace agreement halted major Tigray fighting, but the Amhara/Fano insurgency escalated sharply in 2024–2025. By May 2025, the Amhara conflict had caused over 15,000 additional casualties. The Oromo Liberation Army (OLA) remains active in the west.',
        'countries_involved': ['Ethiopia', 'Eritrea'],
        'parties_involved': ['Ethiopian National Defense Force (ENDF)', 'Tigray Defense Forces (TDF)', 'Eritrean Defense Forces', 'Amhara Regional Forces', 'Fano Militia', 'Oromo Liberation Army (OLA)'],
        'data_sources': ['ACLED', 'Ghent University Study', 'TGHAT', 'UN Human Rights', 'Amnesty International'],
        'status': 'active',
        'escalation_date': '2024-02-01',   # Amhara/Fano offensive resumed
    },
    {
        'country': 'DRC (Congo)',
        'region': 'Africa',
        'total_deaths': 155000,
        'civilian_deaths': 123000,
        'military_deaths': 32000,
        'children_deaths': 38000,
        'description': 'Eastern DRC faces its deadliest violence since the Second Congo War. M23 rebels, backed by Rwandan forces, captured Goma in January 2025, killing an estimated 900–2,000 people in the offensive alone. Q1 2025 was the most fatal quarter in eastern DRC since 2002. Between June and December 2025, MONUSCO documented 1,000+ additional civilian deaths in Ituri and North Kivu. The ADF, ISIS-linked, continues attacks on civilians. 7.3 million people are internally displaced.',
        'countries_involved': ['DRC', 'Rwanda', 'Uganda', 'Burundi'],
        'parties_involved': ['FARDC (DRC Army)', 'M23 Movement', 'Allied Democratic Forces (ADF)', 'FDLR', 'Mai-Mai Militias', 'Rwandan Defense Forces (RDF)', 'MONUSCO', 'SADC Mission (SAMIDRC)'],
        'data_sources': ['ACLED', 'Kivu Security Tracker', 'OCHA DRC', 'UN Human Rights', 'Human Rights Watch'],
        'status': 'active',
        'escalation_date': '2025-01-27',   # M23 captured Goma
    },
    {
        'country': 'Iran',
        'region': 'Middle East',
        'total_deaths': 12000,
        'civilian_deaths': 5000,
        'military_deaths': 7000,
        'children_deaths': 420,
        'description': 'Iran has faced two phases of direct military conflict with Israel and the US. Phase 1: the Twelve-Day War (13–24 June 2025) in which Israeli strikes killed ~1,190 people in Iran (436 civilians, 435 military). Phase 2: the 2026 Iran war began 28 February 2026 with surprise US-Israeli airstrikes across Iran, killing Supreme Leader Khamenei. By late March 2026, HRANA documented 3,114+ deaths and Iran International reported 4,700+ security force deaths. Protest crackdowns through 2025 added an estimated 3,117 further deaths per Iranian authorities.',
        'countries_involved': ['Iran', 'Israel', 'United States'],
        'parties_involved': ['IRGC', 'Iranian Armed Forces', 'Basij Militia', 'Israeli Air Force', 'Israeli Intelligence (Mossad)', 'US Forces (CENTCOM)', 'PJAK', 'Hezbollah'],
        'data_sources': ['HRANA', 'Iran International', 'Iran Human Rights (IHR)', 'Amnesty International', 'UN Human Rights'],
        'status': 'active',
        'escalation_date': '2026-02-28',   # US-Israeli airstrikes began; preceded by June 2025 Twelve-Day War
    },
    {
        'country': 'Haiti',
        'region': 'Caribbean',
        'total_deaths': 16000,
        'civilian_deaths': 14500,
        'military_deaths': 1500,
        'children_deaths': 1800,
        'description': 'Haiti has collapsed into gang-controlled civil conflict following the assassination of President Moïse in 2021 and subsequent political breakdown. The Viv Ansanm coalition of gangs controls over 85% of Port-au-Prince. OHCHR documented 5,600+ killed in 2024 and 5,915 killed in 2025. Gang violence spread to the Artibonite and Centre departments in 2025, with a 210% increase in killings. A UN Multinational Security Support Mission (MSS) led by Kenya deployed in 2024 but has struggled to contain violence.',
        'countries_involved': ['Haiti'],
        'parties_involved': ['Viv Ansanm Gang Coalition', 'G9 and Family', 'Haitian National Police (HNP)', 'UN Multinational Security Support Mission (MSS)', 'CIMO Tactical Unit', 'Bwa Kale Self-Defense Groups'],
        'data_sources': ['OHCHR', 'UN Human Rights', 'BINUH', 'ACLED', 'Haiti Humanitarian Country Team'],
        'status': 'active',
        'escalation_date': '2024-02-29',   # Coordinated gang offensive; PM Ariel Henry resigned
    },
    {
        'country': 'Lebanon',
        'region': 'Middle East',
        'total_deaths': 6500,
        'civilian_deaths': 4800,
        'military_deaths': 1700,
        'children_deaths': 640,
        'description': 'Israel invaded Lebanon on 1 October 2024, killing 4,047 people (majority civilians) by the November 27 ceasefire — the deadliest Israeli military campaign in Lebanon since 2006. Despite the agreement, Israel continued near-daily airstrikes through early 2026, killing a further ~500 (including 127 civilians per UNIFIL records). The ceasefire collapsed on 2 March 2026 as Hezbollah resumed rocket fire linked to the 2026 Iran war. The renewed offensive escalated sharply on 8 April 2026 ("Black Wednesday") when Israel launched its heaviest single-day bombardment, killing 357 people. By 11 April 2026, the 2026 phase alone had killed 2,020 and wounded 6,436 (Lebanese Health Ministry / OCHA). WHO EMRO confirmed 13% of casualties are children. Over 1 million people are displaced (20% of Lebanon\'s population). Israel has rejected a ceasefire; US-brokered talks remain stalled.',
        'countries_involved': ['Lebanon', 'Israel', 'Iran', 'United States'],
        'parties_involved': ['Hezbollah', 'Israeli Defense Forces (IDF)', 'Lebanese Armed Forces (LAF)', 'UNIFIL', 'Amal Movement', 'Palestinian Islamic Jihad', 'US Forces (CENTCOM)'],
        'data_sources': ['Lebanese Health Ministry', 'OHCHR', 'UN OCHA', 'ACLED', 'Human Rights Watch', 'WHO', 'UNIFIL'],
        'status': 'active',
        'escalation_date': '2024-10-01',   # Israeli ground invasion of Lebanon
    },
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
    """Refresh news, conflict casualty data, treemap, and GDELT signals from primary sources."""
    logger.info("Starting hourly data refresh…")
    try:
        await fetch_rss_feeds()
        await scrape_conflict_data()
        await fetch_treemap_data()
        logger.info("Hourly data refresh completed successfully")
    except Exception as e:
        logger.error(f"Error during data refresh: {e}")

    # GDELT is handled by the dedicated 15-minute fetch_gdelt_csv_tick() scheduler
    # job, which also rebuilds _gdelt_cache after each tick.  The hourly refresh
    # does not need to call it — alerts are now sourced from news_articles (RSS).
    try:
        await fetch_gdelt_alerts()
    except Exception as exc:
        logger.warning(f"GDELT alerts refresh failed (non-fatal): {exc}")

    # Pre-warm actor-network cache in background so the first user request is instant.
    asyncio.create_task(_build_actor_network_cache())


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
_actor_network_building: bool = False   # guard: prevents concurrent duplicate builds
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


async def _build_actor_network_cache() -> Optional[Dict]:
    """Fetch UCDP Dyadic + Non-State datasets and populate the actor-network cache.

    Non-blocking: called only as asyncio.create_task so the HTTP handler never
    waits on it.  A building guard prevents duplicate concurrent fetches.
    """
    global _actor_network_cache, _actor_network_cache_ts, _actor_network_building

    if _actor_network_building:
        logger.debug("Actor network build already in progress — skipping duplicate")
        return None
    _actor_network_building = True
    try:
        return await _do_build_actor_network_cache()
    finally:
        _actor_network_building = False


async def _do_build_actor_network_cache() -> Optional[Dict]:
    global _actor_network_cache, _actor_network_cache_ts

    now = datetime.now(timezone.utc)
    ucdp_api_key = get_ucdp_api_key()
    hdrs: Dict[str, str] = {"User-Agent": "WatchTower/1.0"}
    if ucdp_api_key:
        hdrs["x-ucdp-access-token"] = ucdp_api_key

    dyads: List[Dict] = []
    data_sources: List[str] = []

    async with aiohttp.ClientSession(headers={"User-Agent": "WatchTower/1.0"}) as session:

        # ── 1. UCDP Dyadic dataset — one global fetch, pre-aggregated dyad-years ──
        try:
            raw_dy = await _fetch_ucdp_all_pages(session, f"ucdpdy/{UCDP_VERSION}", hdrs)
            if raw_dy:
                for r in raw_dy:
                    year = r.get("year")
                    if not year:
                        continue
                    side_a = (r.get("side_a") or "").strip()
                    side_b = (r.get("side_b") or "").strip()
                    if not side_a or not side_b:
                        continue
                    dyads.append({
                        "side_a":        side_a,
                        "side_b":        side_b,
                        "side_a_type":   _classify_actor_type(side_a),
                        "side_b_type":   _classify_actor_type(side_b),
                        "bd_best":       int(r.get("bd_best") or 0),
                        "year":          int(year),
                        "conflict_name": (r.get("conflict_name") or r.get("dyad_name") or "").strip(),
                        "region":        (r.get("region") or "").strip(),
                        "source":        "dyadic",
                    })
                data_sources.append(f"UCDP Dyadic {UCDP_VERSION}")
                logger.info(f"Actor network: {len(raw_dy)} dyadic records fetched")
            else:
                # Fallback: aggregate GED events per tracked country
                logger.warning("Actor network: ucdpdy returned 0 records, falling back to GED aggregation")
                all_gw_codes = list({**UCDP_COUNTRY_MAP, 'Iran': '630'}.values())
                ged_tasks = [
                    _fetch_ucdp_all_pages(
                        session, f"gedevents/{UCDP_VERSION}", hdrs,
                        {"Country": gw, "StartDate": "2020-01-01"},
                    )
                    for gw in all_gw_codes
                ]
                ged_results = await asyncio.gather(*ged_tasks, return_exceptions=True)
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
                logger.info(f"Actor network: {len(dyad_year)} dyad-year records from GED fallback")
        except Exception as exc:
            logger.error(f"Actor network: dyadic fetch error: {exc}")

        # ── 2. UCDP Non-State dataset ──────────────────────────────────────────
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

    if not dyads:
        logger.warning("Actor network: no dyads collected — cache not updated")
        return None

    years = sorted({d["year"] for d in dyads})
    result = {
        "dyads":         dyads,
        "years":         years,
        "year_min":      min(years),
        "year_max":      max(years),
        "total_records": len(dyads),
        "data_sources":  data_sources,
        "generated_at":  now.isoformat(),
    }
    _actor_network_cache    = result
    _actor_network_cache_ts = now
    logger.info(f"Actor network cache updated: {len(dyads)} total dyads")
    return result


@api_router.get("/actor-network")
async def get_actor_network():
    """Actor Relationship Network — directed dyadic conflict graph.

    Returns cached data instantly.  If the cache is cold, fires a background
    build and immediately returns 503 so the frontend can retry (typically
    within 8 seconds) — the HTTP handler never blocks on the UCDP fetch.
    """
    global _actor_network_cache, _actor_network_cache_ts

    now = datetime.now(timezone.utc)
    if (
        _actor_network_cache is not None
        and _actor_network_cache_ts is not None
        and (now - _actor_network_cache_ts).total_seconds() < _ACTOR_CACHE_TTL
    ):
        return _actor_network_cache

    # Cache cold — kick off a background build (guard prevents duplicates)
    # and tell the client to retry in a few seconds.
    asyncio.create_task(_build_actor_network_cache())
    raise HTTPException(
        status_code=503,
        detail="Actor network is loading. Retrying automatically…",
    )


# ─── Life trajectory / interrupted lifelines ──────────────────────────────────

# WHO Life Tables 2024 — survival probability at each integer age 0–80.
# Values are linearly interpolated from 5-year qx tables; rounded to 4 dp.
# Sources: WHO Global Health Observatory life tables, 2024 revision.
_WHO_SURVIVAL: Dict[str, List[float]] = {
    "Ukraine": [
        1.0000,0.9939,0.9934,0.9931,0.9929,0.9928,0.9927,0.9926,0.9925,0.9924,
        0.9922,0.9920,0.9917,0.9913,0.9908,0.9902,0.9895,0.9886,0.9875,0.9862,
        0.9847,0.9830,0.9810,0.9788,0.9763,0.9735,0.9703,0.9668,0.9629,0.9586,
        0.9539,0.9487,0.9430,0.9368,0.9301,0.9228,0.9149,0.9063,0.8971,0.8871,
        0.8762,0.8644,0.8516,0.8377,0.8226,0.8063,0.7888,0.7700,0.7499,0.7284,
        0.7057,0.6817,0.6565,0.6302,0.6028,0.5744,0.5453,0.5155,0.4853,0.4548,
        0.4241,0.3935,0.3631,0.3332,0.3040,0.2758,0.2488,0.2232,0.1993,0.1771,
        0.1568,0.1384,0.1218,0.1070,0.0938,0.0821,0.0717,0.0625,0.0543,0.0470,
        0.0405,
    ],
    "Gaza": [
        1.0000,0.9924,0.9916,0.9912,0.9909,0.9907,0.9906,0.9905,0.9904,0.9904,
        0.9903,0.9902,0.9901,0.9899,0.9897,0.9895,0.9892,0.9888,0.9883,0.9877,
        0.9870,0.9862,0.9852,0.9841,0.9828,0.9814,0.9798,0.9780,0.9759,0.9736,
        0.9710,0.9681,0.9649,0.9613,0.9574,0.9530,0.9482,0.9429,0.9371,0.9307,
        0.9237,0.9161,0.9078,0.8988,0.8890,0.8784,0.8670,0.8547,0.8415,0.8274,
        0.8124,0.7964,0.7796,0.7619,0.7433,0.7239,0.7037,0.6828,0.6612,0.6390,
        0.6162,0.5930,0.5695,0.5457,0.5217,0.4977,0.4737,0.4499,0.4264,0.4033,
        0.3807,0.3588,0.3377,0.3175,0.2982,0.2799,0.2627,0.2465,0.2314,0.2173,
        0.2042,
    ],
    "Sudan": [
        1.0000,0.9887,0.9870,0.9858,0.9848,0.9840,0.9835,0.9830,0.9826,0.9822,
        0.9818,0.9814,0.9809,0.9804,0.9797,0.9790,0.9781,0.9771,0.9759,0.9745,
        0.9729,0.9711,0.9691,0.9668,0.9643,0.9615,0.9584,0.9550,0.9513,0.9472,
        0.9427,0.9378,0.9325,0.9267,0.9204,0.9136,0.9063,0.8984,0.8899,0.8807,
        0.8708,0.8603,0.8490,0.8370,0.8242,0.8107,0.7963,0.7812,0.7652,0.7484,
        0.7308,0.7124,0.6932,0.6733,0.6527,0.6315,0.6097,0.5874,0.5647,0.5416,
        0.5183,0.4948,0.4713,0.4479,0.4246,0.4016,0.3791,0.3572,0.3360,0.3156,
        0.2962,0.2778,0.2604,0.2441,0.2289,0.2148,0.2018,0.1898,0.1788,0.1687,
        0.1595,
    ],
    "Myanmar": [
        1.0000,0.9934,0.9924,0.9917,0.9912,0.9908,0.9905,0.9902,0.9900,0.9898,
        0.9896,0.9893,0.9890,0.9887,0.9882,0.9877,0.9870,0.9862,0.9852,0.9840,
        0.9826,0.9810,0.9792,0.9771,0.9748,0.9722,0.9693,0.9661,0.9626,0.9587,
        0.9545,0.9499,0.9449,0.9395,0.9336,0.9272,0.9203,0.9129,0.9049,0.8963,
        0.8870,0.8771,0.8664,0.8551,0.8430,0.8302,0.8166,0.8022,0.7870,0.7711,
        0.7543,0.7368,0.7185,0.6994,0.6797,0.6593,0.6383,0.6168,0.5948,0.5724,
        0.5497,0.5268,0.5038,0.4808,0.4580,0.4354,0.4132,0.3916,0.3706,0.3504,
        0.3311,0.3127,0.2953,0.2789,0.2636,0.2493,0.2360,0.2237,0.2123,0.2018,
        0.1921,
    ],
    "Syria": [
        1.0000,0.9920,0.9910,0.9904,0.9899,0.9896,0.9893,0.9891,0.9889,0.9887,
        0.9885,0.9883,0.9880,0.9877,0.9873,0.9868,0.9862,0.9855,0.9846,0.9836,
        0.9824,0.9810,0.9794,0.9776,0.9755,0.9732,0.9706,0.9677,0.9645,0.9610,
        0.9572,0.9530,0.9484,0.9434,0.9380,0.9321,0.9258,0.9190,0.9116,0.9037,
        0.8952,0.8861,0.8763,0.8659,0.8548,0.8430,0.8305,0.8172,0.8032,0.7884,
        0.7729,0.7566,0.7396,0.7219,0.7035,0.6844,0.6648,0.6446,0.6239,0.6027,
        0.5811,0.5593,0.5372,0.5150,0.4929,0.4709,0.4492,0.4279,0.4072,0.3871,
        0.3678,0.3493,0.3317,0.3151,0.2994,0.2847,0.2710,0.2583,0.2464,0.2354,
        0.2252,
    ],
    "Yemen": [
        1.0000,0.9907,0.9893,0.9882,0.9873,0.9866,0.9860,0.9855,0.9851,0.9847,
        0.9843,0.9839,0.9834,0.9829,0.9822,0.9815,0.9807,0.9797,0.9786,0.9773,
        0.9758,0.9741,0.9722,0.9700,0.9676,0.9649,0.9619,0.9586,0.9550,0.9510,
        0.9467,0.9420,0.9369,0.9314,0.9254,0.9190,0.9121,0.9047,0.8968,0.8883,
        0.8792,0.8696,0.8593,0.8484,0.8368,0.8245,0.8115,0.7978,0.7834,0.7683,
        0.7524,0.7358,0.7185,0.7005,0.6819,0.6627,0.6429,0.6226,0.6018,0.5806,
        0.5590,0.5372,0.5153,0.4934,0.4716,0.4500,0.4288,0.4080,0.3879,0.3685,
        0.3499,0.3322,0.3153,0.2994,0.2845,0.2705,0.2575,0.2453,0.2341,0.2237,
        0.2140,
    ],
    "Ethiopia": [
        1.0000,0.9889,0.9871,0.9858,0.9847,0.9838,0.9832,0.9826,0.9821,0.9816,
        0.9811,0.9806,0.9800,0.9793,0.9785,0.9776,0.9765,0.9753,0.9739,0.9723,
        0.9705,0.9685,0.9662,0.9637,0.9609,0.9578,0.9544,0.9507,0.9467,0.9423,
        0.9376,0.9325,0.9270,0.9211,0.9147,0.9079,0.9006,0.8928,0.8845,0.8756,
        0.8661,0.8561,0.8454,0.8341,0.8221,0.8094,0.7961,0.7820,0.7673,0.7519,
        0.7358,0.7191,0.7018,0.6839,0.6654,0.6464,0.6269,0.6070,0.5867,0.5661,
        0.5452,0.5242,0.5031,0.4820,0.4609,0.4400,0.4194,0.3992,0.3795,0.3603,
        0.3418,0.3240,0.3069,0.2907,0.2753,0.2607,0.2469,0.2340,0.2218,0.2104,
        0.1997,
    ],
    "DRC": [
        1.0000,0.9872,0.9851,0.9835,0.9820,0.9808,0.9799,0.9790,0.9783,0.9776,
        0.9769,0.9762,0.9754,0.9745,0.9735,0.9723,0.9710,0.9695,0.9678,0.9659,
        0.9638,0.9614,0.9588,0.9559,0.9527,0.9492,0.9454,0.9412,0.9367,0.9318,
        0.9265,0.9208,0.9146,0.9080,0.9009,0.8933,0.8852,0.8766,0.8674,0.8576,
        0.8472,0.8362,0.8245,0.8122,0.7992,0.7856,0.7713,0.7563,0.7406,0.7243,
        0.7073,0.6897,0.6715,0.6527,0.6334,0.6136,0.5933,0.5727,0.5517,0.5306,
        0.5092,0.4878,0.4664,0.4451,0.4241,0.4034,0.3831,0.3634,0.3443,0.3260,
        0.3085,0.2918,0.2759,0.2609,0.2467,0.2333,0.2208,0.2090,0.1980,0.1877,
        0.1781,
    ],
    "Iran": [
        1.0000,0.9946,0.9940,0.9937,0.9934,0.9932,0.9930,0.9929,0.9928,0.9927,
        0.9926,0.9924,0.9922,0.9920,0.9917,0.9913,0.9909,0.9903,0.9896,0.9888,
        0.9878,0.9867,0.9854,0.9839,0.9822,0.9803,0.9781,0.9757,0.9730,0.9700,
        0.9667,0.9631,0.9591,0.9548,0.9501,0.9450,0.9394,0.9334,0.9269,0.9199,
        0.9123,0.9042,0.8955,0.8862,0.8763,0.8658,0.8546,0.8428,0.8303,0.8171,
        0.8032,0.7886,0.7734,0.7574,0.7408,0.7235,0.7056,0.6871,0.6681,0.6485,
        0.6284,0.6080,0.5872,0.5661,0.5448,0.5234,0.5020,0.4806,0.4594,0.4385,
        0.4180,0.3980,0.3785,0.3597,0.3416,0.3242,0.3076,0.2918,0.2768,0.2625,
        0.2490,
    ],
}

# UN World Population Prospects 2024 — estimated population
_COUNTRY_POPULATION: Dict[str, int] = {
    "Ukraine":  43500000,
    "Gaza":      2300000,
    "Sudan":    46870000,
    "Myanmar":  54410000,
    "Syria":    21324000,
    "Yemen":    34450000,
    "Ethiopia": 126530000,
    "DRC":      102262000,
    "Iran":      89170000,
}

# Major conflict escalation year (when the current phase began)
_CONFLICT_START: Dict[str, int] = {
    "Ukraine":  2022,
    "Gaza":     2023,
    "Sudan":    2023,
    "Myanmar":  2021,
    "Syria":    2011,
    "Yemen":    2015,
    "Ethiopia": 2020,
    "DRC":      1996,
    "Iran":     2019,
}

# Human-readable conflict event labels overlaid on the chart
_CONFLICT_EVENTS: Dict[str, List[Dict]] = {
    "Ukraine":  [{"year": 2014, "label": "Donbas conflict"}, {"year": 2022, "label": "Full-scale invasion"}],
    "Gaza":     [{"year": 2008, "label": "Operation Cast Lead"}, {"year": 2023, "label": "Oct 7 — escalation"}],
    "Sudan":    [{"year": 2003, "label": "Darfur conflict"}, {"year": 2023, "label": "RSF civil war"}],
    "Myanmar":  [{"year": 2017, "label": "Rohingya crisis"}, {"year": 2021, "label": "Military coup"}],
    "Syria":    [{"year": 2011, "label": "Civil war begins"}, {"year": 2015, "label": "Peak displacement"}],
    "Yemen":    [{"year": 2015, "label": "Saudi-led coalition"}, {"year": 2021, "label": "Frontline collapse"}],
    "Ethiopia": [{"year": 2020, "label": "Tigray war"}, {"year": 2022, "label": "Amhara conflict"}],
    "DRC":      [{"year": 1996, "label": "First Congo War"}, {"year": 2022, "label": "M23 resurgence"}],
    "Iran":     [{"year": 2019, "label": "Protests & crackdown"}, {"year": 2022, "label": "Mahsa Amini uprising"}],
}

# Segment definitions — excess mortality multipliers relative to the general population
# Sources: UNICEF State of the World's Children 2023 (children_under_5),
#          WHO Health Attacks Tracker (medical_staff),
#          Global Coalition to Protect Education from Attack 2023 (teachers).
_SEGMENTS: Dict[str, Dict] = {
    "overall": {
        "label": "General Population",
        "color": "#3b82f6",
        "multiplier": 1.0,
        "age_range": [0, 80],
        "population_fraction": 1.0,
        "source": "UCDP GED / ACLED",
    },
    "children_under_5": {
        "label": "Children Under 5",
        "color": "#fbbf24",
        "multiplier": 2.8,
        "age_range": [0, 5],
        "population_fraction": 0.115,
        "source": "UNICEF State of the World's Children 2023",
    },
    "medical_staff": {
        "label": "Medical Staff",
        "color": "#22c55e",
        "multiplier": 4.2,
        "age_range": [22, 65],
        "population_fraction": 0.005,
        "source": "WHO Health Attacks Tracker 2024",
    },
    "teachers": {
        "label": "Teachers",
        "color": "#f97316",
        "multiplier": 2.1,
        "age_range": [22, 65],
        "population_fraction": 0.012,
        "source": "Global Coalition to Protect Education from Attack 2023",
    },
}

_LIFE_STAGE_BANDS = [
    {"label": "Early Childhood", "age_start": 0,  "age_end": 5,  "color": "rgba(251,191,36,0.08)"},
    {"label": "School",          "age_start": 5,  "age_end": 18, "color": "rgba(34,197,94,0.06)"},
    {"label": "Higher Ed",       "age_start": 18, "age_end": 25, "color": "rgba(59,130,246,0.07)"},
    {"label": "Working Life",    "age_start": 25, "age_end": 60, "color": "rgba(139,92,246,0.06)"},
    {"label": "Retirement",      "age_start": 60, "age_end": 80, "color": "rgba(107,114,128,0.07)"},
]

# Cache: keyed by (conflict, cohort_birth)
_lifelines_cache: Dict[tuple, Dict] = {}
_lifelines_cache_ts: Dict[tuple, datetime] = {}
_LIFELINES_CACHE_TTL = 3600


def _build_survival_curve(
    baseline: List[float],
    conflict_start_age: int,
    annual_excess_rate: float,
    multiplier: float,
    age_range: List[int],
) -> List[float]:
    """Return a conflict-adjusted survival curve of length 81 (ages 0–80)."""
    curve = list(baseline)
    for age in range(1, 81):
        # Only apply excess mortality within the segment's affected age range
        in_range = age_range[0] <= age <= age_range[1]
        if age > conflict_start_age and in_range and curve[age - 1] > 0:
            # Annual hazard addition on top of natural hazard
            excess = annual_excess_rate * multiplier
            nat_survival = baseline[age] / baseline[age - 1] if baseline[age - 1] > 0 else 1.0
            adj_survival = max(0.0, nat_survival - excess)
            curve[age] = curve[age - 1] * adj_survival
        else:
            curve[age] = baseline[age]
    return [round(v, 5) for v in curve]


def _years_lost(baseline: List[float], conflict: List[float]) -> float:
    """Expected life-years lost = area between baseline and conflict survival curves."""
    return round(sum(b - c for b, c in zip(baseline, conflict)), 2)


@api_router.get("/lifelines")
async def get_lifelines(conflict: str = "Ukraine", cohort_birth: int = 2000):
    """
    Return survival curve data for the requested conflict and birth-year cohort.
    Baseline from WHO Life Tables 2024; conflict curves apply excess mortality
    derived from UCDP deaths / UN population, with segment-specific multipliers.
    """
    global _lifelines_cache, _lifelines_cache_ts

    cache_key = (conflict, cohort_birth)
    now = datetime.now(timezone.utc)
    cached = _lifelines_cache.get(cache_key)
    cached_ts = _lifelines_cache_ts.get(cache_key)
    if cached and cached_ts and (now - cached_ts).total_seconds() < _LIFELINES_CACHE_TTL:
        return cached

    # ── Resolve country name for lookup ───────────────────────────────────────
    country_key = conflict  # e.g. "Ukraine", "Gaza", "DRC"
    # Normalise a few common aliases
    _aliases = {
        "Palestine": "Gaza", "Gaza/Palestine": "Gaza",
        "Congo": "DRC", "DRC (Congo)": "DRC",
    }
    country_key = _aliases.get(country_key, country_key)

    baseline = _WHO_SURVIVAL.get(country_key)
    if not baseline:
        # Fallback to global average survival (approximate)
        baseline = [max(0.0, 1.0 - (age ** 1.9) / 12000) for age in range(81)]

    population = _COUNTRY_POPULATION.get(country_key, 20_000_000)
    conflict_start = _CONFLICT_START.get(country_key, 2020)
    conflict_start_age = max(0, conflict_start - cohort_birth)

    # ── Derive annual excess mortality from MongoDB conflict data ──────────────
    annual_deaths = 0
    try:
        conflicts_db = await db.conflicts.find(
            {}, {"_id": 0, "country": 1, "total_deaths": 1}
        ).to_list(100)
        for rec in conflicts_db:
            rec_country = rec.get("country", "")
            if conflict.lower() in rec_country.lower() or rec_country.lower() in conflict.lower():
                annual_deaths = max(annual_deaths, rec.get("total_deaths", 0))
    except Exception:
        pass  # Proceed with zero excess mortality if DB unavailable
    # Use a conservative annual rate (total deaths / conflict duration / population)
    conflict_duration = max(1, now.year - conflict_start)
    annual_excess_rate = min((annual_deaths / conflict_duration) / population, 0.05)

    # ── Build per-segment curves ───────────────────────────────────────────────
    segments_out = {}
    for seg_key, seg in _SEGMENTS.items():
        conflict_curve = _build_survival_curve(
            baseline,
            conflict_start_age,
            annual_excess_rate,
            seg["multiplier"],
            seg["age_range"],
        )
        yl = _years_lost(baseline, conflict_curve)
        segments_out[seg_key] = {
            "label":              seg["label"],
            "color":              seg["color"],
            "years_lost":         yl,
            "population_affected": round(population * seg["population_fraction"]),
            "baseline_curve":     [round(v, 5) for v in baseline],
            "conflict_curve":     conflict_curve,
            "multiplier":         seg["multiplier"],
            "source":             seg["source"],
            "disruption_points": [
                {
                    "age":   conflict_start_age,
                    "year":  conflict_start,
                    "type":  "break",
                    "label": f"Conflict escalation ({conflict_start})",
                }
            ],
        }

    result = {
        "conflict":           conflict,
        "country":            country_key,
        "cohort_birth":       cohort_birth,
        "conflict_start_year": conflict_start,
        "conflict_start_age": conflict_start_age,
        "population":         population,
        "events":             _CONFLICT_EVENTS.get(country_key, []),
        "segments":           segments_out,
        "life_stage_bands":   _LIFE_STAGE_BANDS,
        "data_notes": (
            "Baseline survival curves: WHO Global Health Observatory Life Tables 2024. "
            "Conflict-adjusted curves apply annual excess mortality derived from UCDP/ACLED "
            "reported deaths relative to UN population estimates. Segment multipliers: "
            "children_under_5 2.8× (UNICEF 2023), medical_staff 4.2× (WHO Health Attacks 2024), "
            "teachers 2.1× (GCPEA 2023). Values are illustrative estimates, not actuarial projections."
        ),
        "sources": ["WHO Life Tables 2024", "UCDP GED", "ACLED", "UNICEF", "WHO Health Cluster", "GCPEA"],
        "generated_at": now.isoformat(),
    }

    _lifelines_cache[cache_key] = result
    _lifelines_cache_ts[cache_key] = now
    return result


# ─── GDELT DOC 2.0 integration ────────────────────────────────────────────────
#
# GDELT DOC 2.0 is a public, no-auth API surfacing global online news volume,
# tone, and geocoded article metadata (updated every 15 minutes). It provides
# media-attention and sentiment signals that complement — but never replace —
# the casualty totals from UCDP/ACLED/OHCHR/OCHA. GDELT rows are stored in a
# dedicated collection (`gdelt_timeline`) and are never merged into `conflicts`
# or `chart_conflicts`, preserving the existing source-separation rule.
#
# Docs consulted (offline): GDELT DOC 2.0 timeline modes accept a free-text
# query, a `timespan` (e.g. `30d`, `7d`) and `mode=timelinevolraw` or
# `timelinetone` and return date-bucketed JSON.

GDELT_DOC_API = "https://api.gdeltproject.org/api/v2/doc/doc"

# Approximate geographic centroid (lat, lon) per tracked conflict — used to
# anchor the ConflictGlobe live-event markers. These are the same country
# anchors used in `frontend/src/components/ConflictGlobe.js` BASE_MARKERS.
GDELT_COUNTRY_CENTROIDS: Dict[str, tuple] = {
    'Ukraine':        (49.0,  31.0),
    'Gaza/Palestine': (31.5,  34.5),
    'Sudan':          (15.5,  32.5),
    'Myanmar':        (17.0,  96.0),
    'Syria':          (35.0,  38.0),
    'Yemen':          (15.5,  48.0),
    'Ethiopia':       (9.0,   40.0),
    'DRC (Congo)':    (-4.0,  21.5),
    'Iran':           (32.0,  53.0),
    'Lebanon':        (33.9,  35.5),
    'Haiti':          (18.9, -72.3),
}

# GDELT DOC 2.0 free-text query per conflict. Kept intentionally simple —
# the country name alone is a well-tuned filter in GDELT.
GDELT_QUERY_MAP: Dict[str, str] = {
    'Ukraine':        '(Ukraine war OR Ukraine conflict OR Ukraine Russia)',
    'Gaza/Palestine': '(Gaza OR "Gaza Strip" OR Palestine conflict)',
    'Sudan':          '(Sudan war OR "Sudan conflict" OR RSF Sudan)',
    'Myanmar':        '(Myanmar OR Burma) (junta OR "civil war" OR conflict)',
    'Syria':          '(Syria conflict OR "Syrian war" OR Syria HTS OR Syria SDF)',
    'Yemen':          '(Yemen OR Houthi) (war OR conflict OR strike)',
    'Ethiopia':       '(Ethiopia OR Amhara OR Tigray) (conflict OR fighting)',
    'DRC (Congo)':    '(Congo OR DRC OR M23) (conflict OR fighting)',
    'Iran':           '(Iran war OR "Iran conflict" OR "Iran strike")',
    'Lebanon':        '(Lebanon OR Hezbollah) (war OR strike OR conflict)',
    'Haiti':          '(Haiti gang OR "Haiti violence" OR "Haiti conflict")',
}

# ── GDELT Events 2.0 CSV pipeline ─────────────────────────────────────────────
#
# Instead of the rate-limited DOC 2.0 API, we consume the raw 15-minute Events
# CSV zip files published at data.gdeltproject.org/gdeltv2/.  These are public,
# unauthenticated bulk downloads with no rate limits.  Each file is ~2-5 MB
# compressed and covers all global events in a 15-minute window.
#
# We filter to the ~11 FIPS country codes that correspond to our tracked
# conflicts, aggregate article counts and average tone per (country, date), and
# persist the result in the `gdelt_ticks` MongoDB collection with a 32-day TTL.
# The in-memory `_gdelt_cache` is rebuilt from MongoDB by `_build_gdelt_cache_from_db()`.

GDELT_LASTUPDATE_URL = "http://data.gdeltproject.org/gdeltv2/lastupdate.txt"

# FIPS 2-letter country codes used in GDELT Events ActionGeo_CountryCode.
# Multiple codes per entry where a conflict spans ambiguous territory.
GDELT_FIPS_MAP: Dict[str, List[str]] = {
    'Ukraine':        ['UP'],
    'Gaza/Palestine': ['GZ'],
    'Sudan':          ['SU'],
    'Myanmar':        ['BM'],
    'Syria':          ['SY'],
    'Yemen':          ['YM'],
    'Ethiopia':       ['ET'],
    'DRC (Congo)':    ['CG'],
    'Iran':           ['IR'],
    'Lebanon':        ['LE'],
    'Haiti':          ['HA'],
}

# Reverse map: FIPS code → WatchTower country name
_FIPS_TO_COUNTRY: Dict[str, str] = {
    fips: country
    for country, codes in GDELT_FIPS_MAP.items()
    for fips in codes
}

# GDELT 2.0 Events CSV column indices (0-based, tab-separated, no header row).
# Source: GDELT 2.0 Event Database Codebook (fields 1-61 → indices 0-60).
_GCOL_DATE    = 1   # SQLDATE: YYYYMMDD
_GCOL_N_ART   = 33  # NumArticles: article count referencing this event
_GCOL_TONE    = 34  # AvgTone: average tone across all articles (-100 to +100)
_GCOL_CTRY    = 53  # ActionGeo_CountryCode: FIPS 2-letter code of action location

# GKG 2.1 CSV column indices (0-based, tab-separated, no header row).
# Source: GDELT Global Knowledge Graph Codebook v2.1
_GKG_DATE   = 1    # DATE: YYYYMMDDHHMMSS
_GKG_THEMES = 7    # V1Themes: semicolon-separated plain theme names
_GKG_LOCS   = 11   # V2Locations: semicolons separate records; within each record, # separates fields
_GKG_TONE   = 17   # V1.1Tone: comma-separated, first value is overall tone

# Maps each WatchTower display-theme → GDELT GKG theme strings to match.
# If ANY keyword appears in the article's V1Themes the display theme is counted.
_GKG_THEME_KEYWORDS: Dict[str, List[str]] = {
    "KILL":            ["KILL"],
    "WOUND":           ["WOUND"],
    "REFUGEES":        ["REFUGEES", "REFUGEE"],
    "FAMINE":          ["FAMINE"],
    "HOSPITAL":        ["HOSPITAL"],
    "HUMANITARIAN":    ["HUMANITARIAN"],
    "CEASEFIRE":       ["WB_PEACE_CEASEFIRE", "CEASEFIRE"],
    "PEACE":           ["WB_PEACE_CEASEFIRE", "PEACE"],
    "NEGOTIATION":     ["NEGOTIATION"],
    "DIPLOMACY":       ["ECON_DIPLOMATIC_RELATIONS", "DIPLOMACY"],
    "MILITARY_STRIKE": ["MILITARY_STRIKE"],
    "ATTACK":          ["ATTACK"],
}

# Tracks file timestamps (YYYYMMDDHHMMSS) already processed this session to
# prevent double-counting on scheduler overlap or backend restart within TTL.
_gdelt_csv_seen: set = set()
_gdelt_gkg_seen: set = set()

# In-memory cache mirroring the pattern used by _treemap_cache. Populated by
# the 15-minute CSV scheduler job; served straight from the API endpoints.
_gdelt_cache: Dict[str, Dict] = {}   # country -> {volume, tone, dates, latest_*, ...}
_gdelt_cache_ts: Optional[datetime] = None

# Global rate-limiter for GDELT DOC 2.0.  The API enforces roughly one request
# every 10 seconds; _GDELT_MIN_INTERVAL=15s gives a comfortable margin.  All
# callers must acquire this lock before sending any request to api.gdeltproject.org.
_gdelt_rate_lock: asyncio.Lock = asyncio.Lock()
_gdelt_last_request_ts: Optional[float] = None  # monotonic seconds
_GDELT_MIN_INTERVAL: float = 15.0   # Widened from 12s — network jitter can cause false 429s near the 10s floor

# Retry config: on 429 or non-JSON (soft throttle), wait this many seconds then
# attempt exactly one more request before giving up for this cycle.
_GDELT_RETRY_DELAYS: tuple = (30, 60)   # seconds to wait before attempt 2, attempt 3


async def _gdelt_fetch_mode(
    session: aiohttp.ClientSession,
    query: str,
    mode: str,
    timespan: str = "30d",
) -> Optional[Dict]:
    """Call the GDELT DOC 2.0 API for a single mode and return parsed JSON.

    Enforces the rate-limit of one request every _GDELT_MIN_INTERVAL seconds via
    a global asyncio.Lock.  On 429 or soft-throttle (200 + plain-text body) the
    function waits _GDELT_RETRY_DELAYS[attempt] seconds and retries up to
    len(_GDELT_RETRY_DELAYS) additional times before returning None.
    Non-retriable HTTP errors and network exceptions still return None immediately.
    """
    global _gdelt_last_request_ts

    params = {
        "query":    query,
        "mode":     mode,
        "timespan": timespan,
        "format":   "json",
    }

    max_attempts = 1 + len(_GDELT_RETRY_DELAYS)   # 1 initial + N retries

    for attempt in range(max_attempts):
        async with _gdelt_rate_lock:
            # Sleep until the minimum inter-request gap has elapsed.
            if _gdelt_last_request_ts is not None:
                elapsed = asyncio.get_event_loop().time() - _gdelt_last_request_ts
                gap = _GDELT_MIN_INTERVAL - elapsed
                if gap > 0:
                    await asyncio.sleep(gap)
            _gdelt_last_request_ts = asyncio.get_event_loop().time()

            try:
                async with session.get(
                    GDELT_DOC_API,
                    params=params,
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as resp:
                    if resp.status == 429:
                        retry_wait = _GDELT_RETRY_DELAYS[attempt] if attempt < len(_GDELT_RETRY_DELAYS) else None
                        if retry_wait is not None:
                            logger.warning(
                                f"GDELT rate-limited (429) for mode={mode} query={query!r} "
                                f"— retrying in {retry_wait}s (attempt {attempt + 1}/{max_attempts})"
                            )
                            await asyncio.sleep(retry_wait)
                            continue
                        logger.warning(f"GDELT rate-limited (429) for mode={mode} query={query!r} — giving up")
                        return None

                    if resp.status != 200:
                        logger.warning(f"GDELT {mode} HTTP {resp.status} for query={query!r} — not retrying")
                        return None

                    text = await resp.text()
                    # GDELT returns a plain-text throttle message on HTTP 200 when overloaded.
                    if not text.strip().startswith("{"):
                        retry_wait = _GDELT_RETRY_DELAYS[attempt] if attempt < len(_GDELT_RETRY_DELAYS) else None
                        if retry_wait is not None:
                            logger.warning(
                                f"GDELT {mode} soft-throttle (non-JSON 200) for query={query!r}: "
                                f"{text[:80]!r} — retrying in {retry_wait}s (attempt {attempt + 1}/{max_attempts})"
                            )
                            await asyncio.sleep(retry_wait)
                            continue
                        logger.warning(
                            f"GDELT {mode} soft-throttle for query={query!r}: {text[:80]!r} — giving up"
                        )
                        return None

                    try:
                        return json.loads(text)
                    except json.JSONDecodeError:
                        logger.warning(f"GDELT {mode} JSON parse error for query={query!r} — not retrying")
                        return None

            except Exception as exc:
                logger.warning(f"GDELT {mode} error for query={query!r}: {exc}")
                return None

    return None  # exhausted all attempts


def _parse_gdelt_events_csv_sync(data: bytes) -> List[Dict]:
    """Parse a GDELT 2.0 Events CSV zip (synchronous, runs in thread-pool executor).

    Decompresses the zip, iterates rows, and returns only the rows matching
    our tracked FIPS country codes.  Each returned dict has:
      country, date (YYYY-MM-DD), n_art (int), tone (float).
    """
    rows: List[Dict] = []
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            csv_name = next(
                (n for n in zf.namelist() if n.upper().endswith('.CSV')),
                zf.namelist()[0],
            )
            with zf.open(csv_name) as f:
                reader = csv.reader(
                    io.TextIOWrapper(f, encoding='utf-8', errors='replace'),
                    delimiter='\t',
                )
                for row in reader:
                    if len(row) <= _GCOL_CTRY:
                        continue
                    country = _FIPS_TO_COUNTRY.get(row[_GCOL_CTRY])
                    if not country:
                        continue
                    try:
                        raw_date = row[_GCOL_DATE]
                        date  = f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:8]}"
                        n_art = int(float(row[_GCOL_N_ART] or 0))
                        tone  = float(row[_GCOL_TONE] or 0)
                    except (ValueError, IndexError):
                        continue
                    rows.append({"country": country, "date": date, "n_art": n_art, "tone": tone})
    except Exception as exc:
        logger.warning(f"GDELT CSV parse error: {exc}")
    return rows


def _parse_gdelt_gkg_csv_sync(data: bytes) -> List[Dict]:
    """Parse a GDELT 2.1 GKG CSV zip (synchronous, runs in thread-pool executor).

    Scans a range of columns for both themes and locations to be robust to minor
    GKG format version changes — rather than relying on a single fixed index.

    Theme columns scanned: 6-10 (covers V1Themes, V2Themes, V2.1EnhancedThemes)
    Location columns scanned: 9-13 (covers V1Locations, V2Locations, V2.1EnhancedLocations)

    Each returned dict:  {country, date (YYYY-MM-DD), themes: {display_theme: count}}
    """
    rows: List[Dict] = []
    total_rows = 0
    country_hits: Dict[str, int] = {}   # FIPS codes seen in location fields, for diagnostics

    # Column ranges to scan (0-indexed, inclusive)
    THEME_COLS  = range(6, 11)   # columns 6-10 cover all theme-like fields
    LOC_COLS    = range(9, 14)   # columns 9-13 cover all location-like fields
    MIN_COLS    = 14             # rows shorter than this are skipped

    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            csv_name = next(
                (n for n in zf.namelist() if n.upper().endswith('.CSV')),
                zf.namelist()[0],
            )
            logger.info(f"GDELT GKG parser: opened {csv_name} from zip ({len(data)//1024} KB compressed)")
            with zf.open(csv_name) as f:
                reader = csv.reader(
                    io.TextIOWrapper(f, encoding='utf-8', errors='replace'),
                    delimiter='\t',
                )
                for row in reader:
                    total_rows += 1
                    if len(row) < MIN_COLS:
                        continue

                    # -- Date from column 1 --
                    raw_date = row[1]
                    if len(raw_date) < 8:
                        continue
                    try:
                        date = f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:8]}"
                    except Exception:
                        continue

                    # -- Identify target countries by scanning all location columns --
                    matched_countries: set = set()
                    for col_idx in LOC_COLS:
                        if col_idx >= len(row):
                            break
                        for loc_record in row[col_idx].split(";"):
                            parts = loc_record.split("#")
                            if len(parts) >= 3:
                                fips = parts[2].strip()
                                ctry = _FIPS_TO_COUNTRY.get(fips)
                                if ctry:
                                    matched_countries.add(ctry)
                                if len(fips) == 2 and fips.isalpha():
                                    country_hits[fips] = country_hits.get(fips, 0) + 1
                    if not matched_countries:
                        continue

                    # -- Match themes by scanning all theme columns --
                    themes_combined = " ".join(
                        row[c] for c in THEME_COLS if c < len(row)
                    ).upper()
                    theme_counts: Dict[str, int] = {}
                    for display_theme, keywords in _GKG_THEME_KEYWORDS.items():
                        for kw in keywords:
                            if kw in themes_combined:
                                theme_counts[display_theme] = 1
                                break
                    if not theme_counts:
                        continue

                    for country in matched_countries:
                        rows.append({"country": country, "date": date, "themes": theme_counts})
    except Exception as exc:
        logger.warning(f"GDELT GKG CSV parse error: {exc}")

    top_fips = sorted(country_hits.items(), key=lambda x: -x[1])[:15]
    logger.info(
        f"GDELT GKG parser: {total_rows} total rows → {len(rows)} matched our countries+themes. "
        f"Top FIPS codes in file: {top_fips}"
    )
    return rows


async def _upsert_gdelt_ticks(file_ts: str, rows: List[Dict]) -> None:
    """Aggregate parsed rows from one 15-min file and upsert into `gdelt_ticks`.

    One document per (file_ts, country) — idempotent so re-runs are safe.
    Tone is stored as a running sum so the daily average can be computed
    correctly when aggregating multiple 15-min slices into a single day bucket.
    """
    agg: Dict[tuple, Dict] = defaultdict(
        lambda: {"article_count": 0, "tone_sum": 0.0, "event_count": 0, "date": ""}
    )
    for r in rows:
        key = (r["country"], r["date"])
        agg[key]["article_count"] += r["n_art"]
        agg[key]["tone_sum"]      += r["tone"]
        agg[key]["event_count"]   += 1
        agg[key]["date"]           = r["date"]

    expires_at = datetime.now(timezone.utc) + timedelta(days=32)
    ops = [
        UpdateOne(
            {"file_ts": file_ts, "country": country},
            {"$setOnInsert": {
                "file_ts":       file_ts,
                "country":       country,
                "date":          vals["date"],
                "article_count": vals["article_count"],
                "tone_sum":      vals["tone_sum"],
                "event_count":   vals["event_count"],
                "expires_at":    expires_at,
            }},
            upsert=True,
        )
        for (country, _date), vals in agg.items()
    ]
    if ops:
        await db.gdelt_ticks.bulk_write(ops, ordered=False)


async def _upsert_gdelt_theme_ticks(file_ts: str, rows: List[Dict]) -> None:
    """Aggregate GKG rows from one 15-min file and upsert into `gdelt_theme_ticks`.

    One document per (file_ts, country) — idempotent, safe on re-run.
    """
    agg: Dict[tuple, Dict] = defaultdict(lambda: {"date": "", "themes": {}})
    for r in rows:
        key = (r["country"], r["date"])
        agg[key]["date"] = r["date"]
        for theme, count in r["themes"].items():
            agg[key]["themes"][theme] = agg[key]["themes"].get(theme, 0) + count

    expires_at = datetime.now(timezone.utc) + timedelta(days=32)
    ops = [
        UpdateOne(
            {"file_ts": file_ts, "country": country},
            {"$setOnInsert": {
                "file_ts":    file_ts,
                "country":    country,
                "date":       vals["date"],
                "themes":     vals["themes"],
                "expires_at": expires_at,
            }},
            upsert=True,
        )
        for (country, _date), vals in agg.items()
    ]
    if ops:
        await db.gdelt_theme_ticks.bulk_write(ops, ordered=False)


async def _build_gdelt_theme_caches_from_db() -> None:
    """Aggregate last 30 days of `gdelt_theme_ticks` → populate themes and diplomacy caches.

    Produces the same payload shapes that the endpoints previously fetched from DOC 2.0.
    Called at startup (after loading indexes) and at the end of every GKG CSV tick.
    """
    global _gdelt_themes_cache, _gdelt_themes_cache_ts
    global _gdelt_diplomacy_cache, _gdelt_diplomacy_cache_ts

    thirty_days_ago = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")

    # Accumulate theme counts per (country, date) from all stored ticks
    country_date_themes: Dict[str, Dict[str, Dict[str, int]]] = defaultdict(
        lambda: defaultdict(lambda: defaultdict(int))
    )
    try:
        async for doc in db.gdelt_theme_ticks.find({"date": {"$gte": thirty_days_ago}}):
            country = doc.get("country")
            date    = doc.get("date")
            themes  = doc.get("themes", {})
            if country and date:
                for theme, count in themes.items():
                    country_date_themes[country][date][theme] += count
    except Exception as exc:
        logger.warning(f"GDELT theme ticks DB query failed: {exc}")
        return

    if not country_date_themes:
        logger.info("GDELT theme caches: no data in gdelt_theme_ticks yet (will populate on next CSV tick)")
        return

    now = datetime.now(timezone.utc)

    for country, date_themes in country_date_themes.items():
        dates = sorted(date_themes.keys())

        # ── Humanitarian Themes ──────────────────────────────────────────────
        theme_timelines: Dict[str, Dict] = {}
        radar_values:    Dict[str, float] = {}
        for display_theme in HUMANITARIAN_THEMES:
            values = [float(date_themes[d].get(display_theme, 0)) for d in dates]
            if any(v > 0 for v in values):
                theme_timelines[display_theme] = {"dates": dates, "values": values}
                last7 = values[-7:] if len(values) >= 7 else values
                radar_values[display_theme] = round(sum(last7) / len(last7), 4) if last7 else 0.0

        _gdelt_themes_cache[country]    = {
            "country":      country,
            "timelines":    theme_timelines,
            "radar_values": radar_values,
            "themes":       HUMANITARIAN_THEMES,
        }
        _gdelt_themes_cache_ts[country] = now

        # ── Diplomacy vs Violence ────────────────────────────────────────────
        dipl_by_date: Dict[str, float] = {}
        viol_by_date: Dict[str, float] = {}
        for d in dates:
            d_total = sum(date_themes[d].get(t, 0) for t in DIPLOMACY_THEMES)
            v_total = sum(date_themes[d].get(t, 0) for t in VIOLENCE_THEMES)
            if d_total: dipl_by_date[d] = float(d_total)
            if v_total: viol_by_date[d] = float(v_total)

        all_dates = sorted(set(dipl_by_date) | set(viol_by_date))
        dipl_vals = [round(dipl_by_date.get(d, 0.0), 4) for d in all_dates]
        viol_vals = [round(viol_by_date.get(d, 0.0), 4) for d in all_dates]
        last7_d   = dipl_vals[-7:] if len(dipl_vals) >= 7 else dipl_vals
        last7_v   = viol_vals[-7:] if len(viol_vals) >= 7 else viol_vals
        avg_d     = round(sum(last7_d) / len(last7_d), 4) if last7_d else 0.0
        avg_v     = round(sum(last7_v) / len(last7_v), 4) if last7_v else 0.0
        denom     = avg_d + avg_v
        pulse     = round(avg_d / denom, 3) if denom > 0 else None

        _gdelt_diplomacy_cache[country]    = {
            "country":          country,
            "dates":            all_dates,
            "diplomacy":        dipl_vals,
            "violence":         viol_vals,
            "avg_dipl_7d":      avg_d,
            "avg_viol_7d":      avg_v,
            "pulse_index":      pulse,
            "diplomacy_themes": DIPLOMACY_THEMES,
            "violence_themes":  VIOLENCE_THEMES,
        }
        _gdelt_diplomacy_cache_ts[country] = now

    logger.info(f"GDELT theme caches rebuilt from DB: {len(country_date_themes)} countries")


async def _build_gdelt_cache_from_db() -> Dict[str, Dict]:
    """Aggregate the last 30 days of `gdelt_ticks` into the `_gdelt_cache` structure.

    Returns the same shape as the old DOC 2.0 fetch so all existing endpoints
    remain unchanged:
      {country: {dates, volume, tone, latest_volume, avg_volume_7d, avg_tone_7d,
                 volume_delta_pct, tone_delta, centroid}}
    """
    cutoff_date = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")
    pipeline = [
        {"$match": {"date": {"$gte": cutoff_date}}},
        {"$group": {
            "_id":           {"country": "$country", "date": "$date"},
            "article_count": {"$sum": "$article_count"},
            "tone_sum":      {"$sum": "$tone_sum"},
            "event_count":   {"$sum": "$event_count"},
        }},
        {"$sort": {"_id.date": 1}},
    ]
    try:
        raw = await db.gdelt_ticks.aggregate(pipeline).to_list(length=20000)
    except Exception as exc:
        logger.warning(f"GDELT cache DB aggregate failed: {exc}")
        return {}

    country_days: Dict[str, Dict[str, Dict]] = defaultdict(dict)
    for row in raw:
        country     = row["_id"]["country"]
        date        = row["_id"]["date"]
        event_count = row["event_count"] or 1
        avg_tone    = row["tone_sum"] / event_count
        country_days[country][date] = {
            "volume": row["article_count"],
            "tone":   round(avg_tone, 4),
        }

    results: Dict[str, Dict] = {}
    for country in GDELT_FIPS_MAP:
        day_map = country_days.get(country, {})
        dates   = sorted(day_map)
        if not dates:
            continue

        volumes = [day_map[d]["volume"] for d in dates]
        tones   = [day_map[d]["tone"]   for d in dates]

        last7_vol  = volumes[-7:]    if len(volumes) >= 1  else []
        last7_tone = tones[-7:]      if len(tones)   >= 1  else []
        prev7_vol  = volumes[-14:-7] if len(volumes) >= 14 else []
        prev7_tone = tones[-14:-7]   if len(tones)   >= 14 else []

        avg_volume_7d = round(sum(last7_vol)  / len(last7_vol),  4) if last7_vol  else 0.0
        avg_tone_7d   = round(sum(last7_tone) / len(last7_tone), 4) if last7_tone else 0.0

        volume_delta_pct: Optional[float] = None
        if prev7_vol and sum(prev7_vol) > 0:
            volume_delta_pct = round(
                ((sum(last7_vol) - sum(prev7_vol)) / sum(prev7_vol)) * 100, 1
            )
        tone_delta: Optional[float] = None
        if prev7_tone:
            tone_delta = round(avg_tone_7d - (sum(prev7_tone) / len(prev7_tone)), 3)

        results[country] = {
            "dates":            dates,
            "volume":           volumes,
            "tone":             tones,
            "latest_volume":    round(volumes[-1], 4) if volumes else 0.0,
            "avg_volume_7d":    avg_volume_7d,
            "avg_tone_7d":      avg_tone_7d,
            "volume_delta_pct": volume_delta_pct,
            "tone_delta":       tone_delta,
            "centroid":         list(GDELT_COUNTRY_CENTROIDS.get(country, (0.0, 0.0))),
        }
        logger.info(
            f"GDELT CSV: {country} → volume7d={avg_volume_7d} tone7d={avg_tone_7d} "
            f"Δvol={volume_delta_pct}% Δtone={tone_delta}"
        )

    return results


async def fetch_gdelt_csv_tick() -> None:
    """Download the latest GDELT Events + GKG CSVs, parse, and upsert into MongoDB.

    Called every 15 minutes by the scheduler.  `lastupdate.txt` exposes URLs for
    three file types in the same timestamp: export (events), mentions, and gkg.
    We download both the Events CSV (for volume/tone timeline) and the GKG CSV
    (for humanitarian themes and diplomacy signals) — both are public bulk downloads
    with no rate limits.

    File timestamps are idempotency keys — re-runs in the same window are no-ops.
    """
    global _gdelt_cache, _gdelt_cache_ts, _gdelt_csv_seen, _gdelt_gkg_seen

    async with aiohttp.ClientSession(headers={"User-Agent": "WatchTower/1.0"}) as session:
        # ── 1. Fetch lastupdate.txt — discover URLs for both file types ────────
        try:
            async with session.get(
                GDELT_LASTUPDATE_URL,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status != 200:
                    logger.warning(f"GDELT lastupdate.txt HTTP {resp.status}")
                    return
                text = await resp.text()
        except Exception as exc:
            logger.warning(f"GDELT lastupdate.txt fetch failed: {exc}")
            return

        # Format: "<bytes> <md5> <url>" — three lines (export / mentions / gkg)
        csv_url: Optional[str] = None
        gkg_url: Optional[str] = None
        for line in text.strip().splitlines():
            parts = line.split()
            if len(parts) >= 3:
                url_lower = parts[2].lower()
                if url_lower.endswith(".export.csv.zip"):
                    csv_url = parts[2]
                elif url_lower.endswith(".gkg.csv.zip"):
                    gkg_url = parts[2]

        logger.info(f"GDELT lastupdate.txt parsed: events={'found' if csv_url else 'MISSING'}, gkg={'found' if gkg_url else 'MISSING'}")
        if not csv_url:
            logger.warning("GDELT lastupdate.txt: no .export.CSV.zip URL found")
            return

        m = re.search(r'(\d{14})\.export\.CSV\.zip', csv_url)
        file_ts = m.group(1) if m else csv_url

        # ── 2. Download Events CSV (skip if already seen) ──────────────────────
        events_data: Optional[bytes] = None
        if file_ts not in _gdelt_csv_seen:
            try:
                async with session.get(csv_url, timeout=aiohttp.ClientTimeout(total=90)) as resp:
                    if resp.status == 200:
                        events_data = await resp.read()
                    else:
                        logger.warning(f"GDELT Events CSV {file_ts} HTTP {resp.status}")
            except Exception as exc:
                logger.warning(f"GDELT Events CSV {file_ts} download failed: {exc}")
        else:
            logger.debug(f"GDELT Events CSV {file_ts} already processed — skipping")

        # ── 3. Download GKG CSV (skip if already seen or URL missing) ──────────
        gkg_data: Optional[bytes] = None
        if gkg_url and file_ts not in _gdelt_gkg_seen:
            try:
                async with session.get(gkg_url, timeout=aiohttp.ClientTimeout(total=300)) as resp:
                    if resp.status == 200:
                        gkg_data = await resp.read()
                        logger.info(f"GDELT GKG CSV {file_ts} downloaded: {len(gkg_data) / 1024:.0f} KB")
                    else:
                        logger.warning(f"GDELT GKG CSV {file_ts} HTTP {resp.status}")
            except Exception as exc:
                logger.warning(f"GDELT GKG CSV {file_ts} download failed: {exc}")
        elif not gkg_url:
            logger.warning("GDELT lastupdate.txt: no .gkg.csv.zip URL — themes/diplomacy will not update")
        else:
            logger.debug(f"GDELT GKG CSV {file_ts} already processed this session — skipping")

    loop = asyncio.get_event_loop()

    # ── 4. Process Events CSV → gdelt_ticks → timeline cache ──────────────────
    if events_data:
        rows: List[Dict] = await loop.run_in_executor(
            None, _parse_gdelt_events_csv_sync, events_data
        )
        _gdelt_csv_seen.add(file_ts)
        if len(_gdelt_csv_seen) > 1000:
            _gdelt_csv_seen = set(list(_gdelt_csv_seen)[-500:])

        if rows:
            try:
                await _upsert_gdelt_ticks(file_ts, rows)
            except Exception as exc:
                logger.warning(f"GDELT Events {file_ts} DB upsert failed: {exc}")

            results = await _build_gdelt_cache_from_db()
            if results:
                _gdelt_cache    = results
                _gdelt_cache_ts = datetime.now(timezone.utc)
                logger.info(
                    f"GDELT Events tick {file_ts}: {len(rows)} rows → "
                    f"timeline cache rebuilt for {len(results)} countries"
                )
            else:
                logger.warning(f"GDELT Events tick {file_ts}: DB aggregate returned no data")

    # ── 5. Process GKG CSV → gdelt_theme_ticks → themes/diplomacy caches ──────
    if gkg_data:
        gkg_rows: List[Dict] = await loop.run_in_executor(
            None, _parse_gdelt_gkg_csv_sync, gkg_data
        )
        _gdelt_gkg_seen.add(file_ts)
        if len(_gdelt_gkg_seen) > 1000:
            _gdelt_gkg_seen = set(list(_gdelt_gkg_seen)[-500:])

        if gkg_rows:
            try:
                await _upsert_gdelt_theme_ticks(file_ts, gkg_rows)
            except Exception as exc:
                logger.warning(f"GDELT GKG {file_ts} DB upsert failed: {exc}")

            await _build_gdelt_theme_caches_from_db()
            logger.info(
                f"GDELT GKG tick {file_ts}: {len(gkg_rows)} theme-rows upserted"
            )
        else:
            logger.warning(f"GDELT GKG tick {file_ts}: parser returned 0 rows — no articles matched our FIPS codes + themes")


async def fetch_gdelt_data() -> Dict[str, Dict]:
    """Rebuild the GDELT in-memory cache from accumulated CSV data in MongoDB.

    Runs a CSV tick first to pick up the latest 15-min file, then aggregates
    the full 30-day window from `gdelt_ticks`.  Called from `refresh_all_data()`
    and on inline cache-miss in endpoints.
    """
    global _gdelt_cache, _gdelt_cache_ts

    await fetch_gdelt_csv_tick()

    # CSV tick may have found no new file — rebuild from whatever is in DB
    if not _gdelt_cache:
        results = await _build_gdelt_cache_from_db()
        if results:
            _gdelt_cache    = results
            _gdelt_cache_ts = datetime.now(timezone.utc)

    return _gdelt_cache


@api_router.get("/gdelt-timeline")
async def get_gdelt_timeline(country: Optional[str] = None):
    """Return GDELT DOC 2.0 volume + tone timeline.

    If `country` is provided, returns the single-country payload; otherwise
    returns a dict keyed by country name. Served from the in-memory cache
    populated by the hourly scheduler.
    """
    if not _gdelt_cache:
        # Cache miss (backend just restarted) — try a live fetch inline.
        try:
            await fetch_gdelt_data()
        except Exception as exc:
            logger.warning(f"GDELT inline fetch failed: {exc}")
    if country:
        payload = _gdelt_cache.get(country)
        if not payload:
            raise HTTPException(status_code=404, detail=f"No GDELT data for country={country!r}")
        return {
            "country":     country,
            "fetched_at":  _gdelt_cache_ts.isoformat() if _gdelt_cache_ts else None,
            "source":      "GDELT DOC 2.0",
            **payload,
        }
    return {
        "fetched_at":  _gdelt_cache_ts.isoformat() if _gdelt_cache_ts else None,
        "source":      "GDELT DOC 2.0",
        "countries":   _gdelt_cache,
    }


@api_router.get("/live-events")
async def get_live_events():
    """Return per-conflict media-density markers for the globe overlay.

    Emits a lightweight list of {country, lat, lon, intensity, tone, volume_delta}
    suitable for rendering as pulsing globe markers. Intensity is a 0..1
    normalised value derived from GDELT 7-day average article volume.
    """
    if not _gdelt_cache:
        try:
            await fetch_gdelt_data()
        except Exception as exc:
            logger.warning(f"GDELT inline fetch failed: {exc}")

    if not _gdelt_cache:
        return {"fetched_at": None, "source": "GDELT DOC 2.0", "markers": []}

    max_vol = max((c.get("avg_volume_7d", 0.0) for c in _gdelt_cache.values()), default=0.0) or 1.0

    markers = []
    for country, payload in _gdelt_cache.items():
        lat, lon = payload.get("centroid", [0.0, 0.0])
        if lat == 0.0 and lon == 0.0:
            continue
        vol = payload.get("avg_volume_7d", 0.0)
        intensity = min(1.0, vol / max_vol) if max_vol else 0.0
        markers.append({
            "country":          country,
            "lat":              lat,
            "lon":              lon,
            "intensity":        round(intensity, 3),
            "avg_tone_7d":      payload.get("avg_tone_7d", 0.0),
            "volume_delta_pct": payload.get("volume_delta_pct"),
            "tone_delta":       payload.get("tone_delta"),
        })

    return {
        "fetched_at": _gdelt_cache_ts.isoformat() if _gdelt_cache_ts else None,
        "source":     "GDELT DOC 2.0",
        "markers":    markers,
    }


# ─── GDELT extended endpoints ─────────────────────────────────────────────────
#
# Four additional GDELT-backed endpoints added after the initial live-events /
# gdelt-timeline pair.  All read from the in-memory `_gdelt_cache` (populated
# hourly) and / or make secondary GDELT DOC 2.0 calls with their own short TTL
# caches.  Source-separation rule applies: GDELT data NEVER enters MongoDB.

# ── #1 Forgotten Crises ───────────────────────────────────────────────────────

@api_router.get("/forgotten-crises")
async def get_forgotten_crises():
    """Return a ranked list of conflicts sorted by attention-gap ratio.

    attention_ratio = avg_volume_7d / (total_deaths_per_1k)

    A *low* ratio means many deaths but little media coverage — i.e. an
    under-reported crisis.  The endpoint reads from the existing
    `_gdelt_cache` (media attention) and the `conflicts` MongoDB collection
    (casualty totals) so no additional GDELT calls are required.
    """
    if not _gdelt_cache:
        try:
            await fetch_gdelt_data()
        except Exception as exc:
            logger.warning(f"GDELT inline fetch failed: {exc}")

    # Pull casualty totals from MongoDB
    try:
        db_conflicts = await db.conflicts.find(
            {"status": "active"},
            {"country": 1, "total_deaths": 1},
        ).to_list(length=50)
    except Exception as exc:
        logger.warning(f"MongoDB fetch for forgotten-crises failed: {exc}")
        db_conflicts = []

    deaths_by_country: Dict[str, int] = {
        c["country"]: int(c.get("total_deaths", 0) or 0)
        for c in db_conflicts
    }

    rows = []
    for country, gdelt in _gdelt_cache.items():
        deaths = deaths_by_country.get(country, 0)
        if deaths <= 0:
            continue
        vol7 = gdelt.get("avg_volume_7d", 0.0) or 0.0
        # deaths_per_1k = deaths / 1000.  Ratio = vol / deaths_per_1k.
        # Lower ratio = more forgotten.
        deaths_per_k = deaths / 1000.0
        attention_ratio = round(vol7 / deaths_per_k, 4) if deaths_per_k else None
        rows.append({
            "country":          country,
            "total_deaths":     deaths,
            "avg_volume_7d":    round(vol7, 4),
            "attention_ratio":  attention_ratio,
            "volume_delta_pct": gdelt.get("volume_delta_pct"),
            "avg_tone_7d":      gdelt.get("avg_tone_7d"),
        })

    # Sort ascending by attention_ratio (most under-reported first)
    rows.sort(key=lambda r: (r["attention_ratio"] is None, r["attention_ratio"] or 0))

    return {
        "fetched_at": _gdelt_cache_ts.isoformat() if _gdelt_cache_ts else None,
        "source":     "GDELT DOC 2.0 + UCDP/ACLED",
        "conflicts":  rows,
    }


# ── #7 GDELT Alert Ticker ─────────────────────────────────────────────────────

# Refreshed as part of the hourly refresh_all_data() cycle (not a separate
# 15-minute job).  Using the same rate-limited _gdelt_fetch_mode keeps all
# GDELT requests serialised through the global rate lock.
_gdelt_alerts_cache: List[Dict] = []
_gdelt_alerts_cache_ts: Optional[datetime] = None

# Top-5 conflicts by severity — used for the artlist query to keep the query
# string short and avoid hitting GDELT's per-query complexity limits.
_ALERTS_QUERY_COUNTRIES = ["Ukraine", "Gaza/Palestine", "Sudan", "Myanmar", "Yemen"]


async def fetch_gdelt_alerts() -> List[Dict]:
    """Surface high-priority conflict articles from the existing RSS `news_articles` collection.

    Replaces the GDELT DOC 2.0 artlist mode — zero external API calls.  Articles
    are matched to a conflict country by keyword scan of the title, then returned
    in the same schema the frontend GdeltAlertTicker expects.  `tone` is set to
    None (RSS feeds carry no tone signal).
    """
    global _gdelt_alerts_cache, _gdelt_alerts_cache_ts

    # Keyword → WatchTower country name. Order matters: more-specific terms first.
    ALERT_KEYWORDS: List[tuple] = [
        ("Gaza",      "Gaza/Palestine"),
        ("Hezbollah", "Lebanon"),
        ("Lebanon",   "Lebanon"),
        ("Houthi",    "Yemen"),
        ("Yemen",     "Yemen"),
        ("Tigray",    "Ethiopia"),
        ("Ethiopia",  "Ethiopia"),
        ("Myanmar",   "Myanmar"),
        ("Burma",     "Myanmar"),
        ("Sudan",     "Sudan"),
        ("Ukraine",   "Ukraine"),
        ("Russia",    "Ukraine"),
        ("Syria",     "Syria"),
        ("Congo",     "DRC (Congo)"),
        ("DRC",       "DRC (Congo)"),
        ("Haiti",     "Haiti"),
        ("Iran",      "Iran"),
    ]

    try:
        articles = await db.news_articles.find(
            {},
            {"title": 1, "url": 1, "source": 1, "published": 1},
        ).sort("published", -1).limit(400).to_list(length=400)
    except Exception as exc:
        logger.warning(f"GDELT alerts (RSS fallback): MongoDB fetch failed: {exc}")
        _gdelt_alerts_cache_ts = datetime.now(timezone.utc)
        return []

    results: List[Dict] = []
    seen_urls: set = set()
    for art in articles:
        title = (art.get("title") or "").strip()
        url   = art.get("url", "")
        if not title or not url or url in seen_urls:
            continue

        title_upper = title.upper()
        country: Optional[str] = None
        for kw, cname in ALERT_KEYWORDS:
            if kw.upper() in title_upper:
                country = cname
                break

        if not country:
            continue

        seen_urls.add(url)
        results.append({
            "title":    title,
            "url":      url,
            "source":   art.get("source", ""),
            "seendate": art.get("published", ""),
            "tone":     None,   # RSS feeds carry no tone signal
            "country":  country,
            "language": "English",
        })

        if len(results) >= 40:
            break

    _gdelt_alerts_cache    = results
    _gdelt_alerts_cache_ts = datetime.now(timezone.utc)
    logger.info(f"GDELT alerts (RSS fallback): {len(results)} articles")
    return results


@api_router.get("/gdelt-alerts")
async def get_gdelt_alerts():
    """Return the most-negative recent articles across the top tracked conflicts.

    Served from the hourly-refreshed in-memory cache.  Returns stale data
    if the cache is cold rather than triggering a live fetch (which would
    consume GDELT rate-limit budget mid-session).
    """
    if not _gdelt_alerts_cache:
        try:
            await fetch_gdelt_alerts()
        except Exception as exc:
            logger.warning(f"GDELT alerts inline fetch failed: {exc}")

    return {
        "fetched_at": _gdelt_alerts_cache_ts.isoformat() if _gdelt_alerts_cache_ts else None,
        "source":     "GDELT DOC 2.0",
        "articles":   _gdelt_alerts_cache,
    }


# ── #2 Humanitarian Theme Radar ───────────────────────────────────────────────
#
# Cache populated every 15 minutes by the GKG CSV pipeline (fetch_gdelt_csv_tick).
# No DOC 2.0 API calls — all data comes from the bulk GKG CSV downloads.

_gdelt_themes_cache:    Dict[str, Dict]     = {}
_gdelt_themes_cache_ts: Dict[str, datetime] = {}

HUMANITARIAN_THEMES = [
    "KILL",
    "WOUND",
    "REFUGEES",
    "FAMINE",
    "HOSPITAL",
    "HUMANITARIAN",
    "CEASEFIRE",
    "PEACE",
]


@api_router.get("/gdelt-debug")
async def get_gdelt_debug():
    """Diagnostic endpoint — returns the state of all GDELT in-memory caches.

    Hit /api/gdelt-debug in a browser to see exactly what the pipeline has
    collected without needing server log access.
    """
    theme_tick_count  = await db.gdelt_theme_ticks.count_documents({})
    events_tick_count = await db.gdelt_ticks.count_documents({})
    return {
        "gdelt_cache_countries":      list(_gdelt_cache.keys()),
        "gdelt_cache_ts":             _gdelt_cache_ts.isoformat() if _gdelt_cache_ts else None,
        "themes_cache_countries":     list(_gdelt_themes_cache.keys()),
        "diplomacy_cache_countries":  list(_gdelt_diplomacy_cache.keys()),
        "gdelt_ticks_in_db":          events_tick_count,
        "gdelt_theme_ticks_in_db":    theme_tick_count,
        "gkg_seen_count":             len(_gdelt_gkg_seen),
        "csv_seen_count":             len(_gdelt_csv_seen),
    }


@api_router.get("/gdelt-themes")
async def get_gdelt_themes(country: str = "Ukraine", response: Response = None):
    """Return GDELT humanitarian-theme timelines derived from GKG CSV bulk data.

    Populated every 15 minutes by the CSV pipeline — no rate-limited API calls.
    Returns `pending: true` if the GKG pipeline hasn't processed its first file yet.
    """
    if response:
        response.headers["Cache-Control"] = "no-store"
    now = datetime.now(timezone.utc)
    if country not in _gdelt_themes_cache:
        return {
            "fetched_at": None, "source": "GDELT GKG CSV", "pending": True,
            "country": country, "timelines": {}, "radar_values": {}, "themes": HUMANITARIAN_THEMES,
        }
    payload = _gdelt_themes_cache[country]
    return {
        "fetched_at": _gdelt_themes_cache_ts.get(country, now).isoformat(),
        "source":     "GDELT GKG CSV",
        **payload,
    }


# ── #5 Diplomatic-Pulse Panel ─────────────────────────────────────────────────
#
# Cache populated every 15 minutes by the GKG CSV pipeline (fetch_gdelt_csv_tick).
# No DOC 2.0 API calls.

_gdelt_diplomacy_cache:    Dict[str, Dict]     = {}
_gdelt_diplomacy_cache_ts: Dict[str, datetime] = {}

DIPLOMACY_THEMES = ["PEACE", "CEASEFIRE", "NEGOTIATION", "DIPLOMACY"]
VIOLENCE_THEMES  = ["KILL", "WOUND", "MILITARY_STRIKE", "ATTACK"]


@api_router.get("/gdelt-diplomacy")
async def get_gdelt_diplomacy(country: str = "Ukraine", response: Response = None):
    """Return GDELT diplomacy-vs-violence pulse derived from GKG CSV bulk data.

    `pulse_index` runs 0 (pure violence coverage) → 1 (pure diplomacy coverage).
    Populated every 15 minutes by the CSV pipeline — no rate-limited API calls.
    """
    if response:
        response.headers["Cache-Control"] = "no-store"
    now = datetime.now(timezone.utc)
    if country not in _gdelt_diplomacy_cache:
        return {
            "fetched_at": None, "source": "GDELT GKG CSV", "pending": True,
            "country": country, "dates": [], "diplomacy": [], "violence": [],
            "pulse_index": None, "diplomacy_score": None, "violence_score": None,
        }
    payload = _gdelt_diplomacy_cache[country]
    return {
        "fetched_at": _gdelt_diplomacy_cache_ts.get(country, now).isoformat(),
        "source":     "GDELT GKG CSV",
        **payload,
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



async def _ensure_gdelt_indexes() -> None:
    """Create MongoDB indexes for gdelt_ticks and gdelt_theme_ticks (idempotent)."""
    try:
        for col in (db.gdelt_ticks, db.gdelt_theme_ticks):
            await col.create_index("expires_at", expireAfterSeconds=0)
            await col.create_index([("file_ts", 1), ("country", 1)], unique=True)
            await col.create_index([("date", 1), ("country", 1)])
        logger.info("gdelt_ticks + gdelt_theme_ticks indexes ensured")
    except Exception as exc:
        logger.warning(f"GDELT index creation failed (non-fatal): {exc}")


@app.on_event("startup")
async def startup_event():
    # Ensure MongoDB indexes before first data load
    await _ensure_gdelt_indexes()
    await refresh_all_data()
    # Hourly refresh for casualty data, news, and treemap
    scheduler.add_job(refresh_all_data, 'interval', hours=1)
    # 15-minute GDELT CSV tick — downloads Events + GKG files, upserts to DB,
    # rebuilds timeline, themes, and diplomacy caches with no API rate limits.
    scheduler.add_job(fetch_gdelt_csv_tick, 'interval', minutes=15, id='gdelt_csv_tick')
    scheduler.start()
    logger.info(
        "Scheduler started — casualty data refreshes hourly, "
        "GDELT CSV+GKG pipeline refreshes every 15 minutes"
    )
    # Warm up caches from any existing MongoDB data, then download the latest files.
    await _build_gdelt_theme_caches_from_db()
    asyncio.create_task(fetch_gdelt_csv_tick())


@app.on_event("shutdown")
async def shutdown_event():
    scheduler.shutdown()
    client.close()
    logger.info("Application shutdown complete")
