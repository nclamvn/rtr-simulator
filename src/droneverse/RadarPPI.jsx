import { useRef, useEffect } from "react";
import { PI2, DEG, THEMES } from "./constants.js";

function RadarPPI({ drones, threats, waypoints, radarRange, selectedId, onSelect, onAddWaypoint, wind, graphOverlay, kg, radarTheme }) {
  const cvRef = useRef(null);
  const swRef = useRef(0);
  const cRef = useRef(new Map());

  useEffect(() => {
    const cv = cvRef.current; if (!cv) return;
    const ctx = cv.getContext("2d");
    const S = cv.width, cx = S / 2, cy = S / 2, R = S / 2 - 28;
    let raf, last = performance.now();
    const draw = (now) => {
      const dt = (now - last) / 1000; last = now;
      swRef.current = (swRef.current + 24 * dt) % 360;
      const sw = swRef.current * DEG;

      const RT = radarTheme || THEMES.dark.radar;
      ctx.fillStyle = RT.overlay; ctx.fillRect(0, 0, S, S);
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R + 2, 0, PI2); ctx.clip();

      for (let i = 1; i <= 5; i++) {
        const r = (R / 5) * i;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, PI2);
        ctx.strokeStyle = `rgba(${RT.ring},${i === 5 ? 0.45 : 0.18})`; ctx.lineWidth = i === 5 ? 1.5 : 0.7; ctx.stroke();
        ctx.fillStyle = `rgba(${RT.text},0.5)`; ctx.font = "10px monospace"; ctx.textAlign = "center";
        ctx.fillText(`${Math.round((radarRange / 5) * i)}`, cx, cy - r + 12);
      }
      for (let deg = 0; deg < 360; deg += 10) {
        const a = deg * DEG - Math.PI / 2;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (deg % 30 === 0 ? R - 8 : R - 4), cy + Math.sin(a) * (deg % 30 === 0 ? R - 8 : R - 4));
        ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        ctx.strokeStyle = deg % 30 === 0 ? `rgba(${RT.ring},0.45)` : `rgba(${RT.ring},0.18)`; ctx.lineWidth = 0.5; ctx.stroke();
        if (deg % 90 === 0) {
          ctx.fillStyle = `rgba(${RT.text},0.8)`; ctx.font = "bold 11px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText({ 0: "N", 90: "E", 180: "S", 270: "W" }[deg], cx + Math.cos(a) * (R + 15), cy + Math.sin(a) * (R + 15));
        }
      }
      ctx.strokeStyle = `rgba(${RT.ring},0.12)`; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();

      // Graph overlay
      if (graphOverlay && kg) {
        // Sector grid (4x4, 200m each, centered on origin)
        ctx.strokeStyle = "rgba(0,180,80,0.04)"; ctx.lineWidth = 0.5; ctx.setLineDash([4, 4]);
        for (let i = 1; i < 4; i++) {
          const gx = cx + ((i * 200 - 400) / radarRange) * R;
          ctx.beginPath(); ctx.moveTo(gx, cy - R); ctx.lineTo(gx, cy + R); ctx.stroke();
          const gy = cy - ((i * 200 - 400) / radarRange) * R;
          ctx.beginPath(); ctx.moveTo(cx - R, gy); ctx.lineTo(cx + R, gy); ctx.stroke();
        }
        ctx.setLineDash([]);
        // Visited sectors: green tint
        const sectors = kg.query("sector");
        for (const s of sectors) {
          if (!s.data.visitCount) continue;
          const sx1 = cx + (s.data.x / radarRange) * R, sy1 = cy - ((s.data.y + 200) / radarRange) * R;
          const sw2 = (200 / radarRange) * R, sh2 = (200 / radarRange) * R;
          ctx.fillStyle = `rgba(0,180,80,${Math.min(0.08, s.data.visitCount * 0.002)})`;
          ctx.fillRect(sx1, sy1 - sh2, sw2, sh2);
        }
        // Proximity edges
        const proxEdges = kg.edges.filter(e => e.relation === "proximity");
        for (const e of proxEdges) {
          const d1 = drones.find(d => d.id === e.from), d2 = drones.find(d => d.id === e.to);
          if (!d1 || !d2) continue;
          const x1 = cx + (d1.fd.x / radarRange) * R, y1 = cy - (d1.fd.y / radarRange) * R;
          const x2 = cx + (d2.fd.x / radarRange) * R, y2 = cy - (d2.fd.y / radarRange) * R;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
          ctx.strokeStyle = "rgba(0,200,255,0.15)"; ctx.lineWidth = 0.5; ctx.stroke();
        }
        // Detected edges (drone → threat)
        const detEdges = kg.edges.filter(e => e.relation === "detected");
        const shown = new Set();
        for (const e of detEdges) {
          const key = `${e.from}-${e.to}`;
          if (shown.has(key)) continue; shown.add(key);
          const d1 = drones.find(d => d.id === e.from), tn = kg.nodes.get(e.to);
          if (!d1 || !tn) continue;
          const x1 = cx + (d1.fd.x / radarRange) * R, y1 = cy - (d1.fd.y / radarRange) * R;
          const x2 = cx + (tn.data.x / radarRange) * R, y2 = cy - (tn.data.y / radarRange) * R;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
          ctx.strokeStyle = "rgba(255,60,60,0.2)"; ctx.lineWidth = 0.5; ctx.setLineDash([2, 3]); ctx.stroke(); ctx.setLineDash([]);
        }
      }

      // Sweep fan + line
      ctx.save(); ctx.translate(cx, cy);
      const sa = sw - Math.PI / 2;
      const g = ctx.createConicGradient(sa - 0.35, 0, 0);
      g.addColorStop(0, `rgba(${RT.sweep},0)`); g.addColorStop(0.85, `rgba(${RT.sweep},0.1)`); g.addColorStop(1, `rgba(${RT.sweep},0.25)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, sa - 0.35, sa); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(sa) * R, Math.sin(sa) * R);
      ctx.strokeStyle = `rgba(${RT.sweep},1.0)`; ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();

      // Detect
      for (const d of drones) {
        const rng = Math.sqrt(d.fd.x * d.fd.x + d.fd.y * d.fd.y);
        if (rng > radarRange) continue;
        const brg = (Math.atan2(d.fd.x, d.fd.y) / DEG + 360) % 360;
        if (Math.abs(((swRef.current - brg + 540) % 360) - 180) < 3)
          cRef.current.set(d.id, { brg, rng, iff: d.spec.iff, id: d.id, last: now, sx: cx + (d.fd.x / radarRange) * R, sy: cy - (d.fd.y / radarRange) * R, spd: d.fd.speed, alt: d.fd.alt, hdg: d.fd.hdg });
      }
      // Waypoints
      for (const wp of waypoints) {
        const wx = cx + (wp.x / radarRange) * R, wy = cy - (wp.y / radarRange) * R;
        if (Math.hypot(wx - cx, wy - cy) > R) continue;
        ctx.save(); ctx.translate(wx, wy); ctx.rotate(Math.PI / 4);
        ctx.strokeStyle = "rgba(0,200,255,0.6)"; ctx.lineWidth = 1; ctx.strokeRect(-3, -3, 6, 6); ctx.restore();
      }
      // Threats
      for (const t of threats) {
        const tx = cx + (t.x / radarRange) * R, ty = cy - (t.y / radarRange) * R, tr = (t.radius / radarRange) * R;
        ctx.beginPath(); ctx.arc(tx, ty, tr, 0, PI2); ctx.fillStyle = "rgba(255,40,40,0.1)"; ctx.fill();
        ctx.strokeStyle = `rgba(255,60,60,${0.35 + Math.sin(now * 0.004) * 0.15})`; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = "rgba(255,100,100,0.75)"; ctx.font = "bold 8px monospace"; ctx.textAlign = "center"; ctx.fillText(t.type, tx, ty - tr - 4);
      }
      // Blips
      for (const [id, c] of cRef.current) {
        const fade = Math.max(0, 1 - (now - c.last) / 1000 / (360 / 24));
        if (fade <= 0) { cRef.current.delete(id); continue; }
        const sel = id === selectedId, sz = sel ? 5 : 3;
        const rgb = c.iff === "HOSTILE" ? RT.blipHostile : RT.blipFriendly;
        ctx.beginPath(); ctx.arc(c.sx, c.sy, sz, 0, PI2); ctx.fillStyle = `rgba(${rgb},${fade})`; ctx.fill();
        ctx.beginPath(); ctx.arc(c.sx, c.sy, sz + 4, 0, PI2); ctx.strokeStyle = `rgba(${rgb},${fade * 0.45})`; ctx.lineWidth = 1; ctx.stroke();
        if (fade > 0.3) {
          const vr = c.hdg * DEG, vl = 12 + c.spd * 0.4;
          ctx.beginPath(); ctx.moveTo(c.sx, c.sy); ctx.lineTo(c.sx + Math.sin(vr) * vl, c.sy - Math.cos(vr) * vl);
          ctx.strokeStyle = `rgba(${rgb},${fade * 0.9})`; ctx.lineWidth = 1; ctx.stroke();
        }
        if (fade > 0.4) {
          ctx.fillStyle = `rgba(${rgb},${Math.min(1, fade * 1.1)})`; ctx.font = `${sel ? "bold " : ""}9px monospace`; ctx.textAlign = "left";
          ctx.fillText(c.id, c.sx + 10, c.sy - 4);
          ctx.font = "8px monospace"; ctx.fillStyle = `rgba(0,255,140,${fade * 0.8})`;
          ctx.fillText(`${Math.round(c.alt)}m ${c.spd.toFixed(0)}m/s`, c.sx + 10, c.sy + 8);
        }
        if (sel) {
          const b = 14, g2 = 5; ctx.strokeStyle = `rgba(0,255,200,${0.5 + Math.sin(now * 0.005) * 0.3})`; ctx.lineWidth = 1.5;
          [[c.sx-b,c.sy-b+g2,c.sx-b,c.sy-b,c.sx-b+g2,c.sy-b],[c.sx+b-g2,c.sy-b,c.sx+b,c.sy-b,c.sx+b,c.sy-b+g2],[c.sx-b,c.sy+b-g2,c.sx-b,c.sy+b,c.sx-b+g2,c.sy+b],[c.sx+b-g2,c.sy+b,c.sx+b,c.sy+b,c.sx+b,c.sy+b-g2]].forEach(p=>{ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.lineTo(p[2],p[3]);ctx.lineTo(p[4],p[5]);ctx.stroke();});
        }
      }
      ctx.beginPath(); ctx.arc(cx, cy, 3, 0, PI2); ctx.fillStyle = "rgba(0,255,200,0.7)"; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, 6, 0, PI2); ctx.strokeStyle = "rgba(0,255,200,0.2)"; ctx.lineWidth = 0.5; ctx.stroke();
      ctx.restore();
      ctx.beginPath(); ctx.arc(cx, cy, R + 2, 0, PI2); ctx.strokeStyle = "rgba(0,220,100,0.4)"; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = `rgba(${RT.text},0.6)`; ctx.font = "10px monospace";
      ctx.textAlign = "left"; ctx.fillText(`RNG ${radarRange}m`, 8, S - 22); ctx.fillText(`SWP ${Math.round(swRef.current)}°`, 8, S - 10);
      ctx.textAlign = "right"; ctx.fillText(`TGT ${cRef.current.size}`, S - 8, S - 22); ctx.fillText(`THR ${threats.length}`, S - 8, S - 10);
      // Wind indicator
      if (wind && wind.speed > 0) {
        const wix = S - 45, wiy = 45;
        const wrad = wind.dir * DEG;
        const wlen = Math.min(25, 8 + wind.speed);
        ctx.save(); ctx.translate(wix, wiy); ctx.rotate(wrad);
        ctx.beginPath(); ctx.moveTo(0, -wlen); ctx.lineTo(0, wlen);
        ctx.strokeStyle = "rgba(100,200,255,0.7)"; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, wlen); ctx.lineTo(-4, wlen - 6); ctx.moveTo(0, wlen); ctx.lineTo(4, wlen - 6);
        ctx.stroke(); ctx.restore();
        ctx.fillStyle = "rgba(100,200,255,0.6)"; ctx.font = "bold 8px monospace"; ctx.textAlign = "center";
        ctx.fillText(`WIND ${wind.speed}m/s`, wix, wiy + wlen + 12);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [drones, threats, waypoints, radarRange, selectedId, wind, graphOverlay, kg]);

  return <canvas ref={cvRef} width={440} height={440} onClick={(e) => {
    const r = e.target.getBoundingClientRect(), sc = 440 / r.width;
    const mx = (e.clientX - r.left) * sc, my = (e.clientY - r.top) * sc;
    let best = null, bd = 20;
    for (const [id, c] of cRef.current) { const d = Math.hypot(c.sx - mx, c.sy - my); if (d < bd) { best = id; bd = d; } }
    onSelect(best);
  }} onContextMenu={(e) => {
    e.preventDefault();
    const r = e.target.getBoundingClientRect(), sc = 440 / r.width;
    const S = 440, cx = S / 2, cy = S / 2, R = S / 2 - 28;
    const mx = (e.clientX - r.left) * sc, my = (e.clientY - r.top) * sc;
    const wx = Math.round((mx - cx) / R * radarRange);
    const wy = Math.round(-(my - cy) / R * radarRange);
    if (onAddWaypoint) onAddWaypoint(wx, wy);
  }} style={{ width: "100%", aspectRatio: "1/1", cursor: "crosshair", borderRadius: 8 }} />;
}

export default RadarPPI;
