/* ===== WORLD: night canyon, neon track, static set pieces ===== */
const HALF_ROAD = 11;       // drivable road width / 2
const HALF_FLOOR = 17.2;    // where the canyon wall starts
const CAR_LIMIT = 15.9;     // car centre can't go past this (wall collision)

function hash2(a, b) {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, k) {   // smooth 1D value noise, ~[-1,1]
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return (hash2(i, k) * (1 - u) + hash2(i + 1, k) * u) * 2 - 1;
}
function canvasTex(THREE, w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function buildWorld(THREE, scene, T) {
  const { N, DS, px, py, pz, stx, stz, kappa, sep, gap, tunnel, pads, rings, chasm } = T;
  const col = (hex) => new THREE.Color(hex);
  const W = (i) => ((i % N) + N) % N;
  const inTunnel = (i) => W(i - tunnel[0]) <= W(tunnel[1] - tunnel[0]);

  // ---- per-sample outward extent scale (avoid folding / overlapping terrain) ----
  const OUTER_MAX = 150, RIM = 28;
  const scL = new Float32Array(N), scR = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const sc0 = Math.min(1, (0.42 * sep[i] - RIM) / (OUTER_MAX - RIM));
    const k = kappa[i];
    const inv = Math.abs(k) > 1e-5 ? 0.78 / Math.abs(k) : 1e9;
    const scK = Math.min(1, Math.max(0.04, (inv - RIM) / (OUTER_MAX - RIM)));
    scL[i] = Math.max(0.04, Math.min(sc0, k > 0 ? scK : 1));
    scR[i] = Math.max(0.04, Math.min(sc0, k < 0 ? scK : 1));
  }
  function minBlur(a) {
    const o = new Float32Array(N), R = 8;
    for (let i = 0; i < N; i++) { let m = 1; for (let d = -R; d <= R; d++) m = Math.min(m, a[W(i + d)]); o[i] = m; }
    const o2 = new Float32Array(N);
    for (let i = 0; i < N; i++) { let s = 0; for (let d = -R; d <= R; d++) s += o[W(i + d)]; o2[i] = s / (2 * R + 1); }
    return o2;
  }
  const sL = minBlur(scL), sR = minBlur(scR);

  let plainY = 1e9; for (let i = 0; i < N; i++) plainY = Math.min(plainY, py[i]);
  plainY -= 7;

  // cross-section rows (lat, relHeight, plainBlend, kind) - kind 1 = wall, 2 = plateau/outer
  const rows = [
    [17.2, 0.0, 0, 0], [18.0, 6.0, 0, 1], [19.4, 11.5, 0, 1], [20.0, 18.0, 0, 1], [21.8, 24.0, 0, 1],
    [22.4, 32.0, 0, 1], [25.5, 37.0, 0, 1], [RIM, 39.0, 0, 2], [46, 41.0, 0.0, 2], [74, 34.0, 0.18, 2],
    [105, 24.0, 0.55, 2], [OUTER_MAX, 0, 1.0, 2],
  ];
  // dusk / night palette: deep violet rock with warm strata
  const strata = [0x5a2a3e, 0x6e3242, 0x4a2238, 0x7c3c48, 0x3e1d33, 0x8a4650].map(col);
  const plateau = col(0x3a2436), plateau2 = col(0x33203a), slopeCol = col(0x2c1c34), slopeCol2 = col(0x34203a);
  const sandA = col(0x4a3040), sandB = col(0x42293a);
  const roadA = col(0x26232e), roadB = col(0x2d2936);
  const gridK = col(0x111116), gridW = col(0xd8d8e8);

  function sampleRows(i, side) {
    const j = W(i);
    const sx = px[j], sy = py[j], sz = pz[j];
    const nx = stz[j] * side, nz = -stx[j] * side;
    const sc = side > 0 ? sL[j] : sR[j];
    const out = [];
    for (let r = 0; r < rows.length; r++) {
      let [lat, h, tb, kind] = rows[r];
      let jl = 0, jh = 0;
      if (kind === 1) { jl = vnoise(j * 0.55, r * 7 + (side > 0 ? 0 : 91)) * 0.55; jh = vnoise(j * 0.4, r * 13 + (side > 0 ? 3 : 57)) * 1.4; }
      if (kind === 2 && r > 7) jh = vnoise(j * 0.08, r * 11 + (side > 0 ? 5 : 71)) * 5;
      if (lat > RIM) lat = RIM + (lat - RIM) * sc;
      lat += jl;
      let y = sy + h + jh;
      if (tb > 0) y = y * (1 - tb) + plainY * tb;
      out.push({ x: sx + nx * lat, y, z: sz + nz * lat });
    }
    return out;
  }

  // ---- geometry builders ----
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3();
  function makeBuf() { return { pos: [], nrm: [], col: [], count: 0 }; }
  function tri(B, A, Bv, C, color, flip) {
    if (flip) { const t = Bv; Bv = C; C = t; }
    _a.set(Bv[0] - A[0], Bv[1] - A[1], Bv[2] - A[2]); _b.set(C[0] - A[0], C[1] - A[1], C[2] - A[2]);
    _n.crossVectors(_a, _b).normalize();
    for (const P of [A, Bv, C]) { B.pos.push(P[0], P[1], P[2]); B.nrm.push(_n.x, _n.y, _n.z); B.col.push(color.r, color.g, color.b); }
    B.count += 3;
  }
  function quad(B, P0, P1, P2, P3, color, hint) {
    _a.set(P1[0] - P0[0], P1[1] - P0[1], P1[2] - P0[2]); _b.set(P3[0] - P0[0], P3[1] - P0[1], P3[2] - P0[2]);
    _n.crossVectors(_a, _b);
    const flip = (_n.x * hint[0] + _n.y * hint[1] + _n.z * hint[2]) < 0;
    tri(B, P0, P1, P2, color, flip); tri(B, P0, P2, P3, color, flip);
  }
  function toMesh(B, mat) {
    if (!B.count) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(B.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(B.col, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); scene.add(m); return m;
  }
  const UP = [0, 1, 0], DOWN = [0, -1, 0];
  const P = (idx, lat, dy) => { const k = W(idx); return [px[k] + stz[k] * lat, py[k] + (dy || 0), pz[k] - stx[k] * lat]; };

  const rockMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
  const haloMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });

  const CYAN = col(0x35f0ff), MAG = col(0xff2fb4), AMBER = col(0xffa21f);
  const haloC = CYAN.clone().multiplyScalar(0.35), haloM = MAG.clone().multiplyScalar(0.35);
  const dashC = col(0x3c3a8a);
  const CH = 30;
  for (let c0 = 0; c0 < N; c0 += CH) {
    const B = makeBuf(), G = makeBuf(), H = makeBuf();
    for (let i = c0; i < Math.min(N, c0 + CH); i++) {
      const j = W(i + 1);
      const rowsLi = sampleRows(i, 1), rowsLj = sampleRows(j, 1), rowsRi = sampleRows(i, -1), rowsRj = sampleRows(j, -1);
      if (!gap[i]) {
        // road
        const rcol = ((i >> 1) & 1) ? roadA : roadB;
        if (i === 0 || i === 1) {
          const cols = 14, w = HALF_ROAD * 2 / cols;
          for (let q = 0; q < cols; q++) { const l0 = -HALF_ROAD + q * w, l1 = l0 + w; quad(B, P(i, l0), P(j, l0), P(j, l1), P(i, l1), ((q + i) & 1) ? gridK : gridW, UP); }
        } else {
          quad(B, P(i, -HALF_ROAD), P(j, -HALF_ROAD), P(j, HALF_ROAD), P(i, HALF_ROAD), rcol, UP);
          // neon edges (left cyan, right magenta) + soft halos
          quad(G, P(i, 10.55, 0.03), P(j, 10.55, 0.03), P(j, 10.95, 0.03), P(i, 10.95, 0.03), CYAN, UP);
          quad(G, P(i, -10.95, 0.03), P(j, -10.95, 0.03), P(j, -10.55, 0.03), P(i, -10.55, 0.03), MAG, UP);
          quad(H, P(i, 9.2, 0.02), P(j, 9.2, 0.02), P(j, 12.4, 0.02), P(i, 12.4, 0.02), haloC, UP);
          quad(H, P(i, -12.4, 0.02), P(j, -12.4, 0.02), P(j, -9.2, 0.02), P(i, -9.2, 0.02), haloM, UP);
          if (((i / 3) | 0) % 2 === 0) quad(G, P(i, -0.14, 0.025), P(j, -0.14, 0.025), P(j, 0.14, 0.025), P(i, 0.14, 0.025), dashC, UP);
        }
        const sc = ((i >> 2) & 1) ? sandA : sandB;
        quad(B, P(i, HALF_ROAD), P(j, HALF_ROAD), P(j, HALF_FLOOR), P(i, HALF_FLOOR), sc, UP);
        quad(B, P(i, -HALF_FLOOR), P(j, -HALF_FLOOR), P(j, -HALF_ROAD), P(i, -HALF_ROAD), sc, UP);
      } else {
        // chasm side walls drop into the abyss
        for (const side of [1, -1]) {
          const l = HALF_FLOOR * side, hx = -stz[i] * side, hz = stx[i] * side;
          quad(B, P(i, l), P(j, l), P(j, l, -160), P(i, l, -160), strata[(i + (side > 0 ? 0 : 3)) % strata.length], [hx, 0, hz]);
        }
      }
      if (gap[i] && !gap[W(i - 1)]) { // front face of chasm (under the lip)
        quad(B, P(i, -HALF_FLOOR), P(i, HALF_FLOOR), P(i, HALF_FLOOR, -160), P(i, -HALF_FLOOR, -160), strata[2], [stx[i], 0, stz[i]]);
      }
      if (gap[i] && !gap[j]) { // back face (landing side)
        quad(B, P(j, -HALF_FLOOR), P(j, HALF_FLOOR), P(j, HALF_FLOOR, -160), P(j, -HALF_FLOOR, -160), strata[4], [-stx[i], 0, -stz[i]]);
      }
      // tunnel roof
      if (inTunnel(i) && inTunnel(j)) quad(B, P(i, -20, 16.5), P(j, -20, 16.5), P(j, 20, 16.5), P(i, 20, 16.5), col(0x1c1724), DOWN);

      // walls + plateau
      for (const side of [1, -1]) {
        const A = side > 0 ? rowsLi : rowsRi, Bq = side > 0 ? rowsLj : rowsRj;
        for (let r = 0; r < rows.length - 1; r++) {
          const a0 = A[r], b0 = Bq[r], b1 = Bq[r + 1], a1 = A[r + 1];
          const kind = rows[r + 1][3];
          let color;
          if (kind === 1) {
            const sIdx = Math.floor((r * 3 + (i >> 3)) + hash2(i >> 1, r) * 2.2) % strata.length;
            color = strata[sIdx].clone().multiplyScalar(0.85 + hash2(i, r + 40) * 0.3);
          } else if (r < 9) color = (hash2(i >> 1, r) > 0.5 ? plateau : plateau2);
          else color = (hash2(i >> 1, r) > 0.5 ? slopeCol : slopeCol2);
          const hx = side > 0 ? -stz[i] : stz[i], hz = side > 0 ? stx[i] : -stx[i];
          quad(B, [a0.x, a0.y, a0.z], [b0.x, b0.y, b0.z], [b1.x, b1.y, b1.z], [a1.x, a1.y, a1.z], color, kind === 1 ? [hx, 0.35, hz] : UP);
        }
        // glowing strata seam halfway up the wall
        if (!inTunnel(i) && hash2(i >> 4, side + 9) > 0.35) {
          const a = A[3], b = Bq[3];
          const lc = hash2(i >> 4, side) > 0.5 ? AMBER : MAG;
          const hx = side > 0 ? -stz[i] : stz[i], hz = side > 0 ? stx[i] : -stx[i];
          quad(G, [a.x + hx * 0.15, a.y, a.z + hz * 0.15], [b.x + hx * 0.15, b.y, b.z + hz * 0.15], [b.x + hx * 0.15, b.y + 0.35, b.z + hz * 0.15], [a.x + hx * 0.15, a.y + 0.35, a.z + hz * 0.15], lc, [hx, 0, hz]);
        }
      }
    }
    toMesh(B, rockMat); toMesh(G, glowMat); toMesh(H, haloMat);
  }

  // ---- base plain + abyss glow ----
  const plainGeo = new THREE.PlaneGeometry(30000, 30000); plainGeo.rotateX(-Math.PI / 2);
  const plain = new THREE.Mesh(plainGeo, new THREE.MeshLambertMaterial({ color: 0x2a1a30 }));
  plain.position.y = plainY - 0.2; scene.add(plain);
  {
    const c = chasm.lip, h = Math.atan2(stx[c], stz[c]);
    const mid = P(c + 4.5, 0);
    const abyss = new THREE.Mesh(new THREE.PlaneGeometry(40, 46), new THREE.MeshBasicMaterial({ color: 0xff3a8a }));
    abyss.rotation.set(-Math.PI / 2, 0, -h, 'YXZ'); abyss.rotation.set(-Math.PI / 2, h, 0); abyss.rotation.order = 'YXZ';
    abyss.position.set(mid[0], py[c] - 150, mid[2]); scene.add(abyss);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(30, 150, 30), new THREE.MeshBasicMaterial({ color: 0xff2a7a, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
    shaft.position.set(mid[0], py[c] - 80, mid[2]); shaft.rotation.y = h; scene.add(shaft);
  }

  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V3 = new THREE.Vector3(), S3 = new THREE.Vector3();

  // ---- scree rocks ----
  const rockCount = 600;
  const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ flatShading: true }), rockCount);
  const rockCols = [0x4a2534, 0x5c2e3c, 0x3a1d2c, 0x6a3644].map(col);
  let rc = 0;
  for (let k = 0; k < rockCount * 2 && rc < rockCount; k++) {
    const i = Math.floor(hash2(k, 21) * N); if (gap[i] || gap[W(i + 1)]) continue;
    const side = hash2(k, 22) > 0.5 ? 1 : -1, lat = 16.6 + hash2(k, 23) * 2.4, sz = 0.5 + Math.pow(hash2(k, 24), 2.2) * 2.6;
    V3.set(px[i] + stz[i] * side * lat, py[i] + sz * 0.35, pz[i] - stx[i] * side * lat);
    Q.setFromEuler(E.set(hash2(k, 25) * 3, hash2(k, 26) * 6, hash2(k, 27) * 3));
    S3.set(sz * (0.9 + hash2(k, 28) * 0.6), sz * (0.7 + hash2(k, 29) * 0.5), sz * (0.9 + hash2(k, 30) * 0.6));
    M4.compose(V3, Q, S3); rocks.setMatrixAt(rc, M4); rocks.setColorAt(rc, rockCols[Math.floor(hash2(k, 31) * rockCols.length)]); rc++;
  }
  rocks.count = rc; scene.add(rocks);

  // ---- chevron boards on sharp bends (glowing) ----
  const chevTex = canvasTex(THREE, 128, 128, (cx) => {
    cx.fillStyle = '#0d0b14'; cx.fillRect(0, 0, 128, 128);
    cx.strokeStyle = '#ffb02e'; cx.lineWidth = 16; cx.shadowColor = '#ff8a00'; cx.shadowBlur = 10;
    for (const oy of [-26, 8, 42]) { cx.beginPath(); cx.moveTo(34, 28 + oy); cx.lineTo(88, 62 + oy); cx.lineTo(34, 96 + oy); cx.stroke(); }
  });
  const chevList = [];
  for (let i = 0; i < N; i += 3) if (Math.abs(kappa[i]) > 1 / 115 && !gap[i]) chevList.push([i, kappa[i] > 0 ? -1 : 1, kappa[i] > 0 ? 1 : -1]);
  const chev = new THREE.InstancedMesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshBasicMaterial({ map: chevTex, side: THREE.DoubleSide }), Math.max(1, chevList.length));
  chevList.forEach(([i, side, dir], n) => {
    const nx = stz[i] * side, nz = -stx[i] * side;
    V3.set(px[i] + nx * 16.9, py[i] + 2.4, pz[i] + nz * 16.9);
    Q.setFromEuler(E.set(0, Math.atan2(-nx, -nz), 0)); S3.set(dir * side > 0 ? 1 : -1, 1, 1);
    M4.compose(V3, Q, S3); chev.setMatrixAt(n, M4);
  });
  chev.count = chevList.length; scene.add(chev);

  // ---- tunnel ribs ----
  {
    const ribs = []; for (let i = tunnel[0]; inTunnel(i) && ribs.length < 40; i += 3) ribs.push(W(i));
    const n = ribs.length;
    const pil = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 16.5, 1.4), new THREE.MeshLambertMaterial({ color: 0x2b2a36, flatShading: true }), n * 2);
    const beam = new THREE.InstancedMesh(new THREE.BoxGeometry(37, 1.4, 1.6), new THREE.MeshLambertMaterial({ color: 0x2b2a36, flatShading: true }), n);
    const strip = new THREE.InstancedMesh(new THREE.BoxGeometry(33, 0.25, 0.5), new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
    const vstrip = new THREE.InstancedMesh(new THREE.BoxGeometry(0.25, 14, 0.25), new THREE.MeshBasicMaterial({ color: 0xffffff }), n * 2);
    ribs.forEach((i, k) => {
      const h = Math.atan2(stx[i], stz[i]); Q.setFromEuler(E.set(0, h, 0)); S3.set(1, 1, 1);
      const c = k % 2 ? MAG : CYAN;
      for (const s of [0, 1]) {
        const p = P(i, s ? 16.6 : -16.6, 8.25); V3.set(p[0], p[1], p[2]); M4.compose(V3, Q, S3); pil.setMatrixAt(k * 2 + s, M4);
        const q = P(i, s ? 15.8 : -15.8, 7.5); V3.set(q[0], q[1], q[2]); M4.compose(V3, Q, S3); vstrip.setMatrixAt(k * 2 + s, M4); vstrip.setColorAt(k * 2 + s, c);
      }
      const b = P(i, 0, 15.8); V3.set(b[0], b[1], b[2]); M4.compose(V3, Q, S3); beam.setMatrixAt(k, M4);
      V3.y -= 0.8; M4.compose(V3, Q, S3); strip.setMatrixAt(k, M4); strip.setColorAt(k, c);
    });
    scene.add(pil, beam, strip, vstrip);
  }

  // ---- boost pads (one merged mesh, scrolling chevron texture) ----
  const padTex = canvasTex(THREE, 64, 128, (cx, w, h) => {
    cx.fillStyle = '#000'; cx.fillRect(0, 0, w, h);
    cx.strokeStyle = '#6ff6ff'; cx.lineWidth = 10; cx.shadowColor = '#00e1ff'; cx.shadowBlur = 8;
    for (const oy of [10, 74]) { cx.beginPath(); cx.moveTo(8, oy + 40); cx.lineTo(32, oy + 12); cx.lineTo(56, oy + 40); cx.stroke(); }
  });
  padTex.wrapS = padTex.wrapT = THREE.RepeatWrapping;
  {
    const pos = [], uv = [];
    for (const pd of pads) {
      const a = pd.i, b = W(pd.i + 3);
      const A0 = P(a, pd.lat - 4.2, 0.06), A1 = P(a, pd.lat + 4.2, 0.06), B0 = P(b, pd.lat - 4.2, 0.06), B1 = P(b, pd.lat + 4.2, 0.06);
      pos.push(...A0, ...B0, ...B1, ...A0, ...B1, ...A1);
      uv.push(0, 0, 0, 1.5, 1, 1.5, 0, 0, 1, 1.5, 1, 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: padTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    scene.add(m);
  }

  // ---- energy rings over the road ----
  const ringObjs = rings.map((i, k) => {
    const g = new THREE.Group();
    const h = Math.atan2(stx[i], stz[i]);
    g.position.set(px[i], py[i] + 9.5, pz[i]); g.rotation.y = h;
    const spin = new THREE.Group(); g.add(spin);
    const cA = k % 2 ? 0xff3fc0 : 0x3ff6ff;
    spin.add(new THREE.Mesh(new THREE.TorusGeometry(15.5, 0.8, 6, 28), new THREE.MeshBasicMaterial({ color: cA })));
    spin.add(new THREE.Mesh(new THREE.TorusGeometry(15.5, 2.6, 6, 28), new THREE.MeshBasicMaterial({ color: cA, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false })));
    const segMat = new THREE.MeshLambertMaterial({ color: 0x2a2833, flatShading: true });
    for (let s = 0; s < 6; s++) {
      const a = s / 6 * Math.PI * 2;
      const seg = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.2, 3.2), segMat);
      seg.position.set(Math.cos(a) * 15.5, Math.sin(a) * 15.5, 0); seg.rotation.z = a; spin.add(seg);
    }
    scene.add(g);
    return { g, spin, i, flash: 0 };
  });

  // ---- rim pylons with sky beams ----
  const pyl = [];
  for (let i = 30; i < N; i += 70) if (!gap[i]) for (const side of [1, -1]) if (hash2(i, side) > 0.3) pyl.push([i, side]);
  const pylon = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.2, 2.4, 26, 6), new THREE.MeshLambertMaterial({ color: 0x24222e, flatShading: true }), pyl.length);
  const beams = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.9, 0.9, 700, 6, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), pyl.length);
  const caps = new THREE.InstancedMesh(new THREE.OctahedronGeometry(2.4, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), pyl.length);
  pyl.forEach(([i, side], k) => {
    const rows0 = sampleRows(i, side), r = rows0[8];
    const c = hash2(i, 5) > 0.5 ? CYAN : MAG;
    Q.identity(); S3.set(1, 1, 1);
    V3.set(r.x, r.y + 13, r.z); M4.compose(V3, Q, S3); pylon.setMatrixAt(k, M4);
    V3.set(r.x, r.y + 27, r.z); M4.compose(V3, Q, S3); caps.setMatrixAt(k, M4); caps.setColorAt(k, c);
    V3.set(r.x, r.y + 377, r.z); M4.compose(V3, Q, S3); beams.setMatrixAt(k, M4); beams.setColorAt(k, c.clone().multiplyScalar(0.6));
  });
  scene.add(pylon, beams, caps);

  // ---- crashed capital ship inside the loop ----
  {
    let cx = 0, cz = 0; for (let i = 0; i < N; i++) { cx += px[i]; cz += pz[i]; } cx /= N; cz /= N;
    let minD = 1e9; for (let i = 0; i < N; i++) minD = Math.min(minD, Math.hypot(px[i] - cx, pz[i] - cz));
    const S = Math.min(1, (minD - 60) / 300);
    const ship = new THREE.Group();
    const hull = new THREE.MeshLambertMaterial({ color: 0x4a4858, flatShading: true });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2a2833, flatShading: true });
    const add = (geo, m, x, y, z, rx, ry, rz) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx || 0, ry || 0, rz || 0); ship.add(o); return o; };
    add(tbox(THREE, 200, 46, 0, 8, 14, 10, 560), hull, 0, 0, 0);             // dagger hull, nose +z
    add(tbox(THREE, 150, 30, 46, 10, 6, 22, 420), dark, 0, 0, -50);           // upper deck
    add(tbox(THREE, 70, 50, 76, 50, 40, 76, 90), hull, 0, 0, -200);           // tower base
    add(new THREE.BoxGeometry(120, 14, 30), dark, 0, 132, -210);              // bridge
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(8, 8, 360), dark, s * 70, 24, -30, 0, s * 0.18, 0);
    const winMat = new THREE.MeshBasicMaterial({ color: 0xffc879 });
    for (let k = 0; k < 40; k++) add(new THREE.BoxGeometry(6, 1.6, 1), winMat, (hash2(k, 1) - 0.5) * 120, 50 + hash2(k, 2) * 22, 70 - hash2(k, 3) * 300);
    const eng = new THREE.MeshBasicMaterial({ color: 0x7ff6ff });
    for (const [x, y] of [[-60, 20], [0, 26], [60, 20]]) add(new THREE.CylinderGeometry(16, 16, 4, 10), eng, x, y, -282, Math.PI / 2, 0, 0);
    ship.scale.setScalar(S);
    ship.rotation.set(0.22, 0.9, 0.12);
    ship.position.set(cx, plainY + 40 * S, cz);
    scene.add(ship);
  }

  // ---- start / finish gantry ----
  const g = new THREE.Group();
  const slate = new THREE.MeshLambertMaterial({ color: 0x2a2f3a, flatShading: true });
  const glowC = new THREE.MeshBasicMaterial({ color: 0x35f0ff }), glowM = new THREE.MeshBasicMaterial({ color: 0xff2fb4 });
  const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); g.add(o); return o; };
  for (const sx of [-14.2, 14.2]) {
    add(new THREE.BoxGeometry(1.8, 11, 1.8), slate, sx, 5.5, 0);
    add(new THREE.BoxGeometry(0.4, 10, 0.4), sx > 0 ? glowC : glowM, sx * 0.93 + (sx > 0 ? 0.3 : -0.3), 5.5, 1.0);
  }
  add(new THREE.BoxGeometry(31, 1.6, 2.4), slate, 0, 10.8, 0);
  add(new THREE.BoxGeometry(31, 0.35, 0.5), glowC, 0, 9.85, 0.6);
  const bt = canvasTex(THREE, 1024, 128, (bx) => {
    bx.fillStyle = '#0c0b12'; bx.fillRect(0, 0, 1024, 128);
    for (let q = 0; q < 32; q++) for (let r = 0; r < 4; r++) { bx.fillStyle = ((q + r) & 1) ? '#e8e8f8' : '#0c0b12'; bx.fillRect(q * 32, r * 8, 32, 8); bx.fillRect(q * 32, 96 + r * 8, 32, 8); }
    bx.fillStyle = '#35f0ff'; bx.shadowColor = '#35f0ff'; bx.shadowBlur = 14; bx.font = 'bold 56px Arial Black, Arial, sans-serif'; bx.textAlign = 'center'; bx.textBaseline = 'middle';
    bx.fillText('START  /  FINISH', 512, 64);
  });
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(30, 3.75), new THREE.MeshBasicMaterial({ map: bt }));
  banner.position.set(0, 10.8, 1.25); g.add(banner);
  const banner2 = banner.clone(); banner2.position.z = -1.25; banner2.rotation.y = Math.PI; g.add(banner2);
  g.position.set(px[0], py[0], pz[0]); g.rotation.y = Math.atan2(stx[0], stz[0]);
  scene.add(g);

  return { plainY, padTex, ringObjs, sampleRows };
}

