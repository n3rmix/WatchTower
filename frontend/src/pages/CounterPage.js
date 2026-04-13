import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import Header from '../components/Header';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

// ─── BASELINE DATA (ported from conflict-counter/data.js) ─────────────────────
// Cumulative deaths anchored at April 1, 2026. Sources: ACLED, UCDP, UN, OCHA.
const BASELINE_CONFLICTS = [
  {
    id: 'ukraine',
    name: 'Ukraine–Russia War',
    region: 'Europe',
    startDate: '2022-02-24',
    baseCumulative: 258000,
    dailyRate: 220,
    childDeaths: 860,
    childDailyRate: 0.57,
    childSource: 'UNICEF / OHCHR',
    childSourceUrl: 'https://www.unicefusa.org/press/significant-increase-number-children-killed-across-ukraine-year-deadly-attacks-continue',
    color: '#3b82f6',
    flag: '🇺🇦',
    source: 'ACLED / UN OHCHR',
    sourceUrl: 'https://acleddata.com',
    note: 'Includes military & civilian. Conservative estimate.',
  },
  {
    id: 'sudan',
    name: 'Sudan Civil War',
    region: 'Africa',
    startDate: '2023-04-15',
    baseCumulative: 150000,
    dailyRate: 180,
    childDeaths: 5200,
    childDailyRate: 8,
    childSource: 'UNICEF Sudan',
    childSourceUrl: 'https://www.unicefusa.org/press/least-40-children-reportedly-killed-three-days-across-sudan-unicef',
    color: '#ef4444',
    flag: '🇸🇩',
    source: 'ACLED / UN OCHA',
    sourceUrl: 'https://www.unocha.org/sudan',
    note: 'Includes famine-related and conflict deaths.',
  },
  {
    id: 'gaza',
    name: 'Gaza — Palestine',
    region: 'Middle East',
    startDate: '2023-10-07',
    baseCumulative: 52000,
    dailyRate: 35,
    childDeaths: 22000,
    childDailyRate: 12,
    childSource: 'Save the Children / Gaza MoH',
    childSourceUrl: 'https://www.savethechildren.net/news/gaza-20000-children-killed-23-months-war-more-one-child-killed-every-hour',
    color: '#f97316',
    flag: '🇵🇸',
    source: 'WHO / Gaza MoH / Lancet',
    sourceUrl: 'https://www.ochaopt.org',
    note: 'Verified reported deaths. Excess mortality est. up to 186k.',
  },
  {
    id: 'myanmar',
    name: 'Myanmar Civil War',
    region: 'Asia',
    startDate: '2021-02-01',
    baseCumulative: 50000,
    dailyRate: 55,
    childDeaths: 820,
    childDailyRate: 1.2,
    childSource: 'AAPP / UNICEF Myanmar',
    childSourceUrl: 'https://acleddata.com',
    color: '#a855f7',
    flag: '🇲🇲',
    source: 'ACLED / AAPP / UN',
    sourceUrl: 'https://acleddata.com',
    note: 'Since February 2021 coup.',
  },
  {
    id: 'nigeria',
    name: 'Nigeria — Multi-Conflict',
    region: 'Africa',
    startDate: '2009-07-26',
    baseCumulative: 35000,
    dailyRate: 30,
    childDeaths: 600,
    childDailyRate: 0.8,
    childSource: 'UNICEF Nigeria / ACLED',
    childSourceUrl: 'https://acleddata.com',
    color: '#22c55e',
    flag: '🇳🇬',
    source: 'ACLED',
    sourceUrl: 'https://acleddata.com',
    note: 'Boko Haram/ISWAP + regional conflicts from 2020.',
  },
  {
    id: 'syria',
    name: 'Syria',
    region: 'Middle East',
    startDate: '2011-03-15',
    baseCumulative: 500000,
    dailyRate: 15,
    childDeaths: 15000,
    childDailyRate: 0.4,
    childSource: 'UNICEF Syria / SNHR',
    childSourceUrl: 'https://ucdp.uu.se',
    color: '#06b6d4',
    flag: '🇸🇾',
    source: 'UCDP / SNHR',
    sourceUrl: 'https://ucdp.uu.se',
    note: 'Cumulative since 2011. Renewed fighting in 2024–25.',
  },
  {
    id: 'somalia',
    name: 'Somalia — al-Shabaab',
    region: 'Africa',
    startDate: '2007-01-01',
    baseCumulative: 30000,
    dailyRate: 18,
    childDeaths: 600,
    childDailyRate: 0.5,
    childSource: 'UNICEF Somalia',
    childSourceUrl: 'https://acleddata.com',
    color: '#84cc16',
    flag: '🇸🇴',
    source: 'ACLED / UN',
    sourceUrl: 'https://acleddata.com',
    note: 'From 2020 onward.',
  },
  {
    id: 'haiti',
    name: 'Haiti — Gang Violence',
    region: 'Americas',
    startDate: '2021-07-07',
    baseCumulative: 8500,
    dailyRate: 12,
    childDeaths: 350,
    childDailyRate: 0.4,
    childSource: 'UNICEF Haiti / BINUH',
    childSourceUrl: 'https://acleddata.com',
    color: '#f59e0b',
    flag: '🇭🇹',
    source: 'ACLED / BINUH',
    sourceUrl: 'https://acleddata.com',
    note: 'From 2022 gang conflict escalation.',
  },
  {
    id: 'ethiopia',
    name: 'Ethiopia (Tigray & Amhara)',
    region: 'Africa',
    startDate: '2020-11-04',
    baseCumulative: 300000,
    dailyRate: 25,
    childDeaths: 8000,
    childDailyRate: 1.5,
    childSource: 'PMC/NIH Tigray Study / HRW',
    childSourceUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12096794/',
    color: '#ec4899',
    flag: '🇪🇹',
    source: 'ACLED / UN',
    sourceUrl: 'https://acleddata.com',
    note: 'Includes Tigray war + ongoing Amhara/Oromia violence.',
  },
  {
    id: 'mexico',
    name: 'Mexico — Cartel Wars',
    region: 'Americas',
    startDate: '2006-12-11',
    baseCumulative: 45000,
    dailyRate: 20,
    childDeaths: 500,
    childDailyRate: 0.3,
    childSource: 'INEGI / ACLED',
    childSourceUrl: 'https://acleddata.com',
    color: '#64748b',
    flag: '🇲🇽',
    source: 'ACLED / INEGI',
    sourceUrl: 'https://acleddata.com',
    note: 'Organized crime / cartel violence from 2020.',
  },
  {
    id: 'lebanon',
    name: 'Lebanon — Israel War',
    region: 'Middle East',
    startDate: '2024-10-01',
    baseCumulative: 6000,
    dailyRate: 50,
    childDeaths: 575,
    childDailyRate: 6.5,
    childSource: 'Lebanese Health Ministry / WHO EMRO',
    childSourceUrl: 'https://www.emro.who.int/en/lebanon/index.html',
    color: '#14b8a6',
    flag: '🇱🇧',
    source: 'Lebanese Health Ministry / UN OCHA / UNIFIL',
    sourceUrl: 'https://www.unocha.org/lebanon',
    note: 'Oct 2024 Israeli invasion + resumed war from Mar 2, 2026. Apr 8 "Black Wednesday": 357 killed in one day.',
  },
  {
    id: 'iran-2026',
    name: 'Iran War (US–Israel)',
    region: 'Middle East',
    startDate: '2026-02-28',
    baseCumulative: 2600,
    dailyRate: 45,
    childDeaths: 280,
    childDailyRate: 3,
    childSource: 'Amnesty International / Iran MoH',
    childSourceUrl: 'https://www.amnesty.org/en/latest/news/2026/03/usa-iran-those-responsible-for-deadly-and-unlawful-us-strike-on-school-that-killed-over-100-children-must-be-held-accountable/',
    color: '#10b981',
    flag: '🇮🇷',
    source: 'Al Jazeera / Iran MoH / Wikipedia',
    sourceUrl: 'https://en.wikipedia.org/wiki/2026_Iran_war',
    note: 'US–Israel strikes from Feb 28, 2026.',
  },
  {
    id: 'iran-2025',
    name: 'Twelve-Day War (Iran–Israel)',
    region: 'Middle East',
    startDate: '2025-06-13',
    baseCumulative: 1270,
    dailyRate: 0,
    childDeaths: 240,
    childDailyRate: 0,
    childSource: 'Iranian Government / Wikipedia',
    childSourceUrl: 'https://en.wikipedia.org/wiki/Twelve-Day_War',
    color: '#f43f5e',
    flag: '🇮🇷',
    source: 'Wikipedia / HRANA / Israeli MoH',
    sourceUrl: 'https://en.wikipedia.org/wiki/Twelve-Day_War',
    note: 'Ended June 24, 2025. Iran: ~1,190 killed; Israel: 28 killed.',
  },
  {
    id: 'iran-protests-2026',
    name: 'Iran — Protest Crackdown',
    region: 'Middle East',
    startDate: '2025-12-28',
    baseCumulative: 7007,
    dailyRate: 0,
    childDeaths: 150,
    childDailyRate: 0,
    childSource: 'HRANA',
    childSourceUrl: 'https://hranaenglish.com',
    color: '#c084fc',
    flag: '🇮🇷',
    source: 'HRANA / Iran Human Rights',
    sourceUrl: 'https://hranaenglish.com',
    note: 'Jan 2026 crackdown on anti-government protests.',
  },
];

