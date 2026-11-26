// Multiplayer plumbing. There is no game server: one player's browser hosts the
// authoritative simulation and friends connect to it directly over WebRTC data
// channels. PeerJS (vendored) is used only to introduce the browsers to each other.
import { MAX_PLAYERS } from './game.js';

const PREFIX = 'lasso-planet-v1-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no lookalikes (0/O, 1/I)
export const MAX_GUESTS = 7;
const FIELDS = 13; // per player: alive, position, heading, surface normal, trail length, land count, kills

export const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

let peerLib = null;
function loadPeer() {
  if (window.Peer) return Promise.resolve();
  if (!peerLib) {
    peerLib = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/peerjs.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('could not load the networking library'));
      document.head.append(s);
    });
  }
  return peerLib;
}

// `?signal=host:port` points at a self-hosted PeerServer instead of the public PeerJS cloud
function peerOptions(signal) {
  if (!signal) return {};
  const [host, port] = signal.split(':');
  const local = host === 'localhost' || host === '127.0.0.1';
  return { host, port: Number(port) || (local ? 9000 : 443), path: '/', secure: !local };
}

const explain = (err) => ({
  'peer-unavailable': 'No game found with that code.',
  'unavailable-id': 'That room code is taken, try again.',
  'network': 'Could not reach the matchmaking service.',
  'server-error': 'Could not reach the matchmaking service.',
  'browser-incompatible': 'This browser does not support peer-to-peer play.',
}[err?.type] || err?.message || 'Connection failed.');

export class Net {
  constructor(signal) {
    this.signal = signal;
    this.peer = null;
    this.role = '';            // 'host' | 'guest'
    this.code = '';
    this.conns = new Map();    // host: connection id -> DataConnection
    this.hostConn = null;      // guest: connection to the host
    this.onMessage = () => {}; // (msg, connId)
    this.onOpen = () => {};    // host: (connId)   guest: ()
    this.onClose = () => {};   // host: (connId)   guest: (reason)
  }

  get guests() { return this.conns.size; }

  async host() {
    await loadPeer();
    for (let attempt = 0; attempt < 4; attempt++) {
      let code = '';
      for (let i = 0; i < 5; i++) code += ALPHABET[(Math.random() * ALPHABET.length) | 0];
      try {
        this.peer = await this._open(PREFIX + code);
        this.code = code; this.role = 'host';
        this.peer.on('connection', (c) => this._accept(c));
        this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch { /* gone */ } });
        return code;
      } catch (err) {
        if (err?.type !== 'unavailable-id') throw new Error(explain(err));
      }
    }
    throw new Error('Could not create a room, try again.');
  }

  _open(id) {
    return new Promise((resolve, reject) => {
      const peer = id ? new window.Peer(id, peerOptions(this.signal)) : new window.Peer(peerOptions(this.signal));
      peer.once('open', () => resolve(peer));
      peer.once('error', (err) => { peer.destroy(); reject(err); });
    });
  }

  _accept(c) {
    c.on('open', () => {
      if (this.conns.size >= MAX_GUESTS) { c.send({ k: 'full' }); setTimeout(() => c.close(), 500); return; }
      this.conns.set(c.connectionId, c);
      c.lastSeen = performance.now();
      this.onOpen(c.connectionId);
    });
    c.on('data', (m) => { c.lastSeen = performance.now(); if (this.conns.has(c.connectionId)) this.onMessage(m, c.connectionId); });
    const gone = () => { if (this.conns.delete(c.connectionId)) this.onClose(c.connectionId); };
    c.on('close', gone);
    c.on('error', gone);
  }

  // host: drop guests that have gone silent (closed tab, lost signal)
  prune(now, maxSilenceMs = 9000) {
    for (const c of this.conns.values()) if (now - c.lastSeen > maxSilenceMs) c.close();
  }

  async join(code) {
    await loadPeer();
    try { this.peer = await this._open(); } catch (err) { throw new Error(explain(err)); }
    this.code = code; this.role = 'guest';
    return new Promise((resolve, reject) => {
      let open = false;
      const fail = (err) => { if (!open) { this.close(); reject(new Error(explain(err))); } };
      const c = this.peer.connect(PREFIX + code, { reliable: true });
      const timer = setTimeout(() => fail({ message: 'Timed out connecting. Your network may block peer-to-peer connections.' }), 15000);
      this.peer.on('error', fail);
      c.on('open', () => { open = true; clearTimeout(timer); this.hostConn = c; this.onOpen(); resolve(); });
      c.on('data', (m) => this.onMessage(m));
      const gone = () => { if (open && this.hostConn) { this.hostConn = null; this.onClose('The host left the game.'); } };
      c.on('close', gone);
      c.on('error', gone);
    });
  }

  send(msg) { if (this.hostConn?.open) this.hostConn.send(msg); }
  sendTo(id, msg) { const c = this.conns.get(id); if (c?.open) c.send(msg); }
  broadcast(msg) { for (const c of this.conns.values()) if (c.open) c.send(msg); }

  close() {
    try { this.peer?.destroy(); } catch { /* already closed */ }
    this.peer = null; this.hostConn = null; this.conns.clear(); this.role = '';
  }
}

// ---- wire format helpers -------------------------------------------------
// typed arrays arrive as ArrayBuffers (or byte views); normalise them
const bytes = (x) => (x instanceof ArrayBuffer ? x : x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength));
const f32 = (x) => new Float32Array(bytes(x));
const u16 = (x) => new Uint16Array(bytes(x));
const u8 = (x) => new Uint8Array(bytes(x));

