/* ===== GAME: physics, camera, laps, HUD ===== */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const wrapPI = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const damp = (k, dt) => 1 - Math.exp(-k * dt);

  // ------------------------------------------------------------------
  // Handling constants. Everything about how the buggy feels lives here.
  // ------------------------------------------------------------------
  const CFG = {
    vMax: 54, vBoost: 74, accel: 25, boostAccel: 34,
    brake: 40, reverseMax: 14, coast: 2.5, coastDrag: 0.0012,
    yawBase: 2.1, yawSpeedRef: 28,
    steerRise: 5.5, steerReturn: 8.5, steerCounter: 11,
    gripNormal: 9.5, gripDrift: 2.0, retainNormal: 0.86, retainDrift: 0.95,
    driftYawMul: 1.45, driftMinSpeed: 14,
    boostDrain: 1 / 3.1, boostRegen: 0.042, driftRegen: 0.12,
    turboTimes: [0.55, 1.05, 1.6], turboAt: [0.7, 1.5, 2.5],
    gravityAir: 24, slopeG: 6.5,
  };

  // ------------------------------------------------------------------
  // Scene
  // ------------------------------------------------------------------
  const T = buildTrackData(THREE);
  const { N, DS, px, py, pz, tx, tz, segLen, stx, stz, slope } = T;

  const canvas = $('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(pixelRatio);
  const FOG = 0xe7c08c;
  renderer.setClearColor(FOG);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(FOG, 380, 3400);
  const camera = new THREE.PerspectiveCamera(68, 1, 0.12, 9000);

  const hemi = new THREE.HemisphereLight(0xdbe8ff, 0xd29561, 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d4, 2.2);
  scene.add(sun, sun.target);

  const sky = buildSky(THREE, scene);
  sun.position.copy(sky.sunDir).multiplyScalar(100);
  buildWorld(THREE, scene, T);

  const carObj = buildCar(THREE);
  scene.add(carObj.root); scene.add(carObj.shadow);
  const ghostObj = buildCar(THREE, { ghost: true });
  ghostObj.root.visible = false; scene.add(ghostObj.root);

  // ------------------------------------------------------------------
  // Track queries
  // ------------------------------------------------------------------
  function locate(x, z, hint, range, o) {
    let bi = 0, bt = 0, bd = 1e18, bex = 0, bez = 0;
    const lo = range < 0 ? 0 : -range, hi = range < 0 ? N - 1 : range;
    for (let d = lo; d <= hi; d++) {
      const i = range < 0 ? d : ((hint + d) % N + N) % N;
      const dx = x - px[i], dz = z - pz[i];
      let t = (dx * tx[i] + dz * tz[i]) / segLen[i]; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = dx - tx[i] * segLen[i] * t, ez = dz - tz[i] * segLen[i] * t;
      const dd = ex * ex + ez * ez;
      if (dd < bd) { bd = dd; bi = i; bt = t; bex = ex; bez = ez; }
    }
    const dist = Math.sqrt(bd);
    const side = (bex * tz[bi] - bez * tx[bi]) >= 0 ? 1 : -1;
    // Along-track position comes from the mesh cross-section planes (perpendicular to the
    // sample tangents) so height/progress stay smooth on the inside of bends.
    let i = -1, st = 0;
    for (let d = -3; d <= 3; d++) {
      const k = ((bi + d) % N + N) % N, k2 = (k + 1) % N;
      const a = (x - px[k]) * stx[k] + (z - pz[k]) * stz[k]; if (a < 0) continue;
      const bb = (x - px[k2]) * stx[k2] + (z - pz[k2]) * stz[k2]; if (bb >= 0) continue;
      i = k; st = a / (a - bb); break;
    }
    if (i < 0) { i = bi; st = bt; }
    const j = (i + 1) % N; bt = st;
    o.i = i; o.t = bt; o.dist = dist; o.lat = side * dist;
    if (dist > 1e-4) { o.nx = bex / dist; o.nz = bez / dist; } else { o.nx = tz[i]; o.nz = -tx[i]; }
    o.cx = px[i] + tx[i] * segLen[i] * bt; o.cz = pz[i] + tz[i] * segLen[i] * bt;
    const t = bt, t2 = t * t, t3 = t2 * t, m0 = slope[i] * DS, m1 = slope[j] * DS;
    o.y = (2 * t3 - 3 * t2 + 1) * py[i] + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * py[j] + (t3 - t2) * m1;
    o.slope = ((6 * t2 - 6 * t) * py[i] + (3 * t2 - 4 * t + 1) * m0 + (-6 * t2 + 6 * t) * py[j] + (3 * t2 - 2 * t) * m1) / DS;
    o.tx = tx[i]; o.tz = tz[i];
    return o;
  }
  const L = {}, LC = {};

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------
  const START_IDX = N - 9;
  const car = {
    x: 0, y: 0, z: 0, vy: 0, h: 0, vx: 0, vz: 0, steer: 0, yaw: 0,
    idx: START_IDX, grounded: true, drifting: false, driftDir: 0, driftTime: 0, driftLevel: 0,
    grip: CFG.gripNormal, boost: 1, boostOn: false, turbo: 0, slip: 0, speed: 0, offroad: 0,
    latAcc: 0, accF: 0, gap: 0, bump: 0, bumpV: 0, pitch: 0, roll: 0, wallT: 0, lat: 0, gy: 0,
  };
  const game = {
    state: 'title', clock: 0, cdT: 0, cdN: 4, timing: false, lapStart: 0, lapNo: 0,
    last: null, best: null, ghost: null, rec: [], U: 0, maxU: 0, fi: 0, marks: [], lapBaseU: 0,
    camMode: 0, shake: 0, camYaw: 0, camFov: 68, camY: 0, camSnap: true, wrongT: 0,
    deltaT: 0, delta: null, rHeld: 0, rFired: false, msgT: 0, paused: false,
  };

  function placeOnTrack(idx, resetSpeed) {
    idx = ((idx % N) + N) % N;
    car.x = px[idx]; car.z = pz[idx]; car.y = py[idx];
    car.h = Math.atan2(stx[idx], stz[idx]);
    car.vx = car.vz = 0; car.vy = 0; car.steer = 0; car.yaw = 0;
    car.grounded = true; car.drifting = false; car.driftTime = 0; car.turbo = 0; car.boostOn = false; car.driftDir = 0;
    car.grip = CFG.gripNormal; car.idx = idx; car.speed = 0; car.slip = 0;
    locate(car.x, car.z, idx, -1, L); car.idx = L.i; car.y = L.y + 0.04; car.gy = L.y + 0.04;
    game.fi = L.i + L.t; game.camSnap = true;
  }
  function resetRun() {
    placeOnTrack(START_IDX);
    game.fi = car.idx + L.t;
    game.U = game.fi - N; game.maxU = game.U;
    game.timing = false; game.lapNo = 0; game.clock = 0; game.rec = []; game.marks = []; game.lapBaseU = 0;
    game.delta = null; game.last = null;
    car.boost = 1;
    ghostObj.root.visible = false;
  }
  resetRun();

  // ------------------------------------------------------------------
  // Persistence
  // ------------------------------------------------------------------
  const SAVE_KEY = 'dune_warden_best_v1';
  function loadBest() {
    try {
      const s = localStorage.getItem(SAVE_KEY); if (!s) return;
      const o = JSON.parse(s);
      if (o && o.v === N && o.g && o.g.length > 8) game.best = { t: o.t, g: o.g, m: o.m || [] };
    } catch (e) { /* storage may be blocked on file:// in some browsers - game still works */ }
  }
  function saveBest() {
    try {
      const b = game.best;
      localStorage.setItem(SAVE_KEY, JSON.stringify({ v: N, t: b.t, g: b.g, m: b.m }));
    } catch (e) { }
  }
  loadBest();

  // ------------------------------------------------------------------
  // Input
  // ------------------------------------------------------------------
  const keys = Object.create(null);
  const input = { throttle: 0, brake: 0, left: 0, right: 0, drift: 0, boost: 0 };
  const audio = createAudio();
  const BLOCK = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight', 'Tab']);
  addEventListener('keydown', (e) => {
    if (BLOCK.has(e.code)) e.preventDefault();
    audio.init();
    if (e.repeat) return;
    keys[e.code] = true;
    if (e.code === 'Enter' && game.state === 'title') startCountdown();
    else if (game.state === 'title' && e.code !== 'KeyM') startCountdown();
    if (e.code === 'KeyC') { game.camMode = 1 - game.camMode; game.camSnap = true; carObj.driver.visible = game.camMode === 0; }
    if (e.code === 'KeyM') { const m = audio.toggleMute(); toast(m ? 'SOUND OFF' : 'SOUND ON'); }
    if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
    if (e.code === 'KeyR') { game.rHeld = 0; game.rFired = false; }
  });
  addEventListener('keyup', (e) => {
    if (BLOCK.has(e.code)) e.preventDefault();
    keys[e.code] = false;
    if (e.code === 'KeyR' && !game.rFired && (game.state === 'race' || game.state === 'countdown')) respawn();
  });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (game.state === 'race') togglePause(true); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && game.state === 'race') togglePause(true); });

  function readInput() {
    input.throttle = (keys.KeyW || keys.ArrowUp) ? 1 : 0;
    input.brake = (keys.KeyS || keys.ArrowDown) ? 1 : 0;
    input.left = (keys.KeyA || keys.ArrowLeft) ? 1 : 0;
    input.right = (keys.KeyD || keys.ArrowRight) ? 1 : 0;
    input.drift = keys.Space ? 1 : 0;
    input.boost = (keys.ShiftLeft || keys.ShiftRight) ? 1 : 0;
  }

  function togglePause(force) {
    if (game.state !== 'race' && game.state !== 'paused') return;
    if (game.state === 'paused' && force === true) return;
    if (game.state === 'race') { game.state = 'paused'; $('pause').style.display = 'flex'; }
    else { game.state = 'race'; $('pause').style.display = 'none'; }
  }
  function respawn() {
    const idx = car.idx;
    placeOnTrack(idx);
    game.camSnap = true;
    toast('RESET');
  }
  function startCountdown() {
    if (game.state === 'countdown') return;
    $('title').style.display = 'none';
    resetRun();
    game.state = 'countdown'; game.cdT = 0; game.cdN = 4;
  }

  // ------------------------------------------------------------------
  // Particles
  // ------------------------------------------------------------------
  const PN = 140, parts = [];
  const pGeo = new THREE.IcosahedronGeometry(0.5, 0);
  for (let k = 0; k < PN; k++) {
    const m = new THREE.Mesh(pGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, fog: true }));
    m.visible = false; scene.add(m);
    parts.push({ m, life: 0, max: 1, vx: 0, vy: 0, vz: 0, s0: 1, grow: 0, a0: 1, grav: 0 });
  }
  let pCursor = 0;
  function spawn(x, y, z, vx, vy, vz, life, size, grow, hex, alpha, grav) {
    const p = parts[pCursor]; pCursor = (pCursor + 1) % PN;
    p.m.visible = true; p.m.position.set(x, y, z); p.m.material.color.setHex(hex); p.m.material.opacity = alpha;
    p.vx = vx; p.vy = vy; p.vz = vz; p.life = p.max = life; p.s0 = size; p.grow = grow; p.a0 = alpha; p.grav = grav || 0;
    p.m.scale.setScalar(size); p.m.rotation.set(Math.random() * 6, Math.random() * 6, 0);
  }
  function updateParticles(dt) {
    for (const p of parts) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.m.visible = false; continue; }
      const k = p.life / p.max;
      p.vy -= p.grav * dt;
      p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
      p.m.scale.setScalar(p.s0 + p.grow * (1 - k));
      p.m.material.opacity = p.a0 * k;
    }
  }

  // ------------------------------------------------------------------
  // Physics
  // ------------------------------------------------------------------
  const FIXED = 1 / 120;
  let steerSign = 0;

  function physics(dt) {
    const locked = game.state === 'countdown';
    const thr = locked ? 0 : input.throttle, brk = locked ? 0 : input.brake;
    const wantDrift = locked ? 0 : input.drift, wantBoost = locked ? 0 : input.boost;

    locate(car.x, car.z, car.idx, 6, L); car.idx = L.i; car.lat = L.lat;
    const fx = Math.sin(car.h), fz = Math.cos(car.h), rx = -fz, rz = fx;
    let f = car.vx * fx + car.vz * fz, l = car.vx * rx + car.vz * rz;
    const f0 = f;

    // --- steering input slew
    const target = input.left - input.right;
    let rate = CFG.steerRise;
    if (target === 0) rate = CFG.steerReturn; else if (car.steer * target < 0) rate = CFG.steerCounter;
    car.steer += clamp(target - car.steer, -rate * dt, rate * dt);
    if (locked) car.steer = 0;

    car.offroad = Math.abs(L.lat) > HALF_ROAD + 0.4 ? 1 : 0;

    // --- boost meter
    if (wantBoost && (car.boostOn || car.boost > 0.08) && car.boost > 0) {
      if (!car.boostOn) { audio.boostStart(); }
      car.boostOn = true; car.boost = Math.max(0, car.boost - CFG.boostDrain * dt);
      if (car.boost <= 0) car.boostOn = false;
    } else { car.boostOn = false; car.boost = Math.min(1, car.boost + CFG.boostRegen * dt); }
    if (car.turbo > 0) car.turbo -= dt;
    const surge = car.boostOn || car.turbo > 0;

    if (car.grounded) {
      // --- drift state machine
      if (wantDrift && !car.drifting && f > CFG.driftMinSpeed) {
        car.drifting = true; car.driftTime = 0; car.driftLevel = 0;
        car.driftDir = Math.abs(car.steer) > 0.15 ? Math.sign(car.steer) : 0;
        car.bumpV += 2.6; audio.driftStart();
      }
      if (car.drifting) {
        if (car.driftDir === 0 && Math.abs(car.steer) > 0.25) car.driftDir = Math.sign(car.steer);
        const slipAng = Math.abs(Math.atan2(l, Math.max(1, f)));
        if (slipAng > 0.18) car.driftTime += dt;
        let lvl = 0; for (let k = 0; k < 3; k++) if (car.driftTime > CFG.turboAt[k]) lvl = k + 1;
        if (lvl > car.driftLevel) { car.driftLevel = lvl; audio.chime(); }
        if (f > 20) car.boost = Math.min(1, car.boost + CFG.driftRegen * dt);
        if (!wantDrift || f < 8) {
          car.drifting = false;
          if (car.driftLevel > 0) { car.turbo = CFG.turboTimes[car.driftLevel - 1]; audio.turbo(); game.shake = Math.max(game.shake, 0.35); }
          car.driftLevel = 0; car.driftTime = 0;
        }
      }

      // --- throttle / brake / drag along forward axis
      const vmaxBase = CFG.vMax * (car.offroad ? 0.84 : 1);
      const vmax = surge ? CFG.vBoost * (car.offroad ? 0.92 : 1) : vmaxBase;
      const effThr = thr || surge;
      if (effThr) {
        if (f < -0.5) f += (CFG.accel + CFG.brake) * 0.8 * dt;
        else {
          const a = surge ? CFG.boostAccel * (1 - Math.pow(Math.max(0, f) / vmax, 2.5)) + 6 : CFG.accel * (1 - Math.pow(Math.max(0, f) / vmax, 1.8));
          f += Math.max(a, 0) * dt;
        }
      }
      if (brk && !effThr) {
        if (f > 1) f = Math.max(0, f - CFG.brake * dt);
        else f = Math.max(-CFG.reverseMax, f - 15 * dt);
      } else if (brk && effThr) {
        f = Math.max(0, f - CFG.brake * 0.5 * dt);
      }
      if (!effThr && !brk) {
        const d = (CFG.coast + CFG.coastDrag * f * f) * dt;
        f = Math.abs(f) <= d ? 0 : f - Math.sign(f) * d;
      }
      if (f > vmax) f -= ((f - vmax) * 0.6 + 1.2) * dt;
      if (car.offroad) f -= Math.sign(f) * Math.min(Math.abs(f), 3.2 * dt);
      if (car.drifting) f -= 0.9 * dt;
      // gravity along slope
      const al = L.tx * fx + L.tz * fz;
      f -= CFG.slopeG * L.slope * al * dt;

      // --- yaw
      const af = Math.abs(f);
      const yawMax = CFG.yawBase / (1 + Math.pow(af / CFG.yawSpeedRef, 1.5));
      let eff = car.steer;
      if (car.drifting && car.driftDir !== 0) eff = car.driftDir * clamp(0.75 + 0.55 * car.steer * car.driftDir, 0.2, 1.3);
      let w = eff * yawMax * Math.min(1, af / 5) * (f >= 0 ? 1 : -1);
      if (car.drifting) w *= CFG.driftYawMul;
      car.yaw += (w - car.yaw) * damp(24, dt);
      // --- lateral grip
      const gTarget = car.drifting ? CFG.gripDrift : CFG.gripNormal - 3.2 * Math.abs(car.steer) * clamp(af / 40, 0, 1);
      car.grip += (gTarget - car.grip) * damp(car.drifting ? 12 : 7, dt);
      const sp0 = Math.hypot(f, l);
      const removed = l * (1 - Math.exp(-car.grip * dt));
      l -= removed;
      const sp1 = Math.hypot(f, l);
      if (sp1 > 0.1) { const k = 1 + (sp0 / sp1 - 1) * (car.drifting ? CFG.retainDrift : CFG.retainNormal); f *= k; l *= k; }

      car.latAcc = car.yaw * f;
      car.slip = clamp(Math.abs(l) / 9, 0, 1);
      car.accF = (f - f0) / dt;
    } else {
      // airborne: keep momentum, little steering authority
      car.yaw += (car.steer * 0.7 - car.yaw) * damp(4, dt);
      car.slip = 0; car.accF = 0; car.latAcc *= 0.95;
      if (car.drifting && !wantDrift) { car.drifting = false; car.driftLevel = 0; car.driftTime = 0; }
    }

    // rebuild world velocity in the OLD heading basis, then rotate heading
    car.vx = fx * f + rx * l; car.vz = fz * f + rz * l;
    car.h += car.yaw * dt;
    car.x += car.vx * dt; car.z += car.vz * dt;

    // --- ground
    locate(car.x, car.z, car.idx, 6, L); car.idx = L.i; car.lat = L.lat;
    const gy = L.y + 0.04; car.gy = gy;
    if (car.grounded) {
      const predicted = car.y + car.vy * dt - 0.5 * CFG.gravityAir * dt * dt;
      const speed = Math.hypot(car.vx, car.vz);
      car.gap = Math.max(0, car.gap * 0.9 + (predicted - gy));
      if (speed > 14 && car.gap > 0.006) {
        car.grounded = false; car.gap = 0; car.y = Math.max(predicted, gy); car.vy -= CFG.gravityAir * dt;
      } else { car.vy = (gy - car.y) / dt; car.y = gy; }
    } else {
      car.vy -= CFG.gravityAir * dt; car.y += car.vy * dt;
      if (car.y <= gy) {
        const groundVy = 0;
        const impact = -(car.vy - groundVy);
        car.y = gy; car.grounded = true;
        if (impact > 5) {
          const p = clamp((impact - 5) / 14, 0, 1);
          car.bumpV -= impact * 0.35; game.shake = Math.max(game.shake, 0.25 + p * 0.5);
          audio.land(p + 0.2);
          const sp = Math.hypot(car.vx, car.vz) * (1 - 0.06 * p); const cur = Math.hypot(car.vx, car.vz) || 1;
          car.vx *= sp / cur; car.vz *= sp / cur;
          for (let k = 0; k < 8; k++) spawn(car.x + (Math.random() - 0.5) * 3, gy + 0.2, car.z + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 6, 2 + Math.random() * 3, (Math.random() - 0.5) * 6, 0.8, 1.2, 3, 0xcfa978, 0.5, 3);
        }
        car.vy = L.slope * (car.vx * L.tx + car.vz * L.tz); car.gap = 0;
      }
    }

    // --- walls
    car.hitCd = Math.max(0, (car.hitCd || 0) - dt);
    if (Math.abs(L.lat) > CAR_LIMIT) {
      const over = Math.abs(L.lat) - CAR_LIMIT;
      car.x -= L.nx * over; car.z -= L.nz * over;
      const vn = car.vx * L.nx + car.vz * L.nz;
      if (vn > 0) {
        car.vx -= 1.2 * vn * L.nx; car.vz -= 1.2 * vn * L.nz;      // bounce the normal component
        const hit = clamp(vn / 26, 0, 1);
        const keep = 1 - 0.28 * hit * hit - 0.02 * hit;             // only real impacts cost speed
        car.vx *= keep; car.vz *= keep;
        // nudge heading toward the track direction so you slide along the wall, not spin into it
        const ht = Math.atan2(L.tx, L.tz);
        let dh = wrapPI(ht - car.h); if (Math.abs(dh) > Math.PI / 2) dh = wrapPI(dh + Math.PI);
        car.h += clamp(dh, -0.5, 0.5) * (0.03 + 0.6 * hit);
        if (vn > 2.5 && car.hitCd <= 0) {
          car.hitCd = vn > 8 ? 0.25 : 0.08;
          game.shake = Math.max(game.shake, 0.15 + hit * 0.85); audio.hit(hit);
          for (let k = 0; k < 7; k++) spawn(car.x + L.nx * 1.2, car.y + 0.7, car.z + L.nz * 1.2, -L.nx * 3 + (Math.random() - 0.5) * 8, 2 + Math.random() * 5, -L.nz * 3 + (Math.random() - 0.5) * 8, 0.45, 0.22, 0, 0xffc15a, 1, 12);
        }
      }
      car.vx *= 1 - 0.7 * dt; car.vz *= 1 - 0.7 * dt;               // light scrape drag
    }
    car.speed = car.vx * Math.sin(car.h) + car.vz * Math.cos(car.h);
    game.clock += dt;
    trackProgress(dt);
  }

  // ------------------------------------------------------------------
  // Laps
  // ------------------------------------------------------------------
  const MARK = 25;
  function trackProgress(dt) {
    const fi = car.idx + L.t;
    let d = fi - game.fi; if (d > N / 2) d -= N; else if (d < -N / 2) d += N;
    game.fi = fi; game.U += d;
    if (game.U <= game.maxU) return;
    const prevMax = game.maxU; game.maxU = game.U;
    const kNow = Math.floor(game.maxU / N), kPrev = Math.floor(prevMax / N);
    if (kNow > kPrev) {
      const frac = (game.maxU - kNow * N) / Math.max(1e-6, game.maxU - prevMax);
      onLine(kNow, game.clock - frac * dt);
    }
    if (game.timing) {
      const m = Math.floor((game.maxU - game.lapBaseU) / MARK) - 1;
      if (m >= game.marks.length && m < Math.floor(N / MARK)) {
        const lt = game.clock - game.lapStart; game.marks[m] = lt;
        if (game.best && game.best.m[m] != null) { game.delta = lt - game.best.m[m]; game.deltaT = 2.5; }
      }
    }
  }
  function onLine(k, tCross) {
    if (k === 0) { // first crossing: start the timer
      game.timing = true; game.lapStart = tCross; game.lapNo = 1; game.lapBaseU = 0; game.marks = []; game.rec = [];
      toast('LAP 1', 'go'); audio.chime();
      return;
    }
    if (!game.timing) return;
    const lt = tCross - game.lapStart;
    game.last = lt;
    const isBest = !game.best || lt < game.best.t - 1e-6;
    const prevBest = game.best ? game.best.t : null;
    if (isBest) {
      pushRec(lt);
      game.best = { t: lt, g: game.rec.slice(), m: game.marks.slice() };
      saveBest(); audio.best();
      toast(prevBest == null ? 'LAP ' + fmt(lt) : 'NEW BEST  ' + fmt(lt) + '  (' + (lt - prevBest).toFixed(3) + ')', 'best');
    } else {
      toast('LAP ' + fmt(lt) + '   +' + (lt - game.best.t).toFixed(3), 'lap');
      audio.chime();
    }
    game.lapStart = tCross; game.lapNo = k + 1; game.lapBaseU = k * N; game.marks = []; game.rec = []; game.delta = null;
  }
  function pushRec(lt) {
    const idx = Math.floor(lt / 0.05);
    while (game.rec.length / 4 <= idx) game.rec.push(+car.x.toFixed(2), +car.y.toFixed(2), +car.z.toFixed(2), +car.h.toFixed(3));
  }

  // ------------------------------------------------------------------
  // HUD
  // ------------------------------------------------------------------
  function fmt(t) {
    if (t == null) return '--:--.---';
    const m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(3);
  }
  const el = {
    time: $('time'), last: $('last'), best: $('best'), lap: $('lap'), delta: $('delta'), spd: $('spd'),
    boost: $('boostfill'), pips: [$('p1'), $('p2'), $('p3')], msg: $('msg'), toast: $('toast'), wrong: $('wrong'),
    rbar: $('rbar'), cd: $('cd'), vig: $('vig'),
  };
  let toastT = 0;
  function toast(txt, cls) {
    el.toast.textContent = txt; el.toast.className = 'show ' + (cls || ''); toastT = 2.4;
  }
  // minimap
  const mm = $('mm'), mx = mm.getContext('2d');
  const mmBg = document.createElement('canvas'); mmBg.width = mm.width; mmBg.height = mm.height;
  let mmS = 1, mmOx = 0, mmOy = 0;
  (function buildMini() {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < N; i++) { x0 = Math.min(x0, -px[i]); x1 = Math.max(x1, -px[i]); z0 = Math.min(z0, -pz[i]); z1 = Math.max(z1, -pz[i]); }
    const pad = 14, W = mm.width, H = mm.height;
    mmS = Math.min((W - pad * 2) / (x1 - x0), (H - pad * 2) / (z1 - z0));
    mmOx = (W - (x1 - x0) * mmS) / 2 - x0 * mmS; mmOy = (H - (z1 - z0) * mmS) / 2 - z0 * mmS;
    const c = mmBg.getContext('2d');
    c.lineJoin = 'round'; c.lineCap = 'round';
    c.beginPath();
    for (let i = 0; i <= N; i += 2) { const k = i % N; const X = -px[k] * mmS + mmOx, Y = -pz[k] * mmS + mmOy; i ? c.lineTo(X, Y) : c.moveTo(X, Y); }
    c.closePath();
    c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = 7; c.stroke();
    c.strokeStyle = '#e8dcc4'; c.lineWidth = 3.2; c.stroke();
    // start tick
    const sx = -px[0] * mmS + mmOx, sy = -pz[0] * mmS + mmOy;
    c.fillStyle = '#63ecff'; c.fillRect(sx - 5, sy - 1.5, 10, 3);
  })();
  function drawMini() {
    mx.clearRect(0, 0, mm.width, mm.height);
    mx.drawImage(mmBg, 0, 0);
    const dot = (x, z, col, r) => { mx.beginPath(); mx.arc(-x * mmS + mmOx, -z * mmS + mmOy, r, 0, 7); mx.fillStyle = col; mx.fill(); };
    if (ghostObj.root.visible) dot(ghostObj.root.position.x, ghostObj.root.position.z, '#7fe9ff', 3);
    dot(car.x, car.z, '#ff7a1f', 4.5);
    mx.strokeStyle = '#fff'; mx.lineWidth = 1.2; mx.beginPath(); mx.arc(-car.x * mmS + mmOx, -car.z * mmS + mmOy, 4.5, 0, 7); mx.stroke();
  }
  // speed lines overlay
  const fx = $('fx'), fxc = fx.getContext('2d');
  const lines = Array.from({ length: 46 }, () => ({ a: Math.random() * 6.283, r: Math.random(), s: 0.5 + Math.random() }));
  function drawFx(dt, amount) {
    fxc.clearRect(0, 0, fx.width, fx.height);
    if (amount < 0.02) return;
    const cx = fx.width / 2, cy = fx.height * 0.46, R = Math.hypot(cx, cy);
    fxc.lineCap = 'round';
    for (const ln of lines) {
      ln.r += dt * (1.4 + amount * 2.2) * ln.s; if (ln.r > 1) { ln.r = 0.12 + Math.random() * 0.1; ln.a = Math.random() * 6.283; }
      const r0 = (0.35 + ln.r * 0.7) * R, r1 = r0 + R * 0.12 * (0.4 + ln.r) * (0.5 + amount);
      fxc.strokeStyle = 'rgba(255,255,255,' + (0.5 * amount * ln.r) + ')';
      fxc.lineWidth = 1 + ln.r * 2.2 * fx.height / 900;
      fxc.beginPath(); fxc.moveTo(cx + Math.cos(ln.a) * r0, cy + Math.sin(ln.a) * r0); fxc.lineTo(cx + Math.cos(ln.a) * r1, cy + Math.sin(ln.a) * r1); fxc.stroke();
    }
  }

  // ------------------------------------------------------------------
  // Visual update (render-rate)
  // ------------------------------------------------------------------
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
  const tmpV = new THREE.Vector3();
  let dustAcc = 0, sparkAcc = 0, trailAcc = 0;

  function updateCar(dt) {
    const sp01 = clamp(Math.abs(car.speed) / CFG.vBoost, 0, 1);
    // spring for vertical bump
    car.bumpV += (-90 * car.bump - 12 * car.bumpV) * dt; car.bump += car.bumpV * dt;
    car.bump = clamp(car.bump, -0.35, 0.35);
    // pitch / roll
    const slopeAlong = L.slope * (L.tx * Math.sin(car.h) + L.tz * Math.cos(car.h));
    let pTarget = -Math.atan(slopeAlong) - car.accF * 0.0028;
    if (!car.grounded) pTarget = -Math.atan2(car.vy, Math.max(8, Math.abs(car.speed)));
    car.pitch += (pTarget - car.pitch) * damp(9, dt);
    const rTarget = clamp(car.latAcc * 0.0042, -0.16, 0.16) + (car.drifting ? car.driftDir * 0.05 : 0);
    car.roll += (rTarget - car.roll) * damp(9, dt);

    carObj.root.position.set(car.x, car.y, car.z);
    carObj.root.rotation.y = car.h;
    carObj.tilt.rotation.x = car.pitch; carObj.tilt.rotation.z = car.roll;
    carObj.body.position.y = car.bump;
    // wheels
    const spin = car.speed / 0.58 * dt;
    for (const w of carObj.wheels) { w.spin.rotation.x += spin; if (w.front) w.steer.rotation.y = car.steer * 0.42 + car.yaw * 0.08; }
    // flames
    const fl = car.boostOn || car.turbo > 0;
    for (const f of carObj.flames) { f.visible = fl; if (fl) { const s = 1 + Math.random() * 0.5; f.scale.set(1, s * 1.6, 1); } }
    // shadow
    carObj.shadow.position.set(car.x, car.gy + 0.08, car.z);
    carObj.shadow.rotation.order = 'YXZ';
    carObj.shadow.rotation.set(-Math.PI / 2, car.h, 0);
    carObj.shadow.material.opacity = clamp(1 - (car.y - car.gy) * 0.12, 0.2, 1);

    // particles
    const fx_ = Math.sin(car.h), fz_ = Math.cos(car.h), rx_ = -fz_, rz_ = fx_;
    const spd = Math.abs(car.speed);
    if (car.grounded) {
      dustAcc += dt * (car.offroad ? spd * 0.9 : 0) + dt * car.slip * spd * 0.8;
      while (dustAcc > 1) {
        dustAcc -= 1; const side = Math.random() < 0.5 ? -1 : 1;
        const wx = car.x + rx_ * 1.05 * side - fx_ * 1.45, wz = car.z + rz_ * 1.05 * side - fz_ * 1.45;
        spawn(wx, car.gy + 0.3, wz, -car.vx * 0.1 + (Math.random() - 0.5) * 2, 0.6 + Math.random() * 1.4, -car.vz * 0.1 + (Math.random() - 0.5) * 2, 0.9 + Math.random() * 0.5, 0.7, 2.4, car.offroad ? 0xd6b27c : 0xe9dcc6, 0.55, -0.4);
      }
    }
    if (car.drifting && car.driftLevel > 0 && car.grounded) {
      sparkAcc += dt * 55;
      const col = [0, 0x58b8ff, 0xffa030, 0xd070ff][car.driftLevel];
      while (sparkAcc > 1) {
        sparkAcc -= 1; const side = Math.random() < 0.5 ? -1 : 1;
        spawn(car.x + rx_ * 1.05 * side - fx_ * 1.45, car.gy + 0.25, car.z + rz_ * 1.05 * side - fz_ * 1.45, (Math.random() - 0.5) * 5 - fx_ * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 5 - fz_ * 3, 0.35, 0.2, 0, col, 1, 14);
      }
    }
    if (fl) {
      trailAcc += dt * 45;
      while (trailAcc > 1) {
        trailAcc -= 1; const s = Math.random() < 0.5 ? -1 : 1;
        spawn(car.x + rx_ * 0.62 * s - fx_ * 3.0, car.y + 1.15, car.z + rz_ * 0.62 * s - fz_ * 3.0, -fx_ * 8 + (Math.random() - 0.5), (Math.random() - 0.5), -fz_ * 8 + (Math.random() - 0.5), 0.35, 0.3, -0.2, 0x7ff3ff, 0.8, 0);
      }
    }
  }

  function updateCamera(dt) {
    const sp = Math.abs(car.speed), sp01 = clamp(sp / CFG.vBoost, 0, 1);
    const surge = car.boostOn || car.turbo > 0;
    const velAng = Math.hypot(car.vx, car.vz) > 6 ? Math.atan2(car.vx, car.vz) : car.h;
    let targetYaw = car.h + wrapPI(velAng - car.h) * (game.camMode === 0 ? 0.6 : 0.3);
    if (car.speed < -1) targetYaw = car.h; // reversing: keep behind
    if (game.camSnap) game.camYaw = targetYaw; else game.camYaw += wrapPI(targetYaw - game.camYaw) * damp(game.camMode === 0 ? 6.5 : 14, dt);
    const dx = Math.sin(game.camYaw), dz = Math.cos(game.camYaw);
    const fovT = (game.camMode === 0 ? 66 : 80) + 12 * sp01 + (surge ? 9 : 0);
    game.camFov += (fovT - game.camFov) * damp(5, dt);
    if (Math.abs(camera.fov - game.camFov) > 0.01) { camera.fov = game.camFov; camera.updateProjectionMatrix(); }

    if (game.camMode === 0) {
      const dist = 6.3 + 2.4 * sp01 + (surge ? 0.9 : 0);
      const h = 2.35 + 0.65 * sp01;
      const wantY = car.y + h;
      if (game.camSnap) game.camY = wantY; else game.camY += (wantY - game.camY) * damp(9, dt);
      camPos.set(car.x - dx * dist, game.camY, car.z - dz * dist);
      camLook.set(car.x + dx * 9, car.y + 1.5 + car.pitch * -2, car.z + dz * 9);
    } else {
      const fx_ = Math.sin(car.h), fz_ = Math.cos(car.h);
      camPos.set(car.x - fx_ * 0.1, car.y + car.bump + 1.9, car.z - fz_ * 0.1);
      camLook.set(car.x + dx * 14, car.y + 1.55 + car.pitch * -8, car.z + dz * 14);
    }
    // keep camera inside the canyon & above the ground
    locate(camPos.x, camPos.z, car.idx, 10, LC);
    if (game.camMode === 0 && Math.abs(LC.lat) > CAR_LIMIT + 0.8) {
      const over = Math.abs(LC.lat) - (CAR_LIMIT + 0.8); camPos.x -= LC.nx * over; camPos.z -= LC.nz * over;
    }
    if (camPos.y < LC.y + 1.1) camPos.y = LC.y + 1.1;
    game.camSnap = false;

    game.shake = Math.max(0, game.shake - dt * 1.6);
    const sh = game.shake * 0.35 + (surge ? 0.035 : 0) + sp01 * 0.012;
    camera.position.set(camPos.x + (Math.random() - 0.5) * sh, camPos.y + (Math.random() - 0.5) * sh, camPos.z + (Math.random() - 0.5) * sh);
    camera.lookAt(camLook);
    if (game.camMode === 0) camera.rotateZ(-clamp(car.latAcc * 0.0009, -0.04, 0.04) - car.driftDir * (car.drifting ? 0.03 : 0));
    // sky follows
    sky.sky.position.copy(camera.position); sky.grp.position.copy(camera.position);
  }

  function updateGhost() {
    const g = game.best;
    if (!g || !game.timing || game.state === 'title') { ghostObj.root.visible = false; return; }
    const lt = game.clock - game.lapStart;
    if (lt > g.t + 0.3 || lt < 0) { ghostObj.root.visible = false; return; }
    const f = lt / 0.05, i = Math.floor(f), a = f - i, n = g.g.length / 4;
    if (i >= n - 1) { ghostObj.root.visible = false; return; }
    const o = i * 4, p = o + 4, G = g.g;
    ghostObj.root.visible = true;
    ghostObj.root.position.set(lerp(G[o], G[p], a), lerp(G[o + 1], G[p + 1], a), lerp(G[o + 2], G[p + 2], a));
    ghostObj.root.rotation.y = G[o + 3] + wrapPI(G[p + 3] - G[o + 3]) * a;
  }

  function updateHud(dt) {
    const lt = game.timing ? game.clock - game.lapStart : 0;
    el.time.textContent = fmt(game.timing ? lt : 0).replace('--:--.---', '0:00.000');
    el.last.textContent = fmt(game.last);
    el.best.textContent = fmt(game.best ? game.best.t : null);
    el.lap.textContent = game.timing ? 'LAP ' + game.lapNo : 'READY';
    const kmh = Math.round(Math.hypot(car.vx, car.vz) * 3.6);
    el.spd.textContent = kmh;
    el.boost.style.width = (car.boost * 100).toFixed(1) + '%';
    el.boost.className = car.boostOn ? 'on' : (car.boost < 0.1 ? 'low' : '');
    for (let k = 0; k < 3; k++) el.pips[k].className = 'pip' + (car.drifting && car.driftLevel > k ? ' on' + (k + 1) : '');
    if (game.deltaT > 0 && game.delta != null) {
      game.deltaT -= dt;
      el.delta.textContent = (game.delta >= 0 ? '+' : '−') + Math.abs(game.delta).toFixed(2);
      el.delta.className = 'show ' + (game.delta >= 0 ? 'pos' : 'neg');
    } else el.delta.className = '';
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) el.toast.className = ''; }
    // wrong way
    const dot = car.vx * L.tx + car.vz * L.tz;
    if (game.state === 'race' && dot < -6) game.wrongT += dt; else game.wrongT = Math.max(0, game.wrongT - dt * 2);
    el.wrong.className = game.wrongT > 0.8 ? 'show' : '';
    // hold-R progress
    if (keys.KeyR && game.state !== 'title') {
      game.rHeld += dt;
      el.rbar.style.opacity = game.rHeld > 0.15 ? 1 : 0; el.rbar.firstElementChild.style.width = clamp(game.rHeld / 0.9, 0, 1) * 100 + '%';
      if (game.rHeld > 0.9 && !game.rFired) { game.rFired = true; if (game.state === 'paused') togglePause(); startCountdownForce(); }
    } else el.rbar.style.opacity = 0;
    // vignette boost
    el.vig.style.opacity = (car.boostOn || car.turbo > 0) ? 1 : 0;
    drawMini();
  }
  function startCountdownForce() { game.state = 'title'; startCountdown(); }

  // ------------------------------------------------------------------
  // Main loop
  // ------------------------------------------------------------------
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setPixelRatio(pixelRatio); renderer.setSize(w, h, false);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    camera.aspect = w / h; camera.updateProjectionMatrix();
    fx.width = w; fx.height = h;
  }
  addEventListener('resize', resize); resize();

  let acc = 0, prev = performance.now(), fpsT = 0, fpsN = 0, slowStreak = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - prev) / 1000; prev = now;
    if (dt > 0.1) dt = 0.1;
    readInput();

    if (game.state === 'countdown') {
      game.cdT += dt;
      const n = 3 - Math.floor(game.cdT / 0.9);
      if (n !== game.cdN) {
        game.cdN = n;
        if (n > 0) { el.cd.textContent = n; el.cd.className = 'show'; audio.beep(false); }
        else { el.cd.textContent = 'GO'; el.cd.className = 'show go'; audio.beep(true); game.state = 'race'; setTimeout(() => { if (el.cd.textContent === 'GO') el.cd.className = ''; }, 700); }
      }
    }
    if (game.state === 'race' || game.state === 'countdown') {
      acc += dt;
      let steps = 0;
      while (acc >= FIXED && steps < 12) { physics(FIXED); acc -= FIXED; steps++; }
      if (steps === 12) acc = 0;
    } else if (game.state === 'title') {
      locate(car.x, car.z, car.idx, 6, L);
    }
    // timer-based events inside `race` only; clock freezes in countdown (physics adds clock too, so undo)
    if (game.state === 'countdown') game.clock = 0;

    if (game.timing) { const lt = game.clock - game.lapStart; pushRec(lt); }
    updateCar(dt);
    updateParticles(dt);
    updateCamera(dt);
    updateGhost();
    const surge = car.boostOn || car.turbo > 0;
    drawFx(dt, game.state === 'race' ? clamp((surge ? 0.6 : 0) + Math.max(0, Math.abs(car.speed) - 50) / 60, 0, 1) : 0);
    updateHud(dt);
    audio.update(dt, { speed: car.speed, throttle: game.state === 'title' ? 0 : (input.throttle || input.boost ? 1 : 0), boost: surge && game.state === 'race', slip: car.grounded ? (car.drifting ? 0.8 : car.slip * 0.7) : 0, offroad: car.offroad && car.grounded ? 1 : 0, paused: game.state === 'paused' || game.state === 'title' });
    renderer.render(scene, camera);

    // adaptive resolution
    fpsT += dt; fpsN++;
    if (fpsT > 1.5) {
      const fps = fpsN / fpsT; fpsT = 0; fpsN = 0;
      if (fps < 40 && pixelRatio > 0.8) { slowStreak++; if (slowStreak >= 2) { pixelRatio = Math.max(0.75, pixelRatio - 0.25); resize(); slowStreak = 0; } } else slowStreak = 0;
      if (window.__fps) window.__fps(fps);
    }
  }
  $('loading').style.display = 'none';
  requestAnimationFrame(frame);

  window.__game = { car, game, input, keys, CFG, T, locate, L, resetRun, startCountdown, renderer, camera, scene, physics, FIXED, placeOnTrack, ghostObj };
})();
