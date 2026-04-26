import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ═══════════════════════════════════════════════════════════
// RTR MODULE 18 — GPS-DENIED NAV — TACTICAL C2 INTERFACE
// Design: Defense-grade dark ops, inspired by Lockheed C2
// ═══════════════════════════════════════════════════════════

// ── THEME ──
const T = {
  bg: "#0a0e14",
  panel: "#0f1318",
  panelBorder: "#1a2030",
  grid: "rgba(60,85,110,0.5)",
  gridFine: "rgba(60,85,110,0.25)",
  text: "#a8bdd0",
  textBright: "#dce8f0",
  textDim: "#7a90a8",
  accent: "#00e5a0",
  accentDim: "rgba(0,229,160,0.15)",
  warning: "#f0a030",
  warningDim: "rgba(240,160,48,0.12)",
  danger: "#ff4060",
  dangerDim: "rgba(255,64,96,0.12)",
  info: "#3b82f6",
  infoDim: "rgba(59,130,246,0.12)",
  true_path: "#00e5a0",
  est_path: "#f0a030",
  cone: "rgba(59,130,246,0.25)",
  coneBorder: "rgba(59,130,246,0.5)",
  landmark_detected: "#00e5a0",
  landmark_missed: "#4a5568",
};

const FONT = "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', monospace";

// ── Transform raw sim_data.json → tactical data at frame index ──
function transformSimData(raw, idx) {
  const i = Math.min(idx, raw.true_path.length - 1);
  const truePos = raw.true_path[i];
  const estPos = raw.est_path[i];
  const errRow = raw.errors[Math.min(i, raw.errors.length - 1)];
  const sigIdx = raw.sigma.length > 0
    ? Math.min(Math.floor(i * raw.sigma.length / raw.true_path.length), raw.sigma.length - 1)
    : 0;
  const sigRow = raw.sigma[sigIdx] || [0, 0, 0, 0];

  // Speed from consecutive frames
  let speed = 0;
  if (i > 0) {
    const prev = raw.true_path[i - 1];
    const prevT = raw.errors[Math.min(i - 1, raw.errors.length - 1)]?.[0] || 0;
    const dt = errRow[0] - prevT;
    if (dt > 0) {
      const dn = truePos[0] - prev[0], de = truePos[1] - prev[1];
      speed = Math.sqrt(dn * dn + de * de) / dt;
    }
  }

  // Heading from last 2 positions
  let heading = 0;
  if (i > 0) {
    const prev = raw.true_path[i - 1];
    heading = Math.atan2(truePos[1] - prev[1], truePos[0] - prev[0]) * 180 / Math.PI;
    heading = ((90 - heading) + 360) % 360; // Convert to compass bearing
  }

  // Lateral drift & cone margin
  const lateralDrift = Math.abs(truePos[1]);
  let coneRadius = 0, coneLayerIdx = 0;
  const layers = raw.cone?.layers || [];
  for (let li = 0; li < layers.length; li++) {
    if (truePos[0] >= (layers[li].distance || 0)) {
      coneRadius = layers[li].radius;
      coneLayerIdx = li;
    }
  }
  if (coneLayerIdx < layers.length - 1) {
    const l0 = layers[coneLayerIdx], l1 = layers[coneLayerIdx + 1];
    const d0 = l0.distance || 0, d1 = l1.distance || 0;
    if (d1 > d0) {
      const f = (truePos[0] - d0) / (d1 - d0);
      coneRadius = l0.radius + f * (l1.radius - l0.radius);
    }
  }
  const coneMargin = coneRadius - lateralDrift;

  // Mode heuristic from sigma growth
  let mode = "NOMINAL";
  if (sigRow[1] > 60) mode = "INERTIAL";
  else if (sigRow[1] > 30) mode = "DEGRADED";

  // Progress
  const targetN = raw.target[0] || 5000;
  const progress = Math.min(100, Math.round((truePos[0] / targetN) * 100));

  // NIS average
  const nisAvg = raw.nis.length > 0
    ? raw.nis.reduce((s, n) => s + n[1], 0) / raw.nis.length
    : 0;

  return {
    t: errRow[0],
    duration: raw.duration,
    corridor: raw.corridor_km * 1000,
    landmarks_total: raw.landmarks.length,
    updates: raw.updates,
    rejects: raw.rejects,
    progress,
    cone_layer: {
      current: raw.cone?.progress?.current_layer || coneLayerIdx + 1,
      total: raw.cone?.progress?.total_layers || layers.length,
    },
    true_pos: { n: truePos[0], e: truePos[1], alt: Math.abs(truePos[2] || 0) },
    est_pos: { n: estPos[0], e: estPos[1], alt: Math.abs(estPos[2] || 0) },
    speed,
    heading,
    sigma: { n: sigRow[1], e: sigRow[2], alt: sigRow[3] || 0 },
    lat_drift: lateralDrift,
    cone_r: coneRadius,
    margin: coneMargin,
    status: coneMargin >= 0 ? "IN" : "OUT",
    outcome: raw.outcome?.toUpperCase() || "UNKNOWN",
    error: errRow[1],
    to_target: Math.sqrt((targetN - truePos[0]) ** 2 + truePos[1] ** 2),
    mode,
    nis_avg: nisAvg,
    ekf_state: mode,
    // Paths for map
    true_path: raw.true_path.slice(0, i + 1).map(p => ({ n: p[0], e: p[1] })),
    est_path: raw.est_path.slice(0, i + 1).map(p => ({ n: p[0], e: p[1] })),
    // Error history up to current frame
    error_history: raw.errors.slice(0, Math.min(i + 1, raw.errors.length)).map(e => ({ t: e[0], v: e[1] })),
    // NIS scatter
    nis_history: raw.nis.filter(n => n[0] <= errRow[0]).map(n => ({ t: n[0], v: n[1] })),
    // Landmarks
    landmarks: raw.landmarks.map((lm, li) => ({
      id: lm.id,
      n: lm.position[0],
      e: lm.position[1],
      type: lm.type,
      detected: li < raw.updates, // heuristic: first N landmarks = detected
      cluster: lm.cluster,
    })),
    // Cone layers
    cone_layers: layers.map(l => ({ d: l.distance, r: l.radius })),
    // Raw for export
    _raw: raw,
  };
}

