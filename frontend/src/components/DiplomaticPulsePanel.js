import React, { useEffect, useState, useCallback, useRef } from "react";
import axios from "axios";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import { Scale, ChevronDown } from "lucide-react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

const GDELT_COUNTRIES = [
  "Ukraine", "Gaza/Palestine", "Sudan", "Myanmar",
  "Syria", "Yemen", "Ethiopia", "DRC (Congo)", "Iran", "Lebanon", "Haiti",
];

/**
 * DiplomaticPulsePanel — 30-day twin-area chart of diplomacy-themed vs.
 * violence-themed article volume, plus a pulse-index gauge derived from the
 * 7-day averages.
 *
 * pulse_index = diplomacy_avg_7d / (diplomacy_avg_7d + violence_avg_7d)
 *   0.0 = all violence coverage
 *   1.0 = all diplomacy coverage
 *   0.5 = balanced
 *
 * Data source: /api/gdelt-diplomacy?country=<name>
 */

function fmtDate(iso) {
  if (!iso) return "";
  const [, , dd] = iso.split("-");
  return dd;
}

const DIPL_COLOR  = "#3b82f6"; // blue-500
const VIOL_COLOR  = "#ef4444"; // red-500

// Semicircular gauge for pulse_index (0..1)
function PulseGauge({ value }) {
  if (value == null) return (
    <div className="text-[9px] font-mono text-zinc-600 text-center py-4">Insufficient data</div>
  );

  const size   = 160;
  const cx     = size / 2;
  const cy     = size * 0.58;
  const radius = size * 0.38;

  // Arc from left (π) to right (0) — top semicircle
  function polarToCart(angleDeg, r) {
    const a = (angleDeg * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  }

  // Background arc: 0° to 180° (left to right, top arc)
  const [bx1, by1] = polarToCart(180, radius);
  const [bx2, by2] = polarToCart(0,   radius);

  // Needle tip position based on value (0 = left = 0°, 1 = right = 180°)
  const needleAngle = value * 180;
  const [nx, ny] = polarToCart(needleAngle, radius * 0.88);

  // Colour interpolates red → yellow → green
  function gaugeColor(v) {
    if (v < 0.3) return VIOL_COLOR;
    if (v < 0.5) return "#f97316";
    if (v < 0.7) return "#eab308";
    return DIPL_COLOR;
  }
  const color = gaugeColor(value);

  // Active arc — from left to needle angle
  const [ax1, ay1] = polarToCart(180, radius);
  const [ax2, ay2] = polarToCart(needleAngle, radius);
  const largeArc = needleAngle < 90 ? 0 : (needleAngle > 180 ? 1 : 0);

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size * 0.65} className="overflow-visible">
        {/* Background track */}
        <path
          d={`M ${bx1} ${by1} A ${radius} ${radius} 0 0 1 ${bx2} ${by2}`}
          fill="none"
          stroke="#27272a"
          strokeWidth={8}
          strokeLinecap="round"
        />

        {/* Active arc */}
        {value > 0 && (
          <path
            d={`M ${ax1} ${ay1} A ${radius} ${radius} 0 ${largeArc} 1 ${ax2} ${ay2}`}
            fill="none"
            stroke={color}
            strokeWidth={8}
            strokeLinecap="round"
          />
        )}

        {/* Needle */}
        <line
          x1={cx} y1={cy}
          x2={nx} y2={ny}
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r={4} fill={color} />

        {/* Labels */}
        <text x={bx1 - 6} y={by1 + 14} fill={VIOL_COLOR} fontSize={7} fontFamily="JetBrains Mono, monospace" textAnchor="middle">
          VIOLENCE
        </text>
        <text x={bx2 + 6} y={by2 + 14} fill={DIPL_COLOR} fontSize={7} fontFamily="JetBrains Mono, monospace" textAnchor="middle">
          DIPLOMACY
        </text>
      </svg>

      {/* Index value */}
      <div className="flex flex-col items-center -mt-2">
        <span className="text-2xl font-mono font-bold tabular-nums" style={{ color }}>
          {(value * 100).toFixed(0)}
        </span>
        <span className="text-[8px] font-mono text-zinc-600 uppercase tracking-wider">
          pulse index
        </span>
        <span className="text-[8px] font-mono mt-0.5" style={{ color }}>
          {value < 0.3 ? "Violence-dominant" :
           value < 0.5 ? "Conflict-leaning" :
           value < 0.7 ? "Mixed signals" :
           "Diplomacy-leaning"}
        </span>
      </div>
    </div>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-900 border border-zinc-700 px-2 py-1.5 text-[9px] font-mono space-y-0.5">
      <div className="text-zinc-500 mb-1">Day {label}</div>
      {payload.map(p => (
        <div key={p.name} style={{ color: p.color }}>
          {p.name}: {Number(p.value).toFixed(1)} art/day
        </div>
      ))}
    </div>
  );
}

