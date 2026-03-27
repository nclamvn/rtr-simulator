import { useState, useEffect, useRef } from "react";
import { THEMES } from "./droneverse/constants.js";
import {
  Navigation, AlertTriangle, Play, RotateCcw,
  Crosshair, Clock, Cpu, Zap, Shield, Download, ArrowLeft, Target,
  HelpCircle,
} from "lucide-react";

const COLORS = {
  true: "#1DE9B6",
  estimated: "#FF5252",
  error: "#7C4DFF",
  landmark: "#FFD740",
  nis_ok: "#1DE9B6",
  nis_warn: "#FFB020",
  nis_bad: "#FF5252",
  sigma: "rgba(124,77,255,0.15)",
  grid: "#1a2a3a",
  cone: "rgba(124,77,255,0.4)",
};

// ── Tooltip helper ──
function Tip({ text, children, T }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: "relative", cursor: "help" }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <span style={{
          position: "absolute", bottom: "120%", left: "50%", transform: "translateX(-50%)",
          background: T.bgCard, border: `1px solid ${T.border}`, color: T.text,
          padding: "4px 8px", borderRadius: 4, fontSize: 10, whiteSpace: "nowrap",
          zIndex: 100, pointerEvents: "none", boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
        }}>{text}</span>
      )}
    </span>
  );
}

