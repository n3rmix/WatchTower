import React, { useState, useCallback, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import {
  TrendingUp,
  ArrowLeft,
  Search,
  Clock,
  Skull,
  BarChart2,
  Calendar,
  Users,
  FileText,
  Loader2,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// ── Constants ──────────────────────────────────────────────────────────────────

const DYAD_COLORS = [
  "#f59e0b", // amber
  "#3b82f6", // blue
  "#10b981", // emerald
  "#8b5cf6", // violet
  "#f97316", // orange
  "#06b6d4", // cyan
  "#ec4899", // pink
  "#84cc16", // lime
  "#14b8a6", // teal
  "#a78bfa", // purple
];

const MAX_DYADS_CHART = 8; // group the rest as "Other"

const CONFLICT_TYPES = {
  1: "Extra-systemic",
  2: "Inter-state",
  3: "Intra-state",
  4: "Internationalised intra-state",
};

// ── Formatters ─────────────────────────────────────────────────────────────────

const fmtNum = (n) => (n ?? 0).toLocaleString();

const fmtK = (n) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n ?? 0);
};

const truncate = (s, max = 38) =>
  s && s.length > max ? s.slice(0, max - 1) + "…" : s;

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionLabel({ num, title }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-[9px] font-mono text-red-500 bg-red-950/40 border border-red-900/40 px-1.5 py-0.5 rounded-sm tracking-widest">
        {num}
      </span>
      <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
        {title}
      </span>
      <div className="flex-1 h-px bg-zinc-800" />
    </div>
  );
}

function StatTile({ icon: Icon, label, value, sub, color = "text-red-400" }) {
  return (
    <div className="tactical-card corner-accent p-4 flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-zinc-500">
        <Icon className="w-3.5 h-3.5" />
        <span className="text-[9px] font-mono uppercase tracking-widest">{label}</span>
      </div>
      <p className={`text-2xl font-bold font-mono ${color} leading-none`}>{value}</p>
      {sub && <p className="text-[10px] font-mono text-zinc-600">{sub}</p>}
    </div>
  );
}

// Custom chart tooltip — shows all dyad bars + cumulative line for a year
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const cumul  = payload.find((p) => p.dataKey === "cumulative_best");
  const dyads  = payload.filter((p) => p.dataKey !== "cumulative_best" && (p.value ?? 0) > 0);
  const total  = dyads.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-sm px-3 py-2.5 text-xs font-mono shadow-xl max-w-[260px]">
      <p className="text-zinc-400 uppercase tracking-wider text-[10px] mb-2 font-bold">{label}</p>
      {dyads.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 py-0.5">
          <span
            className="w-2 h-2 rounded-sm inline-block flex-shrink-0"
            style={{ background: p.fill }}
          />
          <span className="text-zinc-500 flex-1 truncate">{truncate(p.name, 28)}</span>
          <span className="font-bold" style={{ color: p.fill }}>
            {fmtNum(p.value)}
          </span>
        </div>
      ))}
      {dyads.length > 1 && (
        <div className="flex items-center gap-2 border-t border-zinc-800 pt-1.5 mt-1">
          <span className="text-zinc-400 flex-1">Total</span>
          <span className="text-zinc-200 font-bold">{fmtNum(total)}</span>
        </div>
      )}
      {cumul && (
        <div className="flex items-center gap-2 border-t border-zinc-800 pt-1.5 mt-1">
          <span className="w-4 h-0.5 bg-red-500 inline-block flex-shrink-0" />
          <span className="text-zinc-400 flex-1">Cumulative</span>
          <span className="text-red-300 font-bold">{fmtNum(cumul.value)}</span>
        </div>
      )}
    </div>
  );
}

// Search result row
function SearchResult({ result, onSelect }) {
  return (
    <button
      onClick={() => onSelect(result)}
      className="w-full text-left flex items-center justify-between px-3 py-2.5 hover:bg-zinc-800/60 border-b border-zinc-800/50 last:border-0 transition-colors group"
    >
      <div>
        <p className="text-sm font-mono text-zinc-200 group-hover:text-red-300 transition-colors">
          {result.conflict_name}
        </p>
        <p className="text-[10px] font-mono text-zinc-600">
          {result.location}
          {result.start_date ? ` · Since ${result.start_date.slice(0, 4)}` : ""}
          {" · "}
          <span className="text-zinc-500">ID {result.conflict_id}</span>
        </p>
      </div>
      <ChevronRight className="w-3.5 h-3.5 text-zinc-700 group-hover:text-red-500 transition-colors flex-shrink-0" />
    </button>
  );
}

