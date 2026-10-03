// Retro sound effects using Web Audio API

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

export function playBeep(frequency = 800, duration = 0.05, volume = 0.1) {
  const ctx = getAudioContext();
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.frequency.value = frequency;
  oscillator.type = 'square';

  gainNode.gain.setValueAtTime(volume, ctx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

  oscillator.start(ctx.currentTime);
  oscillator.stop(ctx.currentTime + duration);
}

export function playSelect() {
  playBeep(600, 0.08, 0.08);
  setTimeout(() => playBeep(900, 0.08, 0.08), 50);
}

export function playHover() {
  playBeep(400, 0.03, 0.05);
}

export function playError() {
  playBeep(200, 0.15, 0.1);
  setTimeout(() => playBeep(150, 0.15, 0.1), 100);
}

export function playSuccess() {
  playBeep(600, 0.08, 0.08);
  setTimeout(() => playBeep(800, 0.08, 0.08), 80);
  setTimeout(() => playBeep(1000, 0.12, 0.08), 160);
}

export function playType() {
  playBeep(800 + Math.random() * 200, 0.02, 0.03);
}
