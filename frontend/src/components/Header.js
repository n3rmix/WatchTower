import { Globe, RefreshCw, Settings as SettingsIcon, Clock, Database } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "./ui/button";

/** Format an ISO string or Date as "DD MMM YYYY HH:MM UTC" */
function formatTimestamp(ts) {
  if (!ts) return "—";
  const d = ts instanceof Date ? ts : new Date(ts);
  if (isNaN(d.getTime())) return "—";
  return d.toUTCString().replace(/:\d{2} GMT$/, " UTC");
}

const Header = ({ lastUpdate, dataLastFetch, sourcesUsed = [], nextFetchIn, onRefresh }) => {
  const navigate = useNavigate();

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
            </div>
          </div>

          {/* Right: timestamps + buttons */}
          <div className="flex items-center gap-3">
            {/* Timestamp block — hidden on very small screens */}
            <div className="hidden sm:block text-right space-y-1 border-r border-zinc-800 pr-3 mr-1">
              {/* Source fetch timestamp */}
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
                    Next in {nextFetchIn} min
                  </p>
                )}
              </div>

              {/* Display-layer poll timestamp */}
              <div data-testid="display-last-update">
                <p className="text-xs text-zinc-500 uppercase tracking-wider font-mono flex items-center justify-end gap-1">
                  <Clock className="w-3 h-3" />
                  Display polled
                </p>
                <p className="text-xs text-zinc-500 font-mono" data-testid="last-update-time">
                  {formatTimestamp(lastUpdate)}
                </p>
              </div>
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

            <Button
              onClick={() => navigate('/settings')}
              variant="secondary"
              size="sm"
              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-mono text-xs px-3 py-1 rounded-sm border border-zinc-700"
              data-testid="settings-btn"
            >
              <SettingsIcon className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
