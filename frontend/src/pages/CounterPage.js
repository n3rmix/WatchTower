import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import axios from 'axios';
import { ComposableMap, Geographies, Geography } from 'react-simple-maps';
import Header from '../components/Header';
import GdeltAlertTicker from '../components/GdeltAlertTicker';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

// ─── DATA LOGIC ───────────────────────────────────────────────────────────────

function estimateCurrentDeaths(conflict) {
  const snap = new Date(conflict.snapDate);
  const daysElapsed = Math.max(0, (Date.now() - snap) / 86400000);
  return conflict.baseCumulative + Math.floor(daysElapsed * conflict.dailyRate);
}

function estimateCurrentChildDeaths(conflict) {
  const snap = new Date(conflict.snapDate);
  const daysElapsed = Math.max(0, (Date.now() - snap) / 86400000);
  return conflict.childDeaths + Math.floor(daysElapsed * conflict.childDailyRate);
}

function estimateYTDDeaths(conflicts) {
  const yearStart = new Date('2026-01-01T00:00:00Z');
  return conflicts.reduce((sum, c) => {
    if (c.dailyRate === 0) return sum;
    const from = new Date(Math.max(new Date(c.startDate).getTime(), yearStart.getTime()));
    const days = Math.max(0, (Date.now() - from) / 86400000);
    return sum + Math.floor(days * c.dailyRate);
  }, 0);
}

