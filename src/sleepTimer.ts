type SleepListener = (remainingMs: number | null) => void;

export const SLEEP_UNTIL_KEY = 'world-radio:sleep-until';
export const SLEEP_DURATION_KEY = 'world-radio:sleep-duration';

export class SleepTimer {
  private until: number | null = null;
  private durationMs: number | null = null;
  private tickId: ReturnType<typeof setInterval> | null = null;
  private fireTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<SleepListener>();
  private onFire: (() => void) | null = null;
  private visibilityBound = false;
  private dimMode = false;
  private dimListeners = new Set<(dim: boolean) => void>();

  subscribe(fn: SleepListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  subscribeDim(fn: (dim: boolean) => void): () => void {
    this.dimListeners.add(fn);
    return () => this.dimListeners.delete(fn);
  }

  setOnFire(fn: () => void) {
    this.onFire = fn;
  }

  get remainingMs(): number | null {
    if (this.until == null) return null;
    return Math.max(0, this.until - Date.now());
  }

  get totalDurationMs(): number | null {
    return this.durationMs;
  }

  get progress(): number {
    if (this.until == null || this.durationMs == null || this.durationMs <= 0) return 0;
    const remaining = this.remainingMs ?? 0;
    const elapsed = this.durationMs - remaining;
    return Math.min(1, Math.max(0, elapsed / this.durationMs));
  }

  get active(): boolean {
    return this.until != null && this.until > Date.now();
  }

  get untilMs(): number | null {
    return this.until;
  }

  get isDim(): boolean {
    return this.dimMode;
  }

  toggleDim(force?: boolean) {
    this.dimMode = force !== undefined ? force : !this.dimMode;
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('bedside-dim-active', this.dimMode);
    }
    for (const fn of this.dimListeners) {
      try {
        fn(this.dimMode);
      } catch {
        // ignore
      }
    }
  }

  start(minutes: number) {
    if (minutes <= 0) return;
    this.clearTimerOnly();
    this.durationMs = minutes * 60_000;
    this.until = Date.now() + this.durationMs;
    this.syncActiveDomClass(true);
    this.persist();
    this.scheduleTimers();
    this.bindVisibility();
    this.emit();
  }

  extend(minutes: number) {
    if (minutes <= 0) return;
    if (!this.active) {
      this.start(minutes);
      return;
    }
    const addMs = minutes * 60_000;
    this.until = (this.until ?? Date.now()) + addMs;
    this.durationMs = (this.durationMs ?? 0) + addMs;
    this.syncActiveDomClass(true);
    this.persist();
    this.scheduleTimers();
    this.emit();
  }

  /**
   * Safe check for expiration. Can be invoked externally (e.g. from player timeupdate
   * or page visibility changes) to guarantee on-time expiration even if iPadOS/iOS
   * throttles JavaScript setTimeout/setInterval in the background.
   */
  checkExpiry(): boolean {
    if (this.until == null) return false;
    if (Date.now() >= this.until) {
      this.fire();
      return true;
    }
    return false;
  }

  /** Resume a timer that was persisted across reload / lock screen. */
  restore() {
    this.bindVisibility();
    try {
      const rawUntil = localStorage.getItem(SLEEP_UNTIL_KEY);
      const rawDur = localStorage.getItem(SLEEP_DURATION_KEY);
      const until = rawUntil != null ? Number(rawUntil) : NaN;
      const dur = rawDur != null ? Number(rawDur) : NaN;
      if (!Number.isFinite(until) || until <= Date.now()) {
        this.clearPersist();
        this.syncActiveDomClass(false);
        return;
      }
      this.clearTimerOnly();
      this.until = until;
      this.durationMs = Number.isFinite(dur) && dur > 0 ? dur : until - Date.now();
      this.syncActiveDomClass(true);
      this.scheduleTimers();
      this.emit();
      this.tick();
    } catch {
      // ignore
    }
  }

  cancel() {
    this.clearTimerOnly();
    this.until = null;
    this.durationMs = null;
    this.syncActiveDomClass(false);
    if (this.dimMode) {
      this.toggleDim(false);
    }
    this.clearPersist();
    this.emit();
  }

  fire() {
    this.clearTimerOnly();
    this.until = null;
    this.durationMs = null;
    this.syncActiveDomClass(false);
    if (this.dimMode) {
      this.toggleDim(false);
    }
    this.clearPersist();
    this.emit();
    this.onFire?.();
  }

  private clearTimerOnly() {
    if (this.tickId != null) {
      clearInterval(this.tickId);
      this.tickId = null;
    }
    if (this.fireTimeoutId != null) {
      clearTimeout(this.fireTimeoutId);
      this.fireTimeoutId = null;
    }
  }

  private scheduleTimers() {
    this.clearTimerOnly();
    const rem = this.remainingMs;
    if (rem == null || rem <= 0) {
      this.fire();
      return;
    }

    // Precise timeout for expiration
    this.fireTimeoutId = setTimeout(() => {
      this.checkExpiry();
    }, rem);

    // Only run 1s UI ticker when the document is currently visible.
    // When hidden (screen locked or tab in background on iPad), avoid waking up CPU cores every second.
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
      this.tickId = setInterval(() => this.tick(), 1000);
    }
  }

  private tick() {
    if (this.until == null) return;
    const left = this.until - Date.now();
    if (left <= 0) {
      this.fire();
      return;
    }
    this.emit();
  }

  private persist() {
    if (this.until == null) return;
    try {
      localStorage.setItem(SLEEP_UNTIL_KEY, String(this.until));
      if (this.durationMs != null) {
        localStorage.setItem(SLEEP_DURATION_KEY, String(this.durationMs));
      }
    } catch {
      // ignore
    }
  }

  private clearPersist() {
    try {
      localStorage.removeItem(SLEEP_UNTIL_KEY);
      localStorage.removeItem(SLEEP_DURATION_KEY);
    } catch {
      // ignore
    }
  }

  private syncActiveDomClass(active: boolean) {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('sleep-timer-active', active);
  }

  private bindVisibility() {
    if (this.visibilityBound || typeof document === 'undefined') return;
    this.visibilityBound = true;

    const onWake = () => {
      if (document.visibilityState === 'visible') {
        // Immediately check if timer expired while asleep / locked
        if (!this.checkExpiry() && this.active && !this.tickId) {
          this.tick();
          this.tickId = setInterval(() => this.tick(), 1000);
        }
      } else {
        // When hidden, cancel 1s UI ticker to save CPU/battery wakeups on iPad
        if (this.tickId != null) {
          clearInterval(this.tickId);
          this.tickId = null;
        }
      }
    };

    document.addEventListener('visibilitychange', onWake);
    if (typeof window !== 'undefined') {
      window.addEventListener('pageshow', () => onWake());
      window.addEventListener('focus', () => onWake());
    }
  }

  private emit() {
    const rem = this.remainingMs;
    for (const fn of this.listeners) {
      try {
        fn(rem);
      } catch {
        // ignore
      }
    }
  }
}

export const sleepTimer = new SleepTimer();

export function formatSleepRemaining(ms: number | null): string {
  if (ms == null || ms <= 0) return '';
  const totalSec = Math.ceil(ms / 1000);
  if (totalSec >= 3600) {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
