// Headless soak test: bots only, checks invariants and reports how the AI fares.
import { World } from '../src/world.js';
import { Game, MAX_PLAYERS } from '../src/game.js';
let seed = 12345;
const rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
for (const mode of ['classic', 'imperial']) for (const shape of ['orb', 'pebble', 'dice', 'peanut']) {
  const w = new World(shape, 6);
  const g = new Game(w, rng, mode);
  g.players[1].isBot = true; g.players[1].respawnAt = 0;
  const deaths = { self: 0, cut: 0 }; let severed = 0, captures = 0, t0 = Date.now(), maxPct = 0;
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
      pieces.forEach((k, id) => { if (k > (mode === 'classic' ? 1 : g.players[id]?.pieces)) throw new Error(`p${id} territory split into ${k} pieces`); });
      for (let c = 0; c < w.V; c++) { const t = g.trail[c]; if (t && !g.players[t].alive) throw new Error('orphan trail'); }
    }
  }
  const top = g.standings().slice(0, 4).map((p) => `${p.name} ${g.pct(p).toFixed(1)}%`).join(', ');
  console.log(`${mode} ${shape}: V=${w.V} ${Date.now() - t0}ms/240s  captures=${captures} severed=${severed} selfDeaths=${deaths.self} cuts=${deaths.cut} maxPct=${maxPct.toFixed(1)} | ${top}`);
}
