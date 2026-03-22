const METRICS = [
  { key: "total_deaths",    label: "Total"    },
  { key: "civilian_deaths", label: "Civilian" },
  { key: "military_deaths", label: "Military" },
  { key: "children_deaths", label: "Children" },
];

// Abbreviations keep row labels legible in a narrow column
const SHORT = {
  "Ukraine":        "UKR",
  "Gaza/Palestine": "GAZ",
  "Sudan":          "SDN",
  "Myanmar":        "MMR",
  "Syria":          "SYR",
  "Yemen":          "YEM",
  "Ethiopia":       "ETH",
  "DRC (Congo)":    "DRC",
  "Iran":           "IRN",
};

function norm(value, max) {
  return max > 0 ? Math.min(value / max, 1) : 0;
}

/** Red heat: transparent at 0, opaque at 1; text scales accordingly */
function cellStyle(n) {
  if (n === 0) return { backgroundColor: "rgb(15,15,18)", color: "#3f3f46" };
  const alpha = 0.12 + n * 0.88;
  return {
    backgroundColor: `rgba(220,38,38,${alpha.toFixed(3)})`,
    color: n > 0.55 ? "#fecaca" : "#f87171",
  };
}

function fmt(v) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}m`;
  if (v >= 1_000)     return `${Math.round(v / 1_000)}k`;
  return String(v);
}

const Cell = ({ value, maxVal, country, metricLabel }) => {
  const n = norm(value, maxVal);
  return (
    <div className="relative group">
      <div
        className="flex items-center justify-center h-8 rounded-sm cursor-default select-none
                   ring-inset hover:ring-1 hover:ring-zinc-400 transition-shadow"
        style={cellStyle(n)}
      >
        <span className="text-[9px] font-mono font-semibold leading-none">
          {fmt(value)}
        </span>
      </div>

      {/* Hover tooltip */}
      <div
        className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5
                   hidden group-hover:block z-50 pointer-events-none"
      >
        <div className="bg-zinc-900 border border-zinc-700 rounded-sm shadow-xl px-2.5 py-1.5 whitespace-nowrap">
          <p className="text-[10px] font-mono font-semibold text-zinc-300">{country}</p>
          <p className="text-[10px] font-mono text-zinc-500">
            {metricLabel}:{" "}
            <span className="text-zinc-200">{value.toLocaleString()}</span>
          </p>
          <p className="text-[9px] font-mono text-zinc-700 mt-0.5">
            {(n * 100).toFixed(0)}% of column max
          </p>
        </div>
        <div className="mx-auto w-2 h-2 bg-zinc-900 border-r border-b border-zinc-700 rotate-45 -mt-1" />
      </div>
    </div>
  );
};

const ConflictHeatmap = ({ conflicts }) => {
  if (!conflicts?.length) return null;

  const sorted = [...conflicts].sort((a, b) => b.total_deaths - a.total_deaths);
  const maxima = Object.fromEntries(
    METRICS.map((m) => [m.key, Math.max(...sorted.map((c) => c[m.key] || 0), 1)])
  );

  return (
    <div className="tactical-card corner-accent p-4 flex flex-col" data-testid="conflict-heatmap">
      {/* Header */}
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-tight font-mono text-zinc-400">
          Casualty Heatmap
        </h3>
        <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">
          Relative per column
        </span>
      </div>

      {/* Column labels */}
      <div className="grid gap-1 mb-1" style={{ gridTemplateColumns: "2.5rem repeat(4, 1fr)" }}>
        <div />
        {METRICS.map((m) => (
          <div
            key={m.key}
            className="text-center text-[9px] font-mono uppercase tracking-wider text-zinc-600"
          >
            {m.label}
          </div>
        ))}
      </div>

      {/* Data rows */}
      <div className="flex-1 space-y-1">
        {sorted.map((conflict) => (
          <div
            key={conflict.id}
            className="grid gap-1 items-center"
            style={{ gridTemplateColumns: "2.5rem repeat(4, 1fr)" }}
          >
            {/* Row label */}
            <div className="flex items-center h-8">
              <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider leading-none">
                {SHORT[conflict.country] ?? conflict.country.slice(0, 3).toUpperCase()}
              </span>
            </div>

            {/* Metric cells */}
            {METRICS.map((m) => (
              <Cell
                key={m.key}
                value={conflict[m.key] || 0}
                maxVal={maxima[m.key]}
                country={conflict.country}
                metricLabel={m.label}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Gradient legend */}
      <div className="mt-4 flex items-center gap-2">
        <span className="text-[9px] font-mono text-zinc-700 uppercase">Low</span>
        <div
          className="flex-1 h-1.5 rounded-full"
          style={{
            background:
              "linear-gradient(to right, rgb(15,15,18), rgba(220,38,38,0.4), rgb(220,38,38))",
          }}
        />
        <span className="text-[9px] font-mono text-zinc-700 uppercase">High</span>
      </div>
    </div>
  );
};

export default ConflictHeatmap;
