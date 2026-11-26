// Sculpted worlds, described as soft unions of simple solids.
// Axes: +y up, +z toward the viewer (the "front"), +x to the viewer's right.
// Sizes are arbitrary; the game rescales every world to the same surface area.
//
// Rules of thumb for a shape that bakes and plays well:
//  - one solid, no through-holes (handles are filled in): the grid is a sphere at heart
//  - keep every limb chunky (radius >= ~0.12 on a shape ~3 units across), toy-like
//  - leave clear gaps between limbs, or let them merge; avoid hairline crevices
import { sphere, ellipsoid, capsule, box, cylinder, frustum, lathe, union, carve, intersect, mirrorX, tube, rotX, rotY, rotZ, scale, move } from './sdf.mjs';

const legs = (x, zf, zb, top, bottom, r) => [
  mirrorX(capsule([x, top, zf], [x * 1.05, bottom, zf + 0.03], r * 1.08, r)),
  mirrorX(capsule([x, top, zb], [x * 1.05, bottom, zb], r * 1.1, r)),
];

// classic fluted paper case for the cupcake
const flutedCup = (y0, y1, r0, r1, flutes, depth) => (x, y, z) => {
  const t = Math.max(0, Math.min(1, (y - y0) / (y1 - y0)));
  const rad = (r0 + (r1 - r0) * t) * (1 + depth * Math.cos(flutes * Math.atan2(z, x)));
  const side = (Math.hypot(x, z) - rad) * 0.8, cap = Math.max(y0 - y, y - y1);
  return Math.min(Math.max(side, cap), 0) + Math.hypot(Math.max(side, 0), Math.max(cap, 0)) - 0.03;
};

