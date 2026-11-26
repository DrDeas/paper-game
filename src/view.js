// Everything visual: planet shader, trails, avatars, labels, particles, sky,
// and the "rig" that keeps the followed player in front of the viewer at any zoom.
import * as THREE from '../vendor/three.module.min.js';
import { PALETTE, MAX_PLAYERS } from './game.js';
import { SHAPES } from './world.js';

const TEX_W = 256;
const S_NEAR = 14;     // planet radius in metres when fully zoomed in
const S_FAR = 0.45;    // ...and when it's a globe in front of you
const LIFT = 0.007;    // how far claimed land rises off the surface
const FONT = 'ui-rounded, "SF Pro Rounded", "Nunito", "Segoe UI", system-ui, sans-serif';

// each world gets a colour mood derived from one hue
function themeFor(shape) {
  const h = (((shape && shape.hue) ?? 232) + 360) % 360;
  const c = (dh, sat, lit) => new THREE.Color().setHSL((((h + dh) % 360) + 360) % 360 / 360, sat, lit, THREE.SRGBColorSpace);
  return { base: c(0, 0.34, 0.36), rim: c(8, 0.95, 0.74), skyTop: c(18, 0.5, 0.07), skyBot: c(-28, 0.45, 0.13) };
}

const planetVert = /* glsl */ `
uniform highp sampler2D uData;
uniform float uTime;
uniform float uLift;
attribute vec3 corners;
flat varying vec3 vOwn;
flat varying vec3 vAge;
flat varying vec3 vStr;
varying vec3 vBary;
varying vec3 vN;
varying vec3 vWPos;
vec4 cell(float i) {
  int k = int(i + 0.5);
  return texelFetch(uData, ivec2(k % ${TEX_W}, k / ${TEX_W}), 0);
}
float pop(float age) {
  float t = clamp(age / 0.32, 0.0, 1.0) - 1.0;
  return 1.0 + 2.2 * t * t * t + 1.2 * t * t;
}
void main() {
  vec4 a = cell(corners.x), b = cell(corners.y), c = cell(corners.z);
  vOwn = vec3(a.r, b.r, c.r);
  vAge = uTime - vec3(a.g, b.g, c.g);
  vStr = vec3(a.b, b.b, c.b);
  int me = gl_VertexID % 3;
  vBary = vec3(me == 0 ? 1.0 : 0.0, me == 1 ? 1.0 : 0.0, me == 2 ? 1.0 : 0.0);
  float own = me == 0 ? vOwn.x : (me == 1 ? vOwn.y : vOwn.z);
  float age = me == 0 ? vAge.x : (me == 1 ? vAge.y : vAge.z);
  float str = me == 0 ? vStr.x : (me == 1 ? vStr.y : vStr.z);
  float rise = own > 0.5 ? pop(age) * smoothstep(0.25, 0.55, str) : 0.0;
  vec3 p = position + normal * uLift * rise;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWPos = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const planetFrag = /* glsl */ `
uniform vec3 uPal[${MAX_PLAYERS + 1}];
uniform vec3 uBase;
uniform vec3 uRim;
uniform vec3 uLight;
flat varying vec3 vOwn;
flat varying vec3 vAge;
flat varying vec3 vStr;
varying vec3 vBary;
varying vec3 vN;
varying vec3 vWPos;

vec3 tint(float id, float age, float line) {
  if (id < 0.5) {
    vec3 c = uBase * (1.0 + line * 0.55);
    if (age > 0.0 && age < 1.6) c += vec3(0.55, 0.6, 0.75) * exp(-age * 4.5);
    return c;
  }
  vec3 c = uPal[int(id + 0.5)] * (1.0 - line * 0.1);
  vec3 pending = c * 0.62 + uBase * 0.25;
  vec3 lit = c + vec3(0.45) * exp(-max(age, 0.0) * 5.0);
  return mix(pending, lit, smoothstep(-0.1, 0.0, age));
}