// ── COMPONENTS ──

function MetricCard({ label, value, unit, status, small }) {
  const color =
    status === "danger" ? T.danger :
    status === "warning" ? T.warning :
    status === "good" ? T.accent :
    T.textBright;
  const bg =
    status === "danger" ? T.dangerDim :
    status === "warning" ? T.warningDim :
    status === "good" ? T.accentDim :
    "transparent";

  return (
    <div style={{
      background: bg,
      border: `1px solid ${status ? color + "30" : T.panelBorder}`,
      borderRadius: 4,
      padding: small ? "6px 8px" : "8px 12px",
      minWidth: 0,
    }}>
      <div style={{ fontSize: 9, color: T.textDim, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: FONT, marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
        <span style={{ fontSize: small ? 16 : 22, fontWeight: 700, color, fontFamily: FONT, lineHeight: 1 }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 10, color: T.textDim, fontFamily: FONT }}>{unit}</span>}
      </div>
    </div>
  );
}

function DataRow({ label, value, unit, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "2px 0", borderBottom: `1px solid ${T.panelBorder}` }}>
      <span style={{ fontSize: 10, color: T.textDim, fontFamily: FONT, textTransform: "uppercase", letterSpacing: 1 }}>{label}</span>
      <span style={{ fontSize: 12, color: color || T.textBright, fontFamily: FONT, fontWeight: 600 }}>
        {value}{unit && <span style={{ fontSize: 9, color: T.textDim, marginLeft: 2 }}>{unit}</span>}
      </span>
    </div>
  );
}

function SectionHeader({ children, icon }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "6px 0", marginTop: 8, marginBottom: 4,
      borderBottom: `1px solid ${T.panelBorder}`,
    }}>
      {icon && <span style={{ fontSize: 10, opacity: 0.5 }}>{icon}</span>}
      <span style={{ fontSize: 9, color: T.text, letterSpacing: 2, textTransform: "uppercase", fontFamily: FONT, fontWeight: 700 }}>
        {children}
      </span>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    NOMINAL: { color: T.accent, bg: T.accentDim },
    DEGRADED: { color: T.warning, bg: T.warningDim },
    INERTIAL: { color: T.danger, bg: T.dangerDim },
    TERMINAL: { color: T.info, bg: T.infoDim },
    ABORTED: { color: T.danger, bg: T.dangerDim },
    OUT: { color: T.danger, bg: T.dangerDim },
    IN: { color: T.accent, bg: T.accentDim },
    TIMEOUT: { color: T.warning, bg: T.warningDim },
    SUCCESS: { color: T.accent, bg: T.accentDim },
    CONE: { color: T.info, bg: T.infoDim },
  };
  const s = map[status] || { color: T.text, bg: "transparent" };
  return (
    <span style={{
      fontSize: 9, fontFamily: FONT, fontWeight: 800, letterSpacing: 1.5,
      color: s.color, background: s.bg, padding: "2px 8px", borderRadius: 3,
      border: `1px solid ${s.color}40`,
    }}>
      {status}
    </span>
  );
}

