# Lasso Planet

A territory-capture game played on tiny 3D planets — in a browser tab, on a phone, or inside a VR headset.

Leave your home turf, draw a loop, and close it: everything inside becomes yours. While you are out,
your line is exposed — if anyone crosses it (including you), you are out. Cut another player's line and
their entire territory becomes yours. Annexed land can sit apart from your homeland, but each holding
must stay in one piece: if a rival carves through it, the severed part is wiped back to unclaimed ground.

No build step, no dependencies to install. It is a static site (three.js is vendored in `vendor/`).

Newcomers never appear on, inside, or right beside anyone's land: a spawn point needs a clear buffer
from every territory, trail and player. On a crowded planet the buffer shrinks in stages, and if there is
still no room a bot simply waits and tries again.

Own **100% of the planet** and you win: a victory wave sweeps round the world, fireworks go off, and a
chiptune fanfare plays. (Once a player holds 99.5% the last sliver falls to them automatically — there is
no "outside" left to close a loop against.) Bots can win too.

## Worlds

21 worlds, picked from an endlessly swipeable row on the menu: Orb, Pebble, Dice, Peanut, Puppy, Teddy,
Mushroom, Star, Pencil, Toy Car, Shuttle, Unicorn, Guitar, Pig, Cupcake, Horse, Lion, Alligator, Smiley, Teapot
and Tooth. Every world has the same surface area and the same number of cells, so speed and
territory percentages mean the same thing everywhere; only the terrain changes.

To add or reshape one, describe it as a soft union of simple solids in `tools/shapes.mjs`, add it to
`SHAPES` in `src/world.js`, and bake it:

```bash
node tools/bake-worlds.mjs teapot
```

The baker shrink-wraps the game's geodesic grid onto the shape and writes `worlds/<key>.bin` (about
250 KB, fetched only when that world is chosen).

## Play with friends

Press **Host a game**, then **Copy invite link** and send it to your friends (or read them the 5-character
room code for **Join a game**). Up to 8 people share a planet, on any mix of desktop, phone and headset;
bots fill the remaining seats, and a bot takes over when someone leaves.

There is no game server. The host's browser runs the game and the others connect to it directly
(WebRTC). The public [PeerJS](https://peerjs.com) service is used only to introduce the browsers to each
other. Consequences worth knowing:

- The game lasts as long as the host keeps the page open. If the host leaves, everyone drops back to solo.
- Guests feel the network delay to the host in their steering.
- Some strict networks (certain corporate, school or mobile carriers) block direct connections; there is
  no relay fallback.
- To use your own introduction server instead of the public one, run a
  [PeerServer](https://github.com/peers/peerjs-server) and add `?signal=host:port` to the URL.

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

- `src/world.js` — the grid: a geodesic mesh (~41k cells) whose vertices are positioned per world, plus walking straight lines (geodesics) across it.
- `tools/` — the offline sculpting kit: signed-distance primitives, the shape definitions, and the baker.
- `src/game.js` — the rules: trails, enclosure flood-fill (everything except the largest outside region is captured), eliminations, respawns.
- `src/bots.js` — bot AI: box-shaped excursions, path-finding home that avoids their own trail, threat assessment, and hunting exposed trails.
- `src/view.js` — rendering. Ownership lives in a float texture read by the planet shader, so captures cost one small texture upload; borders are anti-aliased and smoothed in the fragment shader. Also the zoom "rig" shared by desktop and XR.
- `src/net.js` — multiplayer: room codes, host/guest connections, snapshot + changed-cell sync, guest-side interpolation.
- `src/main.js` — input (mouse, touch, keys, gamepad, XR controllers), HUD, session handling.

`npm test` runs a headless bots-only soak test on every world shape and checks the simulation invariants.
