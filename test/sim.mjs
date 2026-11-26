// Headless soak test: bots only, checks invariants and reports how the AI fares.
import { readFile } from 'node:fs/promises';
import { World, SHAPES, loadWorld } from '../src/world.js';
const read = async (key) => { const b = await readFile(new URL(`../worlds/${key}.bin`, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
import { Game, MAX_PLAYERS } from '../src/game.js';
let seed = 12345;
const rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const only = process.argv.slice(2);
for (const shape of Object.keys(SHAPES)) {
  if (only.length && !only.includes(shape)) continue;
  await loadWorld(shape, read);
  const w = new World(shape);
  const SECONDS = SHAPES[shape].r ? 240 : 120;
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
    for (let c = 0; c < w.V; c++) {
      if (before[c] && before[c] !== p.id && g.owner[c] === p.id) throw new Error('spawn took claimed land');
      if (!before[c] && !trailBefore[c]) continue;
      minGap = Math.min(minGap, w.cellsTo(p.pos, c) - 7.3);
    }
    return ok;
  };
  for (let i = 0; i < 60 * SECONDS; i++) {
    g.step(1 / 60);
    for (const q of g.players) {
      if (!q || !q.alive) continue;
      if (!Number.isFinite(q.pos[0] + q.pos[1] + q.pos[2] + q.h[0] + q.h[1] + q.h[2])) throw new Error(`${shape}: player position is not a number`);
      const T = w.tris, t = q.tri * 3;
      if (T[t] !== q.cell && T[t + 1] !== q.cell && T[t + 2] !== q.cell) throw new Error(`${shape}: player's cell is not under the player (t=${g.time.toFixed(1)})`);
    }
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
  console.log(`${shape.padEnd(10)} ${Date.now() - t0}ms/${SECONDS}s  captures=${captures} severed=${severed} selfDeaths=${deaths.self} cuts=${deaths.cut} maxPct=${maxPct.toFixed(1)} spawns=${JSON.stringify(g.spawnStats)} minGap=${minGap.toFixed(1)} | ${top}`);
}

// win path: lower the threshold so a bot gets there, then check the planet is fully theirs
{
  const w = new World('orb');
  const g = new Game(w, rng);
  g.players[1].isBot = true; g.players[1].respawnAt = 0;
  g.winAt = 0.25;
  let win = null;
  for (let i = 0; i < 60 * 900 && !win; i++) { g.step(1 / 60); win = g.events.find((e) => e.type === 'win') || null; g.events.length = 0; }
  if (!win) throw new Error('nobody won');
  const p = g.players[win.id];
  if (g.winner !== p || p.count !== w.V || g.pct(p) !== 100) throw new Error('winner does not own 100%');
  if (g.owner.some((o) => o !== p.id) || g.trail.some((t) => t)) throw new Error('planet not fully claimed');
  if (g.players.filter((q) => q && q.alive).length !== 1) throw new Error('rivals still alive');
  const t = g.time, d = p.pos.slice(); g.step(1 / 60);
  if (p.pos.some((v, i) => v !== d[i]) || g.time <= t) throw new Error('world should hold still after a win');
  console.log(`win: ${win.name} conquered the planet at t=${t.toFixed(0)}s -> 100.0%`);
}
