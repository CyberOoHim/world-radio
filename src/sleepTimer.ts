type SleepListener = (remainingMs: number | null) => void;

class SleepTimer {
  private until: number | null = null;
  private tickId: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<SleepListener>();
  private onFire: (() => void) | null = null;

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
    this.tickId = setInterval(() => this.tick(), 1000);
    this.emit();
  }

  cancel() {
    this.clearTimerOnly();
    this.until = null;
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
      this.emit();
      this.onFire?.();
      return;
    }
    this.emit();
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
