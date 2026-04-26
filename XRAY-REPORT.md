# RTR DRONEVERSE — X-RAY REPORT (FULL)

> Generated: 2026-04-26 | Analyzer: Claude Opus 4.6
> Scope: Full codebase audit — architecture, performance, security, tests, optimization roadmap

---

## 1. PROJECT IDENTITY

| Metric | Value |
|--------|-------|
| Name | RTR DroneVerse — Tactical UAV Simulator |
| Purpose | GPS-denied UAV navigation simulation + tactical C2 interface |
| Repository | github.com/nclamvn/rtr-simulator |
| Branch | `main` (single branch, linear history) |
| Total commits | 36 |
| Lifespan | 2026-03-24 → 2026-04-26 (33 days) |
| License | Proprietary — Real-Time Robotics |
| Deploy | Render.com (Node 22 + Docker) |

---

## 2. CODEBASE METRICS

### Lines of Code

| Language | Source LOC | Test LOC | Files |
|----------|-----------|----------|-------|
| Python (physics engine) | 7,156 | 4,084 | 48 |
| JavaScript/JSX (frontend) | 4,040 | 228 | 20 |
| CSS | 23 | — | 1 |
| HTML | 27 | — | 1 |
| JSON (config) | 4,510 | — | 3 |
| **Total** | **~15,756** | **4,312** | **73** |

### Test-to-Source Ratio
- Python: **57%** (4,084 test / 7,156 source) — excellent
- JavaScript: **5.6%** (228 test / 4,040 source) — weak
- Overall: **27.4%** — adequate

### File Size Distribution (Top 10)

| File | Lines | Role |
|------|-------|------|
| `Module18TacticalUI.jsx` | 938 | Tactical C2 interface |
| `DroneVerse.jsx` | 807 | Main UI orchestration |
| `trajectory.py` | 686 | Core simulation loop |
| `SimulationView.jsx` | 632 | Legacy sim view (backup) |
| `export_simulation.py` | 537 | Data export pipeline |
| `types.py` | 459 | 28 dataclasses + constants |
| `test_sensors.py` | 400 | Sensor model tests |
| `run_gate2.py` | 396 | Monte Carlo gate runner |
| `ekf.py` | 385 | 17D Error-State EKF |
| `Viewport3D.jsx` | 385 | Three.js 3D viewport |

---

## 3. ARCHITECTURE — 3 TIER

```
┌──────────────────────────────────────────────────────────────┐
│  FRONTEND — React 19 + Vite 8                                │
│                                                              │
│  DroneVerse.jsx (807)  ← main orchestration, 17 useState     │
│  ├── MapView.jsx (142) ← MapLibre satellite + GeoJSON        │
│  ├── Viewport3D.jsx (385) ← Three.js 4 camera modes          │
│  ├── RadarPPI.jsx (188) ← Canvas radar scope                 │
│  ├── Module18TacticalUI.jsx (938) ← C2 dark ops interface    │
│  └── droneverse/                                             │
│      ├── FlightDynamics.js (28) ← arcade physics             │
│      ├── SwarmController.js (57) ← fleet AI + combat          │
│      ├── KnowledgeGraph.js (25) ← entity graph                │
│      ├── EmergenceDetector.js (50) ← swarm patterns           │
│      ├── MissionPhaseEngine.js (35) ← state machine           │
│      └── missions.js (143) ← 14 mission definitions          │
├──────────────────────────────────────────────────────────────┤
│  BACKEND — Express.js + Python                               │
│                                                              │
│  server.js (135) ← API proxy + security (helmet, rate-limit) │
│  sim_server.py (58) ← Python sim HTTP server                 │
│  backend/drone_graph/ ← MiroFish graph services              │
├──────────────────────────────────────────────────────────────┤
│  PHYSICS ENGINE — Python (core/physics/)                     │
│                                                              │
│  dynamics/six_dof.py ← 6-DOF rigid body (RK4)               │
│  estimator/ekf.py ← 17D Error-State EKF (Joseph form)       │
│  sensors/ ← IMU (Allan variance) + Camera (pinhole) + Mag   │
│  landmark/ ← chain + cone distribution + risk-shaped policy  │
│  terrain/ ← Perlin procedural + DEM loader                   │
│  wind/dryden.py ← MIL-HDBK-1797 turbulence                  │
│  association/pipeline.py ← 5-step feature matching           │
│  sim/ ← trajectory + Monte Carlo + report generation         │
└──────────────────────────────────────────────────────────────┘
```

### Physics Engine Dependency Graph

