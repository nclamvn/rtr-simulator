import { useRef, useEffect } from "react";
import { Volume2 } from "lucide-react";
import { PI2, DEG, THEMES } from "./constants.js";

function Viewport3D({ drones, threats, waypoints, selectedId, camMode, windSpd, threeTheme, T }) {
  const mountRef = useRef(null);
  const dRef = useRef(drones); const tRef = useRef(threats); const wRef = useRef(waypoints);
  const sRef = useRef(selectedId); const cmRef = useRef(camMode || "orbit"); const wsRef = useRef(windSpd || 0);
  const objsRef = useRef(new Map()); const trailsRef = useRef(new Map()); const tmpRef = useRef([]);
  const exhaustRef = useRef(new Map()); const threatPartRef = useRef(new Map());
  const burstRef = useRef(new Map()); const alertedRef = useRef(new Set());
  const audioRef = useRef({ prop: 0, wind: 0, alert: 0 });
  const sceneRef = useRef(null); const ttRef = useRef(threeTheme);
  const themeObjsRef = useRef({}); // scene objects that need theme updates
  useEffect(() => {
    ttRef.current = threeTheme;
    const s = sceneRef.current; const to = themeObjsRef.current;
    if (s && threeTheme) {
      s.background.set(threeTheme.clearColor);
      if (s.fog) s.fog.color.set(threeTheme.clearColor);
      const isLight = threeTheme.clearColor === 0xd8e0e8;
      if (to.ambLight) { to.ambLight.color.set(threeTheme.ambient); to.ambLight.intensity = isLight ? 1.2 : 0.5; }
      if (to.terrain) to.terrain.material.color.set(threeTheme.terrain);
      if (to.groundGlow) to.groundGlow.material.color.set(threeTheme.ground);
      if (to.starMat) to.starMat.opacity = threeTheme.clearColor === 0x070e1a ? 0.45 : 0.05;
    }
  }, [threeTheme]);
  useEffect(() => { dRef.current = drones; }, [drones]);
  useEffect(() => { tRef.current = threats; }, [threats]);
  useEffect(() => { wRef.current = waypoints; }, [waypoints]);
  useEffect(() => { sRef.current = selectedId; }, [selectedId]);
  useEffect(() => { cmRef.current = camMode || "orbit"; }, [camMode]);
  useEffect(() => { wsRef.current = windSpd || 0; }, [windSpd]);

  useEffect(() => {
    const m = mountRef.current; if (!m) return;
    const T = window.THREE; if (!T) return;
    const w = m.clientWidth, h = m.clientHeight;
    const tt = ttRef.current || THEMES.dark.three;
    const scene = new T.Scene();
    scene.fog = new T.FogExp2(tt.clearColor, 0.0004);
    scene.background = new T.Color(tt.clearColor);
    sceneRef.current = scene;
    const cam = new T.PerspectiveCamera(55, w / h, 1, 5000); cam.position.set(0, 500, 350);
    const ren = new T.WebGLRenderer({ antialias: true, alpha: true });
    ren.setSize(w, h); ren.setPixelRatio(Math.min(devicePixelRatio, 2));
    ren.toneMapping = T.ACESFilmicToneMapping; ren.toneMappingExposure = 1.2;
    m.appendChild(ren.domElement);

    // Enhanced lighting
    const ambLight = new T.AmbientLight(tt.ambient, 0.5);
    scene.add(ambLight); themeObjsRef.current.ambLight = ambLight;
    scene.add(new T.HemisphereLight(0x0a1a3a, 0x000000, 0.4));
    const dl = new T.DirectionalLight(0xaaddff, 0.8); dl.position.set(300, 500, 200); scene.add(dl);
    const cpl = new T.PointLight(0x00ffcc, 0.6, 1400); scene.add(cpl);

    // SPEC-F: Star field
    const starCount = 200;
    const starGeo = new T.BufferGeometry();
    const starPos = new Float32Array(starCount * 3);
    const starSz = new Float32Array(starCount);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * PI2, phi = Math.acos(Math.random() * 0.6 + 0.4);
      const r = 1500 + Math.random() * 500;
      starPos[i*3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i*3+1] = r * Math.cos(phi);
      starPos[i*3+2] = r * Math.sin(phi) * Math.sin(theta);
      starSz[i] = 0.5 + Math.random() * 0.5;
    }
    starGeo.setAttribute("position", new T.BufferAttribute(starPos, 3));
    starGeo.setAttribute("size", new T.BufferAttribute(starSz, 1));
    const starMat = new T.PointsMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, size: 1.5, sizeAttenuation: true });
    scene.add(new T.Points(starGeo, starMat)); themeObjsRef.current.starMat = starMat;

    // SPEC-F: Ground glow plane
    const gndGlow = new T.Mesh(new T.PlaneGeometry(2000, 2000), new T.MeshBasicMaterial({ color: tt.ground, transparent: true, opacity: 0.3 }));
    gndGlow.rotation.x = -Math.PI / 2; gndGlow.position.y = -1; scene.add(gndGlow);
    themeObjsRef.current.groundGlow = gndGlow;

    // Grid + terrain
    const grid = new T.GridHelper(1600, 40, tt.grid1, tt.grid2);
    scene.add(grid); themeObjsRef.current.grid = grid;
    const tg = new T.PlaneGeometry(1600, 1600, 80, 80); tg.rotateX(-Math.PI / 2);
    const vt = tg.attributes.position;
    for (let i = 0; i < vt.count; i++) { const px = vt.getX(i), pz = vt.getZ(i); vt.setY(i, Math.sin(px * 0.005) * Math.cos(pz * 0.004) * 18 + Math.sin(px * 0.012 + pz * 0.008) * 10); }
    tg.computeVertexNormals();
    const terrainMat = new T.MeshPhongMaterial({ color: tt.terrain, transparent: true, opacity: 0.6, flatShading: true });
    const terrainMesh = new T.Mesh(tg, terrainMat);
    scene.add(terrainMesh); themeObjsRef.current.terrain = terrainMesh;

    // Beacon
    const beacon = new T.Mesh(new T.CylinderGeometry(4, 4, 3, 8), new T.MeshPhongMaterial({ color: 0x00ffaa, emissive: 0x00aa66 }));
    beacon.position.y = 1.5; scene.add(beacon);
    const bRing = new T.Mesh(new T.RingGeometry(6, 8, 32), new T.MeshBasicMaterial({ color: 0x00ffaa, transparent: true, opacity: 0.3, side: T.DoubleSide }));
    bRing.rotation.x = -Math.PI / 2; bRing.position.y = 0.5; scene.add(bRing);

    // SPEC-D: Build drone model
    function buildDroneModel(color, iff) {
      const g = new T.Group();
      const bodyCol = 0x2a2a30;
      const canopyCol = iff === "HOSTILE" ? 0xff3040 : new T.Color(color).getHex();
      // Body
      g.add(new T.Mesh(new T.BoxGeometry(4, 1.5, 6), new T.MeshPhongMaterial({ color: bodyCol, emissive: 0x111115 })));
      // Canopy
      const canopyMat = new T.MeshPhongMaterial({ color: canopyCol, emissive: canopyCol, emissiveIntensity: 0.5, transparent: true, opacity: 0.85 });
      const canopy = new T.Mesh(new T.SphereGeometry(1.5, 8, 6, 0, PI2, 0, Math.PI / 2), canopyMat);
      canopy.position.y = 0.75; canopy.name = "canopy";
      g.add(canopy);
      // Arms + rotors
      const armMat = new T.MeshPhongMaterial({ color: bodyCol });
      const rotorMat = new T.MeshBasicMaterial({ color: canopyCol, transparent: true, opacity: 0.5, side: T.DoubleSide });
      const armOffsets = [[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1]];
      g.userData.rotors = [];
      for (const [ax,,az] of armOffsets) {
        const arm = new T.Mesh(new T.CylinderGeometry(0.3, 0.3, 5.5, 6), armMat);
        arm.rotation.z = Math.PI / 2; arm.rotation.y = Math.atan2(ax, az);
        arm.position.set(ax * 2.8, 0.2, az * 2.8);
        g.add(arm);
        const rotor = new T.Mesh(new T.RingGeometry(1.8, 2.3, 12), rotorMat);
        rotor.rotation.x = -Math.PI / 2;
        rotor.position.set(ax * 5, 0.5, az * 5);
        g.add(rotor);
        g.userData.rotors.push(rotor);
      }
      // Landing gear
      const gearMat = new T.MeshPhongMaterial({ color: 0x444450 });
      for (const xo of [-1.5, 1.5]) {
        const gear = new T.Mesh(new T.CylinderGeometry(0.2, 0.2, 2, 6), gearMat);
        gear.position.set(xo, -1.5, 0); g.add(gear);
      }
      // Point light (SPEC-A enhanced)
      g.add(new T.PointLight(new T.Color(color).getHex(), 0.6, 80));
      return g;
    }

    // Camera state
    let ang = 0; const clk = new T.Clock(); let raf; const SC = 0.8;
    const camTarget = new T.Vector3(0, 40, 0);
    const camPos = new T.Vector3(0, 300, 350);
    let cinIdx = 0, cinTimer = 0;

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clk.getDelta(), 0.05); ang += dt * 0.12;
      const cd = dRef.current, ct = tRef.current, cw = wRef.current, cs = sRef.current;
      const mode = cmRef.current;

      // SPEC-C: Camera modes
      const selDrone = cd.find(dd => dd.id === cs);
      let tgtPos = new T.Vector3(0, 40, 0);
      let tgtCam = new T.Vector3(Math.sin(ang) * 450, 300 + Math.sin(ang * 0.4) * 60, Math.cos(ang) * 350);

      if (mode === "chase" && selDrone) {
        const dp = new T.Vector3(selDrone.fd.x * SC, selDrone.fd.alt * 0.3, -selDrone.fd.y * SC);
        const hRad = -selDrone.fd.hdg * DEG;
        tgtCam.set(dp.x - Math.sin(hRad) * 50, dp.y + 30, dp.z - Math.cos(hRad) * 50);
        tgtPos.copy(dp);
      } else if (mode === "topdown") {
        tgtCam.set(0, 800, 0.1);
        tgtPos.set(0, 0, 0);
      } else if (mode === "cinematic" && cd.length > 0) {
        cinTimer += dt;
        if (cinTimer > 5) { cinTimer = 0; cinIdx = (cinIdx + 1) % cd.length; }
        const td = cd[cinIdx % cd.length];
        const dp = new T.Vector3(td.fd.x * SC, td.fd.alt * 0.3, -td.fd.y * SC);
        const cOff = new T.Vector3(80 * Math.sin(ang * 0.3), 60 + 40 * Math.sin(ang * 0.5), 80 * Math.cos(ang * 0.3));
        tgtCam.copy(dp).add(cOff);
        tgtPos.copy(dp);
      }
      // else orbit = default tgtCam already set

      camPos.lerp(tgtCam, mode === "orbit" ? 1 : 0.04);
      camTarget.lerp(tgtPos, mode === "orbit" ? 1 : 0.04);
      cam.position.copy(camPos);
      cam.lookAt(camTarget);

      // Update drones
      const ids = new Set();
      let totalSpeed = 0, alertLevel = 0;
      for (const d of cd) {
        ids.add(d.id);
        totalSpeed += d.fd.speed;
        let o = objsRef.current.get(d.id);
        if (!o) {
          o = buildDroneModel(d.spec.color, d.spec.iff);
          scene.add(o); objsRef.current.set(d.id, o);
        }
        const px = d.fd.x * SC, py = d.fd.alt * 0.3, pz = -d.fd.y * SC;
        o.position.set(px, py, pz);
        o.rotation.y = -d.fd.hdg * DEG; o.rotation.z = d.fd.bank * DEG * 0.5;
        o.scale.setScalar(d.id === cs ? 2.0 : 1.0);

        // SPEC-D: Rotor spin
        if (o.userData.rotors) {
          const rotSpd = 2 + (d.fd.speed / d.spec.maxSpeed) * 13;
          for (const r of o.userData.rotors) r.rotation.z += rotSpd * dt;
        }
        // SPEC-D: Selected canopy pulse
        const canopy = o.getObjectByName("canopy");
        if (canopy && d.id === cs) {
          canopy.material.emissiveIntensity = 0.3 + Math.sin(ang * 6) * 0.25;
        } else if (canopy) {
          canopy.material.emissiveIntensity = 0.5;
        }

        // SPEC-B1: Exhaust particles
        let exh = exhaustRef.current.get(d.id);
        if (!exh) {
          const N = 15;
          const eGeo = new T.BufferGeometry();
          const ePos = new Float32Array(N * 3);
          const eCol = new Float32Array(N * 4);
          eGeo.setAttribute("position", new T.BufferAttribute(ePos, 3));
          eGeo.setAttribute("color", new T.BufferAttribute(eCol, 4));
          const eMat = new T.PointsMaterial({ size: 2, transparent: true, opacity: 0.8, vertexColors: true, sizeAttenuation: true, depthWrite: false, blending: T.AdditiveBlending });
          const pts = new T.Points(eGeo, eMat);
          pts.frustumCulled = false;
          scene.add(pts);
          exh = { pts, positions: Array.from({length: N}, () => [px, py, pz]), idx: 0 };
          exhaustRef.current.set(d.id, exh);
        }
        exh.positions[exh.idx] = [px, py - 0.5, pz];
        exh.idx = (exh.idx + 1) % exh.positions.length;
        const ep = exh.pts.geometry.attributes.position.array;
        const ec = exh.pts.geometry.attributes.color.array;
        const dc = new T.Color(d.spec.color);
        for (let i = 0; i < exh.positions.length; i++) {
          const ri = (exh.idx + i) % exh.positions.length;
          const fade = i / exh.positions.length;
          ep[i*3] = exh.positions[ri][0]; ep[i*3+1] = exh.positions[ri][1]; ep[i*3+2] = exh.positions[ri][2];
          ec[i*4] = dc.r; ec[i*4+1] = dc.g; ec[i*4+2] = dc.b; ec[i*4+3] = fade * 0.6;
        }
        exh.pts.geometry.attributes.position.needsUpdate = true;
        exh.pts.geometry.attributes.color.needsUpdate = true;

        // Trail line
        let tl = trailsRef.current.get(d.id); if (tl) scene.remove(tl);
        if (d.trail.length > 2) {
          const pts2 = d.trail.map(p => new T.Vector3(p.x * SC, d.fd.alt * 0.3 - 1, -p.y * SC));
          const ln = new T.Line(new T.BufferGeometry().setFromPoints(pts2), new T.LineBasicMaterial({ color: new T.Color(d.spec.color), transparent: true, opacity: 0.25 }));
          scene.add(ln); trailsRef.current.set(d.id, ln);
        }

        // SPEC-B3: Alert burst on threat entry
        for (const t of ct) {
          const td2 = Math.hypot(d.fd.x - t.x, d.fd.y - t.y);
          const key = `${d.id}-${t.x}-${t.y}`;
          if (td2 < t.radius && !alertedRef.current.has(key)) {
            alertedRef.current.add(key);
            alertLevel = 1;
            const bGeo = new T.BufferGeometry();
            const bPos = new Float32Array(10 * 3);
            for (let bi = 0; bi < 10; bi++) {
              bPos[bi*3] = px; bPos[bi*3+1] = py; bPos[bi*3+2] = pz;
            }
            bGeo.setAttribute("position", new T.BufferAttribute(bPos, 3));
            const bPts = new T.Points(bGeo, new T.PointsMaterial({ color: 0xff4040, size: 3, transparent: true, opacity: 1, sizeAttenuation: true, depthWrite: false, blending: T.AdditiveBlending }));
            bPts.frustumCulled = false;
            scene.add(bPts);
            const vels = Array.from({length: 10}, () => [(Math.random()-0.5)*60, Math.random()*30, (Math.random()-0.5)*60]);
            burstRef.current.set(key, { pts: bPts, vels, age: 0, ox: px, oy: py, oz: pz });
          }
        }
      }

      // Audio levels
      audioRef.current.prop = cd.length > 0 ? Math.min(1, totalSpeed / (cd.length * 15)) : 0;
      audioRef.current.wind = Math.min(1, (wsRef.current || 0) / 25);
      audioRef.current.alert = Math.max(0, alertLevel, (audioRef.current.alert || 0) - dt * 0.5);

      // Cleanup removed drones
      for (const [id, o] of objsRef.current) {
        if (!ids.has(id)) {
          scene.remove(o); objsRef.current.delete(id);
          const tl = trailsRef.current.get(id); if (tl) { scene.remove(tl); trailsRef.current.delete(id); }
          const ex = exhaustRef.current.get(id); if (ex) { scene.remove(ex.pts); exhaustRef.current.delete(id); }
        }
      }

      // Update bursts
      for (const [key, b] of burstRef.current) {
        b.age += dt;
        if (b.age > 1) { scene.remove(b.pts); burstRef.current.delete(key); continue; }
        const bp = b.pts.geometry.attributes.position.array;
        for (let i = 0; i < 10; i++) {
          bp[i*3] = b.ox + b.vels[i][0] * b.age;
          bp[i*3+1] = b.oy + b.vels[i][1] * b.age;
          bp[i*3+2] = b.oz + b.vels[i][2] * b.age;
        }
        b.pts.geometry.attributes.position.needsUpdate = true;
        b.pts.material.opacity = 1 - b.age;
      }

      // Temporary objects (threats, waypoints)
      for (const x of tmpRef.current) scene.remove(x); tmpRef.current = [];

      // SPEC-B2: Threat zones + rising particles
      for (const t of ct) {
        const tx = t.x * SC, tz = -t.y * SC;
        const cy2 = new T.Mesh(new T.CylinderGeometry(t.radius * SC, t.radius * SC, 120, 16, 1, true), new T.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.08 + Math.sin(ang * 4) * 0.04, side: T.DoubleSide }));
        cy2.position.set(tx, 60, tz); scene.add(cy2); tmpRef.current.push(cy2);
        const rg = new T.Mesh(new T.RingGeometry(t.radius * SC - 2, t.radius * SC, 32), new T.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.15, side: T.DoubleSide }));
        rg.rotation.x = -Math.PI / 2; rg.position.set(tx, 0.5, tz); scene.add(rg); tmpRef.current.push(rg);
        // Rising particles
        const tKey = `${t.x}_${t.y}`;
        let tp = threatPartRef.current.get(tKey);
        if (!tp) {
          const N = 20;
          const pGeo = new T.BufferGeometry();
          const pPos = new Float32Array(N * 3);
          for (let i = 0; i < N; i++) {
            const a2 = Math.random() * PI2, r2 = Math.random() * t.radius * SC * 0.8;
            pPos[i*3] = tx + Math.cos(a2) * r2;
            pPos[i*3+1] = Math.random() * 120;
            pPos[i*3+2] = tz + Math.sin(a2) * r2;
          }
          pGeo.setAttribute("position", new T.BufferAttribute(pPos, 3));
          const pPts = new T.Points(pGeo, new T.PointsMaterial({ color: 0xff2020, size: 1.5, transparent: true, opacity: 0.2, sizeAttenuation: true, depthWrite: false, blending: T.AdditiveBlending }));
          pPts.frustumCulled = false;
          scene.add(pPts);
          tp = { pts: pPts, speeds: Array.from({length: N}, () => 0.5 + Math.random() * 1.5) };
          threatPartRef.current.set(tKey, tp);
        }
        const pp = tp.pts.geometry.attributes.position.array;
        for (let i = 0; i < tp.speeds.length; i++) {
          pp[i*3+1] += tp.speeds[i] * dt * 30;
          if (pp[i*3+1] > 120) {
            pp[i*3+1] = 0;
            const a2 = Math.random() * PI2, r2 = Math.random() * t.radius * SC * 0.8;
            pp[i*3] = tx + Math.cos(a2) * r2;
            pp[i*3+2] = tz + Math.sin(a2) * r2;
          }
        }
        tp.pts.geometry.attributes.position.needsUpdate = true;
      }
      // Clean up removed threat particles
      for (const [key, tp] of threatPartRef.current) {
        if (!ct.some(t => `${t.x}_${t.y}` === key)) { scene.remove(tp.pts); threatPartRef.current.delete(key); }
      }

      // Waypoints
      for (const wp of cw) {
        const wm = new T.Mesh(new T.OctahedronGeometry(4), new T.MeshBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 0.55, wireframe: true }));
        wm.position.set(wp.x * SC, (wp.alt || 150) * 0.3, -wp.y * SC); wm.rotation.y = ang * 2; scene.add(wm); tmpRef.current.push(wm);
        const vl = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(wp.x * SC, 0, -wp.y * SC), new T.Vector3(wp.x * SC, (wp.alt || 150) * 0.3, -wp.y * SC)]), new T.LineBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 0.25 }));
        scene.add(vl); tmpRef.current.push(vl);
      }

      bRing.scale.setScalar(1 + Math.sin(ang * 3) * 0.2);
      beacon.material.emissiveIntensity = 0.5 + Math.sin(ang * 4) * 0.3;
      ren.render(scene, cam);
    };
    animate();
    const onR = () => { const w2 = m.clientWidth, h2 = m.clientHeight; cam.aspect = w2 / h2; cam.updateProjectionMatrix(); ren.setSize(w2, h2); };
    window.addEventListener("resize", onR);
    return () => {
      window.removeEventListener("resize", onR); cancelAnimationFrame(raf);
      if (m.contains(ren.domElement)) m.removeChild(ren.domElement); ren.dispose();
      // Cleanup particles
      for (const [,ex] of exhaustRef.current) scene.remove(ex.pts); exhaustRef.current.clear();
      for (const [,tp] of threatPartRef.current) scene.remove(tp.pts); threatPartRef.current.clear();
      for (const [,b] of burstRef.current) scene.remove(b.pts); burstRef.current.clear();
      alertedRef.current.clear();
    };
  }, []);

  // SPEC-E: Audio indicator overlay
  const au = audioRef.current;
  return <div ref={mountRef} style={{ width: "100%", height: "100%", borderRadius: 8, overflow: "hidden", position: "relative" }}>
    <div style={{ position: "absolute", bottom: 8, left: 8, background: T.bgOverlay, borderRadius: 6, padding: "5px 8px", fontSize: 12, fontFamily: "inherit", display: "flex", flexDirection: "column", gap: 3, zIndex: 2 }}>
      {[["PROP", au.prop, "#00e5ff"], ["WIND", au.wind, "#00e878"], ["ALERT", au.alert, "#ff3b5c"]].map(([label, val, color]) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Volume2 size={7} color={color} />
          <span style={{ color: T.textMuted, width: 28 }}>{label}</span>
          <div style={{ width: 60, height: 3, background: T.border, borderRadius: 2, overflow: "hidden" }}>
            <div style={{ width: `${Math.round((val || 0) * 100)}%`, height: "100%", background: color, borderRadius: 2 }} />
          </div>
          <span style={{ color: T.textMuted, width: 22, textAlign: "right" }}>{Math.round((val || 0) * 100)}%</span>
        </div>
      ))}
    </div>
  </div>;
}

export default Viewport3D;
