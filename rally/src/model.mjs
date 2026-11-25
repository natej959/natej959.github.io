// Converts assets/sedan.obj into compact arrays (metres, +z forward, y up) with the
// four wheels split out so they can spin/steer.
import { readFileSync } from 'node:fs';
export function convertSedan(objPath) {
  const lines = readFileSync(objPath, 'utf8').split('\n');
  const v = [], vt = [], vn = [], faces = [];
  for (const l of lines) {
    const s = l.trim().split(/\s+/);
    if (s[0] === 'v') v.push([+s[1], +s[2], +s[3]]);
    else if (s[0] === 'vt') vt.push([+s[1], +s[2]]);
    else if (s[0] === 'vn') vn.push([+s[1], +s[2], +s[3]]);
    else if (s[0] === 'f') faces.push(s.slice(1).map((t) => t.split('/').map((x) => (x ? parseInt(x, 10) - 1 : -1))));
  }
  // connected components by shared position index
  const par = v.map((_, i) => i);
  const find = (x) => (par[x] === x ? x : (par[x] = find(par[x])));
  for (const f of faces) for (let k = 1; k < f.length; k++) par[find(f[k][0])] = find(f[0][0]);
  const comp = {};
  for (const f of faces) { const r = find(f[0][0]); (comp[r] = comp[r] || []).push(f); }
  const S = 4.5 / 268;              // ~4.5 m long
  const Y0 = -13.96;                // tyre bottom
  const tr = (p) => [p[2] * S, (p[1] - Y0) * S, -p[0] * S]; // rotate so the nose (-x) points +z
  const trN = (n) => [n[2], n[1], -n[0]];
  const r3 = (x) => Math.round(x * 1000) / 1000, r4 = (x) => Math.round(x * 10000) / 10000;
  function pack(fs, center) {
    const P = [], U = [], N = [];
    for (const f of fs) for (let t = 1; t < f.length - 1; t++) for (const c of [f[0], f[t], f[t + 1]]) {
      const p = tr(v[c[0]]); P.push(r3(p[0] - center[0]), r3(p[1] - center[1]), r3(p[2] - center[2]));
      const uv = c[1] >= 0 ? vt[c[1]] : [0, 0]; U.push(r4(uv[0]), r4(uv[1]));
      const n = c[2] >= 0 ? trN(vn[c[2]]) : [0, 1, 0]; N.push(r3(n[0]), r3(n[1]), r3(n[2]));
    }
    return { p: P, u: U, n: N };
  }
  const body = [], wheels = [];
  for (const fs of Object.values(comp)) {
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const f of fs) for (const c of f) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], v[c[0]][a]); mx[a] = Math.max(mx[a], v[c[0]][a]); }
    const isWheel = fs.length === 92 && mn[1] < -10;
    if (isWheel) {
      const c = tr([(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2]);
      wheels.push({ c: c.map(r3), front: c[2] > 0, ...pack(fs, c) });
    } else body.push(...fs);
  }
  if (wheels.length !== 4) throw new Error('expected 4 wheels, got ' + wheels.length);
  return { body: pack(body, [0, 0, 0]), wheels };
}
