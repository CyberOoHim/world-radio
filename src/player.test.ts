import { describe, expect, it } from 'vitest';
import { player } from './player';

describe('player state management', () => {
  it('pause() synchronously sets playing to false and notifies subscribers', () => {
    let notified = 0;
    const unsub = player.subscribe(() => {
      notified++;
    });

    player.pause();
    expect(player.playing).toBe(false);
    expect(player.loading).toBe(false);
    expect(notified).toBeGreaterThan(0);

    unsub();
  });

  it('stop() resets playing and loading state and notifies subscribers', () => {
    let notified = 0;
    const unsub = player.subscribe(() => {
      notified++;
    });

    player.stop();
    expect(player.playing).toBe(false);
    expect(player.loading).toBe(false);
    expect(player.station).toBeNull();
    expect(notified).toBeGreaterThan(0);

    unsub();
  });
});