export const SCULPTS = {
  // two lobes of slightly different size with a pinched waist
  peanut: union(0.42, ellipsoid(0, 0.62, 0, 0.6, 0.66, 0.6), ellipsoid(0, -0.66, 0, 0.66, 0.72, 0.66)),

  puppy: union(0.12,
    ellipsoid(0, 0, -0.1, 0.55, 0.5, 0.8),                                 // body
    sphere(0, 0.62, 0.72, 0.5),                                            // head
    ellipsoid(0, 0.5, 1.15, 0.26, 0.22, 0.3),                              // muzzle
    sphere(0, 0.6, 1.42, 0.1),                                             // nose
    mirrorX(capsule([0.42, 0.95, 0.62], [0.62, 0.35, 0.7], 0.17, 0.2)),    // floppy ears
    mirrorX(capsule([0.34, -0.2, 0.42], [0.36, -0.95, 0.46], 0.2, 0.19)),  // front legs
    mirrorX(capsule([0.36, -0.2, -0.6], [0.38, -0.95, -0.6], 0.21, 0.19)), // hind legs
    capsule([0, 0.3, -0.85], [0, 0.78, -1.15], 0.17, 0.15)),               // tail

  // sitting bear: round tummy, legs out front, arms forward
  teddy: union(0.1,
    ellipsoid(0, -0.25, 0, 0.64, 0.7, 0.56),
    sphere(0, 0.72, 0.05, 0.52),
    mirrorX(sphere(0.42, 1.17, 0, 0.21)),                                  // ears
    ellipsoid(0, 0.6, 0.5, 0.25, 0.2, 0.2),                                // muzzle
    mirrorX(capsule([0.56, 0.1, 0.1], [0.98, -0.32, 0.38], 0.21, 0.2)),    // arms
    mirrorX(capsule([0.36, -0.75, 0.25], [0.52, -0.85, 0.9], 0.26, 0.25))),// legs

  mushroom: union(0.1,
    carve(0.12, ellipsoid(0, 0.35, 0, 1.15, 0.8, 1.15), box(0, -0.75, 0, 2, 0.95, 2)), // domed cap
    lathe(0, 0, -1.0, 0.4, (y) => 0.4 + 0.16 * Math.pow(Math.max(0, (-y - 0.2) / 0.8), 2), 0.12)), // stem

  // puffy five-pointed star
  star: scale(union(0.1,
    sphere(0, 0, 0, 0.5),
    ...[0, 1, 2, 3, 4].map((i) => {
      const a = (i * Math.PI * 2) / 5;
      return capsule([0, 0, 0], [Math.sin(a) * 1.25, Math.cos(a) * 1.25, 0], 0.46, 0.14);
    })), 1, 1, 0.72),

  // hexagonal pencil, point down, leaning like it is mid-scribble
  pencil: rotZ(union(0.03,
    intersect(0.03, box(0, 0.15, 0, 0.6, 1.15, 0.29), intersect(0.03, rotY(box(0, 0.15, 0, 0.6, 1.15, 0.29), Math.PI / 3), rotY(box(0, 0.15, 0, 0.6, 1.15, 0.29), -Math.PI / 3))),
    frustum(0, -1.75, 0, -0.98, 0.05, 0.33, 0.04),                         // sharpened tip
    cylinder(0, 1.36, 0, 'y', 0.36, 0.1, 0.03),                            // metal band
    cylinder(0, 1.62, 0, 'y', 0.32, 0.2, 0.12)), 0.45),                    // eraser

  car: union(0.07,
    box(0, -0.08, 0, 0.62, 0.27, 1.22, 0.2),                               // body
    box(0, 0.36, -0.12, 0.5, 0.3, 0.6, 0.22),                              // cabin
    mirrorX(cylinder(0.56, -0.4, 0.74, 'x', 0.36, 0.2, 0.12)),             // front wheels
    mirrorX(cylinder(0.56, -0.4, -0.76, 'x', 0.36, 0.2, 0.12)),            // rear wheels
    mirrorX(sphere(0.38, -0.02, 1.2, 0.13)),                               // headlights
    box(0, 0.05, -1.25, 0.5, 0.06, 0.1, 0.05)),                            // spoiler lip

  // chubby pony with a horn and a flowing mane and tail
  unicorn: union(0.11,
    ellipsoid(0, 0, -0.15, 0.5, 0.5, 0.82),
    capsule([0, 0.25, 0.5], [0, 0.95, 0.82], 0.32, 0.27),                  // neck
    capsule([0, 1.05, 0.85], [0, 0.82, 1.4], 0.3, 0.22),                   // head + snout
    capsule([0, 1.3, 0.95], [0, 1.9, 1.2], 0.17, 0.12),                    // horn
    mirrorX(capsule([0.23, 1.22, 0.72], [0.33, 1.42, 0.66], 0.14, 0.13)),  // ears
    capsule([0, 1.3, 0.62], [0, 0.45, 0.12], 0.15, 0.17),                  // mane
    ...legs(0.3, 0.42, -0.62, -0.2, -1.0, 0.21),
    capsule([0, 0.25, -0.9], [0, -0.55, -1.35], 0.2, 0.15)),               // tail

  // acoustic guitar seen face-on
  guitar: union(0.05,
    union(0.3, cylinder(0, -0.78, 0, 'z', 0.74, 0.18, 0.12), cylinder(0, 0.08, 0, 'z', 0.54, 0.18, 0.12)), // body
    box(0, 1.12, 0.03, 0.15, 0.78, 0.11, 0.06),                            // neck
    box(0, 2.08, 0.0, 0.23, 0.27, 0.1, 0.07),                              // headstock
    box(0, -1.0, 0.2, 0.3, 0.06, 0.05, 0.03)),                             // bridge

  pig: union(0.1,
    ellipsoid(0, 0, 0, 0.7, 0.62, 0.9),
    sphere(0, 0.15, 0.85, 0.5),
    cylinder(0, 0.1, 1.38, 'z', 0.23, 0.13, 0.08),                         // snout
    mirrorX(capsule([0.26, 0.42, 0.9], [0.37, 0.58, 1.0], 0.17, 0.13)),    // ears
    ...legs(0.4, 0.5, -0.5, -0.3, -0.85, 0.2),
    capsule([0, 0.2, -0.8], [0.05, 0.3, -0.92], 0.14, 0.13)),              // tail

  cupcake: union(0.08,
    flutedCup(-1.0, -0.05, 0.56, 0.82, 14, 0.035),                         // paper case
    ellipsoid(0, 0.1, 0, 0.94, 0.3, 0.94),                                 // swirls of frosting
    ellipsoid(0, 0.46, 0, 0.72, 0.27, 0.72),
    ellipsoid(0, 0.78, 0, 0.5, 0.24, 0.5),
    ellipsoid(0, 1.04, 0, 0.29, 0.2, 0.29),
    sphere(0, 1.32, 0, 0.2)),                                              // cherry

  // leaner and taller than the unicorn, long face, no horn
  horse: union(0.1,
    ellipsoid(0, 0.15, -0.15, 0.46, 0.48, 0.95),
    capsule([0, 0.4, 0.6], [0, 1.08, 0.95], 0.31, 0.25),                   // neck
    capsule([0, 1.18, 0.95], [0, 0.8, 1.6], 0.26, 0.19),                   // long head
    mirrorX(capsule([0.19, 1.34, 0.84], [0.26, 1.54, 0.8], 0.13, 0.125)),  // ears
    capsule([0, 1.32, 0.72], [0, 0.6, 0.3], 0.14, 0.15),                   // mane
    ...legs(0.34, 0.5, -0.75, -0.1, -1.2, 0.2),
    capsule([0, 0.4, -1.05], [0, -0.5, -1.4], 0.18, 0.16)),                // tail

  lion: union(0.1,
    ellipsoid(0, 0, -0.25, 0.5, 0.5, 0.85),
    ellipsoid(0, 0.55, 0.52, 0.76, 0.76, 0.5),                             // mane
    sphere(0, 0.55, 0.78, 0.44),                                           // face
    ellipsoid(0, 0.42, 1.14, 0.23, 0.19, 0.2),                             // muzzle
    mirrorX(sphere(0.42, 1.18, 0.5, 0.17)),                                // ears
    ...legs(0.32, 0.35, -0.75, -0.2, -0.95, 0.2),
    capsule([0, 0.2, -1.0], [0, 0.75, -1.45], 0.13, 0.13),                 // tail
    sphere(0, 0.85, -1.52, 0.22)),                                         // tail tuft

  alligator: union(0.1,
    ellipsoid(0, 0, 0, 0.55, 0.34, 1.0),
    tube(0.1, [[0, 0, -0.75, 0.38], [0, 0, -1.55, 0.26], [0.18, 0, -2.25, 0.13]]), // tail
    ellipsoid(0, 0.03, 1.15, 0.43, 0.29, 0.45),                            // head
    box(0, -0.03, 1.78, 0.3, 0.15, 0.5, 0.13),                             // long snout
    mirrorX(sphere(0.25, 0.3, 1.2, 0.15)),                                 // eyes
    mirrorX(sphere(0.15, 0.13, 2.15, 0.1)),                                // nostrils
    mirrorX(capsule([0.42, -0.05, 0.58], [0.88, -0.36, 0.8], 0.19, 0.17)), // front legs
    mirrorX(capsule([0.44, -0.05, -0.55], [0.9, -0.36, -0.75], 0.2, 0.17)),// hind legs
    ...[-0.6, -0.3, 0, 0.3, 0.6].map((z) => sphere(0, 0.32, z, 0.13))),    // ridged back

  // a ball with eyes and a wide grin pressed into it
  smiley: carve(0.05,
    sphere(0, 0, 0, 1),
    mirrorX(ellipsoid(0.36, 0.3, 0.95, 0.15, 0.25, 0.28)),
    tube(0.02, [-1, -0.6, -0.2, 0.2, 0.6, 1].map((t) => {
      const x = 0.62 * t, y = -0.52 + 0.34 * t * t, z = Math.sqrt(Math.max(0.05, 1 - x * x - y * y));
      return [x, y, z, 0.14];
    }))),

  // chunky J-shaped horn with a flared bell
  saxophone: carve(0.06, union(0.07,
    tube(0.06, [
      [-0.5, 1.95, 0, 0.14], [-0.15, 1.82, 0, 0.15], [0.2, 1.55, 0, 0.16], [0.26, 1.1, 0, 0.18],
      [0.26, -0.55, 0, 0.25], [0.14, -1.02, 0, 0.29], [-0.24, -1.3, 0, 0.32], [-0.68, -1.12, 0, 0.35],
      [-0.9, -0.62, 0, 0.42], [-0.98, -0.2, 0, 0.5],
    ]),
    ...[0.9, 0.55, 0.2, -0.15].map((y) => sphere(0.26, y, 0.24, 0.11))),   // keys
    sphere(-1.02, 0.72, 0, 0.55)),                                         // dished mouth of the bell

  teapot: union(0.07,
    ellipsoid(0, 0, 0, 0.95, 0.75, 0.95),
    cylinder(0, -0.72, 0, 'y', 0.55, 0.07, 0.05),                          // foot
    ellipsoid(0, 0.72, 0, 0.46, 0.14, 0.46),                               // lid
    sphere(0, 0.96, 0, 0.15),                                              // knob
    tube(0.06, [[0.8, -0.15, 0, 0.23], [1.3, 0.18, 0, 0.17], [1.56, 0.6, 0, 0.14]]), // spout
    // the handle is a solid ear with a thumb-dimple each side (no through-hole)
    carve(0.08, ellipsoid(-1.08, 0.02, 0, 0.5, 0.52, 0.17), sphere(-1.12, 0.02, 0.36, 0.27), sphere(-1.12, 0.02, -0.36, 0.27))),

  heart: scale(union(0.3,
    mirrorX(sphere(0.46, 0.42, 0, 0.6)),
    mirrorX(capsule([0.42, 0.3, 0], [0, -0.95, 0], 0.5, 0.16)),
    ellipsoid(0, -0.1, 0, 0.45, 0.55, 0.5)), 1, 1, 0.78),

  // raised fist: fingers curled over the palm, thumb across them, wrist below
  fist: union(0.07,
    box(0, 0, 0, 0.62, 0.52, 0.4, 0.26),
    ...[-0.48, -0.16, 0.16, 0.48].flatMap((x) => [
      sphere(x, 0.52, 0.12, 0.2),                                          // knuckle
      capsule([x, 0.45, 0.3], [x, -0.12, 0.5], 0.19, 0.18),                // curled finger
    ]),
    capsule([0.6, 0.0, 0.3], [-0.12, -0.28, 0.66], 0.21, 0.18),            // thumb
    box(0, -1.0, -0.02, 0.44, 0.55, 0.3, 0.22)),                           // wrist

  // molar: knobbly crown, two tapering roots
  tooth: union(0.12,
    box(0, 0.35, 0, 0.62, 0.42, 0.52, 0.32),
    mirrorX(sphere(0.3, 0.74, 0.24, 0.25)), mirrorX(sphere(0.3, 0.74, -0.24, 0.25)),
    mirrorX(capsule([0.34, 0.0, 0], [0.5, -1.1, 0], 0.28, 0.16))),
};
