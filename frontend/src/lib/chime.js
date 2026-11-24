// A soft two-note chime for incoming ride requests (Web Audio, no audio files).
// Browsers only allow sound after a user gesture, so primeAudio() is called on the first tap.

let ctx = null;
const read = () => { try { return localStorage.getItem('delta.sound') !== '0'; } catch { return true; } };

export const soundEnabled = read;
export function setSoundEnabled(on) { try { localStorage.setItem('delta.sound', on ? '1' : '0'); } catch { /* storage unavailable */ } }

export function primeAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* audio unavailable */ }
}

export function chime() {
  if (!read()) return;
  try {
    primeAudio();
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    [[784, 0], [1175, 0.13]].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + delay);
      gain.gain.exponentialRampToValueAtTime(0.16, t + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.45);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + delay);
      osc.stop(t + delay + 0.5);
    });
  } catch { /* audio unavailable */ }
}

export function buzz(pattern = [120, 60, 120]) {
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}
