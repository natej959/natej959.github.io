/* ===== TRACK DATA (pure math, no rendering) =====
   Builds a closed centreline from a polar profile, resamples it at even
   spacing, and precomputes everything the physics + mesh builder need. */
function buildTrackData(THREE) {
  const DS = 4;                 // sample spacing in metres
  const NCTRL = 44;

  // Radius profile: big sweepers + a few tight bends. Star-shaped about the
  // origin so the loop can never cross itself.
  function radius(th) {
    return 700
      + 170 * Math.sin(2 * th + 0.6)
      + 100 * Math.sin(3 * th + 2.1)
      + 60 * Math.sin(5 * th + 0.3)
      + 44 * Math.sin(7 * th + 1.1)
      + 22 * Math.sin(11 * th + 1.7);
  }
  function elev(th) {
    return 26 + 18 * Math.sin(th + 1.0) + 12 * Math.sin(2 * th + 0.2)
      + 8 * Math.sin(5 * th + 2.0) + 4 * Math.sin(9 * th + 0.5);
  }

  const ctrl = [];
  for (let k = 0; k < NCTRL; k++) {
    const th = (k / NCTRL) * Math.PI * 2;
    const r = radius(th);
    ctrl.push(new THREE.Vector3(Math.cos(th) * r * 1.25, elev(th), Math.sin(th) * r));
  }
  const curve = new THREE.CatmullRomCurve3(ctrl, true, 'centripetal');
  const total = curve.getLength();
  const N = Math.round(total / DS);
  const raw = curve.getSpacedPoints(N); // N+1, last == first
  raw.pop();

  const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
  for (let i = 0; i < N; i++) { px[i] = raw[i].x; py[i] = raw[i].y; pz[i] = raw[i].z; }

  // Per-segment tangents (xz), headings, normals; per-sample curvature
  const tx = new Float32Array(N), tz = new Float32Array(N);   // tangent at segment i (i -> i+1)
  const segLen = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const dx = px[j] - px[i], dz = pz[j] - pz[i];
    const l = Math.hypot(dx, dz);
    segLen[i] = l; tx[i] = dx / l; tz[i] = dz / l;
  }
  // sample tangent = avg of adjacent segments
  const stx = new Float32Array(N), stz = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i + N - 1) % N;
    let x = tx[a] + tx[i], z = tz[a] + tz[i]; const l = Math.hypot(x, z);
    stx[i] = x / l; stz[i] = z / l;
  }
  // signed curvature (+ = turning left, i.e. heading increasing)
  const kappa = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i + N - 2 + N) % N, b = (i + 2) % N;
    const h0 = Math.atan2(stx[a], stz[a]), h1 = Math.atan2(stx[b], stz[b]);
    let dh = h1 - h0; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    kappa[i] = dh / (4 * DS);
  }
  // Small jump crests, placed on the straightest stretch near each target so a launch
  // never lands in a hairpin.
  const bumps = [];
  for (const [f, A, w] of [[0.17, 3.3, 17], [0.46, 3.0, 16], [0.71, 3.4, 17], [0.90, 2.8, 16]]) {
    let bestI = Math.floor(f * N), bestK = 1e9;
    for (let c = Math.floor((f - 0.06) * N); c <= Math.floor((f + 0.06) * N); c++) {
      let mk = 0; for (let d = -20; d <= 28; d++) mk = Math.max(mk, Math.abs(kappa[((c + d) % N + N) % N]));
      if (mk < bestK) { bestK = mk; bestI = ((c % N) + N) % N; }
    }
    bumps.push([bestI * DS, A, w]);
  }
  for (const [c, A, w] of bumps) {
    for (let i = 0; i < N; i++) {
      let d = Math.abs(i * DS - c); d = Math.min(d, N * DS - d);
      if (d < w * 3) py[i] += A * Math.exp(-(d / w) * (d / w));
    }
  }
  const ys = new Float32Array(N);
  for (let it = 0; it < 2; it++) {
    for (let i = 0; i < N; i++) ys[i] = (py[(i + N - 1) % N] + 2 * py[i] + py[(i + 1) % N]) * 0.25;
    py.set(ys);
  }

  // slope along s (dy/ds), central difference
  const slope = new Float32Array(N);
  for (let i = 0; i < N; i++) slope[i] = (py[(i + 1) % N] - py[(i + N - 1) % N]) / (2 * DS);

  // Separation from non-adjacent track (used to keep outer terrain from overlapping)
  const sep = new Float32Array(N).fill(9999);
  const skip = Math.round(420 / DS);
  for (let i = 0; i < N; i++) {
    let best = 9999;
    for (let j = 0; j < N; j += 2) {
      let d = Math.abs(i - j); d = Math.min(d, N - d);
      if (d < skip) continue;
      const dd = Math.hypot(px[i] - px[j], pz[i] - pz[j]);
      if (dd < best) best = dd;
    }
    sep[i] = best;
  }

  return { DS, N, length: N * DS, px, py, pz, tx, tz, segLen, stx, stz, kappa, slope, sep };
}
