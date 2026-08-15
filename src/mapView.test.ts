import { describe, expect, it } from 'vitest';
import {
  haversineMeters,
  isBrowserOffline,
  MIN_PIN_ZOOM,
  OFFLINE_MAP_ALERT,
  shouldLoadPins,
  viewportRadiusMeters,
} from './mapGeo';

describe('map viewport helpers', () => {
  it('computes a ~111km haversine for 1° of latitude', () => {
    const meters = haversineMeters({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    expect(meters).toBeGreaterThan(110_000);
    expect(meters).toBeLessThan(112_000);
  });

  it('uses the center-to-corner distance as the viewport radius', () => {
    const radius = viewportRadiusMeters({
      south: 0,
      west: 0,
      north: 2,
      east: 0,
    });
    expect(radius).toBeGreaterThan(110_000);
    expect(radius).toBeLessThan(112_000);
  });

  it('waits until zoom 4 before loading pins', () => {
    expect(shouldLoadPins(MIN_PIN_ZOOM - 1)).toBe(false);
    expect(shouldLoadPins(MIN_PIN_ZOOM)).toBe(true);
    expect(shouldLoadPins(10)).toBe(true);
  });

  it('treats navigator.onLine === false as offline', () => {
    const original = (globalThis as { navigator?: unknown }).navigator;
    (globalThis as { navigator?: unknown }).navigator = { onLine: false };
    expect(isBrowserOffline()).toBe(true);
    (globalThis as { navigator?: unknown }).navigator = { onLine: true };
    expect(isBrowserOffline()).toBe(false);
    (globalThis as { navigator?: unknown }).navigator = original;
  });

  it('explains that tiles and stations need a network', () => {
    expect(OFFLINE_MAP_ALERT.toLowerCase()).toContain('offline');
    expect(OFFLINE_MAP_ALERT.toLowerCase()).toContain('tiles');
  });
});