void main() {
  // weight each corner by how well-supported its cell is by same-owner neighbours:
  // lone protruding cells shrink, notches fill, so borders read as smooth curves
  vec3 raw = vBary, b = vBary * vStr, o = vOwn;
  bool xy = abs(o.x - o.y) < 0.5, yz = abs(o.y - o.z) < 0.5, xz = abs(o.x - o.z) < 0.5;
  float w0 = b.x + (xy ? b.y : 0.0) + (xz ? b.z : 0.0);
  float w1 = b.y + (xy ? b.x : 0.0) + (yz ? b.z : 0.0);
  float w2 = b.z + (xz ? b.x : 0.0) + (yz ? b.y : 0.0);
  // capture age, blended across corners that share an owner (smooth wave fronts)
  vec3 g = vAge;
  float a0 = (b.x * g.x + (xy ? b.y * g.y : 0.0) + (xz ? b.z * g.z : 0.0)) / max(w0, 1e-4);
  float a1 = (b.y * g.y + (xy ? b.x * g.x : 0.0) + (yz ? b.z * g.z : 0.0)) / max(w1, 1e-4);
  float a2 = (b.z * g.z + (xz ? b.x * g.x : 0.0) + (yz ? b.y * g.y : 0.0)) / max(w2, 1e-4);
  float id = o.x, wt = w0, age = a0;
  if (w1 > wt) { id = o.y; wt = w1; age = a1; }
  if (w2 > wt) { id = o.z; wt = w2; age = a2; }
  float id2 = id, wt2 = 0.0, age2 = age;
  if (abs(o.x - id) > 0.5 && w0 > wt2) { id2 = o.x; wt2 = w0; age2 = a0; }
  if (abs(o.y - id) > 0.5 && w1 > wt2) { id2 = o.y; wt2 = w1; age2 = a1; }
  if (abs(o.z - id) > 0.5 && w2 > wt2) { id2 = o.z; wt2 = w2; age2 = a2; }
  float m = wt - wt2; // 0 on a border, 1 deep inside a region

  float mb = min(raw.x, min(raw.y, raw.z));
  float fw = fwidth(mb);
  float line = (1.0 - smoothstep(fw * 0.4, fw * 1.6, mb)) * clamp(1.0 - fw * 12.0, 0.0, 1.0);

  vec3 col = tint(id, age, line);
  if (wt2 > 0.0) {
    // bevel highlight on the raised side, soft shadow on the low side
    float edge = 1.0 - smoothstep(0.0, 0.7, m);
    if (id > 0.5) col *= 1.0 + 0.3 * edge;
    else col *= 1.0 - 0.45 * edge;
    vec3 col2 = tint(id2, age2, line);
    if (id2 > 0.5) col2 *= 1.3; else col2 *= 0.55;
    float aa = fwidth(m) * 0.75 + 1e-4;
    col = mix(col2, col, 0.5 + 0.5 * clamp(m / aa, 0.0, 1.0));
  }

  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWPos);
  float ndl = dot(N, uLight);
  // sculpted worlds need real light and shade to read as solid forms
  float diff = 0.42 + 0.62 * smoothstep(-0.45, 0.95, ndl);
  diff *= 0.82 + 0.18 * smoothstep(-0.6, 0.6, N.y);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col = col * diff + uRim * fres * 0.3;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const haloVert = /* glsl */ `
varying vec3 vN; varying vec3 vWPos;
void main() {
  vec4 wp = modelMatrix * vec4(position + normal * 0.032, 1.0);
  vWPos = wp.xyz; vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const haloFrag = /* glsl */ `
uniform vec3 uRim; uniform float uGlow; varying vec3 vN; varying vec3 vWPos;
void main() {
  vec3 V = normalize(cameraPosition - vWPos);
  float k = smoothstep(0.0, 0.3, -dot(normalize(vN), V));
  gl_FragColor = vec4(uRim * k * k * k * uGlow, 1.0);
  #include <colorspace_fragment>
}`;

const skyFrag = /* glsl */ `
uniform vec3 uTop; uniform vec3 uBot; varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float t = smoothstep(-0.7, 0.8, d.y);
  vec3 c = mix(uBot, uTop, t);
  float n = sin(d.x * 3.1 + sin(d.z * 2.3) * 1.7) * sin(d.y * 4.0 + d.x * 1.3) * sin(d.z * 2.7 + 0.6);
  c += uBot * 0.35 * smoothstep(0.1, 0.9, n);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

