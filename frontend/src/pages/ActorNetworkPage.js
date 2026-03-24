import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Header from '../components/Header';
import ActorForceGraph from '../components/ActorForceGraph';

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

export default function ActorNetworkPage() {
  const [rawData, setRawData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    setLoading(true);
    axios.get(`${API}/actor-network`)
      .then(res => { setRawData(res.data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

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
        ) : (
          <ActorForceGraph rawData={rawData} />
        )}
      </div>
    </div>
  );
}