function MiniChart({ data, width, height, color, threshold, thresholdColor, thresholdLabel, yMax, filled }) {
  if (!data || !data.length) return null;
  const max = yMax || Math.max(...data.map(d => d.v)) * 1.1 || 1;
  const tMin = data[0].t;
  const tRange = Math.max(1, data[data.length - 1].t - tMin);
  const xScale = width / tRange;
  const yScale = (height - 4) / max;

  const points = data.map(d => ({
    x: (d.t - tMin) * xScale,
    y: height - d.v * yScale - 2,
  }));

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  let fillD = "";
  if (filled) {
    fillD = pathD + ` L${points[points.length - 1].x.toFixed(1)},${height} L${points[0].x.toFixed(1)},${height} Z`;
  }

  const thY = threshold ? height - threshold * yScale - 2 : null;

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {[0.25, 0.5, 0.75].map(f => (
        <line key={f} x1={0} y1={height * f} x2={width} y2={height * f}
          stroke={T.gridFine} strokeWidth={0.5} />
      ))}
      {filled && <path d={fillD} fill={color + "15"} />}
      {thY != null && (
        <>
          <line x1={0} y1={thY} x2={width} y2={thY}
            stroke={thresholdColor || T.danger} strokeWidth={0.8} strokeDasharray="4,3" />
          {thresholdLabel && (
            <text x={width - 4} y={thY - 3} fill={thresholdColor || T.danger}
              fontSize={8} fontFamily={FONT} textAnchor="end">{thresholdLabel}</text>
          )}
        </>
      )}
      <path d={pathD} fill="none" stroke={color} strokeWidth={1.5} />
      <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y}
        r={3} fill={color} />
      <text x={2} y={12} fill={T.textDim} fontSize={8} fontFamily={FONT}>{max.toFixed(0)}</text>
      <text x={2} y={height - 2} fill={T.textDim} fontSize={8} fontFamily={FONT}>0</text>
    </svg>
  );
}

function NISScatter({ data, width, height, gate }) {
  if (!data || !data.length) return null;
  const max = Math.max(gate * 1.3, ...data.map(d => d.v));
  const tMin = data[0].t;
  const tRange = Math.max(1, data[data.length - 1].t - tMin);
  const xScale = width / tRange;
  const yScale = (height - 4) / max;
  const gateY = height - gate * yScale - 2;
  const expectedY = height - 2 * yScale - 2;

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {[0.25, 0.5, 0.75].map(f => (
        <line key={f} x1={0} y1={height * f} x2={width} y2={height * f}
          stroke={T.gridFine} strokeWidth={0.5} />
      ))}
      <line x1={0} y1={gateY} x2={width} y2={gateY}
        stroke={T.danger} strokeWidth={0.8} strokeDasharray="4,3" />
      <text x={width - 4} y={gateY - 3} fill={T.danger}
        fontSize={8} fontFamily={FONT} textAnchor="end">GATE {gate}</text>
      <line x1={0} y1={expectedY} x2={width} y2={expectedY}
        stroke={T.accent} strokeWidth={0.5} strokeDasharray="2,4" />
      <text x={width - 4} y={expectedY - 3} fill={T.accent}
        fontSize={7} fontFamily={FONT} textAnchor="end">E[NIS]=2</text>
      {data.map((d, i) => {
        const x = (d.t - tMin) * xScale;
        const y = height - d.v * yScale - 2;
        const c = d.v > gate ? T.danger : d.v > 4 ? T.warning : T.accent;
        return <circle key={i} cx={x} cy={y} r={2.5} fill={c} opacity={0.7} />;
      })}
    </svg>
  );
}

