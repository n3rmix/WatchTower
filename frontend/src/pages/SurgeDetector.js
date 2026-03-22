import React, { useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Zap,
  ArrowLeft,
} from "lucide-react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const fmtNum = (n) => (n ?? 0).toLocaleString();
const fmtPct = (p) =>
  p != null ? `${p >= 0 ? "+" : ""}${p.toFixed(1)}%` : "NEW";

// ── Constants ─────────────────────────────────────────────────────────────────

const WINDOWS = [30, 60, 90];

const VIOLENCE_OPTS = [
  { value: "1,2,3", label: "All Violence" },
  { value: "1",     label: "State-Based"  },
  { value: "2",     label: "Non-State"    },
  { value: "3",     label: "One-Sided"    },
];

const STATUS_CFG = {
  new:       { label: "NEW ONSET",  text: "text-red-400",    border: "border-red-700/50",    bg: "bg-red-950/30"    },
  confirmed: { label: "CONFIRMED",  text: "text-red-400",    border: "border-red-800/40",    bg: "bg-red-950/20"    },
  probable:  { label: "PROBABLE",   text: "text-orange-400", border: "border-orange-700/50", bg: "bg-orange-950/20" },
  possible:  { label: "POSSIBLE",   text: "text-yellow-500", border: "border-yellow-700/40", bg: "bg-yellow-950/10" },
  stable:    { label: "STABLE",     text: "text-zinc-500",   border: "border-zinc-800",      bg: ""                 },
  declining: { label: "DECLINING",  text: "text-green-400",  border: "border-green-900/40",  bg: "bg-green-950/10"  },
};

const SURGE_BAR_COLOR = {
  new:       "bg-red-500",
  confirmed: "bg-red-500",
  probable:  "bg-orange-500",
  possible:  "bg-yellow-500",
  stable:    "bg-zinc-600",
  declining: "bg-green-600",
};

// ── Tiny helpers ──────────────────────────────────────────────────────────────

function SectionLabel({ num, title }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] font-mono text-zinc-700">[ {num} ]</span>
      <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
        {title}
      </span>
    </div>
  );
}

function Pill({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`text-[10px] font-mono uppercase tracking-wider px-3 py-1 rounded-sm border transition-colors ${
        active
          ? "border-red-700/60 bg-red-950/40 text-red-400"
          : "border-zinc-800 text-zinc-600 hover:text-zinc-400 hover:border-zinc-700"
      }`}
    >
      {children}
    </button>
  );
}

function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status] || STATUS_CFG.stable;
  return (
    <span
      className={`text-[9px] font-mono px-1.5 py-0.5 rounded-sm border uppercase tracking-wider ${cfg.text} ${cfg.border}`}
    >
      {cfg.label}
    </span>
  );
}