export default function SimulationView({ theme = "dark", onBack }) {
  const T = THEMES[theme];
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [playIdx, setPlayIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [narrow, setNarrow] = useState(window.innerWidth < 900);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [showConfig, setShowConfig] = useState(false);
  const [simRunning, setSimRunning] = useState(false);
  const [cfgDuration, setCfgDuration] = useState(120);
  const [cfgCorridor, setCfgCorridor] = useState(5);
  const [cfgSeed, setCfgSeed] = useState(42);
  const [cfgCone, setCfgCone] = useState(true);
  const dragRef = useRef({ dragging: false, lastX: 0, lastY: 0 });
  const canvasRef = useRef(null);
  const errorCanvasRef = useRef(null);
  const nisCanvasRef = useRef(null);

  // Responsive listener
  useEffect(() => {
    const h = () => setNarrow(window.innerWidth < 900);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  // P2-3: Restore playback position from session
  useEffect(() => {
    const saved = sessionStorage.getItem("sim_playIdx");
    if (saved && data) setPlayIdx(Math.min(Number(saved), data.true_path.length - 1));
  }, [data]);
  useEffect(() => { sessionStorage.setItem("sim_playIdx", String(playIdx)); }, [playIdx]);

  // Load simulation data with validation (P0-2)
  useEffect(() => {
    fetch("/sim_data.json")
      .then((r) => { if (!r.ok) throw new Error("not_found"); return r.json(); })
      .then((d) => {
        if (!d.true_path || !Array.isArray(d.true_path) || d.true_path.length === 0) {
          throw new Error("invalid_data");
        }
        setData(d);
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  // Animation
  useEffect(() => {
    if (!playing || !data) return;
    const interval = setInterval(() => {
      setPlayIdx((prev) => {
        if (prev >= data.true_path.length - 1) { setPlaying(false); return prev; }
        return Math.min(prev + speed, data.true_path.length - 1);
      });
    }, 33);
    return () => clearInterval(interval);
  }, [playing, data, speed]);

  // Keyboard shortcuts (P1: arrow keys step)
  useEffect(() => {
    const h = (e) => {
      if (!data) return;
      if (e.key === "ArrowRight") { e.preventDefault(); setPlayIdx(p => Math.min(p + 1, data.true_path.length - 1)); }
      if (e.key === "ArrowLeft") { e.preventDefault(); setPlayIdx(p => Math.max(p - 1, 0)); }
      if (e.key === " ") { e.preventDefault(); setPlaying(p => !p); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [data]);

  // ── Draw trajectory canvas ──
  useEffect(() => {
    if (!data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const W = canvas.width = canvas.offsetWidth * 2;
    const H = canvas.height = canvas.offsetHeight * 2;
    ctx.scale(2, 2);
    // P2-1: Apply zoom + pan
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);
    const w = W / 2 / zoom, h = H / 2 / zoom;

    const allN = data.true_path.map((p) => p[0]);
    const allE = data.true_path.map((p) => p[1]);
    const lmN = data.landmarks.map((l) => l.position[0]);
    const lmE = data.landmarks.map((l) => l.position[1]);
    const minN = Math.min(...allN, ...lmN) - 50;
    const maxN = Math.max(...allN, ...lmN, data.target[0]) + 50;
    const minE = Math.min(...allE, ...lmE) - 200;
    const maxE = Math.max(...allE, ...lmE) + 200;
    const scaleN = (h - 60) / (maxN - minN || 1);
    const scaleE = (w - 60) / (maxE - minE || 1);
    const sc = Math.min(scaleN, scaleE);
    const ox = 30 + (w - 60 - (maxE - minE) * sc) / 2;
    const oy = 30 + (h - 60 - (maxN - minN) * sc) / 2;
    const tx = (e) => ox + (e - minE) * sc;
    const ty = (n) => h - oy - (n - minN) * sc;

    ctx.fillStyle = T.bgCard;
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 0.5;
    const gridStep = Math.pow(10, Math.floor(Math.log10((maxN - minN) / 5)));
    for (let n = Math.ceil(minN / gridStep) * gridStep; n <= maxN; n += gridStep) {
      ctx.beginPath(); ctx.moveTo(tx(minE), ty(n)); ctx.lineTo(tx(maxE), ty(n)); ctx.stroke();
    }
    for (let e = Math.ceil(minE / gridStep) * gridStep; e <= maxE; e += gridStep) {
      ctx.beginPath(); ctx.moveTo(tx(e), ty(minN)); ctx.lineTo(tx(e), ty(maxN)); ctx.stroke();
    }

    // Cone boundary overlay
    if (data.cone && data.cone.layers) {
      const layers = data.cone.layers;
      ctx.strokeStyle = COLORS.cone;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      layers.forEach((l, i) => { if (i === 0) ctx.moveTo(tx(-l.radius), ty(l.center[0])); else ctx.lineTo(tx(-l.radius), ty(l.center[0])); });
      ctx.stroke();
      ctx.beginPath();
      layers.forEach((l, i) => { if (i === 0) ctx.moveTo(tx(l.radius), ty(l.center[0])); else ctx.lineTo(tx(l.radius), ty(l.center[0])); });
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(124,77,255,0.15)";
      ctx.lineWidth = 1;
      layers.forEach((l) => { ctx.beginPath(); ctx.moveTo(tx(-l.radius), ty(l.center[0])); ctx.lineTo(tx(l.radius), ty(l.center[0])); ctx.stroke(); });
    }

    // Landmarks
    data.landmarks.forEach((lm) => {
      ctx.beginPath();
      ctx.arc(tx(lm.position[1]), ty(lm.position[0]), 3, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.landmark;
      ctx.globalAlpha = 0.6;
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    // Target
    ctx.beginPath();
    ctx.arc(tx(data.target[1]), ty(data.target[0]), 8, 0, Math.PI * 2);
    ctx.strokeStyle = "#1DE9B6";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(tx(data.target[1]) - 12, ty(data.target[0]));
    ctx.lineTo(tx(data.target[1]) + 12, ty(data.target[0]));
    ctx.moveTo(tx(data.target[1]), ty(data.target[0]) - 12);
    ctx.lineTo(tx(data.target[1]), ty(data.target[0]) + 12);
    ctx.stroke();

    // Drop point
    ctx.beginPath();
    ctx.arc(tx(0), ty(0), 5, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.error;
    ctx.fill();

    // Paths with trail fade (P2-3)
    const idx = Math.min(playIdx, data.true_path.length - 1);
    if (idx > 0) {
      // True path — fade older segments
      const fadeStart = Math.max(0, idx - 80);
      for (let i = 1; i <= idx; i++) {
        const alpha = i < fadeStart ? 0.15 : 0.15 + 0.85 * ((i - fadeStart) / Math.max(idx - fadeStart, 1));
        ctx.beginPath();
        ctx.strokeStyle = COLORS.true;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 2;
        const [pn, pe] = data.true_path[i - 1];
        const [cn, ce] = data.true_path[i];
        ctx.moveTo(tx(pe), ty(pn));
        ctx.lineTo(tx(ce), ty(cn));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // Estimated path
      ctx.beginPath();
      ctx.strokeStyle = COLORS.estimated;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([4, 3]);
      for (let i = 0; i <= idx; i++) { const [n, e] = data.est_path[i]; if (i === 0) ctx.moveTo(tx(e), ty(n)); else ctx.lineTo(tx(e), ty(n)); }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // Current position dot
      const [cn, ce] = data.true_path[idx];
      ctx.beginPath();
      ctx.arc(tx(ce), ty(cn), 6, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.true;
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Legend
    const ly = 14;
    ctx.font = "11px monospace";
    ctx.fillStyle = COLORS.true; ctx.fillRect(8, ly, 14, 3);
    ctx.fillStyle = T.text; ctx.fillText("TRUE", 26, ly + 4);
    ctx.fillStyle = COLORS.estimated; ctx.fillRect(70, ly, 14, 3);
    ctx.fillStyle = T.text; ctx.fillText("EST", 88, ly + 4);
    ctx.fillStyle = COLORS.landmark; ctx.fillRect(120, ly, 6, 6);
    ctx.fillStyle = T.text; ctx.fillText("LM", 130, ly + 5);
    if (data.cone) {
      ctx.strokeStyle = COLORS.cone; ctx.lineWidth = 1.5; ctx.setLineDash([4,3]);
      ctx.beginPath(); ctx.moveTo(160, ly + 2); ctx.lineTo(174, ly + 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = T.text; ctx.fillText("CONE", 178, ly + 5);
    }

    // Scale bar
    ctx.fillStyle = T.textDim; ctx.font = "10px monospace";
    ctx.fillText(`${Math.round(maxN - minN)}m`, w - 50, h - 5);
  }, [data, playIdx, T, zoom, panX, panY]);

  // ── Draw error chart ──
  useEffect(() => {
    if (!data || !errorCanvasRef.current) return;
    const canvas = errorCanvasRef.current;
    const ctx = canvas.getContext("2d");
    const W = canvas.width = canvas.offsetWidth * 2;
    const H = canvas.height = canvas.offsetHeight * 2;
    ctx.scale(2, 2);
    const w = W / 2, h = H / 2;
    ctx.fillStyle = T.bgCard; ctx.fillRect(0, 0, w, h);
    if (data.errors.length < 2) return;
    const maxT = data.errors[data.errors.length - 1][0];
    const maxE = Math.max(...data.errors.map(([, e]) => e), 1);
    const px = (t) => 40 + (t / maxT) * (w - 50);
    const py = (e) => h - 25 - (e / maxE) * (h - 40);
    ctx.strokeStyle = COLORS.grid; ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) { const y = py(maxE * i / 4); ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(w - 10, y); ctx.stroke(); ctx.fillStyle = T.textFaint; ctx.font = "9px monospace"; ctx.fillText(`${(maxE * i / 4).toFixed(0)}m`, 2, y + 3); }
    const errIdx = Math.min(playIdx, data.errors.length - 1);
    if (data.sigma && data.sigma.length > 1) {
      const sigIdx = Math.min(Math.floor(playIdx * data.sigma.length / data.errors.length), data.sigma.length - 1);
      ctx.beginPath(); ctx.fillStyle = COLORS.sigma;
      for (let i = 0; i <= sigIdx; i++) { const [t, sN] = data.sigma[i]; if (i === 0) ctx.moveTo(px(t), py(sN * 3)); else ctx.lineTo(px(t), py(sN * 3)); }
      for (let i = sigIdx; i >= 0; i--) ctx.lineTo(px(data.sigma[i][0]), py(0));
      ctx.fill();
    }
    ctx.beginPath(); ctx.strokeStyle = COLORS.error; ctx.lineWidth = 1.5;
    for (let i = 0; i <= errIdx; i++) { const [t, e] = data.errors[i]; if (i === 0) ctx.moveTo(px(t), py(e)); else ctx.lineTo(px(t), py(e)); }
    ctx.stroke();
    ctx.fillStyle = T.textDim; ctx.font = "10px monospace";
    ctx.fillText("Est. Position Error (m)", 40, 12);
    ctx.fillText("Time (s)", w / 2 - 20, h - 3);
  }, [data, playIdx, T]);

  // ── Draw NIS chart ──
  useEffect(() => {
    if (!data || !nisCanvasRef.current) return;
    const canvas = nisCanvasRef.current;
    const ctx = canvas.getContext("2d");
    const W = canvas.width = canvas.offsetWidth * 2;
    const H = canvas.height = canvas.offsetHeight * 2;
    ctx.scale(2, 2);
    const w = W / 2, h = H / 2;
    ctx.fillStyle = T.bgCard; ctx.fillRect(0, 0, w, h);
    if (!data.nis || data.nis.length < 1) { ctx.fillStyle = T.textFaint; ctx.font = "11px monospace"; ctx.fillText("No NIS data yet", w / 2 - 40, h / 2); return; }
    const maxT = data.duration || data.nis[data.nis.length - 1][0];
    const maxNIS = Math.max(...data.nis.map(([, n]) => n), 10);
    const px = (t) => 40 + (t / maxT) * (w - 50);
    const py = (n) => h - 25 - (n / maxNIS) * (h - 40);
    ctx.strokeStyle = COLORS.nis_bad + "60"; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(40, py(9.21)); ctx.lineTo(w - 10, py(9.21)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = COLORS.nis_bad; ctx.font = "8px monospace"; ctx.fillText("GATE 9.21", w - 60, py(9.21) - 3);
    ctx.strokeStyle = T.textFaint + "60"; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(40, py(2)); ctx.lineTo(w - 10, py(2)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = T.textFaint; ctx.font = "7px monospace"; ctx.fillText("E[NIS]=2", w - 55, py(2) - 3);
    const tCurrent = data.errors[Math.min(playIdx, data.errors.length - 1)]?.[0] || 0;
    data.nis.forEach(([t, n]) => { if (t > tCurrent) return; ctx.beginPath(); ctx.arc(px(t), py(n), 3, 0, Math.PI * 2); ctx.fillStyle = n < 4 ? COLORS.nis_ok : n < 9.21 ? COLORS.nis_warn : COLORS.nis_bad; ctx.fill(); });
    ctx.fillStyle = T.textDim; ctx.font = "10px monospace"; ctx.fillText("NIS (Innovation)", 40, 12);
  }, [data, playIdx, T]);

  // ── Render ──

  if (loading) return (
    <div style={{ background: T.bg, color: T.text, width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace" }}>
      Loading simulation data...
    </div>
  );

  if (error) return (
    <div style={{ background: T.bg, color: T.text, width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "monospace", gap: 16, padding: 20, textAlign: "center" }}>
      <AlertTriangle size={32} color={T.danger || "#ff5252"} />
      <div style={{ fontSize: 16 }}>No simulation data available</div>
      <div style={{ color: T.textDim, fontSize: 13, maxWidth: 400 }}>
        {error === "invalid_data" ? "The simulation data file is empty or corrupted." : "Generate simulation data to visualize the GPS-denied navigation."}
      </div>
      <code style={{ background: T.bgCard, padding: "6px 12px", borderRadius: 4, fontSize: 12, color: T.textDim }}>python run_simulation.py --cone</code>
      {onBack && <button onClick={onBack} style={{ marginTop: 8, background: T.accentBg, border: `1px solid ${T.accentBorder}`, color: T.accent, padding: "8px 20px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", fontSize: 13 }}>Back to DroneVerse</button>}
    </div>
  );

  const idx = Math.min(playIdx, (data.true_path.length || 1) - 1);
  const currentErr = data.errors[Math.min(idx, data.errors.length - 1)]?.[1] || 0;
  const currentT = data.errors[Math.min(idx, data.errors.length - 1)]?.[0] || 0;
  const pct = data.true_path.length > 1 ? Math.round((idx / (data.true_path.length - 1)) * 100) : 0;
  const outcomeColor = data.outcome === "success" ? T.success : data.outcome === "timeout" ? T.warn : T.danger;
  const modeLabel = data.mode === "cone" ? "CONE" : "CORRIDOR";

  const S = {
    panel: { background: T.bgPanel, border: `1px solid ${T.border}`, borderRadius: 6, padding: narrow ? 6 : 10, fontFamily: "monospace", fontSize: 12 },
    label: { color: T.textMuted, fontSize: 10, textTransform: "uppercase", letterSpacing: 1, display: "flex", alignItems: "center", gap: 3 },
    value: { color: T.text, fontSize: narrow ? 15 : 18, fontWeight: 700 },
    smallValue: { color: T.text, fontSize: 13 },
  };

  // P1: Include config in Quick Export
  // P2-2: Run simulation from UI
  const handleRunSim = async () => {
    setSimRunning(true);
    try {
      const res = await fetch("/api/sim/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration: cfgDuration, corridor: cfgCorridor, seed: cfgSeed, cone: cfgCone }),
      });
      if (!res.ok) throw new Error("Server error");
      // Reload sim data
      const newData = await fetch("/sim_data.json").then(r => r.json());
      setData(newData);
      setPlayIdx(0);
      setPlaying(false);
      setShowConfig(false);
    } catch (e) {
      alert("Simulation failed. Make sure sim_server.py is running:\n  python sim_server.py");
    }
    setSimRunning(false);
  };

  const handleExport = () => {
    const exportData = { ...data, _exported_at: new Date().toISOString(), _config_note: "Re-run: python run_simulation.py --duration " + data.duration + " --corridor " + data.corridor_km + (data.mode === "cone" ? " --cone" : "") + " --seed 42" };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `sim_${data.mode}_${new Date().toISOString().slice(0, 19).replace(/[:-]/g, "")}.json`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div style={{ background: T.bg, color: T.text, width: "100%", height: "100%", display: "flex", flexDirection: "column", fontFamily: "monospace", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderBottom: `1px solid ${T.border}`, flexShrink: 0, flexWrap: "wrap" }}>
        {onBack && <button onClick={onBack} style={{ background: "none", border: "none", color: T.textDim, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}><ArrowLeft size={14} /> BACK</button>}
        <Navigation size={16} color={T.accent} />
        <span style={{ color: T.accent, fontWeight: 700, fontSize: 13 }}>MODULE 18</span>
        {!narrow && <span style={{ color: T.textDim, fontSize: 11 }}>GPS-DENIED NAV</span>}
        <span style={{ background: (data.mode === "cone" ? T.purple || "#a855f7" : T.accent) + "25", color: data.mode === "cone" ? T.purple || "#a855f7" : T.accent, padding: "1px 8px", borderRadius: 8, fontSize: 10, fontWeight: 600 }}>{modeLabel}</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={() => setShowConfig(!showConfig)} style={{ display: "flex", alignItems: "center", gap: 3, padding: "3px 8px", borderRadius: 4, border: `1px solid ${T.accent}60`, background: showConfig ? T.accentBg : "none", color: T.accent, cursor: "pointer", fontSize: 10, fontFamily: "monospace" }}>
            New Run
          </button>
          <button onClick={handleExport} style={{ display: "flex", alignItems: "center", gap: 3, padding: "3px 8px", borderRadius: 4, border: `1px solid ${T.border}`, background: T.bgCard, color: T.textDim, cursor: "pointer", fontSize: 10, fontFamily: "monospace" }}>
            <Download size={10} /> Export
          </button>
          <span style={{ background: outcomeColor + "25", color: outcomeColor, padding: "1px 8px", borderRadius: 8, fontSize: 10, fontWeight: 600, border: `1px solid ${outcomeColor}50`, textTransform: "uppercase" }}>{data.outcome}</span>
        </div>
      </div>
      {/* P2-2: Config panel */}
      {showConfig && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", borderBottom: `1px solid ${T.border}`, flexShrink: 0, background: T.bgCard, flexWrap: "wrap", fontSize: 11 }}>
          <label style={{ color: T.textDim }}>Duration
            <input type="number" value={cfgDuration} onChange={e => setCfgDuration(Number(e.target.value))} min={10} max={600} step={10} style={{ width: 50, marginLeft: 4, background: T.bg, color: T.text, border: `1px solid ${T.border}`, borderRadius: 3, padding: "2px 4px", fontSize: 11, fontFamily: "monospace" }} />s
          </label>
          <label style={{ color: T.textDim }}>Corridor
            <input type="number" value={cfgCorridor} onChange={e => setCfgCorridor(Number(e.target.value))} min={1} max={20} step={1} style={{ width: 40, marginLeft: 4, background: T.bg, color: T.text, border: `1px solid ${T.border}`, borderRadius: 3, padding: "2px 4px", fontSize: 11, fontFamily: "monospace" }} />km
          </label>
          <label style={{ color: T.textDim }}>Seed
            <input type="number" value={cfgSeed} onChange={e => setCfgSeed(Number(e.target.value))} min={1} max={9999} style={{ width: 45, marginLeft: 4, background: T.bg, color: T.text, border: `1px solid ${T.border}`, borderRadius: 3, padding: "2px 4px", fontSize: 11, fontFamily: "monospace" }} />
          </label>
          <label style={{ color: T.textDim, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
            <input type="checkbox" checked={cfgCone} onChange={e => setCfgCone(e.target.checked)} style={{ accentColor: T.accent }} /> Cone
          </label>
          <button onClick={handleRunSim} disabled={simRunning} style={{ padding: "3px 12px", borderRadius: 4, border: `1px solid ${T.success}60`, background: T.successBg, color: T.success, cursor: simRunning ? "wait" : "pointer", fontSize: 10, fontFamily: "monospace", fontWeight: 700, opacity: simRunning ? 0.5 : 1 }}>
            {simRunning ? "Running..." : "Run Simulation"}
          </button>
        </div>
      )}

      {/* Main content — responsive */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", flexDirection: narrow ? "column" : "row" }}>
        {/* Left: Trajectory Map */}
        <div style={{ flex: narrow ? "none" : 2, height: narrow ? "50%" : "auto", display: "flex", flexDirection: "column", borderRight: narrow ? "none" : `1px solid ${T.border}`, borderBottom: narrow ? `1px solid ${T.border}` : "none" }}>
          <canvas ref={canvasRef} style={{ flex: 1, width: "100%", cursor: dragRef.current.dragging ? "grabbing" : "grab" }}
            onWheel={(e) => { e.preventDefault(); setZoom(z => Math.max(0.5, Math.min(5, z * (e.deltaY < 0 ? 1.15 : 0.87)))); }}
            onMouseDown={(e) => { dragRef.current = { dragging: true, lastX: e.clientX, lastY: e.clientY }; }}
            onMouseMove={(e) => { if (!dragRef.current.dragging) return; setPanX(p => p + e.clientX - dragRef.current.lastX); setPanY(p => p + e.clientY - dragRef.current.lastY); dragRef.current.lastX = e.clientX; dragRef.current.lastY = e.clientY; }}
            onMouseUp={() => { dragRef.current.dragging = false; }}
            onMouseLeave={() => { dragRef.current.dragging = false; }}
            onDoubleClick={() => { setZoom(1); setPanX(0); setPanY(0); }}
          />
          {/* Playback controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
            <button onClick={() => setPlaying(!playing)} style={{ background: T.accentBg, border: `1px solid ${T.accentBorder}`, color: T.accent, width: 28, height: 24, borderRadius: 4, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {playing ? <span style={{ fontSize: 12 }}>||</span> : <Play size={12} />}
            </button>
            <button onClick={() => { setPlayIdx(0); setPlaying(false); }} style={{ background: "none", border: `1px solid ${T.border}`, color: T.textDim, width: 28, height: 24, borderRadius: 4, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <RotateCcw size={11} />
            </button>
            <input type="range" min={0} max={data.true_path.length - 1} value={idx} onChange={(e) => setPlayIdx(Number(e.target.value))} style={{ flex: 1, accentColor: T.accent, height: 8 }} />
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} style={{ background: T.bgCard, color: T.text, border: `1px solid ${T.border}`, borderRadius: 4, padding: "2px 4px", fontSize: 10 }}>
              <option value={1}>1x</option><option value={2}>2x</option><option value={5}>5x</option><option value={10}>10x</option>
            </select>
            <span style={{ color: T.textFaint, fontSize: 10, minWidth: 50, textAlign: "right" }}>{currentT.toFixed(1)}s/{data.duration.toFixed(0)}s</span>
          </div>
        </div>

        {/* Right: Panels */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1, overflow: "auto", minWidth: narrow ? "auto" : 260 }}>
          {/* Status cards */}
          <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr 1fr 1fr" : "1fr 1fr", gap: 4, padding: 6 }}>
            <div style={S.panel}>
              <Tip text="Difference between true and EKF-estimated position" T={T}><div style={S.label}><Crosshair size={9} /> Est. Error</div></Tip>
              <div style={{ ...S.value, color: currentErr < 10 ? T.success : currentErr < 50 ? T.warn : T.danger }}>{currentErr.toFixed(1)}m</div>
            </div>
            <div style={S.panel}>
              <div style={S.label}><Target size={9} /> To Target</div>
              <div style={S.value}>{data.final_error.toFixed(0)}m</div>
            </div>
            <div style={S.panel}>
              <Tip text="Successful EKF corrections from landmark observations" T={T}><div style={S.label}><Zap size={9} /> Updates</div></Tip>
              <div style={S.value}>{data.updates}</div>
            </div>
            {!narrow && <>
              <div style={S.panel}>
                <Tip text="Observations rejected by Mahalanobis gate (NIS > 9.21)" T={T}><div style={S.label}><Shield size={9} /> Rejects</div></Tip>
                <div style={S.value}>{data.rejects}</div>
              </div>
              <div style={S.panel}>
                <div style={S.label}><Clock size={9} /> Duration</div>
                <div style={S.smallValue}>{data.duration.toFixed(1)}s</div>
              </div>
              <div style={S.panel}>
                <div style={S.label}><Cpu size={9} /> Compute</div>
                <div style={S.smallValue}>{data.compute_time}s</div>
              </div>
            </>}
          </div>

          {/* Mission info */}
          <div style={{ ...S.panel, margin: "0 6px" }}>
            <div style={S.label}>Mission</div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: 11 }}>
              <span style={{ color: T.textDim }}>Corridor</span><span>{data.corridor_km}km</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
              <span style={{ color: T.textDim }}>Landmarks</span><span>{data.landmarks.length}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
              <span style={{ color: T.textDim }}>Progress</span><span>{pct}%</span>
            </div>
            {data.cone && data.cone.progress && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span style={{ color: T.textDim }}>Cone Layer</span>
                <span>{data.cone.progress.current_layer}/{data.cone.progress.total_layers}</span>
              </div>
            )}
          </div>

          {/* Error chart */}
          <div style={{ padding: "0 6px", flex: 1, minHeight: narrow ? 80 : 100 }}>
            <canvas ref={errorCanvasRef} style={{ width: "100%", height: "100%" }} />
          </div>

          {/* NIS chart */}
          <div style={{ padding: "0 6px 6px", flex: 1, minHeight: narrow ? 80 : 100 }}>
            <canvas ref={nisCanvasRef} style={{ width: "100%", height: "100%" }} />
          </div>
        </div>
      </div>
    </div>
  );
}
