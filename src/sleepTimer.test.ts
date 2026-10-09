import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SLEEP_DURATION_KEY,
  SLEEP_UNTIL_KEY,
  SleepTimer,
  formatSleepRemaining,
} from './sleepTimer';

describe('formatSleepRemaining', () => {
  it('returns empty string for null, 0, or negative values', () => {
    expect(formatSleepRemaining(null)).toBe('');
    expect(formatSleepRemaining(0)).toBe('');
    expect(formatSleepRemaining(-1000)).toBe('');
  });

  it('formats mm:ss correctly for durations under an hour', () => {
    expect(formatSleepRemaining(65_000)).toBe('1:05');
    expect(formatSleepRemaining(900_000)).toBe('15:00');
    expect(formatSleepRemaining(5_000)).toBe('0:05');
  });

  it('formats h:mm:ss for durations over an hour', () => {
    expect(formatSleepRemaining(3_665_000)).toBe('1:01:05');
    expect(formatSleepRemaining(7_200_000)).toBe('2:00:00');
  });
});

describe('SleepTimer', () => {
  let timer: SleepTimer;
  let memory: Map<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    memory = new Map<string, string>();
    const stub = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => memory.set(k, String(v)),
      removeItem: (k: string) => memory.delete(k),
      clear: () => memory.clear(),
    };
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: stub,
    });
    timer = new SleepTimer();
  });

  afterEach(() => {
    timer.cancel();
    vi.useRealTimers();
    memory.clear();
  });

  it('starts a timer, activates, and persists to localStorage', () => {
    timer.start(15);
    expect(timer.active).toBe(true);
    expect(timer.totalDurationMs).toBe(15 * 60_000);
    expect(timer.remainingMs).toBeGreaterThan(0);

    const savedUntil = localStorage.getItem(SLEEP_UNTIL_KEY);
    const savedDur = localStorage.getItem(SLEEP_DURATION_KEY);
    expect(savedUntil).toBeTruthy();
    expect(savedDur).toBe(String(15 * 60_000));
  });

  it('allows extending an active timer', () => {
    timer.start(15);
    const initialRemaining = timer.remainingMs!;
    timer.extend(10);
    expect(timer.remainingMs!).toBeGreaterThan(initialRemaining);
    expect(timer.totalDurationMs).toBe(25 * 60_000);
  });

  it('fires onFire callback and cleans up when timer expires', () => {
    let fired = false;
    timer.setOnFire(() => {
      fired = true;
    });

    timer.start(1);
    expect(timer.active).toBe(true);

    vi.advanceTimersByTime(60_000 + 100);
    expect(fired).toBe(true);
    expect(timer.active).toBe(false);
    expect(timer.remainingMs).toBeNull();
    expect(localStorage.getItem(SLEEP_UNTIL_KEY)).toBeNull();
  });

  it('checkExpiry detects expiration accurately (vital for background playback on iPad)', () => {
    let fired = false;
    timer.setOnFire(() => {
      fired = true;
    });

    timer.start(5);
    expect(timer.checkExpiry()).toBe(false);

    vi.setSystemTime(Date.now() + 5 * 60_000 + 1000);
    expect(timer.checkExpiry()).toBe(true);
    expect(fired).toBe(true);
    expect(timer.active).toBe(false);
  });

  it('cancel stops timer and cleans up persistence', () => {
    timer.start(30);
    expect(timer.active).toBe(true);

    timer.cancel();
    expect(timer.active).toBe(false);
    expect(timer.remainingMs).toBeNull();
    expect(localStorage.getItem(SLEEP_UNTIL_KEY)).toBeNull();
  });

  it('restores an active timer from localStorage across page reloads', () => {
    const future = Date.now() + 20 * 60_000;
    localStorage.setItem(SLEEP_UNTIL_KEY, String(future));
    localStorage.setItem(SLEEP_DURATION_KEY, String(20 * 60_000));

    timer.restore();
    expect(timer.active).toBe(true);
    expect(timer.remainingMs).toBeGreaterThan(0);
  });

  it('discards expired timer from localStorage on restore', () => {
    const past = Date.now() - 5000;
    localStorage.setItem(SLEEP_UNTIL_KEY, String(past));

    timer.restore();
    expect(timer.active).toBe(false);
    expect(localStorage.getItem(SLEEP_UNTIL_KEY)).toBeNull();
  });

  it('computes progress accurately', () => {
    timer.start(10);
    expect(timer.progress).toBeCloseTo(0, 1);

    vi.advanceTimersByTime(5 * 60_000);
    expect(timer.progress).toBeCloseTo(0.5, 1);
  });

  it('toggles bedside dim mode and notifies listeners', () => {
    let dimState = false;
    const unsub = timer.subscribeDim((d) => {
      dimState = d;
    });

    timer.toggleDim(true);
    expect(timer.isDim).toBe(true);
    expect(dimState).toBe(true);

    timer.toggleDim(false);
    expect(timer.isDim).toBe(false);
    expect(dimState).toBe(false);

    unsub();
  });
});
