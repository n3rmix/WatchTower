import { useEffect, useState, useRef } from "react";
import axios from "axios";
import { Activity } from "lucide-react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// ── Design constants ──────────────────────────────────────────────────────────

const SIZE      = 300;
const CX        = SIZE / 2;
const CY        = SIZE / 2;
const MAX_R     = 108;   // max spoke radius (leaves room for labels)
const LABEL_GAP = 18;    // extra gap from MAX_R to label anchor

// Zone thresholds (in days)
const ZONE_ESCALATING = 7;
const ZONE_WATCH      = 21;

// Short display names for the radial labels
const SHORT = {
  "Ukraine":        "UKRAINE",
  "Gaza/Palestine": "GAZA",
  "Sudan":          "SUDAN",
  "Myanmar":        "MYANMAR",
  "Syria":          "SYRIA",
  "Yemen":          "YEMEN",
  "Ethiopia":       "ETHIOPIA",
  "DRC (Congo)":    "DRC",
  "Iran":           "IRAN",
};

// Color by status
function dotColor(daysSince) {
  if (daysSince <= ZONE_ESCALATING) return "#ef4444";
  if (daysSince <= ZONE_WATCH)      return "#f59e0b";
  return "#71717a";
}

function dotGlow(daysSince) {
  if (daysSince <= ZONE_ESCALATING) return "rgba(239,68,68,0.50)";
  if (daysSince <= ZONE_WATCH)      return "rgba(245,158,11,0.40)";
  return "transparent";
}

// Convert polar (angle from top, radius) → Cartesian
function polar(angleDeg, r) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: CX + r * Math.cos(rad),
    y: CY + r * Math.sin(rad),
  };
}

// textAnchor for a label point
function anchor(x) {
  if (x < CX - 8) return "end";
  if (x > CX + 8) return "start";
  return "middle";
}

