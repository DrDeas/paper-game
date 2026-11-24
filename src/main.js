import { World, SHAPES } from './world.js';
import { Game, HUMAN_ID } from './game.js';
import { View, THREE, hex } from './view.js';
import { sfx, unlockAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const view = new View($('scene'));
let world, game, me;
let shapeKey = params.get('shape') || store.get('lp.shape', 'orb');
if (!SHAPES[shapeKey]) shapeKey = 'orb';
let playZoom = Number(params.get('zoom') ?? store.get('lp.zoom', 0.3));
let best = Number(store.get('lp.best', 0));
let playing = false, startedAt = 0;

function buildWorld(key) {
  shapeKey = key;
  store.set('lp.shape', key);
  world = new World(key, 6);
  game = new Game(world);
  me = game.players[HUMAN_ID];
  view.setWorld(world, game);
  for (const b of $('shapes').children) b.classList.toggle('on', b.dataset.k === key);
  if (window.__lp) Object.assign(window.__lp, { game, world });
}

for (const [k, s] of Object.entries(SHAPES)) {
  const b = document.createElement('button');
  b.textContent = s.name; b.dataset.k = k;
  b.onclick = () => { if (!playing) buildWorld(k); };
  $('shapes').append(b);
}
$('name').value = store.get('lp.name', '');
buildWorld(shapeKey);
window.__lp = { game, world, view };

function start() {
  unlockAudio();
  const name = $('name').value.trim() || 'You';
  store.set('lp.name', $('name').value.trim());
  game.join(name);
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
  $('resultTitle').textContent = e.by === e.id ? 'You crossed your own line!' : e.byName ? `${e.byName} cut your line!` : 'Unravelled!';
  $('statPct').textContent = peak.toFixed(1) + '%';
  $('statKills').textContent = me.kills;
  $('statTime').textContent = Math.round(game.time - startedAt) + 's';
  $('play').textContent = 'Play again';
  lastResult = $('resultTitle').textContent;
  setTimeout(() => { if (!playing) { $('menu').classList.remove('hide'); $('hud').hidden = true; } }, 900);
}
let lastResult = '';

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
addEventListener('wheel', (e) => { e.preventDefault(); setZoom(view.zoomTarget + e.deltaY * 0.0011); }, { passive: false });
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
      if (src.handedness === 'right') {
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
      message: playing ? '' : (lastResult ? lastResult + '  ' : '') + 'Pull the trigger to play',
    });
  }
}

function handleEvents() {
  for (const e of game.events) {
    if (e.type === 'capture') {
      if (e.id === HUMAN_ID) {
        sfx.capture(e.gained);
        view.burst(e.d, e.id, Math.min(60, 10 + e.gained / 8), 0.1);
        const gain = (e.gained / world.V) * 100;
        if (gain >= 0.1) toast('+' + gain.toFixed(1) + '%', hex(HUMAN_ID));
      }
    } else if (e.type === 'death') {
      view.burst(e.d, e.id, 70, 0.16);
      if (e.id === HUMAN_ID) { sfx.death(); gameOver(e); }
      else if (e.by === HUMAN_ID) {
        sfx.kill();
        toast(`You cut ${e.name}!`, '#fff');
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
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
  last = now;
  if (calibrate > 0 && --calibrate === 0) recentre();

  if (me.alive) {
    const want = view.inXR ? xrInput(dt) : desktopInput(dt);
    if (want !== undefined) me.want = want;
    else if (!view.inXR && !pointerSteer) me.want = null;
  } else if (view.inXR) xrInput(dt);

  game.step(dt);
  handleEvents();
  if (!playing && !view.inXR) view.zoomTarget = 1;
  view.menuShiftTarget = $('menu').classList.contains('hide') ? 0 : 1;
  const leader = me.alive ? me : game.standings()[0];
  view.update(dt, leader ? leader.d : null);
  if (now > hudAt) { hudAt = now + 200; updateHud(); }
  view.render();
});
