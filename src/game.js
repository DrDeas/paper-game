// Core simulation: territory, trails, captures, eliminations. Headless-friendly.
import { initBot, botThink } from './bots.js';

export const MAX_PLAYERS = 12;
export const HUMAN_ID = 1;
export const PALETTE = [
  0x000000, // 0 = unclaimed
  0xffc531, 0x21d4c5, 0xff5e8a, 0x8f7bff, 0x6fe04a, 0xff8a3c,
  0x3aa8ff, 0xf25bd6, 0xc9e23a, 0x2fe39a, 0xff6b57, 0xb9a2ff,
];
const BOT_NAMES = [
  'Marmalade', 'Dr. Noodle', 'Biscuit', 'Captain Fig', 'Wobble', 'Pickle Jr', 'Moss', 'Zigzag',
  'Tofu Knight', 'Pebbles', 'Sir Loops', 'Nimbus', 'Turnip', 'Echo', 'Fennel', 'Bramble',
  'Quokka', 'Dumpling', 'Juniper', 'Sprocket', 'Mango Tax', 'Old Gregor', 'Pixel', 'Clementine',
  'Loop Dogg', 'Saffron', 'Kazoo', 'Tangle', 'Button', 'Orbit Al', 'Rhubarb', 'Yarnball',
];

export const SPEED = 0.28;      // surface units / second (mean world radius = 1)
export const TURN_RATE = 5.5;   // rad / second
const START_RINGS = 7;

export class Game {
  constructor(world, rng = Math.random, mode = 'classic') {
    this.world = world;
    this.mode = mode === 'imperial' ? 'imperial' : 'classic';
    this.rng = rng;
    const V = world.V;
    this.owner = new Uint8Array(V);
    this.trail = new Uint8Array(V);
    this.capTime = new Float32Array(V).fill(-100);
    this.time = 0;
    this.dirty = true;
    this.events = [];
    this._label = new Int32Array(V);
    this._queue = new Int32Array(V);
    this._stamp = new Int32Array(V);
    this._stampN = 0;
    this._hurt = new Set(); // players who lost land since the last sweep
    this.players = [null];
    for (let id = 1; id <= MAX_PLAYERS; id++) {
      this.players.push({
        id, name: '', isBot: id !== HUMAN_ID, alive: false,
        d: [0, 1, 0], h: [1, 0, 0], want: null, cell: 0,
        trailCells: [], count: 0, best: 0, kills: 0, pieces: 1,
        respawnAt: id === HUMAN_ID ? Infinity : 0.2 + id * 0.12, spawnTime: 0, ai: null,
      });
    }
  }

  pct(p) { return (p.count / this.world.V) * 100; }

  join(name) {
    const p = this.players[HUMAN_ID];
    if (p.alive) this.kill(p, null, true);
    p.name = name || 'You';
    this.spawn(p);
    return p;
  }