// Baseline offset for labels above vs below center
function baselineOffset(y) {
  return y < CY ? -5 : 5;
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function Tooltip({ conflict, x, y, visible }) {
  if (!visible || !conflict) return null;
  const statusLabel =
    conflict.status === "escalating" ? "ESCALATING" :
    conflict.status === "watch"      ? "WATCH"       :
    conflict.status === "quiet"      ? "QUIET"       : "COOLING";
  const statusColor =
    conflict.status === "escalating" ? "#ef4444" :
    conflict.status === "watch"      ? "#f59e0b" : "#52525b";

  // Clamp tooltip so it doesn't overflow the component box
  const TW = 168, TH = 86;
  const tx = Math.min(Math.max(x - TW / 2, 4), SIZE - TW - 4);
  const ty = y < CY + 30 ? y + 14 : y - TH - 10;

  return (
    <foreignObject x={tx} y={ty} width={TW} height={TH} style={{ overflow: "visible" }}>
      <div
        style={{ fontFamily: "JetBrains Mono, monospace" }}
        className="bg-zinc-900/95 border border-zinc-700 rounded-sm px-2.5 py-2 text-[10px] shadow-xl pointer-events-none"
      >
        <p className="text-zinc-200 font-bold text-[11px] mb-1 leading-tight">
          {conflict.conflict_name || conflict.country}
        </p>
        <p style={{ color: statusColor }} className="font-bold tracking-widest mb-1">
          {statusLabel} · {conflict.days_since_escalation}d ago
        </p>
        {conflict.last_escalation_date && (
          <p className="text-zinc-500">Last: {conflict.last_escalation_date}</p>
        )}
        {conflict.recent_best_deaths > 0 && (
          <p className="text-zinc-500">
            ≥{conflict.recent_best_deaths} deaths / 7d window
          </p>
        )}
      </div>
    </foreignObject>
  );
}

// ── SVG Radial Chart ──────────────────────────────────────────────────────────

function RadialChart({ conflicts, lookbackDays }) {
  const [hovered, setHovered] = useState(null);   // { conflict, x, y }
  const n = conflicts.length;
  if (n === 0) return null;

  const zone1R = (ZONE_ESCALATING / lookbackDays) * MAX_R;
  const zone2R = (ZONE_WATCH      / lookbackDays) * MAX_R;

  // Mid-ring guide labels (shown at top spoke)
  const ringLabelAngle = -5; // slightly offset to avoid spoke collision

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width="100%"
      height="100%"
      style={{ display: "block" }}
    >
      <defs>
        {/* Radial gradient: red core → transparent */}
        <radialGradient id="hcEscZone" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#ef4444" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0.00" />
        </radialGradient>
        {/* Glow filter for escalating dots */}
        <filter id="hcGlow" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="hcGlowAmber" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* ── Zone fills ── */}
      <circle cx={CX} cy={CY} r={MAX_R} fill="none" stroke="#27272a" strokeWidth="1" />
      <circle cx={CX} cy={CY} r={zone2R} fill="none" stroke="#44403c" strokeWidth="0.75" strokeDasharray="3,3" />
      <circle cx={CX} cy={CY} r={zone1R} fill="url(#hcEscZone)" stroke="#ef444430" strokeWidth="0.75" />

      {/* ── Ring distance labels ── */}
      {(() => {
        const p1 = polar(ringLabelAngle, zone1R);
        const p2 = polar(ringLabelAngle, zone2R);
        const p3 = polar(ringLabelAngle, MAX_R);
        return (
          <>
            <text x={p1.x + 3} y={p1.y} fill="#ef444455" fontSize="6.5" fontFamily="monospace" dominantBaseline="middle">7d</text>
            <text x={p2.x + 3} y={p2.y} fill="#f59e0b44" fontSize="6.5" fontFamily="monospace" dominantBaseline="middle">21d</text>
            <text x={p3.x + 3} y={p3.y} fill="#3f3f4680" fontSize="6.5" fontFamily="monospace" dominantBaseline="middle">{lookbackDays}d</text>
          </>
        );
      })()}

      {/* ── Spokes + dots + labels ── */}
      {conflicts.map((c, i) => {
        const angleDeg  = (i / n) * 360;
        const r         = Math.max(4, (Math.min(c.days_since_escalation, lookbackDays) / lookbackDays) * MAX_R);
        const spokeEnd  = polar(angleDeg, MAX_R);
        const dot       = polar(angleDeg, r);
        const labelPt   = polar(angleDeg, MAX_R + LABEL_GAP);
        const label     = SHORT[c.country] || c.country.toUpperCase().slice(0, 7);
        const color     = dotColor(c.days_since_escalation);
        const isEsc     = c.days_since_escalation <= ZONE_ESCALATING;
        const isWatch   = c.days_since_escalation <= ZONE_WATCH && !isEsc;
        const isHovered = hovered?.conflict.country === c.country;

        return (
          <g key={c.country}>
            {/* Spoke */}
            <line
              x1={CX} y1={CY}
              x2={spokeEnd.x} y2={spokeEnd.y}
              stroke={isHovered ? "#52525b" : "#2a2a2e"}
              strokeWidth={isHovered ? 1.5 : 1}
            />

            {/* Escalating: bright fill-line from center to dot */}
            {isEsc && (
              <line
                x1={CX} y1={CY}
                x2={dot.x} y2={dot.y}
                stroke="#ef444460"
                strokeWidth="3"
              />
            )}

            {/* Dot glow halo (static soft fill) */}
            {(isEsc || isWatch) && (
              <circle
                cx={dot.x} cy={dot.y}
                r={isEsc ? 20 : 15}
                fill={dotGlow(c.days_since_escalation)}
              />
            )}

            {/* Sonar-ping ring 1 — escalating (fast, urgent) */}
            {isEsc && (
              <circle cx={dot.x} cy={dot.y} r="13" fill="none" stroke="#ef4444" strokeWidth="1.5">
                <animate attributeName="r"              from="13" to="28" dur="1.6s" repeatCount="indefinite" />
                <animate attributeName="stroke-opacity" from="0.7" to="0"  dur="1.6s" repeatCount="indefinite" />
              </circle>
            )}

            {/* Sonar-ping ring 2 — escalating (delayed second echo) */}
            {isEsc && (
              <circle cx={dot.x} cy={dot.y} r="13" fill="none" stroke="#ef4444" strokeWidth="1">
                <animate attributeName="r"              from="13" to="28" dur="1.6s" begin="0.8s" repeatCount="indefinite" />
                <animate attributeName="stroke-opacity" from="0.4" to="0"  dur="1.6s" begin="0.8s" repeatCount="indefinite" />
              </circle>
            )}

            {/* Sonar-ping ring — watch (slow, softer) */}
            {isWatch && (
              <circle cx={dot.x} cy={dot.y} r="10" fill="none" stroke="#f59e0b" strokeWidth="1">
                <animate attributeName="r"              from="10" to="22" dur="2.8s" repeatCount="indefinite" />
                <animate attributeName="stroke-opacity" from="0.5" to="0"  dur="2.8s" repeatCount="indefinite" />
              </circle>
            )}

            {/* Main dot */}
            <circle
              cx={dot.x} cy={dot.y}
              r={isEsc ? 13 : isWatch ? 10 : 6}
              fill={color}
              fillOpacity={isEsc ? 1 : isWatch ? 0.92 : 0.80}
              stroke={isEsc ? "#fca5a5" : isWatch ? "#fcd34d" : "#a1a1aa"}
              strokeWidth={isEsc ? 2 : isWatch ? 1.5 : 1}
              strokeOpacity={isEsc ? 0.85 : isWatch ? 0.60 : 0.30}
              filter={isEsc ? "url(#hcGlow)" : isWatch ? "url(#hcGlowAmber)" : undefined}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHovered({ conflict: c, x: dot.x, y: dot.y })}
              onMouseLeave={() => setHovered(null)}
            />

            {/* Invisible larger hit area */}
            <circle
              cx={dot.x} cy={dot.y} r={16}
              fill="transparent"
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHovered({ conflict: c, x: dot.x, y: dot.y })}
              onMouseLeave={() => setHovered(null)}
            />

            {/* Spoke label */}
            <text
              x={labelPt.x}
              y={labelPt.y + baselineOffset(labelPt.y)}
              fill={isHovered ? "#d4d4d8" : isEsc ? "#ef4444cc" : isWatch ? "#f59e0baa" : "#71717a"}
              fontSize="8"
              fontFamily="monospace"
              letterSpacing="0.04em"
              textAnchor={anchor(labelPt.x)}
              dominantBaseline="middle"
              style={{ userSelect: "none", cursor: "pointer" }}
              onMouseEnter={() => setHovered({ conflict: c, x: dot.x, y: dot.y })}
              onMouseLeave={() => setHovered(null)}
            >
              {label}
            </text>
          </g>
        );
      })}

      {/* ── Center marker ── */}
      <circle cx={CX} cy={CY} r="3" fill="#3f3f46" />
      <text x={CX} y={CY + 11} fill="#27272a" fontSize="6" fontFamily="monospace" textAnchor="middle" letterSpacing="0.08em">NOW</text>

      {/* ── Hover tooltip ── */}
      {hovered && (
        <Tooltip
          conflict={hovered.conflict}
          x={hovered.x}
          y={hovered.y}
          visible
        />
      )}
    </svg>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function HumanitarianClock() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  useEffect(() => {
    axios
      .get(`${API}/humanitarian-clock`)
      .then((r) => {
        const d = r.data;
        if (d.source_available === false) {
          setError("no-source");
        } else {
          setData(d);
        }
        setLoading(false);
      })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  const escalating = data?.conflicts.filter((c) => c.status === "escalating").length ?? 0;
  const watch      = data?.conflicts.filter((c) => c.status === "watch").length      ?? 0;
  const cooling    = data?.conflicts.filter(
    (c) => c.status === "cooling" || c.status === "quiet"
  ).length ?? 0;

  return (
    <div className="tactical-card corner-accent p-4 flex flex-col" style={{ minHeight: 340 }}>
      {/* Header */}
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-base font-semibold uppercase tracking-tight heading-tactical text-zinc-300">
            Humanitarian Clock
          </h3>
          <p className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">
            Days since last significant escalation
          </p>
        </div>
        {data && (
          <div className="flex items-center gap-1 text-[9px] font-mono text-zinc-700">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block blink-animation" />
            {data.threshold}+ deaths / 7d
          </div>
        )}
      </div>

      {/* Zone legend */}
      {data && (
        <div className="flex items-center gap-3 mb-2">
          <span className="flex items-center gap-1 text-[9px] font-mono text-red-500">
            <span className="w-2 h-2 rounded-full bg-red-500 inline-block opacity-80" />
            ESCALATING ≤7d
          </span>
          <span className="flex items-center gap-1 text-[9px] font-mono text-amber-500">
            <span className="w-2 h-2 rounded-full bg-amber-500 inline-block opacity-80" />
            WATCH ≤21d
          </span>
          <span className="flex items-center gap-1 text-[9px] font-mono text-zinc-600">
            <span className="w-2 h-2 rounded-full bg-zinc-600 inline-block" />
            COOLING
          </span>
        </div>
      )}

      {/* Chart area */}
      <div className="flex-1 flex items-center justify-center">
        {loading && (
          <div className="flex flex-col items-center gap-2 text-zinc-600">
            <Activity className="w-6 h-6 animate-pulse text-red-800" />
            <span className="text-[10px] font-mono uppercase tracking-widest">
              Querying UCDP…
            </span>
          </div>
        )}

        {error === "no-source" && !loading && (
          <div className="text-center px-4 space-y-1">
            <p className="text-[10px] font-mono text-zinc-600">
              No live data source available.
            </p>
            <p className="text-[9px] font-mono text-zinc-700">
              Configure <span className="text-zinc-500">ACLED_EMAIL + ACLED_KEY</span> or{" "}
              <span className="text-zinc-500">UCDP_API_KEY</span> to enable this widget.
            </p>
          </div>
        )}

        {error && error !== "no-source" && !loading && (
          <p className="text-[10px] font-mono text-zinc-700 text-center px-4">
            Could not reach event data source.
          </p>
        )}

        {data && !loading && (
          <div style={{ width: "100%", aspectRatio: "1 / 1", maxWidth: SIZE + 40 }}>
            <RadialChart conflicts={data.conflicts} lookbackDays={data.lookback_days} />
          </div>
        )}
      </div>

      {/* Footer counts */}
      {data && (
        <div className="flex items-center justify-between pt-2 border-t border-zinc-800/50 mt-1">
          <div className="flex gap-3">
            <span className="text-[9px] font-mono">
              <span className="text-red-500 font-bold">{escalating}</span>
              <span className="text-zinc-700"> escalating</span>
            </span>
            <span className="text-[9px] font-mono">
              <span className="text-amber-500 font-bold">{watch}</span>
              <span className="text-zinc-700"> watch</span>
            </span>
            <span className="text-[9px] font-mono">
              <span className="text-zinc-500 font-bold">{cooling}</span>
              <span className="text-zinc-700"> cooling</span>
            </span>
          </div>
          <span className="text-[9px] font-mono text-zinc-700">
            {data.data_source || "UCDP GED Candidate"}
          </span>
        </div>
      )}
    </div>
  );
}
