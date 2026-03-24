import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import Header from '../components/Header';
import ActorForceGraph from '../components/ActorForceGraph';
import { normalizeRegion } from '../utils/regionUtils';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const FETCH_MESSAGES = [
  'Fetching UCDP dyadic conflict datasets…',
  'Loading non-state actor records…',
  'Parsing hostile dyad relationships…',
  'Aggregating battle death statistics…',
];

function DataLoadingIndicator() {
  const [idx, setIdx]       = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setIdx(i => (i + 1) % FETCH_MESSAGES.length);
        setFading(false);
      }, 300);
    }, 2200);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6">
      {/* Dual counter-rotating rings */}
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

      {/* Title + cycling message */}
      <div className="text-center space-y-2">
        <p className="text-zinc-200 font-mono text-xs font-bold tracking-widest uppercase">
          Loading Actor Network
        </p>
        <p
          className="text-zinc-500 font-mono text-[11px] transition-opacity duration-300 max-w-xs"
          style={{ opacity: fading ? 0 : 1 }}
        >
          {FETCH_MESSAGES[idx]}
        </p>
      </div>

      {/* Shimmer bar */}
      <div className="w-40 h-px bg-zinc-800 rounded-full overflow-hidden">
        <div className="h-full w-1/3 bg-blue-500/60 rounded-full animate-pulse" />
      </div>
    </div>
  );
}

function NetworkConfigPanel({ rawData, onBuild }) {
  const yearMin = rawData.year_min ?? 1946;
  const yearMax = rawData.year_max ?? 2024;

  const [fromYear,  setFromYear]  = useState(Math.max(yearMin, 2015));
  const [toYear,    setToYear]    = useState(yearMax);
  const [minDeaths, setMinDeaths] = useState(500);

  const availableRegions = useMemo(() => {
    const seen = new Set();
    rawData.dyads.forEach(d => {
      const r = normalizeRegion(d.region);
      if (r && r !== 'Unknown') seen.add(r);
    });
    return [...seen].sort();
  }, [rawData.dyads]);

  const [selectedRegions, setSelectedRegions] = useState(() => new Set(availableRegions));

  useEffect(() => {
    setSelectedRegions(new Set(availableRegions));
  }, [availableRegions]);

  const estimate = useMemo(() => {
    const filtered = rawData.dyads.filter(d =>
      d.year >= fromYear &&
      d.year <= toYear &&
      selectedRegions.has(normalizeRegion(d.region))
    );
    const linkMap = new Map();
    filtered.forEach(d => {
      const [kA, kB] = d.side_a < d.side_b
        ? [d.side_a, d.side_b]
        : [d.side_b, d.side_a];
      const key = `${kA}|||${kB}`;
      if (!linkMap.has(key)) linkMap.set(key, { side_a: d.side_a, side_b: d.side_b, bd_best: 0 });
      linkMap.get(key).bd_best += d.bd_best;
    });
    const edges = [...linkMap.values()].filter(l => l.bd_best >= minDeaths);
    const actors = new Set();
    edges.forEach(l => { actors.add(l.side_a); actors.add(l.side_b); });
    return { actors: actors.size, edges: edges.length };
  }, [rawData.dyads, fromYear, toYear, minDeaths, selectedRegions]);

  const toggleRegion = region => {
    setSelectedRegions(prev => {
      const next = new Set(prev);
      next.has(region) ? next.delete(region) : next.add(region);
      return next;
    });
  };

  const allSelected = selectedRegions.size === availableRegions.length;
  const toggleAll   = () => setSelectedRegions(allSelected ? new Set() : new Set(availableRegions));

  const canBuild = estimate.actors > 0 && estimate.edges > 0;

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
              min={yearMin} max={toYear - 1}
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
              min={fromYear + 1} max={yearMax}
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
            {availableRegions.map(region => (
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

        {/* Live estimate */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 flex items-center justify-between">
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
            Estimated network
          </span>
          <div className="flex items-center gap-4 font-mono">
            <span>
              <span className="text-blue-400 text-sm font-bold">{estimate.actors}</span>
              <span className="text-zinc-600 text-[10px] ml-1">actors</span>
            </span>
            <span className="text-zinc-700">·</span>
            <span>
              <span className="text-zinc-300 text-sm font-bold">{estimate.edges}</span>
              <span className="text-zinc-600 text-[10px] ml-1">edges</span>
            </span>
          </div>
        </div>

        {/* Zero-result warning */}
        {!canBuild && (
          <p className="text-[10px] font-mono text-amber-500 text-center">
            No dyads match the current filters — adjust year range, deaths threshold, or regions.
          </p>
        )}

        {/* Build button */}
        <button
          onClick={() => onBuild({ yearRange: [fromYear, toYear], minDeaths, regions: new Set(selectedRegions) })}
          disabled={!canBuild}
          className={`w-full py-2.5 rounded-lg font-mono text-xs uppercase tracking-widest font-bold transition-colors ${
            canBuild
              ? 'bg-blue-500 hover:bg-blue-400 text-white cursor-pointer'
              : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
          }`}
        >
          Build Network ▶
        </button>

        {/* Data source note */}
        <p className="text-[9px] font-mono text-zinc-700 text-center">
          {rawData.total_records?.toLocaleString()} dyad-year records loaded ·{' '}
          {rawData.data_sources?.join(' · ')}
        </p>

      </div>
    </div>
  );
}

export default function ActorNetworkPage() {
  const [rawData,      setRawData]      = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [configured,   setConfigured]   = useState(false);
  const [initYearRange, setInitYearRange] = useState(null);
  const [initMinDeaths, setInitMinDeaths] = useState(500);
  const [initRegions,   setInitRegions]   = useState(null);

  useEffect(() => {
    setLoading(true);
    axios.get(`${API}/actor-network`)
      .then(res => { setRawData(res.data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  const handleBuild = ({ yearRange, minDeaths, regions }) => {
    setInitYearRange(yearRange);
    setInitMinDeaths(minDeaths);
    setInitRegions(regions);
    setConfigured(true);
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

      {/* Graph area */}
      <div className="flex-1 min-h-0">
        {loading ? (
          <DataLoadingIndicator />
        ) : error ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-red-500 font-mono text-sm">Error: {error}</p>
          </div>
        ) : rawData?.dyads?.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-zinc-500 font-mono text-sm">No dyadic records returned by API.</p>
          </div>
        ) : !configured ? (
          <NetworkConfigPanel rawData={rawData} onBuild={handleBuild} />
        ) : (
          <ActorForceGraph
            rawData={rawData}
            initialYearRange={initYearRange}
            initialMinDeaths={initMinDeaths}
            initialRegions={initRegions}
            onReconfigure={() => setConfigured(false)}
          />
        )}
      </div>
    </div>
  );
}
