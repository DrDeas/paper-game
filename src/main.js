import { World, SHAPES, loadWorld } from './world.js';
import { Game, HUMAN_ID } from './game.js';
import { View, THREE, hex } from './view.js';
import { sfx, unlockAudio } from './audio.js';
import { Net, HostSync, GuestSync, cleanCode, MAX_GUESTS } from './net.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const view = new View($('scene'));
let world, game, me;
let myId = HUMAN_ID;      // which seat this browser controls (differs when joining someone's game)
let role = 'solo';        // 'solo' | 'host' | 'guest'
let shapeKey = params.get('shape') || store.get('lp.shape', 'orb');
if (!SHAPES[shapeKey]) shapeKey = 'orb';
let playZoom = Number(params.get('zoom') ?? store.get('lp.zoom', 0.3));
let best = Number(store.get('lp.best', 0));
let playing = false, startedAt = 0;

function buildWorld(key) {
  shapeKey = key;
  store.set('lp.shape', key);
  world = new World(key); // its data must already be loaded (see selectShape / loadWorld)
  game = new Game(world);
  me = game.players[myId];
  view.setWorld(world, game);
  if (role === 'host') rehost();
  markShape(key);
  if (window.__lp) Object.assign(window.__lp, { game, world });
}

// ---- world picker: an endless swipeable row ----
// The list is laid out several times over and the scroll position is quietly moved
// back to the middle copy whenever it comes to rest, so it never reaches an end.
const strip = $('shapes');
const COPIES = 5, MID = (COPIES - 1) / 2, shapeKeys = Object.keys(SHAPES);
let stripDragged = false, stripHeld = false, stripShift = 0, stripIdle = 0;
for (let copy = 0; copy < COPIES; copy++) {
  for (const k of shapeKeys) {
    const s = SHAPES[k], b = document.createElement('button');
    b.innerHTML = `<span class="ico">${s.icon}</span><span>${s.name}</span>`;
    b.dataset.k = k; b.setAttribute('role', 'option');
    if (copy !== MID) { b.tabIndex = -1; b.setAttribute('aria-hidden', 'true'); } // keyboard and screen readers see one list
    b.onclick = () => { if (!stripDragged) selectShape(k); };
    b.onpointerenter = () => { loadWorld(k).catch(() => {}); }; // warm it up before the click
    strip.append(b);
  }
}
const chipsFor = (key) => [...strip.children].filter((b) => b.dataset.k === key);
const setWidth = () => strip.children[shapeKeys.length].offsetLeft - strip.children[0].offsetLeft;
// jump by whole list-lengths (the copies are identical, so the jump cannot be seen)
function stripWrap(toMiddle) {
  const w = setWidth();
  if (!w) return;
  const x = strip.scrollLeft;
  let sets = 0;
  if (toMiddle) sets = MID - Math.floor((x + strip.clientWidth / 2) / w);   // re-centre on the middle copy
  else if (x < w * 0.5) sets = 1;                                           // safety net near either end
  else if (x > w * (COPIES - 1.5) - strip.clientWidth) sets = -1;
  if (!sets) return;
  const snap = strip.style.scrollSnapType, smooth = strip.style.scrollBehavior;
  strip.style.scrollSnapType = 'none'; strip.style.scrollBehavior = 'auto';
  strip.scrollLeft = x + sets * w;
  strip.style.scrollSnapType = snap; strip.style.scrollBehavior = smooth;
  stripShift += sets * w;
}
strip.addEventListener('scroll', () => {
  stripWrap(false);
  clearTimeout(stripIdle);
  stripIdle = setTimeout(() => { if (!stripHeld) stripWrap(true); }, 140);
}, { passive: true });
function markShape(key, smooth = true) {
  for (const b of strip.children) {
    const on = b.dataset.k === key;
    b.classList.toggle('on', on); b.setAttribute('aria-selected', on);
  }
  if (!smooth) stripWrap(true);
  // glide to whichever copy of the chosen tile is closest to what is on screen
  const centre = strip.scrollLeft + strip.clientWidth / 2;
  let best = null, bestD = Infinity;
  for (const b of chipsFor(key)) {
    const d = Math.abs(b.offsetLeft + b.offsetWidth / 2 - centre);
    if (d < bestD) { bestD = d; best = b; }
  }
  if (best) strip.scrollTo({ left: best.offsetLeft - (strip.clientWidth - best.offsetWidth) / 2, behavior: smooth ? 'smooth' : 'auto' });
}
$('shapePrev').hidden = false;
$('shapePrev').onclick = () => strip.scrollBy({ left: -strip.clientWidth * 0.75, behavior: 'smooth' });
$('shapeNext').onclick = () => strip.scrollBy({ left: strip.clientWidth * 0.75, behavior: 'smooth' });
// mouse users can grab and fling the row too (touch scrolls natively)
strip.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse') return;
  const x0 = e.clientX, s0 = strip.scrollLeft;
  stripDragged = false; stripHeld = true; stripShift = 0;
  const moveTo = (ev) => {
    if (Math.abs(ev.clientX - x0) > 6) { stripDragged = true; strip.classList.add('dragging'); }
    if (stripDragged) strip.scrollLeft = s0 + stripShift - (ev.clientX - x0); // stripShift: wraps made mid-drag
  };
  const up = () => {
    removeEventListener('pointermove', moveTo); removeEventListener('pointerup', up);
    strip.classList.remove('dragging'); stripHeld = false;
    setTimeout(() => { stripDragged = false; }, 0); // let the click that follows a drag be ignored
  };
  addEventListener('pointermove', moveTo); addEventListener('pointerup', up);
});
$('name').value = store.get('lp.name', '');

