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
const SPAWN_BUFFER = 9;    // clear cells between a new starting disc and any land or trail (players: double)

export class Game {
  constructor(world, rng = Math.random) {
    this.world = world;
    this.rng = rng;
    const V = world.V;
    this.owner = new Uint8Array(V);
    this.trail = new Uint8Array(V);
    this.capTime = new Float32Array(V).fill(-100);
    this.time = 0;
    this.rev = 0;   // bumped whenever land changes hands (multiplayer sync watches it)
    this.dirty = true;
    this.events = [];
    this._label = new Int32Array(V);
    this._queue = new Int32Array(V);
    this._stamp = new Int32Array(V);
    this._stampN = 0;
    this.winner = null;
    this.winAt = 0.995; // owning this share of the planet finishes the job (see _conquer)
    this.spawnStats = { full: 0, reduced: 0, waited: 0, forced: 0 };
    this._hurt = new Set(); // players who lost land since the last sweep
    this.players = [null];
    for (let id = 1; id <= MAX_PLAYERS; id++) {
      this.players.push({
        id, name: '', isBot: id !== HUMAN_ID, alive: false,
        pos: [0, 0, 1], h: [1, 0, 0], n: [0, 0, 1], tri: 0, near: 0, want: null, cell: 0,
        trailCells: [], count: 0, best: 0, kills: 0, pieces: 1,
        respawnAt: id === HUMAN_ID ? Infinity : 0.2 + id * 0.12, spawnTime: 0, ai: null,
      });
    }
  }

  pct(p) { return (p.count / this.world.V) * 100; }

  // Hand a bot's seat to a person joining over the network; returns the seat id (0 = full).
  claimSeat() {
    let seat = null;
    for (const p of this.players) {
      if (!p || !p.isBot) continue;
      if (!seat || (!p.alive && seat.alive) || (p.alive === seat.alive && p.count < seat.count)) seat = p;
    }
    if (!seat) return 0;
    if (seat.alive) this.kill(seat, null, true);
    seat.isBot = false; seat.ai = null; seat.respawnAt = Infinity;
    return seat.id;
  }

  // The person left: a bot takes over their seat (and their land, if they were mid-game).
  releaseSeat(id) {
    const p = this.players[id];
    if (!p || p.isBot || id === HUMAN_ID) return;
    p.isBot = true; p.want = null;
    if (p.alive) initBot(p, this.rng); else p.respawnAt = this.time + 2;
  }

  join(name, id = HUMAN_ID) {
    const p = this.players[id];
    if (p.alive) this.kill(p, null, true);
    p.name = name || 'You';
    this.spawn(p);
    return p;
  }

  // Distance (in cells) from every cell to the nearest claimed land or live trail.
  _crowding() {
    const w = this.world, V = w.V, N = w.nbr, dist = this._label, q = this._queue;
    let head = 0, tail = 0;
    for (let c = 0; c < V; c++) {
      if (this.owner[c] || this.trail[c]) { dist[c] = 0; q[tail++] = c; } else dist[c] = 1e6;
    }
    while (head < tail) {
      const c = q[head++], d = dist[c] + 1;
      for (let j = 0; j < 6; j++) {
        const n = N[c * 6 + j];
        if (n < 0) break;
        if (dist[n] > d) { dist[n] = d; q[tail++] = n; }
      }
    }
    return dist;
  }

  // Choose where a newcomer appears: never on or inside anyone's land, with a clear
  // buffer between the new starting disc and every territory, trail and player.
  // Returns -1 when the planet is too crowded (the caller waits and retries).
  _pickSpawn(force) {
    const w = this.world, V = w.V, rng = this.rng;
    const dist = this._crowding();
    let headGap = 0;
    const clearOfHeads = (c) => {
      for (const q of this.players) {
        if (!q || !q.alive) continue;
        if (w.cellsTo(q.pos, c) < headGap) return false;
      }
      return true;
    };
    // relax the buffer in stages rather than give up straight away on a busy planet
    for (const buffer of [SPAWN_BUFFER, SPAWN_BUFFER >> 1, 1]) {
      const need = START_RINGS + 1 + buffer;
      headGap = START_RINGS + 1 + buffer * 2;
      let best = -1, found = 0;
      for (let i = 0; i < 4000 && found < 8; i++) {
        const c = (rng() * V) | 0;
        if (dist[c] < need || !clearOfHeads(c)) continue;
        found++;
        if (best < 0 || dist[c] > dist[best]) best = c; // lean toward open ground
      }
      if (best < 0) {
        // random probing can miss a small pocket: scan everything before relaxing
        for (let c = 0; c < V; c++) {
          if (dist[c] >= need && (best < 0 || dist[c] > dist[best]) && clearOfHeads(c)) best = c;
        }
      }
      if (best >= 0) { this.spawnStats[buffer === SPAWN_BUFFER ? 'full' : 'reduced']++; return best; }
    }
    if (!force) { this.spawnStats.waited++; return -1; }
    // a human pressed Play: put them in the emptiest spot there is
    let best = 0;
    for (let c = 1; c < V; c++) if (dist[c] > dist[best]) best = c;
    this.spawnStats.forced++;
    return best;
  }

