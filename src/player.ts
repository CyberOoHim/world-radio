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
type NoticeListener = (message: string) => void;

/** Why FX/EQ was bypassed and audio fell back to dry element playback. */
export type DryPlaybackReason = 'cors' | 'silent' | 'unavailable';

const DRY_PLAYBACK_MESSAGES: Record<DryPlaybackReason, string> = {
  cors:
    'Audio FX & EQ unavailable for this station (stream blocks processing). Playing original audio.',
  silent:
    'Audio FX & EQ could not process this stream. Playing original audio.',
  unavailable:
    'Audio FX & EQ could not be applied. Playing original audio.',
};

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
  /** True after we already fell back from CORS/WebAudio → dry for this generation. */
  private triedDryFallback = false;
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
  /** User wants FX/EQ, but this stream is playing dry (CORS/process failure). */
  private _dryBecauseFxBlocked = false;
  private visibilityBound = false;
  private unlockBound = false;
  private noticeListeners = new Set<NoticeListener>();
  private lastDryNoticeAt = 0;
  private verifyTimer: ReturnType<typeof setTimeout> | null = null;

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

    // Always start with a plain (non-CORS) element so stations connect reliably.
    // Web Audio / CORS is applied only after a successful connect attempt.
    this.initAudioElement(false);
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

  private wantsWebAudio(): boolean {
    return this._fxEnabled || this._eqEnabled;
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
    this.bindAudioElementEvents();
  }

  private bindAudioElementEvents() {
    this.audio.addEventListener('playing', () => {
      if (!this.isActiveGeneration()) return;
      this._playing = true;
      this._loading = false;
      this._error = null;
      // Resume only — never rebuild graph here (rebuilds stall live streams on iPad).
      if (this._webAudioRouted) {
        void this.resumeAudioContext();
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
      void this.handleMediaError();
    });
    this.audio.addEventListener('ended', () => {
      if (!this.isActiveGeneration()) return;
      this._playing = false;
      this.emit();
    });
    this.audio.addEventListener('stalled', () => {
      // Live streams often stall briefly; resume Web Audio if routed.
      if (!this.isActiveGeneration()) return;
      if (this._webAudioRouted) void this.resumeAudioContext();
    });
  }

  /**
   * Media error while using CORS/Web Audio: fall back to dry so the station
   * still plays (common on iPad when redirects lack CORS). Always toast.
   */
  private async handleMediaError() {
    // Prefer dry fallback when FX was requested and we were on a CORS element.
    if (
      this.wantsWebAudio() &&
      this.audio.crossOrigin &&
      !this.triedDryFallback &&
      this.activeStreamUrl
    ) {
      const url = this.activeStreamUrl;
      const gen = this.playGeneration;
      this.triedDryFallback = true;
      this.clearVerifyTimer();
      this.teardownGraphNodesOnly();
      this.mediaSourceNode = null;
      this.initAudioElement(false, true);
      this.audio.src = url;
      this.applyOutputVolume();
      try {
        await this.audio.play();
        if (gen !== this.playGeneration) return;
        this._playing = true;
        this._loading = false;
        this._error = null;
        this._dryBecauseFxBlocked = true;
        this.softFadeIn();
        this.notifyDryPlayback('cors');
        this.emit();
        return;
      } catch {
        // fall through to original-url / fail
      }
    }

    if (!this.triedOriginalFallback && this._station) {
      const original = this._station.url_resolved || this._station.url;
      if (original && original !== this.activeStreamUrl) {
        this.triedOriginalFallback = true;
        this.activeStreamUrl = original;
        // Stay on current CORS mode of the element.
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
  /** FX/EQ is enabled but this stream is playing original audio (CORS/process blocked). */
  get dryBecauseFxBlocked() {
    return this._dryBecauseFxBlocked;
  }

  /**
   * Subscribe to one-shot user notices (e.g. dry playback when FX/EQ cannot run).
   * Returns an unsubscribe function.
   */
  onNotice(fn: NoticeListener): () => void {
    this.noticeListeners.add(fn);
    return () => this.noticeListeners.delete(fn);
  }

  private notifyDryPlayback(reason: DryPlaybackReason) {
    // Debounce so overlapping fallbacks don't spam toasts.
    const now = Date.now();
    if (now - this.lastDryNoticeAt < 2000) return;
    this.lastDryNoticeAt = now;
    const message = DRY_PLAYBACK_MESSAGES[reason];
    for (const fn of this.noticeListeners) {
      try {
        fn(message);
      } catch {
        // ignore listener errors
      }
    }
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
    if (this._eqEnabled && this.eqChain && this._webAudioRouted) {
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
   * Attach MediaElementSource + FX/EQ graph. Call only after media is playing
   * on a CORS-enabled element. Avoid force-rebuild mid-stream.
   */
  async ensureAudioContext(forceRebuild = false): Promise<AudioContext | null> {
    if (!this.wantsWebAudio()) return null;

    if (!this.audioCtx) {
      this.audioCtx = new (getAudioContextClass())();
    }

    await this.resumeAudioContext();
    this.mountAudioElement(this.audio);

    if (!this.audio.crossOrigin) {
      this._webAudioRouted = false;
      return this.audioCtx;
    }

    if (!this.mediaSourceNode) {
      try {
        this.mediaSourceNode = this.audioCtx.createMediaElementSource(this.audio);
        forceRebuild = true;
      } catch {
        this._webAudioRouted = false;
        return this.audioCtx;
      }
    }

    const key = this.desiredPipelineKey();
    if (forceRebuild || this.pipelineKey !== key || !this._webAudioRouted) {
      this.rebuildAudioPipeline();
    } else {
      this.applyOutputVolume();
    }

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
        this.fxChain = buildFxChain(this.audioCtx, this.getCombinedFxConfig());
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

    this.masterGain = this.audioCtx.createGain();
    this.applyOutputVolume();

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
    const prevWebAudio = this.wantsWebAudio();
    this._fxEnabled = enabled;
    saveFxState({ enabled: this._fxEnabled, presetId: this._fxPresetId, customFx: this._customFx });

    const nextWebAudio = this.wantsWebAudio();
    if (prevWebAudio !== nextWebAudio) {
      void this.handleWebAudioToggle(nextWebAudio);
    } else if (enabled && this._webAudioRouted) {
      // Already on Web Audio with EQ — rebuild to include FX chain.
      void this.ensureAudioContext(true);
    } else if (!enabled && this._webAudioRouted && this._eqEnabled) {
      void this.ensureAudioContext(true);
    }
    this.emit();
  }

  setFxPreset(presetId: string | null) {
    this._fxPresetId = presetId;
    saveFxState({ enabled: this._fxEnabled, presetId: this._fxPresetId, customFx: this._customFx });
    if (this._fxEnabled && this.fxChain && this._webAudioRouted) {
      void this.resumeAudioContext();
      this.fxChain.updateFx(this.getCombinedFxConfig());
    }
    this.emit();
  }

  setEqEnabled(enabled: boolean) {
    const prevWebAudio = this.wantsWebAudio();
    this._eqEnabled = enabled;
    saveEqState({ enabled: this._eqEnabled, presetId: this._eqPresetId, bands: this._eqBands });

    const nextWebAudio = this.wantsWebAudio();
    if (prevWebAudio !== nextWebAudio) {
      void this.handleWebAudioToggle(nextWebAudio);
    } else if (enabled && this._webAudioRouted) {
      void this.ensureAudioContext(true);
    } else if (!enabled && this._webAudioRouted && this._fxEnabled) {
      void this.ensureAudioContext(true);
    }
    this.emit();
  }

  setEqBand(bandKey: keyof EqBands, value: number) {
    this._eqBands = { ...this._eqBands, [bandKey]: value };
    this._eqPresetId = 'custom';
    saveEqState({ enabled: this._eqEnabled, presetId: this._eqPresetId, bands: this._eqBands });
    if (this._eqEnabled && this.eqChain && this._webAudioRouted) {
      void this.resumeAudioContext();
      this.eqChain.updateBands(this._eqBands);
    }
    this.emit();
  }

  /**
   * Toggle Web Audio on/off while preserving playback when possible.
   * Enabling: try processed path once; on any failure → dry + toast.
   * Disabling: return to reliable dry element.
   */
  private async handleWebAudioToggle(enableWebAudio: boolean) {
    const wasPlaying = this._playing;
    const currentUrl = this.activeStreamUrl;
    this.clearVerifyTimer();
    this._dryBecauseFxBlocked = false;

    this.teardownGraphNodesOnly();
    if (this.mediaSourceNode) {
      try {
        this.mediaSourceNode.disconnect();
      } catch {
        // ignore
      }
      this.mediaSourceNode = null;
    }

    if (!currentUrl || !wasPlaying) {
      // Not playing — just set preferred element mode for next play.
      this.initAudioElement(false, true);
      if (enableWebAudio) await this.unlockAudio();
      return;
    }

    if (!enableWebAudio) {
      // Back to dry — most reliable for live radio.
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
      return;
    }

    // Enabling FX/EQ while playing: try processed, else dry + toast.
    await this.unlockAudio();
    const processed = await this.tryStartProcessed(currentUrl, this.playGeneration);
    if (processed) {
      this._playing = true;
      this._loading = false;
      this._error = null;
      this._dryBecauseFxBlocked = false;
      this.softFadeIn();
      this.emit();
      return;
    }

    const dryOk = await this.tryStartDry(currentUrl, this.playGeneration);
    if (dryOk) {
      this._playing = true;
      this._loading = false;
      this._error = null;
      this._dryBecauseFxBlocked = true;
      this.softFadeIn();
      this.notifyDryPlayback('cors');
      this.emit();
      return;
    }

    this.failPlayback('Could not play this station. Try another.');
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
        // fall through
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

  private clearVerifyTimer() {
    if (this.verifyTimer != null) {
      clearTimeout(this.verifyTimer);
      this.verifyTimer = null;
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
   * After processed play starts, confirm Web Audio actually has signal.
   * If silent (CORS-tainted MES), switch to dry once and toast.
   * Does not rebuild the graph mid-stream (that pauses live radio on iPad).
   */
  private scheduleProcessedVerification(gen: number) {
    this.clearVerifyTimer();
    this.verifyTimer = setTimeout(() => {
      void (async () => {
        this.verifyTimer = null;
        if (gen !== this.playGeneration) return;
        if (!this.wantsWebAudio()) return;
        if (!this._webAudioRouted || !this.audioCtx || !this.mediaSourceNode) {
          // Wanted FX but never routed — toast if still playing dry.
          if (this._playing && !this.audio.paused) {
            this._dryBecauseFxBlocked = true;
            this.notifyDryPlayback('unavailable');
          }
          return;
        }

        await this.resumeAudioContext();

        let analyser: AnalyserNode | null = null;
        try {
          analyser = this.audioCtx.createAnalyser();
          analyser.fftSize = 256;
          (this.masterGain || this.mediaSourceNode).connect(analyser);

          // Two samples ~250ms apart so we don't false-trigger during buffer fill.
          let level = this.measureGraphLevel(analyser);
          if (level < 0.8) {
            await new Promise((r) => setTimeout(r, 400));
            if (gen !== this.playGeneration) {
              analyser.disconnect();
              return;
            }
            await this.resumeAudioContext();
            level = this.measureGraphLevel(analyser);
          }

          try {
            analyser.disconnect();
          } catch {
            // ignore
          }

          if (level >= 0.8) {
            // FX is working.
            this._dryBecauseFxBlocked = false;
            return;
          }

          // Silent graph while element claims playing → dry fallback + toast.
          if (!this.activeStreamUrl || this.audio.paused) return;
          const url = this.activeStreamUrl;
          this.triedDryFallback = true;
          this.teardownGraphNodesOnly();
          this.mediaSourceNode = null;
          this.initAudioElement(false, true);
          this.audio.src = url;
          this.applyOutputVolume();
          try {
            await this.audio.play();
            if (gen !== this.playGeneration) return;
            this._playing = true;
            this._loading = false;
            this._error = null;
            this._dryBecauseFxBlocked = true;
            this.softFadeIn();
            this.notifyDryPlayback('silent');
            this.emit();
          } catch {
            // ignore — user can retry
          }
        } catch {
          try {
            analyser?.disconnect();
          } catch {
            // ignore
          }
        }
      })();
    }, 900);
  }

  /**
   * Try CORS + Web Audio processing for a URL.
   * Returns true only if play() succeeded AND graph was attached.
   * Does not toast (caller decides).
   */
  private async tryStartProcessed(url: string, gen: number): Promise<boolean> {
    if (gen !== this.playGeneration) return false;
    try {
      this.initAudioElement(true, true);
      this.activeStreamUrl = url;
      this.audio.src = url;
      // Element volume at full; masterGain takes over after graph attaches.
      this.audio.volume = this._muted ? 0 : this._userVolume;
      await this.raceTimeout(this.audio.play(), 6_000);
      if (gen !== this.playGeneration) return false;

      // Attach graph only AFTER play succeeds — critical for iPad stability.
      await this.unlockAudio();
      await this.ensureAudioContext(true);
      await this.resumeAudioContext();

      if (!this._webAudioRouted) {
        // Could not attach MES — treat as failure so caller goes dry.
        try {
          this.audio.pause();
        } catch {
          // ignore
        }
        return false;
      }

      this.applyOutputVolume();
      this.scheduleProcessedVerification(gen);
      return true;
    } catch {
      return false;
    }
  }

  /** Reliable non-CORS element play (no FX processing). */
  private async tryStartDry(url: string, gen: number): Promise<boolean> {
    if (gen !== this.playGeneration) return false;
    try {
      this.clearVerifyTimer();
      this.teardownGraphNodesOnly();
      this.mediaSourceNode = null;
      this.initAudioElement(false, true);
      this.activeStreamUrl = url;
      this.audio.src = url;
      this.applyOutputVolume();
      await this.raceTimeout(this.audio.play(), 6_000);
      return gen === this.playGeneration;
    } catch {
      return false;
    }
  }

  async play(station: Station) {
    const gen = ++this.playGeneration;
    this._station = station;
    this._loading = true;
    this._error = null;
    this._playing = false;
    this.activeStreamUrl = null;
    this.triedOriginalFallback = false;
    this.triedDryFallback = false;
    this._dryBecauseFxBlocked = false;
    this.clearVerifyTimer();
    this.cancelFade();
    this.emit();

    const wantFx = this.wantsWebAudio();

    // Unlock inside the initiating user gesture *before* any await (iPad).
    if (wantFx) {
      await this.unlockAudio();
    }

    // Prefer click-counted resolve URL, but never hang on a dead API.
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

    const urls: string[] = [];
    for (const u of [streamUrl, originalUrl]) {
      if (u && !urls.includes(u)) urls.push(u);
    }

    // ── Path A: FX/EQ requested → try processed, then dry with toast ──
    if (wantFx) {
      for (const url of urls) {
        if (gen !== this.playGeneration) return;
        const ok = await this.tryStartProcessed(url, gen);
        if (ok) {
          this._playing = true;
          this._loading = false;
          this._error = null;
          this._dryBecauseFxBlocked = false;
          this.softFadeIn();
          this.emit();
          return;
        }
      }

      // Processed failed for all URLs — reliable dry play + always notify.
      this.triedDryFallback = true;
      for (const url of urls) {
        if (gen !== this.playGeneration) return;
        const ok = await this.tryStartDry(url, gen);
        if (ok) {
          this._playing = true;
          this._loading = false;
          this._error = null;
          this._dryBecauseFxBlocked = true;
          this.softFadeIn();
          this.notifyDryPlayback('cors');
          this.emit();
          return;
        }
      }

      this._loading = false;
      this._playing = false;
      this._error = 'Could not play this station. Try another.';
      this.emit();
      return;
    }

    // ── Path B: FX/EQ off → plain dry play (most reliable) ──
    for (const url of urls) {
      if (gen !== this.playGeneration) return;
      const ok = await this.tryStartDry(url, gen);
      if (ok) {
        this._playing = true;
        this._loading = false;
        this._error = null;
        this.softFadeIn();
        this.emit();
        return;
      }
    }

    this._loading = false;
    this._playing = false;
    this._error = 'Could not play this station. Try another.';
    this.emit();
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
      onChange();
    });
  }

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
      void (async () => {
        if (this.wantsWebAudio()) {
          await this.unlockAudio();
        }
        // If we previously fell back to dry, just resume the dry element.
        // Full reconnect only if resume fails.
        try {
          if (this._webAudioRouted) {
            await this.resumeAudioContext();
          }
          await this.audio.play();
          if (gen !== this.playGeneration) return;
          if (this._webAudioRouted) {
            await this.resumeAudioContext();
          }
          this._playing = true;
          this._loading = false;
          this._error = null;
          this.emit();
        } catch {
          if (gen !== this.playGeneration) return;
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

  stop() {
    this.playGeneration++;
    this.mediaGeneration = 0;
    this.cancelFade();
    this.clearVerifyTimer();
    this.audio.pause();
    this.audio.removeAttribute('src');
    try {
      this.audio.load();
    } catch {
      // ignore
    }
    this.activeStreamUrl = null;
    this.triedOriginalFallback = false;
    this.triedDryFallback = false;
    this._dryBecauseFxBlocked = false;
    this._station = null;
    this._playing = false;
    this._loading = false;
    this._error = null;
    this.emit();
  }
}

export const player = new AudioPlayer();

if (typeof window !== 'undefined') {
  player.installGestureUnlock();
}
