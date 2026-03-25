export const PI2 = Math.PI * 2;
export const DEG = Math.PI / 180;

export const VI = {
  missions: "NHIỆM VỤ", fleet: "ĐỘI HÌNH", god: "CHỈ HUY", track: "THEO DÕI", noTrk: "CHƯA CHỌN",
  log: "NHẬT KÝ", battery: "PIN", altitude: "ĐỘ CAO", speed: "TỐC ĐỘ", signal: "TÍN HIỆU",
  heading: "HƯỚNG", bank: "NGHIÊNG", pause: "DỪNG", run: "CHẠY",
  friendly: "TA", hostile: "ĐỊCH", rescue: "CỨU HỘ", phase: "GIAI ĐOẠN", objective: "MỤC TIÊU",
  elapsed: "T.GIAN", weather: "THỜI TIẾT", adversary: "ĐỐI PHƯƠNG", electronic: "TÁC CHIẾN ĐT",
  fleetCmd: "LỆNH ĐỘI HÌNH", inject: "+ ĐE DỌA", spawnBogey: "MỤC TIÊU", gpsDeny: "CHẶN GPS",
  rtb: "VỀ CĂN CỨ", scatter: "PHÂN TÁN", formUp: "TẬP HỢP", report: "BÁO CÁO",
  aiDebrief: "AI PHÂN TÍCH", aiScenario: "AI TẠO KỊCH BẢN", aiAdvisor: "AI CỐ VẤN",
  graph: "ĐỒ THỊ TRI THỨC", emergence: "HÀNH VI NỔI TRỘI", experience: "KINH NGHIỆM",
  agentMem: "BỘ NHỚ AGENT", demo: "DEMO", missionComplete: "NHIỆM VỤ HOÀN THÀNH",
  subtitle: "Hệ thống mô phỏng UAV đa nhiệm vụ",
  clickTrack: "Chọn drone để theo dõi", selectMission: "Chọn nhiệm vụ",
};

export const THEMES = {
  dark: {
    bg: "#000000", bgPanel: "#000000", bgCard: "#0a0a0a", bgOverlay: "#0c1525ee",
    border: "#222", borderAccent: "#333",
    text: "#e0e8f0", textDim: "#90b0d0", textMuted: "#7090b0", textFaint: "#556070",
    accent: "#00e5ff", accentBg: "#00e5ff18", accentBorder: "#00e5ff60",
    danger: "#ff3b5c", dangerBg: "#ff3b5c30",
    success: "#00e878", successBg: "#00e87820",
    warn: "#ffb020", warnBg: "#ffb02030",
    purple: "#a855f7", purpleBg: "#a855f720",
    hostile: "#ff6b35",
    radar: { bg: "#000000", ring: "0,220,100", sweep: "0,255,120", blipFriendly: "0,255,140", blipHostile: "255,80,80", text: "0,255,140", overlay: "rgba(0,0,0,0.2)" },
    three: { clearColor: 0x070e1a, fog: 0x070e1a, ambient: 0x3050a0, grid1: 0x1a5050, grid2: 0x0a2a2a, terrain: 0x0a2a1a, ground: 0x041210 },
  },
  light: {
    bg: "#f0f2f5", bgPanel: "#ffffff", bgCard: "#e8ecf0", bgOverlay: "#ffffffee",
    border: "#d0d5dd", borderAccent: "#b0b8c4",
    text: "#1a1a2e", textDim: "#3a4a5e", textMuted: "#5a6a7e", textFaint: "#8090a0",
    accent: "#0077aa", accentBg: "#0077aa18", accentBorder: "#0077aa60",
    danger: "#cc2244", dangerBg: "#cc224418",
    success: "#0a8a4a", successBg: "#0a8a4a18",
    warn: "#aa6600", warnBg: "#aa660018",
    purple: "#7c3aed", purpleBg: "#7c3aed18",
    hostile: "#cc4400",
    radar: { bg: "#e8f0e8", ring: "0,100,50", sweep: "0,140,60", blipFriendly: "0,100,60", blipHostile: "200,40,40", text: "0,120,60", overlay: "rgba(232,240,232,0.25)" },
    three: { clearColor: 0xd8e0e8, fog: 0xd8e0e8, ambient: 0x8090b0, grid1: 0x90b0a0, grid2: 0xb0c8c0, terrain: 0x90b8a0, ground: 0xc0d8c8 },
  },
};

export const DRONE_SPECS = {
  "HERA-S": { name: "HERA Scout", maxSpeed: 22, cruiseSpeed: 15, maxAlt: 500, endurance: 45, rcs: 0.01, sensors: ["EO/IR","LiDAR"], color: "#00e5ff", iff: "FRIENDLY" },
  "HERA-C": { name: "HERA Cargo", maxSpeed: 16, cruiseSpeed: 11, maxAlt: 300, endurance: 30, rcs: 0.05, sensors: ["GPS","Alt"], color: "#ffb020", iff: "FRIENDLY" },
  "VEGA-X": { name: "Vega Combat", maxSpeed: 30, cruiseSpeed: 22, maxAlt: 800, endurance: 35, rcs: 0.008, sensors: ["EO/IR","SAR","ESM"], color: "#ff3b5c", iff: "FRIENDLY" },
  "BOGEY":  { name: "Unknown UAV", maxSpeed: 20, cruiseSpeed: 14, maxAlt: 400, endurance: 40, rcs: 0.03, sensors: [], color: "#ff6b35", iff: "HOSTILE" },
};

export function gpsToM(lng, lat, cLng, cLat) {
  const mLat = 111320, mLng = 111320 * Math.cos(cLat * DEG);
  return { x: Math.round((lng - cLng) * mLng), y: Math.round((lat - cLat) * mLat) };
}

export function compassLabel(deg) {
  const dirs = ["N","NE","E","SE","S","SW","W","NW"];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}
