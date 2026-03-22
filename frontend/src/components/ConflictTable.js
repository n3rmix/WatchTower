import { Globe2, Users, Database, Clock } from "lucide-react";

/** Format an ISO string as "DD MMM YYYY HH:MM UTC" */
function formatTimestamp(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  return d.toUTCString().replace(/:\d{2} GMT$/, " UTC");
}

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
