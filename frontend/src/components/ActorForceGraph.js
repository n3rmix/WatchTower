import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { normalizeRegion } from '../utils/regionUtils';

// ── Actor type palette ────────────────────────────────────────────────────────
const TYPE_COLORS = {
  government:           '#3b82f6',   // blue
  rebel:                '#ef4444',   // red
  militia:              '#f97316',   // orange
  jihadist:             '#7c3aed',   // purple
  'civilian-targeting': '#fbbf24',   // amber
  other:                '#6b7280',   // slate
};

const TYPE_LABELS = {
  government:           'State / Govt',
  rebel:                'Rebel / Opposition',
  militia:              'Militia / Paramilitary',
  jihadist:             'Extremist / Jihadist',
  'civilian-targeting': 'Civilian-Targeting',
  other:                'Other / Unknown',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const nodeColor  = t => TYPE_COLORS[t] ?? TYPE_COLORS.other;
const edgeColor  = t => TYPE_COLORS[t] ?? TYPE_COLORS.other;
const nodeRadius = (n, maxBD) =>
  Math.max(6, Math.min(38, Math.sqrt(n.total_bd / Math.max(maxBD, 1)) * 38));
const edgeWidth  = l =>
  Math.max(0.8, Math.log10((l.bd_best || 1) + 1) * 2.8);

// ─────────────────────────────────────────────────────────────────────────────
export default function ActorForceGraph({
  rawData,
  initialYearRange,
  initialMinDeaths,
  initialRegions,
  onReconfigure,
}) {
  const containerRef  = useRef(null);
  const simulationRef = useRef(null);

  const [yearRange, setYearRange] = useState(
    () => initialYearRange ?? [Math.max(rawData?.year_min ?? 1946, 2015), rawData?.year_max ?? 2024]
  );
  const [minDeaths, setMinDeaths] = useState(() => initialMinDeaths ?? 500);
  const [regions,   setRegions]   = useState(() => initialRegions ?? null);
  const [hovered,   setHovered]   = useState(null);
  const [simAlpha,  setSimAlpha]  = useState(1);

  // ── Main D3 effect ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!rawData || !yearRange || !containerRef.current) return;

    const container = containerRef.current;
    const width     = container.clientWidth  || 800;
    const height    = container.clientHeight || 600;

    // Stop & clear previous render
    if (simulationRef.current) simulationRef.current.stop();
    d3.select(container).selectAll('svg').remove();
    setSimAlpha(1);

    // ── Filter & aggregate dyads ──────────────────────────────────────────────
    const [yrA, yrB] = yearRange;
    const filtered = rawData.dyads.filter(d => {
      const inYear   = d.year >= yrA && d.year <= yrB;
      const inRegion = !regions || regions.size === 0
        ? true
        : regions.has(normalizeRegion(d.region));
      return inYear && inRegion;
    });

    // Aggregate per undirected actor pair, keeping directional info from first appearance
    const linkMap = new Map();
    filtered.forEach(d => {
      // Canonical key: sorted so A-B and B-A collapse to the same edge
      const [kA, kB] = d.side_a < d.side_b
        ? [d.side_a, d.side_b]
        : [d.side_b, d.side_a];
      const key = `${kA}|||${kB}`;

      if (!linkMap.has(key)) {
        linkMap.set(key, {
          source:       d.side_a,
          target:       d.side_b,
          source_type:  d.side_a_type,
          target_type:  d.side_b_type,
          bd_best:      0,
          years:        new Set(),
          conflicts:    new Set(),
        });
      }
      const lnk = linkMap.get(key);
      lnk.bd_best += d.bd_best;
      lnk.years.add(d.year);
      if (d.conflict_name) lnk.conflicts.add(d.conflict_name);
    });

    const links = Array.from(linkMap.values())
      .filter(l => l.bd_best >= minDeaths)
      .map(l => ({ ...l, years: [...l.years].sort(), conflicts: [...l.conflicts] }));

    if (links.length === 0) return;

    // ── Build node set ────────────────────────────────────────────────────────
    const nodeMap = new Map();
    links.forEach(l => {
      [[l.source, l.source_type], [l.target, l.target_type]].forEach(([id, type]) => {
        if (!nodeMap.has(id))
          nodeMap.set(id, { id, type, total_bd: 0, link_count: 0 });
        const n = nodeMap.get(id);
        n.total_bd   += l.bd_best;
        n.link_count += 1;
      });
    });
    const nodes  = [...nodeMap.values()];
    const maxBD  = Math.max(...nodes.map(n => n.total_bd), 1);

    // ── SVG scaffold ──────────────────────────────────────────────────────────
    const svg = d3.select(container)
      .append('svg')
      .attr('width',  width)
      .attr('height', height)
      .style('background', 'transparent');

    // Arrow markers — one per actor type for edge coloring
    const defs = svg.append('defs');
    Object.entries(TYPE_COLORS).forEach(([type, color]) => {
      defs.append('marker')
        .attr('id',          `arr-${type}`)
        .attr('markerWidth',  7)
        .attr('markerHeight', 5)
        .attr('refX',         7)
        .attr('refY',         2.5)
        .attr('orient',       'auto')
        .append('polygon')
        .attr('points', '0 0, 7 2.5, 0 5')
        .attr('fill',    color)
        .attr('opacity', 0.75);
    });

    // Zoomable group
    const g = svg.append('g');
    svg.call(
      d3.zoom()
        .scaleExtent([0.05, 12])
        .on('zoom', ev => g.attr('transform', ev.transform))
    );

    // ── Draw edges ────────────────────────────────────────────────────────────
    const linkEls = g.append('g').attr('class', 'links')
      .selectAll('line')
      .data(links)
      .enter()
      .append('line')
      .attr('stroke',       l => edgeColor(l.source_type))
      .attr('stroke-width', l => edgeWidth(l))
      .attr('stroke-opacity', 0.40)
      .attr('marker-end',   l => `url(#arr-${l.source_type ?? 'other'})`)
      .style('cursor', 'pointer')
      .on('mouseover', (ev, l) => setHovered({ kind: 'link', data: l, x: ev.clientX, y: ev.clientY }))
      .on('mouseout',  ()      => setHovered(null));

    // ── Draw nodes ────────────────────────────────────────────────────────────
    const nodeEls = g.append('g').attr('class', 'nodes')
      .selectAll('circle')
      .data(nodes)
      .enter()
      .append('circle')
      .attr('r',            d => nodeRadius(d, maxBD))
      .attr('fill',         d => nodeColor(d.type))
      .attr('fill-opacity', 0.84)
      .attr('stroke',       '#09090b')
      .attr('stroke-width', 1.5)
      .style('cursor', 'pointer')
      .on('mouseover', (ev, d) => setHovered({ kind: 'node', data: d, x: ev.clientX, y: ev.clientY }))
      .on('mouseout',  ()      => setHovered(null))
      .call(
        d3.drag()
          .on('start', (ev, d) => {
            if (!ev.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x; d.fy = d.y;
          })
          .on('drag',  (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
          .on('end',   (ev, d) => {
            if (!ev.active) simulation.alphaTarget(0);
            d.fx = null; d.fy = null;
          })
      );

    // Labels for prominent nodes
    const labelEls = g.append('g').attr('class', 'labels')
      .selectAll('text')
      .data(nodes.filter(n => n.link_count >= 2 || nodeRadius(n, maxBD) > 14))
      .enter()
      .append('text')
      .text(d => d.id.length > 24 ? `${d.id.slice(0, 22)}…` : d.id)
      .attr('font-size',   '8px')
      .attr('fill',        '#d4d4d8')
      .attr('text-anchor', 'middle')
      .attr('dy',          d => nodeRadius(d, maxBD) + 11)
      .style('pointer-events', 'none')
      .style('user-select',    'none');

    // ── Force simulation ──────────────────────────────────────────────────────
    const simulation = d3.forceSimulation(nodes)
      .force('link',    d3.forceLink(links).id(d => d.id)
        .distance(l => Math.max(70, 180 / Math.log10(l.bd_best + 10)))
        .strength(0.35))
      .force('charge',  d3.forceManyBody()
        .strength(d => -450 - d.link_count * 55))
      .force('center',  d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide().radius(d => nodeRadius(d, maxBD) + 9))
      .alphaDecay(0.018);

    simulationRef.current = simulation;

    let tickCount = 0;
    simulation.on('end', () => setSimAlpha(0));
    simulation.on('tick', () => {
      tickCount++;
      if (tickCount % 8 === 0) setSimAlpha(simulation.alpha());
      // Pull edge endpoints back from node edge (for clean arrow tips)
      linkEls
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => {
          const dx = d.target.x - d.source.x;
          const dy = d.target.y - d.source.y;
          const dist = Math.hypot(dx, dy) || 1;
          return d.target.x - (dx / dist) * (nodeRadius(d.target, maxBD) + 9);
        })
        .attr('y2', d => {
          const dx = d.target.x - d.source.x;
          const dy = d.target.y - d.source.y;
          const dist = Math.hypot(dx, dy) || 1;
          return d.target.y - (dy / dist) * (nodeRadius(d.target, maxBD) + 9);
        });

      nodeEls.attr('cx', d => d.x).attr('cy', d => d.y);
      labelEls.attr('x', d => d.x).attr('y', d => d.y);
    });

    return () => {
      simulation.stop();
      d3.select(container).selectAll('svg').remove();
    };
  }, [rawData, yearRange, minDeaths, regions]);

  // ── Derived metadata for controls ─────────────────────────────────────────
  const yearMin = rawData?.year_min ?? 1946;
  const yearMax = rawData?.year_max ?? 2024;

  // ── Tooltip ────────────────────────────────────────────────────────────────
  const Tooltip = hovered && (
    <div
      className="fixed z-50 bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-xs font-mono text-zinc-100 max-w-xs shadow-2xl pointer-events-none"
      style={{ left: hovered.x + 14, top: hovered.y - 8 }}
    >
      {hovered.kind === 'node' ? (
        <>
          <p className="font-bold text-zinc-100 mb-1 break-words">{hovered.data.id}</p>
          <p className="text-zinc-400">
            Type:{' '}
            <span style={{ color: nodeColor(hovered.data.type) }}>
              {TYPE_LABELS[hovered.data.type]}
            </span>
          </p>
          <p className="text-zinc-400">
            Battle deaths (cumulative):{' '}
            <span className="text-red-400">{hovered.data.total_bd.toLocaleString()}</span>
          </p>
          <p className="text-zinc-400">Hostile links: {hovered.data.link_count}</p>
        </>
      ) : (
        <>
          <p className="font-bold text-zinc-100 mb-1 break-words">
            {hovered.data.source?.id ?? hovered.data.source}
            {' → '}
            {hovered.data.target?.id ?? hovered.data.target}
          </p>
          <p className="text-zinc-400">
            Battle deaths:{' '}
            <span className="text-red-400">{hovered.data.bd_best.toLocaleString()}</span>
          </p>
          <p className="text-zinc-400">Years active: {hovered.data.years.join(', ')}</p>
          {hovered.data.conflicts.length > 0 && (
            <p className="text-zinc-400 break-words">
              Conflicts: {hovered.data.conflicts.slice(0, 3).join(' · ')}
              {hovered.data.conflicts.length > 3 && ` +${hovered.data.conflicts.length - 3} more`}
            </p>
          )}
        </>
      )}
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">

      {/* Controls bar */}
      <div className="flex items-center gap-5 px-4 py-2 bg-zinc-900/60 border-b border-zinc-800 flex-wrap text-xs font-mono">

        {/* Reconfigure */}
        {onReconfigure && (
          <button
            onClick={onReconfigure}
            className="flex items-center gap-1 px-2 py-1 rounded border border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300 font-mono text-[10px] uppercase tracking-wider transition-colors"
          >
            ← Reconfigure
          </button>
        )}

        {/* Year from */}
        <label className="flex items-center gap-2">
          <span className="text-zinc-500 uppercase tracking-wider">From</span>
          <input
            type="range"
            min={yearMin} max={yearMax - 1}
            value={yearRange?.[0] ?? yearMin}
            onChange={e => setYearRange(prev => [+e.target.value, prev?.[1] ?? yearMax])}
            className="w-24 accent-blue-500"
          />
          <span className="text-zinc-300 w-10">{yearRange?.[0]}</span>
        </label>

        {/* Year to */}
        <label className="flex items-center gap-2">
          <span className="text-zinc-500 uppercase tracking-wider">To</span>
          <input
            type="range"
            min={yearMin + 1} max={yearMax}
            value={yearRange?.[1] ?? yearMax}
            onChange={e => setYearRange(prev => [prev?.[0] ?? yearMin, +e.target.value])}
            className="w-24 accent-blue-500"
          />
          <span className="text-zinc-300 w-10">{yearRange?.[1]}</span>
        </label>

        {/* Min deaths */}
        <label className="flex items-center gap-2">
          <span className="text-zinc-500 uppercase tracking-wider">Min&nbsp;deaths</span>
          <input
            type="range"
            min={0} max={10000} step={100}
            value={minDeaths}
            onChange={e => setMinDeaths(+e.target.value)}
            className="w-24 accent-red-500"
          />
          <span className="text-zinc-300 w-16">{minDeaths.toLocaleString()}+</span>
        </label>

        {/* Legend */}
        <div className="flex items-center gap-3 ml-auto flex-wrap">
          {Object.entries(TYPE_LABELS).map(([type, label]) => (
            <div key={type} className="flex items-center gap-1">
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: TYPE_COLORS[type] }}
              />
              <span className="text-zinc-500 text-[9px]">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Force graph canvas */}
      <div className="flex-1 min-h-0 relative">
        <div ref={containerRef} className="w-full h-full" />

        {/* Simulation progress badge */}
        {simAlpha > 0.015 && (
          <div className="absolute top-3 right-3 bg-zinc-950/90 border border-zinc-800 rounded-lg px-3 py-2 text-[11px] font-mono backdrop-blur-sm">
            <div className="flex items-center gap-2 text-zinc-400 mb-1.5">
              <div
                className="w-3 h-3 rounded-full border border-zinc-700 border-t-blue-400 animate-spin flex-shrink-0"
                style={{ animationDuration: '0.8s' }}
              />
              <span>Simulating forces</span>
              <span className="text-zinc-600 ml-auto pl-3">
                {Math.round((1 - simAlpha) * 100)}%
              </span>
            </div>
            <div className="w-36 h-0.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-200"
                style={{ width: `${Math.round((1 - simAlpha) * 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-1 border-t border-zinc-800 text-[9px] font-mono text-zinc-600">
        <span>
          {rawData?.data_sources?.join(' · ')}
          {' · '}
          {rawData?.total_records?.toLocaleString()} dyad-year records
        </span>
        <span>Scroll to zoom · drag to pan · drag nodes to pin</span>
      </div>

      {Tooltip}
    </div>
  );
}
