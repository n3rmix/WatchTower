import React, { useEffect, useState } from "react";
import axios from "axios";
import { Eye, EyeOff, TrendingDown, TrendingUp, Minus } from "lucide-react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

/**
 * ForgottenCrisesPanel — surfaces under-reported conflicts by cross-referencing
 * GDELT media volume against UCDP/ACLED death tolls.
 *
 * attention_ratio = avg_volume_7d / (total_deaths / 1000)
 * A low ratio = high deaths, low media attention = "forgotten".
 *
 * Data source: /api/forgotten-crises
 */

function fmt(n) {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function VolumeTrend({ delta }) {
  if (delta == null) return <Minus size={11} className="text-zinc-600" />;
  if (delta >= 15) return <TrendingUp size={11} className="text-orange-400" />;
  if (delta <= -15) return <TrendingDown size={11} className="text-blue-400" />;
  return <Minus size={11} className="text-zinc-500" />;
}

// Colour band for attention ratio — lower = more "forgotten"
function attentionColor(ratio) {
  if (ratio == null) return "#52525b"; // zinc-600
  if (ratio < 0.5) return "#ef4444";  // red — very forgotten
  if (ratio < 2.0) return "#f97316";  // orange — under-reported
  if (ratio < 5.0) return "#eab308";  // yellow — moderate
  return "#22c55e";                   // green — well-covered
}

function attentionLabel(ratio) {
  if (ratio == null) return "Unknown";
  if (ratio < 0.5) return "Critically under-reported";
  if (ratio < 2.0) return "Under-reported";
  if (ratio < 5.0) return "Moderate coverage";
  return "Well covered";
}

export default function ForgottenCrisesPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const res = await axios.get(`${BACKEND_URL}/api/forgotten-crises`);
        if (!cancelled) {
          setData(res.data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError("GDELT unavailable");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="bg-zinc-900 border border-zinc-800 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-zinc-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <EyeOff size={13} className="text-zinc-500" />
            <h3 className="text-[10px] font-mono uppercase tracking-widest text-zinc-400 font-bold">
              Forgotten Crises
            </h3>
          </div>
          <p className="text-[9px] font-mono text-zinc-700 mt-0.5">
            Deaths vs. media attention ratio · lower = more under-reported
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[8px] font-mono text-zinc-600 uppercase tracking-wider">
            GDELT DOC 2.0 · UCDP/ACLED
          </span>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-3 text-zinc-600 font-mono text-xs py-6 justify-center">
          <div className="w-4 h-4 border border-zinc-700 border-t-red-500 rounded-full animate-spin" />
          Loading attention data…
        </div>
      )}

      {error && !loading && (
        <p className="text-[9px] font-mono text-zinc-600 text-center py-6">{error}</p>
      )}

      {!loading && !error && data && (
        <div className="space-y-2">
          {data.conflicts.map((c, i) => {
            const ratio = c.attention_ratio;
            const color = attentionColor(ratio);
            const label = attentionLabel(ratio);
            const barWidth = ratio != null
              ? Math.min(100, (ratio / 10) * 100)
              : 0;

            return (
              <div key={c.country} className="space-y-1">
                {/* Row header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-mono text-zinc-600 w-4 text-right">{i + 1}</span>
                    <span className="text-[10px] font-mono text-zinc-300">{c.country}</span>
                    <VolumeTrend delta={c.volume_delta_pct} />
                  </div>
                  <div className="flex items-center gap-3 text-[9px] font-mono text-zinc-600">
                    <span title="Total deaths">{fmt(c.total_deaths)} deaths</span>
                    <span title="Avg daily articles (7d)">{(c.avg_volume_7d || 0).toFixed(1)} art/day</span>
                    <span style={{ color }} title={label}>
                      {ratio != null ? ratio.toFixed(2) : "—"}
                    </span>
                  </div>
                </div>

                {/* Attention bar */}
                <div className="relative h-1 bg-zinc-800">
                  <div
                    className="absolute left-0 top-0 h-full transition-all duration-700"
                    style={{ width: `${barWidth}%`, backgroundColor: color }}
                  />
                </div>

                {/* Label */}
                <div className="flex items-center justify-between">
                  <span className="text-[8px] font-mono" style={{ color }}>
                    {label}
                  </span>
                  {c.avg_tone_7d != null && (
                    <span className="text-[8px] font-mono text-zinc-700">
                      tone {c.avg_tone_7d > 0 ? "+" : ""}{c.avg_tone_7d.toFixed(1)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      {!loading && !error && data && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-2 border-t border-zinc-800">
          {[
            { color: "#ef4444", label: "< 0.5  Critically under-reported" },
            { color: "#f97316", label: "0.5–2  Under-reported" },
            { color: "#eab308", label: "2–5  Moderate" },
            { color: "#22c55e", label: "> 5  Well covered" },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-[8px] font-mono text-zinc-600">{label}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