const RIBBON_MAX = 3000;

class Ribbon {
  constructor(color) {
    this.pos = new Float32Array(RIBBON_MAX * 6);
    const idx = new Uint16Array((RIBBON_MAX - 1) * 6);
    for (let i = 0; i < RIBBON_MAX - 1; i++) {
      const a = i * 2;
      idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
    }
    const g = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.pos, 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.attr);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    const c = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.3);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
    this.n = 0;
    this.last = [0, 0, 0];
  }
  write(slot, P, N, h) {
    // side = N x h
    let sx = N[1] * h[2] - N[2] * h[1], sy = N[2] * h[0] - N[0] * h[2], sz = N[0] * h[1] - N[1] * h[0];
    const l = Math.hypot(sx, sy, sz) || 1, w = 0.0075 / l, up = 0.016;
    sx *= w; sy *= w; sz *= w;
    const o = slot * 6, a = this.pos;
    const cx = P[0] + N[0] * up, cy = P[1] + N[1] * up, cz = P[2] + N[2] * up;
    a[o] = cx + sx; a[o + 1] = cy + sy; a[o + 2] = cz + sz;
    a[o + 3] = cx - sx; a[o + 4] = cy - sy; a[o + 5] = cz - sz;
  }
  // rebuild an existing trail from its cells (used when joining a game in progress)
  seed(world, cells) {
    const n = Math.min(cells.length, RIBBON_MAX - 2);
    if (n < 2) return;
    const pos = world.pos, nor = world.normals, P = [0, 0, 0], N = [0, 0, 0], h = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const c = cells[i] * 3, a = cells[Math.max(i - 1, 0)] * 3, b = cells[Math.min(i + 1, n - 1)] * 3;
      for (let k = 0; k < 3; k++) { P[k] = pos[c + k]; N[k] = nor[c + k]; h[k] = pos[b + k] - pos[a + k]; }
      this.write(i, P, N, h);
    }
    this.n = n - 1;
    const d = world.pos, l = cells[n - 1] * 3;
    this.last[0] = d[l]; this.last[1] = d[l + 1]; this.last[2] = d[l + 2];
    this.attr.clearUpdateRanges();
    this.attr.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, this.n * 6);
  }
  update(p, P, N) {
    const g = this.mesh.geometry;
    if (!p.alive || p.trailCells.length === 0) {
      if (this.n) { this.n = 0; g.setDrawRange(0, 0); }
      return;
    }
    const d = p.pos;
    let from = this.n;
    if (this.n === 0) {
      this.write(0, P, N, p.h);
      this.n = 1; this.last[0] = d[0]; this.last[1] = d[1]; this.last[2] = d[2];
      from = 0;
    }
    this.write(this.n, P, N, p.h);
    const moved = Math.hypot(d[0] - this.last[0], d[1] - this.last[1], d[2] - this.last[2]);
    if (moved > 0.007 && this.n < RIBBON_MAX - 1) {
      this.n++;
      this.write(this.n, P, N, p.h);
      this.last[0] = d[0]; this.last[1] = d[1]; this.last[2] = d[2];
    }
    this.attr.clearUpdateRanges();
    this.attr.addUpdateRange(from * 6, (this.n - from + 1) * 6);
    this.attr.needsUpdate = true;
    g.setDrawRange(0, this.n * 6);
  }
}

function makeAvatar(color) {
  const g = new THREE.Group();
  const col = new THREE.Color(color);
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 16),
    new THREE.MeshLambertMaterial({ color: col, emissive: col.clone().multiplyScalar(0.25) })
  );
  body.scale.set(0.82, 0.62, 1.05);
  body.position.y = 0.75;
  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.52, 18, 12),
    new THREE.MeshLambertMaterial({ color: 0x10142c, emissive: 0x1a2550 })
  );
  visor.scale.set(1.1, 0.62, 0.8);
  visor.position.set(0, 0.95, 0.6);
  const shine = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  shine.position.set(0.25, 1.1, 1.0);
  const finMat = new THREE.MeshLambertMaterial({ color: col.clone().lerp(new THREE.Color(0xffffff), 0.5) });
  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.9, 10), finMat);
  fin.position.set(0, 1.25, -0.6); fin.rotation.x = -0.9;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.75, 1.15, 28),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.12;
  g.add(body, visor, shine, fin, ring);
  g.userData.ring = ring;
  return g;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

