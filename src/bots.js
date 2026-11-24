// Bot brains. Each bot loops: leave home -> trace a box -> come back, while
// watching for threats to its trail and for exposed enemy trails to cut.

let scratchV = 0, visit, parent, queue, visitN = 0;
function scratch(V) {
  if (scratchV !== V) {
    scratchV = V; visit = new Int32Array(V); parent = new Int32Array(V); queue = new Int32Array(V); visitN = 0;
  }
}

export function initBot(p, rng) {
  p.ai = {
    state: 'home', thinkAt: 0, exitAt: 0, planned: false,
    turnDir: rng() < 0.5 ? 1 : -1, legOut: 8, legSide: 8, mark: 0,
    bold: 0.55 + rng() * 0.95,     // loop size multiplier
    aggro: rng(),                  // how far it will go to cut a trail
    caution: 0.7 + rng() * 0.9,    // safety margin when threatened
    homeDist: 0,
  };
}

// Shortest grid path back to own land that never crosses our own trail.
function pathHome(game, p) {
  const w = game.world, N = w.nbr, id = p.id, owner = game.owner, trail = game.trail;
  scratch(w.V);
  const s = ++visitN;
  let head = 0, tail = 0, found = -1;
  queue[tail++] = p.cell; visit[p.cell] = s; parent[p.cell] = -1;
  while (head < tail && tail < 6000 && found < 0) {
    const c = queue[head++];
    for (let j = 0; j < 6; j++) {
      const n = N[c * 6 + j];
      if (n < 0) break;
      if (visit[n] === s || trail[n] === id) continue;
      visit[n] = s; parent[n] = c;
      if (owner[n] === id) { found = n; break; }
      queue[tail++] = n;
    }
  }
  if (found < 0) return { dist: 99, wp: -1 };
  const chain = [];
  for (let c = found; c !== -1; c = parent[c]) chain.push(c);
  const L = chain.length - 1;
  return { dist: L, wp: chain[Math.max(0, L - 4)] };
}

function cellsBetween(w, d, c) {
  const D = w.dirs;
  const dot = D[c * 3] * d[0] + D[c * 3 + 1] * d[1] + D[c * 3 + 2] * d[2];
  return Math.acos(Math.min(1, Math.max(-1, dot))) / w.cellAngle;
}

// nearest exposed enemy trail cell within `range` cells, or -1
function findPrey(game, p, range) {
  const w = game.world;
  let best = -1, bestD = range;
  for (const q of game.players) {
    if (!q || !q.alive || q === p) continue;
    const t = q.trailCells;
    if (t.length < 3) continue;
    for (let i = 0; i < t.length; i += 3) {
      const dd = cellsBetween(w, p.d, t[i]);
      if (dd < bestD) { bestD = dd; best = t[i]; }
    }
  }
  return best;
}

// how many cells away is the closest enemy from any part of our trail
function threatDistance(game, p) {
  const w = game.world, t = p.trailCells;
  let best = 999;
  for (const q of game.players) {
    if (!q || !q.alive || q === p) continue;
    let dd = cellsBetween(w, q.d, p.cell);
    if (dd > 60) continue;
    for (let i = 0; i < t.length; i += 4) dd = Math.min(dd, cellsBetween(w, q.d, t[i]));
    if (dd < best) best = dd;
  }
  return best;
}

function tangentTo(w, p, c) {
  const D = w.dirs;
  return [D[c * 3] - p.d[0], D[c * 3 + 1] - p.d[1], D[c * 3 + 2] - p.d[2]];
}

function left(p) {
  const d = p.d, h = p.h;
  return [d[1] * h[2] - d[2] * h[1], d[2] * h[0] - d[0] * h[2], d[0] * h[1] - d[1] * h[0]];
}

