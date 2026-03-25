import {
  Shield, HeartPulse, ShieldPlus, Anchor, Target, Zap, Users, Radio,
  MapPin, Eye, Cpu, Brain,
} from "lucide-react";
import { gpsToM } from "./constants.js";

// ═══════════════════════════════════════════
// TÂY HOÀ MISSION DATA
// ═══════════════════════════════════════════
const TH_CENTER = [109.253, 12.752];
const TH_C = (lng, lat) => gpsToM(lng, lat, TH_CENTER[0], TH_CENTER[1]);

const TH_VICTIMS = [
  { pos: [109.24, 12.755], name: "Thôn Phước Thành", priority: 1, priorityLabel: "P1 — CỨU NGAY", color: "#ff2040", people: 45, detail: "12 người mắc kẹt nước xiết, 3 trẻ <5 tuổi, 2 bất tỉnh, 8 người già" },
  { pos: [109.26, 12.748], name: "Thôn Trung Hoà", priority: 1, priorityLabel: "P1 — CỨU NGAY", color: "#ff2040", people: 60, detail: "Kè sập 100m, 1 thai phụ 8 tháng, 5 chảy máu, 15 người già >70" },
  { pos: [109.22, 12.760], name: "Xóm cầu Dinh Ông", priority: 2, priorityLabel: "P2 — CỨU SỚM", color: "#ff8c00", people: 30, detail: "Trên mái nhà, kiệt sức 18h, thiếu nước, 4 bị thương nhẹ" },
  { pos: [109.28, 12.742], name: "Kè sông phía Nam", priority: 2, priorityLabel: "P2 — CỨU SỚM", color: "#ff8c00", people: 25, detail: "Gò đất cao, 2 trẻ sốt cao, thiếu ăn 24h" },
  { pos: [109.25, 12.765], name: "Trường TH Tây Hoà", priority: 3, priorityLabel: "P3 — CHỜ ĐƯỢC", color: "#00cc66", people: 40, detail: "Tầng 2 kiên cố, có tổ chức, còn lương thực 12h" },
];

const TH_LOGS = {
  1: ["🎖️ LỆNH BỘ QUỐC PHÒNG: Cứu hộ xã Tây Hoà, Phú Yên", "📍 Tình huống: Sông Ba xả lũ 16.100 m³/s, kè sập 100m, nhiều thôn bị cô lập", "🚶 Chiến sĩ di chuyển bộ 2km vượt sạt lở", "🚁 HERA-RECON-01 cất cánh — camera EO/IR", "📡 Link truyền dữ liệu Sở Chỉ Huy: ỔN ĐỊNH"],
  2: ["🔍 TRINH SÁT — Camera EO quang học + IR nhiệt", "📷 Scan line 1/8 — Bắc xã Tây Hoà", "🌡️ Camera nhiệt phát hiện cụm người Thôn Phước Thành", "⚠️ Ngập sâu 2m khu vực ven sông Ba", "📷 Scan line 4/8 — sạt lở bờ kè 100m", "🌡️ 5 CỤM NẠN NHÂN — tổng ~200 người"],
  3: ["📊 KẾT QUẢ PHÂN LOẠI:", "🔴 P1 CỨU NGAY: Phước Thành 45 người — nước xiết, trẻ nhỏ, bất tỉnh", "🔴 P1 CỨU NGAY: Trung Hoà 60 người — kè sập, thai phụ, chảy máu", "🟠 P2 CỨU SỚM: Cầu Dinh Ông 30 người — mái nhà, kiệt sức", "🟠 P2 CỨU SỚM: Kè sông Nam 25 người — gò đất, trẻ sốt", "🟢 P3 CHỜ ĐƯỢC: Trường TH 40 người — tầng 2, còn lương thực", "📊 TỔNG: 200 NGƯỜI — P1:105 | P2:55 | P3:40"],
  4: ["📦 THẢ HÀNG — ƯU TIÊN P1 TRƯỚC", "🔴 CARGO-01 → Phước Thành: Cứu thương + phao cứu sinh", "🔴 CARGO-02 → Trung Hoà: Kit sản khoa + nước + bạt mưa", "✅ P1 HOÀN TẤT — 105 người nguy cấp được cứu trợ", "🟠 CARGO-03 → Cầu Dinh Ông: Nước + lương khô + thuốc", "🟠 CARGO-04 → Kè sông Nam: Lương khô + thuốc hạ sốt", "✅ P2 HOÀN TẤT — 55 người được cứu trợ"],
  5: ["📡 ĐIỀU PHỐI MẶT ĐẤT", "📍 HERA-RECON-01 lên 300m — relay node", "🚁 GUIDE-01: Tuyến 1 → Phước Thành (tránh sạt lở)", "🚁 GUIDE-02: Tuyến 2 → Trung Hoà (qua cánh đồng)", "📡 Video realtime → lực lượng mặt đất xác nhận tín hiệu"],
  6: ["✅ NHIỆM VỤ CỨU TRỢ HOÀN TẤT", "📊 KẾT QUẢ: 200 người — 5 điểm — 4 chuyến thả hàng", "📊 P1: 105 người cứu trợ khẩn | P2: 55 người tiếp tế | P3: 40 người chờ", "🚁 Thu hồi fleet — 0 tổn thất"],
};

