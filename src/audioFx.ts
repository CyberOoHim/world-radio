export interface FxConfig {
  highpass: number;
  lowpass: number;
  bass: number;
  mid: number;
  treble: number;
  bpMix: number;
  bpFreq: number;
  bpQ: number;
  distortion: number;
  ringFreq: number;
  noiseMix: number;
  delayMix: number;
  delayTime: number;
  delayFeedback: number;
  chorus: number;
  flanger: number;
  tremolo: number;
  tremoloRate: number;
  vibrato: number;
  vibratoRate: number;
  reverbMix: number;
  reverbSize: number;
  reverbDecay: number;
  bitcrush: number;
  sampleRateCrush: number;
  compressorThresh: number;
  compressorRatio: number;
  gain: number;
}

export const DEFAULT_FX: FxConfig = {
  highpass: 20,
  lowpass: 20000,
  bass: 0,
  mid: 0,
  treble: 0,
  bpMix: 0,
  bpFreq: 1200,
  bpQ: 1,
  distortion: 0,
  ringFreq: 0,
  noiseMix: 0,
  delayMix: 0,
  delayTime: 0,
  delayFeedback: 0.25,
  chorus: 0,
  flanger: 0,
  tremolo: 0,
  tremoloRate: 5,
  vibrato: 0,
  vibratoRate: 5,
  reverbMix: 0,
  reverbSize: 0.45,
  reverbDecay: 1.4,
  bitcrush: 0,
  sampleRateCrush: 0,
  compressorThresh: -18,
  compressorRatio: 3,
  gain: 1,
};

export type FxCategory = 'Devices' | 'Lo-Fi' | 'Spaces';

export interface FxPreset {
  id: string;
  cat: FxCategory;
  name: string;
  emoji: string;
  desc: string;
  era?: string;
  fx: Partial<FxConfig>;
}

