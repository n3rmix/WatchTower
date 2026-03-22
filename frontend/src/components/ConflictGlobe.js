import { useEffect, useRef, useState } from "react";
import createGlobe from "cobe";

const BASE_MARKERS = [
  { location: [49.0, 31.0],  size: 0.08 }, // Ukraine
  { location: [31.5, 34.5],  size: 0.09 }, // Gaza/Palestine
  { location: [15.5, 32.5],  size: 0.07 }, // Sudan
  { location: [17.0, 96.0],  size: 0.07 }, // Myanmar
  { location: [35.0, 38.0],  size: 0.07 }, // Syria
  { location: [15.5, 48.0],  size: 0.07 }, // Yemen
  { location: [9.0,  40.0],  size: 0.07 }, // Ethiopia
  { location: [-4.0, 21.5],  size: 0.07 }, // DRC (Congo)
  { location: [32.0, 53.0],  size: 0.07 }, // Iran
];

const ConflictGlobe = () => {
  const canvasRef = useRef(null);
  const globeRef = useRef(null);
  const rafRef = useRef(null);
  const phiRef = useRef(0);
  const frameRef = useRef(0);
  const [loaded, setLoaded] = useState(false);

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
      markers: BASE_MARKERS,
    });

    setLoaded(true);

    function animate() {
      frameRef.current += 1;
      phiRef.current += 0.003;
      const pulse = 1 + 0.35 * Math.sin(frameRef.current * 0.06);
      globeRef.current?.update({
        phi: phiRef.current,
        markers: BASE_MARKERS.map((m) => ({ ...m, size: m.size * pulse })),
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
      </p>
    </div>
  );
};

export default ConflictGlobe;
