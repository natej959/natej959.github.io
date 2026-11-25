/* ===== BUGGY MODEL (all primitives, flat-shaded) =====
   Original design: "Dune Warden" light assault buggy. Armoured wedge hull,
   open two-seat tub, roll hoops, rear twin-ion pods, pintle cannon. */
function tbox(THREE, w0, h0, b0, w1, h1, b1, len) {
  // back rect (z=-len/2): width w0, height h0, bottom b0 ; front rect (z=+len/2): w1,h1,b1
  const z0 = -len / 2, z1 = len / 2;
  const v = [
    [-w0 / 2, b0, z0], [w0 / 2, b0, z0], [w0 / 2, b0 + h0, z0], [-w0 / 2, b0 + h0, z0],
    [-w1 / 2, b1, z1], [w1 / 2, b1, z1], [w1 / 2, b1 + h1, z1], [-w1 / 2, b1 + h1, z1],
  ];
  const f = [[4, 5, 6, 7], [1, 0, 3, 2], [3, 7, 6, 2], [0, 1, 5, 4], [0, 4, 7, 3], [5, 1, 2, 6]];
  const pos = [];
  for (const q of f) for (const k of [0, 1, 2, 0, 2, 3]) pos.push(...v[q[k]]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function buildCar(THREE, opts) {
  opts = opts || {};
  const ghost = !!opts.ghost;
  const M = (hex, extra) => {
    if (ghost) return new THREE.MeshBasicMaterial({ color: 0x7fe9ff, transparent: true, opacity: 0.32, depthWrite: false });
    return new THREE.MeshLambertMaterial(Object.assign({ color: hex, flatShading: true }, extra || {}));
  };
  const E = (hex) => ghost ? M(0) : new THREE.MeshBasicMaterial({ color: hex });
  const mBone = M(0xd7d2c3), mSlate = M(0x323843), mDark = M(0x1d2026), mOrange = M(0xe2762f), mOlive = M(0x6c6f55), mMetal = M(0x7b8190), mTire = M(0x17181c);
  const eCyan = E(0x63ecff), eRed = E(0xff4a2e), eWhite = E(0xfff6dc);

  const root = new THREE.Group();     // positioned + yawed by game
  const tilt = new THREE.Group();     // pitch / roll
  root.add(tilt);
  const body = new THREE.Group();     // visual bounce
  tilt.add(body);

  const add = (parent, geo, mat, x, y, z, rx, ry, rz) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
    if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
    parent.add(m); return m;
  };

  // ---- hull ----
  add(body, tbox(THREE, 1.9, 0.38, 0.42, 1.75, 0.34, 0.4, 4.1), mSlate, 0, 0, 0);                 // main tub floor / skid
  add(body, tbox(THREE, 1.75, 0.5, 0.78, 1.6, 0.3, 0.72, 1.9), mBone, 0, 0, 1.35);                   // hood wedge
  add(body, tbox(THREE, 1.6, 0.3, 0.72, 1.5, 0.22, 0.62, 0.55), mSlate, 0, 0, 2.55);                  // nose armour
  add(body, new THREE.BoxGeometry(1.3, 0.1, 0.1), eCyan, 0, 0.96, 2.84);                              // front light bar
  add(body, new THREE.BoxGeometry(0.3, 0.14, 0.12), eWhite, -0.62, 0.8, 2.84);
  add(body, new THREE.BoxGeometry(0.3, 0.14, 0.12), eWhite, 0.62, 0.8, 2.84);
  add(body, tbox(THREE, 0.5, 0.04, 1.08, 0.4, 0.04, 0.95, 1.9), mOrange, 0, 0, 1.35);                // hood stripe
  add(body, new THREE.BoxGeometry(1.0, 0.06, 0.5), mDark, 0, 1.06, 1.0);                              // dash cowl
  // side armour panels
  for (const s of [-1, 1]) {
    add(body, tbox(THREE, 0.14, 0.52, 0.7, 0.14, 0.4, 0.72, 2.2), mBone, 0.93 * s, 0, 0.05);
    add(body, new THREE.BoxGeometry(0.06, 0.1, 1.2), mOrange, 1.01 * s, 0.98, 0.15);                  // unit stripe
    add(body, new THREE.BoxGeometry(0.16, 0.34, 0.9), mOlive, 0.98 * s, 0.7, -1.05);                   // side stowage
  }
  // seats + driver
  add(body, new THREE.BoxGeometry(0.62, 0.45, 0.16), mDark, 0.0, 1.0, -0.7);
  add(body, new THREE.BoxGeometry(0.6, 0.12, 0.6), mDark, 0.0, 0.8, -0.3);
  const driver = new THREE.Group(); body.add(driver);
  add(driver, new THREE.BoxGeometry(0.46, 0.5, 0.28), mOlive, 0, 1.18, -0.55);
  add(driver, new THREE.IcosahedronGeometry(0.2, 0), mBone, 0, 1.62, -0.5);
  add(driver, new THREE.BoxGeometry(0.28, 0.1, 0.12), eCyan, 0, 1.63, -0.34);                          // visor
  add(driver, new THREE.BoxGeometry(0.1, 0.1, 0.5), mDark, -0.22, 1.2, -0.25, 0.5, 0, 0);             // arms
  add(driver, new THREE.BoxGeometry(0.1, 0.1, 0.5), mDark, 0.22, 1.2, -0.25, 0.5, 0, 0);
  // steering yoke
  add(body, new THREE.BoxGeometry(0.4, 0.06, 0.06), mDark, 0, 1.2, 0.05);
  // roll hoops
  const bar = (x0, y0, z0, x1, y1, z1, mat) => {
    const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1);
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, len), mat || mMetal);
    m.position.copy(a).add(b).multiplyScalar(0.5); m.lookAt(b); body.add(m);
  };
  bar(-0.82, 0.9, -0.95, -0.7, 1.95, -0.85); bar(0.82, 0.9, -0.95, 0.7, 1.95, -0.85); bar(-0.7, 1.95, -0.85, 0.7, 1.95, -0.85);
  bar(-0.84, 0.95, 0.75, -0.7, 1.55, 0.35); bar(0.84, 0.95, 0.75, 0.7, 1.55, 0.35); bar(-0.7, 1.55, 0.35, 0.7, 1.55, 0.35);
  bar(-0.7, 1.95, -0.85, -0.7, 1.55, 0.35); bar(0.7, 1.95, -0.85, 0.7, 1.55, 0.35);
  // rear deck, engine pods, cannon
  add(body, tbox(THREE, 1.7, 0.45, 0.62, 1.75, 0.5, 0.62, 1.2), mBone, 0, 0, -1.5);
  const flames = [], glows = [];
  for (const s of [-1, 1]) {
    add(body, new THREE.CylinderGeometry(0.3, 0.34, 1.5, 8), mSlate, 0.62 * s, 1.1, -1.55, Math.PI / 2, 0, 0);
    add(body, new THREE.CylinderGeometry(0.22, 0.3, 0.3, 8), mOrange, 0.62 * s, 1.1, -2.4, Math.PI / 2, 0, 0);
    add(body, new THREE.CylinderGeometry(0.16, 0.16, 0.06, 8), eCyan, 0.62 * s, 1.1, -2.56, Math.PI / 2, 0, 0);
    const fl = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1.0, 6), ghost ? M(0) : new THREE.MeshBasicMaterial({ color: 0x78f2ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    fl.rotation.x = -Math.PI / 2; fl.position.set(0.62 * s, 1.1, -3.05); fl.visible = false; body.add(fl); flames.push(fl);
  }
  add(body, new THREE.BoxGeometry(0.34, 0.1, 0.1), eRed, 0, 0.82, -2.18);                              // tail light
  add(body, new THREE.BoxGeometry(0.2, 0.3, 0.2), mDark, 0, 1.5, -1.45);                               // pintle
  add(body, new THREE.BoxGeometry(0.46, 0.3, 0.6), mSlate, 0, 1.78, -1.45);
  add(body, new THREE.BoxGeometry(0.09, 0.09, 1.3), mDark, -0.12, 1.8, -0.75);
  add(body, new THREE.BoxGeometry(0.09, 0.09, 1.3), mDark, 0.12, 1.8, -0.75);
  add(body, new THREE.BoxGeometry(0.025, 1.6, 0.025), mDark, -0.8, 1.9, -2.1);                          // whip antenna
  add(body, new THREE.BoxGeometry(0.16, 0.1, 0.02), mOrange, -0.8, 2.65, -2.1);                        // pennant

  // ---- fenders + wheels ----
  const wheels = [];
  const WX = 1.08, WR = 0.58, WZ = [1.5, -1.45];
  for (let wi = 0; wi < 4; wi++) {
    const side = wi & 1 ? 1 : -1, front = wi < 2;
    const z = front ? WZ[0] : WZ[1];
    const steer = new THREE.Group(); steer.position.set(WX * side, WR, z); body.add(steer);
    const spin = new THREE.Group(); steer.add(spin);
    add(spin, new THREE.CylinderGeometry(WR, WR, 0.52, 10), mTire, 0, 0, 0, 0, 0, Math.PI / 2);
    add(spin, new THREE.CylinderGeometry(0.34, 0.34, 0.56, 6), mMetal, 0, 0, 0, 0, 0, Math.PI / 2);
    add(spin, new THREE.BoxGeometry(0.58, 0.14, 0.12), mOrange, 0, 0, 0);
    add(spin, new THREE.BoxGeometry(0.58, 0.12, 0.14), mOrange, 0, 0, 0, 0, 0, 0).rotation.x = 0.8;
    // swing arm
    add(body, new THREE.BoxGeometry(0.7, 0.1, 0.12), mDark, 0.7 * side, WR + 0.1, z);
    // fender
    add(body, tbox(THREE, 0.62, 0.1, 0, 0.62, 0.1, 0, 1.3), mBone, WX * side + 0.02 * side, WR * 2 + 0.02, z);
    wheels.push({ steer, spin, front });
  }

  // blob shadow
  let shadow = null;
  if (!ghost) {
    const sc = document.createElement('canvas'); sc.width = sc.height = 64;
    const sx = sc.getContext('2d'); const gr = sx.createRadialGradient(32, 32, 4, 32, 32, 31);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    sx.fillStyle = gr; sx.fillRect(0, 0, 64, 64);
    const st = new THREE.CanvasTexture(sc);
    shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 5.6), new THREE.MeshBasicMaterial({ map: st, transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.renderOrder = 1;
  }
  return { root, tilt, body, wheels, flames, driver, shadow };
}