/* ===== SKY: night, stars, ringed gas giant ===== */
function buildSky(THREE, scene) {
  const geo = new THREE.SphereGeometry(5000, 24, 14);
  const colors = [], p = geo.attributes.position;
  const top = new THREE.Color(0x05061a), mid = new THREE.Color(0x1e1446), hor = new THREE.Color(0x8a2c6a), below = new THREE.Color(0x24122e);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 5000;
    if (y > 0.2) c.copy(mid).lerp(top, Math.min(1, (y - 0.2) / 0.5));
    else if (y > 0) c.copy(hor).lerp(mid, y / 0.2);
    else c.copy(hor).lerp(below, Math.min(1, -y * 5));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10; scene.add(sky);

  const grp = new THREE.Group();
  // stars
  const sp = [];
  for (let k = 0; k < 1800; k++) {
    const u = hash2(k, 401), v = hash2(k, 402) * 0.95 + 0.05;
    const a = u * Math.PI * 2, y = v, r = Math.sqrt(1 - y * y);
    sp.push(Math.cos(a) * r * 4600, y * 4600, Math.sin(a) * r * 4600);
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  grp.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xdfe6ff, size: 2, sizeAttenuation: false, fog: false })));
  // banded gas giant
  const pg = new THREE.IcosahedronGeometry(820, 2), pc = [], pp = pg.attributes.position;
  const bands = [0xc0577a, 0xe08a6a, 0x9a3f6e, 0xf2b37a, 0x7a3060].map((h) => new THREE.Color(h));
  for (let i = 0; i < pp.count; i++) { const b = bands[Math.floor((pp.getY(i) / 820 + 1) * 4.6) % bands.length]; pc.push(b.r, b.g, b.b); }
  pg.setAttribute('color', new THREE.Float32BufferAttribute(pc, 3));
  const planet = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  planet.position.set(-1900, 1500, -3300);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1050, 1550, 48), new THREE.MeshBasicMaterial({ color: 0xffb8d8, fog: false, side: THREE.DoubleSide, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
  ring.position.copy(planet.position); ring.rotation.set(1.25, 0.3, 0.5);
  const moon = new THREE.Mesh(new THREE.IcosahedronGeometry(120, 1), new THREE.MeshBasicMaterial({ color: 0xbfd4ff, fog: false }));
  moon.position.set(2200, 1900, -3200);
  grp.add(planet, ring, moon);
  scene.add(grp);
  return { sky, grp, sunDir: new THREE.Vector3(2200, 1900, -3200).normalize() };
}
