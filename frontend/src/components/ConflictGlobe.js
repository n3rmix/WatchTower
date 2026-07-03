import { useEffect, useRef, useState } from "react";
import axios from "axios";
import createGlobe from "cobe";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

// Baseline markers — used as the fallback when GDELT is unavailable and as
// the anchor coordinates that GDELT intensity is applied on top of.
const BASE_MARKERS = [
  { country: "Ukraine",        location: [49.0,   31.0],  size: 0.08 },
  { country: "Gaza/Palestine", location: [31.5,   34.5],  size: 0.09 },
  { country: "Sudan",          location: [15.5,   32.5],  size: 0.07 },
  { country: "Myanmar",        location: [17.0,   96.0],  size: 0.07 },
  { country: "Syria",          location: [35.0,   38.0],  size: 0.07 },
  { country: "Yemen",          location: [15.5,   48.0],  size: 0.07 },
  { country: "Ethiopia",       location: [ 9.0,   40.0],  size: 0.07 },
  { country: "DRC (Congo)",    location: [-4.0,   21.5],  size: 0.07 },
  { country: "Iran",           location: [32.0,   53.0],  size: 0.07 },
  { country: "Lebanon",        location: [33.9,   35.5],  size: 0.07 },
  { country: "Haiti",          location: [18.9,  -72.3],  size: 0.06 },
];

// Merge live GDELT marker intensity onto baseline anchors. GDELT intensity is
// a 0..1 normalised weekly volume; we scale each baseline marker size by
// (0.6 + 0.9 * intensity) so quiet conflicts stay visible and hot ones flare.
function buildLiveMarkers(base, gdeltMarkers) {
  if (!gdeltMarkers || !gdeltMarkers.length) return base;
  const byCountry = Object.fromEntries(gdeltMarkers.map(m => [m.country, m]));
  return base.map(b => {
    const g = byCountry[b.country];
    if (!g) return b;
    const scale = 0.6 + 0.9 * (g.intensity ?? 0);
    return { ...b, size: b.size * scale };
  });
}

const ConflictGlobe = () => {
  const canvasRef = useRef(null);
  const globeRef = useRef(null);
  const rafRef = useRef(null);
  const phiRef = useRef(0);
  const frameRef = useRef(0);
  const markersRef = useRef(BASE_MARKERS);
  const [loaded, setLoaded] = useState(false);
  const [liveActive, setLiveActive] = useState(false);

  // Pull live GDELT marker density once on mount and refresh hourly.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await axios.get(`${BACKEND_URL}/api/live-events`);
        if (cancelled) return;
        if (res.data?.markers?.length) {
          markersRef.current = buildLiveMarkers(BASE_MARKERS, res.data.markers);
          setLiveActive(true);
        }
      } catch {
        // Non-fatal — keep baseline markers on failure.
      }
    };
    load();
    const id = setInterval(load, 3_600_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const SIZE = 350;

    globeRef.current = createGlobe(canvas, {
      devicePixelRatio: 2,
      width: SIZE * 2,
      height: SIZE * 2,
      phi: 0,
      theta: 0.3,
      dark: 1,
      diffuse: 1.2,
      mapSamples: 16000,
      mapBrightness: 4,
      baseColor: [0.05, 0.05, 0.08],
      markerColor: [1, 0.18, 0.18],
      glowColor: [0.6, 0.06, 0.06],
      markers: markersRef.current,
    });

    setLoaded(true);

    function animate() {
      frameRef.current += 1;
      phiRef.current += 0.003;
      const pulse = 1 + 0.35 * Math.sin(frameRef.current * 0.06);
      globeRef.current?.update({
        phi: phiRef.current,
        markers: markersRef.current.map((m) => ({ ...m, size: m.size * pulse })),
      });
      rafRef.current = requestAnimationFrame(animate);
    }

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafRef.current);
      globeRef.current?.destroy();
    };
  }, []);

  return (
    <div
      className="flex flex-col items-center justify-center"
      data-testid="conflict-globe"
    >
      <div className="relative" style={{ width: 350, height: 350 }}>
        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            background:
              "radial-gradient(circle at 50% 60%, rgba(220,38,38,0.18) 0%, transparent 70%)",
          }}
        />
        <canvas
          ref={canvasRef}
          style={{
            width: 350,
            height: 350,
            opacity: loaded ? 1 : 0,
            transition: "opacity 0.8s ease",
          }}
        />
      </div>
      <p className="text-xs text-zinc-600 font-mono uppercase tracking-widest mt-1">
        Active Conflict Regions
        {liveActive && (
          <span className="ml-2 text-[9px] text-orange-500/80">· GDELT weighted</span>
        )}
      </p>
    </div>
  );
};

export default ConflictGlobe;
