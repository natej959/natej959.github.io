/* ===== WORLD: canyon mesh, props, sky ===== */
const HALF_ROAD = 11;       // drivable asphalt-ish width / 2
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

function buildWorld(THREE, scene, T) {
  const { N, DS, px, py, pz, stx, stz, kappa, sep } = T;
  const col = (hex) => new THREE.Color(hex);

  // ---- per-sample outward extent scale (avoid folding / overlapping terrain) ----
  const OUTER_MAX = 150, RIM = 28;
  const scL = new Float32Array(N), scR = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const sc0 = Math.min(1, (0.42 * sep[i] - RIM) / (OUTER_MAX - RIM));
    const k = kappa[i];
    const inv = Math.abs(k) > 1e-5 ? 0.78 / Math.abs(k) : 1e9;
    const scK = Math.min(1, Math.max(0.04, (inv - RIM) / (OUTER_MAX - RIM)));
    // k>0 = turning left -> left side is the inner side
    scL[i] = Math.max(0.04, Math.min(sc0, k > 0 ? scK : 1));
    scR[i] = Math.max(0.04, Math.min(sc0, k < 0 ? scK : 1));
  }
  function minBlur(a) {
    const o = new Float32Array(N), W = 8;
    for (let i = 0; i < N; i++) { let m = 1; for (let d = -W; d <= W; d++) m = Math.min(m, a[(i + d + N) % N]); o[i] = m; }
    const o2 = new Float32Array(N);
    for (let i = 0; i < N; i++) { let s = 0; for (let d = -W; d <= W; d++) s += o[(i + d + N) % N]; o2[i] = s / (2 * W + 1); }
    return o2;
  }
  const sL = minBlur(scL), sR = minBlur(scR);

  let plainY = 1e9; for (let i = 0; i < N; i++) plainY = Math.min(plainY, py[i]);
  plainY -= 7;

  // ---- cross-section rows (lat, relHeight, plainBlend, kind) ----
  // kind: 0 = floor, 1 = wall, 2 = plateau/outer
  const rows = [
    [17.2, 0.0, 0, 0],
    [18.0, 6.0, 0, 1],
    [19.4, 11.5, 0, 1],
    [20.0, 18.0, 0, 1],
    [21.8, 24.0, 0, 1],
    [22.4, 32.0, 0, 1],
    [25.5, 37.0, 0, 1],
    [RIM, 39.0, 0, 2],
    [46, 41.0, 0.0, 2],
    [74, 34.0, 0.18, 2],
    [105, 24.0, 0.55, 2],
    [OUTER_MAX, 0, 1.0, 2],
  ];
  const strata = [0xb85a32, 0xa44c2b, 0xc86d3d, 0xd7925a, 0x934127, 0xc0612f].map(col);
  const sandA = col(0xcaa066), sandB = col(0xc29760), plateau = col(0xd9a96d), plateau2 = col(0xcf9d62);
  const slopeCol = col(0xc99158), slopeCol2 = col(0xd2a06a);
  const roadA = col(0x6b584c), roadB = col(0x776356), edgeO = col(0xe2762f), edgeW = col(0xe9e1cf);
  const dash = col(0xcfc4ae), gridK = col(0x1b1b1f), gridW = col(0xeeeeee);

  function sampleRows(i, side) { // returns [{x,y,z,kind}] for rows on one side
    const j = (i + N) % N;
    const sx = px[j], sy = py[j], sz = pz[j];
    const nx = stz[j] * side, nz = -stx[j] * side; // left normal * side
    const sc = side > 0 ? sL[j] : sR[j];
    const out = [];
    for (let r = 0; r < rows.length; r++) {
      let [lat, h, tb, kind] = rows[r];
      let jl = 0, jh = 0;
      if (kind === 1) { jl = vnoise(j * 0.55, r * 7 + (side > 0 ? 0 : 91)) * 0.55; jh = vnoise(j * 0.4, r * 13 + (side > 0 ? 3 : 57)) * 1.4; }
      if (kind === 2 && r > 7) { jh = vnoise(j * 0.08, r * 11 + (side > 0 ? 5 : 71)) * 5; }
      if (lat > RIM) lat = RIM + (lat - RIM) * sc;
      lat += jl;
      let y = sy + h + jh;
      if (tb > 0) y = y * (1 - tb) + plainY * tb;
      out.push({ x: sx + nx * lat, y, z: sz + nz * lat, kind, r });
    }
    return out;
  }

  // ---- chunked geometry (frustum culling) ----
  const CH = 30; // samples per chunk
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const chunks = [];
  let pos, colr, nrm, count;
  function beginChunk() { pos = []; colr = []; nrm = []; count = 0; }
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3();
  function tri(A, B, C, color, flip) {
    if (flip) { const t = B; B = C; C = t; }
    _a.set(B[0] - A[0], B[1] - A[1], B[2] - A[2]); _b.set(C[0] - A[0], C[1] - A[1], C[2] - A[2]);
    _n.crossVectors(_a, _b).normalize();
    for (const P of [A, B, C]) { pos.push(P[0], P[1], P[2]); nrm.push(_n.x, _n.y, _n.z); colr.push(color.r, color.g, color.b); }
    count += 3;
  }
  // quad corners in order around; we orient so the normal points up/inward by test vs `up` hint
  function quad(P0, P1, P2, P3, color, hint) {
    // P0,P1 along row k at sample i,i+1 ; P3,P2 along row k+1
    _a.set(P1[0] - P0[0], P1[1] - P0[1], P1[2] - P0[2]); _b.set(P3[0] - P0[0], P3[1] - P0[1], P3[2] - P0[2]);
    _n.crossVectors(_a, _b);
    const flip = (_n.x * hint[0] + _n.y * hint[1] + _n.z * hint[2]) < 0;
    tri(P0, P1, P2, color, flip); tri(P0, P2, P3, color, flip);
  }
  function endChunk() {
    if (!count) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    scene.add(m); chunks.push(m);
  }
  const UP = [0, 1, 0];

  for (let c0 = 0; c0 < N; c0 += CH) {
    beginChunk();
    for (let i = c0; i < Math.min(N, c0 + CH); i++) {
      const j = (i + 1) % N;
      const rowsLi = sampleRows(i, 1), rowsLj = sampleRows(j, 1);
      const rowsRi = sampleRows(i, -1), rowsRj = sampleRows(j, -1);
      const P = (idx, lat) => {
        const k = (idx + N) % N, nx = stz[k], nz = -stx[k];
        return [px[k] + nx * lat, py[k], pz[k] + nz * lat];
      };
      // --- road surface (columns) ---
      const band = (i >> 1) & 1;
      const rcol = band ? roadA : roadB;
      const isGrid = (i === 0 || i === 1);
      if (isGrid) {
        const cols = 14, w = HALF_ROAD * 2 / cols;
        for (let q = 0; q < cols; q++) {
          const l0 = -HALF_ROAD + q * w, l1 = l0 + w;
          quad(P(i, l0), P(j, l0), P(j, l1), P(i, l1), ((q + i) & 1) ? gridK : gridW, UP);
        }
      } else {
        // road left/right of centre line, centre dashes, edge stripes
        const dashOn = ((Math.floor(i / 3)) & 1) === 0;
        quad(P(i, 0.25), P(j, 0.25), P(j, 9.6), P(i, 9.6), rcol, UP);
        quad(P(i, -9.6), P(j, -9.6), P(j, -0.25), P(i, -0.25), rcol, UP);
        quad(P(i, -0.25), P(j, -0.25), P(j, 0.25), P(i, 0.25), dashOn ? dash : rcol, UP);
        const ec = ((i >> 1) & 1) ? edgeO : edgeW;
        quad(P(i, 9.6), P(j, 9.6), P(j, HALF_ROAD), P(i, HALF_ROAD), ec, UP);
        quad(P(i, -HALF_ROAD), P(j, -HALF_ROAD), P(j, -9.6), P(i, -9.6), ec, UP);
      }
      // shoulders
      const sc = ((i >> 2) & 1) ? sandA : sandB;
      quad(P(i, HALF_ROAD), P(j, HALF_ROAD), P(j, HALF_FLOOR), P(i, HALF_FLOOR), sc, UP);
      quad(P(i, -HALF_FLOOR), P(j, -HALF_FLOOR), P(j, -HALF_ROAD), P(i, -HALF_ROAD), sc, UP);

      // walls + plateau, both sides
      for (const side of [1, -1]) {
        const A = side > 0 ? rowsLi : rowsRi, B = side > 0 ? rowsLj : rowsRj;
        for (let r = 0; r < rows.length - 1; r++) {
          const a0 = A[r], b0 = B[r], b1 = B[r + 1], a1 = A[r + 1];
          const kind = rows[r + 1][3];
          let color;
          if (kind === 1) {
            const sIdx = Math.floor((r * 3 + (i >> 3) * 1) + hash2(i >> 1, r) * 2.2) % strata.length;
            const base = strata[(sIdx + strata.length) % strata.length];
            const v = 0.9 + hash2(i, r + 40) * 0.2;
            color = base.clone().multiplyScalar(v);
          } else if (r + 1 === 7) {
            color = (hash2(i, r) > 0.5 ? plateau : plateau2);
          } else if (r < 9) {
            color = (hash2(i >> 1, r) > 0.5 ? plateau : plateau2).clone().multiplyScalar(0.97 + hash2(i, r) * 0.06);
          } else {
            color = (hash2(i >> 1, r) > 0.5 ? slopeCol : slopeCol2);
          }
          const hx = side > 0 ? -stz[i] : stz[i], hz = side > 0 ? stx[i] : -stx[i]; // inward hint (towards track)
          const hint = (kind === 1) ? [hx, 0.35, hz] : UP;
          quad([a0.x, a0.y, a0.z], [b0.x, b0.y, b0.z], [b1.x, b1.y, b1.z], [a1.x, a1.y, a1.z], color, hint);
        }
      }
    }
    endChunk();
  }

  // ---- base plain ----
  const plainGeo = new THREE.PlaneGeometry(30000, 30000);
  plainGeo.rotateX(-Math.PI / 2);
  const plain = new THREE.Mesh(plainGeo, new THREE.MeshLambertMaterial({ color: 0xd8b07a }));
  plain.position.y = plainY - 0.2;
  scene.add(plain);

  // ---- distant mesas ----
  const mesaMat = new THREE.MeshLambertMaterial({ color: 0xb4623a, flatShading: true });
  const mesaMat2 = new THREE.MeshLambertMaterial({ color: 0xc27a47, flatShading: true });
  for (let k = 0; k < 46; k++) {
    const a = hash2(k, 1) * Math.PI * 2, d = 2300 + hash2(k, 2) * 1900;
    const h = 90 + hash2(k, 3) * 260, r0 = 70 + hash2(k, 4) * 190;
    const g = new THREE.CylinderGeometry(r0 * (0.55 + hash2(k, 5) * 0.2), r0, h, 6 + Math.floor(hash2(k, 6) * 3), 2);
    const m = new THREE.Mesh(g, hash2(k, 7) > 0.5 ? mesaMat : mesaMat2);
    m.position.set(Math.cos(a) * d * 1.3, plainY + h * 0.5 - 4, Math.sin(a) * d);
    m.rotation.y = hash2(k, 8) * 6;
    scene.add(m);
  }

  // ---- scree rocks (instanced) ----
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const rockCount = 700;
  const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshLambertMaterial({ flatShading: true }), rockCount);
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V3 = new THREE.Vector3(), S3 = new THREE.Vector3();
  const rockCols = [0x8f4a2d, 0xa5603a, 0x7b4430, 0xb8794a].map(col);
  for (let k = 0; k < rockCount; k++) {
    const i = Math.floor(hash2(k, 21) * N), side = hash2(k, 22) > 0.5 ? 1 : -1;
    const lat = 16.6 + hash2(k, 23) * 2.4, sz = 0.5 + Math.pow(hash2(k, 24), 2.2) * 2.6;
    const nx = stz[i] * side, nz = -stx[i] * side;
    V3.set(px[i] + nx * lat, py[i] + sz * 0.35, pz[i] + nz * lat);
    E.set(hash2(k, 25) * 3, hash2(k, 26) * 6, hash2(k, 27) * 3); Q.setFromEuler(E);
    S3.set(sz * (0.9 + hash2(k, 28) * 0.6), sz * (0.7 + hash2(k, 29) * 0.5), sz * (0.9 + hash2(k, 30) * 0.6));
    M4.compose(V3, Q, S3); rocks.setMatrixAt(k, M4);
    rocks.setColorAt(k, rockCols[Math.floor(hash2(k, 31) * rockCols.length)]);
  }
  scene.add(rocks);

  // ---- beacon posts (speed reference) ----
  const postN = Math.floor(N / 20);
  const postGeo = new THREE.BoxGeometry(0.5, 4.5, 0.5);
  const postMat = new THREE.MeshLambertMaterial({ color: 0x3a3f4a, flatShading: true });
  const posts = new THREE.InstancedMesh(postGeo, postMat, postN * 2);
  const tipGeo = new THREE.BoxGeometry(0.62, 0.7, 0.62);
  const tips = new THREE.InstancedMesh(tipGeo, new THREE.MeshBasicMaterial({ color: 0x5fe8ff }), postN * 2);
  for (let k = 0; k < postN; k++) {
    const i = (k * 20 + 7) % N;
    for (let s = 0; s < 2; s++) {
      const side = s ? -1 : 1, lat = 14.2;
      const nx = stz[i] * side, nz = -stx[i] * side;
      V3.set(px[i] + nx * lat, py[i] + 2.25, pz[i] + nz * lat);
      Q.setFromEuler(E.set(0, Math.atan2(stx[i], stz[i]), 0)); S3.set(1, 1, 1);
      M4.compose(V3, Q, S3); posts.setMatrixAt(k * 2 + s, M4);
      V3.y += 2.6; M4.compose(V3, Q, S3); tips.setMatrixAt(k * 2 + s, M4);
    }
  }
  scene.add(posts, tips);

  // ---- chevron boards on sharp bends ----
  const cc = document.createElement('canvas'); cc.width = 128; cc.height = 128;
  const cx = cc.getContext('2d');
  cx.fillStyle = '#16181d'; cx.fillRect(0, 0, 128, 128);
  cx.fillStyle = '#ffb02e';
  cx.strokeStyle = '#ffb02e'; cx.lineWidth = 16; cx.lineJoin = 'miter';
  for (const oy of [-26, 8, 42]) { cx.beginPath(); cx.moveTo(34, 28 + oy); cx.lineTo(88, 62 + oy); cx.lineTo(34, 96 + oy); cx.stroke(); }
  const chevTex = new THREE.CanvasTexture(cc); chevTex.colorSpace = THREE.SRGBColorSpace;
  const chevList = [];
  for (let i = 0; i < N; i += 3) {
    const k = kappa[i];
    if (Math.abs(k) > 1 / 115) chevList.push([i, k > 0 ? -1 : 1, k > 0 ? 1 : -1]); // outside of bend
  }
  const chev = new THREE.InstancedMesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshBasicMaterial({ map: chevTex, side: THREE.DoubleSide }), Math.max(1, chevList.length));
  chevList.forEach(([i, side, dir], n) => {
    const lat = 16.9;
    const nx = stz[i] * side, nz = -stx[i] * side;
    V3.set(px[i] + nx * lat, py[i] + 2.4, pz[i] + nz * lat);
    // face towards the track centre
    const yaw = Math.atan2(-nx, -nz);
    Q.setFromEuler(E.set(0, yaw, 0));
    S3.set(dir * side > 0 ? 1 : -1, 1, 1);
    M4.compose(V3, Q, S3); chev.setMatrixAt(n, M4);
  });
  chev.count = chevList.length;
  scene.add(chev);

  // ---- start / finish gantry ----
  const g = new THREE.Group();
  const slate = new THREE.MeshLambertMaterial({ color: 0x353b46, flatShading: true });
  const bone = new THREE.MeshLambertMaterial({ color: 0xd9d4c6, flatShading: true });
  const orange = new THREE.MeshLambertMaterial({ color: 0xe2762f, flatShading: true });
  const glow = new THREE.MeshBasicMaterial({ color: 0x63ecff });
  const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); g.add(o); return o; };
  for (const sx of [-14.2, 14.2]) {
    add(new THREE.BoxGeometry(1.8, 11, 1.8), slate, sx, 5.5, 0);
    add(new THREE.BoxGeometry(2.0, 1.4, 2.0), orange, sx, 1.0, 0);
    add(new THREE.BoxGeometry(0.4, 9, 0.4), glow, sx * 0.93 + (sx > 0 ? 0.3 : -0.3), 5.5, 1.0);
  }
  add(new THREE.BoxGeometry(31, 1.6, 2.4), slate, 0, 10.8, 0);
  add(new THREE.BoxGeometry(31, 0.35, 0.5), glow, 0, 9.85, 0.6);
  const bc = document.createElement('canvas'); bc.width = 1024; bc.height = 128;
  const bx = bc.getContext('2d');
  bx.fillStyle = '#14161b'; bx.fillRect(0, 0, 1024, 128);
  for (let q = 0; q < 32; q++) for (let r = 0; r < 4; r++) { bx.fillStyle = ((q + r) & 1) ? '#f2f2f2' : '#14161b'; bx.fillRect(q * 32, r * 8, 32, 8); for (let r2 = 0; r2 < 4; r2++) { bx.fillRect(q * 32, 96 + r2 * 8, 32, 8); } }
  bx.fillStyle = '#e2762f'; bx.font = 'bold 56px Arial Black, Arial, sans-serif'; bx.textAlign = 'center'; bx.textBaseline = 'middle';
  bx.fillText('START  /  FINISH', 512, 64);
  const bt = new THREE.CanvasTexture(bc); bt.colorSpace = THREE.SRGBColorSpace;
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(30, 3.75), new THREE.MeshBasicMaterial({ map: bt }));
  banner.position.set(0, 10.8, 1.25); g.add(banner);
  const banner2 = banner.clone(); banner2.position.z = -1.25; banner2.rotation.y = Math.PI; g.add(banner2);
  // orient so the gantry's local +z follows track direction; its x runs left-right
  const h0 = Math.atan2(stx[0], stz[0]);
  g.position.set(px[0], py[0], pz[0]); g.rotation.y = h0;
  g.updateMatrixWorld(true);
  scene.add(g);

  return { plainY, chunks };
}

