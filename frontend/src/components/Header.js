import { Globe, RefreshCw, Settings as SettingsIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "./ui/button";

const Header = ({ lastUpdate, onRefresh }) => {
  const navigate = useNavigate();

  return (
    <header className="border-b border-zinc-800 bg-zinc-950/50 backdrop-blur-sm sticky top-0 z-50" data-testid="dashboard-header">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Globe className="w-8 h-8 text-red-500" />
            <div>
              <h1 className="text-2xl md:text-3xl font-bold uppercase tracking-tight heading-tactical" data-testid="app-title">
                Project WATCHTOWER
              </h1>
              <p className="text-xs text-zinc-500 font-mono uppercase tracking-wider">Global Conflict Monitoring</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right hidden md:block">
              <p className="text-xs text-zinc-400 uppercase tracking-wider font-mono">Last Update</p>
              <p className="text-xs text-zinc-500 font-mono" data-testid="last-update-time">
                {lastUpdate.toLocaleTimeString()}
              </p>
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