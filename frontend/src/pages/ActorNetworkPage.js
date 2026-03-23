import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Header from '../components/Header';
import ActorForceGraph from '../components/ActorForceGraph';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

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
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-8 h-8 border-2 border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
            <p className="text-zinc-500 font-mono text-xs animate-pulse">
              Loading actor network — fetching UCDP dyadic &amp; non-state datasets…
            </p>
          </div>
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