// ─── DATA LOGIC ───────────────────────────────────────────────────────────────
const BASELINE_DATE = new Date('2026-04-01T00:00:00Z');

// Maps Counter conflict IDs to backend API country names.
// Conflicts not listed here (Nigeria, Somalia, Mexico, Iran variants) stay hardcoded.
const API_COUNTRY_MAP = {
  'ukraine':  'Ukraine',
  'sudan':    'Sudan',
  'gaza':     'Gaza/Palestine',
  'myanmar':  'Myanmar',
  'syria':    'Syria',
  'haiti':    'Haiti',
  'ethiopia': 'Ethiopia',
  'lebanon':  'Lebanon',
};

function estimateCurrentDeaths(conflict) {
  const base = conflict.snapDate || BASELINE_DATE;
  const daysElapsed = (Date.now() - base) / 86400000;
  return conflict.baseCumulative + Math.max(0, Math.floor(daysElapsed * conflict.dailyRate));
}

function estimateCurrentChildDeaths(conflict) {
  const base = conflict.snapDate || BASELINE_DATE;
  const daysElapsed = Math.max(0, (Date.now() - base) / 86400000);
  return (conflict.childDeaths || 0) + Math.floor(daysElapsed * (conflict.childDailyRate || 0));
}

function estimateYTDDeaths() {
  const startOfYear = new Date('2026-01-01T00:00:00Z');
  const daysElapsed = (Date.now() - startOfYear) / 86400000;
  return Math.floor(daysElapsed * 657); // ~657/day global rate (ACLED 2025 index)
}