class Label {
  constructor(color) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 320; this.canvas.height = 128;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false }));
    this.sprite.center.set(0.5, 0);
    this.color = '#' + new THREE.Color(color).getHexString();
    this.text = '';
  }
  set(name, pct, crown) {
    const key = name + '|' + pct + '|' + crown;
    if (key === this.text) return;
    this.text = key;
    const c = this.canvas.getContext('2d');
    c.clearRect(0, 0, 320, 128);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `700 34px ${FONT}`;
    c.lineWidth = 7; c.strokeStyle = 'rgba(8,10,30,.85)'; c.lineJoin = 'round';
    const label = (crown ? '♛ ' : '') + name;
    c.strokeText(label, 160, 34, 300);
    c.fillStyle = crown ? '#ffe27a' : '#ffffff';
    c.fillText(label, 160, 34, 300);
    c.font = `800 30px ${FONT}`;
    const w = c.measureText(pct).width + 34;
    c.fillStyle = this.color;
    roundRect(c, 160 - w / 2, 62, w, 44, 22); c.fill();
    c.beginPath(); c.moveTo(148, 104); c.lineTo(172, 104); c.lineTo(160, 122); c.closePath(); c.fill();
    c.fillStyle = 'rgba(10,12,34,.92)';
    c.fillText(pct, 160, 85);
    this.tex.needsUpdate = true;
  }
}

const PARTICLES = 900;

