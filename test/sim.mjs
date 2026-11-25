// Headless soak test: bots only, checks invariants and reports how the AI fares.
import { World } from '../src/world.js';
import { Game, MAX_PLAYERS } from '../src/game.js';
let seed = 12345;
const rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
for (const shape of ['orb', 'pebble', 'dice', 'peanut']) {
  const w = new World(shape, 6);
  const g = new Game(w, rng);
  g.players[1].isBot = true; g.players[1].respawnAt = 0;
  const deaths = { self: 0, cut: 0 }; let severed = 0, captures = 0, t0 = Date.now(), maxPct = 0;
  // spawning must never take or touch anyone's land: measure the real gap each time
  let minGap = 1e9;
  const realSpawn = g.spawn.bind(g);
  g.spawn = (p) => {
    const before = g.owner.slice(), trailBefore = g.trail.slice();
    const ok = realSpawn(p);
    if (!ok) return ok;
    const D = w.dirs;
    for (let c = 0; c < w.V; c++) {
      if (before[c] && g.owner[c] !== before[c]) throw new Error('spawn took claimed land');
      if (!before[c] && !trailBefore[c]) continue;
      const dot = D[c * 3] * p.d[0] + D[c * 3 + 1] * p.d[1] + D[c * 3 + 2] * p.d[2];
      minGap = Math.min(minGap, Math.acos(Math.max(-1, Math.min(1, dot))) / w.cellAngle - 7.3);
    }
    return ok;
  };
  for (let i = 0; i < 60 * 240; i++) {
    g.step(1 / 60);
    for (const e of g.events) {
      if (e.type === 'death') e.by === e.id ? deaths.self++ : deaths.cut++;
      if (e.type === 'capture') captures++;
      if (e.type === 'severed') severed++;
    }
    g.events.length = 0;
    if (i % 600 === 0) {
      const counts = new Array(MAX_PLAYERS + 1).fill(0);
      for (let c = 0; c < w.V; c++) counts[g.owner[c]]++;
      for (let id = 1; id <= MAX_PLAYERS; id++) {
        const p = g.players[id];
        if (counts[id] !== p.count) throw new Error(`count mismatch p${id} ${counts[id]} vs ${p.count}`);
        if (!p.alive && counts[id]) throw new Error('dead player owns land');
        maxPct = Math.max(maxPct, g.pct(p));
      }
      // every territory must be a single connected piece
      const seen = new Uint8Array(w.V), pieces = new Array(MAX_PLAYERS + 1).fill(0);
      for (let s = 0; s < w.V; s++) {
        if (!g.owner[s] || seen[s]) continue;
        pieces[g.owner[s]]++;
        const st = [s]; seen[s] = 1;
        while (st.length) {
          const c = st.pop();
          for (let j = 0; j < 6; j++) { const n = w.nbr[c * 6 + j]; if (n >= 0 && !seen[n] && g.owner[n] === g.owner[s]) { seen[n] = 1; st.push(n); } }
        }
      }
      pieces.forEach((k, id) => { if (k > g.players[id]?.pieces) throw new Error(`p${id} territory split into ${k} pieces`); });
      for (let c = 0; c < w.V; c++) { const t = g.trail[c]; if (t && !g.players[t].alive) throw new Error('orphan trail'); }
    }
  }
  const top = g.standings().slice(0, 4).map((p) => `${p.name} ${g.pct(p).toFixed(1)}%`).join(', ');
  console.log(`${shape}: V=${w.V} ${Date.now() - t0}ms/240s  captures=${captures} severed=${severed} selfDeaths=${deaths.self} cuts=${deaths.cut} maxPct=${maxPct.toFixed(1)} spawns=${JSON.stringify(g.spawnStats)} minGap=${minGap.toFixed(1)} | ${top}`);
}