async function loadConflictData() {
  const res = await axios.get(`${BACKEND_URL}/api/counter-conflicts`);
  const { fetched_at, conflicts: raw } = res.data;

  // Map snake_case API fields to camelCase for component use
  const baseConflicts = raw.map(c => ({
    id: c.id,
    name: c.name,
    region: c.region,
    startDate: c.start_date,
    flag: c.flag,
    color: c.color,
    baseCumulative: c.base_cumulative,
    snapDate: c.snap_date,
    dailyRate: c.daily_rate,
    childDeaths: c.child_deaths,
    childDailyRate: c.child_daily_rate,
    childSource: c.child_source,
    childSourceUrl: c.child_source_url,
    source: c.source,
    sourceUrl: c.source_url,
    note: c.note,
  }));

  const conflicts = baseConflicts.map(c => ({
    ...c,
    currentDeaths: estimateCurrentDeaths(c),
    currentChildDeaths: estimateCurrentChildDeaths(c),
    startDateFormatted: new Date(c.startDate).toLocaleDateString('en-GB', {
      year: 'numeric', month: 'long', day: 'numeric',
    }),
  }));

  return {
    conflicts,
    totalDeaths: conflicts.reduce((s, c) => s + c.currentDeaths, 0),
    totalChildDeaths: conflicts.reduce((s, c) => s + c.currentChildDeaths, 0),
    childDailyRateTotal: baseConflicts.reduce((s, c) => s + c.childDailyRate, 0),
    ytdDeaths: estimateYTDDeaths(baseConflicts),
    sourcesUpdatedAt: fetched_at ? new Date(fetched_at) : null,
    fetchedAt: fetched_at ?? null,
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

function easeOutExpo(t) {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

// ─── CONFLICT CARD ────────────────────────────────────────────────────────────
function ConflictCard({ conflict, maxDeaths }) {
  const pct = Math.min((conflict.currentDeaths / Math.max(maxDeaths, 1)) * 100, 100);

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

// ─── BREAKDOWN MAP ───────────────────────────────────────────────────────────

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// ISO 3166-1 numeric ID → conflict name keyword
// geo.id from world-atlas TopoJSON is the numeric ISO code as a string
const CONFLICT_GEO_IDS = {
  4:   'afghanistan',
  104: 'myanmar',
  120: 'cameroon',
  180: ['drc', 'congo'],
  231: 'ethiopia',
  275: ['gaza', 'palestine'],
  332: 'haiti',
  364: 'iran',
  368: 'iraq',
  376: 'israel',
  422: 'lebanon',
  434: 'libya',
  466: 'mali',
  508: 'mozambique',
  566: 'nigeria',
  643: 'russia',
  706: 'somalia',
  729: 'sudan',
  760: 'syria',
  804: 'ukraine',
  887: 'yemen',
};

function BreakdownMap({ conflicts }) {
  const [panel, setPanel] = useState(null);
  const containerRef = useRef(null);

  // numeric geo ID (as string) → conflict object
  const conflictByGeoId = useMemo(() => {
    const result = {};
    for (const [numId, keywords] of Object.entries(CONFLICT_GEO_IDS)) {
      const kws = Array.isArray(keywords) ? keywords : [keywords];
      const conflict = conflicts.find(c =>
        kws.some(k => c.name.toLowerCase().includes(k))
      );
      if (conflict) result[String(numId)] = conflict;
    }
    return result;
  }, [conflicts]);

  const handleGeoClick = (geo, evt) => {
    const conflict = conflictByGeoId[String(geo.id)];
    if (!conflict) { setPanel(null); return; }

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    setPanel(prev =>
      prev?.name === conflict.name ? null : {
        x:         evt.clientX - rect.left,
        y:         evt.clientY - rect.top,
        name:      conflict.name,
        region:    conflict.region,
        deaths:    conflict.currentDeaths,
        dailyRate: conflict.dailyRate,
        flag:      conflict.flag,
      }
    );
  };

  const shortName = n => n.replace(/ —.*/, '').replace(/\s*–.*/, '').replace(/ \(.*/, '');
  const nf = new Intl.NumberFormat('en-US');

  return (
    <div className="flex flex-col">
      <div
        ref={containerRef}
        className="relative w-full border border-zinc-800 bg-zinc-950 overflow-hidden"
        onClick={e => {
          if (e.target.tagName === 'svg' || e.target === containerRef.current) setPanel(null);
        }}
      >
        <ComposableMap
          projection="geoNaturalEarth1"
          projectionConfig={{ scale: 153, center: [15, 10] }}
          style={{ width: '100%', height: 'auto' }}
        >
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies.map(geo => {
                const conflict  = conflictByGeoId[String(geo.id)];
                const isConflict = !!conflict;
                const isSelected = panel?.name === conflict?.name;

                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    onClick={e => handleGeoClick(geo, e)}
                    style={{
                      default: {
                        fill:        isSelected  ? 'rgba(220,38,38,0.85)'
                                   : isConflict  ? 'rgba(220,38,38,0.45)'
                                   : '#2a2d35',
                        stroke:      isConflict  ? '#dc2626' : '#1a1c22',
                        strokeWidth: isConflict  ? 0.6 : 0.4,
                        outline:     'none',
                        cursor:      isConflict  ? 'pointer' : 'default',
                        transition:  'fill 0.15s ease',
                      },
                      hover: {
                        fill:        isConflict  ? 'rgba(220,38,38,0.65)' : '#353840',
                        stroke:      isConflict  ? '#ef4444' : '#1a1c22',
                        strokeWidth: isConflict  ? 0.7 : 0.4,
                        outline:     'none',
                        cursor:      isConflict  ? 'pointer' : 'default',
                      },
                      pressed: {
                        fill:    isConflict ? 'rgba(220,38,38,0.9)' : '#353840',
                        outline: 'none',
                      },
                    }}
                  />
                );
              })
            }
          </Geographies>
        </ComposableMap>

        {/* Click panel — anchored at click position */}
        {panel && (
          <div
            className="absolute z-10 pointer-events-none"
            style={{ left: panel.x, top: panel.y, transform: 'translate(-50%, -115%)' }}
          >
            <div
              className="bg-zinc-950 border border-zinc-700 w-48 pointer-events-auto"
              style={{ boxShadow: '0 0 20px rgba(220,38,38,0.3), 0 4px 16px rgba(0,0,0,0.7)' }}
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
                <div className="flex items-center gap-1.5 min-w-0">
                  {panel.flag && <span className="text-sm leading-none flex-shrink-0">{panel.flag}</span>}
                  <p className="text-[10px] font-mono font-bold text-zinc-100 uppercase tracking-wider truncate">
                    {shortName(panel.name)}
                  </p>
                </div>
                <button
                  className="text-zinc-600 hover:text-zinc-300 transition-colors flex-shrink-0 ml-1"
                  onClick={e => { e.stopPropagation(); setPanel(null); }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M1 1l8 8M9 1L1 9"/>
                  </svg>
                </button>
              </div>
              <div className="px-3 py-2 space-y-2">
                {panel.region && (
                  <div className="flex justify-between items-baseline">
                    <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">Region</span>
                    <span className="text-[9px] font-mono text-zinc-400">{panel.region}</span>
                  </div>
                )}
                <div className="flex justify-between items-baseline">
                  <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">Est. Deaths</span>
                  <span className="text-[10px] font-mono font-bold text-red-400 tabular-nums">
                    {nf.format(Math.round(panel.deaths))}
                  </span>
                </div>
                {panel.dailyRate > 0 && (
                  <div className="flex justify-between items-baseline">
                    <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">Per Day</span>
                    <span className="text-[9px] font-mono text-zinc-400 tabular-nums">
                      ~{panel.dailyRate.toFixed(1)}
                    </span>
                  </div>
                )}
                {panel.dailyRate === 0 && (
                  <div className="flex justify-between items-baseline">
                    <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">Status</span>
                    <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">Ended</span>
                  </div>
                )}
              </div>
            </div>
            <div
              className="bg-zinc-950 border-r border-b border-zinc-700 rotate-45"
              style={{ width: 7, height: 7, marginLeft: 'calc(50% - 4px)', marginTop: -4 }}
            />
          </div>
        )}
      </div>
      <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-zinc-700 mt-2 text-center">
        Click a highlighted country for details
      </p>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function CounterPage() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading'); // 'loading' | 'live' | 'offline'
  const [sourcesUpdatedAt, setSourcesUpdatedAt] = useState(null);

  // Refs for direct DOM counter updates (avoids re-render on every RAF tick)
  const mainCounterRef = useRef(null);
  const childCounterRef = useRef(null);
  const tickRef = useRef(null); // { total, childTotal, totalDailyRate, childDailyRateTotal }
  // Tracks the last backend fetched_at seen — used by the smart poll to detect
  // when refresh_all_data() has fired without hammering /api/counter-conflicts.
  const lastFetchedAt = useRef(null);

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
      if (d.fetchedAt) {
        lastFetchedAt.current = d.fetchedAt;
      }
      if (d.sourcesUpdatedAt) {
        setSourcesUpdatedAt(d.sourcesUpdatedAt);
      }
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
      setStatus('offline');
    }
  }, [animateCounter]);

  // ── Mount: initial fetch + smart poll ─────────────────────────────────────
  // On mount, fetch immediately. Then every 60s check /api/last-update (cheap
  // single-doc read). Only call fetchAndRender() when fetched_at has changed,
  // meaning the backend's hourly refresh_all_data() just completed.
  useEffect(() => {
    fetchAndRender();

    const checkForUpdates = async () => {
      try {
        const { data: lu } = await axios.get(`${BACKEND_URL}/api/last-update`);
        const fetchedAt = lu?.fetched_at ?? null;
        if (fetchedAt && fetchedAt !== lastFetchedAt.current) {
          fetchAndRender();
        }
      } catch {
        // Non-fatal — next tick will retry
      }
    };

    const id = setInterval(checkForUpdates, 60_000);
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
              Real-time estimates · {conflicts.length} tracked conflicts · interpolated from verified baselines
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
              {status === 'live' ? 'Live' : status === 'loading' ? 'Refreshing…' : 'Offline'}
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">

          {/* ── Hero counter ── */}
          <section className="text-center space-y-3 py-6">
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
              ) : status === 'loading' ? (
                'Loading…'
              ) : (
                'Baselines from Apr 2026 · awaiting live update'
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
                label: 'Tracked Conflicts',
                value: conflicts.length || '—',
                sub: 'active + recent',
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

          {/* ── GDELT alert ticker ── */}
          <GdeltAlertTicker />

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
              <BreakdownMap conflicts={sortedConflicts} />
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {sortedConflicts.map(conflict => (
                  <ConflictCard key={conflict.id} conflict={conflict} maxDeaths={maxDeaths} />
                ))}
              </div>
            </section>
          ) : status === 'offline' ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-center space-y-2">
                <p className="text-red-500 font-mono text-xs uppercase tracking-widest">Backend offline</p>
                <p className="text-zinc-600 font-mono text-[10px]">Could not reach {BACKEND_URL} — start the backend and refresh.</p>
              </div>
            </div>
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
              Death figures are served by the WatchTower backend, which queries ACLED, UCDP, UN OHCHR,
              and OCHA hourly. Between fetches, counts are interpolated forward using conflict-specific
              daily death rates. All figures represent minimum documented deaths; true totals are higher.
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
