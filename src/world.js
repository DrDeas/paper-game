// World: a triangle-mesh surface whose vertices are the game's cells.
// Every world shares the same geodesic topology (a subdivided icosahedron); only
// the vertex positions differ. Simple shapes are generated from a formula, sculpted
// ones are baked offline (tools/bake-worlds.mjs) into worlds/<key>.bin.
// Pure data + math (no rendering deps) so it can run headless.

const TAU = Math.PI * 2;

// `r` = radius as a function of direction (formula worlds). No `r` = baked world.
export const SHAPES = {
  orb: { name: 'Orb', icon: '🔮', hue: 232, r: () => 1 },
  pebble: {
    name: 'Pebble', icon: '🪨', hue: 188,
    r: (x, y, z) =>
      1 +
      0.1 * Math.sin(2.1 * x + 1.3) * Math.sin(1.7 * y + 0.4) +
      0.08 * Math.sin(2.6 * z + 2.0) * Math.cos(1.9 * x) +
      0.06 * Math.sin(3.1 * y + 2.3 * z),
  },
  dice: {
    name: 'Dice', icon: '🎲', hue: 285,
    r: (x, y, z) => 0.9 / Math.pow(x * x * x * x + y * y * y * y + z * z * z * z, 0.25),
  },
  peanut: { name: 'Peanut', icon: '🥜', hue: 32 },
  puppy: { name: 'Puppy', icon: '🐶', hue: 25 },
  teddy: { name: 'Teddy', icon: '🧸', hue: 18 },
  mushroom: { name: 'Mushroom', icon: '🍄', hue: 355 },
  star: { name: 'Star', icon: '⭐', hue: 48 },
  pencil: { name: 'Pencil', icon: '✏️', hue: 40 },
  car: { name: 'Toy Car', icon: '🚗', hue: 2 },
  unicorn: { name: 'Unicorn', icon: '🦄', hue: 300 },
  guitar: { name: 'Guitar', icon: '🎸', hue: 14 },
  pig: { name: 'Pig', icon: '🐖', hue: 335 },
  cupcake: { name: 'Cupcake', icon: '🧁', hue: 320 },
  horse: { name: 'Horse', icon: '🐴', hue: 22 },
  lion: { name: 'Lion', icon: '🦁', hue: 36 },
  alligator: { name: 'Alligator', icon: '🐊', hue: 130 },
  smiley: { name: 'Smiley', icon: '😀', hue: 50 },
  teapot: { name: 'Teapot', icon: '🫖', hue: 200 },
  tooth: { name: 'Tooth', icon: '🦷', hue: 210 },
};

// ---- shared topology ----------------------------------------------------
const topoCache = new Map();

