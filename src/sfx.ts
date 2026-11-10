/**
 * Tiny synthesized sound effects (Web Audio). No audio files, so there is
 * nothing to license and nothing to download.
 */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(
  freq: number,
  start: number,
  dur: number,
  type: OscillatorType = 'sine',
  gain = 0.12,
): void {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + start;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const sfx = {
  /** Call from a user gesture so later sounds can play. */
  unlock: () => void audio(),
  pick: () => tone(660, 0, 0.08, 'triangle', 0.08),
  place: () => {
    tone(520, 0, 0.06, 'square', 0.04);
    tone(880, 0.03, 0.1, 'triangle', 0.07);
  },
  reject: () => tone(180, 0, 0.18, 'sawtooth', 0.04),
  gem: () => tone(1320, 0, 0.25, 'sine', 0.07),
  button: () => tone(440, 0, 0.07, 'triangle', 0.07),
  solved: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.35, 'sine', 0.1));
  },
};
