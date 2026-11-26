// Bakes sculpted worlds into worlds/<key>.bin.
//   node tools/bake-worlds.mjs            bake everything
//   node tools/bake-worlds.mjs pig lion   bake some
//
// Method: a geodesic "balloon" is shrunk onto the shape's signed-distance field
// while its vertices slide along the surface to even out triangle areas. It is done
// coarse-to-fine so the mesh settles globally before detail is added. The result has
// exactly the same topology as every other world, which is what the game needs.
import { writeFileSync, mkdirSync } from 'node:fs';
import { icosphere, encodeBaked } from '../src/world.js';
import { SCULPTS } from './shapes.mjs';

const topo = icosphere(6);
const START = Number(process.env.START ?? 3);
const PROBES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
// FITMAX = finest level at which faces are still pushed onto the surface. No single value
// suits every shape, so each shape is baked with a few and the cleanest result is kept.
const VARIANTS = process.env.FITMAX ? [Number(process.env.FITMAX)] : [4, 6, 3, 5];
const BRIDGE = Number(process.env.BRIDGE ?? 0);

function adjacency(level) {
  const { V, tris } = topo.levels[level];
  const vt = Array.from({ length: V }, () => []);
  for (let f = 0; f < tris.length / 3; f++) for (let k = 0; k < 3; k++) vt[tris[f * 3 + k]].push(f);
  return { V, tris, vt };
}

