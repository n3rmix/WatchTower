import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { Treemap, ResponsiveContainer } from "recharts";
import { ArrowLeft, ChevronRight, Globe, Loader2, AlertTriangle } from "lucide-react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// ─── Colour helpers ────────────────────────────────────────────────────────────

const MIN_YEAR = 1946;
const MAX_YEAR = 2024;

/**
 * Map a `lastYear` value to an HSL colour on a cool→warm spectrum.
 *   1946 → deep blue   hsl(220, 55%, 28%)
 *   2024 → deep red    hsl(  0, 80%, 40%)
 */
function yearToColor(lastYear) {
  const t = Math.max(0, Math.min(1, (lastYear - MIN_YEAR) / (MAX_YEAR - MIN_YEAR)));
  const hue = Math.round(220 * (1 - t));          // 220 → 0
  const sat = Math.round(55 + t * 25);             // 55% → 80%
  const lit = Math.round(28 + t * 12);             // 28% → 40%
  return `hsl(${hue}, ${sat}%, ${lit}%)`;
}

/** Human-readable death count: 1 234 567 → "1.2M", 45 000 → "45K" */
function fmtDeaths(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`;
  return n.toLocaleString();
}

// ─── Custom Treemap tile renderer ─────────────────────────────────────────────

const TileContent = (props) => {
  const { x, y, width, height, name, value, lastYear, depth } = props;

  // depth 0 = invisible root wrapper, depth 2 = recharts internal grouping node
  if (!name || depth !== 1) return null;

  const fill   = yearToColor(lastYear ?? MIN_YEAR);
  const showFull  = width > 90 && height > 48;
  const showName  = width > 50 && height > 28;

  return (
    <g style={{ cursor: "pointer" }}>
      <rect
        x={x + 1}
        y={y + 1}
        width={Math.max(0, width - 2)}
        height={Math.max(0, height - 2)}
        style={{ fill, stroke: "#0a0a0f", strokeWidth: 2 }}
        rx={3}
      />
      {showName && (
        <text
          x={x + width / 2}
          y={showFull ? y + height / 2 - 9 : y + height / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="rgba(255,255,255,0.92)"
          fontSize={Math.min(13, Math.max(9, width / 8))}
          fontWeight="600"
          fontFamily="monospace"
        >
          {name.length > 22 ? name.slice(0, 20) + "…" : name}
        </text>
      )}
      {showFull && (
        <text
          x={x + width / 2}
          y={y + height / 2 + 9}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="rgba(255,255,255,0.55)"
          fontSize={Math.min(11, Math.max(8, width / 10))}
          fontFamily="monospace"
        >
          {fmtDeaths(value)}
        </text>
      )}
      {showFull && (
        <text
          x={x + width / 2}
          y={y + height / 2 + 22}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="rgba(255,255,255,0.30)"
          fontSize={9}
          fontFamily="monospace"
        >
          last: {lastYear}
        </text>
      )}
    </g>
  );
};

// ─── Tooltip ──────────────────────────────────────────────────────────────────

const HoverTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  if (!d.name) return null;
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-sm px-3 py-2 text-xs font-mono shadow-xl">
      <p className="text-white font-semibold mb-1">{d.name}</p>
      {d.location && (
        <p className="text-zinc-400 mb-1">{d.location}</p>
      )}
      <p className="text-red-400">
        {d.value?.toLocaleString()} cumulative deaths
      </p>
      <p className="text-zinc-500">Last recorded: {d.lastYear}</p>
    </div>
  );
};

// ─── Colour legend ────────────────────────────────────────────────────────────

const ColorLegend = () => {
  const stops = Array.from({ length: 100 }, (_, i) => {
    const year = MIN_YEAR + Math.round((i / 99) * (MAX_YEAR - MIN_YEAR));
    return yearToColor(year);
  });
  const gradient = stops.join(", ");

  return (
    <div className="flex items-center gap-3 mt-4">
      <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider whitespace-nowrap">
        Older conflict
      </span>
      <div
        className="flex-1 h-3 rounded-sm border border-zinc-800"
        style={{ background: `linear-gradient(to right, ${gradient})` }}
      />
      <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider whitespace-nowrap">
        Active today
      </span>
      <div className="ml-3 flex gap-4 text-[10px] font-mono text-zinc-600">
        <span>{MIN_YEAR}</span>
        <span>{Math.round((MIN_YEAR + MAX_YEAR) / 2)}</span>
        <span>{MAX_YEAR}</span>
      </div>
    </div>
  );
};

// ─── Stat pill ────────────────────────────────────────────────────────────────

const StatPill = ({ label, value }) => (
  <div className="bg-zinc-900 border border-zinc-800 rounded-sm px-3 py-1.5 text-xs font-mono">
    <span className="text-zinc-500 uppercase tracking-wider">{label}: </span>
    <span className="text-white font-semibold">{value}</span>
  </div>
);

// ─── Main page ────────────────────────────────────────────────────────────────

const HumanCostPage = () => {
  const navigate = useNavigate();

  const [treemapData, setTreemapData]       = useState(null);
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState(null);
  const [selectedRegion, setSelectedRegion] = useState(null); // null = region view

  // Tooltip state for custom hover (Recharts Treemap doesn't use Tooltip natively)
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, data: null });

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API}/treemap`);
      setTreemapData(res.data);
    } catch (err) {
      setError(
        err.response?.status === 503
          ? "UCDP data temporarily unavailable. Please try again in a moment."
          : "Failed to load treemap data."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Build chart data ──────────────────────────────────────────────────────

  const chartData = selectedRegion
    ? selectedRegion.conflicts.map(c => ({
        name:      c.name,
        value:     c.total_deaths,
        lastYear:  c.last_year,
        location:  c.location,
      }))
    : (treemapData?.regions ?? []).map(r => ({
        name:      r.name,
        value:     r.total_deaths,
        lastYear:  r.last_year,
      }));

  // ── Click handler ─────────────────────────────────────────────────────────

  const handleTileClick = (node) => {
    if (!node || !node.name) return;
    if (!selectedRegion) {
      // Zoom into the region the user clicked
      const region = treemapData?.regions?.find(r => r.name === node.name);
      if (region) setSelectedRegion(region);
    }
    // Clicking a conflict tile does nothing further (no third level)
  };

  // ── Custom content with mouse events ─────────────────────────────────────

  const InteractiveTile = (props) => {
    const { x, y, width, height, name, value, lastYear, location, depth } = props;
    if (!name || depth !== 1) return null;

    return (
      <g
        style={{ cursor: selectedRegion ? "default" : "zoom-in" }}
        onClick={() => handleTileClick({ name, value, lastYear })}
        onMouseMove={(e) =>
          setTooltip({ visible: true, x: e.clientX, y: e.clientY, data: { name, value, lastYear, location } })
        }
        onMouseLeave={() => setTooltip(t => ({ ...t, visible: false }))}
      >
        <TileContent {...props} />
      </g>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">

      {/* ── Sticky header ────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/")}
              className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors text-sm font-mono"
            >
              <ArrowLeft className="w-4 h-4" />
              Dashboard
            </button>
            <ChevronRight className="w-3 h-3 text-zinc-700" />
            <Globe className="w-4 h-4 text-red-500" />
            <span className="text-sm font-mono font-semibold text-white uppercase tracking-wider">
              Human Cost
            </span>
          </div>

          {/* Breadcrumb when zoomed */}
          {selectedRegion && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedRegion(null)}
                className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-1 rounded-sm text-xs font-mono text-zinc-300 transition-colors"
              >
                <ArrowLeft className="w-3 h-3" />
                All regions
              </button>
              <ChevronRight className="w-3 h-3 text-zinc-700" />
              <span className="text-xs font-mono text-zinc-300">
                {selectedRegion.name}
              </span>
              <span className="text-xs font-mono text-zinc-600">
                ({selectedRegion.conflicts.length} conflicts)
              </span>
            </div>
          )}
        </div>
      </header>

      {/* ── Page content ─────────────────────────────────────────────────── */}
      <main className="container mx-auto px-4 py-6">

        {/* Title block */}
        <div className="mb-5">
          <h2 className="text-xl md:text-2xl font-bold uppercase tracking-tight heading-tactical mb-1">
            {selectedRegion
              ? `${selectedRegion.name}: Conflicts by Cumulative Deaths`
              : "Proportional Sacrifice by Region"}
          </h2>
          <p className="text-zinc-500 text-sm font-mono max-w-3xl">
            {selectedRegion
              ? `Tile area ∝ cumulative battle deaths since conflict onset. Colour encodes the last year deaths were recorded — blue is historical, red is recent.`
              : "Tile area is proportional to cumulative UCDP battle-deaths since each conflict's onset (1946–present). Click a region to zoom in. Some conflicts have silently accumulated hundreds of thousands of casualties with near-zero media coverage."
            }
          </p>

          {/* Stat pills */}
          {treemapData && !loading && (
            <div className="flex flex-wrap gap-2 mt-3">
              <StatPill
                label="total conflicts"
                value={treemapData.total_conflicts.toLocaleString()}
              />
              <StatPill
                label="cumulative deaths (all time)"
                value={fmtDeaths(treemapData.total_deaths)}
              />
              {selectedRegion && (
                <>
                  <StatPill
                    label={`${selectedRegion.name} deaths`}
                    value={fmtDeaths(selectedRegion.total_deaths)}
                  />
                  <StatPill
                    label="share of global total"
                    value={`${((selectedRegion.total_deaths / treemapData.total_deaths) * 100).toFixed(1)}%`}
                  />
                </>
              )}
              {treemapData.fetched_at && (
                <StatPill
                  label="UCDP data as of"
                  value={new Date(treemapData.fetched_at).toUTCString().replace(/:\d{2} GMT$/, " UTC")}
                />
              )}
            </div>
          )}
        </div>

        {/* ── States ──────────────────────────────────────────────────────── */}
        {loading && (
          <div className="flex flex-col items-center justify-center h-96 gap-3 text-zinc-500 font-mono text-sm">
            <Loader2 className="w-8 h-8 animate-spin text-red-500" />
            <p>Loading UCDP battle-deaths dataset…</p>
            <p className="text-xs text-zinc-600">This may take a few seconds on first load.</p>
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-amber-500 font-mono text-sm border border-amber-800/40 bg-amber-950/20 rounded-sm">
            <AlertTriangle className="w-7 h-7" />
            <p>{error}</p>
            <button
              onClick={fetchData}
              className="text-xs text-zinc-400 hover:text-white underline"
            >
              Retry
            </button>
          </div>
        )}

        {/* ── Treemap ─────────────────────────────────────────────────────── */}
        {!loading && !error && chartData.length > 0 && (
          <>
            <div className="w-full" style={{ height: "calc(100vh - 340px)", minHeight: 400 }}>
              <ResponsiveContainer width="100%" height="100%">
                <Treemap
                  data={chartData}
                  dataKey="value"
                  aspectRatio={4 / 3}
                  stroke="transparent"
                  isAnimationActive={false}
                  content={<InteractiveTile />}
                />
              </ResponsiveContainer>
            </div>

            <ColorLegend />

            <p className="mt-3 text-[10px] font-mono text-zinc-700 text-right">
              Source: UCDP Battle-Related Deaths Dataset v{process.env.REACT_APP_UCDP_VERSION ?? "25.1"} ·{" "}
              <a
                href="https://ucdp.uu.se"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-zinc-500"
              >
                ucdp.uu.se
              </a>
            </p>
          </>
        )}

        {!loading && !error && chartData.length === 0 && (
          <div className="flex items-center justify-center h-64 text-zinc-600 font-mono text-sm">
            No data available.
          </div>
        )}
      </main>

      {/* ── Floating tooltip ─────────────────────────────────────────────── */}
      {tooltip.visible && tooltip.data && (
        <div
          className="fixed z-50 pointer-events-none bg-zinc-900 border border-zinc-700 rounded-sm px-3 py-2 text-xs font-mono shadow-xl"
          style={{ left: tooltip.x + 14, top: tooltip.y - 10 }}
        >
          <p className="text-white font-semibold mb-0.5">{tooltip.data.name}</p>
          {tooltip.data.location && (
            <p className="text-zinc-400 mb-0.5">{tooltip.data.location}</p>
          )}
          <p className="text-red-400">
            {tooltip.data.value?.toLocaleString()} cumulative deaths
          </p>
          <p className="text-zinc-500">Last recorded: {tooltip.data.lastYear}</p>
        </div>
      )}
    </div>
  );
};

export default HumanCostPage;
