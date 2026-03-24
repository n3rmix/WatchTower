import React, { useState } from 'react';
import axios from 'axios';
import Header from '../components/Header';
import LifelineChart from '../components/LifelineChart';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const CONFLICTS = [
  'Ukraine', 'Gaza', 'Sudan', 'Myanmar',
  'Syria', 'Yemen', 'Ethiopia', 'DRC', 'Iran',
];

const SEGMENTS = [
  { key: 'overall',          label: 'General Population', color: '#3b82f6' },
  { key: 'children_under_5', label: 'Children Under 5',   color: '#fbbf24' },
  { key: 'medical_staff',    label: 'Medical Staff',       color: '#22c55e' },
  { key: 'teachers',         label: 'Teachers',            color: '#f97316' },
];

const CURRENT_YEAR = 2024;

// ── Configure panel ────────────────────────────────────────────────────────────
function ConfigurePanel({ onBuild }) {
  const [conflict,    setConflict]    = useState('Ukraine');
  const [cohortBirth, setCohortBirth] = useState(2000);

  return (
    <div className="flex flex-col items-center justify-center h-full bg-zinc-950 p-8">
      <div className="w-full max-w-md bg-zinc-900/60 border border-zinc-800 rounded-xl p-6 space-y-6">

        <div>
          <h3 className="text-sm font-bold font-mono uppercase tracking-widest text-zinc-100">
            Configure Lifeline
          </h3>
          <p className="text-[10px] font-mono text-zinc-500 mt-1">
            Select a conflict and the birth year of the cohort to trace
          </p>
        </div>

        {/* Conflict selector */}
        <div className="space-y-2">
          <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Conflict</p>
          <div className="flex flex-wrap gap-2">
            {CONFLICTS.map(c => (
              <button
                key={c}
                onClick={() => setConflict(c)}
                className={`px-3 py-1.5 rounded border font-mono text-[11px] transition-colors ${
                  conflict === c
                    ? 'border-blue-500/60 bg-blue-500/10 text-zinc-100'
                    : 'border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Cohort birth year */}
        <div className="space-y-2">
          <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            Cohort birth year
          </p>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1944} max={CURRENT_YEAR - 5}
              value={cohortBirth}
              onChange={e => setCohortBirth(+e.target.value)}
              className="flex-1 accent-blue-500"
            />
            <span className="text-zinc-300 font-mono text-sm w-14 text-right">
              {cohortBirth}
            </span>
          </div>
          <p className="text-[10px] font-mono text-zinc-600">
            This cohort is age {CURRENT_YEAR - cohortBirth} in {CURRENT_YEAR}
          </p>
        </div>

        <button
          onClick={() => onBuild({ conflict, cohortBirth })}
          className="w-full py-2.5 rounded-lg font-mono text-xs uppercase tracking-widest font-bold bg-blue-500 hover:bg-blue-400 text-white transition-colors"
        >
          Explore Lifelines ▶
        </button>

        <p className="text-[9px] font-mono text-zinc-700 text-center">
          Baseline: WHO Life Tables 2024 · Conflict data: UCDP / ACLED · Estimates only
        </p>

      </div>
    </div>
  );
}

// ── Loading spinner ────────────────────────────────────────────────────────────
function LoadingIndicator() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-5">
      <div className="relative w-10 h-10">
        <div className="absolute inset-0 rounded-full border-2 border-zinc-800" />
        <div
          className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-500 animate-spin"
          style={{ animationDuration: '0.9s' }}
        />
      </div>
      <p className="text-zinc-500 font-mono text-xs animate-pulse">
        Computing life trajectories…
      </p>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function LifeTrajectoryPage() {
  const [buildConfig,     setBuildConfig]     = useState(null);
  const [data,            setData]            = useState(null);
  const [loading,         setLoading]         = useState(false);
  const [error,           setError]           = useState(null);
  const [activeSegment,   setActiveSegment]   = useState('overall');

  const handleBuild = ({ conflict, cohortBirth }) => {
    setBuildConfig({ conflict, cohortBirth });
    setData(null);
    setError(null);
    setLoading(true);
    setActiveSegment('overall');
    axios.get(`${API}/lifelines`, { params: { conflict, cohort_birth: cohortBirth } })
      .then(res => { setData(res.data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  };

  const handleReconfigure = () => {
    setBuildConfig(null);
    setData(null);
    setError(null);
  };

  const seg = data?.segments?.[activeSegment];

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      <Header />

      {/* Page title strip */}
      <div className="px-6 py-3 border-b border-zinc-800 bg-zinc-950/80 flex-shrink-0">
        <h2 className="text-sm font-bold font-mono uppercase tracking-widest text-zinc-100">
          Interrupted Lifelines
        </h2>
        <p className="text-[10px] font-mono text-zinc-500 mt-0.5">
          Life trajectory breaks · how conflict cuts through normal life courses · survival probability by age cohort
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0">
        {!buildConfig ? (
          <ConfigurePanel onBuild={handleBuild} />
        ) : loading ? (
          <LoadingIndicator />
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <p className="text-red-500 font-mono text-sm">Error: {error}</p>
            <button onClick={handleReconfigure} className="text-[10px] font-mono text-blue-500 border border-zinc-700 px-3 py-1.5 rounded hover:border-zinc-500">
              ← Reconfigure
            </button>
          </div>
        ) : data ? (
          <div className="flex flex-col h-full">

            {/* Stats strip */}
            <div className="flex items-center gap-6 px-5 py-2.5 bg-zinc-900/50 border-b border-zinc-800 flex-wrap text-xs font-mono flex-shrink-0">

              <button
                onClick={handleReconfigure}
                className="flex items-center gap-1 px-2 py-1 rounded border border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300 text-[10px] uppercase tracking-wider transition-colors"
              >
                ← Reconfigure
              </button>

              <div className="flex items-center gap-1.5">
                <span className="text-zinc-600 uppercase tracking-wider text-[10px]">Conflict</span>
                <span className="text-zinc-200">{data.conflict}</span>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-zinc-600 uppercase tracking-wider text-[10px]">Cohort born</span>
                <span className="text-zinc-200">{data.cohort_birth}</span>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-zinc-600 uppercase tracking-wider text-[10px]">Conflict hit at age</span>
                <span className="text-red-400 font-bold">{data.conflict_start_age}</span>
              </div>

              {seg && (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="text-zinc-600 uppercase tracking-wider text-[10px]">Expected survival</span>
                    <span className="text-zinc-200">
                      {(seg.baseline_curve[80] * 100).toFixed(1)}% to age 80
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-zinc-600 uppercase tracking-wider text-[10px]">Conflict-adjusted</span>
                    <span style={{ color: seg.color }}>
                      {(seg.conflict_curve[80] * 100).toFixed(1)}% to age 80
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-zinc-600 uppercase tracking-wider text-[10px]">Life-years lost</span>
                    <span className="text-red-400 font-bold">{seg.years_lost} yrs / person</span>
                  </div>
                </>
              )}
            </div>

            {/* Segment chips */}
            <div className="flex items-center gap-2 px-5 py-2 border-b border-zinc-800 bg-zinc-950/60 flex-shrink-0 flex-wrap">
              <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-wider mr-1">Segment</span>
              {SEGMENTS.map(s => {
                const segData = data.segments?.[s.key];
                const isActive = activeSegment === s.key;
                return (
                  <button
                    key={s.key}
                    onClick={() => setActiveSegment(s.key)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full border font-mono text-[11px] transition-colors ${
                      isActive
                        ? 'text-zinc-100 border-transparent'
                        : 'border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300'
                    }`}
                    style={isActive ? { background: `${s.color}22`, borderColor: `${s.color}66` } : {}}
                  >
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: s.color }}
                    />
                    {s.label}
                    {segData && (
                      <span className="text-[10px] ml-1" style={{ color: isActive ? s.color : '#71717a' }}>
                        −{segData.years_lost}y
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Chart */}
            <div className="flex-1 min-h-0 px-4 pt-4 pb-2">
              <LifelineChart data={data} activeSegment={activeSegment} />
            </div>

            {/* Data notes footer */}
            <div className="px-5 py-2 border-t border-zinc-800 bg-zinc-950/60 flex-shrink-0">
              <p className="text-[9px] font-mono text-zinc-700 leading-relaxed">
                <span className="text-zinc-600">Sources: </span>
                {data.sources?.join(' · ')}
                {' · '}
                <span className="text-zinc-700 italic">{data.data_notes}</span>
              </p>
            </div>

          </div>
        ) : null}
      </div>
    </div>
  );
}