```
TrajectorySimulator
├─ SixDOFDynamics (100 Hz RK4 integration)
│  └─ DroneConfig (mass, drag, battery)
├─ IMUModel (accel/gyro bias + random walk)
├─ CameraModel (10 Hz pinhole + radial distortion)
├─ MagnetometerModel (compass + EMI corruption)
├─ ErrorStateEKF (17D state estimation)
│  ├─ SixDOFDynamics (propagation via F/Q matrices)
│  └─ CameraModel (measurement update via H matrix)
├─ FiveStepPipeline (data association)
│  └─ CameraModel (feature detection + Hamming distance)
├─ ConsistencyMonitor (NIS windowing + P inflation)
├─ ProceduralTerrain (LOS checks + roughness)
├─ DrydenWindField (terrain-coupled turbulence)
└─ ConeLandmarkGenerator (risk-shaped cone policy)
```

### EKF State Vector (17D)

```
x = [p(3), v(3), θ(3), b_a(3), b_g(3), w(2)]
     ─────  ────  ────  ─────   ─────   ────
     pos    vel   att   accel   gyro    wind
                        bias    bias    est
```

---

## 4. TEST HEALTH

### Status: 328/328 PASS (100%)

| Suite | Tests | Pass | Fail | Runtime |
|-------|-------|------|------|---------|
| Python (pytest) | 303 | 303 | 0 | 23.45s |
| JavaScript (vitest) | 25 | 25 | 0 | 0.14s |
| **Total** | **328** | **328** | **0** | **23.59s** |

### Python Test Coverage by Module

| Module | Tests | Coverage |
|--------|-------|----------|
| Sensors (IMU, Camera, Mag) | 26 | Full |
| Dynamics (6-DOF, Quaternion) | 25 | Full |
| EKF (predict, update, gate) | 18 | Full |
| Landmarks (chain, cone, cluster) | 37 | Full |
| Cone guidance | 18 | Full |
| Wind (Dryden) | 12 | Full |
| Terrain (procedural, DEM) | 14 | Full |
| Association pipeline | 10 | Full |
| Consistency monitor | 11 | Full |
| Containment boundary | 8 | Full |
| Types + Config | 21 | Full |
| Monte Carlo | 9 | Full |
| Report generation | 9 | Full |
| Trajectory + Integration | 11 | Basic |
| Hardened (risk cone, modes) | 24 | Full |
| Stubs (ABC contracts) | 8 | Minimal |

### Test Gaps (NOT covered)

| Gap | Impact | Priority |
|-----|--------|----------|
| No React component tests | UI regressions undetected | HIGH |
| No E2E tests (Cypress/Playwright) | Full-flow bugs missed | HIGH |
| No API integration tests | server.js routes untested | MEDIUM |
| No visual regression tests | UI drift undetected | LOW |

---

## 5. BUILD & DEPLOY

### Production Build

| Metric | Value | Status |
|--------|-------|--------|
| Build tool | Vite 8.0.2 | OK |
| Build time | 650ms | OK |
| Bundle JS | 2,374 KB (645 KB gzip) | WARNING |
| Bundle CSS | 70 KB (10 KB gzip) | OK |
| Chunks | 1 (no code splitting) | PROBLEM |

### Bundle Breakdown (estimated)

| Library | Size (gzip) | Used In | Lazy-loadable? |
|---------|-------------|---------|----------------|
| Three.js | ~180KB | Viewport3D only | YES |
| MapLibre GL | ~120KB | MapView only | YES |
| Recharts | ~50KB | DroneVerse telemetry only | YES |
| React + React-DOM | ~45KB | Everywhere | NO |
| Lucide icons | ~25KB | Everywhere | NO |
| App code | ~225KB | — | Partially |

### Deploy Issues

| Component | Issue |
|-----------|-------|
| Dockerfile | No npm ci, installs devDeps in prod, no healthcheck, runs as root |
| render.yaml | No PORT config, devDeps in build |
| server.js | API keys logged to console (line 133-134) |

---

## 6. SECURITY AUDIT

### RED — Critical

| # | Issue | Location |
|---|-------|----------|
| 1 | API keys logged to console | `server.js:133-134` |
| 2 | SPA fallback serves index.html for ANY path | `server.js:129` |

### YELLOW — Important

| # | Issue | Location |
|---|-------|----------|
| 3 | No CSRF protection on POST routes | `server.js` |
| 4 | MiroFish proxy has no rate limiting | `server.js:102-116` |
| 5 | Python sim blocks HTTP thread indefinitely | `sim_server.py` |
| 6 | No request timeout on AI calls | `server.js:44-99` |
| 7 | CORS allows any origin | `sim_server.py:32` |
| 8 | CSP disabled entirely for Three.js | `server.js:16` |