// switch planet from the menu: fetch its data first, keep showing the old one meanwhile
let wantShape = shapeKey;
async function selectShape(k) {
  if (playing || role === 'guest' || !SHAPES[k]) return;
  wantShape = k;
  const chips = chipsFor(k);
  for (const c of chips) c.classList.add('loading');
  try { await loadWorld(k); } catch { return; } finally { for (const c of chips) c.classList.remove('loading'); }
  if (wantShape === k && !playing && role !== 'guest' && world.shapeKey !== k) buildWorld(k);
  else if (wantShape === k) markShape(world.shapeKey);
}

try { await loadWorld(shapeKey); } catch { shapeKey = 'orb'; }
buildWorld(shapeKey);
// start on the middle copy (layout must exist first)
strip.scrollLeft = setWidth() * MID;
markShape(shapeKey, false);
window.__lp = { game, world, view };

function start() {
  unlockAudio();
  $('banner').hidden = true; party = 0;
  const name = $('name').value.trim() || 'You';
  store.set('lp.name', $('name').value.trim());
  if (role === 'guest') {
    joinPending = true; guestWant = null;
    net.send({ k: 'join', name }); // the host spawns us
  } else {
    if (game.winner) buildWorld(shapeKey); // the last planet was conquered: start a fresh one
    game.join(name);
  }
  playing = true; startedAt = game.time;
  view.zoomTarget = view.inXR ? xrZoom : playZoom;
  $('menu').classList.add('hide');
  $('hud').hidden = false;
  $('name').blur();
  sfx.start();
}
$('play').onclick = start;
$('name').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') start(); });

function gameOver(e) {
  playing = false;
  const peak = (e.best / world.V) * 100;
  if (peak > best) { best = peak; store.set('lp.best', best.toFixed(2)); }
  $('result').hidden = false;
  $('resultTitle').classList.remove('won');
  $('resultTitle').textContent = e.by === e.id ? 'You crossed your own line!' : e.byName ? `${e.byName} cut your line!` : 'Unravelled!';
  $('statPct').textContent = peak.toFixed(1) + '%';
  $('statKills').textContent = me.kills;
  $('statTime').textContent = Math.round(game.time - startedAt) + 's';
  $('play').textContent = 'Play again';
  lastResult = $('resultTitle').textContent;
  setTimeout(() => { if (!playing && !game.winner) { $('menu').classList.remove('hide'); $('hud').hidden = true; } }, 900);
}
let lastResult = '';

