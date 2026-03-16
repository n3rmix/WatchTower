const ConflictTable = ({ conflicts }) => {
  return (
    <div className="tactical-card p-6 corner-accent mb-20" data-testid="conflict-table">
      <h3 className="text-xl font-semibold uppercase tracking-tight mb-4 heading-tactical text-zinc-300">
        Active Conflicts Detail
      </h3>
      
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-left py-3 px-2 text-xs uppercase tracking-wider font-mono text-zinc-400">Country</th>
              <th className="text-left py-3 px-2 text-xs uppercase tracking-wider font-mono text-zinc-400">Region</th>
              <th className="text-right py-3 px-2 text-xs uppercase tracking-wider font-mono text-zinc-400">Total</th>
              <th className="text-right py-3 px-2 text-xs uppercase tracking-wider font-mono text-zinc-400">Civilian</th>
              <th className="text-right py-3 px-2 text-xs uppercase tracking-wider font-mono text-zinc-400">Military</th>
              <th className="text-right py-3 px-2 text-xs uppercase tracking-wider font-mono text-zinc-400">Children</th>
              <th className="text-left py-3 px-2 text-xs uppercase tracking-wider font-mono text-zinc-400">Status</th>
            </tr>
          </thead>
          <tbody>
            {conflicts.map((conflict, index) => (
              <tr
                key={conflict.id}
                className="border-b border-zinc-900 hover:bg-zinc-900/50 transition-colors"
                data-testid={`conflict-row-${index}`}
              >
                <td className="py-3 px-2 font-mono text-zinc-200">{conflict.country}</td>
                <td className="py-3 px-2 font-mono text-zinc-400 text-xs">{conflict.region}</td>
                <td className="py-3 px-2 font-mono text-red-500 text-right font-semibold">
                  {conflict.total_deaths.toLocaleString()}
                </td>
                <td className="py-3 px-2 font-mono text-red-600 text-right">
                  {conflict.civilian_deaths.toLocaleString()}
                </td>
                <td className="py-3 px-2 font-mono text-zinc-400 text-right">
                  {conflict.military_deaths.toLocaleString()}
                </td>
                <td className="py-3 px-2 font-mono text-red-700 text-right font-semibold">
                  {conflict.children_deaths.toLocaleString()}
                </td>
                <td className="py-3 px-2">
                  <span className={`inline-flex items-center gap-1 text-xs font-mono uppercase px-2 py-1 rounded-sm ${
                    conflict.status === 'active' 
                      ? 'bg-red-950/50 text-red-500 border border-red-900' 
                      : 'bg-zinc-800/50 text-zinc-400 border border-zinc-700'
                  }`}>
                    {conflict.status === 'active' && <span className="w-1.5 h-1.5 bg-red-500 rounded-full blink-animation"></span>}
                    {conflict.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ConflictTable;