// Auto-generated executive briefing
function ExecutiveBriefing({ data }) {
  const {
    conflict_name, location, start_year, span, total_deaths_best,
    total_deaths_low, total_deaths_high, peak_year, peak_deaths,
    total_years, dyad_breakdown = [], dyads, type_of_conflict,
  } = data;

  const typeLabel = CONFLICT_TYPES[type_of_conflict] || "Armed";
  const topDyad   = dyad_breakdown[0] || dyads?.[0];
  const parties   = topDyad?.dyad_name || (dyads?.[0]
    ? `${dyads[0].side_a} against ${dyads[0].side_b}`
    : "multiple parties");

  return (
    <div className="tactical-card p-5 space-y-4">
      <div className="flex items-start gap-2">
        <FileText className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
        <div className="space-y-3">

          <p className="text-sm font-mono text-zinc-300 leading-relaxed">
            The{" "}
            <span className="text-zinc-100 font-semibold">
              {conflict_name || `Conflict ${data.conflict_id}`}
            </span>{" "}
            — a {typeLabel.toLowerCase()} conflict in{" "}
            <span className="text-zinc-100">{location}</span>
            {parties ? ` involving ${parties}` : ""} — has been recorded in
            UCDP data since{" "}
            <span className="text-amber-400 font-bold">{start_year}</span>.
          </p>

          <p className="text-sm font-mono text-zinc-300 leading-relaxed">
            Over{" "}
            <span className="text-amber-400 font-bold">
              {total_years} year{total_years !== 1 ? "s" : ""}
            </span>{" "}
            of conflict ({span}), this war has claimed an estimated{" "}
            <span className="text-red-400 font-bold text-base">
              {fmtNum(total_deaths_best)}
            </span>{" "}
            lives (best estimate), with a confidence range of{" "}
            <span className="text-zinc-300">
              {fmtNum(total_deaths_low)}–{fmtNum(total_deaths_high)}
            </span>.
          </p>

          {peak_year && peak_deaths > 0 && (
            <p className="text-sm font-mono text-zinc-300 leading-relaxed">
              The deadliest year on record was{" "}
              <span className="text-amber-400 font-bold">{peak_year}</span>, with{" "}
              <span className="text-red-400 font-bold">{fmtNum(peak_deaths)}</span>{" "}
              battle deaths.
            </p>
          )}

          {dyad_breakdown.length > 1 && (
            <p className="text-sm font-mono text-zinc-300 leading-relaxed">
              The conflict spans{" "}
              <span className="text-amber-400 font-bold">{dyad_breakdown.length}</span>{" "}
              distinct combatant dyads. The deadliest dyad —{" "}
              <span className="text-zinc-100">{dyad_breakdown[0].dyad_name}</span>{" "}
              — accounts for{" "}
              <span className="text-red-400 font-bold">
                {fmtNum(dyad_breakdown[0].total_best)}
              </span>{" "}
              deaths (
              {Math.round((dyad_breakdown[0].total_best / total_deaths_best) * 100)}
              % of the total).
            </p>
          )}

          <p className="text-[10px] font-mono text-zinc-600 border-t border-zinc-800 pt-3">
            Source: UCDP Battle-Related Deaths Dataset v{" "}
            <a
              href="https://ucdp.uu.se/downloads/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-500 hover:text-red-400 underline underline-offset-2"
            >
              25.1
            </a>
            {" "}· Dyadic Dataset v25.1 · Uppsala Conflict Data Program
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function LongitudinalTracker() {
  const [query,         setQuery]         = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [searching,     setSearching]     = useState(false);
  const [data,          setData]          = useState(null);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState(null);
  const inputRef = useRef(null);

  // ── Chart data — flat records with one key per dyad ─────────────────────────

  const { chartData, dyadList } = useMemo(() => {
    if (!data?.dyad_breakdown?.length) {
      return { chartData: data?.timeline || [], dyadList: [] };
    }

    const sorted    = [...data.dyad_breakdown].sort((a, b) => b.total_best - a.total_best);
    const topDyads  = sorted.slice(0, MAX_DYADS_CHART);
    const restDyads = sorted.slice(MAX_DYADS_CHART);
    const hasOther  = restDyads.length > 0;

    // Index main timeline by year for cumulative
    const timelineByYear = Object.fromEntries(
      data.timeline.map((t) => [t.year, t])
    );

    // Collect all years
    const allYears = Array.from(
      new Set(data.timeline.map((t) => t.year))
    ).sort((a, b) => a - b);

    const flat = allYears.map((yr) => {
      const point = {
        year:            yr,
        cumulative_best: timelineByYear[yr]?.cumulative_best ?? 0,
        _low:            timelineByYear[yr]?.low ?? 0,
        _high:           timelineByYear[yr]?.high ?? 0,
      };
      topDyads.forEach((dyad) => {
        const dp = dyad.timeline.find((t) => t.year === yr);
        point[dyad.dyad_name] = dp?.best ?? 0;
      });
      if (hasOther) {
        point["Other"] = restDyads.reduce((s, dyad) => {
          const dp = dyad.timeline.find((t) => t.year === yr);
          return s + (dp?.best ?? 0);
        }, 0);
      }
      return point;
    });

    const dyadList = [
      ...topDyads.map((d) => d.dyad_name),
      ...(hasOther ? ["Other"] : []),
    ];

    return { chartData: flat, dyadList };
  }, [data]);

  // ── Search ──────────────────────────────────────────────────────────────────

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;

    // Pure numeric → treat directly as conflict_id
    if (/^\d+$/.test(q)) {
      loadConflict(q);
      return;
    }

    setSearching(true);
    setSearchResults(null);
    setData(null);
    setError(null);
    try {
      const res = await axios.get(`${API}/longitudinal/search`, { params: { q } });
      setSearchResults(res.data.results);
    } catch (e) {
      setError(
        e.response?.data?.detail ||
          "Search failed. Try entering the numeric UCDP conflict ID directly."
      );
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // ── Load timeline ───────────────────────────────────────────────────────────

  const loadConflict = useCallback(async (conflictId) => {
    setLoading(true);
    setData(null);
    setError(null);
    setSearchResults(null);
    try {
      const res = await axios.get(`${API}/longitudinal`, {
        params: { conflict_id: conflictId },
      });
      setData(res.data);
    } catch (e) {
      setError(
        e.response?.data?.detail ||
          "Failed to fetch longitudinal data from UCDP."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleSearch();
  };

  const handleSelectResult = (result) => {
    setQuery(result.conflict_name);
    loadConflict(result.conflict_id);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">

      {/* ── Page header ── */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <TrendingUp className="w-6 h-6 text-red-500" />
            <div>
              <h1 className="text-xl font-bold uppercase tracking-tight heading-tactical">
                Long-Run Human Cost — Longitudinal Tracker
              </h1>
              <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-wider">
                Per-Dyad Casualty Timeline · UCDP Battle Deaths + Dyadic · 1989 – Present
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

        {/* ── 01 · Conflict Selection ── */}
        <section className="space-y-3">
          <SectionLabel num="01" title="Conflict Selection" />
          <div className="tactical-card p-4 space-y-3">
            <p className="text-[11px] font-mono text-zinc-500 leading-relaxed">
              Search by conflict name or enter a numeric{" "}
              <span className="text-zinc-400">UCDP conflict_new_id</span> directly.
              Numeric IDs are available on the{" "}
              <a
                href="https://ucdp.uu.se/exploratory"
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-400 hover:text-red-400 underline underline-offset-2"
              >
                UCDP Conflict Encyclopedia
              </a>.
            </p>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="e.g. Ukraine or 432 …"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-sm pl-9 pr-3 py-2 text-sm font-mono text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-red-700/60 focus:ring-1 focus:ring-red-900/40"
                />
              </div>
              <button
                onClick={handleSearch}
                disabled={searching || loading || !query.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-red-950/60 hover:bg-red-900/60 border border-red-800/50 hover:border-red-700/60 text-red-300 font-mono text-xs uppercase tracking-widest rounded-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {searching ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Search className="w-3.5 h-3.5" />
                )}
                Search
              </button>
            </div>

            {/* Search results */}
            {searchResults !== null && !loading && (
              <div className="border border-zinc-700 rounded-sm bg-zinc-900/80 overflow-hidden">
                {searchResults.length === 0 ? (
                  <p className="text-[11px] font-mono text-zinc-600 px-3 py-3">
                    No conflicts found. Try a different name or enter the numeric ID directly.
                  </p>
                ) : (
                  searchResults.map((r) => (
                    <SearchResult key={r.conflict_id} result={r} onSelect={handleSelectResult} />
                  ))
                )}
              </div>
            )}
          </div>
        </section>

        {/* ── Loading ── */}
        {loading && (
          <div className="flex items-center justify-center gap-3 py-16 text-zinc-500 font-mono text-sm">
            <Loader2 className="w-5 h-5 animate-spin text-red-500" />
            Fetching longitudinal data from UCDP…
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="flex items-start gap-2 bg-red-950/20 border border-red-800/40 rounded-sm px-4 py-3 text-sm font-mono text-red-400">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ── Data sections ── */}
        {data && (
          <>
            {/* Conflict identity banner */}
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-sm px-4 py-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2 className="text-lg font-bold font-mono text-zinc-100 heading-tactical">
                {data.conflict_name || `Conflict ${data.conflict_id}`}
              </h2>
              <span className="text-xs font-mono text-zinc-500">{data.location}</span>
              {data.type_of_conflict && (
                <span className="text-[10px] font-mono text-zinc-600 border border-zinc-800 px-1.5 py-0.5 rounded-sm">
                  {CONFLICT_TYPES[data.type_of_conflict] || `Type ${data.type_of_conflict}`}
                </span>
              )}
              <span className="text-[10px] font-mono text-zinc-700 ml-auto">
                UCDP ID: {data.conflict_id}
              </span>
            </div>

            {/* ── 02 · Summary Statistics ── */}
            <section className="space-y-3">
              <SectionLabel num="02" title="Cumulative Human Cost" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatTile
                  icon={Skull}
                  label="Total Deaths (Best Est.)"
                  value={fmtNum(data.total_deaths_best)}
                  sub={`${fmtNum(data.total_deaths_low)} – ${fmtNum(data.total_deaths_high)} range`}
                  color="text-red-400"
                />
                <StatTile
                  icon={Clock}
                  label="Active Since"
                  value={data.start_year || "—"}
                  sub={data.span ? `Span: ${data.span}` : undefined}
                  color="text-amber-400"
                />
                <StatTile
                  icon={Calendar}
                  label="Peak Year"
                  value={data.peak_year ?? "—"}
                  sub={data.peak_deaths ? `${fmtNum(data.peak_deaths)} deaths` : undefined}
                  color="text-orange-400"
                />
                <StatTile
                  icon={BarChart2}
                  label="Years Tracked"
                  value={data.total_years}
                  sub={`${(data.dyad_breakdown || []).length || (data.dyads || []).length} combatant dyad${((data.dyad_breakdown || []).length || 1) !== 1 ? "s" : ""}`}
                  color="text-zinc-300"
                />
              </div>
            </section>

            {/* ── 03 · Casualty Timeline ── */}
            <section className="space-y-3">
              <SectionLabel num="03" title="Casualty Timeline — Annual Deaths per Dyad vs. Cumulative" />
              <div className="tactical-card p-4">

                {/* Dyad colour legend */}
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-4">
                  {dyadList.map((name, i) => (
                    <span key={name} className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-500">
                      <span
                        className="w-2.5 h-2.5 rounded-sm inline-block flex-shrink-0"
                        style={{ background: DYAD_COLORS[i % DYAD_COLORS.length], opacity: 0.8 }}
                      />
                      {truncate(name, 42)}
                    </span>
                  ))}
                  <span className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-600 ml-auto">
                    <span className="w-5 h-0.5 bg-red-500 inline-block" />
                    Cumulative (right axis)
                  </span>
                </div>

                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart
                    data={chartData}
                    margin={{ top: 8, right: 64, left: 10, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis
                      dataKey="year"
                      tick={{ fill: "#71717a", fontSize: 10, fontFamily: "monospace" }}
                      axisLine={{ stroke: "#3f3f46" }}
                      tickLine={false}
                    />
                    <YAxis
                      yAxisId="left"
                      tickFormatter={fmtK}
                      tick={{ fill: "#71717a", fontSize: 10, fontFamily: "monospace" }}
                      axisLine={false}
                      tickLine={false}
                      width={48}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tickFormatter={fmtK}
                      tick={{ fill: "#f87171", fontSize: 10, fontFamily: "monospace" }}
                      axisLine={false}
                      tickLine={false}
                      width={56}
                    />
                    <Tooltip content={<ChartTooltip />} />

                    {data.peak_year && (
                      <ReferenceLine
                        yAxisId="left"
                        x={data.peak_year}
                        stroke="#f59e0b"
                        strokeDasharray="4 3"
                        strokeOpacity={0.45}
                        label={{
                          value: "PEAK",
                          position: "top",
                          fill: "#f59e0b",
                          fontSize: 9,
                          fontFamily: "monospace",
                        }}
                      />
                    )}

                    {/* One stacked Bar per dyad */}
                    {dyadList.map((name, i) => (
                      <Bar
                        key={name}
                        yAxisId="left"
                        dataKey={name}
                        name={name}
                        stackId="dyads"
                        fill={DYAD_COLORS[i % DYAD_COLORS.length]}
                        fillOpacity={0.72}
                        radius={
                          i === dyadList.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]
                        }
                        maxBarSize={40}
                      />
                    ))}

                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="cumulative_best"
                      name="Cumulative"
                      stroke="#ef4444"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, fill: "#ef4444", strokeWidth: 0 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </section>

            {/* ── 04 · Per-Dyad Breakdown ── */}
            {(data.dyad_breakdown?.length > 0) && (
              <section className="space-y-3">
                <SectionLabel num="04" title="Per-Dyad Death Toll — All Dyads Ranked" />
                <div className="tactical-card overflow-hidden">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-zinc-800">
                        <th className="py-2 px-3 text-[9px] font-mono text-zinc-600 uppercase tracking-wider w-6">#</th>
                        <th className="py-2 px-3 text-[9px] font-mono text-zinc-600 uppercase tracking-wider">Dyad</th>
                        <th className="py-2 px-3 text-[9px] font-mono text-zinc-600 uppercase tracking-wider text-right">Total Deaths</th>
                        <th className="py-2 px-3 text-[9px] font-mono text-zinc-600 uppercase tracking-wider hidden md:table-cell">Peak Year</th>
                        <th className="py-2 px-3 text-[9px] font-mono text-zinc-600 uppercase tracking-wider hidden md:table-cell">Period</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.dyad_breakdown.map((dyad, i) => (
                        <tr
                          key={dyad.dyad_name}
                          className="border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors"
                        >
                          <td className="py-2 px-3 text-[10px] font-mono text-zinc-600">{i + 1}</td>
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-2">
                              <span
                                className="w-2 h-2 rounded-sm flex-shrink-0"
                                style={{
                                  background: i < MAX_DYADS_CHART
                                    ? DYAD_COLORS[i % DYAD_COLORS.length]
                                    : "#52525b",
                                  opacity: 0.85,
                                }}
                              />
                              <span className="text-xs font-mono text-zinc-300">
                                {dyad.dyad_name}
                              </span>
                            </div>
                          </td>
                          <td className="py-2 px-3 text-right">
                            <span className="text-sm font-bold font-mono text-red-400">
                              {fmtNum(dyad.total_best)}
                            </span>
                            {data.total_deaths_best > 0 && (
                              <span className="text-[10px] font-mono text-zinc-600 ml-1.5">
                                {Math.round((dyad.total_best / data.total_deaths_best) * 100)}%
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-xs font-mono text-zinc-500 hidden md:table-cell">
                            {dyad.peak_year}{" "}
                            <span className="text-zinc-700">({fmtNum(dyad.peak_deaths)})</span>
                          </td>
                          <td className="py-2 px-3 text-[10px] font-mono text-zinc-600 hidden md:table-cell">
                            {dyad.first_year}
                            {dyad.last_year !== dyad.first_year ? ` – ${dyad.last_year}` : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex items-center gap-1.5 px-3 py-2 border-t border-zinc-800 bg-zinc-900/30">
                    <Users className="w-3 h-3 text-zinc-700" />
                    <span className="text-[9px] font-mono text-zinc-700">
                      {data.dyad_breakdown.length} dyad{data.dyad_breakdown.length !== 1 ? "s" : ""} ·
                      UCDP Battle-Related Deaths + Dyadic Dataset v25.1
                    </span>
                  </div>
                </div>
              </section>
            )}

            {/* ── 05 · Executive Briefing ── */}
            <section className="space-y-3">
              <SectionLabel num="05" title="Executive Briefing" />
              <ExecutiveBriefing data={data} />
            </section>
          </>
        )}

        {/* ── Empty state ── */}
        {!data && !loading && !error && !searchResults && (
          <div className="text-center py-16 space-y-2">
            <TrendingUp className="w-10 h-10 text-zinc-800 mx-auto" />
            <p className="text-sm font-mono text-zinc-600">
              Search for a conflict to view its full casualty timeline since 1989.
            </p>
            <p className="text-[11px] font-mono text-zinc-700">
              Powered by UCDP Battle-Related Deaths Dataset + Dyadic Dataset v25.1
            </p>
          </div>
        )}

      </main>
    </div>
  );
}