// someone owns 100% of the planet
let party = 0, partyAt = 0;
function planetWon(e) {
  const mine = e.id === myId;
  playing = false;
  if (mine) { best = 100; store.set('lp.best', '100'); sfx.victory(); party = 9; }
  else sfx.death();
  lastResult = mine ? 'You conquered the planet!' : `${e.name} conquered the planet!`;
  $('banner').classList.toggle('lost', !mine);
  $('bannerTitle').textContent = mine ? 'Planet conquered!' : 'Planet lost';
  $('bannerSub').textContent = mine ? '100% — every last patch is yours' : `${e.name} took 100% of the planet`;
  $('banner').hidden = false;
  $('result').hidden = false;
  $('resultTitle').textContent = lastResult;
  $('resultTitle').classList.toggle('won', mine);
  if (mine) {
    $('statPct').textContent = '100%';
    $('statKills').textContent = me.kills;
    $('statTime').textContent = Math.round(game.time - startedAt) + 's';
  }
  $('play').textContent = 'Play again';
  $('hud').hidden = true;
  view.zoomTarget = view.inXR ? Math.max(view.zoomTarget, 0.8) : 1; // pull back to admire it
  const won = game;
  setTimeout(() => { if (game === won && game.winner) { $('banner').hidden = true; $('menu').classList.remove('hide'); } }, mine ? 8500 : 3500);
}
function celebrate(dt) {
  if (party <= 0) return;
  party -= dt; partyAt -= dt;
  if (partyAt > 0) return;
  partyAt = 0.08;
  // fireworks popping all over the planet in every player colour
  const v = ((Math.random() * world.V) | 0) * 3;
  view.burst(world.pos.subarray(v, v + 3), world.normals.subarray(v, v + 3), 1 + ((Math.random() * 12) | 0), 60, 0.32);
}

// ---------------------------------------------------------------- multiplayer
// One browser hosts the real simulation; guests send steering and render the
// host's state. See net.js for the wire format.
const net = new Net(params.get('signal'));
const seats = new Map(); // host: connection id -> seat
let adopting = null; // guest: updates queued while a new planet's shape downloads
let hostSync = null, guestSync = null, joinPending = false, guestWant = null, netAt = 0, pruneAt = 0;

function mpShow(which, hint = '') {
  for (const id of ['mpIdle', 'mpJoin', 'mpLive']) $(id).hidden = id !== which;
  $('mpHint').textContent = hint;
}
function mpLive() {
  mpShow('mpLive');
  $('mpLabel').textContent = role === 'host' ? 'Your room' : 'Joined room';
  $('mpCode').textContent = net.code;
  $('copyLink').hidden = role !== 'host';
  const n = seats.size + 1;
  $('mpCount').textContent = role === 'host' ? (n === 1 ? 'waiting for friends…' : `${n} people connected`) : 'connected';
  for (const b of $('shapes').children) b.disabled = role === 'guest';
}
const inviteLink = () => {
  const u = new URL(location.origin + location.pathname);
  u.searchParams.set('room', net.code);
  if (params.get('signal')) u.searchParams.set('signal', params.get('signal'));
  return u.href;
};
const vec3 = (w) => (Array.isArray(w) && w.length === 3 && w.every(Number.isFinite) ? [w[0], w[1], w[2]] : null);

// (re)introduce every connected guest to the current planet
function rehost() {
  hostSync = new HostSync(game);
  for (const [cid, seat] of seats) {
    const p = game.players[seat];
    p.isBot = false; p.ai = null; p.respawnAt = Infinity;
    net.sendTo(cid, hostSync.init(seat));
  }
}

async function hostGame() {
  mpShow('', 'Creating a room…');
  try { await net.host(); } catch (err) { net.close(); mpShow('mpIdle', err.message); return; }
  role = 'host';
  hostSync = new HostSync(game);
  net.onOpen = (cid) => {
    const seat = game.claimSeat();
    if (!seat) { net.sendTo(cid, { k: 'full' }); return; }
    if (!seats.size) hostSync = new HostSync(game);
    seats.set(cid, seat);
    net.sendTo(cid, hostSync.init(seat));
    mpLive();
  };
  net.onClose = (cid) => {
    const seat = seats.get(cid);
    seats.delete(cid);
    if (seat) game.releaseSeat(seat);
    mpLive();
  };
  net.onMessage = (m, cid) => {
    const seat = seats.get(cid);
    if (!seat || !m) return;
    if (m.k === 'i') game.players[seat].want = vec3(m.w);
    else if (m.k === 'join') {
      if (game.winner) buildWorld(shapeKey); // anyone can kick off the next planet
      game.join(String(m.name || 'Guest').slice(0, 14), seat);
    }
  };
  mpLive();
}

