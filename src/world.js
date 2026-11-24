// World: a geodesic cell grid wrapped around a star-shaped surface.
// Pure data + math (no rendering deps) so it can run headless.

export const SHAPES = {
  orb: { name: 'Orb', r: () => 1 },
  pebble: {
    name: 'Pebble',
    r: (x, y, z) =>
      1 +
      0.1 * Math.sin(2.1 * x + 1.3) * Math.sin(1.7 * y + 0.4) +
      0.08 * Math.sin(2.6 * z + 2.0) * Math.cos(1.9 * x) +
      0.06 * Math.sin(3.1 * y + 2.3 * z),
  },
  dice: {
    name: 'Dice',
    r: (x, y, z) => 0.9 / Math.pow(x * x * x * x + y * y * y * y + z * z * z * z, 0.25),
  },
  peanut: { name: 'Peanut', r: (x, y, z) => 0.8 + 0.4 * y * y },
};

function buildIcosphere(detail) {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [
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
  for (let d = 0; d < detail; d++) {
    const cache = new Map();
    const mid = (a, b) => {
      const key = a < b ? a * 1e6 + b : b * 1e6 + a;
      let m = cache.get(key);
      if (m === undefined) {
        m = verts.length / 3;
        verts.push(
          verts[a * 3] + verts[b * 3],
          verts[a * 3 + 1] + verts[b * 3 + 1],
          verts[a * 3 + 2] + verts[b * 3 + 2]
        );
        norm(m * 3);
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
  }
  return { dirs: new Float32Array(verts), tris: new Uint32Array(tris) };
}

export class World {
  constructor(shapeKey = 'orb', detail = 6) {
    this.shapeKey = SHAPES[shapeKey] ? shapeKey : 'orb';
    this.shape = SHAPES[this.shapeKey];
    const { dirs, tris } = buildIcosphere(detail);
    this.dirs = dirs;
    this.tris = tris;
    const V = (this.V = dirs.length / 3);
    this.F = tris.length / 3;

    // adjacency (each directed edge appears exactly once on a closed manifold)
    this.nbr = new Int32Array(V * 6).fill(-1);
    this.nbrCount = new Uint8Array(V);
    const add = (a, b) => { this.nbr[a * 6 + this.nbrCount[a]++] = b; };
    for (let i = 0; i < tris.length; i += 3) {
      add(tris[i], tris[i + 1]); add(tris[i + 1], tris[i + 2]); add(tris[i + 2], tris[i]);
    }

    // surface positions + smooth normals
    this.pos = new Float32Array(V * 3);
    const r = this.shape.r;
    for (let i = 0; i < V; i++) {
      const x = dirs[i * 3], y = dirs[i * 3 + 1], z = dirs[i * 3 + 2];
      const k = r(x, y, z);
      this.pos[i * 3] = x * k; this.pos[i * 3 + 1] = y * k; this.pos[i * 3 + 2] = z * k;
    }
    this.normals = new Float32Array(V * 3);
    const p = this.pos, n = this.normals;
    for (let i = 0; i < tris.length; i += 3) {
      const a = tris[i] * 3, b = tris[i + 1] * 3, c = tris[i + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const q of [a, b, c]) { n[q] += nx; n[q + 1] += ny; n[q + 2] += nz; }
    }
    for (let i = 0; i < V * 3; i += 3) {
      const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
      n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
    }
    // typical angular distance between neighbouring cells
    this.cellAngle = Math.sqrt(((4 * Math.PI) / V) * (2 / Math.sqrt(3)));
  }

  radius(d) { return this.shape.r(d[0], d[1], d[2]); }

  // Greedy walk to the cell whose direction is nearest to (x,y,z), starting at `c`.
  locate(x, y, z, c) {
    const D = this.dirs, N = this.nbr;
    let best = D[c * 3] * x + D[c * 3 + 1] * y + D[c * 3 + 2] * z;
    for (;;) {
      let bi = -1;
      for (let k = 0; k < 6; k++) {
        const j = N[c * 6 + k];
        if (j < 0) break;
        const dd = D[j * 3] * x + D[j * 3 + 1] * y + D[j * 3 + 2] * z;
        if (dd > best) { best = dd; bi = j; }
      }
      if (bi < 0) return c;
      c = bi;
    }
  }

  // One greedy step toward (x,y,z); returns c itself when already nearest.
  stepToward(x, y, z, c) {
    const D = this.dirs, N = this.nbr;
    let best = D[c * 3] * x + D[c * 3 + 1] * y + D[c * 3 + 2] * z, bi = c;
    for (let k = 0; k < 6; k++) {
      const j = N[c * 6 + k];
      if (j < 0) break;
      const dd = D[j * 3] * x + D[j * 3 + 1] * y + D[j * 3 + 2] * z;
      if (dd > best) { best = dd; bi = j; }
    }
    return bi;
  }

  // Surface point and outward normal for a unit direction.
  surface(d, outP, outN) {
    const r = this.shape.r;
    const k = r(d[0], d[1], d[2]);
    outP[0] = d[0] * k; outP[1] = d[1] * k; outP[2] = d[2] * k;
    if (!outN) return;
    if (this.shapeKey === 'orb') { outN[0] = d[0]; outN[1] = d[1]; outN[2] = d[2]; return; }
    // numeric tangent frame
    let ax = 0, ay = 1, az = 0;
    if (Math.abs(d[1]) > 0.9) { ax = 1; ay = 0; }
    let t1x = ay * d[2] - az * d[1], t1y = az * d[0] - ax * d[2], t1z = ax * d[1] - ay * d[0];
    let l = Math.hypot(t1x, t1y, t1z); t1x /= l; t1y /= l; t1z /= l;
    const t2x = d[1] * t1z - d[2] * t1y, t2y = d[2] * t1x - d[0] * t1z, t2z = d[0] * t1y - d[1] * t1x;
    const e = 0.01;
    const sample = (tx, ty, tz, o) => {
      let x = d[0] + tx * e, y = d[1] + ty * e, z = d[2] + tz * e;
      const m = Math.hypot(x, y, z); x /= m; y /= m; z /= m;
      const q = r(x, y, z);
      o[0] = x * q - outP[0]; o[1] = y * q - outP[1]; o[2] = z * q - outP[2];
    };
    const A = [0, 0, 0], B = [0, 0, 0];
    sample(t1x, t1y, t1z, A); sample(t2x, t2y, t2z, B);
    let nx = A[1] * B[2] - A[2] * B[1], ny = A[2] * B[0] - A[0] * B[2], nz = A[0] * B[1] - A[1] * B[0];
    if (nx * d[0] + ny * d[1] + nz * d[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
    l = Math.hypot(nx, ny, nz) || 1;
    outN[0] = nx / l; outN[1] = ny / l; outN[2] = nz / l;
  }
}