function bake(key, sdf, FITMAX) {
  const t0 = Date.now();
  // bounds of the solid
  let lo = [9, 9, 9], hi = [-9, -9, -9];
  const G = 56, R = 3.2;
  for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) for (let k = 0; k < G; k++) {
    const p = [(i / (G - 1) - 0.5) * 2 * R, (j / (G - 1) - 0.5) * 2 * R, (k / (G - 1) - 0.5) * 2 * R];
    if (sdf(p[0], p[1], p[2]) < 0) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]); }
  }
  const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const size = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const R0 = size * 0.56, eps = size * 2e-4;

  const pos = new Float64Array(topo.V * 3), nrm = new Float64Array(topo.V * 3), nxt = new Float64Array(topo.V * 3);
  for (let i = 0; i < topo.levels[START].V * 3; i++) pos[i] = topo.dirs[i] * R0 + c[i % 3];

  const grad = (x, y, z, o, i) => {
    // tetrahedral finite differences
    const a = sdf(x + eps, y - eps, z - eps), b = sdf(x - eps, y - eps, z + eps), d = sdf(x - eps, y + eps, z - eps), e = sdf(x + eps, y + eps, z + eps);
    let gx = a - b - d + e, gy = -a - b + d + e, gz = -a + b - d + e;
    const l = Math.hypot(gx, gy, gz) || 1;
    o[i] = gx / l; o[i + 1] = gy / l; o[i + 2] = gz / l;
    return l / (4 * eps); // ~1 for a healthy distance field, ~0 on a limb's centre line
  };

  const relax = (level, iters, maxStep, lambda) => {
    const { V, tris, vt } = adjacency(level);
    const F = tris.length / 3, area = new Float64Array(F), cen = new Float64Array(F * 3), mn = new Float64Array(V * 3), push = new Float64Array(V * 3), hits = new Uint8Array(V), dv = new Float64Array(V), fitTol = size * 0.004;
    for (let it = 0; it < iters; it++) {
      // the mesh's own outward normals: a fallback where the field's gradient is
      // unreliable (deep inside a limb, on its centre line, in a tight crease)
      mn.fill(0);
      for (let f = 0; f < F; f++) {
        const a = tris[f * 3] * 3, b = tris[f * 3 + 1] * 3, q = tris[f * 3 + 2] * 3;
        const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
        const vx = pos[q] - pos[a], vy = pos[q + 1] - pos[a + 1], vz = pos[q + 2] - pos[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const j of [a, b, q]) { mn[j] += nx; mn[j + 1] += ny; mn[j + 2] += nz; }
      }
      // 1. pull toward the surface (limited step = the balloon shrinks evenly)
      for (let v = 0; v < V; v++) {
        const i = v * 3;
        const steep = grad(pos[i], pos[i + 1], pos[i + 2], nrm, i);
        let d = sdf(pos[i], pos[i + 1], pos[i + 2]);
        if (d < 0 && steep < 0.5) {
          // sunk onto a limb's centre line, where the field has no usable gradient:
          // probe around (mesh normal first, then the axes) and leave by the fastest way out
          const ml = Math.hypot(mn[i], mn[i + 1], mn[i + 2]) || 1, hh = Math.max(-d, size * 0.01);
          let best = d, bx = 0, by = 0, bz = 0;
          for (const [tx, ty, tz] of [[mn[i] / ml, mn[i + 1] / ml, mn[i + 2] / ml], ...PROBES]) {
            const val = sdf(pos[i] + tx * hh, pos[i + 1] + ty * hh, pos[i + 2] + tz * hh);
            if (val > best) { best = val; bx = tx; by = ty; bz = tz; }
          }
          if (best > d) { nrm[i] = bx; nrm[i + 1] = by; nrm[i + 2] = bz; d = -hh / 0.8; }
        }
        dv[v] = d;
        d = Math.max(-maxStep, Math.min(maxStep, d));
        pos[i] -= nrm[i] * d * 0.8; pos[i + 1] -= nrm[i + 1] * d * 0.8; pos[i + 2] -= nrm[i + 2] * d * 0.8;
      }
      // 2. slide along the surface toward the area-weighted centre of the surrounding
      //    triangles: big triangles pull harder, so areas even out
      push.fill(0); hits.fill(0);
      for (let f = 0; f < F; f++) {
        const a = tris[f * 3] * 3, b = tris[f * 3 + 1] * 3, q = tris[f * 3 + 2] * 3;
        const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
        const vx = pos[q] - pos[a], vy = pos[q + 1] - pos[a + 1], vz = pos[q + 2] - pos[a + 2];
        const A = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
        cen[f * 3] = (pos[a] + pos[b] + pos[q]) / 3; cen[f * 3 + 1] = (pos[a + 1] + pos[b + 1] + pos[q + 1]) / 3; cen[f * 3 + 2] = (pos[a + 2] + pos[b + 2] + pos[q + 2]) / 3;
        // a triangle hanging in mid-air (bridging two limbs) pulls its corners together
        // much harder, so bridges contract down into the crease where the limbs meet
        const sc = sdf(cen[f * 3], cen[f * 3 + 1], cen[f * 3 + 2]);
        const gap = Math.max(0, sc) / (Math.sqrt(A) + 1e-9);
        area[f] = Math.pow(A, 1.5) * (1 + BRIDGE * gap) + 1e-12;
        // Face fitting. Vertices alone can all sit on the surface while a face cuts
        // straight through a limb (capping it off short) or bridges a gap in mid-air.
        // Push such a face along its own normal toward the surface: a cap marches down
        // to the tip of its limb, a bridge sinks into the crease.
        // (only once its corners have landed: while the balloon is still descending every face is "off")
        if (level <= FITMAX && Math.abs(sc) > fitTol && Math.max(Math.abs(dv[a / 3]), Math.abs(dv[b / 3]), Math.abs(dv[q / 3])) < fitTol * 2) {
          const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          const k = -Math.sign(sc) * Math.min(Math.abs(sc), Math.sqrt(A) * 0.7) / (A || 1);
          for (const j of [a, b, q]) { push[j] += nx * k; push[j + 1] += ny * k; push[j + 2] += nz * k; hits[j / 3]++; }
        }
      }
      for (let v = 0; v < V; v++) {
        const i = v * 3;
        let sx = 0, sy = 0, sz = 0, sw = 0;
        for (const f of vt[v]) { const w = area[f]; sx += cen[f * 3] * w; sy += cen[f * 3 + 1] * w; sz += cen[f * 3 + 2] * w; sw += w; }
        let dx = sx / sw - pos[i], dy = sy / sw - pos[i + 1], dz = sz / sw - pos[i + 2];
        if (hits[v]) { const g = 0.6 / hits[v]; dx += push[i] * g; dy += push[i + 1] * g; dz += push[i + 2] * g; }
        const k = dx * nrm[i] + dy * nrm[i + 1] + dz * nrm[i + 2];
        dx -= nrm[i] * k; dy -= nrm[i + 1] * k; dz -= nrm[i + 2] * k;
        // the centroid of a fan sits 2/3 of the way to its rim, hence the 1.5
        let step = lambda * 1.5;
        // never slide to a spot that is inside the solid (through a thin limb or into a crease)
        const len = Math.hypot(dx, dy, dz), here = sdf(pos[i], pos[i + 1], pos[i + 2]);
        for (let tries = 0; tries < 3; tries++) {
          const there = sdf(pos[i] + dx * step, pos[i + 1] + dy * step, pos[i + 2] + dz * step);
          if (there >= Math.min(here, 0) - len * step * 0.35) break;
          step = tries === 2 ? 0 : step * 0.4;
        }
        nxt[i] = pos[i] + dx * step; nxt[i + 1] = pos[i + 1] + dy * step; nxt[i + 2] = pos[i + 2] + dz * step;
      }
      pos.set(nxt.subarray(0, V * 3));
    }
  };
  const project = (level, iters) => {
    const V = topo.levels[level].V;
    for (let it = 0; it < iters; it++) for (let v = 0; v < V; v++) {
      const i = v * 3;
      grad(pos[i], pos[i + 1], pos[i + 2], nrm, i);
      const d = sdf(pos[i], pos[i + 1], pos[i + 2]);
      pos[i] -= nrm[i] * d; pos[i + 1] -= nrm[i + 1] * d; pos[i + 2] -= nrm[i + 2] * d;
    }
  };

  const diag = (level, tag) => {
    if (!process.env.DEBUG) return;
    const { tris, V } = topo.levels[level]; let fold = 0, off = 0, far = 0; const g = [0, 0, 0];
    for (let v = 0; v < V; v++) far = Math.max(far, Math.abs(sdf(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2])));
    for (let f = 0; f < tris.length / 3; f++) {
      const a = tris[f * 3] * 3, b = tris[f * 3 + 1] * 3, q = tris[f * 3 + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[q] - pos[a], vy = pos[q + 1] - pos[a + 1], vz = pos[q + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, A = Math.hypot(nx, ny, nz) || 1;
      const mx = (pos[a] + pos[b] + pos[q]) / 3, my = (pos[a + 1] + pos[b + 1] + pos[q + 1]) / 3, mz = (pos[a + 2] + pos[b + 2] + pos[q + 2]) / 3;
      const o = sdf(mx, my, mz); if (o < off) off = o;
      grad(mx, my, mz, g, 0); if ((nx * g[0] + ny * g[1] + nz * g[2]) / A < 0.3) fold++;
    }
    console.log(`   [${tag}] level ${level}: folded ${fold}/${tris.length / 3}, deepest centroid ${off.toFixed(3)}, vertex max |sdf| ${far.toFixed(3)}`);
  };
  relax(START, 500, size * 0.012, 0.5); diag(START, 'balloon');
  relax(START, 500, size * 0.05, 0.5); diag(START, 'settled');
  for (let level = START + 1; level <= 6; level++) {
    const { parents } = topo.levels[level], coarse = topo.levels[level - 1], base = coarse.V;
    // New vertices start at edge midpoints, lifted outward along the coarse mesh's
    // normal. A plain midpoint of an edge that spans a thin limb would start inside
    // the limb, on its centre line, and could never find its way out.
    const edgeN = new Map(), key = (a, b) => (a < b ? a * base + b : b * base + a);
    for (let f = 0; f < coarse.tris.length / 3; f++) {
      const t = [coarse.tris[f * 3], coarse.tris[f * 3 + 1], coarse.tris[f * 3 + 2]];
      const a = t[0] * 3, b = t[1] * 3, q = t[2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[q] - pos[a], vy = pos[q + 1] - pos[a + 1], vz = pos[q + 2] - pos[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      for (let k = 0; k < 3; k++) {
        const kk = key(t[k], t[(k + 1) % 3]), e = edgeN.get(kk);
        if (e) { e[0] += nx; e[1] += ny; e[2] += nz; } else edgeN.set(kk, [nx, ny, nz]);
      }
    }
    for (let m = 0; m < parents.length / 2; m++) {
      const pa = parents[m * 2], pb = parents[m * 2 + 1], a = pa * 3, b = pb * 3, i = (base + m) * 3;
      const e = edgeN.get(key(pa, pb)), el = Math.hypot(e[0], e[1], e[2]) || 1;
      const lift = Math.hypot(pos[a] - pos[b], pos[a + 1] - pos[b + 1], pos[a + 2] - pos[b + 2]) * 0.35 / el;
      pos[i] = (pos[a] + pos[b]) / 2 + e[0] * lift; pos[i + 1] = (pos[a + 1] + pos[b + 1]) / 2 + e[1] * lift; pos[i + 2] = (pos[a + 2] + pos[b + 2]) / 2 + e[2] * lift;
    }
    diag(level, 'subdivided');
    relax(level, level === 6 ? 70 : level === 5 ? 200 : 320, size * 0.05, 0.45); diag(level, 'relaxed');
  }
  project(6, 4);

  // ---- quality report ----
  const { tris } = topo.levels[6], F = tris.length / 3;
  const areas = new Float64Array(F), g = [0, 0, 0], vn = new Float64Array(topo.V * 3);
  for (let f = 0; f < F; f++) {
    const a = tris[f * 3] * 3, b = tris[f * 3 + 1] * 3, q = tris[f * 3 + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[q] - pos[a], vy = pos[q + 1] - pos[a + 1], vz = pos[q + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const j of [a, b, q]) { vn[j] += nx; vn[j + 1] += ny; vn[j + 2] += nz; }
  }
  let off = 0, flipped = 0, skinny = 0; const bad = [];
  for (let f = 0; f < F; f++) {
    const a = tris[f * 3] * 3, b = tris[f * 3 + 1] * 3, q = tris[f * 3 + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[q] - pos[a], vy = pos[q + 1] - pos[a + 1], vz = pos[q + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, A = Math.hypot(nx, ny, nz);
    areas[f] = A;
    const mx = (pos[a] + pos[b] + pos[q]) / 3, my = (pos[a + 1] + pos[b + 1] + pos[q + 1]) / 3, mz = (pos[a + 2] + pos[b + 2] + pos[q + 2]) / 3;
    const o1 = Math.abs(sdf(mx, my, mz));
    if (o1 > 0.03 && process.env.DEBUG) bad.push([o1.toFixed(3), mx.toFixed(2), my.toFixed(2), mz.toFixed(2)].join(' '));
    off = Math.max(off, o1);
    // folded = facing against the surface around it
    g[0] = vn[a] + vn[b] + vn[q]; g[1] = vn[a + 1] + vn[b + 1] + vn[q + 1]; g[2] = vn[a + 2] + vn[b + 2] + vn[q + 2];
    if (nx * g[0] + ny * g[1] + nz * g[2] < 0) flipped++;
    const e = [Math.hypot(ux, uy, uz), Math.hypot(vx, vy, vz), Math.hypot(ux - vx, uy - vy, uz - vz)];
    if (Math.max(...e) / Math.min(...e) > 4) skinny++;
  }
  if (process.env.DEBUG) console.log(bad.length, 'badly fitting triangles, e.g.', bad.slice(0, 12).join(' | '));
  const sorted = Float64Array.from(areas).sort(), total = sorted.reduce((s, a) => s + a, 0) / 2;
  const unit = Math.sqrt(total / (4 * Math.PI)); // scale that the game will normalise away
  const report = `${key.padEnd(10)} fit<=${FITMAX} ${((Date.now() - t0) / 1000).toFixed(1)}s  area p5/p50/p95 = ${(sorted[(F * 0.05) | 0] / sorted[F >> 1]).toFixed(2)}/1/${(sorted[(F * 0.95) | 0] / sorted[F >> 1]).toFixed(2)}  worst fit ${(off / unit).toFixed(3)}  folded ${flipped}  skinny ${skinny}`;
  return { report, score: flipped + (off / unit) * 4000, data: Buffer.from(encodeBaked(Float32Array.from(pos))) };
}

const want = process.argv.slice(2);
for (const [key, sdf] of Object.entries(SCULPTS)) {
  if (want.length && !want.includes(key)) continue;
  let best = null;
  for (const v of VARIANTS) {
    const r = bake(key, sdf, v);
    if (!best || r.score < best.score) best = r;
    if (best.score < 25) break; // clean: at most a handful of folds and a snug fit
    console.log('   tried ' + r.report);
  }
  mkdirSync(new URL('../worlds/', import.meta.url), { recursive: true });
  writeFileSync(new URL(`../worlds/${key}.bin`, import.meta.url), best.data);
  console.log(best.report);
}