// ═══════════════════════════════════════════
// ALL MISSIONS
// ═══════════════════════════════════════════
export const MISSIONS = [
  { id: "tayho_bqp", name: "Cứu hộ Tây Hoà — Kịch bản BQP", domain: "RESCUE", icon: Shield, multi: true,
    center: TH_CENTER, zoom: 13, victims: TH_VICTIMS, phaseLogs: TH_LOGS,
    desc: "6 giai đoạn: cất cánh → trinh sát → phân loại → thả hàng → điều phối → thu hồi",
    drones: [{ id: "HERA-RECON-01", type: "HERA-S", ...TH_C(109.12, 12.72), alt: 100, hdg: 45 }],
    waypoints: [{ ...TH_C(109.15, 12.73), alt: 100 }, { ...TH_C(109.20, 12.75), alt: 150 }],
    threats: [{ ...TH_C(109.15, 12.76), radius: 600, type: "Sạt lở đường tiếp cận" }],
    phases: [
      { name: "GĐ1: Di chuyển & cất cánh", briefing: "Chiến sĩ vượt 2km sạt lở, drone cất cánh cách Tây Hoà 15km", weather: { windSpeed: 12, windDir: 90 }, objectives: [{ id: "th_launch", desc: "Drone cất cánh thành công", check: (dr) => dr.some(d => d.fd.speed > 3) }], transition: (pt) => pt > 30 },
      { name: "GĐ2: Trinh sát camera kép", briefing: "Camera EO+IR quét toàn bộ xã Tây Hoà — xác định nạn nhân",
        waypoints: [{ ...TH_C(109.22, 12.770), alt: 120 }, { ...TH_C(109.28, 12.770), alt: 120 }, { ...TH_C(109.28, 12.760), alt: 120 }, { ...TH_C(109.22, 12.760), alt: 120 }, { ...TH_C(109.22, 12.750), alt: 120 }, { ...TH_C(109.28, 12.750), alt: 120 }, { ...TH_C(109.28, 12.740), alt: 120 }, { ...TH_C(109.22, 12.740), alt: 120 }],
        threats: [{ ...TH_C(109.23, 12.750), radius: 800, type: "Ngập sâu 2m — sông Ba tràn bờ" }, { ...TH_C(109.26, 12.755), radius: 500, type: "Sạt lở bờ kè" }, { ...TH_C(109.20, 12.758), radius: 400, type: "Gió giật cấp 8" }],
        objectives: [{ id: "th_scan", desc: "Quét 8/8 scan lines — phát hiện 5 cụm nạn nhân", check: (dr) => { const f=dr.filter(d=>d.status==="ACTIVE"&&d.memory); return f.length>0&&f.reduce((s,d)=>s+d.memory.sectorsVisited.size,0)/f.length>=3; } }],
        transition: (_, __, ___, os) => os["th_scan"] },
      { name: "GĐ3: Đánh dấu & phân loại triage", briefing: "5 cụm nạn nhân: P1(105) P2(55) P3(40) — truyền GPS về SCH",
        spawns: [{ id: "HERA-RECON-02", type: "HERA-S", ...TH_C(109.10, 12.78), alt: 80, hdg: 120 }, { id: "HERA-RECON-03", type: "HERA-S", ...TH_C(109.11, 12.77), alt: 80, hdg: 115 }],
        waypoints: TH_VICTIMS.map(v => ({ ...TH_C(v.pos[0], v.pos[1]), alt: 80 })),
        objectives: [{ id: "th_mark", desc: "Đánh dấu 5/5 cụm nạn nhân", check: (dr) => { const f=dr.filter(d=>d.status==="ACTIVE"&&d.memory); return f.length>0&&f.reduce((s,d)=>s+d.memory.sectorsVisited.size,0)>=f.length*3; } }, { id: "th_class", desc: "Phân loại: P1(105) P2(55) P3(40)", check: () => false }],
        transition: (pt) => pt > 25 },
      { name: "GĐ4: Thả hàng cứu trợ — P1 trước", briefing: "4 HERA-C cargo + 2 VEGA-X hộ tống — ưu tiên CRITICAL",
        spawns: [{ id: "HERA-CARGO-01", type: "HERA-C", ...TH_C(109.10, 12.78), alt: 60, hdg: 120 }, { id: "HERA-CARGO-02", type: "HERA-C", ...TH_C(109.11, 12.78), alt: 60, hdg: 118 }, { id: "HERA-CARGO-03", type: "HERA-C", ...TH_C(109.10, 12.77), alt: 60, hdg: 125 }, { id: "HERA-CARGO-04", type: "HERA-C", ...TH_C(109.11, 12.77), alt: 60, hdg: 122 }, { id: "VEGA-ESCORT-01", type: "VEGA-X", ...TH_C(109.10, 12.79), alt: 100, hdg: 120 }, { id: "VEGA-ESCORT-02", type: "VEGA-X", ...TH_C(109.11, 12.79), alt: 100, hdg: 118 }],
        cargoWP: TH_VICTIMS.filter(v => v.priority <= 2).map(v => ({ ...TH_C(v.pos[0], v.pos[1]), alt: 30 })),
        weather: { windSpeed: 15, windDir: 90 },
        threats: [{ ...TH_C(109.20, 12.758), radius: 400, type: "Gió giật cấp 8" }, { ...TH_C(109.27, 12.740), radius: 300, type: "Đường dây điện đứt" }],
        objectives: [
          { id: "th_p1a", desc: "Thả cứu thương → Phước Thành (P1, 45 người)", check: (dr) => dr.filter(d=>d.typeKey==="HERA-C"&&d.status==="ACTIVE").some(d=>Math.hypot(d.fd.x-TH_C(109.24,12.755).x, d.fd.y-TH_C(109.24,12.755).y)<80) },
          { id: "th_p1b", desc: "Thả nước+kit sản khoa → Trung Hoà (P1, 60 người)", check: (dr) => dr.filter(d=>d.typeKey==="HERA-C"&&d.status==="ACTIVE").some(d=>Math.hypot(d.fd.x-TH_C(109.26,12.748).x, d.fd.y-TH_C(109.26,12.748).y)<80) },
          { id: "th_p2a", desc: "Thả nhu yếu phẩm → Cầu Dinh Ông (P2, 30 người)", check: (dr) => dr.filter(d=>d.typeKey==="HERA-C"&&d.status==="ACTIVE").some(d=>Math.hypot(d.fd.x-TH_C(109.22,12.760).x, d.fd.y-TH_C(109.22,12.760).y)<80) },
          { id: "th_p2b", desc: "Thả thuốc+lương khô → Kè sông Nam (P2, 25 người)", check: (dr) => dr.filter(d=>d.typeKey==="HERA-C"&&d.status==="ACTIVE").some(d=>Math.hypot(d.fd.x-TH_C(109.28,12.742).x, d.fd.y-TH_C(109.28,12.742).y)<80) },
        ],
        transition: (_, __, ___, os) => os["th_p1a"] && os["th_p1b"] && os["th_p2a"] && os["th_p2b"] },
      { name: "GĐ5: Điều phối mặt đất", briefing: "Relay dữ liệu realtime — dẫn đường lực lượng cứu hộ mặt đất",
        spawns: [{ id: "HERA-GUIDE-01", type: "HERA-S", ...TH_C(109.15, 12.76), alt: 50, hdg: 90 }, { id: "HERA-GUIDE-02", type: "HERA-S", ...TH_C(109.16, 12.75), alt: 50, hdg: 85 }],
        waypoints: [{ ...TH_C(109.17, 12.755), alt: 50 }, { ...TH_C(109.20, 12.752), alt: 50 }, { ...TH_C(109.24, 12.755), alt: 50 }, { ...TH_C(109.18, 12.748), alt: 50 }, { ...TH_C(109.22, 12.745), alt: 50 }, { ...TH_C(109.26, 12.748), alt: 50 }],
        clearThreats: true,
        objectives: [{ id: "th_relay", desc: "Relay node RECON-01 tại 300m", check: () => false }, { id: "th_gd1", desc: "Dẫn đường tuyến 1 → Phước Thành", check: () => false }, { id: "th_gd2", desc: "Dẫn đường tuyến 2 → Trung Hoà", check: () => false }],
        transition: (pt) => pt > 25 },
      { name: "GĐ6: Thu hồi fleet — RTB", briefing: "Nhiệm vụ hoàn tất — 200 người cứu trợ — thu hồi toàn bộ drone",
        waypoints: [{ ...TH_C(109.12, 12.72), alt: 100 }], weather: { windSpeed: 8, windDir: 90 },
        objectives: [{ id: "th_rtb", desc: "Toàn bộ fleet RTB — 0 tổn thất", check: (dr) => { const f=dr.filter(d=>d.spec.iff==="FRIENDLY"&&d.status==="ACTIVE"); const lp=TH_C(109.12,12.72); return f.filter(d=>Math.hypot(d.fd.x-lp.x,d.fd.y-lp.y)<200).length>=f.length*0.8; } }],
        transition: (_, __, ___, os) => os["th_rtb"] },
    ],
  },
  { id: "flood_qb", name: "Lũ lụt Quảng Bình", domain: "RESCUE", icon: HeartPulse, multi: true, center: [106.60, 17.47], zoom: 12, desc: "4 giai đoạn: trinh sát → xác định nạn nhân → cứu hộ → rút lui",
    drones: Array.from({ length: 6 }, (_, i) => ({ id: `TS-${i+1}`, type: "HERA-S", x: -20+i*8, y: -20, alt: 150, hdg: 45 })),
    waypoints: [{ x: 200, y: 150, alt: 150 }, { x: -150, y: 200, alt: 140 }, { x: 250, y: -100, alt: 160 }, { x: -200, y: -150, alt: 130 }, { x: 100, y: 250, alt: 150 }, { x: -100, y: 100, alt: 140 }],
    threats: [{ x: 200, y: 150, radius: 80, type: "Vùng ngập sâu" }, { x: -150, y: 250, radius: 50, type: "Sạt lở" }],
    phases: [
      { name: "Trinh sát vùng lũ", briefing: "6 drone trinh sát 6 điểm dân cư bị cô lập", weather: { windSpeed: 15, windDir: 90 }, objectives: [{ id: "scout", desc: "Trinh sát 6 điểm dân cư", check: (dr) => dr.filter(d=>d.spec.iff==="FRIENDLY"&&d.status==="ACTIVE").every(d=>d.fd.speed>3) }], transition: (pt) => pt > 20 },
      { name: "Xác định nạn nhân", briefing: "Tăng cường tìm kiếm, định vị cụm nạn nhân", spawns: [{ id: "TS-7", type: "HERA-S", x: 0, y: -30, alt: 150, hdg: 45 }, { id: "TS-8", type: "HERA-S", x: 10, y: -30, alt: 150, hdg: 45 }], waypoints: [{ x: 180, y: 120, alt: 130 }, { x: -120, y: 180, alt: 120 }, { x: 220, y: -80, alt: 140 }, { x: -180, y: -120, alt: 130 }], threats: [{ x: 50, y: 100, radius: 60, type: "Gió giật" }], objectives: [{ id: "locate", desc: "Định vị 4 cụm nạn nhân", check: (dr) => { const f=dr.filter(d=>d.spec.iff==="FRIENDLY"&&d.status==="ACTIVE"&&d.memory); return f.length>0&&f.reduce((s,d)=>s+d.memory.sectorsVisited.size,0)/f.length>=4; } }], transition: (_,__,___,os) => os["locate"] },
      { name: "Cứu hộ & Vận chuyển", briefing: "4 drone cargo + 2 hộ tống triển khai cứu trợ", spawns: [{ id: "CH-1", type: "HERA-C", x: 0, y: -40, alt: 100, hdg: 45 }, { id: "CH-2", type: "HERA-C", x: 10, y: -40, alt: 100, hdg: 45 }, { id: "CH-3", type: "HERA-C", x: 20, y: -40, alt: 100, hdg: 45 }, { id: "CH-4", type: "HERA-C", x: 30, y: -40, alt: 100, hdg: 45 }, { id: "HT-1", type: "VEGA-X", x: -10, y: -50, alt: 160, hdg: 45 }, { id: "HT-2", type: "VEGA-X", x: 40, y: -50, alt: 160, hdg: 45 }], cargoWP: [{ x: 180, y: 120, alt: 100 }, { x: -120, y: 180, alt: 100 }, { x: 220, y: -80, alt: 100 }, { x: -180, y: -120, alt: 100 }], objectives: [{ id: "deliver", desc: "Giao hàng cứu trợ 4 điểm", check: (dr) => { const c=dr.filter(d=>d.typeKey==="HERA-C"&&d.status==="ACTIVE"); return c.length>0&&c.every(d=>{ const wp=[[180,120],[-120,180],[220,-80],[-180,-120]]; return wp.some(w=>Math.hypot(d.fd.x-w[0],d.fd.y-w[1])<40); }); } }], transition: (_,__,___,os) => os["deliver"] },
      { name: "Rút lui an toàn", briefing: "Toàn bộ fleet RTB về Sở Chỉ Huy", waypoints: [{ x: 0, y: 0, alt: 120 }], clearThreats: true, weather: { windSpeed: 5, windDir: 90 }, objectives: [{ id: "rtb_safe", desc: "80% fleet về căn cứ", check: (dr) => { const f=dr.filter(d=>d.spec.iff==="FRIENDLY"&&d.status==="ACTIVE"); return f.filter(d=>Math.hypot(d.fd.x,d.fd.y)<80).length>=f.length*0.8; } }], transition: (_,__,___,os) => os["rtb_safe"] },
    ],
  },
  { id: "landslide_qn", name: "Sạt lở Quảng Nam", domain: "RESCUE", icon: ShieldPlus, multi: true, center: [107.88, 15.52], zoom: 13, desc: "3 giai đoạn: đánh giá → tìm kiếm → vận chuyển y tế",
    drones: Array.from({ length: 4 }, (_, i) => ({ id: `SL-S${i+1}`, type: "HERA-S", x: -10+i*8, y: -15, alt: 140, hdg: 30 })),
    waypoints: [{ x: 150, y: 180, alt: 120 }, { x: 200, y: 220, alt: 130 }, { x: 100, y: 250, alt: 120 }],
    threats: [{ x: 180, y: 200, radius: 100, type: "Sạt lở chính" }, { x: 120, y: 280, radius: 70, type: "Nguy cơ sạt thêm" }],
    phases: [
      { name: "Đánh giá hiện trường", briefing: "4 drone trinh sát vùng sạt lở", weather: { windSpeed: 8, windDir: 45 }, objectives: [{ id: "assess", desc: "Đánh giá hiện trường sạt lở", check: () => true }], transition: (pt) => pt > 15 },
      { name: "Tìm kiếm người mất tích", briefing: "Quét toàn bộ khu vực — tìm nạn nhân", spawns: [...Array.from({ length: 4 }, (_, i) => ({ id: `SL-S${i+5}`, type: "HERA-S", x: i*10, y: -25, alt: 130, hdg: 30 })), { id: "SL-C1", type: "HERA-C", x: -20, y: -30, alt: 100, hdg: 30 }, { id: "SL-C2", type: "HERA-C", x: 20, y: -30, alt: 100, hdg: 30 }], waypoints: [{ x: 100, y: 150, alt: 100 }, { x: 200, y: 150, alt: 110 }, { x: 200, y: 250, alt: 100 }, { x: 100, y: 250, alt: 110 }], objectives: [{ id: "search", desc: "Quét 10/16 sectors", check: (dr) => { const f=dr.filter(d=>d.spec.iff==="FRIENDLY"&&d.status==="ACTIVE"&&d.memory); const total=new Set(); f.forEach(d=>d.memory.sectorsVisited.forEach(s=>total.add(s))); return total.size>=10; } }], transition: (_,__,___,os) => os["search"] },
      { name: "Vận chuyển cấp cứu", briefing: "HERA-C bay đến 3 điểm y tế", cargoWP: [{ x: 150, y: 180, alt: 80 }, { x: 200, y: 220, alt: 80 }, { x: 100, y: 250, alt: 80 }], clearThreats: true, objectives: [{ id: "medevac", desc: "Hoàn thành 3 chuyến y tế", check: (dr) => { const c=dr.filter(d=>d.typeKey==="HERA-C"&&d.status==="ACTIVE"); return c.length>0&&c.every(d=>[[150,180],[200,220],[100,250]].some(w=>Math.hypot(d.fd.x-w[0],d.fd.y-w[1])<40)); } }], transition: (_,__,___,os) => os["medevac"] },
    ],
  },
  { id: "patrol_ts", name: "Tuần tra Trường Sa", domain: "MIL", icon: Anchor, multi: true, center: [114.35, 10.38], zoom: 9, desc: "3 giai đoạn: trinh sát biển → phát hiện tàu lạ → báo cáo RTB",
    drones: [...Array.from({ length: 6 }, (_, i) => ({ id: `TT-S${i+1}`, type: "HERA-S", x: -30+i*12, y: -20, alt: 200, hdg: 0 })), { id: "TT-V1", type: "VEGA-X", x: -20, y: -40, alt: 250, hdg: 0 }, { id: "TT-V2", type: "VEGA-X", x: 20, y: -40, alt: 250, hdg: 0 }],
    waypoints: [{ x: -250, y: -250, alt: 200 }, { x: 250, y: -250, alt: 200 }, { x: 250, y: 250, alt: 200 }, { x: -250, y: 250, alt: 200 }], threats: [],
    phases: [
      { name: "Trinh sát vùng biển", briefing: "8 drone tuần tra vùng biển Trường Sa", weather: { windSpeed: 12, windDir: 180 }, objectives: [{ id: "patrol", desc: "Hoàn thành vòng tuần tra", check: () => true }], transition: (pt) => pt > 20 },
      { name: "Phát hiện tàu lạ", briefing: "4 tàu không xác định — VEGA-X tiếp cận xác minh", spawns: [{ id: "TL-1", type: "BOGEY", x: 320, y: 280, alt: 150, hdg: 225 }, { id: "TL-2", type: "BOGEY", x: 300, y: -300, alt: 160, hdg: 135 }, { id: "TL-3", type: "BOGEY", x: -310, y: 270, alt: 140, hdg: 315 }, { id: "TL-4", type: "BOGEY", x: -290, y: -280, alt: 170, hdg: 45 }], threats: [{ x: 0, y: 200, radius: 90, type: "Vùng tranh chấp" }], objectives: [{ id: "identify", desc: "Xác minh 4 mục tiêu", check: (dr) => { const h=dr.filter(d=>d.id.startsWith("TL")); return h.length>0&&h.every(d=>d.status==="ELIMINATED"); } }], transition: (_,__,___,os) => os["identify"] },
      { name: "Báo cáo & RTB", briefing: "Hoàn thành báo cáo — fleet về căn cứ", waypoints: [{ x: 0, y: 0, alt: 150 }], clearThreats: true, objectives: [{ id: "rtb_ts", desc: "80% fleet RTB an toàn", check: (dr) => { const f=dr.filter(d=>d.spec.iff==="FRIENDLY"&&d.status==="ACTIVE"); return f.filter(d=>Math.hypot(d.fd.x,d.fd.y)<80).length>=f.length*0.8; } }], transition: (_,__,___,os) => os["rtb_ts"] },
    ],
  },
  { id: "alpha", name: "Alpha Recon", domain: "MIL", icon: Target, desc: "8 drones ISR — 1 BOGEY in AO", drones: [{ id: "HERA-01", type: "HERA-S", x: -50, y: -50, alt: 200, hdg: 45 }, { id: "HERA-02", type: "HERA-S", x: -30, y: -60, alt: 180, hdg: 50 }, { id: "HERA-03", type: "HERA-S", x: 20, y: -40, alt: 220, hdg: 90 }, { id: "HERA-04", type: "HERA-S", x: 40, y: -30, alt: 190, hdg: 85 }, { id: "VEGA-01", type: "VEGA-X", x: 0, y: -80, alt: 300, hdg: 10 }, { id: "VEGA-02", type: "VEGA-X", x: -20, y: -90, alt: 280, hdg: 5 }, { id: "HERA-C1", type: "HERA-C", x: -100, y: -100, alt: 100, hdg: 45 }, { id: "BOGEY-1", type: "BOGEY", x: 280, y: 200, alt: 250, hdg: 210 }], waypoints: [{ x: 200, y: 150, alt: 200 }, { x: 300, y: -100, alt: 250 }, { x: 100, y: -250, alt: 180 }, { x: -150, y: -100, alt: 200 }], threats: [{ x: 260, y: 60, radius: 80, type: "SAM" }, { x: -100, y: 200, radius: 60, type: "EWR" }] },
  { id: "swarm", name: "Swarm Assault", domain: "MIL", icon: Zap, desc: "20+4 saturate target zone", drones: [...Array.from({ length: 20 }, (_, i) => ({ id: `SW-${String(i+1).padStart(2,"0")}`, type: i<12?"VEGA-X":i<16?"HERA-S":"HERA-C", x: -200+(i%5)*35, y: -250+Math.floor(i/5)*35, alt: 150+Math.random()*100, hdg: 30+Math.random()*20 })), { id: "BOGEY-A", type: "BOGEY", x: 300, y: 250, alt: 200, hdg: 240 }, { id: "BOGEY-B", type: "BOGEY", x: 280, y: 280, alt: 180, hdg: 250 }, { id: "BOGEY-C", type: "BOGEY", x: 320, y: 230, alt: 220, hdg: 230 }, { id: "BOGEY-D", type: "BOGEY", x: 350, y: 260, alt: 190, hdg: 245 }], waypoints: [{ x: 280, y: 250, alt: 200 }, { x: 300, y: 200, alt: 260 }, { x: 260, y: 300, alt: 180 }], threats: [{ x: 280, y: 260, radius: 100, type: "SAM" }, { x: 350, y: 150, radius: 70, type: "AAA" }, { x: 200, y: 300, radius: 50, type: "MANPAD" }] },
  { id: "sar", name: "SAR Grid", domain: "DUAL", icon: Users, desc: "12 drones search & rescue", drones: Array.from({ length: 12 }, (_, i) => ({ id: `SAR-${String(i+1).padStart(2,"0")}`, type: i<8?"HERA-S":"HERA-C", x: -100+(i%4)*50, y: -200+Math.floor(i/4)*60, alt: 120+Math.random()*60, hdg: Math.random()*360 })), waypoints: [{ x: -200, y: -200, alt: 120 }, { x: 200, y: -200, alt: 120 }, { x: 200, y: 200, alt: 130 }, { x: -200, y: 200, alt: 130 }], threats: [] },
  { id: "ew", name: "EW Counter", domain: "MIL", icon: Radio, desc: "8 drones vs jamming zones", drones: Array.from({ length: 8 }, (_, i) => ({ id: `EW-${String(i+1).padStart(2,"0")}`, type: i<4?"VEGA-X":"HERA-S", x: -80+(i%3)*40, y: -100+Math.floor(i/3)*50, alt: 200+Math.random()*100, hdg: 60 })), waypoints: [{ x: 150, y: 100, alt: 250 }, { x: 200, y: -150, alt: 300 }, { x: -50, y: -200, alt: 200 }], threats: [{ x: 100, y: 0, radius: 120, type: "GPS-J" }, { x: -50, y: 150, radius: 90, type: "RF-J" }, { x: 250, y: -50, radius: 70, type: "SPOOF" }] },
  { id: "medevac", name: "Medical Delivery", domain: "CIV", icon: MapPin, desc: "6 drones — depot to 3 delivery pts", drones: [{ id: "CARGO-1", type: "HERA-C", x: -300, y: -200, alt: 120, hdg: 45 }, { id: "CARGO-2", type: "HERA-C", x: -290, y: -210, alt: 120, hdg: 45 }, { id: "CARGO-3", type: "HERA-C", x: -310, y: -190, alt: 120, hdg: 45 }, { id: "CARGO-4", type: "HERA-C", x: -280, y: -200, alt: 120, hdg: 45 }, { id: "ESC-01", type: "HERA-S", x: -320, y: -220, alt: 160, hdg: 45 }, { id: "ESC-02", type: "HERA-S", x: -270, y: -180, alt: 160, hdg: 45 }], waypoints: [{ x: -300, y: -200, alt: 120 }, { x: -100, y: -50, alt: 130 }, { x: 50, y: 100, alt: 140 }, { x: 250, y: 300, alt: 120 }], threats: [] },
  { id: "lightshow", name: "Light Show", domain: "CIV", icon: Eye, desc: "32 drones — circular formation", drones: Array.from({ length: 32 }, (_, i) => ({ id: `LS-${String(i+1).padStart(2,"0")}`, type: "HERA-S", x: -50+(i%8)*12, y: -50+Math.floor(i/8)*12, alt: 150, hdg: Math.random()*360 })), waypoints: Array.from({ length: 32 }, (_, i) => ({ x: Math.round(180*Math.cos(i*2*Math.PI/32)), y: Math.round(180*Math.sin(i*2*Math.PI/32)), alt: 150 })), threats: [] },
  { id: "pipeline", name: "Pipeline Inspect", domain: "CIV", icon: Cpu, desc: "6 drones — linear sweep 700m", drones: [{ id: "INS-01", type: "HERA-S", x: -350, y: -10, alt: 80, hdg: 90 }, { id: "INS-02", type: "HERA-S", x: -350, y: 10, alt: 80, hdg: 90 }, { id: "INS-03", type: "HERA-S", x: -340, y: -20, alt: 80, hdg: 90 }, { id: "INS-04", type: "HERA-S", x: -340, y: 20, alt: 80, hdg: 90 }, { id: "INS-C1", type: "HERA-C", x: -360, y: 0, alt: 100, hdg: 90 }, { id: "INS-C2", type: "HERA-C", x: -370, y: 0, alt: 100, hdg: 90 }], waypoints: Array.from({ length: 8 }, (_, i) => ({ x: -350+i*100, y: 0, alt: 80 })), threats: [] },
  { id: "border", name: "Border Patrol", domain: "MIL", icon: Shield, desc: "10 drones — 2 BOGEY incursion", drones: [...Array.from({ length: 6 }, (_, i) => ({ id: `BP-${String(i+1).padStart(2,"0")}`, type: "HERA-S", x: -200+(i%3)*40, y: -200+Math.floor(i/3)*40, alt: 200, hdg: 0 })), { id: "BP-V1", type: "VEGA-X", x: -100, y: -250, alt: 300, hdg: 0 }, { id: "BP-V2", type: "VEGA-X", x: 100, y: -250, alt: 300, hdg: 0 }, { id: "BOGEY-X", type: "BOGEY", x: 350, y: 300, alt: 200, hdg: 225 }, { id: "BOGEY-Y", type: "BOGEY", x: -350, y: 280, alt: 180, hdg: 315 }], waypoints: [{ x: -250, y: -250, alt: 200 }, { x: 250, y: -250, alt: 200 }, { x: 250, y: 250, alt: 200 }, { x: -250, y: 250, alt: 200 }], threats: [{ x: 200, y: 200, radius: 80, type: "RADAR" }, { x: -200, y: 200, radius: 70, type: "JAMMER" }] },
  { id: "svs", name: "Swarm vs Swarm", domain: "MIL", icon: Zap, multi: true, desc: "4-phase: deploy → advance → engage → extract",
    drones: [...Array.from({ length: 8 }, (_, i) => ({ id: `SV-V${i+1}`, type: "VEGA-X", x: -80+(i%4)*20, y: -180+Math.floor(i/4)*20, alt: 200, hdg: 0 })), ...Array.from({ length: 4 }, (_, i) => ({ id: `SV-S${i+1}`, type: "HERA-S", x: -50+i*25, y: -220, alt: 180, hdg: 0 }))],
    waypoints: [{ x: 0, y: -150, alt: 200 }], threats: [],
    phases: [
      { name: "Deploy", briefing: "Get all drones airborne", objectives: [{ id: "airborne", desc: "All drones airborne (speed > 5)", check: (dr) => dr.filter(d=>d.spec.iff==="FRIENDLY"&&d.status==="ACTIVE").every(d=>d.fd.speed>5) }], transition: (pt) => pt > 15 },
      { name: "Advance", briefing: "Move to engagement area", waypoints: [{ x: 150, y: 50, alt: 220 }], threats: [{ x: 200, y: 100, radius: 60, type: "RADAR" }], objectives: [{ id: "reach_ea", desc: "80% at engagement area", check: (dr) => { const f=dr.filter(d=>d.spec.iff==="FRIENDLY"&&d.status==="ACTIVE"); return f.filter(d=>Math.hypot(d.fd.x-150,d.fd.y-50)<80).length>=f.length*0.8; } }], transition: (_,__,___,os) => os["reach_ea"] },
      { name: "Engage", briefing: "Neutralize all hostiles", spawns: Array.from({ length: 6 }, (_, i) => ({ id: `SV-BG${i+1}`, type: "BOGEY", x: 280+(i%3)*25, y: 180+Math.floor(i/3)*25, alt: 200, hdg: 225 })), objectives: [{ id: "kill_all", desc: "All hostiles eliminated", check: (dr) => { const h=dr.filter(d=>d.spec.iff==="HOSTILE"); return h.length>0&&h.every(d=>d.status==="ELIMINATED"); } }], transition: (_,__,___,os) => os["kill_all"] },
      { name: "Extract", briefing: "RTB to origin", waypoints: [{ x: 0, y: 0, alt: 150 }], clearThreats: true, objectives: [{ id: "rtb", desc: "80% at origin", check: (dr) => { const f=dr.filter(d=>d.spec.iff==="FRIENDLY"&&d.status==="ACTIVE"); return f.filter(d=>Math.hypot(d.fd.x,d.fd.y)<80).length>=f.length*0.8; } }], transition: (_,__,___,os) => os["rtb"] },
    ],
  },
  { id: "escort", name: "Escort Convoy", domain: "DUAL", icon: Shield, multi: true, desc: "3-phase: form up → ambush → deliver",
    drones: [...Array.from({ length: 4 }, (_, i) => ({ id: `EC-C${i+1}`, type: "HERA-C", x: -300+i*15, y: -200+i*10, alt: 100, hdg: 45 })), ...Array.from({ length: 4 }, (_, i) => ({ id: `EC-S${i+1}`, type: "HERA-S", x: -320+i*20, y: -220+i*10, alt: 140, hdg: 45 })), { id: "EC-V1", type: "VEGA-X", x: -280, y: -180, alt: 160, hdg: 45 }, { id: "EC-V2", type: "VEGA-X", x: -330, y: -230, alt: 160, hdg: 45 }],
    waypoints: [], threats: [],
    phases: [
      { name: "Form Escort", briefing: "Establish convoy formation", cargoWP: [{ x: -300, y: -200, alt: 100 }, { x: -100, y: 0, alt: 110 }, { x: 100, y: 100, alt: 110 }, { x: 300, y: 200, alt: 100 }], objectives: [{ id: "formed", desc: "Escort formation established", check: () => true }], transition: (pt) => pt > 10 },
      { name: "Ambush", briefing: "Repel hostile ambush", spawns: [{ id: "AMB-1", type: "BOGEY", x: 0, y: 250, alt: 180, hdg: 180 }, { id: "AMB-2", type: "BOGEY", x: -50, y: 260, alt: 190, hdg: 180 }, { id: "AMB-3", type: "BOGEY", x: 0, y: -250, alt: 170, hdg: 0 }, { id: "AMB-4", type: "BOGEY", x: 50, y: -240, alt: 185, hdg: 0 }], threats: [{ x: 0, y: 100, radius: 70, type: "JAMMER" }, { x: -50, y: -50, radius: 50, type: "SAM" }], objectives: [{ id: "repel", desc: "All ambushers eliminated", check: (dr) => { const h=dr.filter(d=>d.id.startsWith("AMB")); return h.length>0&&h.every(d=>d.status==="ELIMINATED"); } }], transition: (_,__,___,os) => os["repel"] },
      { name: "Deliver", briefing: "Cargo to destination", clearThreats: true, objectives: [{ id: "delivered", desc: "All cargo at destination", check: (dr) => { const c=dr.filter(d=>d.typeKey==="HERA-C"&&d.status==="ACTIVE"); return c.length>0&&c.every(d=>Math.hypot(d.fd.x-300,d.fd.y-200)<50); } }], transition: (_,__,___,os) => os["delivered"] },
    ],
  },
  { id: "strike", name: "Strike Package", domain: "MIL", icon: Target, multi: true, desc: "3-phase: ingress → strike → egress",
    drones: [...Array.from({ length: 6 }, (_, i) => ({ id: `ST-V${i+1}`, type: "VEGA-X", x: -250+(i%3)*20, y: -250+Math.floor(i/3)*20, alt: 100, hdg: 45 })), ...Array.from({ length: 4 }, (_, i) => ({ id: `ST-ISR${i+1}`, type: "HERA-S", x: -280+i*15, y: -270, alt: 120, hdg: 45 })), { id: "ST-SEAD1", type: "HERA-S", x: -230, y: -280, alt: 130, hdg: 45 }, { id: "ST-SEAD2", type: "HERA-S", x: -240, y: -290, alt: 130, hdg: 45 }],
    waypoints: [{ x: -100, y: -80, alt: 100 }, { x: 50, y: 0, alt: 120 }, { x: 150, y: 80, alt: 130 }],
    threats: [{ x: 0, y: -50, radius: 70, type: "SAM" }, { x: 100, y: 30, radius: 60, type: "SAM" }, { x: -80, y: 50, radius: 50, type: "RADAR" }],
    phases: [
      { name: "Ingress", briefing: "Low-alt approach through SAM corridor", objectives: [{ id: "at_ip", desc: "80% at Initial Point", check: (dr) => { const f=dr.filter(d=>d.spec.iff==="FRIENDLY"&&d.status==="ACTIVE"); return f.filter(d=>Math.hypot(d.fd.x-150,d.fd.y-80)<80).length>=f.length*0.8; } }], transition: (_,__,___,os) => os["at_ip"] },
      { name: "Strike", briefing: "Engage 3 targets", strikeTargets: [{ x: 250, y: 120, alt: 100, id: "tgt_a" }, { x: 300, y: 180, alt: 100, id: "tgt_b" }, { x: 280, y: 250, alt: 100, id: "tgt_c" }], objectives: [{ id: "tgt_a", desc: "Target Alpha struck", check: (dr) => dr.some(d=>d.typeKey==="VEGA-X"&&d.status==="ACTIVE"&&Math.hypot(d.fd.x-250,d.fd.y-120)<20) }, { id: "tgt_b", desc: "Target Bravo struck", check: (dr) => dr.some(d=>d.typeKey==="VEGA-X"&&d.status==="ACTIVE"&&Math.hypot(d.fd.x-300,d.fd.y-180)<20) }, { id: "tgt_c", desc: "Target Charlie struck", check: (dr) => dr.some(d=>d.typeKey==="VEGA-X"&&d.status==="ACTIVE"&&Math.hypot(d.fd.x-280,d.fd.y-250)<20) }], transition: (_,__,___,os) => os["tgt_a"]&&os["tgt_b"]&&os["tgt_c"] },
      { name: "Egress", briefing: "RTB — avoid pursuit", waypoints: [{ x: -100, y: 100, alt: 120 }, { x: -200, y: 0, alt: 100 }, { x: 0, y: 0, alt: 100 }], spawns: [{ id: "PUR-1", type: "BOGEY", x: 350, y: 250, alt: 200, hdg: 225 }, { id: "PUR-2", type: "BOGEY", x: 320, y: 280, alt: 180, hdg: 225 }], clearThreats: true, objectives: [{ id: "egress", desc: "80% at origin (RTB)", check: (dr) => { const f=dr.filter(d=>d.spec.iff==="FRIENDLY"&&d.status==="ACTIVE"); return f.filter(d=>Math.hypot(d.fd.x,d.fd.y)<80).length>=f.length*0.8; } }], transition: (_,__,___,os) => os["egress"] },
    ],
  },
];