  spawn(p) {
    const w = this.world, D = w.dirs, rng = this.rng;
    // pick the candidate cell farthest from everyone, preferring unclaimed ground
    let bestCell = 0, bestScore = -Infinity;
    for (let i = 0; i < 48; i++) {
      const c = (rng() * w.V) | 0;
      let score = 2;
      for (const q of this.players) {
        if (!q || !q.alive) continue;
        const dot = D[c * 3] * q.d[0] + D[c * 3 + 1] * q.d[1] + D[c * 3 + 2] * q.d[2];
        score = Math.min(score, 1 - dot);
      }
      if (this.owner[c]) score -= 0.5;
      if (this.trail[c]) score -= 0.5;
      if (score > bestScore) { bestScore = score; bestCell = c; }
    }
    p.alive = true;
    p.trailCells.length = 0;
    p.count = 0; p.best = 0; p.kills = 0; p.pieces = 1;
    p.want = null;
    p.cell = bestCell;
    p.spawnTime = this.time;
    p.d = [D[bestCell * 3], D[bestCell * 3 + 1], D[bestCell * 3 + 2]];
    // random tangent heading
    let hx = rng() - 0.5, hy = rng() - 0.5, hz = rng() - 0.5;
    const k = hx * p.d[0] + hy * p.d[1] + hz * p.d[2];
    hx -= p.d[0] * k; hy -= p.d[1] * k; hz -= p.d[2] * k;
    const l = Math.hypot(hx, hy, hz) || 1;
    p.h = [hx / l, hy / l, hz / l];
    // claim a starting disc
    const q = this._queue, st = this._stamp, s = ++this._stampN, N = w.nbr;
    const minDot = Math.cos(w.cellAngle * (START_RINGS + 0.3));
    let head = 0, tail = 0, levelEnd = 1, depth = 0;
    q[tail++] = bestCell; st[bestCell] = s;
    while (head < tail) {
      if (head === levelEnd) { depth++; levelEnd = tail; if (depth > START_RINGS + 3) break; }
      const c = q[head++];
      if (!this.trail[c]) this._setOwner(c, p, this.time + depth * 0.03);
      for (let j = 0; j < 6; j++) {
        const n = N[c * 6 + j];
        if (n < 0) break;
        if (st[n] === s) continue;
        st[n] = s;
        // keep the disc round rather than hexagonal
        if (D[n * 3] * p.d[0] + D[n * 3 + 1] * p.d[1] + D[n * 3 + 2] * p.d[2] >= minDot) q[tail++] = n;
      }
    }
    if (p.isBot) {
      p.name = BOT_NAMES[(rng() * BOT_NAMES.length) | 0];
      initBot(p, rng);
    }
    this.dirty = true;
    this.events.push({ type: 'spawn', id: p.id });
    this._hurt.add(p.id);
    this._sweepEmpty(p);
  }

  _setOwner(c, p, t) {
    const prev = this.owner[c];
    if (prev === p.id) return;
    if (prev) { this.players[prev].count--; this._hurt.add(prev); }
    this.owner[c] = p.id;
    this.capTime[c] = t;
    p.count++;
    if (p.count > p.best) p.best = p.count;
  }