---

## 7. PERFORMANCE BOTTLENECKS

### Frontend

| Issue | Impact | Location |
|-------|--------|----------|
| DroneVerse re-renders every 50ms | Full tree re-render | `DroneVerse.jsx:377` |
| No React.memo on children | Map/3D/radar re-render every tick | All children |
| O(n²) swarm proximity checks | 2,916 checks/tick for 54 drones | `SwarmController.js` |
| transformSimData not memoized | Recalculates every playIdx | `Module18TacticalUI.jsx:37` |
| Canvas full-redraw every frame | Grid+cone+paths+landmarks | `Module18TacticalUI.jsx:325` |

### Python

| Issue | Impact | Location |
|-------|--------|----------|
| Monte Carlo sequential | 1000 runs = 8+ hours | `monte_carlo.py:61` |
| Full trajectory in RAM | 50-100MB for 60s sim | `trajectory.py` |
| Float64 full precision export | 555KB JSON, could be 280KB | `run_simulation.py:119` |

### Bundle

| Optimization | Current | After | Savings |
|-------------|---------|-------|---------|
| Code-split Three.js | 645KB gzip | ~465KB | ~180KB deferred |
| Lazy-load MapLibre | Always loaded | On demand | ~120KB deferred |
| Replace Recharts | 50KB | Custom SVG | ~50KB |
| **Total** | **645KB** | **~400KB** | **~38% reduction** |

---

## 8. CODE QUALITY ISSUES

### Critical

| # | Issue | File |
|---|-------|------|
| 1 | DroneVerse.jsx 807-line monolith (17 useState) | `DroneVerse.jsx` |
| 2 | Memory leak: emergenceFeed grows unbounded | `DroneVerse.jsx:55` |
| 3 | Race condition: AI requests return out-of-order | `DroneVerse.jsx:261` |
| 4 | 75MB video files committed to Git | Root |

### Major

| # | Issue | File |
|---|-------|------|
| 5 | No CI/CD pipeline | Missing |
| 6 | SimulationView.jsx is dead code | `SimulationView.jsx` |
| 7 | Magic numbers (turn rate, bank scale, separation) | Multiple |
| 8 | gpsToM() function unused | `constants.js` |
| 9 | MiroFish API never invoked from UI | `api.js:15-81` |
| 10 | No Python lock file | `pyproject.toml` |

---

## 9. DEVELOPMENT TIMELINE

```
Mar 24 ─ ▌ Initial commit
Mar 25 ─ ████████████████████████ 24 commits (BIG BANG DAY)
         ├─ Combat UX, satellite map, HTML markers
         ├─ Theme system, Tây Hoà BQP mission
         ├─ Express proxy + Render deploy
         ├─ OpenAI fallback, refactor → 8 modules
         └─ Quality upgrade (tests, a11y, error boundaries)
Mar 26 ─ █████ 5 commits — MiroFish Phases 1-5
Mar 27 ─ ███ 3 commits — GPS-Denied Nav Engine + Monte Carlo

         ⟨ 28-day gap ⟩

Apr 24 ─ ▌ ConeGuidance fix + telemetry UI
Apr 26 ─ ▌ Tactical C2 interface + Python 3.9 compat
```

---

## 10. ASSET INVENTORY

| File | Size | Action Needed |
|------|------|---------------|
| Edited HERA vùng lũ.mp4 | 60 MB | Move to CDN |
| Edited HERA tiếp tế.mp4 | 9.7 MB | Move to CDN |
| Edited loa để tiếp cận.mp4 | 5.0 MB | Move to CDN |
| public/sim_data.json | 555 KB | Compress (→ 280KB) |
| **Total bloat** | **~75 MB** | |

---

## 11. OPTIMIZATION ROADMAP — 12 TIPs

### Priority Matrix

```
         IMPACT
    HIGH ┃ TIP-1  TIP-2  TIP-3
         ┃ TIP-4  TIP-5
    MED  ┃ TIP-6  TIP-7  TIP-8
         ┃ TIP-9
    LOW  ┃ TIP-10 TIP-11 TIP-12
         ┗━━━━━━━━━━━━━━━━━━━━━
          QUICK    MED    HARD
              EFFORT →
```

### TIP-1: Security — Fix API Key Logging + SPA Fallback
```
EFFORT:   15 min    IMPACT: CRITICAL
TARGET:   server.js

1. Remove console.log of API keys (line 133-134)
2. Whitelist static paths in SPA fallback (line 129)
3. Add 30s timeout on AI proxy calls with AbortController
```

