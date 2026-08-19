import { resolveStream } from './api/radioBrowser';
import { playbackUrlCandidates } from './safeUrl';
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

/** iPhone / iPad / iPod (incl. iPadOS desktop UA). */
export function isAppleTouchDevice(): boolean {
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ reports as MacIntel with touch
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
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
  private playGeneration = 0;
  private mediaGeneration = 0;
  private activeStreamUrl: string | null = null;
  private triedOriginalFallback = false;
  /** True after we already fell back from CORS/WebAudio → dry for this generation. */
  private triedDryFallback = false;
  private fadeTimer: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> | null = null;
  private _userVolume = 0.75;
  /** True only when the user intentionally paused (not a stream stall). */
  private userPaused = false;
  /** Guard against concurrent dry-fallback attempts. */
  private dryFallbackInFlight = false;

  private audioCtx: AudioContext | null = null;
  private mediaSourceNode: MediaElementAudioSourceNode | null = null;
  private masterGain: GainNode | null = null;
  private fxChain: FxChain | null = null;
  private _fxEnabled = false;
  private _fxPresetId: string | null = 'radio';
  private _customFx: Record<string, number> = {};
  private pipelineKey: string | null = null;
  private _webAudioRouted = false;
  private _dryBecauseFxBlocked = false;
  private visibilityBound = false;
  private unlockBound = false;
  private noticeListeners = new Set<NoticeListener>();
  private lastDryNoticeAt = 0;
  private verifyTimer: ReturnType<typeof setTimeout> | null = null;
  private pauseWatchTimer: ReturnType<typeof setTimeout> | null = null;
  private dryReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private dryReconnectAttempts = 0;
  private _reconnecting = false;
  /** True after this generation has actually started playback once. */
  private playbackStarted = false;
  /** HTTPS-first then original HTTP, so Icecast-without-TLS still plays. */
  private streamCandidates: string[] = [];

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

    // Always a plain non-CORS element by default (reliable live radio).
    this.initAudioElement(false);
    this.bindVisibilityResume();
  }

  async unlockAudio(): Promise<void> {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (getAudioContextClass())();
      }
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }
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
      // ignore
    }
  }

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
      if (document.visibilityState === 'visible' && !this.userPaused) {
        void this.resumeAudioContext();
        // If stream died while backgrounded under CORS, recover dry.
        if (this.wantsWebAudio() && this.audio.paused && this.activeStreamUrl && this._station) {
          void this.forceDryFallback('unavailable');
        }
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

  private async suspendAudioContext(): Promise<void> {
    if (!this.audioCtx) return;
    if (this.audioCtx.state === 'running') {
      try {
        await this.audioCtx.suspend();
      } catch {
        // ignore
      }
    }
  }

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

  /** True when the current element is on the risky CORS / Web Audio path. */
  private isProcessedElement(): boolean {
    return Boolean(this.audio.crossOrigin) || this._webAudioRouted;
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
      this._reconnecting = false;
      this.playbackStarted = true;
      this.dryReconnectAttempts = 0;
      this.clearDryReconnect();
      this.userPaused = false;
      if (this._webAudioRouted) {
        void this.resumeAudioContext();
      }
      this.emit();
    });

    this.audio.addEventListener('pause', () => {
      if (!this.isActiveGeneration()) return;
      // Intentional user pause — stay paused.
      if (this.userPaused) {
        this._playing = false;
        this._loading = false;
        this.emit();
        return;
      }
      // Unexpected pause under CORS/Web Audio (very common on iPad) → dry recover.
      if (
        this.wantsWebAudio() &&
        this.isProcessedElement() &&
        !this.triedDryFallback &&
        this.activeStreamUrl
      ) {
        void this.forceDryFallback('cors');
        return;
      }
      this._playing = false;
      this._loading = false;
      this.emit();
    });

    this.audio.addEventListener('waiting', () => {
      if (!this.isActiveGeneration()) return;
      this._loading = true;
      this.emit();
      this.armPauseWatch();
      // Live Icecast always buffers. Do not tear down on waiting.
      this.armDryStallWatch();
    });

    this.audio.addEventListener('error', () => {
      if (!this.isActiveGeneration()) return;
      void this.handleMediaError();
    });

    this.audio.addEventListener('ended', () => {
      if (!this.isActiveGeneration()) return;
      // Live streams shouldn't end; if they do under FX path, recover dry.
      if (
        this.wantsWebAudio() &&
        this.isProcessedElement() &&
        !this.triedDryFallback &&
        this.activeStreamUrl &&
        !this.userPaused
      ) {
        void this.forceDryFallback('cors');
        return;
      }
      this._playing = false;
      this.emit();
      if (!this.userPaused && this.playbackStarted) {
        void this.reconnectCurrentDry();
      }
    });

    this.audio.addEventListener('stalled', () => {
      if (!this.isActiveGeneration() || this.userPaused) return;
      if (this._webAudioRouted) void this.resumeAudioContext();
      this.armPauseWatch();
      this.armDryStallWatch();
    });
  }

  /**
   * After playback has started, a long stall often means the Icecast socket died.
   * Never run this during the initial connect — waiting/stalled is normal then.
   */
  private armDryStallWatch() {
    if (this.userPaused || !this._station || !this.activeStreamUrl) return;
    if (!this.playbackStarted) return;
    if (this.wantsWebAudio() && this.isProcessedElement()) return;
    if (this.dryReconnectAttempts >= 3) return;
    if (this.dryReconnectTimer != null) return;

    this.dryReconnectTimer = setTimeout(() => {
      this.dryReconnectTimer = null;
      if (!this.isActiveGeneration() || this.userPaused || !this.playbackStarted) return;
      // Still flowing — leave it alone.
      if (!this.audio.paused && this.audio.readyState >= 3) return;
      void this.reconnectCurrentDry();
    }, 10_000);
  }

  /** Kick the same dry element. Do not bump playGeneration (that aborts a live connect). */
  private async reconnectCurrentDry(): Promise<void> {
    const url = this.activeStreamUrl;
    const gen = this.playGeneration;
    if (!url || this.userPaused || !this._station) return;
    if (this.wantsWebAudio() && this.isProcessedElement()) return;
    if (this.dryReconnectAttempts >= 3) return;

    this.dryReconnectAttempts++;
    this._reconnecting = true;
    this.emit();

    try {
      this.audio.pause();
      this.audio.src = url;
      try {
        this.audio.load();
      } catch {
        // ignore
      }
      this.applyOutputVolume();
      await this.raceTimeout(this.audio.play(), 10_000);
      if (gen !== this.playGeneration) return;
      if (!this.audio.paused) {
        this._playing = true;
        this._loading = false;
        this._error = null;
        this._reconnecting = false;
        this.emit();
        return;
      }
    } catch {
      // try remaining candidates below
    }

    if (gen !== this.playGeneration || this.userPaused) return;

    const extras = this.streamCandidates.filter((u) => u !== url);
    for (const next of extras) {
      if (gen !== this.playGeneration) return;
      const ok = await this.tryStartDry(next, gen);
      if (ok) {
        this._playing = true;
        this._loading = false;
        this._error = null;
        this._reconnecting = false;
        this.softFadeIn();
        this.emit();
        return;
      }
    }

    if (gen === this.playGeneration) {
      this._reconnecting = false;
      this.failPlayback('Could not play this station. Try another.');
    }
  }

  private clearDryReconnect() {
    if (this.dryReconnectTimer != null) {
      clearTimeout(this.dryReconnectTimer);
      this.dryReconnectTimer = null;
    }
  }

  /**
   * If the stream stays paused/waiting under processed mode, force dry.
   */
  private armPauseWatch() {
    if (this.pauseWatchTimer != null) {
      clearTimeout(this.pauseWatchTimer);
    }
    this.pauseWatchTimer = setTimeout(() => {
      this.pauseWatchTimer = null;
      if (!this.isActiveGeneration() || this.userPaused) return;
      if (!this.wantsWebAudio() || this.triedDryFallback || !this.activeStreamUrl) return;
      if (!this.isProcessedElement()) return;
      // Still not actually playing after stall/wait → dry recover.
      if (this.audio.paused || this.audio.readyState < 2) {
        void this.forceDryFallback('cors');
      }
    }, 2500);
  }

  private clearPauseWatch() {
    if (this.pauseWatchTimer != null) {
      clearTimeout(this.pauseWatchTimer);
      this.pauseWatchTimer = null;
    }
  }

  /**
   * Hard switch to non-CORS dry playback and keep audio going.
   * Always toasts when FX/EQ was wanted. Safe to call from event handlers.
   */
  private async forceDryFallback(reason: DryPlaybackReason): Promise<boolean> {
    if (this.dryFallbackInFlight) return false;
    if (this.triedDryFallback && !this.isProcessedElement() && !this.audio.paused) {
      return true;
    }

    const url = this.activeStreamUrl;
    if (!url) return false;

    const gen = this.playGeneration;
    this.dryFallbackInFlight = true;
    this.triedDryFallback = true;
    this.clearVerifyTimer();
    this.clearPauseWatch();
    this.clearDryReconnect();

    try {
      this.teardownGraphNodesOnly();
      this.mediaSourceNode = null;
      this.initAudioElement(false, true);
      this.activeStreamUrl = url;
      this.audio.src = url;
      this.applyOutputVolume();
      this.userPaused = false;

      await this.raceTimeout(this.audio.play(), 8_000);
      if (gen !== this.playGeneration) return false;

      this._playing = true;
      this._loading = false;
      this._error = null;
      this._dryBecauseFxBlocked = this.wantsWebAudio();
      this.softFadeIn();
      if (this.wantsWebAudio()) {
        this.notifyDryPlayback(reason);
      }
      this.emit();
      return true;
    } catch {
      // Try remaining candidates (includes original HTTP after a failed HTTPS rewrite).
      if (this._station && gen === this.playGeneration) {
        const extras = this.streamCandidates.filter((u) => u && u !== url);
        if (!extras.length) {
          const original = this._station.url_resolved || this._station.url;
          if (original && original !== url) extras.push(original);
        }
        for (const next of extras) {
          try {
            this.activeStreamUrl = next;
            this.audio.src = next;
            this.applyOutputVolume();
            await this.raceTimeout(this.audio.play(), 8_000);
            if (gen !== this.playGeneration) return false;
            this._playing = true;
            this._loading = false;
            this._error = null;
            this._dryBecauseFxBlocked = this.wantsWebAudio();
            this.softFadeIn();
            if (this.wantsWebAudio()) {
              this.notifyDryPlayback(reason);
            }
            this.emit();
            return true;
          } catch {
            // try next candidate
          }
        }
      }
      if (gen === this.playGeneration) {
        this.failPlayback('Could not play this station. Try another.');
      }
      return false;
    } finally {
      this.dryFallbackInFlight = false;
    }
  }

  private async handleMediaError() {
    if (this.wantsWebAudio() && this.isProcessedElement() && !this.triedDryFallback && this.activeStreamUrl) {
      const ok = await this.forceDryFallback('cors');
      if (ok) return;
    }

    // Dry element error: walk remaining candidates (HTTP original after HTTPS rewrite).
    if (!this.triedOriginalFallback && this._station) {
      const extras = this.streamCandidates.filter((u) => u && u !== this.activeStreamUrl);
      if (!extras.length) {
        const original = this._station.url_resolved || this._station.url;
        if (original && original !== this.activeStreamUrl) extras.push(original);
      }
      if (extras.length) {
        this.triedOriginalFallback = true;
        const gen = this.playGeneration;
        for (const next of extras) {
          this.activeStreamUrl = next;
          this.audio.src = next;
          try {
            await this.audio.play();
            if (gen !== this.playGeneration) return;
            this._playing = true;
            this._loading = false;
            this._error = null;
            this.softFadeIn();
            this.emit();
            return;
          } catch {
            // try next candidate
          }
        }
      }
    }
    this.failPlayback('Could not play this station. Try another.');
  }

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
    void this.suspendAudioContext();
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
  get webAudioRouted() {
    return this._webAudioRouted;
  }
  get dryBecauseFxBlocked() {
    return this._dryBecauseFxBlocked;
  }
  get reconnecting() {
    return this._reconnecting;
  }

  onNotice(fn: NoticeListener): () => void {
    this.noticeListeners.add(fn);
    return () => this.noticeListeners.delete(fn);
  }

  notifyCustomNotice(message: string) {
    for (const fn of this.noticeListeners) {
      try {
        fn(message);
      } catch {
        // ignore
      }
    }
  }

  private notifyDryPlayback(reason: DryPlaybackReason) {
    const now = Date.now();
    if (now - this.lastDryNoticeAt < 1800) return;
    this.lastDryNoticeAt = now;
    const message = DRY_PLAYBACK_MESSAGES[reason];
    for (const fn of this.noticeListeners) {
      try {
        fn(message);
      } catch {
        // ignore
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
    const prev = this.wantsWebAudio();
    this._fxEnabled = enabled;
    saveFxState({ enabled: this._fxEnabled, presetId: this._fxPresetId, customFx: this._customFx });
    const next = this.wantsWebAudio();
    if (prev !== next) {
      void this.handleWebAudioToggle(next);
    } else if (enabled && this._webAudioRouted) {
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
    const prev = this.wantsWebAudio();
    this._eqEnabled = enabled;
    saveEqState({ enabled: this._eqEnabled, presetId: this._eqPresetId, bands: this._eqBands });
    const next = this.wantsWebAudio();
    if (prev !== next) {
      void this.handleWebAudioToggle(next);
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

  private async handleWebAudioToggle(enableWebAudio: boolean) {
    const gen = this.playGeneration;
    const wasPlaying = this._playing || (!this.userPaused && !!this.activeStreamUrl && !this.audio.paused);
    const currentUrl = this.activeStreamUrl;
    this.clearVerifyTimer();
    this.clearPauseWatch();
    this.clearDryReconnect();
    this._dryBecauseFxBlocked = false;
    this.triedDryFallback = false;

    this.teardownGraphNodesOnly();
    this.mediaSourceNode = null;

    if (!currentUrl || !wasPlaying) {
      this.initAudioElement(false, true);
      if (enableWebAudio) await this.unlockAudio();
      return;
    }

    if (!enableWebAudio) {
      this.userPaused = false;
      this.initAudioElement(false, true);
      this.audio.src = currentUrl;
      this.applyOutputVolume();
      try {
        await this.raceTimeout(this.audio.play(), 8_000);
        if (gen !== this.playGeneration) return;
        this._playing = true;
        this._loading = false;
        this._error = null;
        this.softFadeIn();
        this.emit();
      } catch {
        if (gen === this.playGeneration) {
          this.failPlayback('Could not play this station. Try another.');
        }
      }
      return;
    }

    await this.unlockAudio();
    if (gen !== this.playGeneration) return;
    this.userPaused = false;

    const dryOk = await this.tryStartDry(currentUrl, gen);
    if (!dryOk) {
      if (gen === this.playGeneration) {
        this.failPlayback('Could not play this station. Try another.');
      }
      return;
    }
    if (gen !== this.playGeneration) return;
    this._playing = true;
    this._loading = false;
    this._error = null;
    this.softFadeIn();
    this.emit();

    const upgraded = await this.tryUpgradeToProcessed(currentUrl, gen);
    if (gen !== this.playGeneration) return;
    if (!upgraded) {
      if (this.audio.paused || this.isProcessedElement()) {
        await this.forceDryFallback('cors');
      } else {
        this._dryBecauseFxBlocked = true;
        this.notifyDryPlayback('cors');
      }
    }
  }

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
        g.linearRampToValueAtTime(target, now + 0.35);
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
    const steps = 7;
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
    }, 45);
  }

  fadeOutThen(ms: number, done: () => void) {
    this.cancelFade();
    const useMaster = Boolean(this.masterGain && this._webAudioRouted && this.audioCtx);
    const start = useMaster && this.masterGain ? this.masterGain.gain.value : this.audio.volume;
    if (start <= 0.01 || this._muted) {
      done();
      return;
    }
    if (useMaster && this.masterGain && this.audioCtx) {
      try {
        const g = this.masterGain.gain;
        const now = this.audioCtx.currentTime;
        g.cancelScheduledValues(now);
        g.setValueAtTime(start, now);
        g.linearRampToValueAtTime(0, now + ms / 1000);
        this.fadeTimer = setTimeout(() => {
          this.fadeTimer = null;
          done();
        }, ms);
        return;
      } catch {
        // fall through to interval
      }
    }
    const steps = Math.max(6, Math.floor(ms / 50));
    let i = 0;
    this.fadeTimer = setInterval(() => {
      i++;
      const level = start * (1 - i / steps);
      this.audio.volume = level;
      if (i >= steps) {
        this.cancelFade();
        done();
      }
    }, 50);
  }

  private cancelFade() {
    if (this.fadeTimer != null) {
      clearInterval(this.fadeTimer as unknown as number);
      clearTimeout(this.fadeTimer as unknown as number);
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
   * After a processed upgrade, verify signal. ALWAYS dry-fallback if silent
   * or paused — never leave the user stuck.
   */
  private scheduleProcessedVerification(gen: number) {
    this.clearVerifyTimer();
    this.verifyTimer = setTimeout(() => {
      void (async () => {
        this.verifyTimer = null;
        if (gen !== this.playGeneration || this.userPaused) return;
        if (!this.wantsWebAudio()) return;

        // Already dry — nothing to verify.
        if (!this.isProcessedElement()) return;

        // Paused / not flowing under processed path → dry immediately.
        if (this.audio.paused || !this._webAudioRouted) {
          await this.forceDryFallback(this.audio.paused ? 'cors' : 'unavailable');
          return;
        }

        await this.resumeAudioContext();
        if (!this.audioCtx || !this.mediaSourceNode) {
          await this.forceDryFallback('unavailable');
          return;
        }

        let analyser: AnalyserNode | null = null;
        try {
          analyser = this.audioCtx.createAnalyser();
          analyser.fftSize = 256;
          (this.masterGain || this.mediaSourceNode).connect(analyser);

          let level = this.measureGraphLevel(analyser);
          if (level < 0.8) {
            await new Promise((r) => setTimeout(r, 350));
            if (gen !== this.playGeneration) {
              try {
                analyser.disconnect();
              } catch {
                // ignore
              }
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

          if (level >= 0.8 && !this.audio.paused) {
            this._dryBecauseFxBlocked = false;
            return;
          }

          // Silent or paused → dry + toast.
          await this.forceDryFallback('silent');
        } catch {
          try {
            analyser?.disconnect();
          } catch {
            // ignore
          }
          await this.forceDryFallback('unavailable');
        }
      })();
    }, 800);
  }

  /** Reliable non-CORS element play. */
  private async tryStartDry(url: string, gen: number): Promise<boolean> {
    if (gen !== this.playGeneration) return false;
    try {
      this.clearVerifyTimer();
      this.clearPauseWatch();
      this.clearDryReconnect();
      this.teardownGraphNodesOnly();
      this.mediaSourceNode = null;
      if (gen !== this.playGeneration) return false;
      // Reuse the dry element so autoplay permission survives HTTPS→HTTP fallback.
      this.initAudioElement(false, this.isProcessedElement());
      if (gen !== this.playGeneration) return false;
      try {
        this.audio.pause();
      } catch {
        // ignore
      }
      this.activeStreamUrl = url;
      this.audio.src = url;
      this.applyOutputVolume();
      this.userPaused = false;
      await this.raceTimeout(this.audio.play(), 8_000);
      return gen === this.playGeneration && !this.audio.paused;
    } catch {
      return false;
    }
  }

  /**
   * Upgrade an already-playing dry stream to CORS + Web Audio.
   * On any failure returns false — caller must ensure dry is restored.
   */
  private async tryUpgradeToProcessed(url: string, gen: number): Promise<boolean> {
    if (gen !== this.playGeneration || !this.wantsWebAudio()) return false;
    // iPad: skip upgrade — CORS live streams pause/die too often.
    if (isAppleTouchDevice()) return false;

    try {
      if (gen !== this.playGeneration) return false;
      this.initAudioElement(true, true);
      if (gen !== this.playGeneration) return false;
      this.activeStreamUrl = url;
      this.audio.src = url;
      this.audio.volume = this._muted ? 0 : this._userVolume;
      this.userPaused = false;
      await this.raceTimeout(this.audio.play(), 6_000);
      if (gen !== this.playGeneration) return false;

      await this.unlockAudio();
      await this.ensureAudioContext(true);
      await this.resumeAudioContext();

      if (!this._webAudioRouted || this.audio.paused) {
        return false;
      }

      this.applyOutputVolume();
      this.scheduleProcessedVerification(gen);
      this.armPauseWatch();
      return true;
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
    this.userPaused = false;
    this.dryFallbackInFlight = false;
    this.dryReconnectAttempts = 0;
    this.playbackStarted = false;
    this.streamCandidates = [];
    this._reconnecting = false;
    this.clearVerifyTimer();
    this.clearPauseWatch();
    this.clearDryReconnect();
    this.cancelFade();
    this.emit();

    const wantFx = this.wantsWebAudio();

    // Unlock inside the initiating user gesture *before* any await (iPad).
    if (wantFx) {
      await this.unlockAudio();
    }

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
    this.streamCandidates = playbackUrlCandidates(
      [streamUrl, originalUrl],
      location.protocol
    );

    if (!this.streamCandidates.length) {
      this._loading = false;
      this._error = 'No stream URL available.';
      this.emit();
      return;
    }

    this.mediaGeneration = gen;

    // Dry-first: CORS live streams pause too often on iPad.
    // Candidates are HTTPS-first, then the original HTTP stream.
    let dryUrl: string | null = null;
    for (const url of this.streamCandidates) {
      if (gen !== this.playGeneration) return;
      const ok = await this.tryStartDry(url, gen);
      if (ok) {
        dryUrl = url;
        break;
      }
    }

    if (!dryUrl) {
      this._loading = false;
      this._playing = false;
      this._error = 'Could not play this station. Try another.';
      this.emit();
      return;
    }

    // Dry is playing — user hears radio. Never leave this state paused.
    this._playing = true;
    this._loading = false;
    this._error = null;
    this.softFadeIn();
    this.emit();

    if (!wantFx) {
      return;
    }

    // Desktop / Android: optional upgrade to processed path.
    const upgraded = await this.tryUpgradeToProcessed(dryUrl, gen);
    if (gen !== this.playGeneration) return;

    if (upgraded && !this.audio.paused && this._webAudioRouted) {
      this._playing = true;
      this._loading = false;
      this._error = null;
      this._dryBecauseFxBlocked = false;
      this.softFadeIn();
      this.emit();
      return;
    }

    // Upgrade failed or unstable — ensure dry is playing + toast.
    if (this.audio.paused || this.isProcessedElement() || !this._playing) {
      const recovered = await this.forceDryFallback('cors');
      if (!recovered && gen === this.playGeneration) {
        // Last resort: re-try dry on all urls
        for (const url of this.streamCandidates) {
          if (await this.tryStartDry(url, gen)) {
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
      }
    } else {
      // Still on dry and playing — just notify.
      this._dryBecauseFxBlocked = true;
      this.triedDryFallback = true;
      this.notifyDryPlayback('cors');
    }
  }

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
    if (this._playing && !this.audio.paused) {
      this.userPaused = true;
      this.clearPauseWatch();
      this.audio.pause();
      return;
    }
    // Resume or reconnect.
    this.userPaused = false;
    if (this.audio.src && !this.isProcessedElement()) {
      // Dry element resume — most reliable.
      this._loading = true;
      this._error = null;
      this.emit();
      const gen = this.playGeneration;
      void (async () => {
        try {
          await this.audio.play();
          if (gen !== this.playGeneration) return;
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
    // Processed element or no src — full reconnect (dry-first).
    void this.play(this._station);
  }

  pause() {
    this.userPaused = true;
    this.clearPauseWatch();
    this.audio.pause();
    void this.suspendAudioContext();
  }

  stop() {
    this.userPaused = true;
    this.playGeneration++;
    this.mediaGeneration = 0;
    this.cancelFade();
    this.clearVerifyTimer();
    this.clearPauseWatch();
    this.clearDryReconnect();
    this._reconnecting = false;
    this.dryReconnectAttempts = 0;
    this.audio.pause();
    this.audio.removeAttribute('src');
    try {
      this.audio.load();
    } catch {
      // ignore
    }
    this.activeStreamUrl = null;
    this.streamCandidates = [];
    this.playbackStarted = false;
    this.triedOriginalFallback = false;
    this.triedDryFallback = false;
    this._dryBecauseFxBlocked = false;
    this._station = null;
    this._playing = false;
    this._loading = false;
    this._error = null;
    void this.suspendAudioContext();
    this.emit();
  }

  resetDefaults() {
    this.stop();
    this._userVolume = 0.75;
    this._volume = 0.75;
    this._muted = false;
    this._fxEnabled = false;
    this._fxPresetId = 'radio';
    this._customFx = {};
    this._eqEnabled = false;
    this._eqPresetId = 'flat';
    this._eqBands = { ...DEFAULT_EQ_BANDS };
    this._customEqPresets = [];
    this.applyOutputVolume();
    this.emit();
  }
}


export const player = new AudioPlayer();

if (typeof window !== 'undefined') {
  player.installGestureUnlock();
}