async function joinGame(raw) {
  const code = cleanCode(raw);
  if (code.length !== 5) { mpShow('mpJoin', 'Room codes are 5 characters.'); return; }
  mpShow('', `Connecting to ${code}…`);
  net.onOpen = () => {};
  net.onMessage = (m) => {
    if (!m) return;
    if (m.k === 'init') { // a (new) planet: load its shape, holding later updates until it is up
      const q = (adopting = []);
      loadWorld(m.shape).then(() => {
        if (adopting !== q) return; // superseded by a newer planet
        adopt(m);
        adopting = null;
        for (const later of q) guestSync.receive(later);
      }, () => goSolo('Could not load that world.'));
    } else if (m.k === 's') { if (adopting) adopting.push(m); else guestSync?.receive(m); }
    else if (m.k === 'full') goSolo(`That game is full (${MAX_GUESTS + 1} people).`);
  };
  net.onClose = (reason) => goSolo(reason);
  try { await net.join(code); } catch (err) { net.close(); mpShow('mpIdle', err.message); }
}

// guest: the host told us about (a new) planet
function adopt(m) {
  role = 'guest';
  myId = m.you;
  world = new World(m.shape);
  game = new Game(world);
  me = game.players[myId];
  view.setWorld(world, game);
  guestSync = new GuestSync(game, m);
  m.trails.forEach((cells, i) => view.seedTrail(i + 1, cells));
  markShape(m.shape);
  Object.assign(window.__lp, { game, world });
  $('banner').hidden = true; party = 0;
  if (joinPending) startedAt = game.time;
  else { playing = false; $('menu').classList.remove('hide'); $('hud').hidden = true; }
  mpLive();
}

function goSolo(hint = '') {
  const was = role;
  net.close();
  for (const seat of seats.values()) game.releaseSeat(seat);
  seats.clear();
  role = 'solo'; guestSync = null; hostSync = null; joinPending = false; adopting = null;
  for (const b of $('shapes').children) b.disabled = false;
  if (was === 'guest' || myId !== HUMAN_ID) {
    myId = HUMAN_ID; playing = false;
    buildWorld(shapeKey);
    $('menu').classList.remove('hide'); $('hud').hidden = true;
  }
  mpShow('mpIdle', hint);
}

$('hostBtn').onclick = hostGame;
$('joinBtn').onclick = () => { mpShow('mpJoin'); $('code').focus(); };
$('joinCancel').onclick = () => mpShow('mpIdle');
$('joinGo').onclick = () => joinGame($('code').value);
$('code').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') joinGame($('code').value); });
$('leave').onclick = () => goSolo();
$('copyLink').onclick = async () => {
  const link = inviteLink();
  try { await navigator.clipboard.writeText(link); $('mpHint').textContent = 'Invite link copied. Send it to your friends.'; }
  catch { $('mpHint').textContent = link; }
};
if (params.get('room')) joinGame(params.get('room'));

// With guests connected the host must keep real time even when its own frame rate
// dips, so it catches up in small fixed steps instead of slowing the world down.
function hostStep(seconds) {
  for (let left = seconds; left > 1e-4; left -= 1 / 30) game.step(Math.min(1 / 30, left));
}
function hostNet(now) {
  if (now < netAt) return;
  netAt = now + 33;
  if (net.guests) net.broadcast(hostSync.snapshot());
  if (now > pruneAt) { pruneAt = now + 1000; net.prune(now); }
}
// keep the game running for guests while this tab is hidden or starved of frames (timers still tick)
setInterval(() => {
  if (role === 'guest') {
    net.send({ k: 'h' });
    if (performance.now() - guestSync.b.at > 8000) goSolo('Lost the connection to the host.');
    return;
  }
  const now = performance.now();
  if (role !== 'host' || !net.guests || now - last < 300) return;
  hostStep(Math.min(1.5, (now - last) / 1000));
  last = now;
  handleEvents();
  netAt = 0; hostNet(now);
}, 250);

// ---------------------------------------------------------------- input
const keys = new Set();
let pointerActive = false, pointerSteer = false;
const ndc = new THREE.Vector2();
const ray = new THREE.Raycaster();
const touches = new Map();
let pinch = 0;