export function packPlayers(game) {
  const a = new Float32Array(MAX_PLAYERS * FIELDS);
  for (let id = 1; id <= MAX_PLAYERS; id++) {
    const p = game.players[id], o = (id - 1) * FIELDS;
    a[o] = p.alive ? 1 : 0;
    a[o + 1] = p.pos[0]; a[o + 2] = p.pos[1]; a[o + 3] = p.pos[2];
    a[o + 4] = p.h[0]; a[o + 5] = p.h[1]; a[o + 6] = p.h[2];
    a[o + 7] = p.n[0]; a[o + 8] = p.n[1]; a[o + 9] = p.n[2];
    a[o + 10] = p.trailCells.length; a[o + 11] = p.count; a[o + 12] = p.kills;
  }
  return a;
}
const names = (game) => game.players.slice(1).map((p) => p.name);

// Host side: tracks what guests have already been told so only changed cells are sent.
export class HostSync {
  constructor(game) {
    this.game = game;
    this.owner = game.owner.slice();
    this.cap = game.capTime.slice();
    this.rev = game.rev;
    this.events = [];
  }

  init(seat) {
    const g = this.game;
    return {
      k: 'init', shape: g.world.shapeKey, you: seat, t: g.time, n: names(g), p: packPlayers(g),
      owner: g.owner.slice(), cap: g.capTime.slice(),
      trails: g.players.slice(1).map((p) => (p.alive ? p.trailCells.slice() : [])),
      won: g.winner ? g.winner.id : 0,
    };
  }

  // one state message per network tick
  snapshot() {
    const g = this.game, msg = { k: 's', t: g.time, p: packPlayers(g) };
    if (g.rev !== this.rev) {
      this.rev = g.rev;
      const V = g.world.V, idx = [];
      for (let c = 0; c < V; c++) {
        if (g.owner[c] !== this.owner[c] || g.capTime[c] !== this.cap[c]) {
          idx.push(c); this.owner[c] = g.owner[c]; this.cap[c] = g.capTime[c];
        }
      }
      if (idx.length) {
        const ci = Uint16Array.from(idx), co = new Uint8Array(idx.length), ct = new Float32Array(idx.length);
        for (let i = 0; i < idx.length; i++) { co[i] = g.owner[idx[i]]; ct[i] = g.capTime[idx[i]]; }
        msg.ci = ci; msg.co = co; msg.ct = ct;
      }
    }
    if (this.events.length) { msg.e = this.events; msg.n = names(g); this.events = []; }
    return msg;
  }
}

// Guest side: mirrors the host's game into a local Game object that is never stepped,
// and smooths movement by interpolating between the two most recent snapshots.
export class GuestSync {
  constructor(game, init) {
    this.game = game;
    game.owner.set(u8(init.owner));
    game.capTime.set(f32(init.cap));
    game.time = init.t;
    game.dirty = true;
    if (init.won) game.winner = game.players[init.won];
    this.a = this.b = { t: init.t, p: f32(init.p), at: performance.now() };
    this._names(init.n);
    this._players(this.b.p, this.b.p, 1);
    init.trails.forEach((cells, i) => { game.players[i + 1].trailCells.length = cells.length; });
  }

  _names(n) { if (n) n.forEach((name, i) => { this.game.players[i + 1].name = name; }); }

  receive(msg) {
    const g = this.game;
    this.a = this.b;
    this.b = { t: msg.t, p: f32(msg.p), at: performance.now() };
    if (msg.ci) {
      const ci = u16(msg.ci), co = u8(msg.co), ct = f32(msg.ct);
      for (let i = 0; i < ci.length; i++) { g.owner[ci[i]] = co[i]; g.capTime[ci[i]] = ct[i]; }
      g.dirty = true;
    }
    this._names(msg.n);
    if (msg.e) for (const e of msg.e) { if (e.type === 'win') g.winner = g.players[e.id]; g.events.push(e); }
  }

  _players(A, B, k) {
    const g = this.game;
    for (let id = 1; id <= MAX_PLAYERS; id++) {
      const p = g.players[id], o = (id - 1) * FIELDS;
      const alive = B[o] > 0.5;
      if (alive && !p.alive) p.spawnTime = g.time;
      p.alive = alive;
      p.trailCells.length = B[o + 10]; p.count = B[o + 11]; p.kills = B[o + 12];
      if (p.count > p.best) p.best = p.count;
      if (!alive) { p.best = 0; continue; }
      // blend only while the two samples describe the same continuous path
      const same = A[o] > 0.5 && Math.hypot(A[o + 1] - B[o + 1], A[o + 2] - B[o + 2], A[o + 3] - B[o + 3]) < 0.15;
      for (const [vec, at, unit] of [[p.pos, 1, false], [p.h, 4, true], [p.n, 7, true]]) {
        let x = B[o + at], y = B[o + at + 1], z = B[o + at + 2];
        if (same) {
          x = A[o + at] + (x - A[o + at]) * k; y = A[o + at + 1] + (y - A[o + at + 1]) * k; z = A[o + at + 2] + (z - A[o + at + 2]) * k;
        }
        const l = unit ? Math.hypot(x, y, z) || 1 : 1;
        vec[0] = x / l; vec[1] = y / l; vec[2] = z / l;
      }
    }
  }

  // call every frame
  frame(now) {
    const a = this.a, b = this.b, span = Math.max(1, (b.t - a.t) * 1000);
    const k = Math.min(1.3, (now - b.at) / span); // a little extrapolation hides jitter
    this.game.time = a.t + (b.t - a.t) * Math.min(k, 1);
    this._players(a.p, b.p, k);
  }
}
