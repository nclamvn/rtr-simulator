# RTR DroneVerse — Tactical UAV Simulator

Hệ thống mô phỏng UAV đa nhiệm vụ với AI tích hợp, bản đồ vệ tinh thực, và swarm intelligence.

## Tính năng

- **14 missions** (rescue, military, patrol) với multi-phase objectives
- **Bản đồ vệ tinh Esri** với tọa độ GPS thật (Tây Hoà, Quảng Bình, Trường Sa)
- **4 chế độ xem**: Map satellite / 3D Three.js / Radar PPI / Split
- **AI tích hợp** (Anthropic Claude + OpenAI fallback): scenario gen, tactical advisor, debrief
- **Swarm intelligence**: Reynolds Boids, knowledge graph, emergence detection
- **God Mode**: weather control, adversary spawn, GPS denial, fleet commands
- **Triage system**: 3-tier victim classification (P1/P2/P3)
- **Dark/Light theme** toggle
- **Vietnamese UI** đầy đủ

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 8, Three.js, MapLibre GL, Recharts |
| Backend | Express.js, helmet, express-rate-limit |
| AI | Anthropic Claude API + OpenAI fallback |
| Map | Esri World Imagery (free), MapLibre terrain |
| Deploy | Render.com |

## Cài đặt

```bash
git clone https://github.com/nclamvn/rtr-simulator.git
cd rtr-simulator
npm install
```

## Phát triển

```bash
# Frontend (port 5173)
npm run dev

# Server (port 3001) — cần cho AI features
node server.js

# Tests
npm test
```

## Deploy (Render.com)

1. Connect repo `nclamvn/rtr-simulator`
2. Build: `npm install --include=dev && npm run build`
3. Start: `npm start`
4. Env vars: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`

## Kiến trúc

```
src/
  DroneVerse.jsx          (799 lines — main UI orchestration)
  MapView.jsx             (125 lines — MapLibre satellite)
  droneverse/
    constants.js          Config, themes, Vietnamese labels
    api.js                AI proxy helper
    FlightDynamics.js     Physics engine
    SwarmController.js    Fleet AI + combat
    KnowledgeGraph.js     Entity-relationship tracking
    EmergenceDetector.js  Swarm pattern detection
    MissionPhaseEngine.js Multi-phase state machine
    missions.js           14 mission definitions
    RadarPPI.jsx          Radar canvas component
    Viewport3D.jsx        Three.js 3D viewport
    ErrorBoundary.jsx     React error boundary
    *.test.js             25 unit tests
server.js                 Express proxy + security
```

## Tests

```bash
npm test
# 25 tests across 4 files:
# FlightDynamics (7), SwarmController (7), KnowledgeGraph (6), MissionPhaseEngine (5)
```

## License

Proprietary — RTR (Real-Time Robotics)
