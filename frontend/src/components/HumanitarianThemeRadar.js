import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { Heart, ChevronDown } from "lucide-react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

const GDELT_COUNTRIES = [
  "Ukraine", "Gaza/Palestine", "Sudan", "Myanmar",
  "Syria", "Yemen", "Ethiopia", "DRC (Congo)", "Iran", "Lebanon", "Haiti",
];

// Theme display names & colours
const THEME_META = {
  KILL:           { label: "Lethal Violence",    color: "#ef4444" },
  WOUND:          { label: "Injuries",           color: "#f97316" },
  REFUGEES:       { label: "Displacement",       color: "#eab308" },
  FAMINE:         { label: "Famine",             color: "#a16207" },
  HOSPITAL:       { label: "Medical Crisis",     color: "#ec4899" },
  HUMANITARIAN:   { label: "Aid Operations",     color: "#8b5cf6" },
  CEASEFIRE:      { label: "Ceasefire",          color: "#22c55e" },
  PEACE:          { label: "Peace Talks",        color: "#3b82f6" },
};

/**
 * Minimal SVG radar / spider chart.
 * values: { [theme]: number }  — normalised 0..1
 */
function RadarChart({ values, themes, size = 220 }) {
  const cx = size / 2;
  const cy = size / 2;
  const r  = (size / 2) * 0.72;
  const n  = themes.length;

  // Angle for each axis (start at top, go clockwise)
  function angleFor(i) {
    return (i / n) * 2 * Math.PI - Math.PI / 2;
  }
  function point(i, radius) {
    const a = angleFor(i);
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
  }

  // Grid rings
  const rings = [0.25, 0.5, 0.75, 1.0];

  // Polygon for data
  const polyPoints = themes.map((t, i) => point(i, (values[t] || 0) * r));

  return (
    <svg width={size} height={size} className="overflow-visible">
      {/* Grid rings */}
      {rings.map((frac) => {
        const pts = themes.map((_, i) => point(i, frac * r).join(",")).join(" ");
        return (
          <polygon
            key={frac}
            points={pts}
            fill="none"
            stroke="#27272a"
            strokeWidth={1}
          />
        );
      })}

      {/* Axes */}
      {themes.map((_, i) => {
        const [x, y] = point(i, r);
        return (
          <line
            key={i}
            x1={cx} y1={cy}
            x2={x}  y2={y}
            stroke="#27272a"
            strokeWidth={1}
          />
        );
      })}

      {/* Data polygon */}
      <polygon
        points={polyPoints.map(([x, y]) => `${x},${y}`).join(" ")}
        fill="rgba(220,38,38,0.15)"
        stroke="#dc2626"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />

      {/* Data dots */}
      {themes.map((t, i) => {
        const val = values[t] || 0;
        const [x, y] = point(i, val * r);
        const meta = THEME_META[t] || {};
        return (
          <circle
            key={t}
            cx={x} cy={y}
            r={3.5}
            fill={meta.color || "#dc2626"}
            stroke="#09090b"
            strokeWidth={1}
          />
        );
      })}

      {/* Labels */}
      {themes.map((t, i) => {
        const [lx, ly] = point(i, r * 1.22);
        const meta = THEME_META[t] || {};
        const val = values[t] || 0;
        return (
          <g key={t}>
            <text
              x={lx} y={ly}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={meta.color || "#71717a"}
              fontSize={8}
              fontFamily="JetBrains Mono, monospace"
              fontWeight="600"
            >
              {meta.label || t}
            </text>
            <text
              x={lx} y={ly + 11}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#52525b"
              fontSize={7}
              fontFamily="JetBrains Mono, monospace"
            >
              {(val * 100).toFixed(0)}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function HumanitarianThemeRadar() {
  const [country, setCountry] = useState("Gaza/Palestine");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const retryRef = useRef(null);

  const load = useCallback(async (c) => {
    setLoading(true);
    setError(null);
    setData(null);
    if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
    try {
      const res = await axios.get(`${BACKEND_URL}/api/gdelt-themes`, {
        params: { country: c },
      });
      setData(res.data);
      // Backend is warming up the cache in background — retry until data arrives
      if (res.data?.pending) {
        retryRef.current = setTimeout(() => load(c), 30_000);
      }
    } catch (err) {
      setError("GDELT themes unavailable — data may be loading");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(country);
    return () => { if (retryRef.current) clearTimeout(retryRef.current); };
  }, [country, load]);

  // Normalise radar values: max value across themes = 1.0
  const themes = data?.themes || Object.keys(THEME_META);
  const radarRaw = data?.radar_values || {};
  const maxVal = Math.max(...Object.values(radarRaw), 1);
  const radarNorm = Object.fromEntries(
    Object.entries(radarRaw).map(([k, v]) => [k, v / maxVal])
  );

  return (
    <section className="bg-zinc-900 border border-zinc-800 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-zinc-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Heart size={13} className="text-pink-500" />
            <h3 className="text-[10px] font-mono uppercase tracking-widest text-zinc-400 font-bold">
              Humanitarian Theme Radar
            </h3>
          </div>
          <p className="text-[9px] font-mono text-zinc-700 mt-0.5">
            GDELT GKG 2.0 article-theme volume · 30-day window
          </p>
        </div>
        {/* Country selector */}
        <div className="relative">
          <select
            value={country}
            onChange={e => setCountry(e.target.value)}
            className="appearance-none bg-zinc-800 border border-zinc-700 text-zinc-300 text-[9px] font-mono px-2 py-1 pr-6 focus:outline-none focus:border-zinc-500 cursor-pointer"
          >
            {GDELT_COUNTRIES.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-3 text-zinc-600 font-mono text-xs py-8 justify-center">
          <div className="w-4 h-4 border border-zinc-700 border-t-red-500 rounded-full animate-spin" />
          Querying GDELT themes…
        </div>
      )}

      {!loading && data?.pending && (
        <div className="text-[9px] font-mono text-zinc-600 text-center py-8 space-y-1">
          <div className="w-4 h-4 border border-zinc-700 border-t-yellow-500 rounded-full animate-spin mx-auto mb-3" />
          <p>Cache warming up — retrying in 30s</p>
          <p className="text-zinc-700">GDELT theme queries run in the background on first load</p>
        </div>
      )}

      {error && !loading && (
        <p className="text-[9px] font-mono text-zinc-600 text-center py-8">{error}</p>
      )}

      {!loading && !error && data && !data.pending && (
        <div className="flex flex-col items-center gap-4">
          {/* Source pill */}
          <span className="text-[8px] font-mono text-zinc-700 uppercase tracking-wider self-end">
            GDELT DOC 2.0
            {data.fetched_at && ` · ${new Date(data.fetched_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
          </span>

          {/* Radar */}
          <RadarChart values={radarNorm} themes={themes} size={240} />

          {/* Bar breakdown */}
          <div className="w-full space-y-1.5 pt-2">
            {themes
              .slice()
              .sort((a, b) => (radarRaw[b] || 0) - (radarRaw[a] || 0))
              .map(theme => {
                const meta = THEME_META[theme] || {};
                const val  = radarRaw[theme] || 0;
                const pct  = maxVal > 0 ? (val / maxVal) * 100 : 0;
                return (
                  <div key={theme} className="flex items-center gap-2">
                    <span className="text-[8px] font-mono w-24 shrink-0" style={{ color: meta.color || "#71717a" }}>
                      {meta.label || theme}
                    </span>
                    <div className="flex-1 h-1 bg-zinc-800 relative">
                      <div
                        className="absolute left-0 top-0 h-full"
                        style={{ width: `${pct}%`, backgroundColor: meta.color || "#dc2626" }}
                      />
                    </div>
                    <span className="text-[8px] font-mono text-zinc-600 w-10 text-right tabular-nums">
                      {val.toFixed(1)}/d
                    </span>
                  </div>
                );
              })}
          </div>
          <p className="text-[8px] font-mono text-zinc-700 self-start">
            Values = avg articles/day in last 7 days matching theme
          </p>
        </div>
      )}
    </section>
  );
}