export class View {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.xr.enabled = true;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 1200);
    this.stage = new THREE.Group();   // re-centred on the viewer when a headset session starts
    this.scene.add(this.stage);
    this.planet = new THREE.Group();
    this.stage.add(this.planet);
    this.labelRoot = new THREE.Group();
    this.stage.add(this.labelRoot);

    this.light = new THREE.Vector3(-0.45, 0.8, 0.5).normalize();
    this.scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x30264a, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.copy(this.light);
    this.scene.add(sun);

    // sky + stars (stay still relative to the viewer: comfortable in a headset)
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { uTop: { value: new THREE.Color() }, uBot: { value: new THREE.Color() } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), this.skyMat);
    const sp = new Float32Array(1800 * 3);
    for (let i = 0; i < 1800; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      sp.set([r * Math.cos(a) * 400, u * 400, r * Math.sin(a) * 400], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xdfe6ff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.85, depthWrite: false }));
    this.backdrop = new THREE.Group();
    this.backdrop.add(this.sky, this.stars);
    this.scene.add(this.backdrop);

    // particles (planet space)
    this.pPos = new Float32Array(PARTICLES * 3);
    this.pCol = new Float32Array(PARTICLES * 3);
    this.pVel = new Float32Array(PARTICLES * 3);
    this.pLife = new Float32Array(PARTICLES);
    this.pNext = 0;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.points = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.1, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.points.frustumCulled = false;
    this.planet.add(this.points);

    // in-headset scoreboard
    this.panelCanvas = document.createElement('canvas');
    this.panelCanvas.width = 512; this.panelCanvas.height = 400;
    this.panelTex = new THREE.CanvasTexture(this.panelCanvas);
    this.panelTex.colorSpace = THREE.SRGBColorSpace;
    this.panel = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.4375), new THREE.MeshBasicMaterial({ map: this.panelTex, transparent: true }));
    this.panel.position.set(-0.85, 1.3, -1.05);
    this.panel.rotation.y = 0.62;
    this.panel.visible = false;
    this.stage.add(this.panel);

    // rig state
    this.zoom = 0.3; this.zoomTarget = 0.3;
    this.menuShift = 0; this.menuShiftTarget = 0;
    this.focus = new THREE.Vector3(0, 0, 1);   // followed point on the surface (planet space)
    this.fnorm = new THREE.Vector3(0, 0, 1);   // ...and the surface normal there
    this.axis = new THREE.Vector3(0, 0, 1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.planeN = new THREE.Vector3(0, 1, 0);
    this.turntable = false; this.spin = 0.6; this.follow = 0;
    this._qa = new THREE.Quaternion(); this._qb = new THREE.Quaternion(); this._yAxis = new THREE.Vector3(0, 1, 0);
    this.scale = 1;
    this.rigN = new THREE.Vector3(); this.rigU = new THREE.Vector3(); this.rigR = new THREE.Vector3();
    this.anchor = new THREE.Vector3();
    this.avatars = []; this.ribbons = []; this.labels = [];
    this._P = [0, 0, 0]; this._N = [0, 0, 1];
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3();
    this._m1 = new THREE.Matrix4(); this._m2 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this.resize();
  }

  get inXR() { return this.renderer.xr.isPresenting; }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    if (this.inXR) return;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // keep a decent horizontal field of view on tall phone screens
    this.camera.fov = aspect >= 1 ? 58 : Math.min(95, (2 * Math.atan(Math.tan((29 * Math.PI) / 180) / Math.max(aspect, 0.4)) * 180) / Math.PI * 0.85 + 58 * 0.15);
    this.camera.updateProjectionMatrix();
  }

  setWorld(world, game) {
    this.world = world; this.game = game;
    const theme = themeFor(SHAPES[world.shapeKey]);
    this.spin = 0.6; this.follow = 0;
    // dispose the previous world
    for (const o of this.worldObjects || []) {
      o.parent && o.parent.remove(o);
      o.traverse?.((m) => { m.geometry?.dispose(); });
    }
    this.worldObjects = [];
    const V = world.V, F = world.F, tris = world.tris;
    const pos = new Float32Array(F * 9), nor = new Float32Array(F * 9), cor = new Float32Array(F * 9);
    for (let f = 0; f < F; f++) {
      const a = tris[f * 3], b = tris[f * 3 + 1], c = tris[f * 3 + 2];
      for (let k = 0; k < 3; k++) {
        const v = tris[f * 3 + k], o = f * 9 + k * 3;
        pos[o] = world.pos[v * 3]; pos[o + 1] = world.pos[v * 3 + 1]; pos[o + 2] = world.pos[v * 3 + 2];
        nor[o] = world.normals[v * 3]; nor[o + 1] = world.normals[v * 3 + 1]; nor[o + 2] = world.normals[v * 3 + 2];
        cor[o] = a; cor[o + 1] = b; cor[o + 2] = c;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('corners', new THREE.BufferAttribute(cor, 3));
    const H = Math.ceil(V / TEX_W);
    this.data = new Float32Array(TEX_W * H * 4);
    this.dataTex = new THREE.DataTexture(this.data, TEX_W, H, THREE.RGBAFormat, THREE.FloatType);
    this.dataTex.minFilter = this.dataTex.magFilter = THREE.NearestFilter;
    const pal = PALETTE.map((h) => new THREE.Color(h));
    this.planetMat = new THREE.ShaderMaterial({
      uniforms: {
        uData: { value: this.dataTex }, uTime: { value: 0 }, uLift: { value: LIFT },
        uPal: { value: pal }, uBase: { value: new THREE.Color(theme.base) },
        uRim: { value: new THREE.Color(theme.rim) }, uLight: { value: this.light },
      },
      vertexShader: planetVert, fragmentShader: planetFrag,
    });
    const mesh = new THREE.Mesh(g, this.planetMat);
    mesh.frustumCulled = false;
    this.planet.add(mesh);
    this.worldObjects.push(mesh);

    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(world.pos, 3));
    hg.setAttribute('normal', new THREE.BufferAttribute(world.normals, 3));
    hg.setIndex(new THREE.BufferAttribute(world.tris, 1));
    const halo = new THREE.Mesh(hg, new THREE.ShaderMaterial({
      uniforms: { uRim: { value: new THREE.Color(theme.rim) }, uGlow: { value: 0.15 } },
      vertexShader: haloVert, fragmentShader: haloFrag,
      side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    }));
    halo.frustumCulled = false;
    this.halo = halo;
    this.planet.add(halo);
    this.worldObjects.push(halo);

    this.skyMat.uniforms.uTop.value.copy(theme.skyTop);
    this.skyMat.uniforms.uBot.value.copy(theme.skyBot);

    this.avatars = [null]; this.ribbons = [null]; this.labels = [null];
    for (let id = 1; id <= MAX_PLAYERS; id++) {
      const av = makeAvatar(PALETTE[id]);
      av.scale.setScalar(0.017); av.visible = false;
      this.planet.add(av); this.avatars.push(av); this.worldObjects.push(av);
      const rb = new Ribbon(PALETTE[id]);
      this.planet.add(rb.mesh); this.ribbons.push(rb); this.worldObjects.push(rb.mesh);
      const lb = new Label(PALETTE[id]);
      lb.sprite.visible = false;
      this.labelRoot.add(lb.sprite); this.labels.push(lb); this.worldObjects.push(lb.sprite);
    }
    this.pLife.fill(0);
  }

  seedTrail(id, cells) { this.ribbons[id].seed(this.world, cells); }

  burst(P, N, colorId, count, speed = 0.12) {
    const c = new THREE.Color(PALETTE[colorId]).lerp(new THREE.Color(0xffffff), 0.25);
    for (let i = 0; i < count; i++) {
      const k = this.pNext; this.pNext = (k + 1) % PARTICLES;
      const rx = Math.random() - 0.5, ry = Math.random() - 0.5, rz = Math.random() - 0.5;
      this.pPos.set([P[0] + N[0] * 0.02, P[1] + N[1] * 0.02, P[2] + N[2] * 0.02], k * 3);
      const s = speed * (0.3 + Math.random());
      this.pVel.set([(rx + N[0] * 0.6) * s, (ry + N[1] * 0.6) * s, (rz + N[2] * 0.6) * s], k * 3);
      this.pCol.set([c.r, c.g, c.b], k * 3);
      this.pLife[k] = 0.6 + Math.random() * 0.7;
    }
  }

  // heading (planet space) from a thumbstick / key vector: +y is "away from the viewer"
  headingFromStick(x, y) {
    const v = this._v.copy(this.rigR).multiplyScalar(x).addScaledVector(this.rigU, y);
    return this._toPlanet(v);
  }

  // heading (planet space) from a world-space ray: go toward where the ray meets the ground
  headingFromRay(origin, dir) {
    const N = this._v2.copy(this.planeN).applyQuaternion(this.stage.quaternion);
    const A = this._v3.copy(this.anchor).applyMatrix4(this.stage.matrixWorld);
    const denom = dir.dot(N);
    const v = this._v;
    const t = denom < -1e-4 ? A.clone().sub(origin).dot(N) / denom : -1;
    if (t > 0) v.copy(dir).multiplyScalar(t).add(origin).sub(A);
    else v.copy(dir);
    v.addScaledVector(N, -v.dot(N));
    if (v.length() < 0.06 * Math.max(this.scale, 0.6)) return null; // pointing at ourselves
    v.applyQuaternion(this._q.copy(this.stage.quaternion).invert());
    return this._toPlanet(v);
  }

  _toPlanet(v) {
    v.applyQuaternion(this._q.copy(this.planet.quaternion).invert());
    return [v.x, v.y, v.z];
  }

  // focus = { pos, n }: the surface point to follow and its normal (planet space)
  updateRig(dt, focus) {
    this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, dt * 7);
    const z = this.zoom, e = z * z * (3 - 2 * z);
    const f = this.focus, fn = this.fnorm;
    if (focus) {
      f.lerp(this._v.fromArray(focus.pos), Math.min(1, dt * 9));
      fn.lerp(this._v.fromArray(focus.n), Math.min(1, dt * 6));
      if (fn.lengthSq() < 1e-6) fn.fromArray(focus.n);
      fn.normalize();
    }
    // "up" for the viewer: the ground's normal when close, the outward direction when
    // looking at the whole world (so the side the player is on faces the viewer)
    const axis = this.axis.copy(fn).multiplyScalar(1 - e);
    if (f.lengthSq() > 1e-4) axis.addScaledVector(this._v.copy(f).normalize(), e);
    if (axis.lengthSq() < 1e-6) axis.copy(fn);
    axis.normalize();
    this.up.addScaledVector(axis, -this.up.dot(axis));
    if (this.up.lengthSq() < 1e-6) this.up.set(axis.y, axis.z, axis.x).addScaledVector(axis, -this.up.dot(axis));
    this.up.normalize();
    // zoomed out, the whole world (whatever its proportions) fits the same bubble
    const sFar = (S_FAR * 1.45) / Math.max(1.45, this.world.extent);
    const s = (this.scale = Math.exp(Math.log(S_NEAR) * (1 - z) + Math.log(sFar) * z));
    const N = this.rigN.set(0, 1 - e + 0.4 * e, e).normalize();
    const U = this.rigU.set(0, 0, -1).addScaledVector(N, N.z).normalize();
    const R = this.rigR.crossVectors(U, N);
    const r = this._v.crossVectors(this.up, axis);
    this._m1.makeBasis(R, N, U);
    this._m2.makeBasis(r, axis, this.up).transpose();
    this._m1.multiply(this._m2);
    const q = this._qa.setFromRotationMatrix(this._m1);
    // menu: a slow upright turntable instead of chasing a player
    this.spin += dt * 0.35;
    this.follow += ((this.turntable && !this.inXR ? 0 : 1) - this.follow) * Math.min(1, dt * 4);
    if (this.follow < 0.999) {
      const k = this.follow * this.follow * (3 - 2 * this.follow);
      q.copy(this._qb.setFromAxisAngle(this._yAxis, this.spin).slerp(q, k));
    }
    this.planet.quaternion.copy(q);
    this.planet.scale.setScalar(s);
    // close up the followed point sits a few steps ahead; zoomed out the world's centre floats in front
    const keep = (1 - e) * this.follow;
    this._v2.copy(f).multiplyScalar(keep * s).applyQuaternion(q);
    this.planet.position.set(0, 1.15 * e, -2.6 * (1 - e) - 1.25 * e).sub(this._v2);
    // where the followed point and its ground plane ended up (used to aim pointer steering)
    this.anchor.copy(f).multiplyScalar(s).applyQuaternion(q).add(this.planet.position);
    this.planeN.copy(fn).applyQuaternion(q);
    if (!this.inXR) {
      this.camera.position.set(0, 2.1 - 0.6 * e, 1.3 - 0.9 * e);
      this._v.set(0, 1.15 * e, -3.4 * (1 - e) - 1.25 * e);
      this.camera.lookAt(this._v);
      // slide the globe aside while the menu card is up (wide screens only)
      this.menuShift += (this.menuShiftTarget - this.menuShift) * Math.min(1, dt * 5);
      const w = window.innerWidth, h = window.innerHeight;
      if (this.menuShift > 0.002 && w > h * 1.2) this.camera.setViewOffset(w, h, -this.menuShift * w * 0.2, 0, w, h);
      else if (this.menuShift > 0.002 && h > w * 1.2) this.camera.setViewOffset(w, h, 0, this.menuShift * h * 0.3, w, h);
      else if (this.camera.view) this.camera.clearViewOffset();
    }
  }

  update(dt, focus) {
    const game = this.game, world = this.world;
    this.updateRig(dt, focus);
    this.planetMat.uniforms.uTime.value = game.time;
    // the outline glow suits the far view; up close it would wash over nearby limbs
    this.halo.material.uniforms.uGlow.value = 0.04 + 0.13 * this.zoom * this.zoom;
    if (game.dirty) {
      const d = this.data, o = game.owner, t = game.capTime;
      const nb = world.nbr;
      for (let i = 0, V = world.V; i < V; i++) {
        let same = 1, n = 1;
        for (let k = 0; k < 6; k++) { const j = nb[i * 6 + k]; if (j < 0) break; n++; if (o[j] === o[i]) same++; }
        d[i * 4] = o[i]; d[i * 4 + 1] = t[i]; d[i * 4 + 2] = same / n;
      }
      this.dataTex.needsUpdate = true;
      game.dirty = false;
    }
    this.planet.updateMatrixWorld(true);
    const s = this.scale;
    const leader = game.standings()[0];
    const labelW = 0.26 * Math.pow(s, 0.55);
    for (let id = 1; id <= MAX_PLAYERS; id++) {
      const p = game.players[id], av = this.avatars[id], lb = this.labels[id];
      const P = p.pos, N = p.n;
      this.ribbons[id].update(p, P, N);
      av.visible = lb.sprite.visible = p.alive;
      if (!p.alive) continue;
      // orthonormal frame: x = N x h, y = N, z = h
      const h = p.h, k = h[0] * N[0] + h[1] * N[1] + h[2] * N[2];
      const hz = this._v.set(h[0] - N[0] * k, h[1] - N[1] * k, h[2] - N[2] * k).normalize();
      const ny = this._v2.set(N[0], N[1], N[2]);
      const sx = this._v3.crossVectors(ny, hz);
      av.quaternion.setFromRotationMatrix(this._m2.makeBasis(sx, ny, hz));
      const bob = 0.011 + Math.sin(game.time * 5 + id) * 0.0015;
      av.position.set(P[0] + N[0] * bob, P[1] + N[1] * bob, P[2] + N[2] * bob);
      const grow = Math.min(1, (game.time - p.spawnTime) / 0.35);
      av.scale.setScalar(0.017 * (grow + Math.sin(grow * Math.PI) * 0.3));
      av.userData.ring.scale.setScalar(1 + 0.12 * Math.sin(game.time * 6 + id));
      lb.set(p.name, game.pct(p).toFixed(1) + '%', p === leader);
      lb.sprite.position.set(P[0] + N[0] * 0.05, P[1] + N[1] * 0.05, P[2] + N[2] * 0.05).applyMatrix4(this.planet.matrix);
      lb.sprite.scale.set(labelW, labelW * 0.4, 1);
    }
    // particles
    const pp = this.pPos, pv = this.pVel, pl = this.pLife, pc = this.pCol;
    for (let i = 0; i < PARTICLES; i++) {
      if (pl[i] <= 0) continue;
      pl[i] -= dt;
      const o = i * 3;
      if (pl[i] <= 0) { pp[o] = pp[o + 1] = pp[o + 2] = 1e4; continue; }
      pp[o] += pv[o] * dt; pp[o + 1] += pv[o + 1] * dt; pp[o + 2] += pv[o + 2] * dt;
      const damp = 1 - dt * 1.8;
      pv[o] *= damp; pv[o + 1] *= damp; pv[o + 2] *= damp;
      const fade = 1 - dt * 1.6;
      pc[o] *= fade; pc[o + 1] *= fade; pc[o + 2] *= fade;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    this.points.material.size = 0.011 * s;
  }

  drawPanel(info) {
    const c = this.panelCanvas.getContext('2d');
    c.clearRect(0, 0, 512, 400);
    c.fillStyle = 'rgba(14,16,44,.82)';
    roundRect(c, 4, 4, 504, 392, 36); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.18)'; c.lineWidth = 3; c.stroke();
    c.textBaseline = 'middle'; c.textAlign = 'left';
    c.fillStyle = '#fff'; c.font = `800 44px ${FONT}`;
    c.fillText(info.title, 32, 52, 300);
    c.textAlign = 'right'; c.fillStyle = '#9fb0ff'; c.font = `600 24px ${FONT}`;
    c.fillText(info.sub, 480, 54, 170);
    let y = 110;
    for (const r of info.rows) {
      c.fillStyle = r.me ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.05)';
      roundRect(c, 24, y - 22, 464, 44, 22); c.fill();
      c.fillStyle = r.color; c.beginPath(); c.arc(50, y, 12, 0, 7); c.fill();
      c.fillStyle = '#fff'; c.textAlign = 'left'; c.font = `700 26px ${FONT}`;
      c.fillText(r.rank + '  ' + r.name, 74, y + 1, 300);
      c.textAlign = 'right'; c.fillText(r.pct, 470, y + 1);
      y += 50;
    }
    if (info.message) {
      c.textAlign = 'center'; c.fillStyle = '#ffe27a'; c.font = `700 25px ${FONT}`;
      c.fillText(info.message, 256, 368, 470);
    }
    this.panelTex.needsUpdate = true;
  }

  render() { this.renderer.render(this.scene, this.camera); }
}

export const hex = (id) => '#' + new THREE.Color(PALETTE[id]).getHexString();
export { THREE };
