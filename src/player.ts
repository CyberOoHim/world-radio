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

function getAudioContextClass(): typeof AudioContext {
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  );
}

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
  /** Master output gain after FX/EQ — preferred volume path when Web Audio is active. */
  private masterGain: GainNode | null = null;
  private fxChain: FxChain | null = null;
  private _fxEnabled = false;
  private _fxPresetId: string | null = 'radio';
  private _customFx: Record<string, number> = {};
  /** Tracks which FX/EQ enable combo the current graph was built for. */
  private pipelineKey: string | null = null;
  /** True when MediaElementSource is connected into a live graph. */
  private _webAudioRouted = false;
  private visibilityBound = false;
  private unlockBound = false;
  /** Timer for detecting silent Web Audio output (CORS-tainted MES on some mobile browsers). */
  private silenceWatchTimer: ReturnType<typeof setTimeout> | null = null;

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
    this.bindVisibilityResume();
  }

  /**
   * Call from a user gesture (pointer/touch/click) so iOS/Android unlock
   * Web Audio. Safe to call repeatedly. Mirrors voice-changer unlock pattern.
   */
  async unlockAudio(): Promise<void> {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (getAudioContextClass())();
      }
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }
      // Silent one-shot buffer helps fully unlock WebKit audio on iPad/iPhone.
      if (this.audioCtx.state === 'running') {
        const buf = this.audioCtx.createBuffer(1, 1, this.audioCtx.sampleRate || 44100);
        const src = this.audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(this.audioCtx.destination);
        try {
          src.start(0);
        } catch {
          // ignore
        }
        try {
          src.disconnect();
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore — unlock is best-effort
    }
  }

  /**
   * Install once: first pointer/touch/key gesture unlocks AudioContext
   * (required on iPad Safari before FX/EQ can be heard).
   */
  installGestureUnlock(): void {
    if (this.unlockBound) return;
    this.unlockBound = true;
    const unlock = () => {
      void this.unlockAudio();
    };
    window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
    window.addEventListener('touchstart', unlock, { capture: true, passive: true });
    window.addEventListener('keydown', unlock, { capture: true });
  }

  private bindVisibilityResume() {
    if (this.visibilityBound || typeof document === 'undefined') return;
    this.visibilityBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void this.resumeAudioContext();
      }
    });
    window.addEventListener('pageshow', () => {
      void this.resumeAudioContext();
    });
  }

  private async resumeAudioContext(): Promise<void> {
    if (!this.audioCtx) return;
    if (this.audioCtx.state === 'suspended') {
      try {
        await this.audioCtx.resume();
      } catch {
        // ignore
      }
    }
  }

  /** Keep the media element in the document — more reliable for WebKit routing. */
  private mountAudioElement(el: HTMLAudioElement) {
    if (typeof document === 'undefined' || !document.body) return;
    if (el.isConnected) return;
    el.setAttribute('aria-hidden', 'true');
    el.style.position = 'fixed';
    el.style.width = '0';
    el.style.height = '0';
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    el.tabIndex = -1;
    document.body.appendChild(el);
  }

  private initAudioElement(useCors = false, forceRecreate = false) {
    const hasCors = Boolean(this.audio && this.audio.crossOrigin);
    if (!forceRecreate && this.audio && hasCors === useCors) {
      this.mountAudioElement(this.audio);
      return;
    }

    if (this.audio) {
      try {
        this.audio.pause();
        this.audio.removeAttribute('src');
        this.audio.load();
      } catch {
        // ignore
      }
      try {
        if (this.audio.isConnected) this.audio.remove();
      } catch {
        // ignore
      }
    }

    // Detach any prior MediaElementSource — a new element needs a new source node.
    this.mediaSourceNode = null;
    this.pipelineKey = null;
    this._webAudioRouted = false;
    this.teardownGraphNodesOnly();

    this.audio = new Audio();
    this.audio.preload = 'none';
    this.audio.setAttribute('playsinline', '');
    this.audio.setAttribute('webkit-playsinline', '');
    (this.audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;

    if (useCors) {
      // Required for createMediaElementSource on cross-origin radio streams.
      this.audio.crossOrigin = 'anonymous';
    }

    this.mountAudioElement(this.audio);

    this.audio.addEventListener('playing', () => {
      if (!this.isActiveGeneration()) return;
      this._playing = true;
      this._loading = false;
      this._error = null;
      if (this._fxEnabled || this._eqEnabled) {
        // iOS may suspend the context while buffering; re-attach if graph dropped.
        void this.ensureAudioContext(!this._webAudioRouted);
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

  /** Disconnect FX/EQ/master nodes without disposing the AudioContext. */
  private teardownGraphNodesOnly() {
    if (this.fxChain) {
      try {
        this.fxChain.input.disconnect();
        this.fxChain.output.disconnect();
        this.fxChain.cleanup();
      } catch {
        // ignore
      }
      this.fxChain = null;
    }
    if (this.eqChain) {
      try {
        this.eqChain.input.disconnect();
        this.eqChain.output.disconnect();
        this.eqChain.cleanup();
      } catch {
        // ignore
      }
      this.eqChain = null;
    }
    if (this.masterGain) {
      try {
        this.masterGain.disconnect();
      } catch {
        // ignore
      }
      this.masterGain = null;
    }
    if (this.mediaSourceNode) {
      try {
        this.mediaSourceNode.disconnect();
      } catch {
        // ignore
      }
    }
    this.pipelineKey = null;
    this._webAudioRouted = false;
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
  /** Whether audio is currently routed through the Web Audio FX/EQ graph. */
  get webAudioRouted() {
    return this._webAudioRouted;
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
      void this.ensureAudioContext();
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

  private desiredPipelineKey(): string {
    return `fx:${this._fxEnabled ? 1 : 0}|eq:${this._eqEnabled ? 1 : 0}`;
  }

  /**
   * Create/resume AudioContext, attach MediaElementSource, build FX/EQ graph.
   * @param forceRebuild rebuild the node graph even if enable flags are unchanged
   */
  async ensureAudioContext(forceRebuild = false): Promise<AudioContext | null> {
    if (!this._fxEnabled && !this._eqEnabled) return null;

    if (!this.audioCtx) {
      this.audioCtx = new (getAudioContextClass())();
    }

    await this.resumeAudioContext();

    this.mountAudioElement(this.audio);

    // MediaElementSource requires CORS on cross-origin streams.
    if (!this.audio.crossOrigin) {
      // Element was created without CORS (dry fallback). Cannot process — leave dry.
      this._webAudioRouted = false;
      return this.audioCtx;
    }

    if (!this.mediaSourceNode) {
      try {
        this.mediaSourceNode = this.audioCtx.createMediaElementSource(this.audio);
        forceRebuild = true;
      } catch {
        // Already bound to a source on this element, or invalid state.
        // If we lost our reference, we cannot re-bind — leave dry until element recreate.
        this._webAudioRouted = false;
        return this.audioCtx;
      }
    }

    const key = this.desiredPipelineKey();
    if (forceRebuild || this.pipelineKey !== key || !this._webAudioRouted) {
      this.rebuildAudioPipeline();
    } else {
      // Context may have been suspended; volume node may need refresh.
      this.applyOutputVolume();
    }

    // Second resume after graph connect — critical on iPad after async stream resolve.
    await this.resumeAudioContext();

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
    if (!this.audioCtx || !this.mediaSourceNode) {
      this._webAudioRouted = false;
      this.pipelineKey = null;
      return;
    }

    // Disconnect prior graph but keep MediaElementSource node (cannot recreate on same element).
    if (this.fxChain) {
      try {
        this.fxChain.input.disconnect();
        this.fxChain.output.disconnect();
        this.fxChain.cleanup();
      } catch {
        // ignore
      }
      this.fxChain = null;
    }

    if (this.eqChain) {
      try {
        this.eqChain.input.disconnect();
        this.eqChain.output.disconnect();
        this.eqChain.cleanup();
      } catch {
        // ignore
      }
      this.eqChain = null;
    }

    if (this.masterGain) {
      try {
        this.masterGain.disconnect();
      } catch {
        // ignore
      }
      this.masterGain = null;
    }

    try {
      this.mediaSourceNode.disconnect();
    } catch {
      // ignore
    }

    if (this._fxEnabled) {
      try {
        const config = this.getCombinedFxConfig();
        this.fxChain = buildFxChain(this.audioCtx, config);
      } catch {
        this.fxChain = null;
      }
    }

    if (this._eqEnabled) {
      try {
        this.eqChain = buildEqChain(this.audioCtx, this._eqBands);
      } catch {
        this.eqChain = null;
      }
    }

    // Master gain after FX/EQ — reliable volume on iOS (element.volume alone is flaky with MES).
    this.masterGain = this.audioCtx.createGain();
    this.applyOutputVolume();

    // mediaSource → [fx] → [eq] → masterGain → destination
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
      head.connect(this.masterGain);
      this.masterGain.connect(this.audioCtx.destination);

      // Keep media element volume at unity when Web Audio owns level (masterGain).
      this.audio.volume = 1;

      this.pipelineKey = this.desiredPipelineKey();
      this._webAudioRouted = true;
    } catch {
      this._webAudioRouted = false;
      this.pipelineKey = null;
    }
  }

  private applyOutputVolume() {
    const level = this._muted ? 0 : this._userVolume;
    if (this.masterGain && this._webAudioRouted) {
      try {
        const g = this.masterGain.gain;
        const ctx = this.audioCtx;
        if (ctx) {
          g.cancelScheduledValues(ctx.currentTime);
          g.setValueAtTime(level, ctx.currentTime);
        } else {
          g.value = level;
        }
      } catch {
        this.masterGain.gain.value = level;
      }
      // Element stays at 1 when Web Audio routes volume.
      try {
        this.audio.volume = 1;
      } catch {
        // ignore
      }
    } else {
      try {
        this.audio.volume = level;
      } catch {
        // ignore
      }
    }
  }

  setFxEnabled(enabled: boolean) {
    const prevWebAudio = this._fxEnabled || this._eqEnabled;
    this._fxEnabled = enabled;
    saveFxState({ enabled: this._fxEnabled, presetId: this._fxPresetId, customFx: this._customFx });

    const nextWebAudio = this._fxEnabled || this._eqEnabled;
    if (prevWebAudio !== nextWebAudio) {
      void this.handleWebAudioToggle(nextWebAudio);
    } else if (enabled) {
      void this.ensureAudioContext(true);
    } else if (this.fxChain) {
      // FX off but EQ still on — rebuild without FX chain.
      void this.ensureAudioContext(true);
    }
    this.emit();
  }

  setFxPreset(presetId: string | null) {
    this._fxPresetId = presetId;
    saveFxState({ enabled: this._fxEnabled, presetId: this._fxPresetId, customFx: this._customFx });
    if (this._fxEnabled) {
      // Prefer in-place param update; only ensure graph if missing.
      if (!this.fxChain || !this._webAudioRouted) {
        void this.ensureAudioContext(true).then(() => {
          if (this.fxChain) this.fxChain.updateFx(this.getCombinedFxConfig());
        });
      } else {
        void this.resumeAudioContext();
        this.fxChain.updateFx(this.getCombinedFxConfig());
      }
    }
    this.emit();
  }

  setEqEnabled(enabled: boolean) {
    const prevWebAudio = this._fxEnabled || this._eqEnabled;
    this._eqEnabled = enabled;
    saveEqState({ enabled: this._eqEnabled, presetId: this._eqPresetId, bands: this._eqBands });

    const nextWebAudio = this._fxEnabled || this._eqEnabled;
    if (prevWebAudio !== nextWebAudio) {
      void this.handleWebAudioToggle(nextWebAudio);
    } else if (enabled) {
      void this.ensureAudioContext(true);
    } else if (this.eqChain) {
      void this.ensureAudioContext(true);
    }
    this.emit();
  }

  setEqBand(bandKey: keyof EqBands, value: number) {
    this._eqBands = { ...this._eqBands, [bandKey]: value };
    this._eqPresetId = 'custom';
    saveEqState({ enabled: this._eqEnabled, presetId: this._eqPresetId, bands: this._eqBands });
    if (this._eqEnabled) {
      if (!this.eqChain || !this._webAudioRouted) {
        void this.ensureAudioContext(true).then(() => {
          if (this.eqChain) this.eqChain.updateBands(this._eqBands);
        });
      } else {
        void this.resumeAudioContext();
        this.eqChain.updateBands(this._eqBands);
      }
    }
    this.emit();
  }

  private async handleWebAudioToggle(enableWebAudio: boolean) {
    const wasPlaying = this._playing;
    const currentUrl = this.activeStreamUrl;

    this.teardownGraphNodesOnly();
    if (this.mediaSourceNode) {
      try {
        this.mediaSourceNode.disconnect();
      } catch {
        // ignore
      }
      this.mediaSourceNode = null;
    }

    // Recreate element: MediaElementSource cannot be undone without a new element.
    this.initAudioElement(enableWebAudio, true);

    if (currentUrl && wasPlaying) {
      this.audio.src = currentUrl;
      this.applyOutputVolume();

      if (enableWebAudio) {
        // Must unlock/resume inside the enabling gesture (toggle click).
        await this.unlockAudio();
        await this.ensureAudioContext(true);
      }

      try {
        await this.audio.play();
        if (enableWebAudio) {
          await this.ensureAudioContext(true);
          await this.resumeAudioContext();
          this.watchForSilentWebAudio(this.playGeneration);
        }
        this._playing = true;
        this._loading = false;
        this._error = null;
        this.softFadeIn();
        this.emit();
      } catch {
        if (enableWebAudio) {
          // CORS or autoplay failure: fall back to dry element play.
          // Keep user FX/EQ prefs so next station can still try Web Audio.
          this.teardownGraphNodesOnly();
          this.mediaSourceNode = null;
          this.initAudioElement(false, true);
          this.audio.src = currentUrl;
          this.applyOutputVolume();
          try {
            await this.audio.play();
            this._playing = true;
            this._loading = false;
            this._error = null;
            this.softFadeIn();
            this.emit();
          } catch {
            this.failPlayback('Could not play this station. Try another.');
          }
        }
      }
    } else if (enableWebAudio) {
      // Not playing — still unlock context so next play routes correctly on iPad.
      await this.unlockAudio();
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
   * Set volume on the element / Web Audio master gain. Does not emit —
   * callers already own the UI value and full re-renders thrash focus.
   */
  setVolume(v: number) {
    this._userVolume = Math.min(1, Math.max(0, v));
    this._volume = this._userVolume;
    this.cancelFade();
    this.applyOutputVolume();
  }

  setMuted(m: boolean, opts?: { silent?: boolean }) {
    this._muted = m;
    this.applyOutputVolume();
    if (!opts?.silent) this.emit();
  }

  /** Soft fade-in over ~400ms when a station starts. */
  private softFadeIn() {
    this.cancelFade();
    const target = this._muted ? 0 : this._userVolume;
    if (target <= 0) {
      this.applyOutputVolume();
      return;
    }

    const useMaster = Boolean(this.masterGain && this._webAudioRouted && this.audioCtx);
    if (useMaster && this.masterGain && this.audioCtx) {
      try {
        const g = this.masterGain.gain;
        const now = this.audioCtx.currentTime;
        g.cancelScheduledValues(now);
        g.setValueAtTime(0, now);
        g.linearRampToValueAtTime(target, now + 0.4);
        this.audio.volume = 1;
        return;
      } catch {
        // fall through to stepped fade
      }
    }

    if (useMaster && this.masterGain) {
      this.masterGain.gain.value = 0;
    } else {
      this.audio.volume = 0;
    }
    const steps = 8;
    let i = 0;
    this.fadeTimer = setInterval(() => {
      i++;
      const level = target * (i / steps);
      if (this.masterGain && this._webAudioRouted) {
        this.masterGain.gain.value = level;
        this.audio.volume = 1;
      } else {
        this.audio.volume = level;
      }
      if (i >= steps) this.cancelFade();
    }, 50);
  }

  /** Fade out then invoke callback (for sleep timer). */
  fadeOutThen(ms: number, done: () => void) {
    this.cancelFade();
    const useMaster = Boolean(this.masterGain && this._webAudioRouted);
    const start = useMaster && this.masterGain ? this.masterGain.gain.value : this.audio.volume;
    if (start <= 0.01 || this._muted) {
      done();
      return;
    }
    const steps = Math.max(6, Math.floor(ms / 50));
    let i = 0;
    this.fadeTimer = setInterval(() => {
      i++;
      const level = start * (1 - i / steps);
      if (useMaster && this.masterGain) {
        this.masterGain.gain.value = level;
      } else {
        this.audio.volume = level;
      }
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
    // Hold current Web Audio gain and cancel any softFadeIn ramp.
    if (this.masterGain && this.audioCtx) {
      try {
        const g = this.masterGain.gain;
        const now = this.audioCtx.currentTime;
        const held = g.value;
        g.cancelScheduledValues(now);
        g.setValueAtTime(held, now);
      } catch {
        // ignore
      }
    }
  }

  private clearSilenceWatch() {
    if (this.silenceWatchTimer != null) {
      clearTimeout(this.silenceWatchTimer);
      this.silenceWatchTimer = null;
    }
  }

  private measureGraphLevel(analyser: AnalyserNode): number {
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(data);
    let sumDev = 0;
    for (let i = 0; i < data.length; i++) {
      sumDev += Math.abs(data[i] - 128);
    }
    return sumDev / data.length;
  }

  /**
   * Mobile WebKit: AudioContext can stay suspended or MediaElementSource can
   * output silence after async stream resolve. Recover by resume → rebuild,
   * and only fall back to dry element play if the graph stays silent so the
   * user still hears radio (FX prefs remain for the next CORS-capable stream).
   */
  private watchForSilentWebAudio(gen: number) {
    this.clearSilenceWatch();
    if (!this._webAudioRouted || !this.audioCtx || !this.mediaSourceNode) return;

    this.silenceWatchTimer = setTimeout(() => {
      void (async () => {
        this.silenceWatchTimer = null;
        if (gen !== this.playGeneration || !this._webAudioRouted || !this._playing) return;
        if (!this.audioCtx || !this.mediaSourceNode) return;

        let analyser: AnalyserNode | null = null;
        try {
          analyser = this.audioCtx.createAnalyser();
          analyser.fftSize = 256;
          (this.masterGain || this.mediaSourceNode).connect(analyser);

          let level = this.measureGraphLevel(analyser);
          if (level >= 0.5) {
            analyser.disconnect();
            return;
          }

          // 1) Resume suspended context (common on iPad after await).
          await this.resumeAudioContext();
          await new Promise((r) => setTimeout(r, 200));
          if (gen !== this.playGeneration) {
            analyser.disconnect();
            return;
          }
          level = this.measureGraphLevel(analyser);
          if (level >= 0.5) {
            analyser.disconnect();
            return;
          }

          // 2) Rebuild graph and re-measure.
          try {
            analyser.disconnect();
          } catch {
            // ignore
          }
          await this.ensureAudioContext(true);
          await this.resumeAudioContext();
          if (gen !== this.playGeneration || !this._webAudioRouted || !this.audioCtx) return;

          analyser = this.audioCtx.createAnalyser();
          analyser.fftSize = 256;
          (this.masterGain || this.mediaSourceNode!).connect(analyser);
          await new Promise((r) => setTimeout(r, 300));
          if (gen !== this.playGeneration) {
            analyser.disconnect();
            return;
          }
          level = this.measureGraphLevel(analyser);
          try {
            analyser.disconnect();
          } catch {
            // ignore
          }

          if (level >= 0.5) return;

          // 3) Still silent while element is playing ⇒ dry fallback (hear radio).
          if (this.activeStreamUrl && !this.audio.paused) {
            const url = this.activeStreamUrl;
            this.teardownGraphNodesOnly();
            this.mediaSourceNode = null;
            this.initAudioElement(false, true);
            this.audio.src = url;
            this.applyOutputVolume();
            void this.audio.play().catch(() => {
              // ignore
            });
          }
        } catch {
          try {
            analyser?.disconnect();
          } catch {
            // ignore
          }
        }
      })();
    }, 1200);
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

    // Unlock inside the initiating user gesture *before* any await (iPad critical).
    if (useWebAudio) {
      await this.unlockAudio();
    }

    this.initAudioElement(useWebAudio, false);
    if (useWebAudio) {
      try {
        await this.ensureAudioContext();
      } catch {
        // non-fatal; will retry after play
      }
    }
    this.applyOutputVolume();

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
    this.applyOutputVolume();

    // After async work, iOS may have suspended the context — resume before play.
    if (useWebAudio) {
      await this.resumeAudioContext();
    }

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

      // Re-assert Web Audio graph after play — iPad often needs this post-start.
      if (useWebAudio) {
        try {
          await this.ensureAudioContext(true);
          await this.resumeAudioContext();
          this.watchForSilentWebAudio(gen);
        } catch {
          // keep playing; FX may attach on 'playing' event
        }
      }

      this.softFadeIn();
      this.emit();
    } catch (err) {
      if (gen !== this.playGeneration) return;

      // If CORS-enabled play failed, try dry (non-CORS) so the station still plays.
      // FX/EQ prefs stay on for the next attempt / station that supports CORS.
      if (useWebAudio && this.audio.crossOrigin) {
        try {
          this.teardownGraphNodesOnly();
          this.mediaSourceNode = null;
          this.initAudioElement(false, true);
          await tryPlay(streamUrl);
          if (gen !== this.playGeneration) return;
          this._playing = true;
          this._loading = false;
          this._error = null;
          this.softFadeIn();
          this.emit();
          return;
        } catch {
          // fall through to original URL / error
          this.initAudioElement(true, true);
        }
      }

      if (originalUrl && originalUrl !== streamUrl) {
        try {
          this.triedOriginalFallback = true;
          if (useWebAudio) {
            this.initAudioElement(true, false);
          }
          await tryPlay(originalUrl);
          if (gen !== this.playGeneration) return;
          this._playing = true;
          this._loading = false;
          this._error = null;
          if (useWebAudio) {
            try {
              await this.ensureAudioContext(true);
              await this.resumeAudioContext();
            } catch {
              // ignore
            }
          }
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
      // Resume AudioContext inside the gesture before play (iPad).
      void (async () => {
        if (this._fxEnabled || this._eqEnabled) {
          await this.unlockAudio();
          await this.ensureAudioContext();
        }
        try {
          await this.audio.play();
          if (gen !== this.playGeneration) return;
          if (this._fxEnabled || this._eqEnabled) {
            await this.ensureAudioContext(true);
            await this.resumeAudioContext();
          }
        } catch {
          if (gen !== this.playGeneration) return;
          // Stale src after long pause / network loss — full reconnect.
          void this.play(this._station!);
        }
      })();
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
    this.clearSilenceWatch();
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

// Eager gesture unlock for iPad / Android (same approach as voice-changer).
if (typeof window !== 'undefined') {
  player.installGestureUnlock();
}