const setZoom = (z) => {
  view.zoomTarget = Math.max(0, Math.min(1, z));
  if (playing) { if (view.inXR) xrZoom = view.zoomTarget; else { playZoom = view.zoomTarget; store.set('lp.zoom', playZoom.toFixed(2)); } }
};
const toggleZoom = () => setZoom(view.zoomTarget > 0.6 ? (view.inXR ? 0 : 0.3) : 1);

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'Space') { e.preventDefault(); if (playing) toggleZoom(); else start(); }
  if (e.code.startsWith('Arrow') || 'KeyW KeyA KeyS KeyD'.includes(e.code)) pointerSteer = false;
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
addEventListener('resize', () => view.resize());

const canvas = $('scene');
const setNdc = (e) => { ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); pointerActive = pointerSteer = true; };
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (touches.size >= 2) {
      const [a, b] = [...touches.values()];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) setZoom(view.zoomTarget + (pinch - dist) * 0.004);
      pinch = dist;
      return;
    }
  }
  setNdc(e);
});
canvas.addEventListener('pointerdown', (e) => {
  unlockAudio();
  if (e.pointerType === 'touch') { touches.set(e.pointerId, [e.clientX, e.clientY]); pinch = 0; if (touches.size > 1) return; }
  setNdc(e);
});
const endTouch = (e) => { touches.delete(e.pointerId); pinch = 0; };
canvas.addEventListener('pointerup', endTouch);
canvas.addEventListener('pointercancel', endTouch);
addEventListener('wheel', (e) => {
  if (e.target.closest?.('#shapes')) { // over the world picker: scroll it sideways
    e.preventDefault();
    strip.scrollLeft += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    return;
  }
  if (!playing && e.target.closest?.('.card')) return; // let the menu scroll normally
  e.preventDefault();
  setZoom(view.zoomTarget + e.deltaY * 0.0011);
}, { passive: false });
$('zoomIn').onclick = () => setZoom(view.zoomTarget - 0.25);
$('zoomOut').onclick = () => setZoom(view.zoomTarget + 0.25);

function desktopInput(dt) {
  let x = 0, y = 0;
  if (keys.has('ArrowLeft') || keys.has('KeyA')) x -= 1;
  if (keys.has('ArrowRight') || keys.has('KeyD')) x += 1;
  if (keys.has('ArrowUp') || keys.has('KeyW')) y += 1;
  if (keys.has('ArrowDown') || keys.has('KeyS')) y -= 1;
  if (keys.has('KeyQ') || keys.has('Minus')) setZoom(view.zoomTarget + dt * 0.8);
  if (keys.has('KeyE') || keys.has('Equal')) setZoom(view.zoomTarget - dt * 0.8);
  for (const gp of navigator.getGamepads ? navigator.getGamepads() : []) {
    if (!gp || gp.axes.length < 2) continue;
    if (Math.hypot(gp.axes[0], gp.axes[1]) > 0.35) { x = gp.axes[0]; y = -gp.axes[1]; pointerSteer = false; }
    if (gp.axes.length >= 4 && Math.abs(gp.axes[3]) > 0.25) setZoom(view.zoomTarget + gp.axes[3] * dt * 0.8);
  }
  if (x || y) return view.headingFromStick(x, y);
  if (pointerSteer && pointerActive) {
    ray.setFromCamera(ndc, view.camera);
    return view.headingFromRay(ray.ray.origin, ray.ray.direction);
  }
  return undefined; // keep current heading
}

// ---------------------------------------------------------------- headsets
const xr = view.renderer.xr;
let xrZoom = 0.8, calibrate = 0, xrMode = '';
const controllers = [0, 1].map((i) => {
  const c = xr.getController(i);
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
  line.scale.z = 2.5;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.07, 12), new THREE.MeshBasicMaterial({ color: 0xffc531 }));
  tip.rotation.x = -Math.PI / 2;
  c.add(line, tip);
  c.userData = { src: null, selecting: false, prev: [], line };
  c.addEventListener('connected', (e) => { c.userData.src = e.data; c.visible = true; });
  c.addEventListener('disconnected', () => { c.userData.src = null; c.userData.selecting = false; c.visible = false; });
  c.addEventListener('selectstart', () => { c.userData.selecting = true; unlockAudio(); if (!playing) start(); });
  c.addEventListener('selectend', () => { c.userData.selecting = false; });
  c.visible = false;
  view.scene.add(c);
  return c;
});

