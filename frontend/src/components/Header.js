import { Globe, RefreshCw, Database, AlertTriangle, Map, Network, Activity, Hash } from "lucide-react";
import { NavLink } from "react-router-dom";
import { Button } from "./ui/button";

/** Format an ISO string or Date as "DD MMM YYYY HH:MM UTC" */
function formatTimestamp(ts) {
  if (!ts) return "—";
  const d = ts instanceof Date ? ts : new Date(ts);
  if (isNaN(d.getTime())) return "—";
  return d.toUTCString().replace(/:\d{2} GMT$/, " UTC");
}

/** Returns true if the timestamp is more than 2 hours old (or missing). */
function isStale(ts) {
  if (!ts) return false;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return false;
  return Date.now() - d.getTime() > 2 * 60 * 60 * 1000;
}

const Header = ({ dataLastFetch, sourcesUsed = [], nextFetchIn, onRefresh }) => {
  const stale = isStale(dataLastFetch);

  return (
    <header className="border-b border-zinc-800 bg-zinc-950/50 backdrop-blur-sm sticky top-0 z-50" data-testid="dashboard-header">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          {/* Left: Logo + title */}
          <div className="flex items-center gap-4">
            <Globe className="w-8 h-8 text-red-500" />
            <div>
              <h1 className="text-2xl md:text-3xl font-bold uppercase tracking-tight heading-tactical" data-testid="app-title">
                Project WATCHTOWER
              </h1>
              <p className="text-xs text-zinc-500 font-mono uppercase tracking-wider">Global Conflict Monitoring</p>
              <p className="text-xs text-zinc-600 font-mono mt-0.5">
                Data courtesy of{" "}
                <a
                  href="https://ucdp.uu.se"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-400 hover:text-red-400 underline underline-offset-2 transition-colors"
                >
                  UCDP
                </a>
                {" "}— thank you for freely providing access.
              </p>
              <p className="text-xs text-zinc-600 font-mono mt-0.5">
                Built by{" "}
                <a
                  href="https://www.cybrain.tech/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-400 hover:text-red-400 underline underline-offset-2 transition-colors"
                >
                  cybrain.tech
                </a>
              </p>
            </div>
          </div>

          {/* Centre: page navigation */}
          <nav className="hidden md:flex items-center gap-1">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-1 rounded-sm text-xs font-mono uppercase tracking-wider transition-colors border ${
                  isActive
                    ? "bg-zinc-800 border-zinc-700 text-white"
                    : "border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
                }`
              }
            >
              <Globe className="w-3.5 h-3.5" />
              Dashboard
            </NavLink>
            <NavLink
              to="/human-cost"
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-1 rounded-sm text-xs font-mono uppercase tracking-wider transition-colors border ${
                  isActive
                    ? "bg-zinc-800 border-zinc-700 text-white"
                    : "border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
                }`
              }
            >
              <Map className="w-3.5 h-3.5" />
              Human Cost
            </NavLink>
            <NavLink
              to="/actor-network"
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-1 rounded-sm text-xs font-mono uppercase tracking-wider transition-colors border ${
                  isActive
                    ? "bg-zinc-800 border-zinc-700 text-white"
                    : "border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
                }`
              }
            >
              <Network className="w-3.5 h-3.5" />
              Actor Network
            </NavLink>
            <NavLink
              to="/life-trajectory"
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-1 rounded-sm text-xs font-mono uppercase tracking-wider transition-colors border ${
                  isActive
                    ? "bg-zinc-800 border-zinc-700 text-white"
                    : "border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
                }`
              }
            >
              <Activity className="w-3.5 h-3.5" />
              Lifelines
            </NavLink>
            <NavLink
              to="/counter"
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-1 rounded-sm text-xs font-mono uppercase tracking-wider transition-colors border ${
                  isActive
                    ? "bg-zinc-800 border-zinc-700 text-white"
                    : "border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
                }`
              }
            >
              <Hash className="w-3.5 h-3.5" />
              Counter
            </NavLink>
          </nav>

          {/* Right: timestamps + buttons */}
          <div className="flex items-center gap-3">
            {/* Timestamp block — hidden on very small screens */}
            <div className="hidden sm:block text-right space-y-0.5 border-r border-zinc-800 pr-3 mr-1">
              <div data-testid="source-last-update">
                <p className="text-xs text-zinc-500 uppercase tracking-wider font-mono flex items-center justify-end gap-1">
                  <Database className="w-3 h-3" />
                  Sources updated
                </p>
                <p className="text-xs text-zinc-300 font-mono font-semibold" data-testid="source-update-time">
                  {formatTimestamp(dataLastFetch)}
                </p>
                {sourcesUsed.length > 0 && (
                  <p className="text-xs text-zinc-600 font-mono">
                    {sourcesUsed.join(" · ")}
                  </p>
                )}
                {nextFetchIn !== null && (
                  <p className="text-xs text-zinc-600 font-mono">
                    next in {nextFetchIn} min
                  </p>
                )}
              </div>

              {/* Stale-data warning */}
              {stale && (
                <p className="flex items-center justify-end gap-1 text-xs font-mono text-amber-500 bg-amber-950/30 border border-amber-800/40 px-2 py-0.5 rounded-sm mt-1" data-testid="stale-warning">
                  <AlertTriangle className="w-3 h-3" />
                  Data may be stale
                </p>
              )}
            </div>

            <Button
              onClick={onRefresh}
              variant="secondary"
              size="sm"
              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-mono text-xs px-3 py-1 rounded-sm border border-zinc-700"
              data-testid="refresh-btn"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
