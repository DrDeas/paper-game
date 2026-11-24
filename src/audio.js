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
  death() { tone(380, 0.5, { type: 'sawtooth', vol: 0.1, to: 60 }); },
};