async function enterXR(mode) {
  unlockAudio();
  try {
    const session = await navigator.xr.requestSession(mode, { optionalFeatures: ['local-floor'] });
    xrMode = mode;
    xr.setReferenceSpaceType('local-floor');
    try { await xr.setSession(session); }
    catch { xr.setReferenceSpaceType('local'); await xr.setSession(session); }
  } catch (err) {
    $('xrHint').textContent = 'Could not start the headset session: ' + (err?.message || err);
  }
}
xr.addEventListener('sessionstart', () => {
  calibrate = 12;
  view.backdrop.visible = xrMode !== 'immersive-ar';
  view.panel.visible = true;
  xrZoom = xrMode === 'immersive-ar' ? 1 : 0.8;
  view.zoomTarget = xrZoom;
  if (!playing) start();
});
xr.addEventListener('sessionend', () => {
  view.stage.position.set(0, 0, 0); view.stage.rotation.set(0, 0, 0);
  view.backdrop.visible = true; view.panel.visible = false;
  view.zoomTarget = playing ? playZoom : 1;
  for (const c of controllers) c.userData.selecting = false;
  view.resize();
});
$('vr').onclick = () => enterXR('immersive-vr');
$('ar').onclick = () => enterXR('immersive-ar');
if (navigator.xr) {
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => { $('vr').hidden = !ok; if (!ok) noXR(); }).catch(noXR);
  navigator.xr.isSessionSupported('immersive-ar').then((ok) => { $('ar').hidden = !ok; }).catch(() => {});
} else noXR();
function noXR() { $('xrHint').textContent = 'Open this page in a headset browser (Quest, Pico, Vision Pro…) to step inside.'; }

// put the play space in front of wherever the wearer is actually sitting or standing
function recentre() {
  const cam = view.camera;
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  view.stage.rotation.set(0, Math.atan2(-f.x, -f.z), 0);
  view.stage.position.set(cam.position.x, cam.position.y - 1.6, cam.position.z);
}

const _o = new THREE.Vector3(), _d = new THREE.Vector3();
function xrInput(dt) {
  let want;
  for (const c of controllers) {
    const u = c.userData, src = u.src;
    if (!src) continue;
    const gp = src.gamepad;
    if (gp) {
      const ax = gp.axes.length >= 4 ? gp.axes[2] : gp.axes[0] || 0;
      const ay = gp.axes.length >= 4 ? gp.axes[3] : gp.axes[1] || 0;
      if (src.handedness === 'left') {
        if (Math.abs(ay) > 0.25) setZoom(view.zoomTarget + ay * dt * 0.7);
      } else if (Math.hypot(ax, ay) > 0.35) want = view.headingFromStick(ax, -ay);
      const pressed = gp.buttons.map((b) => b.pressed);
      if (pressed[4] && !u.prev[4]) toggleZoom();
      if (pressed[5] && !u.prev[5]) recentre();
      u.prev = pressed;
    }
  }
  for (const c of controllers) {
    if (!c.userData.selecting) continue;
    _o.setFromMatrixPosition(c.matrixWorld);
    _d.set(0, 0, -1).transformDirection(c.matrixWorld);
    const h = view.headingFromRay(_o, _d);
    if (h) want = h;
  }
  return want;
}