// Geodesic sphere. Vertices of each subdivision level are a prefix of the next,
// and `levels[i].parents` records which edge each new vertex is the midpoint of
// (the baker uses that to refine coarse shapes into fine ones).
export function icosphere(detail = 6) {
  if (topoCache.has(detail)) return topoCache.get(detail);
  const t = (1 + Math.sqrt(5)) / 2;
  const verts = [
    -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0, 0, -1, t, 0, 1, t,
    0, -1, -t, 0, 1, -t, t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1,
  ];
  let tris = [
    0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
    3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
  ];
  const norm = (i) => {
    const l = Math.hypot(verts[i], verts[i + 1], verts[i + 2]);
    verts[i] /= l; verts[i + 1] /= l; verts[i + 2] /= l;
  };
  for (let i = 0; i < verts.length; i += 3) norm(i);
  const levels = [{ V: 12, tris: Uint32Array.from(tris), parents: null }];
  for (let d = 0; d < detail; d++) {
    const cache = new Map(), parents = [];
    const mid = (a, b) => {
      const key = a < b ? a * 1e6 + b : b * 1e6 + a;
      let m = cache.get(key);
      if (m === undefined) {
        m = verts.length / 3;
        verts.push(verts[a * 3] + verts[b * 3], verts[a * 3 + 1] + verts[b * 3 + 1], verts[a * 3 + 2] + verts[b * 3 + 2]);
        norm(m * 3);
        parents.push(a, b);
        cache.set(key, m);
      }
      return m;
    };
    const next = [];
    for (let i = 0; i < tris.length; i += 3) {
      const a = tris[i], b = tris[i + 1], c = tris[i + 2];
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    tris = next;
    levels.push({ V: verts.length / 3, tris: Uint32Array.from(tris), parents: Uint32Array.from(parents) });
  }
  const topo = { dirs: new Float32Array(verts), tris: Uint32Array.from(tris), levels };
  const V = (topo.V = verts.length / 3), F = (topo.F = tris.length / 3), T = topo.tris;

  // vertex adjacency (each directed edge appears exactly once on a closed manifold)
  topo.nbr = new Int32Array(V * 6).fill(-1);
  topo.nbrCount = new Uint8Array(V);
  const add = (a, b) => { topo.nbr[a * 6 + topo.nbrCount[a]++] = b; };
  // triangle adjacency: triNbr[t*3+k] = triangle across the edge opposite corner k
  topo.triNbr = new Int32Array(F * 3).fill(-1);
  topo.vertTri = new Int32Array(V).fill(-1);
  const edges = new Map();
  for (let f = 0; f < F; f++) {
    for (let k = 0; k < 3; k++) {
      const a = T[f * 3 + ((k + 1) % 3)], b = T[f * 3 + ((k + 2) % 3)];
      add(a, b);
      if (topo.vertTri[a] < 0) topo.vertTri[a] = f;
      const key = a < b ? a * V + b : b * V + a, other = edges.get(key);
      if (other === undefined) edges.set(key, f * 3 + k);
      else { topo.triNbr[f * 3 + k] = (other / 3) | 0; topo.triNbr[other] = f; }
    }
  }
  topoCache.set(detail, topo);
  return topo;
}

// ---- loading ------------------------------------------------------------
const positionCache = new Map();

async function fetchBaked(key) {
  const res = await fetch(`worlds/${key}.bin`);
  if (!res.ok) throw new Error(`world "${key}" failed to load (${res.status})`);
  return res.arrayBuffer();
}

// worlds/<key>.bin = float32 scale, then V*3 int16 (position / scale * 32767)
export function decodeBaked(buf) {
  const scale = new Float32Array(buf, 0, 1)[0];
  const q = new Int16Array(buf, 4);
  const out = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) out[i] = (q[i] / 32767) * scale;
  return out;
}
export function encodeBaked(pos) {
  let scale = 0;
  for (let i = 0; i < pos.length; i++) scale = Math.max(scale, Math.abs(pos[i]));
  const buf = new ArrayBuffer(4 + pos.length * 2);
  new Float32Array(buf, 0, 1)[0] = scale;
  const q = new Int16Array(buf, 4);
  for (let i = 0; i < pos.length; i++) q[i] = Math.round((pos[i] / scale) * 32767);
  return buf;
}

export const isLoaded = (key) => !!SHAPES[key] && (!!SHAPES[key].r || positionCache.has(key));

// Fetch (once) whatever a world needs. `read(key)` may be swapped out, e.g. for Node tests.
export async function loadWorld(key, read = fetchBaked) {
  if (!SHAPES[key]) throw new Error(`unknown world "${key}"`);
  if (!SHAPES[key].r && !positionCache.has(key)) positionCache.set(key, decodeBaked(await read(key)));
}