  spawn(p) {
    const w = this.world, rng = this.rng;
    const bestCell = this._pickSpawn(!p.isBot);
    if (bestCell < 0) return false;
    p.alive = true;
    p.trailCells.length = 0;
    p.count = 0; p.best = 0; p.kills = 0; p.pieces = 1;
    p.want = null;
    p.cell = bestCell;
    p.spawnTime = this.time;
    w.place(p, bestCell, rng);
    // claim a starting disc
    const q = this._queue, st = this._stamp, s = ++this._stampN, N = w.nbr;
    const reach = w.cellLen * (START_RINGS + 0.3);
    let head = 0, tail = 0, levelEnd = 1, depth = 0;
    q[tail++] = bestCell; st[bestCell] = s;
    while (head < tail) {
      if (head === levelEnd) { depth++; levelEnd = tail; if (depth > START_RINGS + 3) break; }
      const c = q[head++];
      if (!this.trail[c] && !this.owner[c]) this._setOwner(c, p, this.time + depth * 0.03);
      for (let j = 0; j < 6; j++) {
        const n = N[c * 6 + j];
        if (n < 0) break;
        if (st[n] === s) continue;
        st[n] = s;
        // keep the disc round rather than hexagonal
        if (w.dist(p.pos, n) <= reach) q[tail++] = n;
      }
    }
    if (p.isBot) {
      p.name = BOT_NAMES[(rng() * BOT_NAMES.length) | 0];
      initBot(p, rng);
    }
    this.dirty = true; this.rev++;
    this.events.push({ type: 'spawn', id: p.id });
    this._hurt.add(p.id);
    this._sweepEmpty(p);
    return true;
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
    // Annexed land may sit apart from the homeland, so a player is
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
    this.dirty = true; this.rev++;
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
    // the victor inherits the fallen player's land instead of it vanishing
    const annex = killer && killer !== victim && killer.alive;
    const w = this.world;
    let annexed = 0;
    for (let c = 0; c < V; c++) {
      if (this.owner[c] !== id) continue;
      if (annex) {
        this.owner[c] = killer.id;
        this.capTime[c] = this.time + Math.min(w.dist(victim.pos, c) * 1.4, 0.7);
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
    this.dirty = true; this.rev++;
    if (!silent) {
      this.events.push({
        type: 'death', id, name: victim.name, by: killer ? killer.id : 0,
        byName: killer ? killer.name : '', d: victim.pos.slice(), n: victim.n.slice(), best: victim.best, annexed,
      });
    }
  }

  capture(p) {
    const w = this.world, V = w.V, N = w.nbr;
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
        this._setOwner(c, p, now + Math.min(w.dist(p.pos, c) * 1.4, 0.55));
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
    this.dirty = true; this.rev++;
    this.events.push({ type: 'capture', id, gained: p.count - before, d: p.pos.slice(), n: p.n.slice() });
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

  // The last sliver of a planet can't be lassoed (there is no "outside" left to
  // close a loop against), so once a player holds effectively everything the
  // rest falls to them: every cell is theirs and the round is won at 100%.
  _conquer(p) {
    const w = this.world, V = w.V;
    this.winner = p;
    for (const q of this.players) if (q && q.alive && q !== p) this.kill(q, p);
    p.trailCells.length = 0;
    this.trail.fill(0);
    for (let c = 0; c < V; c++) {
      this.owner[c] = p.id;
      // a victory wave sweeps round the whole planet from the winner
      this.capTime[c] = this.time + w.dist(p.pos, c) * 0.5;
    }
    p.count = p.best = V;
    p.pieces = 1;
    p.want = null;
    this._hurt.clear();
    this.dirty = true; this.rev++;
    this.events.push({ type: 'win', id: p.id, name: p.name, d: p.pos.slice(), n: p.n.slice() });
  }

  step(dt) {
    this.time += dt;
    const w = this.world;
    if (this.winner) return; // round over: the world holds still for the celebration
    for (let id = 1; id <= MAX_PLAYERS; id++) {
      const q = this.players[id];
      if (q.alive && q.count >= w.V * this.winAt) { this._conquer(q); return; }
    }
    for (let id = 1; id <= MAX_PLAYERS; id++) {
      const p = this.players[id];
      if (!p.alive) {
        if (p.isBot && this.time >= p.respawnAt && !this.spawn(p)) p.respawnAt = this.time + 2;
        continue;
      }
      if (p.isBot) botThink(this, p);
      if (p.want) {
        const lim = TURN_RATE * dt;
        w.turn(p, Math.max(-lim, Math.min(lim, w.angleTo(p, p.want))));
      }
      w.move(p, SPEED * dt);
      // walk the grid cell by cell so trails stay connected
      const target = p.near, P = w.pos;
      for (let guard = 0; guard < 12 && p.alive && p.cell !== target; guard++) {
        let n = w.adjacent(p.cell, target) ? target : w.stepToward(P[target * 3], P[target * 3 + 1], P[target * 3 + 2], p.cell);
        if (n === p.cell) n = target; // no downhill step left: hop (rare, on badly stretched cells)
        this._enter(p, n);
      }
    }
  }

  // sorted standings (alive only)
  standings() {
    return this.players.filter((p) => p && p.alive).sort((a, b) => b.count - a.count);
  }
}
