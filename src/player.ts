import { resolveStream } from './api/radioBrowser';
import type { Station } from './types';

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

  constructor() {
    this.audio.preload = 'none';
    // Do not set crossOrigin — most radio streams lack CORS headers and would fail to play.
    this.audio.setAttribute('playsinline', '');
    this.audio.setAttribute('webkit-playsinline', '');
    // TS DOM lib: playsInline is on HTMLMediaElement in modern browsers
    (this.audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;

    this.audio.addEventListener('playing', () => {
      if (!this.isActiveGeneration()) return;
      this._playing = true;
      this._loading = false;
      this._error = null;
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
      // If we rewrote http→https and the media element failed, retry original once.
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
    this._volume = Math.min(1, Math.max(0, v));
    this.audio.volume = this._muted ? 0 : this._volume;
  }

  setMuted(m: boolean, opts?: { silent?: boolean }) {
    this._muted = m;
    this.audio.volume = m ? 0 : this._volume;
    if (!opts?.silent) this.emit();
  }

  async play(station: Station) {
    const gen = ++this.playGeneration;
    this._station = station;
    this._loading = true;
    this._error = null;
    this._playing = false;
    this.activeStreamUrl = null;
    this.triedOriginalFallback = false;
    this.emit();

    this.audio.pause();
    this.audio.removeAttribute('src');
    try {
      this.audio.load();
    } catch {
      // ignore
    }

    let streamUrl =
      (await resolveStream(station.stationuuid)) ||
      station.url_resolved ||
      station.url;

    if (gen !== this.playGeneration) return;

    if (!streamUrl) {
      this._loading = false;
      this._error = 'No stream URL available.';
      this.emit();
      return;
    }

    const originalUrl = station.url_resolved || station.url || streamUrl;

    // Prefer https when the page is secure and stream is http (mixed content).
    if (location.protocol === 'https:' && streamUrl.startsWith('http:')) {
      streamUrl = streamUrl.replace(/^http:/, 'https:');
    }

    this.mediaGeneration = gen;
    this.activeStreamUrl = streamUrl;
    this.audio.src = streamUrl;
    this.audio.volume = this._muted ? 0 : this._volume;

    try {
      await this.audio.play();
      if (gen !== this.playGeneration) return;
    } catch (err) {
      if (gen !== this.playGeneration) return;

      // If https rewrite failed at play() promise, try original immediately.
      if (originalUrl && originalUrl !== streamUrl) {
        try {
          this.triedOriginalFallback = true;
          this.activeStreamUrl = originalUrl;
          this.audio.src = originalUrl;
          await this.audio.play();
          if (gen !== this.playGeneration) return;
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

  toggle() {
    if (!this._station) return;
    if (this._playing) {
      this.audio.pause();
    } else if (this.audio.src) {
      this._loading = true;
      this.emit();
      const gen = this.playGeneration;
      void this.audio.play().catch(() => {
        if (gen !== this.playGeneration) return;
        this._loading = false;
        this._error = 'Could not resume playback.';
        this.emit();
      });
    } else {
      void this.play(this._station);
    }
  }

  stop() {
    this.playGeneration++;
    this.mediaGeneration = 0;
    this.audio.pause();
    this.audio.removeAttribute('src');
    try {
      this.audio.load();
    } catch {
      // ignore
    }
    this.activeStreamUrl = null;
    this.triedOriginalFallback = false;
    this._playing = false;
    this._loading = false;
    this.emit();
  }
}

export const player = new AudioPlayer();
