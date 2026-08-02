import { resolveStream } from './api/radioBrowser';
import type { Station } from './types';
import { DEFAULT_FX, FX_PRESETS, buildFxChain, type FxChain, type FxConfig } from './audioFx';
import { DEFAULT_EQ_BANDS, EQ_PRESETS, buildEqChain, type EqBands, type EqChain } from './equalizer';
import {
  loadFxState,
  saveFxState,
  loadEqState,
  saveEqState,
  loadCustomEqPresets,
  saveCustomEqPresets,
  type CustomEqPreset,
} from './storage';

type PlayerListener = () => void;

class AudioPlayer {
  private audio = new Audio();
  private listeners = new Set<PlayerListener>();
  private _station: Station | null = null;
  private _playing = false;
  private _loading = false;
  private _error: string | null = null;
  private _volume = 0.75;
  private _muted = false;
  /** Bumps on every play/stop so in-flight work and stale media events are ignored. */
  private playGeneration = 0;
  /** Generation that currently owns `audio.src` (media events must match this). */
  private mediaGeneration = 0;
  /** Stream URL currently assigned for this generation (used for HTTPS fallback). */
  private activeStreamUrl: string | null = null;
  private triedOriginalFallback = false;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private _userVolume = 0.75;

  // Web Audio FX engine state
  private audioCtx: AudioContext | null = null;
  private mediaSourceNode: MediaElementAudioSourceNode | null = null;
  private fxChain: FxChain | null = null;
  private _fxEnabled = false;
  private _fxPresetId: string | null = 'radio';
  private _customFx: Record<string, number> = {};

  // Graphic Equalizer state
  private eqChain: EqChain | null = null;
  private _eqEnabled = false;
  private _eqPresetId = 'flat';
  private _eqBands: EqBands = { ...DEFAULT_EQ_BANDS };
  private _customEqPresets: CustomEqPreset[] = [];

  constructor() {
    const savedFx = loadFxState();
    this._fxEnabled = savedFx.enabled;
    this._fxPresetId = savedFx.presetId;
    this._customFx = savedFx.customFx || {};

    const savedEq = loadEqState();
    this._eqEnabled = savedEq.enabled;
    this._eqPresetId = savedEq.presetId;
    this._eqBands = savedEq.bands || { ...DEFAULT_EQ_BANDS };
    this._customEqPresets = loadCustomEqPresets();

    this.initAudioElement(this._fxEnabled || this._eqEnabled);
  }

