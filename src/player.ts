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

  constructor() {
    this.audio.preload = 'none';
    this.audio.crossOrigin = 'anonymous';

    this.audio.addEventListener('playing', () => {
      this._playing = true;
      this._loading = false;
      this._error = null;
      this.emit();
    });
    this.audio.addEventListener('pause', () => {
      this._playing = false;
      this._loading = false;
      this.emit();
    });
    this.audio.addEventListener('waiting', () => {
      this._loading = true;
      this.emit();
    });
    this.audio.addEventListener('error', () => {
      this._playing = false;
      this._loading = false;
      this._error = 'Could not play this station. Try another.';
      this.emit();
    });
    this.audio.addEventListener('ended', () => {
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

  setVolume(v: number) {
    this._volume = Math.min(1, Math.max(0, v));
    this.audio.volume = this._muted ? 0 : this._volume;
    this.emit();
  }

  setMuted(m: boolean) {
    this._muted = m;
    this.audio.volume = m ? 0 : this._volume;
    this.emit();
  }

  async play(station: Station) {
    this._station = station;
    this._loading = true;
    this._error = null;
    this._playing = false;
    this.emit();

    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();

    let streamUrl =
      (await resolveStream(station.stationuuid)) ||
      station.url_resolved ||
      station.url;

    if (!streamUrl) {
      this._loading = false;
      this._error = 'No stream URL available.';
      this.emit();
      return;
    }

    // Prefer https when the page is secure and stream is http (some browsers block mixed content)
    if (location.protocol === 'https:' && streamUrl.startsWith('http:')) {
      const httpsUrl = streamUrl.replace(/^http:/, 'https:');
      // try https first; fall back handled by error event if it fails
      streamUrl = httpsUrl;
    }

    this.audio.src = streamUrl;
    this.audio.volume = this._muted ? 0 : this._volume;

    try {
      await this.audio.play();
    } catch (err) {
      // If https rewrite failed, try original
      const original = station.url_resolved || station.url;
      if (original && original !== streamUrl) {
        try {
          this.audio.src = original;
          await this.audio.play();
          return;
        } catch {
          // fall through
        }
      }
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
      void this.audio.play().catch(() => {
        this._loading = false;
        this._error = 'Could not resume playback.';
        this.emit();
      });
    } else {
      void this.play(this._station);
    }
  }

  stop() {
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this._playing = false;
    this._loading = false;
    this.emit();
  }
}

export const player = new AudioPlayer();
