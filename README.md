# Lasso Planet

A territory-capture game played on tiny 3D planets — in a browser tab, on a phone, or inside a VR headset.

Leave your home turf, draw a loop, and close it: everything inside becomes yours. While you are out,
your line is exposed — if anyone crosses it (including you), you are out. Cut other players' lines to
remove them from the planet. Territory must stay in one piece: if a rival carves through your land,
any part severed from where you are standing is wiped back to unclaimed ground.

No build step, no dependencies to install. It is a static site (three.js is vendored in `vendor/`).

Newcomers never appear on, inside, or right beside anyone's land: a spawn point needs a clear buffer
from every territory, trail and player. On a crowded planet the buffer shrinks in stages, and if there is
still no room a bot simply waits and tries again.

## Modes

- **Classic** — an eliminated player's land returns to the planet.
- **Imperial Mode** — eliminate a rival and their entire territory becomes yours. Annexed land can sit
  apart from your homeland; each holding still obeys the stay-in-one-piece rule.

## Run it

```bash
npm start
```

Then open http://localhost:8080. Any static file server works.

To publish, enable **GitHub Pages** for this repository (Settings → Pages → Deploy from a branch → root).
WebXR needs HTTPS, which Pages provides.

## Controls

| | Steer | Zoom |
|---|---|---|
| Desktop | Mouse (head toward the pointer) or WASD / arrows | Scroll, `Q` / `E`, `Space` toggles whole-planet view |
| Touch | Drag / tap where you want to go | Pinch, or the +/− buttons |
| Gamepad | Left stick | Right stick |
| VR / MR headset | Right thumbstick, **or** hold a trigger and point at the ground | Left thumbstick; `A`/`X` toggles globe view; `B`/`Y` re-centres |

### In a headset

Open the site in the headset browser and press **Enter VR** (or **Mixed reality** where passthrough is
supported). Zoomed in, you stand on the planet as a giant with your avatar a few steps ahead; zoomed
out, the whole world is a globe floating in front of you. The planet rotates beneath you instead of
moving you through space, and the sky stays fixed, which keeps it comfortable.

## How it works

- `src/world.js` — a geodesic grid (~41k cells) wrapped around a star-shaped surface (Orb, Pebble, Dice, Peanut).
- `src/game.js` — the rules: trails, enclosure flood-fill (everything except the largest outside region is captured), eliminations, respawns.
- `src/bots.js` — bot AI: box-shaped excursions, path-finding home that avoids their own trail, threat assessment, and hunting exposed trails.
- `src/view.js` — rendering. Ownership lives in a float texture read by the planet shader, so captures cost one small texture upload; borders are anti-aliased and smoothed in the fragment shader. Also the zoom "rig" shared by desktop and XR.
- `src/main.js` — input (mouse, touch, keys, gamepad, XR controllers), HUD, session handling.

`npm test` runs a headless bots-only soak test on every world shape and checks the simulation invariants.
