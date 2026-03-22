import { Globe2, Users, Database, Clock } from "lucide-react";

/** Format an ISO string as "DD MMM YYYY HH:MM UTC" */
function formatTimestamp(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  return d.toUTCString().replace(/:\d{2} GMT$/, " UTC");
}

const INTENSITY_STYLES = {
  Critical: "bg-red-950/70 border-red-700 text-red-400",
  High:     "bg-orange-950/60 border-orange-700 text-orange-400",
  Medium:   "bg-yellow-950/50 border-yellow-700/60 text-yellow-500",
  Low:      "bg-zinc-800/50 border-zinc-700 text-zinc-400",
};

const INTENSITY_DESCRIPTIONS = {
  Critical: "Extremely high activity — a large number of documented incidents with severe casualties per event. Indicates full-scale, ongoing armed conflict.",
  High:     "Significant ongoing violence with substantial documented casualties. Regular armed engagements with notable humanitarian impact.",
  Medium:   "Moderate conflict activity. Armed clashes are recorded but intensity remains below major-war thresholds.",
  Low:      "Limited documented events or early-stage conflict. Incident frequency and casualty counts are relatively low.",
};

const IntensityBadge = ({ tier = "Low" }) => (
  <div className="relative group inline-flex">
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] font-mono uppercase tracking-wider border cursor-default ${INTENSITY_STYLES[tier] ?? INTENSITY_STYLES.Low}`}
    >
      {tier}
    </span>
    {/* Custom tooltip */}
    <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block z-50 w-60 pointer-events-none">
      <div className="bg-zinc-900 border border-zinc-700 rounded-sm shadow-xl p-3 text-left">
        <p className={`text-xs font-mono font-semibold uppercase tracking-wider mb-1 ${(INTENSITY_STYLES[tier] ?? INTENSITY_STYLES.Low).split(" ").find(c => c.startsWith("text-"))}`}>
          {tier} Intensity
        </p>
        <p className="text-xs text-zinc-300 leading-relaxed">
          {INTENSITY_DESCRIPTIONS[tier] ?? INTENSITY_DESCRIPTIONS.Low}
        </p>
        <p className="text-[10px] text-zinc-600 mt-2 pt-2 border-t border-zinc-800 font-mono leading-relaxed">
          Derived from UCDP GED event count and deaths-per-event ratio.
        </p>
      </div>
      {/* Arrow */}
      <div className="w-2 h-2 bg-zinc-900 border-r border-b border-zinc-700 rotate-45 ml-3 -mt-1" />
    </div>
  </div>
);

const ConflictTable = ({ conflicts, dataLastFetch }) => {
  const sectionTs = formatTimestamp(dataLastFetch);

  return (
    <div className="tactical-card p-6 corner-accent mb-20" data-testid="conflict-table">
      <div className="flex items-start justify-between mb-4">
        <h3 className="text-xl font-semibold uppercase tracking-tight heading-tactical text-zinc-300">
          Active Conflicts Detail
        </h3>
        {sectionTs && (
          <p className="flex items-center gap-1 text-xs font-mono text-zinc-600 mt-1" data-testid="conflict-table-timestamp">
            <Clock className="w-3 h-3" />
            <span>Source data: {sectionTs}</span>
          </p>
        )}
      </div>

      <div className="space-y-4">
        {conflicts.map((conflict, index) => {
          const conflictTs = formatTimestamp(conflict.last_updated);
          return (
            <div
              key={conflict.id}
              className="border border-zinc-800 bg-zinc-950/30 hover:bg-zinc-900/50 transition-colors"
              data-testid={`conflict-row-${index}`}
            >
              {/* Header Row */}
              <div className="grid grid-cols-12 gap-4 p-4 border-b border-zinc-800">
                <div className="col-span-3">
                  <p className="text-xs uppercase tracking-wider font-mono text-zinc-500 mb-1">Country</p>
                  <p className="font-mono text-zinc-200 font-semibold">{conflict.country}</p>
                  <p className="font-mono text-zinc-500 text-xs mt-1">{conflict.region}</p>
                  <div className="mt-1.5">
                    <IntensityBadge tier={conflict.intensity_tier} />
                  </div>
                  {conflictTs && (
                    <p className="flex items-center gap-1 font-mono text-zinc-700 text-xs mt-1" data-testid={`conflict-timestamp-${index}`}>
                      <Clock className="w-2.5 h-2.5" />
                      {conflictTs}
                    </p>
                  )}
                </div>

                <div className="col-span-2 text-right">
                  <p className="text-xs uppercase tracking-wider font-mono text-zinc-500 mb-1">Total</p>
                  <p className="font-mono text-red-500 font-bold text-lg">
                    {conflict.total_deaths.toLocaleString()}
                  </p>
                  {conflict.deaths_low != null && conflict.deaths_high != null && (
                    <p className="font-mono text-zinc-600 text-[10px] leading-tight mt-0.5" title="UCDP low–high estimate range">
                      {conflict.deaths_low.toLocaleString()}–{conflict.deaths_high.toLocaleString()}
                    </p>
                  )}
                </div>

                <div className="col-span-2 text-right">
                  <p className="text-xs uppercase tracking-wider font-mono text-zinc-500 mb-1">Civilian</p>
                  <p className="font-mono text-red-600 font-semibold">
                    {conflict.civilian_deaths.toLocaleString()}
                  </p>
                </div>

                <div className="col-span-2 text-right">
                  <p className="text-xs uppercase tracking-wider font-mono text-zinc-500 mb-1">Military</p>
                  <p className="font-mono text-zinc-400 font-semibold">
                    {conflict.military_deaths.toLocaleString()}
                  </p>
                </div>

                <div className="col-span-2 text-right">
                  <p className="text-xs uppercase tracking-wider font-mono text-zinc-500 mb-1">Children</p>
                  <p className="font-mono text-red-700 font-bold">
                    {conflict.children_deaths.toLocaleString()}
                  </p>
                </div>

                <div className="col-span-1 flex items-center justify-end">
                  <span className="inline-flex items-center gap-1 text-xs font-mono uppercase px-2 py-1 rounded-sm bg-red-950/50 text-red-500 border border-red-900">
                    <span className="w-1.5 h-1.5 bg-red-500 rounded-full blink-animation"></span>
                    active
                  </span>
                </div>
              </div>

              {/* Description */}
              <div className="p-4 border-b border-zinc-800">
                <p className="text-xs uppercase tracking-wider font-mono text-zinc-500 mb-2">Description</p>
                <p className="text-sm text-zinc-300 leading-relaxed">{conflict.description || 'No description available.'}</p>
              </div>

              {/* Parties and Sources */}
              <div className="p-4 grid grid-cols-2 gap-6">
                {/* All Conflicting Parties */}
                <div>
                  <p className="text-xs uppercase tracking-wider font-mono text-zinc-500 mb-3 flex items-center gap-2">
                    <Users className="w-3 h-3" />
                    All Conflicting Parties
                  </p>
                  <div className="space-y-2">
                    {(conflict.countries_involved || []).length > 0 && (
                      <div>
                        <p className="text-xs text-zinc-600 font-mono mb-1">Countries:</p>
                        <div className="flex flex-wrap gap-2">
                          {conflict.countries_involved.map((country, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-1 px-2 py-1 bg-red-950/30 border border-red-900/50 rounded-sm text-xs font-mono text-red-400"
                            >
                              <Globe2 className="w-3 h-3" />
                              {country}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {(conflict.parties_involved || []).length > 0 && (
                      <div>
                        <p className="text-xs text-zinc-600 font-mono mb-1">Armed Groups & Factions:</p>
                        <div className="flex flex-wrap gap-2">
                          {conflict.parties_involved.map((party, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-1 px-2 py-1 bg-zinc-800/50 border border-zinc-700 rounded-sm text-xs font-mono text-zinc-300"
                            >
                              {party}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Data Sources */}
                <div>
                  <p className="text-xs uppercase tracking-wider font-mono text-zinc-500 mb-3 flex items-center gap-2">
                    <Database className="w-3 h-3" />
                    Data Sources
                  </p>
                  <div className="space-y-1">
                    {(conflict.data_sources || []).length > 0 ? (
                      conflict.data_sources.map((source, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 px-2 py-1 bg-blue-950/20 border border-blue-900/30 rounded-sm"
                        >
                          <Database className="w-3 h-3 text-blue-400" />
                          <span className="text-xs font-mono text-blue-300">{source}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-zinc-600 font-mono">No sources listed</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ConflictTable;