// ── TACTICAL MAP ──
function TacticalMap({ data, width, height }) {
  const canvasRef = useRef(null);
  const corridor = data.corridor;
  const padding = 40;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const mapW = width - padding * 2;
    const mapH = height - padding * 2;

    const maxE = corridor * 0.3;
    const scaleN = mapH / corridor;
    const scaleE = mapW / (maxE * 2);
    const scale = Math.min(scaleN, scaleE);

    const toScreen = (n, e) => [
      width / 2 + e * scale,
      height - padding - n * scale,
    ];

    // Background
    ctx.fillStyle = T.bg;
    ctx.fillRect(0, 0, width, height);

    // Grid
    ctx.strokeStyle = T.grid;
    ctx.lineWidth = 0.8;
    const gridStep = 500;
    for (let n = 0; n <= corridor; n += gridStep) {
      const [, y] = toScreen(n, 0);
      ctx.beginPath(); ctx.moveTo(padding, y); ctx.lineTo(width - padding, y); ctx.stroke();
      ctx.fillStyle = "#90a8c0";
      ctx.font = `11px ${FONT}`;
      ctx.textAlign = "right";
      ctx.fillText(`${(n / 1000).toFixed(1)}km`, padding - 4, y + 4);
    }
    for (let e = -maxE; e <= maxE; e += gridStep) {
      const [x] = toScreen(0, e);
      if (x > padding && x < width - padding) {
        ctx.beginPath(); ctx.moveTo(x, padding); ctx.lineTo(x, height - padding); ctx.stroke();
      }
    }

    // Cone boundary layers
    ctx.strokeStyle = T.coneBorder;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    data.cone_layers.forEach((layer, i) => {
      if (i === 0) return;
      const [x1, y1] = toScreen(layer.d, -layer.r);
      const [x2, y2] = toScreen(layer.d, layer.r);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    });

    // Cone outline
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = T.coneBorder;
    ctx.lineWidth = 1.5;
    const leftEdge = data.cone_layers.map(l => toScreen(l.d, -l.r));
    const rightEdge = data.cone_layers.map(l => toScreen(l.d, l.r));
    leftEdge.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
    ctx.stroke();
    ctx.beginPath();
    rightEdge.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
    ctx.stroke();
    ctx.setLineDash([]);

    // Cone fill
    ctx.fillStyle = T.cone;
    ctx.beginPath();
    leftEdge.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
    [...rightEdge].reverse().forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.closePath();
    ctx.fill();

    // Layer labels
    ctx.fillStyle = "#90a8c0";
    ctx.font = `10px ${FONT}`;
    ctx.textAlign = "left";
    data.cone_layers.forEach((layer, i) => {
      if (i === 0) return;
      const [x, y] = toScreen(layer.d, layer.r);
      ctx.fillText(`L${i}`, x + 6, y + 3);
    });

    // Landmarks
    data.landmarks.forEach(lm => {
      const [x, y] = toScreen(lm.n, lm.e);
      const sz = lm.detected ? 4 : 3;
      ctx.fillStyle = lm.detected ? T.landmark_detected : T.landmark_missed;
      ctx.globalAlpha = lm.detected ? 0.9 : 0.3;
      ctx.beginPath();
      ctx.moveTo(x, y - sz);
      ctx.lineTo(x + sz, y);
      ctx.lineTo(x, y + sz);
      ctx.lineTo(x - sz, y);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    // True path
    if (data.true_path.length > 1) {
      ctx.strokeStyle = T.true_path;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      data.true_path.forEach(({ n, e }, i) => {
        const [x, y] = toScreen(n, e);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // Estimated path
    if (data.est_path.length > 1) {
      ctx.strokeStyle = T.est_path;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      data.est_path.forEach(({ n, e }, i) => {
        const [x, y] = toScreen(n, e);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Drop point B
    const [bx, by] = toScreen(0, 0);
    ctx.fillStyle = T.info;
    ctx.beginPath(); ctx.arc(bx, by, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = T.bg;
    ctx.font = `bold 8px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText("B", bx, by + 3);

    // Target T
    const [tx, ty] = toScreen(corridor, 0);
    ctx.strokeStyle = T.accent;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(tx, ty, 8, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = T.accent;
    ctx.beginPath(); ctx.arc(tx, ty, 3, 0, Math.PI * 2); ctx.fill();
    ctx.font = `bold 9px ${FONT}`;
    ctx.fillText("T", tx, ty - 12);

    // Current true position (triangle heading indicator)
    const [cx, cy] = toScreen(data.true_pos.n, data.true_pos.e);
    ctx.fillStyle = T.true_path;
    const headingRad = (-data.heading + 90) * Math.PI / 180;
    const triSize = 8;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(headingRad) * triSize, cy - Math.sin(headingRad) * triSize);
    ctx.lineTo(cx + Math.cos(headingRad + 2.4) * triSize * 0.7, cy - Math.sin(headingRad + 2.4) * triSize * 0.7);
    ctx.lineTo(cx + Math.cos(headingRad - 2.4) * triSize * 0.7, cy - Math.sin(headingRad - 2.4) * triSize * 0.7);
    ctx.closePath();
    ctx.fill();

    // Current estimated position (hollow triangle)
    const [ex, ey] = toScreen(data.est_pos.n, data.est_pos.e);
    ctx.strokeStyle = T.est_path;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ex + Math.cos(headingRad) * triSize, ey - Math.sin(headingRad) * triSize);
    ctx.lineTo(ex + Math.cos(headingRad + 2.4) * triSize * 0.7, ey - Math.sin(headingRad + 2.4) * triSize * 0.7);
    ctx.lineTo(ex + Math.cos(headingRad - 2.4) * triSize * 0.7, ey - Math.sin(headingRad - 2.4) * triSize * 0.7);
    ctx.closePath();
    ctx.stroke();

    // Uncertainty ellipse
    ctx.strokeStyle = T.est_path + "40";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    const sigN = data.sigma.n * scale * 0.3;
    const sigE = data.sigma.e * scale * 0.3;
    ctx.ellipse(ex, ey, Math.max(sigE, 4), Math.max(sigN, 4), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Scale bar
    const scaleBarM = 500;
    const scaleBarPx = scaleBarM * scale;
    ctx.strokeStyle = "#b0c4d8";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(width - padding - scaleBarPx, height - 16);
    ctx.lineTo(width - padding, height - 16);
    ctx.stroke();
    ctx.fillStyle = "#b0c4d8";
    ctx.font = `11px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(`${scaleBarM}m`, width - padding - scaleBarPx / 2, height - 6);

  }, [data, width, height]);

  return <canvas ref={canvasRef} style={{ width, height, borderRadius: 4 }} />;
}

// ── COMPASS ──
function Compass({ heading, size = 64 }) {
  const c = size / 2;
  const r = c - 8;
  const headRad = (heading - 90) * Math.PI / 180;

  return (
    <svg width={size} height={size}>
      <circle cx={c} cy={c} r={r} fill="none" stroke={T.panelBorder} strokeWidth={1} />
      {[0, 45, 90, 135, 180, 225, 270, 315].map(deg => {
        const rad = (deg - 90) * Math.PI / 180;
        const major = deg % 90 === 0;
        const labels = { 0: "N", 90: "E", 180: "S", 270: "W" };
        return (
          <g key={deg}>
            <line
              x1={c + Math.cos(rad) * (r - (major ? 8 : 4))}
              y1={c + Math.sin(rad) * (r - (major ? 8 : 4))}
              x2={c + Math.cos(rad) * r}
              y2={c + Math.sin(rad) * r}
              stroke={major ? T.text : T.textDim} strokeWidth={major ? 1.5 : 0.5}
            />
            {labels[deg] && (
              <text
                x={c + Math.cos(rad) * (r - 14)}
                y={c + Math.sin(rad) * (r - 14)}
                fill={deg === 0 ? T.danger : T.textDim}
                fontSize={8} fontFamily={FONT} fontWeight={700}
                textAnchor="middle" dominantBaseline="central"
              >{labels[deg]}</text>
            )}
          </g>
        );
      })}
      <line
        x1={c} y1={c}
        x2={c + Math.cos(headRad) * (r - 4)}
        y2={c + Math.sin(headRad) * (r - 4)}
        stroke={T.accent} strokeWidth={2} strokeLinecap="round"
      />
      <circle cx={c} cy={c} r={3} fill={T.accent} />
      <text x={c} y={size - 1} fill={T.textDim} fontSize={9} fontFamily={FONT}
        textAnchor="middle">{heading.toFixed(0)}°</text>
    </svg>
  );
}

// ── LAYER PROGRESS BAR ──
function LayerProgress({ current, total }) {
  const types = ["CNT", "CNT", "BRG", "BRG", "MET", "MET", "MET", "TRM"];
  return (
    <div style={{ display: "flex", gap: 2, height: 16, alignItems: "stretch" }}>
      {Array.from({ length: total }, (_, i) => {
        const active = i < current;
        const isCurrent = i === current - 1;
        return (
          <div key={i} style={{
            flex: 1, borderRadius: 2,
            background: active ? (isCurrent ? T.accent : T.accent + "60") : T.panelBorder,
            display: "flex", alignItems: "center", justifyContent: "center",
            border: isCurrent ? `1px solid ${T.accent}` : "none",
            transition: "all 0.3s",
          }}>
            <span style={{
              fontSize: 7, fontFamily: FONT, fontWeight: 700,
              color: active ? T.bg : T.textDim,
            }}>{types[i] || `L${i + 1}`}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── WIND INDICATOR ──
function WindIndicator({ speed, direction }) {
  const rad = (direction - 90) * Math.PI / 180;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <svg width={28} height={28}>
        <circle cx={14} cy={14} r={12} fill="none" stroke={T.panelBorder} strokeWidth={0.5} />
        <line
          x1={14 + Math.cos(rad) * 10} y1={14 + Math.sin(rad) * 10}
          x2={14 - Math.cos(rad) * 6} y2={14 - Math.sin(rad) * 6}
          stroke={T.info} strokeWidth={1.5} strokeLinecap="round"
        />
        <circle cx={14 - Math.cos(rad) * 6} cy={14 - Math.sin(rad) * 6}
          r={2} fill={T.info} />
      </svg>
      <div>
        <div style={{ fontSize: 12, fontFamily: FONT, fontWeight: 700, color: T.textBright }}>{speed.toFixed(1)}<span style={{ fontSize: 9, color: T.textDim }}> m/s</span></div>
        <div style={{ fontSize: 9, fontFamily: FONT, color: T.textDim }}>{direction}° FROM</div>
      </div>
    </div>
  );
}

// ── MAIN LAYOUT ──
export default function Module18TacticalUI({ onBack }) {
  const [raw, setRaw] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [playIdx, setPlayIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [mapSize, setMapSize] = useState({ w: 600, h: 700 });
  const mapContainerRef = useRef(null);

  // Load real sim data
  useEffect(() => {
    fetch("/sim_data.json")
      .then(r => { if (!r.ok) throw new Error("not_found"); return r.json(); })
      .then(d => {
        if (!d.true_path || !Array.isArray(d.true_path) || d.true_path.length === 0) {
          throw new Error("invalid_data");
        }
        setRaw(d);
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  // Playback animation
  useEffect(() => {
    if (!playing || !raw) return;
    const interval = setInterval(() => {
      setPlayIdx(prev => {
        if (prev >= raw.true_path.length - 1) { setPlaying(false); return prev; }
        return Math.min(prev + speed, raw.true_path.length - 1);
      });
    }, 33);
    return () => clearInterval(interval);
  }, [playing, raw, speed]);

  // Keyboard: space, arrows
  useEffect(() => {
    const h = (e) => {
      if (!raw) return;
      if (e.key === "ArrowRight") { e.preventDefault(); setPlayIdx(p => Math.min(p + 1, raw.true_path.length - 1)); }
      if (e.key === "ArrowLeft") { e.preventDefault(); setPlayIdx(p => Math.max(p - 1, 0)); }
      if (e.key === " ") { e.preventDefault(); setPlaying(p => !p); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [raw]);

  // Map resize observer
  useEffect(() => {
    const el = mapContainerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setMapSize({ w: Math.floor(width), h: Math.floor(height) });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Loading state
  if (loading) return (
    <div style={{ background: T.bg, color: T.text, width: "100%", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT }}>
      <span style={{ color: T.textDim }}>LOADING SIMULATION DATA...</span>
    </div>
  );

  if (error) return (
    <div style={{ background: T.bg, color: T.text, width: "100%", height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: FONT, gap: 16 }}>
      <span style={{ color: T.danger, fontSize: 14 }}>NO SIMULATION DATA</span>
      <span style={{ color: T.textDim, fontSize: 12 }}>Run: python run_simulation.py --cone</span>
      {onBack && <button onClick={onBack} style={{ marginTop: 12, background: T.accentDim, border: `1px solid ${T.accent}40`, color: T.accent, padding: "8px 20px", borderRadius: 4, cursor: "pointer", fontFamily: FONT, fontSize: 12 }}>BACK</button>}
    </div>
  );

  // Transform raw data at current playback frame
  const data = useMemo(() => transformSimData(raw, playIdx), [raw, playIdx]);
  const chartW = 280;

  return (
    <div style={{
      width: "100%", height: "100vh", background: T.bg, color: T.text,
      fontFamily: FONT, display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      {/* ── TOP BAR ── */}
      <div style={{
        height: 40, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 16px", borderBottom: `1px solid ${T.panelBorder}`,
        background: T.panel, flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {onBack && (
            <button onClick={onBack} style={{ background: "none", border: "none", color: T.textDim, cursor: "pointer", fontFamily: FONT, fontSize: 10, padding: "2px 6px" }}>
              ← BACK
            </button>
          )}
          <span style={{ fontSize: 10, color: T.textDim, letterSpacing: 2 }}>RTR</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: T.textBright, letterSpacing: 1 }}>MODULE 18</span>
          <span style={{ fontSize: 10, color: T.textDim }}>GPS-DENIED NAV</span>
          <StatusBadge status="CONE" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 10, color: T.textDim }}>T={data.t.toFixed(1)}s / {data.duration.toFixed(0)}s</span>
          <StatusBadge status={data.outcome} />
        </div>
      </div>

      {/* ── MAIN CONTENT ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* ── LEFT: TACTICAL MAP ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div ref={mapContainerRef} style={{ flex: 1, position: "relative" }}>
            <TacticalMap data={data} width={mapSize.w} height={mapSize.h} />

            {/* Map legend overlay */}
            <div style={{
              position: "absolute", bottom: 12, left: 12,
              background: T.panel + "e0", borderRadius: 4, padding: "6px 10px",
              border: `1px solid ${T.panelBorder}`, display: "flex", gap: 12, alignItems: "center",
            }}>
              {[
                { color: T.true_path, label: "TRUE", dash: false },
                { color: T.est_path, label: "EST", dash: true },
                { color: T.landmark_detected, label: "LM \u2713", dash: false },
                { color: T.landmark_missed, label: "LM \u2717", dash: false },
              ].map(({ color, label, dash }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <svg width={16} height={2}>
                    <line x1={0} y1={1} x2={16} y2={1} stroke={color} strokeWidth={2}
                      strokeDasharray={dash ? "4,2" : "none"} />
                  </svg>
                  <span style={{ fontSize: 8, color: T.textDim, letterSpacing: 1 }}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Playback controls */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
            borderTop: `1px solid ${T.panelBorder}`, background: T.panel, flexShrink: 0,
          }}>
            <button onClick={() => setPlaying(!playing)} style={{
              background: T.accentDim, border: `1px solid ${T.accent}40`, color: T.accent,
              width: 32, height: 26, borderRadius: 4, cursor: "pointer", fontFamily: FONT,
              fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {playing ? "||" : "\u25B6"}
            </button>
            <button onClick={() => { setPlayIdx(0); setPlaying(false); }} style={{
              background: "none", border: `1px solid ${T.panelBorder}`, color: T.textDim,
              width: 32, height: 26, borderRadius: 4, cursor: "pointer", fontFamily: FONT, fontSize: 11,
            }}>
              \u21BA
            </button>
            <input
              type="range" min={0} max={raw.true_path.length - 1} value={playIdx}
              onChange={e => setPlayIdx(Number(e.target.value))}
              style={{ flex: 1, accentColor: T.accent, height: 6 }}
            />
            <select value={speed} onChange={e => setSpeed(Number(e.target.value))} style={{
              background: T.panel, color: T.text, border: `1px solid ${T.panelBorder}`,
              borderRadius: 4, padding: "2px 6px", fontSize: 10, fontFamily: FONT,
            }}>
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={5}>5x</option>
              <option value={10}>10x</option>
            </select>
            <span style={{ color: T.textDim, fontSize: 10, minWidth: 80, textAlign: "right", fontFamily: FONT }}>
              {data.t.toFixed(1)}s / {data.duration.toFixed(0)}s
            </span>
          </div>
        </div>

        {/* ── RIGHT: DASHBOARD ── */}
        <div style={{
          width: 320, borderLeft: `1px solid ${T.panelBorder}`, background: T.panel,
          overflow: "auto", padding: "8px 12px",
          display: "flex", flexDirection: "column", gap: 2,
        }}>

          {/* Primary metrics */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <MetricCard label="Est. Error" value={data.error.toFixed(1)} unit="m"
              status={data.error > 100 ? "danger" : data.error > 30 ? "warning" : "good"} />
            <MetricCard label="To Target" value={data.to_target.toFixed(0)} unit="m"
              status={data.to_target < 50 ? "good" : undefined} />
            <MetricCard label="EKF Updates" value={data.updates} status="good" small />
            <MetricCard label="Rejects" value={data.rejects}
              status={data.rejects > 10 ? "danger" : "good"} small />
          </div>

          {/* Mode + Status row */}
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 9, color: T.textDim, letterSpacing: 1 }}>MODE</span>
                <StatusBadge status={data.mode} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 9, color: T.textDim, letterSpacing: 1 }}>CONE</span>
                <StatusBadge status={data.status} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 9, color: T.textDim, letterSpacing: 1 }}>EKF</span>
                <StatusBadge status={data.ekf_state} />
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              <Compass heading={data.heading} size={60} />
            </div>
          </div>

          {/* Layer progression */}
          <SectionHeader icon={"\u25C6"}>Layer Progression</SectionHeader>
          <LayerProgress current={data.cone_layer.current} total={data.cone_layer.total} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
            <span style={{ fontSize: 9, color: T.textDim }}>{data.cone_layer.current}/{data.cone_layer.total} layers</span>
            <span style={{ fontSize: 9, color: T.accent }}>{data.progress}% complete</span>
          </div>

          {/* Navigation */}
          <SectionHeader icon={"\u25CE"}>Navigation</SectionHeader>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
            <DataRow label="True N" value={data.true_pos.n.toFixed(0)} unit="m" color={T.accent} />
            <DataRow label="True E" value={data.true_pos.e.toFixed(0)} unit="m" color={T.accent} />
            <DataRow label="Est N" value={data.est_pos.n.toFixed(0)} unit="m" color={T.est_path} />
            <DataRow label="Est E" value={data.est_pos.e.toFixed(0)} unit="m" color={T.est_path} />
            <DataRow label="Speed" value={data.speed.toFixed(1)} unit="m/s" />
            <DataRow label="Alt" value={data.true_pos.alt.toFixed(0)} unit="m" />
          </div>

          {/* Uncertainty */}
          <SectionHeader icon={"\u25CC"}>Uncertainty (3\u03C3)</SectionHeader>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
            <DataRow label="\u03C3_N" value={data.sigma.n.toFixed(1)} unit="m"
              color={data.sigma.n > 50 ? T.danger : data.sigma.n > 20 ? T.warning : T.accent} />
            <DataRow label="\u03C3_E" value={data.sigma.e.toFixed(1)} unit="m"
              color={data.sigma.e > 50 ? T.danger : data.sigma.e > 20 ? T.warning : T.accent} />
            <DataRow label="\u03C3_Alt" value={data.sigma.alt.toFixed(1)} unit="m" />
            <DataRow label="Lat Drift" value={data.lat_drift.toFixed(0)} unit="m"
              color={data.lat_drift > 100 ? T.danger : T.warning} />
          </div>

          {/* Cone constraint */}
          <SectionHeader icon={"\u25BD"}>Cone Constraint</SectionHeader>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
            <DataRow label="Radius" value={data.cone_r.toFixed(0)} unit="m" color={T.info} />
            <DataRow label="Margin" value={data.margin.toFixed(0)} unit="m"
              color={data.margin < 0 ? T.danger : T.accent} />
          </div>

          {/* Environment */}
          <SectionHeader icon={"\u2248"}>Environment</SectionHeader>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <WindIndicator speed={8.2} direction={94} />
          </div>

          {/* Position Error Chart */}
          <SectionHeader icon={"\u25B3"}>Position Error</SectionHeader>
          <MiniChart
            data={data.error_history} width={chartW} height={100}
            color={T.est_path} filled threshold={100}
            thresholdColor={T.danger} thresholdLabel="100m" yMax={Math.max(280, data.error * 1.2)}
          />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
            <span style={{ fontSize: 8, color: T.textDim }}>0s</span>
            <span style={{ fontSize: 8, color: T.textDim }}>{data.duration.toFixed(0)}s</span>
          </div>

          {/* NIS Chart */}
          <SectionHeader icon={"\u25C7"}>NIS (Innovation)</SectionHeader>
          <NISScatter
            data={data.nis_history} width={chartW} height={70}
            gate={9.21}
          />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
            <span style={{ fontSize: 8, color: T.textDim }}>Avg NIS: {data.nis_avg.toFixed(2)}</span>
            <span style={{ fontSize: 8, color: T.textDim }}>Gate: 9.21</span>
          </div>

        </div>
      </div>

      {/* ── BOTTOM BAR ── */}
      <div style={{
        height: 32, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 16px", borderTop: `1px solid ${T.panelBorder}`, background: T.panel,
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 9, color: T.textDim }}>CORRIDOR {(data.corridor / 1000).toFixed(0)}km</span>
          <span style={{ fontSize: 9, color: T.textDim }}>LM {data.landmarks_total}</span>
          <span style={{ fontSize: 9, color: T.textDim }}>COMPUTE {raw.compute_time}s</span>
        </div>
        <div style={{ flex: 1, margin: "0 20px" }}>
          <div style={{ height: 4, background: T.panelBorder, borderRadius: 2, position: "relative" }}>
            <div style={{
              height: 4, background: T.accent, borderRadius: 2,
              width: `${(data.t / data.duration) * 100}%`, transition: "width 0.3s",
            }} />
          </div>
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, color: T.textBright, fontFamily: FONT }}>
          {data.t.toFixed(1)}s / {data.duration.toFixed(0)}s
        </span>
      </div>
    </div>
  );
}