export default function DiplomaticPulsePanel() {
  const [country, setCountry] = useState("Ukraine");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const retryRef = useRef(null);

  const load = useCallback(async (c) => {
    setLoading(true);
    setError(null);
    setData(null);
    if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
    try {
      const res = await axios.get(`${BACKEND_URL}/api/gdelt-diplomacy`, {
        params: { country: c },
      });
      setData(res.data);
      if (res.data?.pending) {
        retryRef.current = setTimeout(() => load(c), 30_000);
      }
    } catch {
      setError("GDELT diplomacy data unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(country);
    return () => { if (retryRef.current) clearTimeout(retryRef.current); };
  }, [country, load]);

  // Build chart data
  const chartData = data
    ? (data.dates || []).map((d, i) => ({
        date: fmtDate(d),
        diplomacy: data.diplomacy?.[i] ?? 0,
        violence:  data.violence?.[i]  ?? 0,
      }))
    : [];

  return (
    <section className="bg-zinc-900 border border-zinc-800 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-zinc-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Scale size={13} className="text-blue-400" />
            <h3 className="text-[10px] font-mono uppercase tracking-widest text-zinc-400 font-bold">
              Diplomatic Pulse
            </h3>
          </div>
          <p className="text-[9px] font-mono text-zinc-700 mt-0.5">
            30-day GDELT theme volume · diplomacy vs. violence
          </p>
        </div>
        {/* Country selector */}
        <div className="relative">
          <select
            value={country}
            onChange={e => setCountry(e.target.value)}
            className="appearance-none bg-zinc-800 border border-zinc-700 text-zinc-300 text-[9px] font-mono px-2 py-1 pr-6 focus:outline-none focus:border-zinc-500 cursor-pointer"
          >
            {GDELT_COUNTRIES.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-3 text-zinc-600 font-mono text-xs py-8 justify-center">
          <div className="w-4 h-4 border border-zinc-700 border-t-red-500 rounded-full animate-spin" />
          Querying GDELT themes…
        </div>
      )}

      {!loading && data?.pending && (
        <div className="text-[9px] font-mono text-zinc-600 text-center py-8 space-y-1">
          <div className="w-4 h-4 border border-zinc-700 border-t-yellow-500 rounded-full animate-spin mx-auto mb-3" />
          <p>Cache warming up — retrying in 30s</p>
          <p className="text-zinc-700">GDELT theme queries run in the background on first load</p>
        </div>
      )}

      {error && !loading && (
        <p className="text-[9px] font-mono text-zinc-600 text-center py-8">{error}</p>
      )}

      {!loading && !error && data && !data.pending && (
        <div className="space-y-5">
          {/* Source + timestamp */}
          <div className="flex items-center justify-between">
            <div className="flex gap-3 text-[8px] font-mono">
              <span className="text-zinc-600 uppercase tracking-wider">
                Diplomacy themes: {(data.diplomacy_themes || []).join(" · ")}
              </span>
            </div>
            {data.fetched_at && (
              <span className="text-[8px] font-mono text-zinc-700">
                {new Date(data.fetched_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>

          {/* Gauge + 7-day stats side by side */}
          <div className="flex items-center justify-around gap-4">
            <PulseGauge value={data.pulse_index} />
            <div className="space-y-3 text-right">
              <div>
                <div className="text-[8px] font-mono uppercase tracking-wider" style={{ color: DIPL_COLOR }}>
                  Diplomacy 7d avg
                </div>
                <div className="text-xl font-mono font-bold tabular-nums" style={{ color: DIPL_COLOR }}>
                  {(data.avg_dipl_7d ?? 0).toFixed(1)}
                </div>
                <div className="text-[8px] font-mono text-zinc-600">articles/day</div>
              </div>
              <div>
                <div className="text-[8px] font-mono uppercase tracking-wider" style={{ color: VIOL_COLOR }}>
                  Violence 7d avg
                </div>
                <div className="text-xl font-mono font-bold tabular-nums" style={{ color: VIOL_COLOR }}>
                  {(data.avg_viol_7d ?? 0).toFixed(1)}
                </div>
                <div className="text-[8px] font-mono text-zinc-600">articles/day</div>
              </div>
            </div>
          </div>

          {/* Twin area chart */}
          {chartData.length > 0 && (
            <div>
              <div className="text-[8px] font-mono text-zinc-600 uppercase tracking-wider mb-2">
                30-day timeline
              </div>
              <ResponsiveContainer width="100%" height={130}>
                <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "#52525b", fontSize: 7, fontFamily: "JetBrains Mono, monospace" }}
                    tickLine={false}
                    axisLine={false}
                    interval={6}
                  />
                  <YAxis
                    tick={{ fill: "#52525b", fontSize: 7, fontFamily: "JetBrains Mono, monospace" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="violence"
                    name="Violence"
                    fill={`${VIOL_COLOR}22`}
                    stroke={VIOL_COLOR}
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="diplomacy"
                    name="Diplomacy"
                    fill={`${DIPL_COLOR}22`}
                    stroke={DIPL_COLOR}
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
              <div className="flex gap-4 justify-end text-[8px] font-mono mt-1">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-0.5" style={{ backgroundColor: VIOL_COLOR }} />
                  <span className="text-zinc-600">Violence</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-0.5" style={{ backgroundColor: DIPL_COLOR }} />
                  <span className="text-zinc-600">Diplomacy</span>
                </div>
              </div>
            </div>
          )}

          <p className="text-[8px] font-mono text-zinc-700">
            Violence themes: {(data.violence_themes || []).join(" · ")} · Source: GDELT DOC 2.0
          </p>
        </div>
      )}
    </section>
  );
}
