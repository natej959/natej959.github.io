/* ===== WAR ZONE: things that move. Dropships, artillery, explosions, burning wrecks ===== */
function buildWarZone(THREE, scene, T, world) {
  const { N, px, py, pz, stx, stz, gap, tunnel } = T;
  const W = (i) => ((i % N) + N) % N;
  const add = (parent, geo, m, x, y, z, rx, ry, rz) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx || 0, ry || 0, rz || 0); parent.add(o); return o; };
  const hull = new THREE.MeshLambertMaterial({ color: 0x5c6070, flatShading: true });
  const hullD = new THREE.MeshLambertMaterial({ color: 0x33343e, flatShading: true });
  const accent = new THREE.MeshLambertMaterial({ color: 0xb4452c, flatShading: true });
  const add2 = (hex, op) => new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: op == null ? 1 : op, blending: THREE.AdditiveBlending, depthWrite: false });
  let cx = 0, cz = 0; for (let i = 0; i < N; i++) { cx += px[i]; cz += pz[i]; } cx /= N; cz /= N;
  const plainY = world.plainY;

  // ---- dropships: original twin-pod gunships circling the battle ----
  function makeShip() {
    const g = new THREE.Group();
    add(g, tbox(THREE, 7, 4, 0, 3, 2.4, 0.6, 18), hull, 0, 0, 0);
    add(g, tbox(THREE, 4, 2, 4, 2, 1.2, 2.6, 8), hullD, 0, 0, -2);
    add(g, new THREE.BoxGeometry(26, 0.7, 5), hullD, 0, 2.4, -3);
    add(g, new THREE.BoxGeometry(2.6, 1.4, 6), accent, 0, 3.2, -3);
    for (const s of [-1, 1]) {
      add(g, new THREE.CylinderGeometry(1.6, 1.9, 7, 8), hull, s * 12, 2.4, -3, Math.PI / 2, 0, 0);
      add(g, new THREE.CylinderGeometry(1.3, 1.3, 0.3, 8), add2(0x6ff3ff), s * 12, 2.4, -6.6, Math.PI / 2, 0, 0);
      const fl = add(g, new THREE.ConeGeometry(1.2, 6, 6), add2(0x6ff3ff, 0.55), s * 12, 2.4, -9.8, -Math.PI / 2, 0, 0);
      fl.userData.flame = true;
    }
    add(g, new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshBasicMaterial({ color: 0xff3040 }), 0, 4.1, -3).userData.blink = true;
    return g;
  }
  const ships = [];
  for (let k = 0; k < 7; k++) {
    const g = makeShip(); scene.add(g);
    const i = Math.floor((k / 7) * N);
    ships.push({ g, ox: px[i] * 0.7 + cx * 0.3, oz: pz[i] * 0.7 + cz * 0.3, r: 260 + hash2(k, 1) * 380, a: hash2(k, 2) * 6.28, w: (0.05 + hash2(k, 3) * 0.06) * (k % 2 ? 1 : -1), alt: plainY + 140 + hash2(k, 4) * 160, s: 1.6 + hash2(k, 5) * 1.4 });
  }

  // ---- crashed walkers (original four-legged assault striders) lying on the rim ----
  function makeWalker() {
    const g = new THREE.Group();
    add(g, tbox(THREE, 12, 9, 0, 9, 7, 1, 20), hull, 0, 10, 0);
    add(g, tbox(THREE, 6, 5, 0, 4, 3.5, 0.6, 7), hullD, 0, 12, 13);
    add(g, new THREE.BoxGeometry(0.9, 0.9, 8), hullD, -1.6, 13.4, 19);
    add(g, new THREE.BoxGeometry(0.9, 0.9, 8), hullD, 1.6, 13.4, 19);
    for (const [x, z, r] of [[-6, 7, 0.4], [6, 7, -0.6], [-6, -7, 1.2], [6, -7, -0.2]]) {
      add(g, new THREE.BoxGeometry(2.4, 12, 2.4), hullD, x * 1.3, 4, z, r, 0, 0);
    }
    add(g, new THREE.BoxGeometry(12.5, 0.5, 0.5), accent, 0, 15, 4);
    return g;
  }
  const fires = [];
  const fireMat = add2(0xff7a1f, 0.85);
  for (let k = 0; k < 3; k++) {
    const i = W(Math.floor((k + 0.37) / 3 * N)), side = k % 2 ? 1 : -1;
    const r = world.sampleRows(i, side)[8];
    const w = makeWalker(); w.position.set(r.x, r.y - 4, r.z);
    w.rotation.set(0.3 + k * 0.2, hash2(k, 9) * 6, 1.25 * side);
    scene.add(w);
    fires.push({ x: r.x, y: r.y + 6, z: r.z, big: 1 });
  }

  // ---- burning wrecks on the shoulders ----
  const wreckGeo = new THREE.BoxGeometry(3.6, 1.6, 6);
  for (let k = 0; k < 12; k++) {
    let i = W(Math.floor(hash2(k, 31) * N));
    if (gap[i] || i < 20 || W(i - tunnel[0]) < 70) continue;
    const side = hash2(k, 32) > 0.5 ? 1 : -1, lat = 14.6 * side;
    const x = px[i] + stz[i] * lat, z = pz[i] - stx[i] * lat;
    const m = new THREE.Mesh(wreckGeo, hullD); m.position.set(x, py[i] + 0.7, z); m.rotation.set(0.2, hash2(k, 33) * 6, side * 0.5); scene.add(m);
    const turret = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 2.4), hull); turret.position.set(x + 1.5, py[i] + 0.4, z + 2); turret.rotation.set(0.6, 1, 0.3); scene.add(turret);
    fires.push({ x, y: py[i] + 1.4, z, big: 0 });
  }
  const flameMeshes = fires.map((f) => {
    const s = f.big ? 4 : 1.4;
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.9 * s, 3 * s, 6), fireMat); m.position.set(f.x, f.y + 1.2 * s, f.z); scene.add(m);
    const glow = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2 * s, 0), add2(0xff5a10, 0.22)); glow.position.copy(m.position); scene.add(glow);
    return { m, glow, s };
  });
  // smoke columns (cycling puffs)
  const smokeMat = new THREE.MeshLambertMaterial({ color: 0x2a2430, transparent: true, opacity: 0.5, depthWrite: false, flatShading: true });
  const puffGeo = new THREE.IcosahedronGeometry(1, 0);
  const puffs = [];
  fires.forEach((f, fi) => {
    const n = f.big ? 7 : 4;
    for (let k = 0; k < n; k++) {
      const m = new THREE.Mesh(puffGeo, smokeMat.clone()); scene.add(m);
      puffs.push({ m, f, t: k / n, life: f.big ? 9 : 5, spd: f.big ? 9 : 5 });
    }
  });

  // ---- artillery bolts ----
  const bolts = [];
  const boltGeo = new THREE.BoxGeometry(0.9, 0.9, 70);
  const boltMats = [add2(0xff3048), add2(0x40ffa0), add2(0x40c8ff)];
  for (let k = 0; k < 26; k++) { const m = new THREE.Mesh(boltGeo, boltMats[k % 3]); m.visible = false; scene.add(m); bolts.push({ m, life: 0, vx: 0, vy: 0, vz: 0 }); }
  let boltCursor = 0;
  function fireBolt(x, y, z, tx, ty, tz, speed) {
    const b = bolts[boltCursor]; boltCursor = (boltCursor + 1) % bolts.length;
    const dx = tx - x, dy = ty - y, dz = tz - z, L = Math.hypot(dx, dy, dz) || 1;
    b.vx = dx / L * speed; b.vy = dy / L * speed; b.vz = dz / L * speed; b.life = L / speed + 0.2;
    b.m.position.set(x, y, z); b.m.lookAt(tx, ty, tz); b.m.visible = true;
  }

  // ---- explosions ----
  const booms = [];
  const boomGeo = new THREE.IcosahedronGeometry(1, 1);
  for (let k = 0; k < 10; k++) {
    const core = new THREE.Mesh(boomGeo, add2(0xffb050, 1)); core.visible = false; scene.add(core);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 4, 20), add2(0xffe0a0, 1)); ring.visible = false; ring.rotation.x = Math.PI / 2; scene.add(ring);
    booms.push({ core, ring, t: 1, size: 10 });
  }
  let boomCursor = 0;
  function explode(x, y, z, size) {
    const b = booms[boomCursor]; boomCursor = (boomCursor + 1) % booms.length;
    b.t = 0; b.size = size; b.core.position.set(x, y, z); b.ring.position.set(x, y + 0.5, z);
    b.core.visible = b.ring.visible = true;
  }

  let boltT = 0, boomT = 2, nearBoomT = 6, time = 0;
  const tmp = new THREE.Vector3();
  function update(dt, camera, carIdx, carPos) {
    time += dt;
    // ships
    for (const s of ships) {
      s.a += s.w * dt;
      const x = s.ox + Math.cos(s.a) * s.r, z = s.oz + Math.sin(s.a) * s.r, y = s.alt + Math.sin(time * 0.6 + s.r) * 8;
      s.g.position.set(x, y, z);
      s.g.rotation.set(0, Math.atan2(-Math.sin(s.a) * s.w, Math.cos(s.a) * s.w), -Math.sign(s.w) * 0.25);
      s.g.scale.setScalar(s.s);
      s.g.children.forEach((c) => { if (c.userData.flame) c.scale.y = 0.8 + Math.random() * 0.5; if (c.userData.blink) c.visible = (time * 2 % 1) < 0.5; });
    }
    // fires flicker
    for (const f of flameMeshes) { const k = 0.8 + Math.random() * 0.45; f.m.scale.set(k, 0.8 + Math.random() * 0.6, k); f.glow.scale.setScalar(0.85 + Math.random() * 0.3); }
    for (const p of puffs) {
      p.t += dt / p.life; if (p.t > 1) p.t -= 1;
      const s = (p.f.big ? 5 : 1.6) + p.t * (p.f.big ? 22 : 7);
      p.m.position.set(p.f.x + p.t * 14, p.f.y + 2 + p.t * p.life * p.spd, p.f.z + p.t * 6);
      p.m.scale.setScalar(s); p.m.material.opacity = 0.55 * (1 - p.t) * Math.min(1, p.t * 6);
    }
    // artillery: fire from the rims ahead of the player into the sky and at the ships
    boltT -= dt;
    if (boltT <= 0) {
      boltT = 0.08 + Math.random() * 0.25;
      const i = W(carIdx + 40 + Math.floor(Math.random() * 260)), side = Math.random() < 0.5 ? 1 : -1;
      const r = world.sampleRows(i, side)[8 + Math.floor(Math.random() * 2)];
      const tgt = Math.random() < 0.5 ? ships[Math.floor(Math.random() * ships.length)].g.position : tmp.set(r.x + (Math.random() - 0.5) * 600, r.y + 400 + Math.random() * 300, r.z + (Math.random() - 0.5) * 600);
      fireBolt(r.x, r.y + 3, r.z, tgt.x + (Math.random() - 0.5) * 40, tgt.y, tgt.z + (Math.random() - 0.5) * 40, 650);
      if (Math.random() < 0.3) { const s = ships[Math.floor(Math.random() * ships.length)].g.position; fireBolt(s.x, s.y - 4, s.z, r.x, r.y, r.z, 500); }
    }
    for (const b of bolts) {
      if (b.life <= 0) continue;
      b.life -= dt; if (b.life <= 0) { b.m.visible = false; continue; }
      b.m.position.x += b.vx * dt; b.m.position.y += b.vy * dt; b.m.position.z += b.vz * dt;
    }
    // explosions on the rims, and now and then one right by the road
    let event = null;
    boomT -= dt;
    if (boomT <= 0) {
      boomT = 0.6 + Math.random() * 1.6;
      const i = W(carIdx + 25 + Math.floor(Math.random() * 180)), side = Math.random() < 0.5 ? 1 : -1;
      const r = world.sampleRows(i, side)[7 + Math.floor(Math.random() * 3)];
      explode(r.x, r.y + 2, r.z, 10 + Math.random() * 14);
      event = { x: r.x, y: r.y, z: r.z, near: false };
    }
    nearBoomT -= dt;
    if (nearBoomT <= 0) {
      nearBoomT = 5 + Math.random() * 6;
      const i = W(carIdx + 28 + Math.floor(Math.random() * 20));
      if (!gap[i] && W(i - tunnel[0]) > 60) {
        const side = Math.random() < 0.5 ? 1 : -1, lat = (13.5 + Math.random() * 3) * side;
        const x = px[i] + stz[i] * lat, z = pz[i] - stx[i] * lat;
        explode(x, py[i] + 1, z, 7 + Math.random() * 4);
        event = { x, y: py[i], z, near: true };
      }
    }
    for (const b of booms) {
      if (b.t >= 1) continue;
      b.t += dt / 1.1;
      if (b.t >= 1) { b.core.visible = b.ring.visible = false; continue; }
      const e = 1 - Math.pow(1 - Math.min(1, b.t * 2.2), 3);
      b.core.scale.setScalar(b.size * (0.3 + e * 0.9));
      b.core.material.opacity = Math.max(0, 1 - b.t * 1.2);
      b.core.material.color.setHSL(0.08 - b.t * 0.06, 1, 0.65 - b.t * 0.35);
      b.ring.scale.setScalar(b.size * (0.5 + b.t * 2.2)); b.ring.material.opacity = Math.max(0, 0.9 - b.t);
    }
    // ring spin
    for (const r of world.ringObjs) { r.spin.rotation.z += dt * 0.6; if (r.flash > 0) { r.flash -= dt; r.spin.scale.setScalar(1 + r.flash * 0.4); } }
    world.padTex.offset.y -= dt * 2.2;
    return event;
  }
  return { update };
}
