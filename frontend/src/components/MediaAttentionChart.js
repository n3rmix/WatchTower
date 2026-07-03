import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { TrendingUp, TrendingDown, Radio } from "lucide-react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

/**
 * MediaAttentionChart — 30-day GDELT DOC 2.0 timeline of
 * article volume (bars/area) + average tone (line) per conflict.
 *
 * Data source: /api/gdelt-timeline?country=<name>
 * Tone scale: GDELT AvgTone runs roughly –10 (very negative) to +10.
 */

// Countries served by the backend GDELT fetcher.
const GDELT_COUNTRIES = [
  "Ukraine",
  "Gaza/Palestine",
  "Sudan",
  "Myanmar",
  "Syria",
  "Yemen",
  "Ethiopia",
  "DRC (Congo)",
  "Iran",
  "Lebanon",
  "Haiti",
];

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function ToneDeltaBadge({ toneDelta }) {
  if (toneDelta == null) return null;
  // Negative tone delta = worsening coverage = escalation signal (red)
  // Positive = de-escalation (green)
  const worsening = toneDelta < 0;
  const color = worsening ? "text-red-400 border-red-900 bg-red-950/40" : "text-emerald-400 border-emerald-900 bg-emerald-950/40";
  const Icon = worsening ? TrendingDown : TrendingUp;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[9px] font-mono uppercase tracking-widest border ${color}`}>
      <Icon className="w-2.5 h-2.5" />
      tone {toneDelta > 0 ? "+" : ""}{toneDelta.toFixed(2)}
    </span>
  );
}

function VolumeDeltaBadge({ volumeDelta }) {
  if (volumeDelta == null) return null;
  const rising = volumeDelta > 0;
  const color = rising ? "text-orange-400 border-orange-900 bg-orange-950/40" : "text-zinc-500 border-zinc-800 bg-zinc-900/40";
  const Icon = rising ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[9px] font-mono uppercase tracking-widest border ${color}`}>
      <Icon className="w-2.5 h-2.5" />
      vol {volumeDelta > 0 ? "+" : ""}{volumeDelta.toFixed(0)}%
    </span>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null;
  const vol = payload.find(p => p.dataKey === "volume")?.value;
  const tone = payload.find(p => p.dataKey === "tone")?.value;
  return (
    <div className="bg-zinc-950 border border-zinc-700 px-2 py-1 text-[10px] font-mono">
      <p className="text-zinc-400">{fmtDate(label)}</p>
      {vol != null && (
        <p className="text-orange-400">volume: {vol.toFixed(3)}</p>
      )}
      {tone != null && (
        <p className={tone < 0 ? "text-red-400" : "text-emerald-400"}>
          tone: {tone.toFixed(2)}
        </p>
      )}
    </div>
  );
};

export default function MediaAttentionChart() {
  const [country, setCountry] = useState("Ukraine");
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    axios
      .get(`${BACKEND_URL}/api/gdelt-timeline`, { params: { country } })
      .then(res => {
        if (cancelled) return;
        setPayload(res.data);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err.response?.status === 404 ? "No GDELT data yet — first fetch pending." : "GDELT unavailable");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [country]);

  const chartData = payload?.dates?.map((d, i) => ({
    date:   d,
    volume: payload.volume?.[i] ?? 0,
    tone:   payload.tone?.[i]   ?? 0,
  })) ?? [];

  return (
    <section className="bg-zinc-900 border border-zinc-800 p-5 space-y-4" data-testid="media-attention-chart">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-zinc-800 pb-3 gap-4 flex-wrap">
        <div>
          <h3 className="text-[10px] font-mono uppercase tracking-widest text-zinc-400 font-bold flex items-center gap-2">
            <Radio className="w-3 h-3" />
            Media Attention & Tone
          </h3>
          <p className="text-[9px] font-mono text-zinc-700 mt-0.5">
            30-day article volume · average sentiment · GDELT DOC 2.0
          </p>
        </div>

        {/* Country selector */}
        <select
          className="bg-zinc-950 border border-zinc-700 text-zinc-200 text-[10px] font-mono uppercase tracking-wider px-2 py-1 focus:outline-none focus:border-red-700"
          value={country}
          onChange={e => setCountry(e.target.value)}
          data-testid="media-attention-country"
        >
          {GDELT_COUNTRIES.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {/* Delta badges */}
      {payload && (
        <div className="flex items-center gap-2 flex-wrap">
          <VolumeDeltaBadge volumeDelta={payload.volume_delta_pct} />
          <ToneDeltaBadge toneDelta={payload.tone_delta} />
          <span className="text-[9px] font-mono text-zinc-600">
            7d avg vol {payload.avg_volume_7d?.toFixed(3)} · tone {payload.avg_tone_7d?.toFixed(2)}
          </span>
        </div>
      )}

      {/* Chart */}
      <div className="h-52 -ml-3">
        {loading && (
          <div className="h-full flex items-center justify-center text-zinc-600 font-mono text-[10px]">
            Loading GDELT timeline…
          </div>
        )}
        {!loading && error && (
          <div className="h-full flex items-center justify-center text-zinc-600 font-mono text-[10px]">
            {error}
          </div>
        )}
        {!loading && !error && chartData.length > 0 && (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="volFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#fb923c" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="#fb923c" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickFormatter={fmtDate}
                tick={{ fill: "#52525b", fontSize: 9, fontFamily: "JetBrains Mono, monospace" }}
                axisLine={{ stroke: "#27272a" }}
                tickLine={{ stroke: "#27272a" }}
                minTickGap={30}
              />
              <YAxis
                yAxisId="vol"
                tick={{ fill: "#52525b", fontSize: 9, fontFamily: "JetBrains Mono, monospace" }}
                axisLine={{ stroke: "#27272a" }}
                tickLine={{ stroke: "#27272a" }}
                width={40}
              />
              <YAxis
                yAxisId="tone"
                orientation="right"
                domain={[-10, 10]}
                tick={{ fill: "#52525b", fontSize: 9, fontFamily: "JetBrains Mono, monospace" }}
                axisLine={{ stroke: "#27272a" }}
                tickLine={{ stroke: "#27272a" }}
                width={30}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: "#3f3f46", strokeDasharray: "3 3" }} />
              <ReferenceLine y={0} yAxisId="tone" stroke="#3f3f46" strokeDasharray="2 2" />
              <Area
                yAxisId="vol"
                type="monotone"
                dataKey="volume"
                stroke="#fb923c"
                strokeWidth={1.5}
                fill="url(#volFill)"
                isAnimationActive={false}
              />
              <Line
                yAxisId="tone"
                type="monotone"
                dataKey="tone"
                stroke="#f87171"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Attribution */}
      <p className="text-[9px] font-mono text-zinc-700 border-t border-zinc-800 pt-2">
        Volume = daily article count normalised by GDELT. Tone = article-averaged sentiment (–10 negative → +10 positive).
        Media-signal only — not a casualty source.
      </p>
    </section>
  );
}