/* ===== SKY ===== */
function buildSky(THREE, scene) {
  const geo = new THREE.SphereGeometry(5000, 20, 12);
  const colors = [], p = geo.attributes.position;
  const top = new THREE.Color(0x2f67ad), mid = new THREE.Color(0x8fb8d8), hor = new THREE.Color(0xf0c58f), below = new THREE.Color(0xe3b985);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 5000;
    if (y > 0.25) c.copy(mid).lerp(top, Math.min(1, (y - 0.25) / 0.6));
    else if (y > 0) c.copy(hor).lerp(mid, y / 0.25);
    else c.copy(hor).lerp(below, Math.min(1, -y * 4));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10;
  scene.add(sky);

  const grp = new THREE.Group();
  // big pale moon + a smaller one, low-poly
  const moon = new THREE.Mesh(new THREE.IcosahedronGeometry(260, 1), new THREE.MeshBasicMaterial({ color: 0xe6e1d6, fog: false }));
  moon.position.set(-2400, 1500, -3500);
  const moon2 = new THREE.Mesh(new THREE.IcosahedronGeometry(90, 1), new THREE.MeshBasicMaterial({ color: 0xd9b8a0, fog: false }));
  moon2.position.set(1800, 1700, -3800);
  const ring = new THREE.Mesh(new THREE.RingGeometry(330, 470, 40), new THREE.MeshBasicMaterial({ color: 0xcfc7b4, fog: false, side: THREE.DoubleSide, transparent: true, opacity: 0.55 }));
  ring.position.copy(moon.position); ring.rotation.set(1.2, 0.25, 0.4);
  const sun = new THREE.Mesh(new THREE.CircleGeometry(150, 14), new THREE.MeshBasicMaterial({ color: 0xfff4d6, fog: false }));
  const sdir = new THREE.Vector3(0.55, 0.42, 0.72).normalize();
  sun.position.copy(sdir).multiplyScalar(4600); sun.lookAt(0, 0, 0);
  grp.add(moon, moon2, ring, sun);
  scene.add(grp);
  return { sky, grp, sunDir: sdir };
}