// would travelling along tangent direction `dir` run into our own trail soon?
function blocked(game, p, dir) {
  const w = game.world, d = p.d, t = p.trailCells, n = t.length;
  let x = dir[0], y = dir[1], z = dir[2];
  const k = x * d[0] + y * d[1] + z * d[2];
  x -= d[0] * k; y -= d[1] * k; z -= d[2] * k;
  const l = Math.hypot(x, y, z);
  if (l < 1e-6) return false;
  x /= l; y /= l; z /= l;
  let c = p.cell;
  for (let i = 1; i <= 4; i++) {
    const a = w.cellAngle * 1.3 * i, cs = Math.cos(a), sn = Math.sin(a);
    c = w.locate(d[0] * cs + x * sn, d[1] * cs + y * sn, d[2] * cs + z * sn, c);
    if (game.trail[c] === p.id && c !== t[n - 1] && c !== t[n - 2] && c !== t[n - 3]) return true;
  }
  return false;
}

function rotated(p, ang) {
  const h = p.h, l = left(p), cs = Math.cos(ang), sn = Math.sin(ang);
  return [h[0] * cs + l[0] * sn, h[1] * cs + l[1] * sn, h[2] * cs + l[2] * sn];
}

export function botThink(game, p) {
  const ai = p.ai, now = game.time, rng = game.rng, w = game.world;
  if (now < ai.thinkAt) return;
  ai.thinkAt = now + 0.09 + rng() * 0.05;
  const n = p.trailCells.length;

  if (n === 0) {
    // ---- safe at home ----
    if (ai.state !== 'home') {
      ai.state = 'home'; ai.planned = false; p.want = null;
      ai.exitAt = now + 0.1 + rng() * 0.8;
    }
    const prey = findPrey(game, p, 5 + 12 * ai.aggro);
    if (prey >= 0) { p.want = tangentTo(w, p, prey); ai.hunting = true; return; }
    ai.hunting = false;
    if (!ai.planned && now >= ai.exitAt) {
      ai.planned = true;
      p.want = rotated(p, (rng() - 0.5) * 2.8);
      ai.legOut = Math.round((5 + rng() * 13) * ai.bold);
      ai.legSide = Math.round((5 + rng() * 15) * ai.bold);
      ai.turnDir = rng() < 0.5 ? 1 : -1;
    } else if (ai.planned) {
      p.want = null; // straight on until we cross our border
    }
    return;
  }

  // ---- out on a trail ----
  if (ai.state === 'home') { ai.state = ai.hunting ? 'hunt' : 'out'; ai.mark = 0; p.want = null; }
  const home = pathHome(game, p);
  ai.homeDist = home.dist;

  if (ai.state !== 'return') {
    const threat = threatDistance(game, p);
    if (threat < home.dist + 2 + 4 * ai.caution || n > 70 * ai.bold + 20) ai.state = 'return';
  }

  if (ai.state === 'hunt' || (ai.state === 'out' && n < 14)) {
    const prey = findPrey(game, p, ai.state === 'hunt' ? 6 + 12 * ai.aggro : 3 + 6 * ai.aggro);
    if (prey >= 0) { ai.state = 'hunt'; p.want = tangentTo(w, p, prey); }
    else if (ai.state === 'hunt') ai.state = 'return';
  }

  if (ai.state === 'out') {
    p.want = null;
    if (n >= ai.legOut) { ai.state = 'side'; ai.mark = n; p.want = rotated(p, (ai.turnDir * Math.PI) / 2); }
  } else if (ai.state === 'side') {
    if (n - ai.mark >= 3) p.want = null;
    if (n - ai.mark >= ai.legSide) { ai.state = 'back'; ai.mark = n; p.want = rotated(p, (ai.turnDir * Math.PI) / 2); }
  } else if (ai.state === 'back') {
    if (n - ai.mark >= 3) p.want = null;
    if (n - ai.mark >= ai.legOut + 2) ai.state = 'return';
  }
  if (ai.state === 'return') {
    p.want = home.wp >= 0 ? tangentTo(w, p, home.wp) : null;
  }

  // last line of defence: never steer into our own trail
  const dir = p.want || p.h;
  if (blocked(game, p, dir)) {
    const s = ai.turnDir;
    for (const a of [0.6 * s, -0.6 * s, 1.2 * s, -1.2 * s, 1.9 * s, -1.9 * s]) {
      const cand = rotated(p, a);
      if (!blocked(game, p, cand)) { p.want = cand; break; }
    }
  }
}
