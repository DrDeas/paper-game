// Tiny signed-distance toolkit for sculpting worlds out of soft primitives.
// Every primitive returns f(x, y, z) -> distance (negative inside). Distances may be
// approximate; the baker only needs "sign + roughly how far".

export const sphere = (cx, cy, cz, r) => (x, y, z) => Math.hypot(x - cx, y - cy, z - cz) - r;

export const ellipsoid = (cx, cy, cz, rx, ry, rz) => (x, y, z) => {
  x -= cx; y -= cy; z -= cz;
  const k0 = Math.hypot(x / rx, y / ry, z / rz);
  const k1 = Math.hypot(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
};

// capsule from a to b; radius tapers from r1 to r2 (r2 defaults to r1)
export const capsule = (a, b, r1, r2 = r1) => {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2], bb = bx * bx + by * by + bz * bz || 1e-9;
  return (x, y, z) => {
    const px = x - a[0], py = y - a[1], pz = z - a[2];
    const t = Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / bb));
    return Math.hypot(px - bx * t, py - by * t, pz - bz * t) - (r1 + (r2 - r1) * t);
  };
};

// box with rounded edges: half-sizes hx,hy,hz, corner radius r
export const box = (cx, cy, cz, hx, hy, hz, r = 0) => (x, y, z) => {
  const qx = Math.abs(x - cx) - hx + r, qy = Math.abs(y - cy) - hy + r, qz = Math.abs(z - cz) - hz + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
};

// cylinder along an axis ('x' | 'y' | 'z'), radius rad, half-length half, edge rounding r
export const cylinder = (cx, cy, cz, axis, rad, half, r = 0) => (x, y, z) => {
  x -= cx; y -= cy; z -= cz;
  const along = axis === 'x' ? x : axis === 'y' ? y : z;
  const radial = axis === 'x' ? Math.hypot(y, z) : axis === 'y' ? Math.hypot(x, z) : Math.hypot(x, y);
  const dx = radial - rad + r, dy = Math.abs(along) - half + r;
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - r;
};

// cone/frustum along +y from y0 (radius r0) to y1 (radius r1), rounded by r
export const frustum = (cx, y0, cz, y1, r0, r1, r = 0) => {
  const h = y1 - y0, slope = Math.hypot(h, r1 - r0) / h;
  return (x, y, z) => {
    const t = Math.max(0, Math.min(1, (y - y0) / h));
    const radial = Math.hypot(x - cx, z - cz) - (r0 + (r1 - r0) * t) + r;
    const side = radial / slope;
    const cap = Math.max(y0 - y, y - y1) + r;
    return Math.min(Math.max(side, cap), 0) + Math.hypot(Math.max(side, 0), Math.max(cap, 0)) - r;
  };
};

// solid of revolution around the y axis from a profile radius(y), for y in [y0, y1]
export const lathe = (cx, cz, y0, y1, radiusAt, r = 0.02) => (x, y, z) => {
  const t = Math.max(y0, Math.min(y1, y));
  const radial = Math.hypot(x - cx, z - cz) - radiusAt(t) + r;
  const cap = Math.max(y0 - y, y - y1) + r;
  return Math.min(Math.max(radial * 0.7, cap), 0) + Math.hypot(Math.max(radial * 0.7, 0), Math.max(cap, 0)) - r;
};

// ---- combinators ----
export const smin = (a, b, k) => { if (k <= 0) return Math.min(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
export const smax = (a, b, k) => -smin(-a, -b, k);

// smooth union of many shapes with blend radius k
export const union = (k, ...fs) => (x, y, z) => { let d = fs[0](x, y, z); for (let i = 1; i < fs.length; i++) d = smin(d, fs[i](x, y, z), k); return d; };
// carve `cut` out of `base`
export const carve = (k, base, ...cuts) => (x, y, z) => { let d = base(x, y, z); for (const c of cuts) d = smax(d, -c(x, y, z), k); return d; };
export const intersect = (k, a, b) => (x, y, z) => smax(a(x, y, z), b(x, y, z), k);

// ---- transforms (applied to the query point) ----
export const move = (f, dx, dy, dz) => (x, y, z) => f(x - dx, y - dy, z - dz);
export const scale = (f, sx, sy = sx, sz = sx) => { const m = Math.min(sx, sy, sz); return (x, y, z) => f(x / sx, y / sy, z / sz) * m; };
export const rotX = (f, a) => { const c = Math.cos(a), s = Math.sin(a); return (x, y, z) => f(x, c * y + s * z, -s * y + c * z); };
export const rotY = (f, a) => { const c = Math.cos(a), s = Math.sin(a); return (x, y, z) => f(c * x - s * z, y, s * x + c * z); };
export const rotZ = (f, a) => { const c = Math.cos(a), s = Math.sin(a); return (x, y, z) => f(c * x + s * y, -s * x + c * y, z); };
// mirror across the x = 0 plane (build one side, get both)
export const mirrorX = (f) => (x, y, z) => f(Math.abs(x), y, z);
// a chain of tapered capsules through points [[x,y,z,r], ...]
export const tube = (k, pts) => union(k, ...pts.slice(1).map((p, i) => capsule(pts[i], p, pts[i][3], p[3])));
