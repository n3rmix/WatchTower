import React, { useRef, useEffect } from 'react';
import * as d3 from 'd3';

const AGES = Array.from({ length: 81 }, (_, i) => i); // 0–80

export default function LifelineChart({ data, activeSegment }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!data || !containerRef.current) return;

    const container = containerRef.current;
    d3.select(container).selectAll('svg').remove();

    const margin = { top: 36, right: 32, bottom: 52, left: 58 };
    const totalW  = container.clientWidth  || 900;
    const totalH  = container.clientHeight || 480;
    const width   = totalW - margin.left - margin.right;
    const height  = totalH - margin.top  - margin.bottom;

    const seg     = data.segments[activeSegment];
    if (!seg) return;

    const baseline = seg.baseline_curve;
    const conflict = seg.conflict_curve;
    const startAge = data.conflict_start_age;

    // ── Scales ─────────────────────────────────────────────────────────────────
    const xScale = d3.scaleLinear().domain([0, 80]).range([0, width]);
    const yScale = d3.scaleLinear().domain([0, 1]).range([height, 0]);

    const svg = d3.select(container)
      .append('svg')
      .attr('width',  totalW)
      .attr('height', totalH);

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // ── Life stage background bands ────────────────────────────────────────────
    data.life_stage_bands.forEach(band => {
      const x1 = xScale(band.age_start);
      const x2 = xScale(band.age_end);
      g.append('rect')
        .attr('x', x1).attr('y', 0)
        .attr('width', x2 - x1).attr('height', height)
        .attr('fill', band.color);

      // Label at top of band
      g.append('text')
        .attr('x', (x1 + x2) / 2)
        .attr('y', -8)
        .attr('text-anchor', 'middle')
        .attr('font-size', '8px')
        .attr('font-family', 'monospace')
        .attr('fill', '#52525b')
        .attr('letter-spacing', '0.05em')
        .text(band.label.toUpperCase());
    });

    // ── Conflict zone overlay ───────────────────────────────────────────────────
    if (startAge < 80) {
      g.append('rect')
        .attr('x', xScale(startAge))
        .attr('y', 0)
        .attr('width', xScale(80) - xScale(startAge))
        .attr('height', height)
        .attr('fill', 'rgba(239,68,68,0.04)');
    }

    // ── Area fill between curves (life years lost) ─────────────────────────────
    const areaGen = d3.area()
      .x((_, i) => xScale(i))
      .y0(d => yScale(d[0]))
      .y1(d => yScale(d[1]))
      .curve(d3.curveCatmullRom.alpha(0.5));

    const gapData = AGES.map(i => [
      Math.max(conflict[i], 0),
      baseline[i],
    ]);

    g.append('path')
      .datum(gapData)
      .attr('d', areaGen)
      .attr('fill', seg.color)
      .attr('fill-opacity', 0.12);

    // ── Baseline curve (dashed) ────────────────────────────────────────────────
    const lineGen = d3.line()
      .x((_, i) => xScale(i))
      .y(d => yScale(d))
      .curve(d3.curveCatmullRom.alpha(0.5));

    g.append('path')
      .datum(baseline)
      .attr('d', lineGen)
      .attr('fill', 'none')
      .attr('stroke', '#71717a')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '5,4');

    // ── Conflict-adjusted curve (solid) ───────────────────────────────────────
    g.append('path')
      .datum(conflict)
      .attr('d', lineGen)
      .attr('fill', 'none')
      .attr('stroke', seg.color)
      .attr('stroke-width', 2.5);

    // ── Conflict start vertical line ───────────────────────────────────────────
    if (startAge >= 0 && startAge <= 80) {
      g.append('line')
        .attr('x1', xScale(startAge)).attr('x2', xScale(startAge))
        .attr('y1', 0).attr('y2', height)
        .attr('stroke', '#ef4444')
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '4,3')
        .attr('opacity', 0.7);

      // Label
      const labelX = xScale(startAge);
      const labelY = yScale(baseline[Math.min(startAge, 80)] ?? 1) - 10;
      g.append('text')
        .attr('x', labelX + 5)
        .attr('y', Math.max(12, labelY))
        .attr('font-size', '9px')
        .attr('font-family', 'monospace')
        .attr('fill', '#ef4444')
        .attr('letter-spacing', '0.04em')
        .text(`Age ${startAge} — conflict`);
    }

    // ── Conflict historical event markers ─────────────────────────────────────
    if (data.events) {
      data.events.forEach((ev, idx) => {
        const evAge = ev.year - data.cohort_birth;
        if (evAge < 0 || evAge > 80) return;
        const evX = xScale(evAge);
        const evY = yScale(conflict[evAge] ?? 0.5);

        g.append('circle')
          .attr('cx', evX).attr('cy', evY)
          .attr('r', 3.5)
          .attr('fill', '#ef4444')
          .attr('opacity', 0.85);

        // Alternate label positions to avoid overlap
        const above = idx % 2 === 0;
        g.append('text')
          .attr('x', evX + 6)
          .attr('y', evY + (above ? -6 : 12))
          .attr('font-size', '8px')
          .attr('font-family', 'monospace')
          .attr('fill', '#a1a1aa')
          .text(ev.label);
      });
    }

    // ── Axes ───────────────────────────────────────────────────────────────────
    const xAxis = d3.axisBottom(xScale)
      .tickValues([0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80])
      .tickFormat(d => `${d}`);

    g.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(xAxis)
      .call(ax => ax.select('.domain').attr('stroke', '#3f3f46'))
      .call(ax => ax.selectAll('.tick line').attr('stroke', '#3f3f46'))
      .call(ax => ax.selectAll('.tick text')
        .attr('fill', '#71717a')
        .attr('font-size', '10px')
        .attr('font-family', 'monospace'));

    g.append('text')
      .attr('x', width / 2)
      .attr('y', height + 40)
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('font-family', 'monospace')
      .attr('fill', '#52525b')
      .attr('letter-spacing', '0.08em')
      .text('AGE');

    const yAxis = d3.axisLeft(yScale)
      .ticks(5)
      .tickFormat(d => `${Math.round(d * 100)}%`);

    g.append('g')
      .call(yAxis)
      .call(ax => ax.select('.domain').attr('stroke', '#3f3f46'))
      .call(ax => ax.selectAll('.tick line').attr('stroke', '#3f3f46'))
      .call(ax => ax.selectAll('.tick text')
        .attr('fill', '#71717a')
        .attr('font-size', '10px')
        .attr('font-family', 'monospace'));

    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -height / 2)
      .attr('y', -44)
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('font-family', 'monospace')
      .attr('fill', '#52525b')
      .attr('letter-spacing', '0.08em')
      .text('PROBABILITY OF SURVIVAL');

    // ── Horizontal grid lines ──────────────────────────────────────────────────
    [0.25, 0.5, 0.75].forEach(frac => {
      g.append('line')
        .attr('x1', 0).attr('x2', width)
        .attr('y1', yScale(frac)).attr('y2', yScale(frac))
        .attr('stroke', '#27272a')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '2,4');
    });

    // ── Legend ─────────────────────────────────────────────────────────────────
    const legendX = width - 180;
    const legendY = 10;

    [
      { label: 'Expected (pre-conflict)', stroke: '#71717a', dash: '5,4', width: 1.5 },
      { label: `${seg.label} — conflict-adjusted`, stroke: seg.color, dash: null, width: 2.5 },
    ].forEach((item, i) => {
      const y = legendY + i * 18;
      g.append('line')
        .attr('x1', legendX).attr('x2', legendX + 24)
        .attr('y1', y).attr('y2', y)
        .attr('stroke', item.stroke)
        .attr('stroke-width', item.width)
        .attr('stroke-dasharray', item.dash ?? '');
      g.append('text')
        .attr('x', legendX + 30)
        .attr('y', y + 4)
        .attr('font-size', '9px')
        .attr('font-family', 'monospace')
        .attr('fill', '#a1a1aa')
        .text(item.label);
    });

    // Shaded gap legend entry
    g.append('rect')
      .attr('x', legendX).attr('y', legendY + 36)
      .attr('width', 24).attr('height', 10)
      .attr('fill', seg.color).attr('opacity', 0.2);
    g.append('text')
      .attr('x', legendX + 30)
      .attr('y', legendY + 45)
      .attr('font-size', '9px')
      .attr('font-family', 'monospace')
      .attr('fill', '#a1a1aa')
      .text('Life years lost');

    // ── Interactive tooltip ────────────────────────────────────────────────────
    const tooltip = d3.select(container)
      .append('div')
      .style('position', 'absolute')
      .style('pointer-events', 'none')
      .style('background', '#18181b')
      .style('border', '1px solid #3f3f46')
      .style('border-radius', '6px')
      .style('padding', '8px 12px')
      .style('font-family', 'monospace')
      .style('font-size', '11px')
      .style('color', '#e4e4e7')
      .style('display', 'none')
      .style('z-index', '50');

    svg.append('rect')
      .attr('x', margin.left).attr('y', margin.top)
      .attr('width', width).attr('height', height)
      .attr('fill', 'none')
      .attr('pointer-events', 'all')
      .on('mousemove', function(event) {
        const [mx] = d3.pointer(event, this);
        const age  = Math.round(xScale.invert(mx));
        if (age < 0 || age > 80) return;

        const bv = (baseline[age] * 100).toFixed(1);
        const cv = (conflict[age] * 100).toFixed(1);
        const diff = ((baseline[age] - conflict[age]) * 100).toFixed(1);

        tooltip
          .style('display', 'block')
          .style('left', `${event.offsetX + 14}px`)
          .style('top',  `${event.offsetY - 12}px`)
          .html(
            `<div style="color:#a1a1aa;margin-bottom:4px">Age <strong style="color:#e4e4e7">${age}</strong></div>` +
            `<div style="color:#71717a">Expected: <span style="color:#e4e4e7">${bv}%</span></div>` +
            `<div style="color:${seg.color}">Conflict-adj: <span style="color:#e4e4e7">${cv}%</span></div>` +
            (diff > 0 ? `<div style="color:#ef4444;margin-top:3px">− ${diff}pp gap</div>` : '')
          );

        // Crosshair
        g.selectAll('.crosshair').remove();
        g.append('line').attr('class', 'crosshair')
          .attr('x1', xScale(age)).attr('x2', xScale(age))
          .attr('y1', 0).attr('y2', height)
          .attr('stroke', '#52525b')
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', '3,3')
          .attr('pointer-events', 'none');
      })
      .on('mouseleave', () => {
        tooltip.style('display', 'none');
        g.selectAll('.crosshair').remove();
      });

  }, [data, activeSegment]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative"
      style={{ minHeight: '380px' }}
    />
  );
}