async function loadConflictData() {
  // Start with hardcoded baselines as fallback
  let mergedBaselines = BASELINE_CONFLICTS.map(c => ({ ...c }));
  let sourcesUpdatedAt = null;

  try {
    const [conflictsRes, lastUpdateRes] = await Promise.all([
      axios.get(`${BACKEND_URL}/api/conflicts`),
      axios.get(`${BACKEND_URL}/api/last-update`),
    ]);

    const apiConflicts = conflictsRes.data;
    const lu = lastUpdateRes.data;
    if (lu?.fetched_at) sourcesUpdatedAt = new Date(lu.fetched_at);
    const snapDate = sourcesUpdatedAt || BASELINE_DATE;

    // Override baseCumulative + childDeaths for API-matched conflicts,
    // using the API fetch timestamp as the interpolation anchor.
    mergedBaselines = mergedBaselines.map(c => {
      const apiCountry = API_COUNTRY_MAP[c.id];
      if (!apiCountry) return c;
      const api = apiConflicts.find(a => a.country === apiCountry);
      if (!api) return c;
      return {
        ...c,
        baseCumulative: api.total_deaths,
        childDeaths: api.children_deaths ?? c.childDeaths,
        snapDate,
      };
    });
  } catch {
    // Non-fatal: counter still works from hardcoded baselines
  }

  const conflicts = mergedBaselines.map(c => ({
    ...c,
    currentDeaths: estimateCurrentDeaths(c),
    currentChildDeaths: estimateCurrentChildDeaths(c),
    startDateFormatted: new Date(c.startDate).toLocaleDateString('en-GB', {
      year: 'numeric', month: 'long', day: 'numeric',
    }),
  }));

  const totalDeaths = conflicts.reduce((s, c) => s + c.currentDeaths, 0);
  const totalChildDeaths = conflicts.reduce((s, c) => s + c.currentChildDeaths, 0);
  const childDailyRateTotal = mergedBaselines.reduce((s, c) => s + (c.childDailyRate || 0), 0);

  return {
    conflicts,
    totalDeaths,
    totalChildDeaths,
    childDailyRateTotal,
    ytdDeaths: estimateYTDDeaths(),
    sourcesUpdatedAt,
  };
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────
function fmt(n) {
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}

function fmtShort(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return Math.round(n / 1_000) + 'K';
  return fmt(n);
}

function timeAgo(date) {
  if (!date) return '';
  const secs = Math.round((Date.now() - date) / 1000);
  if (secs < 10) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

function elapsedDays(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr)) / 86400000);
}

