type SleepListener = (remainingMs: number | null) => void;

const SLEEP_UNTIL_KEY = 'world-radio:sleep-until';

class SleepTimer {
  private until: number | null = null;
  private tickId: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<SleepListener>();
  private onFire: (() => void) | null = null;
  private visibilityBound = false;

  subscribe(fn: SleepListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setOnFire(fn: () => void) {
    this.onFire = fn;
  }

  get remainingMs(): number | null {
    if (this.until == null) return null;
    return Math.max(0, this.until - Date.now());
  }

  get active(): boolean {
    return this.until != null && this.until > Date.now();
  }

  get untilMs(): number | null {
    return this.until;
  }

  start(minutes: number) {
    this.clearTimerOnly();
    this.until = Date.now() + minutes * 60_000;
    this.persist();
    this.tickId = setInterval(() => this.tick(), 1000);
    this.bindVisibility();
    this.emit();
  }

  /** Resume a timer that was persisted across reload / lock screen. */
  restore() {
    this.bindVisibility();
    try {
      const raw = localStorage.getItem(SLEEP_UNTIL_KEY);
      const until = raw != null ? Number(raw) : NaN;
      if (!Number.isFinite(until) || until <= Date.now()) {
        localStorage.removeItem(SLEEP_UNTIL_KEY);
        return;
      }
      this.clearTimerOnly();
      this.until = until;
      this.tickId = setInterval(() => this.tick(), 1000);
      this.emit();
      this.tick();
    } catch {
      // ignore
    }
  }

  cancel() {
    this.clearTimerOnly();
    this.until = null;
    this.clearPersist();
    this.emit();
  }

  private clearTimerOnly() {
    if (this.tickId != null) {
      clearInterval(this.tickId);
      this.tickId = null;
    }
  }

  private tick() {
    if (this.until == null) return;
    const left = this.until - Date.now();
    if (left <= 0) {
      this.clearTimerOnly();
      this.until = null;
      this.clearPersist();
      this.emit();
      this.onFire?.();
      return;
    }
    this.emit();
  }

  private persist() {
    if (this.until == null) return;
    try {
      localStorage.setItem(SLEEP_UNTIL_KEY, String(this.until));
    } catch {
      // ignore
    }
  }

  private clearPersist() {
    try {
      localStorage.removeItem(SLEEP_UNTIL_KEY);
    } catch {
      // ignore
    }
  }

  private bindVisibility() {
    if (this.visibilityBound || typeof document === 'undefined') return;
    this.visibilityBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.tick();
    });
  }

  private emit() {
    const rem = this.remainingMs;
    for (const fn of this.listeners) fn(rem);
  }
}

export const sleepTimer = new SleepTimer();

export function formatSleepRemaining(ms: number | null): string {
  if (ms == null || ms <= 0) return '';
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
