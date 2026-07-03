import React, { useEffect, useState, useRef } from "react";
import axios from "axios";
import Marquee from "react-fast-marquee";
import { AlertTriangle, Radio, ExternalLink } from "lucide-react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const REFRESH_MS = 15 * 60 * 1000; // 15 minutes — matches backend cache TTL

/**
 * GdeltAlertTicker — scrolling headline feed of the most-negative GDELT
 * articles from tracked conflict zones (tone ≤ -4).
 *
 * Complements the existing NewsTicker (RSS feeds) by surfacing crisis-signal
 * articles with quantified sentiment, refreshed every 15 minutes.
 *
 * Data source: /api/gdelt-alerts
 */

// Tone to colour — GDELT AvgTone scale: strongly negative = red
function toneColor(tone) {
  if (tone <= -8) return "#ef4444"; // red-500 — very hostile
  if (tone <= -6) return "#f97316"; // orange-500
  if (tone <= -4) return "#eab308"; // yellow-500
  return "#71717a";                 // zinc-500
}

function TonePill({ tone }) {
  const color = toneColor(tone);
  return (
    <span
      className="text-[8px] font-mono px-1 py-0.5 border"
      style={{ color, borderColor: color, backgroundColor: `${color}18` }}
    >
      {tone > 0 ? "+" : ""}{tone.toFixed(1)}
    </span>
  );
}

export default function GdeltAlertTicker() {
  const [articles, setArticles] = useState([]);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const res = await axios.get(`${BACKEND_URL}/api/gdelt-alerts`);
      setArticles(res.data.articles || []);
      setFetchedAt(res.data.fetched_at);
    } catch (_) {
      // Silent degradation — ticker disappears if unavailable
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const iv = setInterval(load, REFRESH_MS);
    return () => clearInterval(iv);
  }, []);

  if (loading || articles.length === 0) return null;

  return (
    <div className="bg-zinc-950 border border-zinc-800 border-t-0">
      {/* Label bar */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-zinc-800 bg-zinc-900">
        <AlertTriangle size={10} className="text-red-500 shrink-0" />
        <span className="text-[9px] font-mono uppercase tracking-widest text-red-400 font-bold shrink-0">
          Crisis Signals
        </span>
        <span className="text-[8px] font-mono text-zinc-700 shrink-0">·</span>
        <span className="text-[8px] font-mono text-zinc-700 shrink-0">GDELT tone ≤ −4</span>
        <div className="flex-1" />
        {fetchedAt && (
          <span className="text-[8px] font-mono text-zinc-700 shrink-0">
            updated {new Date(fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>

      {/* Scrolling ticker */}
      <Marquee
        speed={38}
        gradient={false}
        pauseOnHover
        className="py-1.5"
      >
        {articles.map((art, i) => (
          <span key={i} className="flex items-center gap-2 mx-6">
            <TonePill tone={art.tone} />
            <a
              href={art.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-mono text-zinc-300 hover:text-white transition-colors whitespace-nowrap"
            >
              {art.title}
            </a>
            {art.source && (
              <span className="text-[8px] font-mono text-zinc-600 whitespace-nowrap">
                [{art.source}]
              </span>
            )}
            <span className="text-zinc-700 select-none">·</span>
          </span>
        ))}
      </Marquee>
    </div>
  );
}