### TIP-2: Bundle — Code-Split Heavy Libraries
```
EFFORT:   30 min    IMPACT: HIGH — 645KB → ~400KB (38% reduction)
TARGET:   vite.config.js, DroneVerse.jsx, main.jsx

1. React.lazy() for Viewport3D, MapView, Module18TacticalUI
2. Named imports for Three.js (not import *)
3. Manual chunks in vite config (three, maplibre, recharts)
```

### TIP-3: Refactor — Split DroneVerse Monolith
```
EFFORT:   2 hours   IMPACT: HIGH — maintainability + render perf
TARGET:   DroneVerse.jsx (807 lines → 5-6 files × ~150 lines)

Split into: DroneVerse shell, useSimulation hook, TelemetryPanel,
ControlPanel, AIAdvisor, useSwarm hook
```

### TIP-4: Performance — Memoize Render Pipeline
```
EFFORT:   30 min    IMPACT: HIGH — eliminate 80% re-renders
TARGET:   Module18TacticalUI.jsx, DroneVerse.jsx

1. useMemo for transformSimData
2. React.memo on MapView, Viewport3D, RadarPPI
3. Throttle telemetry updates (50ms → 250ms)
```

### TIP-5: CI/CD — GitHub Actions Pipeline
```
EFFORT:   45 min    IMPACT: HIGH — catch regressions
TARGET:   .github/workflows/ci.yml (new)

Jobs: test-python (pytest), test-js (vitest), build (vite build)
```

### TIP-6: Data — Optimize sim_data.json
```
EFFORT:   20 min    IMPACT: MEDIUM — 555KB → 280KB (50%)
TARGET:   run_simulation.py

Round floats to 1dp, subsample sigma (5999 → 500 points)
```

### TIP-7: Assets — Remove Videos from Git
```
EFFORT:   15 min    IMPACT: MEDIUM — 75MB removed
TARGET:   .gitignore + external storage
```

### TIP-8: Python — Monte Carlo Parallelization
```
EFFORT:   1 hour    IMPACT: MEDIUM — 4x speedup
TARGET:   monte_carlo.py

multiprocessing.Pool for independent simulation runs
```

### TIP-9: SwarmController — Spatial Hashing
```
EFFORT:   1 hour    IMPACT: MEDIUM — O(n²) → O(n)
TARGET:   SwarmController.js

Grid cells (50m) → only check 9 neighbors instead of all drones
```

### TIP-10: Dead Code Cleanup
```
EFFORT:   15 min    IMPACT: LOW
TARGET:   SimulationView.jsx (delete), constants.js, api.js

Remove unused functions, dead imports, legacy files
```

### TIP-11: Docker Hardening
```
EFFORT:   20 min    IMPACT: LOW
TARGET:   Dockerfile

Multi-stage build, non-root user, healthcheck, npm ci
```

### TIP-12: Python Dependency Locking
```
EFFORT:   10 min    IMPACT: LOW
TARGET:   pyproject.toml → requirements.lock

pip-compile for reproducible builds
```

---

## 12. RECOMMENDED EXECUTION ORDER

### Session 1 — Security & Quick Wins (45 min)
```
TIP-1  → Fix API key logging + SPA fallback     (15 min)
TIP-10 → Dead code cleanup                      (15 min)
TIP-7  → Remove videos from git                 (15 min)
```

### Session 2 — Performance (1.5 hours)
```
TIP-4  → Memoize render pipeline                (30 min)
TIP-2  → Code-split heavy libraries             (30 min)
TIP-6  → Optimize sim_data.json                 (20 min)
```

### Session 3 — Architecture (2.5 hours)
```
TIP-3  → Split DroneVerse monolith              (2 hours)
TIP-5  → CI/CD pipeline                        (30 min)
```

### Session 4 — Deep Optimization (2.5 hours)
```
TIP-9  → Spatial hashing for swarm             (1 hour)
TIP-8  → Monte Carlo parallelization           (1 hour)
TIP-11 → Docker hardening                      (20 min)
TIP-12 → Python dependency locking             (10 min)
```

---

## 13. SCORECARD

| Dimension | Current | After 12 TIPs | Delta |
|-----------|---------|---------------|-------|
| Functionality | 9/10 | 9/10 | — |
| Test coverage | 7/10 | 8/10 | +1 |
| Security | 4/10 | 8/10 | +4 |
| Performance | 5/10 | 8/10 | +3 |
| Code quality | 6/10 | 8/10 | +2 |
| DevOps | 3/10 | 7/10 | +4 |
| Architecture | 7/10 | 8/10 | +1 |
| **Overall** | **5.9/10** | **8.0/10** | **+2.1** |

---

*End of X-Ray Report — RTR DroneVerse*