export const FX_PRESETS: FxPreset[] = [
  // ─── Devices Category ──────────────────────────────────────
  {
    id: 'radio',
    cat: 'Devices',
    name: 'AM Radio',
    emoji: '📻',
    desc: 'Vintage tube AM bandpass crunch',
    era: '1940s–50s AM Radio',
    fx: {
      bpMix: 0.85,
      bpFreq: 1900,
      bpQ: 2.4,
      highpass: 320,
      lowpass: 3400,
      distortion: 0.2,
      compressorThresh: -22,
      compressorRatio: 6,
      gain: 1.15,
    },
  },
  {
    id: 'telephone',
    cat: 'Devices',
    name: 'Telephone',
    emoji: '📞',
    desc: 'Narrowband landline call',
    era: '1970s–90s Landline',
    fx: {
      highpass: 450,
      lowpass: 2600,
      bpMix: 0.55,
      bpFreq: 1400,
      bpQ: 1.6,
      distortion: 0.04,
    },
  },
  {
    id: 'megaphone',
    cat: 'Devices',
    name: 'Megaphone',
    emoji: '📢',
    desc: 'Loud mid push with overdriven horn',
    era: 'Analog Megaphone',
    fx: {
      mid: 6,
      highpass: 250,
      lowpass: 5000,
      distortion: 0.35,
      compressorRatio: 8,
      compressorThresh: -20,
      gain: 1.2,
    },
  },
  {
    id: 'walkie',
    cat: 'Devices',
    name: 'Walkie-Talkie',
    emoji: '📟',
    desc: 'Static-filled radio handset',
    era: '1980s Handheld Radio',
    fx: {
      highpass: 350,
      lowpass: 3200,
      bpMix: 0.3,
      bpFreq: 1700,
      distortion: 0.25,
      noiseMix: 0.08,
      sampleRateCrush: 0.22,
      gain: 1.1,
    },
  },
  {
    id: 'intercom',
    cat: 'Devices',
    name: 'Intercom',
    emoji: '🔔',
    desc: 'Building hallway speaker with slapback',
    era: '1970s–80s Intercom',
    fx: {
      highpass: 280,
      lowpass: 4000,
      mid: 3,
      distortion: 0.1,
      compressorRatio: 6,
      compressorThresh: -20,
      delayMix: 0.16,
      delayTime: 0.07,
      delayFeedback: 0.2,
    },
  },
  {
    id: 'pa-system',
    cat: 'Devices',
    name: 'PA System',
    emoji: '🔊',
    desc: 'Gymnasium hall boom & broadcast compression',
    era: 'Live Public Address',
    fx: {
      mid: 4,
      highpass: 150,
      reverbMix: 0.25,
      reverbDecay: 1.6,
      compressorRatio: 5,
      compressorThresh: -18,
      gain: 1.15,
    },
  },
  {
    id: 'smartphone',
    cat: 'Devices',
    name: 'Smartphone',
    emoji: '📱',
    desc: 'Thin phone mic speaker output',
    era: '2010s Mobile Mic',
    fx: {
      highpass: 220,
      lowpass: 6800,
      mid: 1.2,
      treble: 0.6,
      compressorRatio: 4,
      compressorThresh: -23,
      noiseMix: 0.01,
    },
  },
  {
    id: 'drive-thru',
    cat: 'Devices',
    name: 'Drive-Thru',
    emoji: '🍔',
    desc: 'Harsh speaker post crunch',
    era: 'Drive-Thru Speaker',
    fx: {
      highpass: 320,
      lowpass: 3600,
      mid: 4.5,
      distortion: 0.3,
      noiseMix: 0.06,
      gain: 1.1,
      bpMix: 0.2,
      bpFreq: 1300,
    },
  },
  {
    id: 'space-radio',
    cat: 'Devices',
    name: 'Space Radio',
    emoji: '📡',
    desc: 'Distant deep-space radio comms',
    era: 'Sci-Fi Telemetry',
    fx: {
      highpass: 400,
      lowpass: 3600,
      delayMix: 0.2,
      delayTime: 0.22,
      delayFeedback: 0.35,
      reverbMix: 0.25,
      noiseMix: 0.06,
      bitcrush: 0.15,
    },
  },
  {
    id: 'headphones',
    cat: 'Devices',
    name: 'Studio Mic',
    emoji: '🎧',
    desc: 'Warm close proximity studio mic',
    era: 'Modern Broadcast',
    fx: {
      bass: 2.5,
      highpass: 50,
      lowpass: 14000,
      compressorThresh: -16,
      compressorRatio: 3,
      gain: 1.08,
    },
  },

  // ─── Lo-Fi Category ─────────────────────────────────────────
  {
    id: 'cassette',
    cat: 'Lo-Fi',
    name: 'Cassette Tape',
    emoji: '📼',
    desc: 'Analogue tape wobble, warmth & hiss',
    era: '1980s Cassette Tape',
    fx: {
      sampleRateCrush: 0.25,
      bitcrush: 0.12,
      highpass: 100,
      lowpass: 7200,
      chorus: 0.05,
      vibrato: 0.18,
      vibratoRate: 2.2,
      noiseMix: 0.03,
    },
  },
  {
    id: 'lofi',
    cat: 'Lo-Fi',
    name: 'Lo-Fi Digital',
    emoji: '💽',
    desc: 'Gritty digital bit reduction & band limiting',
    era: '1990s Digital Crunch',
    fx: {
      sampleRateCrush: 0.5,
      bitcrush: 0.4,
      highpass: 140,
      lowpass: 6000,
      noiseMix: 0.05,
    },
  },
  {
    id: 'vinyl',
    cat: 'Lo-Fi',
    name: 'Vinyl Record',
    emoji: '💿',
    desc: 'Warm crackle & subtle turntable flutter',
    era: '1960s Vinyl Record',
    fx: {
      highpass: 60,
      lowpass: 9000,
      bass: 1.5,
      treble: -1,
      noiseMix: 0.035,
      chorus: 0.1,
      sampleRateCrush: 0.08,
    },
  },
  {
    id: 'tv-old',
    cat: 'Lo-Fi',
    name: 'Old CRT TV',
    emoji: '📺',
    desc: 'CRT television speaker box tone',
    era: '1970s TV Speaker',
    fx: {
      highpass: 200,
      lowpass: 4300,
      mid: 1.5,
      distortion: 0.18,
      sampleRateCrush: 0.16,
      noiseMix: 0.025,
      bitcrush: 0.1,
    },
  },
  {
    id: 'lofi-bedroom',
    cat: 'Lo-Fi',
    name: 'Bedroom Lofi',
    emoji: '🌙',
    desc: 'Cozy filtered chillhop warmth',
    era: 'Chillhop / Bedroom Lofi',
    fx: {
      lowpass: 5000,
      highpass: 150,
      bass: 1.5,
      treble: -2,
      chorus: 0.15,
      vibrato: 0.08,
      vibratoRate: 1.2,
      noiseMix: 0.02,
      sampleRateCrush: 0.1,
      compressorThresh: -20,
      compressorRatio: 2.5,
      gain: 0.95,
    },
  },
  {
    id: 'lofi-broken-speaker',
    cat: 'Lo-Fi',
    name: 'Broken Speaker',
    emoji: '💢',
    desc: 'Blown-out cone distortion & harsh buzz',
    era: 'Damaged Hardware',
    fx: {
      highpass: 400,
      lowpass: 3500,
      distortion: 0.5,
      bpMix: 0.3,
      bpFreq: 1200,
      bpQ: 3,
      noiseMix: 0.06,
      compressorRatio: 8,
      compressorThresh: -16,
      gain: 1.15,
    },
  },
  {
    id: 'lofi-vhs',
    cat: 'Lo-Fi',
    name: 'VHS Glitch',
    emoji: '📹',
    desc: 'Wobbly tape tracking glitch',
    era: '1980s–90s VHS Tape',
    fx: {
      lowpass: 5500,
      highpass: 100,
      chorus: 0.4,
      flanger: 0.15,
      vibrato: 0.25,
      vibratoRate: 1.8,
      sampleRateCrush: 0.2,
      bitcrush: 0.1,
      noiseMix: 0.03,
    },
  },
  {
    id: 'lofi-voicemail',
    cat: 'Lo-Fi',
    name: 'Voicemail',
    emoji: '📧',
    desc: 'Compressed tape answering machine',
    era: '1990s Answering Machine',
    fx: {
      highpass: 550,
      lowpass: 2200,
      bpMix: 0.65,
      bpFreq: 1250,
      bpQ: 2.6,
      distortion: 0.18,
      compressorRatio: 7,
      compressorThresh: -18,
      sampleRateCrush: 0.15,
      noiseMix: 0.05,
      vibrato: 0.06,
      vibratoRate: 1,
    },
  },
  {
    id: 'lofi-8bit',
    cat: 'Lo-Fi',
    name: '8-Bit Game',
    emoji: '🎮',
    desc: 'Chiptune console audio quantization',
    era: '1980s 8-Bit Console',
    fx: {
      bitcrush: 0.7,
      sampleRateCrush: 0.6,
      highpass: 200,
      lowpass: 6000,
      distortion: 0.1,
    },
  },
  {
    id: 'lofi-dying-battery',
    cat: 'Lo-Fi',
    name: 'Dying Battery',
    emoji: '🔋',
    desc: 'Warbly power-loss pitch instability',
    era: 'Low Battery Device',
    fx: {
      vibrato: 0.35,
      vibratoRate: 0.8,
      tremolo: 0.3,
      tremoloRate: 1,
      bitcrush: 0.15,
      lowpass: 5000,
      sampleRateCrush: 0.2,
    },
  },

  // ─── Spaces Category ────────────────────────────────────────
  {
    id: 'cathedral',
    cat: 'Spaces',
    name: 'Cathedral',
    emoji: '⛪',
    desc: 'Lush 4.2s reverb in a high stone sanctuary',
    fx: {
      reverbMix: 0.65,
      reverbSize: 0.98,
      reverbDecay: 4.2,
      highpass: 80,
      lowpass: 10500,
      gain: 0.95,
      delayMix: 0.03,
      delayTime: 0.4,
    },
  },
  {
    id: 'music-hall',
    cat: 'Spaces',
    name: 'Music Hall',
    emoji: '🎻',
    desc: 'Grand concert hall acoustics for classical & orchestral music',
    fx: {
      reverbMix: 0.38,
      reverbSize: 0.85,
      reverbDecay: 2.4,
      bass: 1.5,
      treble: 1.2,
      highpass: 40,
      lowpass: 14000,
      gain: 1.0,
    },
  },
  {
    id: 'opera-house',
    cat: 'Spaces',
    name: 'Opera House',
    emoji: '🎭',
    desc: 'Plush tier hall acoustics with warm vocal projection & 1.9s decay',
    fx: {
      reverbMix: 0.32,
      reverbSize: 0.78,
      reverbDecay: 1.9,
      mid: 1.5,
      treble: 1.0,
      bass: 1.0,
      highpass: 50,
      lowpass: 15000,
      gain: 1.0,
    },
  },
  {
    id: 'jazz-pub',
    cat: 'Spaces',
    name: 'Live Jazz Pub',
    emoji: '🎷',
    desc: 'Cozy intimate club ambience with warm double bass & mellow brass sheen',
    fx: {
      reverbMix: 0.25,
      reverbSize: 0.45,
      reverbDecay: 1.1,
      bass: 2.0,
      mid: 1.2,
      treble: 0.8,
      highpass: 50,
      lowpass: 14500,
      compressorThresh: -18,
      compressorRatio: 2.8,
      gain: 1.05,
    },
  },
  {
    id: 'recording-studio',
    cat: 'Spaces',
    name: 'Recording Studio',
    emoji: '🎙️',
    desc: 'Tight acoustically treated live room with short ambient reflections',
    fx: {
      reverbMix: 0.18,
      reverbSize: 0.25,
      reverbDecay: 0.45,
      highpass: 50,
      lowpass: 16000,
      compressorThresh: -18,
      compressorRatio: 2.5,
      gain: 1.05,
    },
  },
  {
    id: 'stadium',
    cat: 'Spaces',
    name: 'Stadium',
    emoji: '🏟️',
    desc: 'Wide arena multi-tap echo',
    fx: {
      reverbMix: 0.4,
      reverbSize: 0.9,
      reverbDecay: 2.6,
      delayMix: 0.24,
      delayTime: 0.42,
      delayFeedback: 0.22,
      highpass: 100,
      mid: 0.5,
    },
  },
  {
    id: 'outdoor-concert',
    cat: 'Spaces',
    name: 'Outdoor Concert',
    emoji: '🎪',
    desc: 'Open-air stage atmosphere with slight slapback & bass punch',
    fx: {
      reverbMix: 0.15,
      reverbSize: 0.75,
      reverbDecay: 1.2,
      delayMix: 0.14,
      delayTime: 0.18,
      delayFeedback: 0.2,
      treble: 1.2,
      bass: 1.8,
      highpass: 60,
      lowpass: 13500,
      gain: 1.05,
    },
  },
  {
    id: 'cave',
    cat: 'Spaces',
    name: 'Cave',
    emoji: '🕳️',
    desc: 'Deep subterranean echo with dark dampening',
    fx: {
      reverbMix: 0.5,
      reverbSize: 0.9,
      reverbDecay: 3.2,
      delayMix: 0.12,
      delayTime: 0.3,
      delayFeedback: 0.4,
      lowpass: 7500,
    },
  },
  {
    id: 'underwater',
    cat: 'Spaces',
    name: 'Underwater',
    emoji: '🌊',
    desc: 'Muffled deep submerged acoustic space',
    fx: {
      lowpass: 900,
      reverbMix: 0.35,
      reverbSize: 0.7,
      bass: 3,
      highpass: 60,
    },
  },
  {
    id: 'tunnel',
    cat: 'Spaces',
    name: 'Tunnel',
    emoji: '🚇',
    desc: 'Long reverberant tube echo',
    fx: {
      reverbMix: 0.3,
      reverbDecay: 1.8,
      delayMix: 0.34,
      delayTime: 0.12,
      delayFeedback: 0.55,
      lowpass: 6800,
      bpMix: 0.15,
    },
  },
  {
    id: 'bathroom',
    cat: 'Spaces',
    name: 'Tile Bathroom',
    emoji: '🚿',
    desc: 'Bright reflective tile slapback',
    fx: {
      reverbMix: 0.42,
      reverbSize: 0.3,
      reverbDecay: 0.7,
      highpass: 180,
      treble: 2.7,
      mid: 1.4,
    },
  },
  {
    id: 'forest',
    cat: 'Spaces',
    name: 'Outdoor Forest',
    emoji: '🌲',
    desc: 'Airy open outdoor atmosphere',
    fx: {
      reverbMix: 0.22,
      reverbSize: 0.65,
      reverbDecay: 1.6,
      highpass: 120,
      treble: 1,
      chorus: 0.12,
      noiseMix: 0.02,
      mid: 0.3,
    },
  },
  {
    id: 'chorus-vox',
    cat: 'Spaces',
    name: 'Chorus Vox',
    emoji: '🎶',
    desc: 'Wide stereo ensemble doubling',
    fx: {
      chorus: 0.7,
      delayMix: 0.08,
      delayTime: 0.03,
      vibrato: 0.15,
      vibratoRate: 4,
    },
  },
  {
    id: 'flanger-vox',
    cat: 'Spaces',
    name: 'Flanger Sweeper',
    emoji: '🌀',
    desc: 'Jet-comb filtering sweep',
    fx: {
      flanger: 0.75,
      chorus: 0.2,
      highpass: 80,
    },
  },
  {
    id: 'tremolo-vox',
    cat: 'Spaces',
    name: 'Tremolo Pulse',
    emoji: '📳',
    desc: 'Rhythmic amplitude modulation',
    fx: {
      tremolo: 0.7,
      tremoloRate: 7,
      mid: 1,
    },
  },
  {
    id: 'clean-boost',
    cat: 'Spaces',
    name: 'Clean Boost',
    emoji: '✨',
    desc: 'Enhanced loudness & presence boost',
    fx: {
      gain: 1.28,
      compressorThresh: -15,
      compressorRatio: 3,
      highpass: 80,
      treble: 1.8,
      bass: 1.2,
      mid: 0.5,
    },
  },
];