  private initAudioElement(useCors = false, forceRecreate = false) {
    const hasCors = Boolean(this.audio && this.audio.crossOrigin);
    if (!forceRecreate && this.audio && hasCors === useCors) {
      return;
    }

    if (this.audio) {
      try {
        this.audio.pause();
        this.audio.removeAttribute('src');
        this.audio.load();
      } catch {}
    }
    this.audio = new Audio();
    this.audio.preload = 'none';
    this.audio.setAttribute('playsinline', '');
    this.audio.setAttribute('webkit-playsinline', '');
    (this.audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;

    if (useCors) {
      this.audio.crossOrigin = 'anonymous';
    }

    this.mediaSourceNode = null;

    this.audio.addEventListener('playing', () => {
      if (!this.isActiveGeneration()) return;
      this._playing = true;
      this._loading = false;
      this._error = null;
      if (this._fxEnabled || this._eqEnabled) {
        try { this.ensureAudioContext(); } catch {}
      }
      this.emit();
    });
    this.audio.addEventListener('pause', () => {
      if (!this.isActiveGeneration()) return;
      this._playing = false;
      this._loading = false;
      this.emit();
    });
    this.audio.addEventListener('waiting', () => {
      if (!this.isActiveGeneration()) return;
      this._loading = true;
      this.emit();
    });
    this.audio.addEventListener('error', () => {
      if (!this.isActiveGeneration()) return;
      if (!this.triedOriginalFallback && this._station) {
        const original = this._station.url_resolved || this._station.url;
        if (original && original !== this.activeStreamUrl) {
          this.triedOriginalFallback = true;
          this.activeStreamUrl = original;
          this.audio.src = original;
          const gen = this.mediaGeneration;
          void this.audio.play().catch(() => {
            if (gen !== this.playGeneration) return;
            this.failPlayback('Could not play this station. Try another.');
          });
          return;
        }
      }
      this.failPlayback('Could not play this station. Try another.');
    });
    this.audio.addEventListener('ended', () => {
      if (!this.isActiveGeneration()) return;
      this._playing = false;
      this.emit();
    });
  }

  get station() {
    return this._station;
  }
  get playing() {
    return this._playing;
  }
  get loading() {
    return this._loading;
  }
  get error() {
    return this._error;
  }
  get volume() {
    return this._volume;
  }
  get muted() {
    return this._muted;
  }
  get fxEnabled() {
    return this._fxEnabled;
  }
  get fxPresetId() {
    return this._fxPresetId;
  }
  get eqEnabled() {
    return this._eqEnabled;
  }
  get eqPresetId() {
    return this._eqPresetId;
  }
  get eqBands() {
    return this._eqBands;
  }
  get customEqPresets() {
    return this._customEqPresets;
  }

  setEqPreset(presetId: string) {
    this._eqPresetId = presetId;
    const defaultPreset = EQ_PRESETS.find((p) => p.id === presetId);
    const customPreset = this._customEqPresets.find((p) => p.id === presetId);
    if (defaultPreset) {
      this._eqBands = { ...defaultPreset.bands };
    } else if (customPreset) {
      this._eqBands = { ...customPreset.bands };
    }
    saveEqState({ enabled: this._eqEnabled, presetId: this._eqPresetId, bands: this._eqBands });
    if (this._eqEnabled) {
      this.ensureAudioContext();
    }
    if (this.eqChain) {
      this.eqChain.updateBands(this._eqBands);
    }
    this.emit();
  }

  saveCustomEqPreset(name: string): CustomEqPreset {
    const trimmed = name.trim() || 'Custom Preset';
    const id = 'custom-' + Date.now();
    const preset: CustomEqPreset = {
      id,
      name: trimmed,
      bands: { ...this._eqBands },
    };
    this._customEqPresets = [preset, ...this._customEqPresets];
    saveCustomEqPresets(this._customEqPresets);
    this.setEqPreset(id);
    return preset;
  }

  deleteCustomEqPreset(id: string) {
    this._customEqPresets = this._customEqPresets.filter((p) => p.id !== id);
    saveCustomEqPresets(this._customEqPresets);
    if (this._eqPresetId === id) {
      this._eqPresetId = 'custom';
      saveEqState({ enabled: this._eqEnabled, presetId: this._eqPresetId, bands: this._eqBands });
    }
    this.emit();
  }

  ensureAudioContext(): AudioContext | null {
    if (!this._fxEnabled && !this._eqEnabled) return null;
    if (!this.audioCtx) {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();
    }
    if (this.audioCtx.state === 'suspended') {
      void this.audioCtx.resume();
    }
    if (this.audioCtx && (this._fxEnabled || this._eqEnabled)) {
      if (!this.mediaSourceNode) {
        try {
          this.mediaSourceNode = this.audioCtx.createMediaElementSource(this.audio);
        } catch {
          // Non-fatal
        }
      }
      this.rebuildAudioPipeline();
    }
    return this.audioCtx;
  }

  private getCombinedFxConfig(): FxConfig {
    const preset = FX_PRESETS.find((p) => p.id === this._fxPresetId);
    const baseFx = preset ? preset.fx : {};
    return {
      ...DEFAULT_FX,
      ...baseFx,
      ...this._customFx,
    };
  }

  rebuildAudioPipeline() {
    if (!this.audioCtx || !this.mediaSourceNode) return;

    try {
      this.mediaSourceNode.disconnect();
    } catch {}

    if (this.fxChain) {
      try {
        this.fxChain.input.disconnect();
        this.fxChain.output.disconnect();
        this.fxChain.cleanup();
      } catch {}
      this.fxChain = null;
    }

    if (this.eqChain) {
      try {
        this.eqChain.input.disconnect();
        this.eqChain.output.disconnect();
        this.eqChain.cleanup();
      } catch {}
      this.eqChain = null;
    }

    if (this._fxEnabled && this.audioCtx) {
      try {
        const config = this.getCombinedFxConfig();
        this.fxChain = buildFxChain(this.audioCtx, config);
      } catch {}
    }

    if (this._eqEnabled && this.audioCtx) {
      try {
        this.eqChain = buildEqChain(this.audioCtx, this._eqBands);
      } catch {}
    }

    // Connect node chain: mediaSourceNode -> [fxChain] -> [eqChain] -> destination
    try {
      let head: AudioNode = this.mediaSourceNode;
      if (this.fxChain) {
        head.connect(this.fxChain.input);
        head = this.fxChain.output;
      }
      if (this.eqChain) {
        head.connect(this.eqChain.input);
        head = this.eqChain.output;
      }
      head.connect(this.audioCtx.destination);
    } catch {
      // Fallback
    }
  }

  setFxEnabled(enabled: boolean) {
    const prevWebAudio = this._fxEnabled || this._eqEnabled;
    this._fxEnabled = enabled;
    saveFxState({ enabled: this._fxEnabled, presetId: this._fxPresetId, customFx: this._customFx });

    const nextWebAudio = this._fxEnabled || this._eqEnabled;
    if (prevWebAudio !== nextWebAudio) {
      this.handleWebAudioToggle(nextWebAudio);
    } else if (enabled) {
      this.ensureAudioContext();
    }
    this.emit();
  }

  setFxPreset(presetId: string | null) {
    this._fxPresetId = presetId;
    saveFxState({ enabled: this._fxEnabled, presetId: this._fxPresetId, customFx: this._customFx });
    if (this._fxEnabled) {
      this.ensureAudioContext();
    }
    if (this.fxChain) {
      this.fxChain.updateFx(this.getCombinedFxConfig());
    }
    this.emit();
  }

  setEqEnabled(enabled: boolean) {
    const prevWebAudio = this._fxEnabled || this._eqEnabled;
    this._eqEnabled = enabled;
    saveEqState({ enabled: this._eqEnabled, presetId: this._eqPresetId, bands: this._eqBands });

    const nextWebAudio = this._fxEnabled || this._eqEnabled;
    if (prevWebAudio !== nextWebAudio) {
      this.handleWebAudioToggle(nextWebAudio);
    } else if (enabled) {
      this.ensureAudioContext();
    }
    this.emit();
  }

  setEqBand(bandKey: keyof EqBands, value: number) {
    this._eqBands = { ...this._eqBands, [bandKey]: value };
    this._eqPresetId = 'custom';
    saveEqState({ enabled: this._eqEnabled, presetId: this._eqPresetId, bands: this._eqBands });
    if (this._eqEnabled) {
      this.ensureAudioContext();
    }
    if (this.eqChain) {
      this.eqChain.updateBands(this._eqBands);
    }
    this.emit();
  }

  private handleWebAudioToggle(enableWebAudio: boolean) {
    const wasPlaying = this._playing;
    const currentUrl = this.activeStreamUrl;

    if (this.fxChain) {
      try {
        this.fxChain.input.disconnect();
        this.fxChain.output.disconnect();
        this.fxChain.cleanup();
      } catch {}
      this.fxChain = null;
    }
    if (this.eqChain) {
      try {
        this.eqChain.input.disconnect();
        this.eqChain.output.disconnect();
        this.eqChain.cleanup();
      } catch {}
      this.eqChain = null;
    }
    if (this.mediaSourceNode) {
      try { this.mediaSourceNode.disconnect(); } catch {}
      this.mediaSourceNode = null;
    }

    this.initAudioElement(enableWebAudio, true);

    if (currentUrl && wasPlaying) {
      this.audio.src = currentUrl;
      this.audio.volume = this._muted ? 0 : this._userVolume;
      if (enableWebAudio) {
        try { this.ensureAudioContext(); } catch {}
      }
      void this.audio.play().catch(() => {
        if (enableWebAudio) {
          // Play in non-CORS fallback mode for this stream without resetting user preferences
          this.initAudioElement(false, true);
          this.audio.src = currentUrl;
          this.audio.volume = this._muted ? 0 : this._userVolume;
          void this.audio.play();
        }
      });
    }
  }


  /** True when an audio element has a stream URL assigned (may still be paused). */
  get hasSource() {
    return Boolean(this.audio.src);
  }

  subscribe(fn: PlayerListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private isActiveGeneration(): boolean {
    return this.mediaGeneration > 0 && this.mediaGeneration === this.playGeneration;
  }

  private failPlayback(message: string) {
    this._playing = false;
    this._loading = false;
    this._error = message;
    this.emit();
  }

  /**
   * Set volume on the element. Does not emit — callers already own the UI value
   * and full re-renders on every slider tick thrash focus.
   */
  setVolume(v: number) {
    this._userVolume = Math.min(1, Math.max(0, v));
    this._volume = this._userVolume;
    this.cancelFade();
    this.audio.volume = this._muted ? 0 : this._volume;
  }

  setMuted(m: boolean, opts?: { silent?: boolean }) {
    this._muted = m;
    this.audio.volume = m ? 0 : this._volume;
    if (!opts?.silent) this.emit();
  }

  /** Soft fade-in over ~400ms when a station starts. */
  private softFadeIn() {
    this.cancelFade();
    const target = this._muted ? 0 : this._userVolume;
    if (target <= 0) {
      this.audio.volume = 0;
      return;
    }
    this.audio.volume = 0;
    const steps = 8;
    let i = 0;
    this.fadeTimer = setInterval(() => {
      i++;
      this.audio.volume = target * (i / steps);
      if (i >= steps) this.cancelFade();
    }, 50);
  }

  /** Fade out then invoke callback (for sleep timer). */
  fadeOutThen(ms: number, done: () => void) {
    this.cancelFade();
    const start = this.audio.volume;
    if (start <= 0.01 || this._muted) {
      done();
      return;
    }
    const steps = Math.max(6, Math.floor(ms / 50));
    let i = 0;
    this.fadeTimer = setInterval(() => {
      i++;
      this.audio.volume = start * (1 - i / steps);
      if (i >= steps) {
        this.cancelFade();
        done();
      }
    }, 50);
  }

  private cancelFade() {
    if (this.fadeTimer != null) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
  }

  private raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), ms);
      promise.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        }
      );
    });
  }

  async play(station: Station) {
    const gen = ++this.playGeneration;
    this._station = station;
    this._loading = true;
    this._error = null;
    this._playing = false;
    this.activeStreamUrl = null;
    this.triedOriginalFallback = false;
    this.cancelFade();
    this.emit();

    const useWebAudio = this._fxEnabled || this._eqEnabled;
    this.initAudioElement(useWebAudio, false);
    if (useWebAudio) {
      try { this.ensureAudioContext(); } catch {}
    }
    this.audio.volume = this._muted ? 0 : this._userVolume;

    // Prefer click-counted resolve URL, but never hang surprise/play on a dead API.
    let streamUrl: string | null = null;
    try {
      const resolved = await this.raceTimeout(resolveStream(station.stationuuid), 6_000);
      streamUrl = resolved || station.url_resolved || station.url || null;
    } catch {
      streamUrl = station.url_resolved || station.url || null;
    }

    if (gen !== this.playGeneration) return;

    if (!streamUrl) {
      this._loading = false;
      this._error = 'No stream URL available.';
      this.emit();
      return;
    }

    const originalUrl = station.url_resolved || station.url || streamUrl;

    if (location.protocol === 'https:' && streamUrl.startsWith('http:')) {
      streamUrl = streamUrl.replace(/^http:/, 'https:');
    }

    this.mediaGeneration = gen;
    this.activeStreamUrl = streamUrl;
    this.audio.src = streamUrl;
    this.audio.volume = this._muted ? 0 : this._userVolume;

    const tryPlay = async (url: string) => {
      this.activeStreamUrl = url;
      this.audio.src = url;
      // Some streams never settle play(); bound it so Surprise can skip ahead.
      await this.raceTimeout(this.audio.play(), 5_000);
    };

    try {
      await tryPlay(streamUrl);
      if (gen !== this.playGeneration) return;
      // play() resolved ⇒ playback has started (may still buffer).
      this._playing = true;
      this._loading = false;
      this._error = null;
      this.softFadeIn();
      this.emit();
    } catch (err) {
      if (gen !== this.playGeneration) return;

      if (originalUrl && originalUrl !== streamUrl) {
        try {
          this.triedOriginalFallback = true;
          await tryPlay(originalUrl);
          if (gen !== this.playGeneration) return;
          this._playing = true;
          this._loading = false;
          this._error = null;
          this.softFadeIn();
          this.emit();
          return;
        } catch {
          // fall through
        }
      }
      if (gen !== this.playGeneration) return;
      this._loading = false;
      this._playing = false;
      this._error =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Click play to start audio.'
          : 'Could not play this station. Try another.';
      this.emit();
    }
  }

  /**
   * Wait until the current play attempt is clearly playing, has failed,
   * was superseded, or times out. Used by Surprise Me retries.
   */
  waitForOutcome(
    timeoutMs = 8_000
  ): Promise<'playing' | 'error' | 'timeout' | 'cancelled'> {
    return new Promise((resolve) => {
      const gen = this.playGeneration;
      if (gen === 0) {
        resolve('cancelled');
        return;
      }
      // Buffering after start still counts as success for live radio.
      if (this.mediaGeneration === gen && this._playing) {
        resolve('playing');
        return;
      }
      if (this.mediaGeneration === gen && this._error && !this._loading) {
        resolve('error');
        return;
      }

      let settled = false;
      const finish = (result: 'playing' | 'error' | 'timeout' | 'cancelled') => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.listeners.delete(onChange);
        resolve(result);
      };

      const onChange = () => {
        if (this.playGeneration !== gen) {
          finish('cancelled');
          return;
        }
        if (this.mediaGeneration === gen && this._playing) {
          finish('playing');
          return;
        }
        if (this._error && !this._loading) {
          finish('error');
        }
      };

      const timer = setTimeout(() => {
        if (this.playGeneration !== gen) {
          finish('cancelled');
          return;
        }
        if (this._playing) finish('playing');
        else if (this._error) finish('error');
        else finish('timeout');
      }, timeoutMs);

      this.listeners.add(onChange);
      // Re-check in case state flipped between schedule and subscribe.
      onChange();
    });
  }

  /**
   * Pause if playing; otherwise resume or start the loaded station.
   * When nothing is loaded, pass `fallback` to start that station
   * (used after reload when UI still shows last station).
   */
  toggle(fallback?: Station | null) {
    if (!this._station) {
      if (fallback) void this.play(fallback);
      return;
    }
    if (this._playing) {
      this.audio.pause();
      return;
    }
    if (this.audio.src) {
      this._loading = true;
      this._error = null;
      this.emit();
      const gen = this.playGeneration;
      void this.audio.play().catch(() => {
        if (gen !== this.playGeneration) return;
        // Stale src after long pause / network loss — full reconnect.
        void this.play(this._station!);
      });
      return;
    }
    void this.play(this._station);
  }

  pause() {
    this.audio.pause();
  }

  /**
   * Hard-stop: cancel in-flight play generations, detach stream, clear station.
   * Any pending resolve/play/error handlers see a stale generation and no-op.
   */
  stop() {
    this.playGeneration++;
    this.mediaGeneration = 0;
    this.cancelFade();
    this.audio.pause();
    this.audio.removeAttribute('src');
    try {
      this.audio.load();
    } catch {
      // ignore
    }
    this.activeStreamUrl = null;
    this.triedOriginalFallback = false;
    this._station = null;
    this._playing = false;
    this._loading = false;
    this._error = null;
    this.emit();
  }
}

export const player = new AudioPlayer();
