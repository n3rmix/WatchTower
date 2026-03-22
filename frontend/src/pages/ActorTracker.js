import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import {
  Crosshair, ChevronLeft, Search, ExternalLink,
  AlertTriangle, FileText, Users, Skull, Activity,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer,
  Tooltip as RechartsTooltip, Cell,
} from "recharts";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const COUNTRIES = [
  { label: "Ukraine",        gwno: "369"     },
  { label: "Gaza/Palestine", gwno: "6663,666" }, // 6663 = UCDP extended code for Palestinian territories (onesided); 666 = Israel (GED fallback)
  { label: "Sudan",          gwno: "625"     },
  { label: "Myanmar",        gwno: "775"     },
  { label: "Syria",          gwno: "652"     },
  { label: "Yemen",          gwno: "678,679" },
  { label: "Ethiopia",       gwno: "530"     },
  { label: "DRC (Congo)",    gwno: "490"     },
];

const ALL_YEARS = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
const DEFAULT_YEARS = new Set([2020, 2021, 2022, 2023]);
const PAGE_SIZE = 50;

function fmtDate(d) {
  return d ? d.slice(0, 10) : "—";
}

function fmtNum(n) {
  if (n === null || n === undefined || n === "") return "—";
  return Number(n).toLocaleString();
}

// ─── Sub-components ────────────────────────────────────────────────────────────

const SectionLabel = ({ num, title, sub }) => (
  <div className="flex items-baseline gap-2 mb-3">
    <span className="text-[10px] font-mono text-red-700 uppercase tracking-widest">{num} ·</span>
    <span className="text-xs font-mono text-zinc-400 uppercase tracking-wider">{title}</span>
    {sub && <span className="text-[10px] font-mono text-zinc-700">{sub}</span>}
  </div>
);

const StatBox = ({ icon, label, value }) => (
  <div className="bg-zinc-900/60 border border-zinc-800 rounded-sm p-3">
    <div className="flex items-center gap-1.5 text-zinc-600 mb-1">
      {icon}
      <span className="text-[9px] font-mono uppercase tracking-wider">{label}</span>
    </div>
    <p className="text-lg font-bold font-mono text-zinc-200">{value}</p>
  </div>
);

// ─── Main page ─────────────────────────────────────────────────────────────────