  // A territory must stay in one piece. When someone carves through it, only the
  // piece its owner is anchored to survives; every severed piece goes back to unclaimed.
  _pruneSevered(q) {
    const w = this.world, V = w.V, N = w.nbr, owner = this.owner, id = q.id;
    const label = this._label, queue = this._queue;
    label.fill(-1);
    const sizes = [];
    for (let s = 0; s < V; s++) {
      if (owner[s] !== id || label[s] !== -1) continue;
      const L = sizes.length;
      let head = 0, tail = 0;
      queue[tail++] = s; label[s] = L;
      while (head < tail) {
        const c = queue[head++];
        for (let j = 0; j < 6; j++) {
          const n = N[c * 6 + j];
          if (n < 0) break;
          if (label[n] === -1 && owner[n] === id) { label[n] = L; queue[tail++] = n; }
        }
      }
      sizes.push(tail);
    }
    // Imperial mode: annexed land may sit apart from the homeland, so a player is
    // allowed `pieces` separate holdings; only pieces beyond that count as severed.
    if (sizes.length <= q.pieces) { q.pieces = sizes.length; return; }
    // anchor: the land under the owner; else the land their trail left from; else the biggest piece
    let keep = -1;
    if (owner[q.cell] === id) keep = label[q.cell];
    else if (q.trailCells.length) {
      const c = q.trailCells[0];
      for (let j = 0; j < 6 && keep < 0; j++) {
        const n = N[c * 6 + j];
        if (n >= 0 && owner[n] === id) keep = label[n];
      }
    }
    if (keep < 0) { keep = 0; for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[keep]) keep = i; }
    // the anchor always survives, then the largest other holdings up to the allowance
    const order = sizes.map((_, i) => i).filter((i) => i !== keep).sort((a, b) => sizes[b] - sizes[a]);
    const kept = new Set([keep, ...order.slice(0, q.pieces - 1)]);
    let lost = 0;
    for (let c = 0; c < V; c++) {
      if (label[c] === -1 || kept.has(label[c])) continue;
      owner[c] = 0; this.capTime[c] = this.time; lost++;
    }
    q.count -= lost;
    this.dirty = true;
    this.events.push({ type: 'severed', id, lost });
  }

  _sweepEmpty(by) {
    for (const hid of this._hurt) {
      const q = this.players[hid];
      if (q.alive && q.count > 0) this._pruneSevered(q);
    }
    this._hurt.clear();
    for (const q of this.players) if (q && q.alive && q.count <= 0) this.kill(q, by);
  }

  kill(victim, killer, silent = false) {
    if (!victim.alive) return;
    victim.alive = false;
    const id = victim.id, V = this.world.V;
    for (const c of victim.trailCells) if (this.trail[c] === id) this.trail[c] = 0;
    victim.trailCells.length = 0;
    // Imperial mode: the victor inherits the fallen player's land instead of it vanishing
    const annex = this.mode === 'imperial' && killer && killer !== victim && killer.alive;
    const D = this.world.dirs, vd = victim.d;
    let annexed = 0;
    for (let c = 0; c < V; c++) {
      if (this.owner[c] !== id) continue;
      if (annex) {
        const dot = D[c * 3] * vd[0] + D[c * 3 + 1] * vd[1] + D[c * 3 + 2] * vd[2];
        this.owner[c] = killer.id;
        this.capTime[c] = this.time + Math.min(Math.acos(Math.min(1, Math.max(-1, dot))) * 1.4, 0.7);
        annexed++;
      } else { this.owner[c] = 0; this.capTime[c] = this.time; }
    }
    victim.count = 0;
    victim.want = null;
    if (annex) {
      killer.count += annexed;
      if (killer.count > killer.best) killer.best = killer.count;
      killer.pieces += 1;           // upper bound; trimmed to the real count at the next sweep
      this._hurt.add(killer.id);
    }
    victim.respawnAt = victim.isBot ? this.time + 1.5 + this.rng() * 3 : Infinity;
    if (killer && killer !== victim) killer.kills++;
    this.dirty = true;
    if (!silent) {
      this.events.push({
        type: 'death', id, name: victim.name, by: killer ? killer.id : 0,
        byName: killer ? killer.name : '', d: victim.d.slice(), best: victim.best, annexed,
      });
    }
  }

  capture(p) {
    const w = this.world, V = w.V, N = w.nbr, D = w.dirs;
    const owner = this.owner, trail = this.trail, id = p.id, now = this.time;
    const before = p.count;
    const fresh = [];
    for (const c of p.trailCells) {
      if (trail[c] === id) trail[c] = 0;
      this._setOwner(c, p, now);
      fresh.push(c);
    }
    p.trailCells.length = 0;
    // label connected regions of everything that isn't ours
    const label = this._label, q = this._queue;
    label.fill(-1);
    const sizes = [];
    for (let s = 0; s < V; s++) {
      if (label[s] !== -1 || owner[s] === id) continue;
      const L = sizes.length;
      let head = 0, tail = 0;
      q[tail++] = s; label[s] = L;
      while (head < tail) {
        const c = q[head++];
        for (let j = 0; j < 6; j++) {
          const n = N[c * 6 + j];
          if (n < 0) break;
          if (label[n] === -1 && owner[n] !== id) { label[n] = L; q[tail++] = n; }
        }
      }
      sizes.push(tail);
    }
    if (sizes.length > 1) {
      // the biggest region is "outside"; everything else is enclosed
      let big = 0;
      for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[big]) big = i;
      const victims = [];
      for (let c = 0; c < V; c++) {
        const L = label[c];
        if (L === -1 || L === big) continue;
        const dot = D[c * 3] * p.d[0] + D[c * 3 + 1] * p.d[1] + D[c * 3 + 2] * p.d[2];
        const ang = Math.acos(Math.min(1, Math.max(-1, dot)));
        this._setOwner(c, p, now + Math.min(ang * 1.4, 0.55));
        fresh.push(c);
        const t = trail[c];
        if (t && t !== id && !victims.includes(t)) victims.push(t);
      }
      for (const v of victims) this.kill(this.players[v], p);
    }
    // tidy the new border: fill unclaimed notches that are mostly surrounded
    for (let i = 0, n0 = fresh.length; i < n0; i++) {
      const c = fresh[i];
      for (let j = 0; j < 6; j++) {
        const n = N[c * 6 + j];
        if (n < 0) break;
        if (owner[n] !== 0 || trail[n] !== 0) continue;
        let mine = 0;
        for (let k = 0; k < 6; k++) { const m = N[n * 6 + k]; if (m >= 0 && owner[m] === id) mine++; }
        if (mine >= 4) this._setOwner(n, p, this.capTime[c]);
      }
    }
    this._hurt.add(id); // our own pieces may have merged
    this._sweepEmpty(p);
    this.dirty = true;
    this.events.push({ type: 'capture', id, gained: p.count - before, d: p.d.slice() });
  }

  _enter(p, c) {
    const t = this.trail[c];
    if (t && t !== p.id) {
      this.kill(this.players[t], p);
    } else if (t === p.id) {
      const idx = p.trailCells.lastIndexOf(c);
      if (idx < p.trailCells.length - 4) this.kill(p, p);
      p.cell = c;
      return;
    }
    p.cell = c;
    if (this.owner[c] === p.id) {
      if (p.trailCells.length) this.capture(p);
    } else {
      this.trail[c] = p.id;
      p.trailCells.push(c);
    }
  }

  step(dt) {
    this.time += dt;
    const w = this.world;
    for (let id = 1; id <= MAX_PLAYERS; id++) {
      const p = this.players[id];
      if (!p.alive) {
        if (p.isBot && this.time >= p.respawnAt) this.spawn(p);
        continue;
      }
      if (p.isBot) botThink(this, p);
      const d = p.d, h = p.h;
      if (p.want) {
        let wx = p.want[0], wy = p.want[1], wz = p.want[2];
        const k = wx * d[0] + wy * d[1] + wz * d[2];
        wx -= d[0] * k; wy -= d[1] * k; wz -= d[2] * k;
        const l = Math.hypot(wx, wy, wz);
        if (l > 1e-6) {
          wx /= l; wy /= l; wz /= l;
          const cx = h[1] * wz - h[2] * wy, cy = h[2] * wx - h[0] * wz, cz = h[0] * wy - h[1] * wx;
          const ang = Math.atan2(cx * d[0] + cy * d[1] + cz * d[2], h[0] * wx + h[1] * wy + h[2] * wz);
          const lim = TURN_RATE * dt;
          const da = Math.max(-lim, Math.min(lim, ang));
          const lx = d[1] * h[2] - d[2] * h[1], ly = d[2] * h[0] - d[0] * h[2], lz = d[0] * h[1] - d[1] * h[0];
          const cs = Math.cos(da), sn = Math.sin(da);
          h[0] = h[0] * cs + lx * sn; h[1] = h[1] * cs + ly * sn; h[2] = h[2] * cs + lz * sn;
        }
      }
      const a = (SPEED * dt) / w.radius(d);
      const cs = Math.cos(a), sn = Math.sin(a);
      const nx = d[0] * cs + h[0] * sn, ny = d[1] * cs + h[1] * sn, nz = d[2] * cs + h[2] * sn;
      let gx = h[0] * cs - d[0] * sn, gy = h[1] * cs - d[1] * sn, gz = h[2] * cs - d[2] * sn;
      let l = Math.hypot(nx, ny, nz);
      d[0] = nx / l; d[1] = ny / l; d[2] = nz / l;
      const k = gx * d[0] + gy * d[1] + gz * d[2];
      gx -= d[0] * k; gy -= d[1] * k; gz -= d[2] * k;
      l = Math.hypot(gx, gy, gz);
      h[0] = gx / l; h[1] = gy / l; h[2] = gz / l;
      // walk the grid cell by cell so trails stay connected
      for (let guard = 0; guard < 16 && p.alive; guard++) {
        const n = w.stepToward(d[0], d[1], d[2], p.cell);
        if (n === p.cell) break;
        this._enter(p, n);
      }
    }
  }

  // sorted standings (alive only)
  standings() {
    return this.players.filter((p) => p && p.alive).sort((a, b) => b.count - a.count);
  }
}