function SurgeBar({ score, status }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 bg-zinc-800/80 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            SURGE_BAR_COLOR[status] || "bg-zinc-600"
          }`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="text-[10px] font-mono text-zinc-600 tabular-nums w-6 text-right">
        {score}
      </span>
    </div>
  );
}

/** Confidence-band range bar: shows low→high as range, best as a vertical tick. */
function BandRow({ label, data, dotCls, rangeCls, maxVal }) {
  const safe    = Math.max(maxVal, 1);
  const lowPct  = (data.low  / safe) * 100;
  const bestPct = (data.best / safe) * 100;
  const highPct = (data.high / safe) * 100;

  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] font-mono text-zinc-600 w-14 shrink-0">{label}</span>
      <div className="relative flex-1 h-2 bg-zinc-800/40 rounded-full overflow-visible">
        {/* range: low → high */}
        <div
          className={`absolute top-0 h-full rounded-full ${rangeCls}`}
          style={{
            left:  `${lowPct}%`,
            width: `${Math.max(highPct - lowPct, 0.5)}%`,
          }}
        />
        {/* best-estimate tick */}
        <div
          className={`absolute top-1/2 -translate-y-1/2 w-1 h-3 rounded-sm ${dotCls}`}
          style={{ left: `calc(${bestPct}% - 2px)` }}
        />
      </div>
      <span className="text-[9px] font-mono text-zinc-500 w-36 text-right tabular-nums shrink-0">
        {fmtNum(data.low)} / <span className="text-zinc-300">{fmtNum(data.best)}</span> / {fmtNum(data.high)}
      </span>
    </div>
  );
}

function ConfidenceBand({ current, prior }) {
  const maxVal = Math.max(
    current.high, current.best,
    prior.high,   prior.best,
    1
  );
  return (
    <div className="space-y-1.5">
      <BandRow
        label="CURRENT"
        data={current}
        dotCls="bg-red-400"
        rangeCls="bg-red-900/60"
        maxVal={maxVal}
      />
      <BandRow
        label="BASELINE"
        data={prior}
        dotCls="bg-zinc-400"
        rangeCls="bg-zinc-700/40"
        maxVal={maxVal}
      />
      <p className="text-[9px] font-mono text-zinc-700 mt-0.5">
        low / <span className="text-zinc-500">best</span> / high — bar = uncertainty range — tick = best estimate
      </p>
    </div>
  );
}

function TypeLabel({ t }) {
  return (
    <span className="text-[9px] font-mono text-zinc-600">
      {t === 1 ? "State-Based" : t === 2 ? "Non-State" : t === 3 ? "One-Sided" : "Unknown"}
    </span>
  );
}

// ── Conflict card ─────────────────────────────────────────────────────────────

function ConflictCard({ conflict: c, rank, expanded, onToggle }) {
  const cfg = STATUS_CFG[c.status] || STATUS_CFG.stable;
  const hasBD = c.annual_deaths && Object.keys(c.annual_deaths).length > 0;

  return (
    <div className={`border rounded-sm transition-colors ${cfg.border} ${cfg.bg}`}>

      {/* ── Collapsed header ── */}
      <div className="p-4 cursor-pointer select-none" onClick={onToggle}>
        <div className="flex items-start justify-between gap-3">

          {/* Left: rank + name */}
          <div className="flex items-start gap-3 min-w-0">
            <span className="text-[10px] font-mono text-zinc-700 shrink-0 pt-0.5 tabular-nums">
              {String(rank).padStart(2, "0")}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <StatusBadge status={c.status} />
                <TypeLabel t={c.type_of_violence} />
              </div>
              <h3 className="text-sm font-mono font-medium text-zinc-200 leading-tight">
                {c.conflict_name || `Conflict #${c.conflict_new_id}`}
              </h3>
              <p className="text-[10px] font-mono text-zinc-600 mt-0.5">
                {c.country || "—"}
              </p>
            </div>
          </div>

          {/* Right: current best + delta */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right">
              <p className="text-lg font-bold font-mono tabular-nums text-zinc-100">
                {fmtNum(c.current.best)}
              </p>
              <p className={`text-[10px] font-mono tabular-nums ${cfg.text}`}>
                {fmtPct(c.pct_change)}
              </p>
            </div>
            {expanded
              ? <ChevronUp   className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
              : <ChevronDown className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
            }
          </div>
        </div>

        {/* Surge score bar + event counts */}
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] font-mono text-zinc-700 uppercase tracking-wider">
              Surge Score
            </span>
            <span className="text-[9px] font-mono text-zinc-700">
              {fmtNum(c.current.events)} event{c.current.events !== 1 ? "s" : ""} · prior best: {fmtNum(c.prior.best)}
            </span>
          </div>
          <SurgeBar score={c.surge_score} status={c.status} />
        </div>
      </div>

      {/* ── Expanded detail ── */}
      {expanded && (
        <div className="px-4 pb-5 border-t border-zinc-800/50 pt-4 space-y-5">

          {/* Probabilistic confidence band */}
          <div>
            <p className="text-[9px] font-mono uppercase tracking-wider text-zinc-600 mb-2">
              Probabilistic Confidence Band
            </p>
            <ConfidenceBand current={c.current} prior={c.prior} />
          </div>

          {/* Window comparison stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              { label: "Current Events",  value: fmtNum(c.current.events) },
              { label: "Prior Events",    value: fmtNum(c.prior.events)   },
              { label: "Δ Best Estimate", value: c.delta_best != null
                  ? `${c.delta_best >= 0 ? "+" : ""}${fmtNum(c.delta_best)}`
                  : "—"
              },
              { label: "Escalation Ratio", value: c.escalation_ratio != null
                  ? `${c.escalation_ratio.toFixed(2)}×`
                  : "∞ (new)"
              },
            ].map(({ label, value }) => (
              <div key={label} className="bg-zinc-900/60 rounded-sm p-2.5">
                <p className="text-[9px] font-mono text-zinc-600 mb-0.5">{label}</p>
                <p className="text-sm font-mono font-semibold text-zinc-200 tabular-nums">{value}</p>
              </div>
            ))}
          </div>

          {/* Conflict parties */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[9px] font-mono text-zinc-700 uppercase tracking-wider mb-0.5">Side A</p>
              <p className="text-xs font-mono text-zinc-400">{c.side_a || "—"}</p>
            </div>
            <div>
              <p className="text-[9px] font-mono text-zinc-700 uppercase tracking-wider mb-0.5">Side B</p>
              <p className="text-xs font-mono text-zinc-400">{c.side_b || "—"}</p>
            </div>
          </div>

          {/* Annual battledeaths from UCDP bd dataset */}
          {hasBD && (
            <div>
              <p className="text-[9px] font-mono uppercase tracking-wider text-zinc-600 mb-2">
                Annual Battle Deaths · UCDP bd_best
              </p>
              <div className="flex gap-4 flex-wrap">
                {Object.entries(c.annual_deaths)
                  .sort(([a], [b]) => b.localeCompare(a))
                  .map(([yr, val]) => (
                    <div key={yr} className="text-center">
                      <p className="text-[9px] font-mono text-zinc-600">{yr}</p>
                      <p className="text-base font-mono font-bold text-zinc-200 tabular-nums">
                        {fmtNum(val)}
                      </p>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Conflict ID */}
          <p className="text-[9px] font-mono text-zinc-800">
            conflict_new_id: {c.conflict_new_id}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SurgeDetector() {
  const [windowDays,    setWindowDays]    = useState(30);
  const [violenceType,  setViolenceType]  = useState("1,2,3");
  const [data,          setData]          = useState(null);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState(null);
  const [expandedId,    setExpandedId]    = useState(null);

  const runAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);
    setData(null);
    setExpandedId(null);
    try {
      const res = await axios.get(`${API}/surge`, {
        params: { window: windowDays, violence_types: violenceType },
      });
      setData(res.data);
    } catch (e) {
      setError(e.response?.data?.detail || "Failed to fetch surge data from UCDP.");
    } finally {
      setLoading(false);
    }
  }, [windowDays, violenceType]);

  const { surging, rest } = useMemo(() => {
    if (!data) return { surging: [], rest: [] };
    return {
      surging: data.conflicts.filter(c =>
        ["new", "confirmed", "probable", "possible"].includes(c.status)
      ),
      rest: data.conflicts.filter(c =>
        ["stable", "declining"].includes(c.status)
      ),
    };
  }, [data]);

  const toggle = (id) => setExpandedId(prev => prev === id ? null : id);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">

      {/* ── Page header ── */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Zap className="w-6 h-6 text-red-500" />
            <div>
              <h1 className="text-xl font-bold uppercase tracking-tight heading-tactical">
                Conflict Escalation Surge Detector
              </h1>
              <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-wider">
                Rolling Window · UCDP GED Candidate · Probabilistic Confidence Band
              </p>
            </div>
          </div>
          <Link
            to="/"
            className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-500 hover:text-red-400 transition-colors uppercase tracking-wider border border-zinc-800 hover:border-red-800/50 px-3 py-1.5 rounded-sm"
          >
            <ArrowLeft className="w-3 h-3" />
            Dashboard
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6">

        {/* ── 01 · Controls ── */}
        <section className="space-y-3">
          <SectionLabel num="01" title="Analysis Window" />

          <div className="tactical-card p-4 space-y-4">
            <div className="flex flex-wrap gap-6">

              {/* Window selector */}
              <div>
                <p className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider mb-1.5">
                  Rolling Window
                </p>
                <div className="flex gap-1.5">
                  {WINDOWS.map(w => (
                    <Pill key={w} active={windowDays === w} onClick={() => setWindowDays(w)}>
                      {w}-day
                    </Pill>
                  ))}
                </div>
              </div>

              {/* Violence type */}
              <div>
                <p className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider mb-1.5">
                  Type of Violence
                </p>
                <div className="flex gap-1.5 flex-wrap">
                  {VIOLENCE_OPTS.map(o => (
                    <Pill
                      key={o.value}
                      active={violenceType === o.value}
                      onClick={() => setViolenceType(o.value)}
                    >
                      {o.label}
                    </Pill>
                  ))}
                </div>
              </div>
            </div>

            {/* Run button */}
            <button
              onClick={runAnalysis}
              disabled={loading}
              className="text-[10px] font-mono uppercase tracking-widest px-5 py-2 bg-red-950/60 hover:bg-red-900/50 border border-red-700/50 text-red-400 rounded-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Activity className="w-3.5 h-3.5" />
              {loading ? "Querying UCDP GED Candidate…" : "Run Surge Analysis"}
            </button>

            {/* Window info (once data is loaded) */}
            {data && (
              <div className="flex gap-6 pt-1 border-t border-zinc-800/50">
                <div>
                  <p className="text-[9px] font-mono text-zinc-700 uppercase">Current Window</p>
                  <p className="text-xs font-mono text-zinc-400">
                    {data.meta.current_window.start} → {data.meta.current_window.end}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-mono text-zinc-700 uppercase">Baseline Window</p>
                  <p className="text-xs font-mono text-zinc-400">
                    {data.meta.prior_window.start} → {data.meta.prior_window.end}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-mono text-zinc-700 uppercase">Conflicts Tracked</p>
                  <p className="text-xs font-mono text-zinc-400">
                    {data.meta.total_conflicts} total · {data.meta.n_surging} surging
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── Error ── */}
        {error && (
          <div className="flex items-center gap-2 text-sm font-mono text-amber-400 bg-amber-950/20 border border-amber-800/40 rounded-sm px-4 py-3">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {/* ── 02 · Surge alerts ── */}
        {data && surging.length > 0 && (
          <section className="space-y-3">
            <SectionLabel num="02" title={`Escalation Signals · ${surging.length} conflict${surging.length !== 1 ? "s" : ""}`} />
            <div className="space-y-2">
              {surging.map((c, i) => (
                <ConflictCard
                  key={c.conflict_new_id}
                  conflict={c}
                  rank={i + 1}
                  expanded={expandedId === c.conflict_new_id}
                  onToggle={() => toggle(c.conflict_new_id)}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── 03 · Stable / declining ── */}
        {data && rest.length > 0 && (
          <section className="space-y-3">
            <SectionLabel num="03" title={`Stable / Declining · ${rest.length} conflict${rest.length !== 1 ? "s" : ""}`} />
            <div className="space-y-2">
              {rest.map((c, i) => (
                <ConflictCard
                  key={c.conflict_new_id}
                  conflict={c}
                  rank={surging.length + i + 1}
                  expanded={expandedId === c.conflict_new_id}
                  onToggle={() => toggle(c.conflict_new_id)}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Empty state ── */}
        {data && data.conflicts.length === 0 && (
          <div className="tactical-card p-10 text-center font-mono text-zinc-600 text-sm">
            No conflict events found for the selected window and violence type.
            <br />
            <span className="text-[10px]">
              The GED Candidate dataset ({data.meta.current_window.start} → {data.meta.current_window.end}) returned no records.
            </span>
          </div>
        )}

        {/* ── Methodology note ── */}
        {data && (
          <section className="tactical-card p-4">
            <p className="text-[9px] font-mono uppercase tracking-wider text-zinc-700 mb-2">
              Methodology
            </p>
            <p className="text-[10px] font-mono text-zinc-600 leading-relaxed">
              Status is derived from the probabilistic confidence bands of the UCDP death estimates, not raw counts alone.{" "}
              <span className="text-red-500/70">CONFIRMED</span> = current low bound exceeds prior high bound (non-overlapping bands).{" "}
              <span className="text-orange-500/70">PROBABLE</span> = best estimate &gt;1.5× baseline AND low bound ≥ baseline best.{" "}
              <span className="text-yellow-500/70">POSSIBLE</span> = best estimate &gt;1.25× baseline.{" "}
              Surge Score (0–100) = min(100, (ratio − 1) × 50). Annual deaths from UCDP battledeaths (bd_best) for top surging conflicts only.
              Data source: UCDP GED Candidate v{data ? "26.0.1" : "—"} + UCDP Battle Deaths v25.1.
            </p>
          </section>
        )}

      </main>
    </div>
  );
}