/** Synthetic impulse response buffer generator for realistic space reverbs */
function makeImpulse(ctx: AudioContext, seconds: number, decay: number, size: number): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(sampleRate * seconds * (0.5 + size * 0.5)));
  const impulse = ctx.createBuffer(2, len, sampleRate);
  for (let c = 0; c < 2; c++) {
    const ch = impulse.getChannelData(c);
    for (let i = 0; i < len; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.5 + decay);
    }
  }
  return impulse;
}

export interface FxChain {
  input: GainNode;
  output: GainNode;
  updateFx: (fx: FxConfig) => void;
  cleanup: () => void;
}

/**
  * Builds a complete Web Audio DSP graph from FxConfig settings.
  */
export function buildFxChain(ctx: AudioContext, initialFx: FxConfig): FxChain {
  const activeOscs: OscillatorNode[] = [];
  const activeSources: AudioBufferSourceNode[] = [];

  const input = ctx.createGain();
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';

  const bass = ctx.createBiquadFilter();
  bass.type = 'lowshelf';
  bass.frequency.value = 120;

  const mid = ctx.createBiquadFilter();
  mid.type = 'peaking';
  mid.frequency.value = 1000;
  mid.Q.value = 1;

  const treble = ctx.createBiquadFilter();
  treble.type = 'highshelf';
  treble.frequency.value = 4000;

  input.connect(hp);
  hp.connect(lp);
  lp.connect(bass);
  bass.connect(mid);
  mid.connect(treble);

  let head: AudioNode = treble;

  // Bandpass filter branch
  const dryBpG = ctx.createGain();
  const wetBpG = ctx.createGain();
  const bpFilter = ctx.createBiquadFilter();
  bpFilter.type = 'bandpass';
  const bpMerge = ctx.createGain();

  head.connect(dryBpG);
  head.connect(bpFilter);
  bpFilter.connect(wetBpG);
  dryBpG.connect(bpMerge);
  wetBpG.connect(bpMerge);
  head = bpMerge;

  // Distortion Waveshaper
  const shaper = ctx.createWaveShaper();
  shaper.oversample = '2x';
  head.connect(shaper);
  head = shaper;

  // Ring Modulator
  const ringDry = ctx.createGain();
  const ringVca = ctx.createGain();
  const ringOsc = ctx.createOscillator();
  ringOsc.type = 'sine';
  const ringDepth = ctx.createGain();
  const ringMerge = ctx.createGain();

  head.connect(ringDry);
  head.connect(ringVca);
  ringOsc.connect(ringDepth);
  ringDepth.connect(ringVca.gain);
  ringDry.connect(ringMerge);
  ringVca.connect(ringMerge);
  try {
    ringOsc.start(0);
    activeOscs.push(ringOsc);
  } catch {}
  head = ringMerge;

  // Hiss / Noise Generator
  const noiseGain = ctx.createGain();
  const noiseMerge = ctx.createGain();
  head.connect(noiseMerge);

  const noiseBufSize = Math.floor(ctx.sampleRate * 2);
  const noiseBuf = ctx.createBuffer(1, noiseBufSize, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseBufSize; i++) nd[i] = Math.random() * 2 - 1;
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuf;
  noiseSrc.loop = true;
  noiseSrc.connect(noiseGain);
  noiseGain.connect(noiseMerge);
  try {
    noiseSrc.start(0);
    activeSources.push(noiseSrc);
  } catch {}
  head = noiseMerge;

  // Delay & Feedback
  const delayDry = ctx.createGain();
  const delayWet = ctx.createGain();
  const delayNode = ctx.createDelay(2);
  const delayFb = ctx.createGain();
  const delayMerge = ctx.createGain();

  head.connect(delayDry);
  head.connect(delayNode);
  delayNode.connect(delayFb);
  delayFb.connect(delayNode);
  delayNode.connect(delayWet);
  delayDry.connect(delayMerge);
  delayWet.connect(delayMerge);
  head = delayMerge;

  // Chorus / Modulated Delay
  const chorusDry = ctx.createGain();
  const chorusWet = ctx.createGain();
  const chorusDelay = ctx.createDelay(0.05);
  chorusDelay.delayTime.value = 0.012;
  const chorusLfo = ctx.createOscillator();
  chorusLfo.type = 'sine';
  chorusLfo.frequency.value = 1.4;
  const chorusLfoGain = ctx.createGain();
  chorusLfoGain.gain.value = 0.004;
  chorusLfo.connect(chorusLfoGain);
  chorusLfoGain.connect(chorusDelay.delayTime);
  const chorusMerge = ctx.createGain();

  head.connect(chorusDry);
  head.connect(chorusDelay);
  chorusDelay.connect(chorusWet);
  chorusDry.connect(chorusMerge);
  chorusWet.connect(chorusMerge);
  try {
    chorusLfo.start(0);
    activeOscs.push(chorusLfo);
  } catch {}
  head = chorusMerge;

  // Tremolo
  const tremoloGain = ctx.createGain();
  const tremoloLfo = ctx.createOscillator();
  tremoloLfo.type = 'sine';
  const tremoloDepth = ctx.createGain();
  tremoloLfo.connect(tremoloDepth);
  tremoloDepth.connect(tremoloGain.gain);
  head.connect(tremoloGain);
  try {
    tremoloLfo.start(0);
    activeOscs.push(tremoloLfo);
  } catch {}
  head = tremoloGain;

  // Reverb Convolver
  const reverbDry = ctx.createGain();
  const reverbWet = ctx.createGain();
  const convolver = ctx.createConvolver();
  const reverbMerge = ctx.createGain();

  head.connect(reverbDry);
  head.connect(convolver);
  convolver.connect(reverbWet);
  reverbDry.connect(reverbMerge);
  reverbWet.connect(reverbMerge);
  head = reverbMerge;

  // Dynamics Compressor & Master Gain
  const comp = ctx.createDynamicsCompressor();
  comp.attack.value = 0.005;
  comp.release.value = 0.12;

  const outGain = ctx.createGain();
  head.connect(comp);
  comp.connect(outGain);

  let currentReverbDecay = -1;
  let currentReverbSize = -1;

  function updateFx(fx: FxConfig) {
    hp.frequency.value = Math.max(20, fx.highpass);
    lp.frequency.value = Math.min(20000, fx.lowpass);
    bass.gain.value = fx.bass || 0;
    mid.gain.value = fx.mid || 0;
    treble.gain.value = fx.treble || 0;

    // Bandpass
    const bpMix = Math.max(0, Math.min(1, fx.bpMix || 0));
    dryBpG.gain.value = 1 - bpMix;
    wetBpG.gain.value = bpMix;
    bpFilter.frequency.value = Math.max(50, fx.bpFreq || 1200);
    bpFilter.Q.value = Math.max(0.2, fx.bpQ || 1);

    // Distortion
    const dist = fx.distortion || 0;
    if (dist > 0.001) {
      const n = 256;
      const curve = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = (i * 2) / n - 1;
        curve[i] = ((1 + dist * 4) * x) / (1 + dist * 4 * Math.abs(x));
      }
      shaper.curve = curve;
    } else {
      shaper.curve = null;
    }

    // Ring mod
    const ring = fx.ringFreq || 0;
    if (ring > 0.1) {
      ringDry.gain.value = 0.35;
      ringDepth.gain.value = 0.65;
      ringOsc.frequency.value = ring;
    } else {
      ringDry.gain.value = 1;
      ringDepth.gain.value = 0;
    }

    // Noise
    noiseGain.gain.value = fx.noiseMix || 0;

    // Delay
    const dMix = Math.max(0, Math.min(1, fx.delayMix || 0));
    delayDry.gain.value = 1 - dMix;
    delayWet.gain.value = dMix;
    delayNode.delayTime.value = Math.min(1.5, Math.max(0, fx.delayTime || 0));
    delayFb.gain.value = Math.min(0.9, fx.delayFeedback || 0);

    // Chorus / Flanger
    const cMix = Math.max(fx.chorus || 0, fx.flanger || 0);
    chorusDry.gain.value = 1 - cMix * 0.7;
    chorusWet.gain.value = cMix * 0.7;
    if (fx.flanger > 0.01) {
      chorusDelay.delayTime.value = 0.004;
      chorusLfo.frequency.value = 0.35;
      chorusLfoGain.gain.value = 0.0025;
    } else {
      chorusDelay.delayTime.value = 0.012;
      chorusLfo.frequency.value = 1.4;
      chorusLfoGain.gain.value = 0.004;
    }

    // Tremolo
    const tMix = fx.tremolo || 0;
    tremoloGain.gain.value = 1 - tMix * 0.5;
    tremoloDepth.gain.value = tMix * 0.5;
    tremoloLfo.frequency.value = fx.tremoloRate || 5;

    // Reverb
    const rMix = Math.max(0, Math.min(1, fx.reverbMix || 0));
    reverbDry.gain.value = 1 - rMix;
    reverbWet.gain.value = rMix;

    if (rMix > 0.001) {
      const decay = fx.reverbDecay || 1.4;
      const size = fx.reverbSize || 0.45;
      if (Math.abs(decay - currentReverbDecay) > 0.05 || Math.abs(size - currentReverbSize) > 0.05) {
        currentReverbDecay = decay;
        currentReverbSize = size;
        convolver.buffer = makeImpulse(ctx, Math.max(0.2, decay), decay, size);
      }
    }

    // Compressor & Master Gain
    comp.threshold.value = fx.compressorThresh ?? -18;
    comp.ratio.value = fx.compressorRatio ?? 3;
    outGain.gain.value = Math.max(0, fx.gain ?? 1);
  }

  updateFx(initialFx);

  return {
    input,
    output: outGain,
    updateFx,
    cleanup() {
      for (const osc of activeOscs) {
        try { osc.stop(); } catch {}
        try { osc.disconnect(); } catch {}
      }
      for (const src of activeSources) {
        try { src.stop(); } catch {}
        try { src.disconnect(); } catch {}
      }
    },
  };
}
