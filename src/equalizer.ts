export interface EqBands {
  b60: number;   // 60 Hz Sub Bass (-12dB to +12dB)
  b150: number;  // 150 Hz Bass Warmth
  b400: number;  // 400 Hz Low Mid / Mud
  b1k: number;   // 1 kHz Midrange Core
  b2k5: number;  // 2.5 kHz Speech Intelligibility
  b6k: number;   // 6 kHz Presence & Sibilance
  b10k: number;  // 10 kHz Treble & Static Hiss
  b16k: number;  // 16 kHz Super High Air
}

export const DEFAULT_EQ_BANDS: EqBands = {
  b60: 0,
  b150: 0,
  b400: 0,
  b1k: 0,
  b2k5: 0,
  b6k: 0,
  b10k: 0,
  b16k: 0,
};

export interface EqPreset {
  id: string;
  name: string;
  emoji: string;
  bands: EqBands;
}

export const EQ_PRESETS: EqPreset[] = [
  { id: 'flat', name: 'Flat', emoji: '⚖️', bands: { b60: 0, b150: 0, b400: 0, b1k: 0, b2k5: 0, b6k: 0, b10k: 0, b16k: 0 } },
  { id: 'speech', name: 'Speech & News', emoji: '📻', bands: { b60: -3, b150: 1, b400: -3, b1k: 1, b2k5: 4, b6k: 2, b10k: -1, b16k: -2 } },
  { id: 'bass', name: 'Bass Boost', emoji: '🔊', bands: { b60: 6, b150: 5, b400: 2, b1k: 0, b2k5: -1, b6k: -2, b10k: -2, b16k: -3 } },
  { id: 'hiss', name: 'Hiss & Static Cut', emoji: '🧹', bands: { b60: 0, b150: 0, b400: -1, b1k: 0, b2k5: 1, b6k: -1, b10k: -4, b16k: -6 } },
  { id: 'vocal', name: 'Vocal & Acoustic', emoji: '🎙️', bands: { b60: -2, b150: 2, b400: -1, b1k: 2, b2k5: 3, b6k: 2, b10k: 1, b16k: 2 } },
  { id: 'rock', name: 'Rock & Punch', emoji: '🎸', bands: { b60: 5, b150: 4, b400: -2, b1k: -1, b2k5: 2, b6k: 3, b10k: 4, b16k: 4 } },
  { id: 'pop', name: 'Pop & Dance', emoji: '💃', bands: { b60: 4, b150: 3, b400: 1, b1k: 0, b2k5: 2, b6k: 3, b10k: 4, b16k: 4 } },
  { id: 'relaxed', name: 'Night / Soft', emoji: '🌙', bands: { b60: 2, b150: 1, b400: 0, b1k: -1, b2k5: -2, b6k: -3, b10k: -4, b16k: -5 } },
];

export interface EqChain {
  input: GainNode;
  output: GainNode;
  updateBands: (bands: EqBands) => void;
  cleanup: () => void;
}

export function buildEqChain(ctx: AudioContext, initialBands: EqBands): EqChain {
  const input = ctx.createGain();

  const f60 = ctx.createBiquadFilter();
  f60.type = 'lowshelf';
  f60.frequency.value = 60;

  const f150 = ctx.createBiquadFilter();
  f150.type = 'peaking';
  f150.frequency.value = 150;
  f150.Q.value = 1.2;

  const f400 = ctx.createBiquadFilter();
  f400.type = 'peaking';
  f400.frequency.value = 400;
  f400.Q.value = 1.2;

  const f1k = ctx.createBiquadFilter();
  f1k.type = 'peaking';
  f1k.frequency.value = 1000;
  f1k.Q.value = 1.2;

  const f2k5 = ctx.createBiquadFilter();
  f2k5.type = 'peaking';
  f2k5.frequency.value = 2500;
  f2k5.Q.value = 1.2;

  const f6k = ctx.createBiquadFilter();
  f6k.type = 'peaking';
  f6k.frequency.value = 6000;
  f6k.Q.value = 1.2;

  const f10k = ctx.createBiquadFilter();
  f10k.type = 'peaking';
  f10k.frequency.value = 10000;
  f10k.Q.value = 1.2;

  const f16k = ctx.createBiquadFilter();
  f16k.type = 'highshelf';
  f16k.frequency.value = 16000;

  const output = ctx.createGain();

  input.connect(f60);
  f60.connect(f150);
  f150.connect(f400);
  f400.connect(f1k);
  f1k.connect(f2k5);
  f2k5.connect(f6k);
  f6k.connect(f10k);
  f10k.connect(f16k);
  f16k.connect(output);

  function clampDb(v: number): number {
    return Math.max(-12, Math.min(12, v || 0));
  }

  function updateBands(bands: EqBands) {
    f60.gain.value = clampDb(bands.b60);
    f150.gain.value = clampDb(bands.b150);
    f400.gain.value = clampDb(bands.b400);
    f1k.gain.value = clampDb(bands.b1k);
    f2k5.gain.value = clampDb(bands.b2k5);
    f6k.gain.value = clampDb(bands.b6k);
    f10k.gain.value = clampDb(bands.b10k);
    f16k.gain.value = clampDb(bands.b16k);
  }

  updateBands(initialBands);

  return {
    input,
    output,
    updateBands,
    cleanup() {
      try {
        input.disconnect();
        f60.disconnect();
        f150.disconnect();
        f400.disconnect();
        f1k.disconnect();
        f2k5.disconnect();
        f6k.disconnect();
        f10k.disconnect();
        f16k.disconnect();
        output.disconnect();
      } catch {}
    },
  };
}
