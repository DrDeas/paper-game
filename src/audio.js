// Tiny synthesised sound effects (no audio files to load).
let ac = null;

export function unlockAudio() {
  try {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
  } catch { ac = null; }
}

function tone(freq, dur, { type = 'sine', vol = 0.12, to = freq, delay = 0 } = {}) {
  if (!ac || ac.state !== 'running') return;
  const t = ac.currentTime + delay;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

export const sfx = {
  start() { tone(330, 0.12, { type: 'triangle' }); tone(495, 0.16, { type: 'triangle', delay: 0.09 }); tone(660, 0.22, { type: 'triangle', delay: 0.18 }); },
  capture(gained) {
    const base = 420 + Math.min(360, gained * 0.6);
    tone(base, 0.1, { type: 'triangle', vol: 0.11 });
    tone(base * 1.5, 0.2, { type: 'triangle', vol: 0.1, delay: 0.07 });
  },
  kill() { tone(700, 0.08, { type: 'square', vol: 0.06 }); tone(1050, 0.22, { type: 'square', vol: 0.06, delay: 0.07 }); },
  // chiptune victory fanfare: lead melody, octave doubling, bouncing bass, sparkle on top
  victory() {
    const beat = 0.14;
    const N = { C4: 261.63, E4: 329.63, G4: 392, A4: 440, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, E6: 1318.5, G6: 1568 };
    const lead = [
      ['C5', 1], ['E5', 1], ['G5', 1], ['C6', 2], ['G5', 1], ['C6', 3], [0, 1],
      ['A5', 1], ['A5', 1], ['A5', 1], ['G5', 2], ['E5', 1], ['G5', 3], [0, 1],
      ['F5', 1], ['A5', 1], ['C6', 1], ['E6', 2], ['C6', 1], ['D5', 1], ['G5', 1], ['B5', 1],
      ['C6', 1], ['E6', 1], ['G6', 1], ['C6', 1], ['E6', 1], ['G6', 1], ['C6', 6],
    ];
    let t = 0;
    for (const [n, len] of lead) {
      if (n) {
        tone(N[n], beat * len * 0.92, { type: 'square', vol: 0.07, delay: t });
        tone(N[n] / 2, beat * len * 0.92, { type: 'triangle', vol: 0.06, delay: t });
      }
      t += beat * len;
    }
    const bass = ['C4', 'C4', 'A4', 'A4', 'C4', 'C4', 'G4', 'C4'];
    bass.forEach((n, i) => {
      for (let k = 0; k < 4; k++) tone(N[n] / 2 * (k % 2 ? 2 : 1), beat * 0.9, { type: 'triangle', vol: 0.11, delay: i * beat * 5.25 + k * beat * 1.3 });
    });
    for (let i = 0; i < 14; i++) tone(1568 * (1 + (i % 4) * 0.25), 0.09, { type: 'sine', vol: 0.035, delay: t - beat * 6 + i * 0.09 });
  },
  death() { tone(380, 0.5, { type: 'sawtooth', vol: 0.1, to: 60 }); },
};