function easeOutExpo(t) {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

// ─── CONFLICT CARD ────────────────────────────────────────────────────────────
function ConflictCard({ conflict, maxDeaths }) {
  const pct = Math.min((conflict.currentDeaths / Math.max(maxDeaths, 1)) * 100, 100);
  const days = elapsedDays(conflict.startDate);

  return (
    <div className="bg-zinc-900 border border-zinc-800 p-4 flex flex-col gap-3 hover:border-zinc-700 transition-colors">
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-lg leading-none">{conflict.flag}</span>
            <span className="text-[11px] font-bold font-mono uppercase tracking-wider text-zinc-100 leading-tight">
              {conflict.name}
            </span>
          </div>
          <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-600 ml-0.5">
            {conflict.region}
          </span>
        </div>
        <div className="text-right flex-shrink-0">
          <div
            className="text-lg font-mono font-bold tabular-nums leading-none"
            style={{ color: conflict.color }}
          >
            {fmt(conflict.currentDeaths)}
          </div>
          <div className="text-[9px] font-mono text-zinc-600 mt-0.5">est. deaths</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 bg-zinc-800 w-full">
        <div
          className="h-full transition-all duration-500"
          style={{ width: `${pct}%`, background: conflict.color }}
        />
      </div>

      {/* Meta row */}
      <div className="flex items-center justify-between text-[9px] font-mono text-zinc-600">
        <span>Since {conflict.startDateFormatted}</span>
        {conflict.dailyRate > 0 && (
          <span className="text-zinc-500">~{conflict.dailyRate}/day</span>
        )}
        {conflict.dailyRate === 0 && (
          <span className="text-zinc-700 uppercase tracking-wider">ended</span>
        )}
      </div>

      {/* Note */}
      <p className="text-[9px] font-mono text-zinc-700 leading-relaxed border-t border-zinc-800 pt-2">
        {conflict.note}
      </p>

      {/* Source link */}
      <a
        href={conflict.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 text-[9px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors mt-auto w-fit"
      >
        <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
        {conflict.source}
      </a>
    </div>
  );
}

// ─── CHILDREN SECTION ────────────────────────────────────────────────────────
function ChildrenBreakdown({ conflicts }) {
  const relevant = [...conflicts]
    .filter(c => c.currentChildDeaths > 0)
    .sort((a, b) => b.currentChildDeaths - a.currentChildDeaths);
  const maxVal = relevant[0]?.currentChildDeaths || 1;

  return (
    <div className="flex flex-col gap-2">
      {relevant.map(c => {
        const pct = (c.currentChildDeaths / maxVal) * 100;
        return (
          <div key={c.id} className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 w-28 flex-shrink-0">
              <span className="text-sm leading-none">{c.flag}</span>
              <span className="text-[9px] font-mono text-zinc-400 truncate">
                {c.name.replace(/ —.*/, '').replace(/–.*/, '').replace(/ \(.*/, '')}
              </span>
            </div>
            <div className="flex-1 h-1 bg-zinc-800">
              <div
                className="h-full transition-all duration-500"
                style={{ width: `${pct}%`, background: c.color }}
              />
            </div>
            <span className="text-[9px] font-mono text-zinc-400 w-14 text-right tabular-nums">
              {fmt(c.currentChildDeaths)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function CounterPage() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading'); // 'loading' | 'live' | 'cached'
  const [sourcesUpdatedAt, setSourcesUpdatedAt] = useState(null);

  // Refs for direct DOM counter updates (avoids re-render on every RAF tick)
  const mainCounterRef = useRef(null);
  const childCounterRef = useRef(null);
  const tickRef = useRef(null); // { total, childTotal, totalDailyRate, childDailyRateTotal }

  // ── Animation ──────────────────────────────────────────────────────────────
  const animateCounter = useCallback((ref, from, to, duration = 1200) => {
    if (!ref.current) return;
    const start = performance.now();
    const diff = to - from;
    const tick = (now) => {
      if (!ref.current) return;
      const progress = Math.min((now - start) / duration, 1);
      ref.current.textContent = fmt(Math.round(from + diff * easeOutExpo(progress)));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, []);

  // ── Fetch & render ─────────────────────────────────────────────────────────
  const fetchAndRender = useCallback(async () => {
    setStatus('loading');
    try {
      const d = await loadConflictData();
      const prevTotal = tickRef.current?.total ?? 0;
      const prevChildTotal = tickRef.current?.childTotal ?? 0;

      setData(d);
      if (d.sourcesUpdatedAt) setSourcesUpdatedAt(d.sourcesUpdatedAt);
      setStatus('live');

      // Sync tick ref
      tickRef.current = {
        total: d.totalDeaths,
        childTotal: d.totalChildDeaths,
        totalDailyRate: d.conflicts.reduce((s, c) => s + c.dailyRate, 0),
        childDailyRateTotal: d.childDailyRateTotal,
      };

      // Animate counters
      const isFirst = prevTotal === 0;
      animateCounter(mainCounterRef, prevTotal, d.totalDeaths, isFirst ? 2000 : 800);
      animateCounter(childCounterRef, prevChildTotal, d.totalChildDeaths, isFirst ? 2000 : 800);
    } catch (err) {
      console.error('Counter fetch failed:', err);
      setStatus('cached');
    }
  }, [animateCounter]);

  // ── Mount: initial fetch + 1h refresh ─────────────────────────────────────
  useEffect(() => {
    fetchAndRender();
    const id = setInterval(fetchAndRender, 3_600_000);
    return () => clearInterval(id);
  }, [fetchAndRender]);

  // ── 1-second tick: increment counters smoothly ────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      if (!tickRef.current) return;
      tickRef.current.total += tickRef.current.totalDailyRate / 86400;
      tickRef.current.childTotal += tickRef.current.childDailyRateTotal / 86400;
      if (mainCounterRef.current)
        mainCounterRef.current.textContent = fmt(Math.round(tickRef.current.total));
      if (childCounterRef.current)
        childCounterRef.current.textContent = fmt(Math.round(tickRef.current.childTotal));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // ── Derived values ─────────────────────────────────────────────────────────
  const conflicts = data?.conflicts ?? [];
  const maxDeaths = Math.max(...conflicts.map(c => c.currentDeaths), 1);
  const totalDailyRate = conflicts.reduce((s, c) => s + c.dailyRate, 0);
  const sortedConflicts = [...conflicts].sort((a, b) => b.currentDeaths - a.currentDeaths);

  return (
    <div className="flex flex-col min-h-screen bg-zinc-950 text-zinc-100">
      <Header />

      {/* Page title strip */}
      <div className="px-6 py-3 border-b border-zinc-800 bg-zinc-950/80 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold font-mono uppercase tracking-widest text-zinc-100">
              Live Conflict Death Counter
            </h2>
            <p className="text-[10px] font-mono text-zinc-500 mt-0.5">
              Real-time estimates · {conflicts.length} active conflicts · interpolated from verified baselines
            </p>
          </div>
          {/* Status indicator */}
          <div className="flex items-center gap-2">
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{
                background: status === 'live' ? '#22c55e' : status === 'loading' ? '#f59e0b' : '#ef4444',
                boxShadow: status === 'live' ? '0 0 6px #22c55e' : 'none',
                animation: status === 'live' ? 'pulse 2s infinite' : 'none',
              }}
            />
            <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">
              {status === 'live' ? 'Live estimates' : status === 'loading' ? 'Refreshing…' : 'Cached data'}
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">

          {/* ── Hero counter ── */}
          <section className="text-center space-y-3 py-6">
            {/* Atmospheric glow */}
            <div
              className="absolute left-1/2 -translate-x-1/2 w-96 h-48 pointer-events-none"
              style={{
                background: 'radial-gradient(ellipse at center, rgba(220,38,38,0.12) 0%, transparent 70%)',
              }}
            />
            <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-zinc-600">
              Estimated global conflict deaths
            </p>
            <div
              ref={mainCounterRef}
              className="text-6xl md:text-8xl font-mono font-bold tabular-nums text-red-500 leading-none tracking-tight"
              style={{ textShadow: '0 0 40px rgba(239,68,68,0.3)' }}
            >
              {data ? fmt(data.totalDeaths) : '—'}
            </div>
            <p className="text-[10px] font-mono text-zinc-600">
              {sourcesUpdatedAt ? (
                <>
                  <span className="text-zinc-700 uppercase tracking-wider">Sources updated </span>
                  {sourcesUpdatedAt.toLocaleString('en-GB', {
                    day: 'numeric', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
                  })}
                  <span className="text-zinc-800"> · ACLED · UCDP · UN</span>
                </>
              ) : (
                'Loading…'
              )}
            </p>
          </section>

          {/* ── Stat pills ── */}
          <div className="grid grid-cols-3 gap-3">
            {[
              {
                label: 'Deaths in 2026',
                value: data ? fmtShort(data.ytdDeaths) : '—',
                sub: 'year-to-date',
              },
              {
                label: 'Active Conflicts',
                value: conflicts.length || '—',
                sub: 'tracked zones',
              },
              {
                label: 'Deaths / Day',
                value: data ? fmtShort(totalDailyRate) : '—',
                sub: 'global estimate',
              },
            ].map(({ label, value, sub }) => (
              <div key={label} className="bg-zinc-900 border border-zinc-800 p-4 text-center">
                <p className="text-[9px] font-mono uppercase tracking-widest text-zinc-600 mb-1">{label}</p>
                <p className="text-2xl font-mono font-bold tabular-nums text-zinc-100">{value}</p>
                <p className="text-[9px] font-mono text-zinc-700 mt-1">{sub}</p>
              </div>
            ))}
          </div>

          {/* ── Global rate stats ── */}
          {data && (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-zinc-900 border border-zinc-800 p-4 flex items-center justify-between">
                <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-600">Deaths / hour</span>
                <span className="text-xl font-mono font-bold tabular-nums text-zinc-200">
                  {fmt(Math.round(totalDailyRate / 24))}
                </span>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 p-4 flex items-center justify-between">
                <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-600">Deaths / minute</span>
                <span className="text-xl font-mono font-bold tabular-nums text-zinc-200">
                  {(totalDailyRate / 1440).toFixed(1)}
                </span>
              </div>
            </div>
          )}

          {/* ── Children section ── */}
          {data && (
            <section className="bg-zinc-900 border border-zinc-800 p-5 space-y-4">
              <div className="flex items-start justify-between border-b border-zinc-800 pb-4">
                <div>
                  <h3 className="text-[10px] font-mono uppercase tracking-widest text-zinc-400 font-bold">
                    Children Killed
                  </h3>
                  <p className="text-[9px] font-mono text-zinc-700 mt-0.5">
                    Estimated across all tracked conflicts
                  </p>
                </div>
                <div className="text-right">
                  <div
                    ref={childCounterRef}
                    className="text-3xl font-mono font-bold tabular-nums text-red-400"
                  >
                    {fmt(data.totalChildDeaths)}
                  </div>
                  <div className="text-[9px] font-mono text-zinc-600 mt-0.5">
                    {((data.totalChildDeaths / Math.max(data.totalDeaths, 1)) * 100).toFixed(1)}% of total
                  </div>
                </div>
              </div>

              {/* Rate stats */}
              <div className="flex gap-6 text-[9px] font-mono">
                <div>
                  <span className="text-zinc-600 uppercase tracking-wider">Per day </span>
                  <span className="text-zinc-300 tabular-nums">
                    {data.childDailyRateTotal.toFixed(1)}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-600 uppercase tracking-wider">Per hour </span>
                  <span className="text-zinc-300 tabular-nums">
                    {(data.childDailyRateTotal / 24).toFixed(1)}
                  </span>
                </div>
              </div>

              {/* Per-conflict bars */}
              <ChildrenBreakdown conflicts={data.conflicts} />
            </section>
          )}

          {/* ── Conflict grid ── */}
          {data ? (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 font-bold">
                  Conflict Breakdown
                </h3>
                <span className="text-[9px] font-mono text-zinc-700">sorted by death toll</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {sortedConflicts.map(conflict => (
                  <ConflictCard key={conflict.id} conflict={conflict} maxDeaths={maxDeaths} />
                ))}
              </div>
            </section>
          ) : (
            <div className="flex items-center justify-center py-20">
              <div className="flex items-center gap-3 text-zinc-600 font-mono text-xs">
                <div className="w-4 h-4 border border-zinc-700 border-t-red-500 rounded-full animate-spin" />
                Loading conflict data…
              </div>
            </div>
          )}

          {/* ── Footer / attribution ── */}
          <footer className="border-t border-zinc-800 pt-6 pb-8 space-y-3">
            <p className="text-[9px] font-mono text-zinc-700 leading-relaxed max-w-2xl">
              All figures are estimates derived from verified baseline data anchored April 1, 2026,
              interpolated forward using conflict-specific daily death rates. Figures represent
              minimum documented deaths and are consistently lower than true totals.
              Children death data from UNICEF, Save the Children, AAPP, and conflict-specific monitors.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {[
                { label: 'ACLED', url: 'https://acleddata.com' },
                { label: 'UCDP', url: 'https://ucdp.uu.se' },
                { label: 'UN OCHA', url: 'https://www.unocha.org' },
                { label: 'OHCHR', url: 'https://www.ohchr.org' },
                { label: 'UNICEF', url: 'https://www.unicef.org' },
                { label: 'GitHub', url: 'https://github.com/n3rmix/conflict-counter' },
              ].map(({ label, url }) => (
                <a
                  key={label}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[9px] font-mono text-zinc-600 hover:text-zinc-400 uppercase tracking-wider transition-colors"
                >
                  {label}
                </a>
              ))}
            </div>
          </footer>

        </div>
      </div>
    </div>
  );
}
