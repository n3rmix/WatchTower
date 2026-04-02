import React, { useState } from 'react';
import axios from 'axios';
import Header from '../components/Header';
import ActorForceGraph from '../components/ActorForceGraph';
import { UCDP_REGION_MAP } from '../utils/regionUtils';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const ALL_REGIONS = Object.values(UCDP_REGION_MAP).sort();
const DEFAULT_YEAR_MIN = 1946;
const DEFAULT_YEAR_MAX = 2024;
const DEFAULT_YEAR_FROM = 2015;

// ── Loading indicator (shown after Build is clicked, while API fetches) ───────
const FETCH_MESSAGES = [
  'Fetching UCDP dyadic conflict datasets…',
  'Loading non-state actor records…',
  'Parsing hostile dyad relationships…',
  'Aggregating battle death statistics…',
];

function DataLoadingIndicator() {
  const [idx, setIdx]       = React.useState(0);
  const [fading, setFading] = React.useState(false);

  React.useEffect(() => {
    const id = setInterval(() => {
      setFading(true);
      setTimeout(() => { setIdx(i => (i + 1) % FETCH_MESSAGES.length); setFading(false); }, 300);
    }, 2200);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6">
      <div className="relative w-12 h-12">
        <div className="absolute inset-0 rounded-full border-2 border-zinc-800" />
        <div
          className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-500 animate-spin"
          style={{ animationDuration: '0.9s' }}
        />
        <div
          className="absolute inset-1.5 rounded-full border border-transparent border-t-zinc-600 animate-spin"
          style={{ animationDuration: '1.4s', animationDirection: 'reverse' }}
        />
      </div>
      <div className="text-center space-y-2">
        <p className="text-zinc-200 font-mono text-xs font-bold tracking-widest uppercase">
          Building Actor Network
        </p>
        <p
          className="text-zinc-500 font-mono text-[11px] transition-opacity duration-300 max-w-xs"
          style={{ opacity: fading ? 0 : 1 }}
        >
          {FETCH_MESSAGES[idx]}
        </p>
      </div>
      <div className="w-40 h-px bg-zinc-800 rounded-full overflow-hidden">
        <div className="h-full w-1/3 bg-blue-500/60 rounded-full animate-pulse" />
      </div>
    </div>
  );
}

// ── Configuration panel (shown first, before any API call) ────────────────────
function NetworkConfigPanel({ onBuild }) {
  const [fromYear,  setFromYear]  = useState(DEFAULT_YEAR_FROM);
  const [toYear,    setToYear]    = useState(DEFAULT_YEAR_MAX);
  const [minDeaths, setMinDeaths] = useState(500);
  const [selectedRegions, setSelectedRegions] = useState(new Set(ALL_REGIONS));

  const toggleRegion = region => {
    setSelectedRegions(prev => {
      const next = new Set(prev);
      next.has(region) ? next.delete(region) : next.add(region);
      return next;
    });
  };

  const allSelected = selectedRegions.size === ALL_REGIONS.length;
  const toggleAll   = () => setSelectedRegions(allSelected ? new Set() : new Set(ALL_REGIONS));
  const canBuild    = selectedRegions.size > 0;

  return (
    <div className="flex flex-col items-center justify-center h-full bg-zinc-950 p-8">
      <div className="w-full max-w-lg bg-zinc-900/60 border border-zinc-800 rounded-xl p-6 space-y-6">

        {/* Header */}
        <div>
          <h3 className="text-sm font-bold font-mono uppercase tracking-widest text-zinc-100">
            Configure Network
          </h3>
          <p className="text-[10px] font-mono text-zinc-500 mt-1">
            Filter the dataset before rendering · fewer nodes = faster layout
          </p>
        </div>

        {/* Year range */}
        <div className="space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Year range</p>
          <div className="flex items-center gap-3">
            <span className="text-zinc-500 font-mono text-xs w-8">From</span>
            <input
              type="range"
              min={DEFAULT_YEAR_MIN} max={toYear - 1}
              value={fromYear}
              onChange={e => setFromYear(+e.target.value)}
              className="flex-1 accent-blue-500"
            />
            <span className="text-zinc-300 font-mono text-xs w-10 text-right">{fromYear}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-zinc-500 font-mono text-xs w-8">To</span>
            <input
              type="range"
              min={fromYear + 1} max={DEFAULT_YEAR_MAX}
              value={toYear}
              onChange={e => setToYear(+e.target.value)}
              className="flex-1 accent-blue-500"
            />
            <span className="text-zinc-300 font-mono text-xs w-10 text-right">{toYear}</span>
          </div>
        </div>

        {/* Min deaths */}
        <div className="space-y-2">
          <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            Minimum battle deaths per dyad
          </p>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0} max={10000} step={100}
              value={minDeaths}
              onChange={e => setMinDeaths(+e.target.value)}
              className="flex-1 accent-red-500"
            />
            <span className="text-zinc-300 font-mono text-xs w-16 text-right">
              {minDeaths.toLocaleString()}+
            </span>
          </div>
        </div>

        {/* Regions */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Regions</p>
            <button
              onClick={toggleAll}
              className="text-[10px] font-mono text-blue-500 hover:text-blue-400 transition-colors"
            >
              {allSelected ? 'Deselect all' : 'Select all'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {ALL_REGIONS.map(region => (
              <label
                key={region}
                className={`flex items-center gap-1.5 px-2 py-1 rounded border cursor-pointer text-[11px] font-mono transition-colors ${
                  selectedRegions.has(region)
                    ? 'border-blue-500/50 bg-blue-500/10 text-zinc-200'
                    : 'border-zinc-700 text-zinc-600 hover:border-zinc-600'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedRegions.has(region)}
                  onChange={() => toggleRegion(region)}
                  className="accent-blue-500 w-3 h-3"
                />
                {region}
              </label>
            ))}
          </div>
        </div>

        {/* No region warning */}
        {!canBuild && (
          <p className="text-[10px] font-mono text-amber-500 text-center">
            Select at least one region to build the network.
          </p>
        )}

        {/* Build button */}
        <button
          onClick={() => onBuild({
            yearRange: [fromYear, toYear],
            minDeaths,
            regions: new Set(selectedRegions),
          })}
          disabled={!canBuild}
          className={`w-full py-2.5 rounded-lg font-mono text-xs uppercase tracking-widest font-bold transition-colors ${
            canBuild
              ? 'bg-blue-500 hover:bg-blue-400 text-white cursor-pointer'
              : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
          }`}
        >
          Build Network ▶
        </button>

        <p className="text-[9px] font-mono text-zinc-700 text-center">
          Data: UCDP GED · UCDP Non-State · all years {DEFAULT_YEAR_MIN}–{DEFAULT_YEAR_MAX}
        </p>

      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ActorNetworkPage() {
  const [rawData,     setRawData]     = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [buildConfig, setBuildConfig] = useState(null); // null = not yet configured

  const handleBuild = ({ yearRange, minDeaths, regions }) => {
    setBuildConfig({ yearRange, minDeaths, regions });
    setLoading(true);
    setError(null);
    setRawData(null);

    const attempt = (retries = 3, delay = 8000) => {
      axios.get(`${API}/actor-network`)
        .then(res => { setRawData(res.data); setLoading(false); })
        .catch(err => {
          const status = err?.response?.status;
          // 503 = cache still warming — retry automatically
          if (status === 503 && retries > 0) {
            setTimeout(() => attempt(retries - 1, delay), delay);
          } else {
            setError(err?.response?.data?.detail || err.message);
            setLoading(false);
          }
        });
    };
    attempt();
  };

  const handleReconfigure = () => {
    setBuildConfig(null);
    setRawData(null);
    setError(null);
  };

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      <Header />

      {/* Page title strip */}
      <div className="px-6 py-3 border-b border-zinc-800 bg-zinc-950/80 flex-shrink-0">
        <h2 className="text-sm font-bold font-mono uppercase tracking-widest text-zinc-100">
          Actor Relationship Force Graph
        </h2>
        <p className="text-[10px] font-mono text-zinc-500 mt-0.5">
          Directed network · nodes = conflict actors · edges = hostile dyads
          · thickness = battle deaths · pull toward center = most destructive relationships
        </p>
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0">
        {!buildConfig ? (
          <NetworkConfigPanel onBuild={handleBuild} />
        ) : loading ? (
          <DataLoadingIndicator />
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <p className="text-red-500 font-mono text-sm">Error: {error}</p>
            <button
              onClick={handleReconfigure}
              className="text-[10px] font-mono text-blue-500 hover:text-blue-400 border border-zinc-700 px-3 py-1.5 rounded"
            >
              ← Reconfigure
            </button>
          </div>
        ) : rawData?.dyads?.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <p className="text-zinc-500 font-mono text-sm">No dyadic records match these filters.</p>
            <button
              onClick={handleReconfigure}
              className="text-[10px] font-mono text-blue-500 hover:text-blue-400 border border-zinc-700 px-3 py-1.5 rounded"
            >
              ← Reconfigure
            </button>
          </div>
        ) : rawData ? (
          <ActorForceGraph
            rawData={rawData}
            initialYearRange={buildConfig.yearRange}
            initialMinDeaths={buildConfig.minDeaths}
            initialRegions={buildConfig.regions}
            onReconfigure={handleReconfigure}
          />
        ) : null}
      </div>
    </div>
  );
}