export class World {
  // loadWorld(key) must have resolved first for baked shapes
  constructor(shapeKey = 'orb', positions = null) {
    this.shapeKey = SHAPES[shapeKey] ? shapeKey : 'orb';
    this.shape = SHAPES[this.shapeKey];
    const topo = icosphere(6);
    const V = (this.V = topo.V), F = (this.F = topo.F), tris = (this.tris = topo.tris);
    this.nbr = topo.nbr; this.nbrCount = topo.nbrCount; this.triNbr = topo.triNbr; this.vertTri = topo.vertTri;

    const p = (this.pos = new Float32Array(V * 3));
    if (positions) p.set(positions);
    else if (this.shape.r) {
      const d = topo.dirs, r = this.shape.r;
      for (let i = 0; i < V * 3; i += 3) {
        const k = r(d[i], d[i + 1], d[i + 2]);
        p[i] = d[i] * k; p[i + 1] = d[i + 1] * k; p[i + 2] = d[i + 2] * k;
      }
    } else if (positionCache.has(this.shapeKey)) p.set(positionCache.get(this.shapeKey));
    else throw new Error(`world "${this.shapeKey}" is not loaded`);

    // normalise: centre on the surface centroid, scale so the area equals a unit sphere's.
    // That keeps cell size, speed and territory percentages comparable across worlds.
    let area = 0, cx = 0, cy = 0, cz = 0;
    const faceArea = (f) => {
      const a = tris[f * 3] * 3, b = tris[f * 3 + 1] * 3, c = tris[f * 3 + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx, a, b, c];
    };
    for (let f = 0; f < F; f++) {
      const [nx, ny, nz, a, b, c] = faceArea(f), A = Math.hypot(nx, ny, nz) / 2;
      area += A;
      cx += (A * (p[a] + p[b] + p[c])) / 3; cy += (A * (p[a + 1] + p[b + 1] + p[c + 1])) / 3; cz += (A * (p[a + 2] + p[b + 2] + p[c + 2])) / 3;
    }
    cx /= area; cy /= area; cz /= area;
    const k = Math.sqrt((4 * Math.PI) / area);
    let extent = 0;
    for (let i = 0; i < V * 3; i += 3) {
      p[i] = (p[i] - cx) * k; p[i + 1] = (p[i + 1] - cy) * k; p[i + 2] = (p[i + 2] - cz) * k;
      extent = Math.max(extent, Math.hypot(p[i], p[i + 1], p[i + 2]));
    }
    this.extent = extent; // bounding radius, used to frame the whole world on screen

    // face + vertex normals
    const tn = (this.triN = new Float32Array(F * 3)), n = (this.normals = new Float32Array(V * 3));
    for (let f = 0; f < F; f++) {
      const [nx, ny, nz, a, b, c] = faceArea(f), l = Math.hypot(nx, ny, nz) || 1;
      tn[f * 3] = nx / l; tn[f * 3 + 1] = ny / l; tn[f * 3 + 2] = nz / l;
      for (const q of [a, b, c]) { n[q] += nx; n[q + 1] += ny; n[q + 2] += nz; }
    }
    for (let i = 0; i < V * 3; i += 3) {
      const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
      n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
    }
    // typical distance between neighbouring cells
    this.cellLen = Math.sqrt(((4 * Math.PI) / V) * (2 / Math.sqrt(3)));
  }

  // Greedy walk to the cell nearest to a point, starting at `c`. Graph-local on purpose:
  // it never jumps through the world to a surface on the far side.
  locate(x, y, z, c) {
    for (;;) {
      const n = this.stepToward(x, y, z, c);
      if (n === c) return c;
      c = n;
    }
  }

  // One greedy step toward a point; returns c itself when already nearest.
  stepToward(x, y, z, c) {
    const P = this.pos, N = this.nbr;
    let dx = P[c * 3] - x, dy = P[c * 3 + 1] - y, dz = P[c * 3 + 2] - z;
    let best = dx * dx + dy * dy + dz * dz, bi = c;
    for (let k = 0; k < 6; k++) {
      const j = N[c * 6 + k];
      if (j < 0) break;
      dx = P[j * 3] - x; dy = P[j * 3 + 1] - y; dz = P[j * 3 + 2] - z;
      const dd = dx * dx + dy * dy + dz * dz;
      if (dd < best) { best = dd; bi = j; }
    }
    return bi;
  }

  adjacent(a, b) {
    const N = this.nbr;
    for (let k = 0; k < 6; k++) if (N[a * 6 + k] === b) return true;
    return false;
  }

  // straight-line distance from a point to a cell
  dist(pos, c) {
    const P = this.pos;
    return Math.hypot(P[c * 3] - pos[0], P[c * 3 + 1] - pos[1], P[c * 3 + 2] - pos[2]);
  }

  // ...and the same measured in cells
  cellsTo(pos, c) {
    const P = this.pos;
    return Math.hypot(P[c * 3] - pos[0], P[c * 3 + 1] - pos[1], P[c * 3 + 2] - pos[2]) / this.cellLen;
  }