// ---------------------------------------------------------------- HUD
let hudAt = 0, toastTimer = 0;
function toast(text, color) {
  const t = $('toast');
  t.textContent = text; t.style.color = color || '#fff';
  t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
}
function feed(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  $('feed').append(d);
  setTimeout(() => d.remove(), 4000);
  while ($('feed').children.length > 4) $('feed').firstChild.remove();
}
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function updateHud() {
  const st = game.standings();
  const rows = st.slice(0, 5);
  if (me.alive && !rows.includes(me)) rows.push(me);
  const fmt = (p) => game.pct(p).toFixed(1) + '%';
  if (!$('hud').hidden) {
    $('board').innerHTML = rows.map((p) =>
      `<li class="${p === me ? 'me' : ''}" style="background:${hex(p.id)}"><i>${st.indexOf(p) + 1}</i><span>${esc(p.name)}</span>${fmt(p)}</li>`).join('');
    const pct = me.alive ? game.pct(me) : 0;
    const scale = Math.max(10, Math.ceil(Math.max(pct, best) / 10) * 10);
    $('barFill').style.width = (pct / scale) * 100 + '%';
    $('bestMark').style.left = (Math.min(best, scale) / scale) * 100 + '%';
    $('bestMark').hidden = best <= 0;
    $('pctText').textContent = pct.toFixed(1) + '%';
    $('bestText').textContent = Math.max(best, pct).toFixed(1) + '%';
  }
  if (view.inXR) {
    view.drawPanel({
      title: me.alive ? fmt(me) : 'Lasso Planet',
      sub: 'best ' + Math.max(best, me.alive ? game.pct(me) : 0).toFixed(1) + '%',
      rows: rows.map((p) => ({ rank: st.indexOf(p) + 1, name: p.name, pct: fmt(p), color: hex(p.id), me: p === me })),
      message: playing ? '' : game.winner ? lastResult + '  Trigger: new planet' : (lastResult ? lastResult + '  ' : '') + 'Pull the trigger to play',
    });
  }
}

function handleEvents() {
  if (role === 'host' && net.guests) hostSync.events.push(...game.events);
  for (const e of game.events) {
    if (e.type === 'capture') {
      if (e.id === myId) {
        sfx.capture(e.gained);
        view.burst(e.d, e.n, e.id, Math.min(60, 10 + e.gained / 8), 0.1);
        const gain = (e.gained / world.V) * 100;
        if (gain >= 0.1) toast('+' + gain.toFixed(1) + '%', hex(myId));
      }
    } else if (e.type === 'win') {
      planetWon(e);
    } else if (e.type === 'severed') {
      if (e.id === myId) {
        sfx.death();
        toast('Cut off! −' + ((e.lost / world.V) * 100).toFixed(1) + '%', '#ff9bb3');
      }
    } else if (e.type === 'death') {
      view.burst(e.d, e.n, e.id, 70, 0.16);
      if (e.id === myId) { sfx.death(); gameOver(e); }
      else if (e.by === myId) {
        sfx.kill();
        toast(e.annexed ? `You annexed ${e.name}! +${((e.annexed / world.V) * 100).toFixed(1)}%` : `You cut ${e.name}!`, '#fff');
        feed(`<b>You</b> cut <b style="color:${hex(e.id)}">${esc(e.name)}</b>`);
      } else if (playing && e.by && e.by !== e.id) {
        feed(`<b style="color:${hex(e.by)}">${esc(e.byName)}</b> cut <b style="color:${hex(e.id)}">${esc(e.name)}</b>`);
      }
    }
  }
  game.events.length = 0;
}

// ---------------------------------------------------------------- loop
if (params.has('autoplay')) start();
let last = performance.now();
view.zoomTarget = playing ? playZoom : 1;
view.zoom = 1;

view.renderer.setAnimationLoop((now) => {
  const prevFrame = last;
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
  last = now;
  if (calibrate > 0 && --calibrate === 0) recentre();

  let want;
  if (me.alive) want = view.inXR ? xrInput(dt) : desktopInput(dt);
  else if (view.inXR) xrInput(dt);
  const idle = !view.inXR && !pointerSteer; // no steering input: carry straight on

  if (role === 'guest') {
    if (me.alive) {
      joinPending = false;
      if (want !== undefined) guestWant = want; else if (idle) guestWant = null;
    }
    const t = performance.now();
    if (t > netAt) { netAt = t + 50; net.send({ k: 'i', w: me.alive ? guestWant : null }); }
    guestSync.frame(t);
  } else {
    if (me.alive) { if (want !== undefined) me.want = want; else if (idle) me.want = null; }
    if (role === 'host' && net.guests) hostStep(Math.min(0.5, (now - prevFrame) / 1000));
    else game.step(dt);
    if (role === 'host') hostNet(performance.now());
  }
  handleEvents();
  celebrate(dt);
  if (!playing && !view.inXR) view.zoomTarget = 1;
  view.menuShiftTarget = $('menu').classList.contains('hide') ? 0 : 1;
  const leader = me.alive ? me : game.standings()[0];
  view.turntable = !playing && !game.winner;
  view.update(dt, leader || null);
  if (now > hudAt) { hudAt = now + 200; updateHud(); }
  view.render();
});
