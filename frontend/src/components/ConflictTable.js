import { Globe2 } from "lucide-react";

const ConflictTable = ({ conflicts }) => {
  return (
    <div className="tactical-card p-6 corner-accent mb-20" data-testid="conflict-table">
      <h3 className="text-xl font-semibold uppercase tracking-tight mb-4 heading-tactical text-zinc-300">
        Active Conflicts Detail
      </h3>
      
      <div className="space-y-4">
        {conflicts.map((conflict, index) => (
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
              </div>
              
              <div className="col-span-2 text-right">
                <p className="text-xs uppercase tracking-wider font-mono text-zinc-500 mb-1">Total</p>
                <p className="font-mono text-red-500 font-bold text-lg">
                  {conflict.total_deaths.toLocaleString()}
                </p>
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
                <span className={`inline-flex items-center gap-1 text-xs font-mono uppercase px-2 py-1 rounded-sm ${
                  conflict.status === 'active' 
                    ? 'bg-red-950/50 text-red-500 border border-red-900' 
                    : 'bg-zinc-800/50 text-zinc-400 border border-zinc-700'
                }`}>
                  {conflict.status === 'active' && <span className="w-1.5 h-1.5 bg-red-500 rounded-full blink-animation"></span>}
                  {conflict.status}
                </span>
              </div>
            </div>
            
            {/* Description and Countries */}
            <div className="p-4 grid grid-cols-12 gap-4">
              <div className="col-span-8">
                <p className="text-xs uppercase tracking-wider font-mono text-zinc-500 mb-2">Description</p>
                <p className="text-sm text-zinc-300 leading-relaxed">{conflict.description || 'No description available.'}</p>
              </div>
              
              <div className="col-span-4">
                <p className="text-xs uppercase tracking-wider font-mono text-zinc-500 mb-2 flex items-center gap-2">
                  <Globe2 className="w-3 h-3" />
                  Countries Involved
                </p>
                <div className="flex flex-wrap gap-2">
                  {(conflict.countries_involved || []).map((country, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-zinc-800/50 border border-zinc-700 rounded-sm text-xs font-mono text-zinc-300"
                    >
                      <Globe2 className="w-3 h-3 text-red-500" />
                      {country}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ConflictTable;