  // Put a walker on cell c: sets o.pos, o.tri, o.n and a heading o.h in the surface
  // (random when `rng` is given, otherwise the old heading projected onto it).
  place(o, c, rng) {
    const t = this.vertTri[c], T = this.tris, P = this.pos, tn = this.triN;
    o.tri = t;
    o.pos = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const v = T[t * 3 + k], w = v === c ? 0.9 : 0.05;
      o.pos[0] += P[v * 3] * w; o.pos[1] += P[v * 3 + 1] * w; o.pos[2] += P[v * 3 + 2] * w;
    }
    const nx = tn[t * 3], ny = tn[t * 3 + 1], nz = tn[t * 3 + 2];
    let hx = rng ? rng() - 0.5 : o.h[0], hy = rng ? rng() - 0.5 : o.h[1], hz = rng ? rng() - 0.5 : o.h[2];
    const k = hx * nx + hy * ny + hz * nz;
    hx -= nx * k; hy -= ny * k; hz -= nz * k;
    let l = Math.hypot(hx, hy, hz);
    if (l < 1e-6) { // degenerate: use an edge direction
      const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3;
      hx = P[b] - P[a]; hy = P[b + 1] - P[a + 1]; hz = P[b + 2] - P[a + 2]; l = Math.hypot(hx, hy, hz);
    }
    o.h = [hx / l, hy / l, hz / l];
    o.n = [this.normals[c * 3], this.normals[c * 3 + 1], this.normals[c * 3 + 2]];
    o.near = c;
  }

  // Turn a walker's heading by `ang` radians (positive = left) within the surface.
  turn(o, ang) {
    const tn = this.triN, t = o.tri, h = o.h;
    const nx = tn[t * 3], ny = tn[t * 3 + 1], nz = tn[t * 3 + 2];
    const lx = ny * h[2] - nz * h[1], ly = nz * h[0] - nx * h[2], lz = nx * h[1] - ny * h[0];
    const cs = Math.cos(ang), sn = Math.sin(ang);
    h[0] = h[0] * cs + lx * sn; h[1] = h[1] * cs + ly * sn; h[2] = h[2] * cs + lz * sn;
  }

  // Signed angle (left positive) from the walker's heading to an arbitrary 3D vector,
  // measured in the surface. Returns 0 when the vector has no component along the surface.
  angleTo(o, v) {
    const tn = this.triN, t = o.tri, h = o.h;
    const nx = tn[t * 3], ny = tn[t * 3 + 1], nz = tn[t * 3 + 2];
    const k = v[0] * nx + v[1] * ny + v[2] * nz;
    const wx = v[0] - nx * k, wy = v[1] - ny * k, wz = v[2] - nz * k;
    if (wx * wx + wy * wy + wz * wz < 1e-12) return 0;
    const cx = h[1] * wz - h[2] * wy, cy = h[2] * wx - h[0] * wz, cz = h[0] * wy - h[1] * wx;
    return Math.atan2(cx * nx + cy * ny + cz * nz, h[0] * wx + h[1] * wy + h[2] * wz);
  }

  // Walk `dist` straight ahead along the surface (a geodesic): cross triangle after
  // triangle, unfolding the heading over each shared edge. Updates o.pos, o.h, o.tri, o.n
  // and o.near (the cell being stood on: the nearest corner of the current triangle).
  move(o, dist) {
    const T = this.tris, P = this.pos, tn = this.triN, TN = this.triNbr, VN = this.normals;
    const pos = o.pos, h = o.h;
    let t = o.tri, b0 = 1, b1 = 0, b2 = 0;
    for (let iter = 0; iter < 24; iter++) {
      const ia = T[t * 3] * 3, ib = T[t * 3 + 1] * 3, ic = T[t * 3 + 2] * 3;
      const nx = tn[t * 3], ny = tn[t * 3 + 1], nz = tn[t * 3 + 2];
      // keep the heading in this triangle's plane
      let k = h[0] * nx + h[1] * ny + h[2] * nz;
      h[0] -= nx * k; h[1] -= ny * k; h[2] -= nz * k;
      k = Math.hypot(h[0], h[1], h[2]) || 1;
      h[0] /= k; h[1] /= k; h[2] /= k;
      // barycentric coordinates of the position, and their rate of change along h
      const e1x = P[ib] - P[ia], e1y = P[ib + 1] - P[ia + 1], e1z = P[ib + 2] - P[ia + 2];
      const e2x = P[ic] - P[ia], e2y = P[ic + 1] - P[ia + 1], e2z = P[ic + 2] - P[ia + 2];
      const d00 = e1x * e1x + e1y * e1y + e1z * e1z, d01 = e1x * e2x + e1y * e2y + e1z * e2z, d11 = e2x * e2x + e2y * e2y + e2z * e2z;
      const inv = 1 / (d00 * d11 - d01 * d01 || 1e-20);
      const vx = pos[0] - P[ia], vy = pos[1] - P[ia + 1], vz = pos[2] - P[ia + 2];
      const v1 = vx * e1x + vy * e1y + vz * e1z, v2 = vx * e2x + vy * e2y + vz * e2z;
      b1 = Math.max(0, (d11 * v1 - d01 * v2) * inv); b2 = Math.max(0, (d00 * v2 - d01 * v1) * inv); b0 = Math.max(0, 1 - b1 - b2);
      if (dist <= 1e-9) break;
      const g1 = h[0] * e1x + h[1] * e1y + h[2] * e1z, g2 = h[0] * e2x + h[1] * e2y + h[2] * e2z;
      const r1 = (d11 * g1 - d01 * g2) * inv, r2 = (d00 * g2 - d01 * g1) * inv, r0 = -r1 - r2;
      // which edge do we reach first?
      let tHit = Infinity, exit = -1;
      if (r0 < -1e-12 && -b0 / r0 < tHit) { tHit = -b0 / r0; exit = 0; }
      if (r1 < -1e-12 && -b1 / r1 < tHit) { tHit = -b1 / r1; exit = 1; }
      if (r2 < -1e-12 && -b2 / r2 < tHit) { tHit = -b2 / r2; exit = 2; }
      if (exit < 0 || tHit >= dist) {
        pos[0] += h[0] * dist; pos[1] += h[1] * dist; pos[2] += h[2] * dist;
        dist = 0;
        continue; // one more pass to refresh the barycentrics for the normal
      }
      pos[0] += h[0] * tHit; pos[1] += h[1] * tHit; pos[2] += h[2] * tHit;
      dist -= tHit;
      // unfold over the shared edge: keep the along-edge part, swing the across-edge part
      const nt = TN[t * 3 + exit];
      const pa = T[t * 3 + ((exit + 1) % 3)] * 3, pb = T[t * 3 + ((exit + 2) % 3)] * 3;
      let ex = P[pb] - P[pa], ey = P[pb + 1] - P[pa + 1], ez = P[pb + 2] - P[pa + 2];
      k = Math.hypot(ex, ey, ez) || 1; ex /= k; ey /= k; ez /= k;
      const mx = tn[nt * 3], my = tn[nt * 3 + 1], mz = tn[nt * 3 + 2];
      const he = h[0] * ex + h[1] * ey + h[2] * ez;
      const hp = h[0] * (ny * ez - nz * ey) + h[1] * (nz * ex - nx * ez) + h[2] * (nx * ey - ny * ex);
      h[0] = ex * he + (my * ez - mz * ey) * hp; h[1] = ey * he + (mz * ex - mx * ez) * hp; h[2] = ez * he + (mx * ey - my * ex) * hp;
      // step a hair into the new triangle so we don't re-cross the same edge
      pos[0] += h[0] * 1e-7; pos[1] += h[1] * 1e-7; pos[2] += h[2] * 1e-7;
      t = nt;
    }
    o.tri = t;
    o.near = T[t * 3 + (b0 >= b1 && b0 >= b2 ? 0 : b1 >= b2 ? 1 : 2)];
    // smooth shading normal at the final position
    const ia = T[t * 3] * 3, ib = T[t * 3 + 1] * 3, ic = T[t * 3 + 2] * 3, s = b0 + b1 + b2 || 1;
    let nx = (VN[ia] * b0 + VN[ib] * b1 + VN[ic] * b2) / s, ny = (VN[ia + 1] * b0 + VN[ib + 1] * b1 + VN[ic + 1] * b2) / s, nz = (VN[ia + 2] * b0 + VN[ib + 2] * b1 + VN[ic + 2] * b2) / s;
    const l = Math.hypot(nx, ny, nz) || 1;
    o.n[0] = nx / l; o.n[1] = ny / l; o.n[2] = nz / l;
  }
}

export { TAU };