const ActorTracker = () => {
  const [country, setCountry] = useState(COUNTRIES[0]);
  const [years, setYears] = useState(DEFAULT_YEARS);
  const [phase, setPhase] = useState("setup"); // setup | actors | profile
  const [actors, setActors] = useState([]);
  const [actor, setActor] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [error, setError] = useState(null);
  const [eventsPage, setEventsPage] = useState(0);

  const toggleYear = (yr) =>
    setYears((prev) => {
      const next = new Set(prev);
      if (next.has(yr)) next.delete(yr);
      else next.add(yr);
      return next;
    });

  const sortedYears = [...years].sort((a, b) => a - b);

  const fetchActors = async () => {
    if (!years.size) return;
    setLoading(true);
    setError(null);
    setActors([]);
    setActor(null);
    setProfile(null);
    try {
      const res = await axios.get(`${API}/onesided`, {
        params: { gwno: country.gwno, years: sortedYears.join(",") },
      });
      setActors(res.data.actors || []);
      setPhase("actors");
    } catch (e) {
      setError(e.response?.data?.detail || "Failed to fetch actors from UCDP.");
    } finally {
      setLoading(false);
    }
  };

  const fetchProfile = async (selectedActor) => {
    setActor(selectedActor);
    setLoadingProfile(true);
    setError(null);
    setEventsPage(0);
    setProfile(null);
    setPhase("profile");
    try {
      const res = await axios.get(`${API}/gedevents`, {
        params: {
          actor: selectedActor.actor_name,
          gwno: country.gwno,
          years: sortedYears.join(","),
        },
      });
      setProfile(res.data);
    } catch (e) {
      setError(e.response?.data?.detail || "Failed to fetch events from UCDP.");
    } finally {
      setLoadingProfile(false);
    }
  };

  // Build per-year chart data from GED events
  const timelineData = useMemo(() => {
    if (!profile?.events?.length) return [];
    const byYear = {};
    for (const ev of profile.events) {
      const yr = String(ev.date_start?.slice(0, 4) || ev.year || "");
      if (!yr) continue;
      if (!byYear[yr]) byYear[yr] = { year: yr, deaths: 0, events: 0 };
      byYear[yr].deaths += parseInt(ev.best || 0);
      byYear[yr].events += 1;
    }
    return Object.values(byYear).sort((a, b) => a.year.localeCompare(b.year));
  }, [profile]);

  const pagedEvents = useMemo(() => {
    if (!profile?.events) return [];
    return profile.events.slice(eventsPage * PAGE_SIZE, (eventsPage + 1) * PAGE_SIZE);
  }, [profile, eventsPage]);

  const totalPages = profile ? Math.ceil(profile.events.length / PAGE_SIZE) : 0;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100" data-testid="actor-tracker">

      {/* ── Page header ── */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Crosshair className="w-6 h-6 text-red-500" />
            <div>
              <h1 className="text-xl font-bold uppercase tracking-tight heading-tactical">
                Actor Accountability Tracker
              </h1>
              <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-wider">
                One-Sided Violence · UCDP GED Cross-Reference · Evidence-Grade Source Tracing
              </p>
            </div>
          </div>
          <Link
            to="/"
            className="flex items-center gap-1.5 text-xs font-mono text-zinc-500 hover:text-red-400
                       border border-zinc-800 hover:border-red-900/50 px-2.5 py-1.5 rounded-sm transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Dashboard
          </Link>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 space-y-6">

        {/* ── 01 · Query configuration ── */}
        <div className="tactical-card corner-accent p-5">
          <SectionLabel num="01" title="Configure Query" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

            {/* Country */}
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-wider text-zinc-600 mb-2">
                Country / Conflict
              </label>
              <select
                className="w-full bg-zinc-900 border border-zinc-700 text-zinc-200 text-sm font-mono
                           px-3 py-2 rounded-sm focus:outline-none focus:border-red-700"
                value={country.label}
                onChange={(e) => setCountry(COUNTRIES.find((c) => c.label === e.target.value))}
              >
                {COUNTRIES.map((c) => (
                  <option key={c.gwno} value={c.label}>{c.label}</option>
                ))}
              </select>
              <p className="text-[9px] font-mono text-zinc-700 mt-1">GW code: {country.gwno}</p>
            </div>

            {/* Year multi-select */}
            <div className="md:col-span-2">
              <label className="block text-[10px] font-mono uppercase tracking-wider text-zinc-600 mb-2">
                Years (multi-select)
              </label>
              <div className="flex flex-wrap gap-1.5">
                {ALL_YEARS.map((yr) => (
                  <button
                    key={yr}
                    onClick={() => toggleYear(yr)}
                    className={`px-2.5 py-1 text-xs font-mono rounded-sm border transition-colors ${
                      years.has(yr)
                        ? "bg-red-950/60 border-red-700/60 text-red-300"
                        : "bg-zinc-900 border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-400"
                    }`}
                  >
                    {yr}
                  </button>
                ))}
              </div>
              <p className="text-[9px] font-mono text-zinc-700 mt-1.5">
                {years.size} year{years.size !== 1 ? "s" : ""} selected ·
                UCDP dataset typically lags ~1 year behind current date
              </p>
            </div>
          </div>

          <div className="mt-5 flex items-center gap-4 flex-wrap">
            <button
              onClick={fetchActors}
              disabled={loading || !years.size}
              className="flex items-center gap-2 px-4 py-2 bg-red-900/60 hover:bg-red-900/80
                         border border-red-700/60 text-red-200 text-sm font-mono uppercase tracking-wider
                         rounded-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Search className="w-4 h-4" />
              {loading ? "Querying UCDP…" : "Fetch Actors"}
            </button>
            {phase !== "setup" && !loading && (
              <span className="text-xs font-mono text-zinc-600">
                {actors.length} actor{actors.length !== 1 ? "s" : ""} found in onesided dataset
                {phase === "profile" && actor && (
                  <> · profiling <span className="text-zinc-400">{actor.actor_name}</span></>
                )}
              </span>
            )}
          </div>

          {error && (
            <div className="mt-3 flex items-center gap-2 text-xs font-mono text-amber-400
                            bg-amber-950/20 border border-amber-800/40 px-3 py-2 rounded-sm">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* ── 02 · Actor list ── */}
        {(phase === "actors" || phase === "profile") && (
          <div>
            <SectionLabel
              num="02"
              title="One-Sided Violence Perpetrators"
              sub={`${country.label} · ${sortedYears.join(", ")}`}
            />
            {actors.length === 0 ? (
              <div className="tactical-card p-8 text-center text-zinc-600 font-mono text-sm">
                No one-sided violence actors found for the selected country / year combination.
                <p className="text-xs mt-2 text-zinc-700">
                  Try expanding the year range — the UCDP onesided dataset may not have coverage
                  for all country-year dyads.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {actors.map((a, i) => (
                  <button
                    key={a.actor_id || a.actor_name}
                    onClick={() => fetchProfile(a)}
                    disabled={loadingProfile}
                    className={`tactical-card p-4 text-left hover:border-red-900/50 transition-all group
                                disabled:opacity-60 ${
                      actor?.actor_id === a.actor_id && phase === "profile"
                        ? "border-red-700/60 bg-red-950/10"
                        : ""
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-mono text-zinc-700">#{i + 1}</span>
                      <span className="text-[9px] font-mono text-red-800 uppercase tracking-wider">
                        Perpetrator
                      </span>
                    </div>
                    <p className="text-sm font-semibold font-mono text-zinc-100 leading-snug mb-3
                                  group-hover:text-red-300 transition-colors">
                      {a.actor_name}
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                      <div>
                        <p className="text-zinc-600 uppercase tracking-wider">Civilian Deaths</p>
                        <p className="text-red-400 font-semibold text-sm mt-0.5">
                          {fmtNum(a.total_deaths)}
                        </p>
                      </div>
                      <div>
                        <p className="text-zinc-600 uppercase tracking-wider">Active Years</p>
                        <p className="text-zinc-300 mt-0.5">
                          {a.years_active.length > 0 ? a.years_active.join(", ") : "—"}
                        </p>
                      </div>
                    </div>
                    {a.deaths_high > a.total_deaths && (
                      <p className="text-[9px] font-mono text-zinc-700 mt-1.5">
                        Range: {fmtNum(a.deaths_low)} – {fmtNum(a.deaths_high)}
                      </p>
                    )}
                    {a.actor_id && (
                      <p className="text-[9px] font-mono text-zinc-700 mt-1">
                        actor_id: {a.actor_id}
                      </p>
                    )}
                    <p className="text-[9px] font-mono text-zinc-600 group-hover:text-zinc-400 transition-colors mt-2">
                      Investigate →
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── 03 · Actor profile ── */}
        {phase === "profile" && actor && (
          <div>
            <div className="flex items-center gap-3 mb-3">
              <SectionLabel num="03" title="Actor Profile" />
              <button
                onClick={() => { setPhase("actors"); setProfile(null); setActor(null); }}
                className="text-[10px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors -mt-3"
              >
                ← back to actor list
              </button>
            </div>

            {loadingProfile ? (
              <div className="tactical-card p-10 text-center font-mono text-zinc-600 text-sm">
                <div className="flex items-center justify-center gap-2">
                  <Search className="w-4 h-4 animate-pulse text-red-700" />
                  Querying UCDP GED for event-level evidence…
                </div>
              </div>
            ) : profile ? (
              <div className="space-y-4">

                {/* Profile header card */}
                <div className="tactical-card corner-accent p-5">
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-5">
                    <div>
                      <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-wider mb-1">
                        Identified Perpetrator
                      </p>
                      <h2 className="text-2xl font-bold font-mono text-red-400 heading-tactical uppercase">
                        {actor.actor_name}
                      </h2>
                      <p className="text-xs font-mono text-zinc-500 mt-1.5">
                        {country.label} · {sortedYears.join(", ")} · TypeOfViolence = 3 (One-Sided)
                      </p>
                      {actor.actor_id && (
                        <p className="text-[10px] font-mono text-zinc-700 mt-0.5">
                          UCDP actor_id: {actor.actor_id}
                        </p>
                      )}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 shrink-0">
                      <StatBox icon={<Activity className="w-3.5 h-3.5" />} label="GED Events"    value={fmtNum(profile.total_events)}    />
                      <StatBox icon={<Skull    className="w-3.5 h-3.5" />} label="Total Deaths"  value={fmtNum(profile.total_deaths)}    />
                      <StatBox icon={<Users    className="w-3.5 h-3.5" />} label="Civilians"     value={fmtNum(profile.civilian_deaths)} />
                      <StatBox icon={<FileText className="w-3.5 h-3.5" />} label="Source Orgs"   value={profile.source_offices?.length ?? "—"} />
                    </div>
                  </div>

                  {/* Source offices */}
                  {profile.source_offices?.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-zinc-800/60">
                      <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-600 mb-2">
                        Verified Source Offices
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {profile.source_offices.map((s) => (
                          <span
                            key={s}
                            className="text-[10px] font-mono px-2 py-0.5 border border-zinc-700 rounded-sm text-zinc-400"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Timeline chart */}
                {timelineData.length > 1 && (
                  <div className="tactical-card p-5">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-4">
                      Civilian Deaths per Year (UCDP best estimate)
                    </p>
                    <ResponsiveContainer width="100%" height={160}>
                      <BarChart data={timelineData} margin={{ top: 4, right: 4, bottom: 4, left: 8 }}>
                        <XAxis
                          dataKey="year"
                          tick={{ fontSize: 10, fontFamily: "monospace", fill: "#71717a" }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 10, fontFamily: "monospace", fill: "#71717a" }}
                          axisLine={false}
                          tickLine={false}
                          width={45}
                          tickFormatter={(v) => v >= 1000 ? `${Math.round(v / 1000)}k` : v}
                        />
                        <RechartsTooltip
                          contentStyle={{
                            backgroundColor: "#18181b",
                            border: "1px solid #3f3f46",
                            borderRadius: "2px",
                            fontFamily: "monospace",
                            fontSize: 11,
                          }}
                          labelStyle={{ color: "#a1a1aa" }}
                          itemStyle={{ color: "#fca5a5" }}
                          formatter={(v, name) => [fmtNum(v), name === "deaths" ? "Deaths" : name]}
                        />
                        <Bar dataKey="deaths" radius={[2, 2, 0, 0]}>
                          {timelineData.map((entry, idx) => (
                            <Cell key={idx} fill={entry.deaths > 0 ? "#dc2626" : "#27272a"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Events table */}
                <div className="tactical-card overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
                    <p className="text-xs font-mono uppercase tracking-wider text-zinc-500">
                      GED Events · Evidence-Grade Source Citations
                    </p>
                    <p className="text-[10px] font-mono text-zinc-600">
                      {profile.events.length} event{profile.events.length !== 1 ? "s" : ""} ·
                      showing {eventsPage * PAGE_SIZE + 1}–{Math.min((eventsPage + 1) * PAGE_SIZE, profile.events.length)}
                    </p>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs font-mono">
                      <thead>
                        <tr className="border-b border-zinc-800 text-[10px] text-zinc-600 uppercase tracking-wider">
                          <th className="text-left px-4 py-2 whitespace-nowrap">Date</th>
                          <th className="text-left px-4 py-2">Location</th>
                          <th className="text-right px-4 py-2 whitespace-nowrap">Best Est.</th>
                          <th className="text-right px-4 py-2 whitespace-nowrap">Civilians</th>
                          <th className="text-left px-4 py-2 whitespace-nowrap">Source Office</th>
                          <th className="text-left px-4 py-2">Source Article</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedEvents.map((ev, i) => (
                          <tr
                            key={ev.id || i}
                            className="border-b border-zinc-900 hover:bg-zinc-900/40 transition-colors"
                          >
                            {/* Date */}
                            <td className="px-4 py-2 text-zinc-400 whitespace-nowrap">
                              {fmtDate(ev.date_start)}
                              {ev.date_end && ev.date_end !== ev.date_start && (
                                <span className="text-zinc-700"> – {fmtDate(ev.date_end)}</span>
                              )}
                            </td>

                            {/* Location */}
                            <td className="px-4 py-2 text-zinc-300 max-w-[200px]">
                              <span className="block truncate">
                                {[ev.adm_1, ev.adm_2].filter(Boolean).join(" / ") || ev.country || "—"}
                              </span>
                              {ev.where_description && (
                                <span className="text-zinc-700 text-[9px] block truncate">
                                  {ev.where_description}
                                </span>
                              )}
                            </td>

                            {/* Best estimate */}
                            <td className="px-4 py-2 text-right">
                              <span className={parseInt(ev.best) > 0 ? "text-red-400" : "text-zinc-700"}>
                                {fmtNum(ev.best)}
                              </span>
                              {(ev.low !== undefined && ev.high !== undefined && ev.low !== ev.high) && (
                                <span className="text-zinc-700 text-[9px] block">
                                  {fmtNum(ev.low)}–{fmtNum(ev.high)}
                                </span>
                              )}
                            </td>

                            {/* Civilian deaths */}
                            <td className="px-4 py-2 text-right">
                              <span className={parseInt(ev.deaths_civilians) > 0 ? "text-red-500" : "text-zinc-700"}>
                                {fmtNum(ev.deaths_civilians)}
                              </span>
                            </td>

                            {/* Source office */}
                            <td className="px-4 py-2 text-zinc-500 max-w-[150px]">
                              <span className="truncate block">{ev.source_office || "—"}</span>
                            </td>

                            {/* Source article link */}
                            <td className="px-4 py-2 max-w-[180px]">
                              {ev.source_article ? (
                                <a
                                  href={ev.source_article}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1 text-zinc-500 hover:text-red-400 transition-colors"
                                  title={ev.source_headline || ev.source_article}
                                >
                                  <ExternalLink className="w-3 h-3 shrink-0" />
                                  <span className="truncate text-[10px]">
                                    {ev.source_headline || "View source"}
                                  </span>
                                </a>
                              ) : (
                                <span className="text-zinc-700">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800">
                      <button
                        onClick={() => setEventsPage((p) => Math.max(0, p - 1))}
                        disabled={eventsPage === 0}
                        className="text-[10px] font-mono text-zinc-500 hover:text-zinc-300 disabled:opacity-30
                                   disabled:cursor-not-allowed px-2 py-1 border border-zinc-800 rounded-sm"
                      >
                        ← Prev
                      </button>
                      <span className="text-[10px] font-mono text-zinc-600">
                        Page {eventsPage + 1} of {totalPages}
                      </span>
                      <button
                        onClick={() => setEventsPage((p) => Math.min(totalPages - 1, p + 1))}
                        disabled={eventsPage >= totalPages - 1}
                        className="text-[10px] font-mono text-zinc-500 hover:text-zinc-300 disabled:opacity-30
                                   disabled:cursor-not-allowed px-2 py-1 border border-zinc-800 rounded-sm"
                      >
                        Next →
                      </button>
                    </div>
                  )}
                </div>

                {/* Footer note */}
                <p className="text-[10px] font-mono text-zinc-700 text-center pb-4">
                  UCDP GED · One-sided violence (TypeOfViolence=3) ·
                  For CTI-informed humanitarian advisories, sanctions screening, and ICC referral support.
                  Source traceability via source_article + source_office fields.
                </p>

              </div>
            ) : null}
          </div>
        )}

      </div>
    </div>
  );
};

export default ActorTracker;
