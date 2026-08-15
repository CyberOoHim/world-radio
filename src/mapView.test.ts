import { describe, expect, it } from 'vitest';
import {
  countryCentroid,
  formatSolarClock,
  haversineMeters,
  isBrowserOffline,
  localSolarHour,
  MIN_PIN_ZOOM,
  OFFLINE_MAP_ALERT,
  parseGeoCoord,
  PASSPORT_COUNTRY_TOTAL,
  pointInBounds,
  resolveStationMapTarget,
  shouldLoadPins,
  solarMoodLabel,
  solarPeriodFromHour,
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
    expect(isBrowserOffline({ onLine: false })).toBe(true);
    expect(isBrowserOffline({ onLine: true })).toBe(false);
    expect(isBrowserOffline(undefined)).toBe(false);
  });

  it('explains that tiles and stations need a network', () => {
    expect(OFFLINE_MAP_ALERT.toLowerCase()).toContain('offline');
    expect(OFFLINE_MAP_ALERT.toLowerCase()).toContain('tiles');
  });

  it('parses numeric and string coordinates', () => {
    expect(parseGeoCoord(12.5)).toBe(12.5);
    expect(parseGeoCoord('51.5')).toBe(51.5);
    expect(parseGeoCoord('')).toBeNull();
    expect(parseGeoCoord(null)).toBeNull();
  });

  it('flies to exact coordinates when a station has geo', () => {
    const target = resolveStationMapTarget({ geo_lat: 40.7, geo_long: -74.0, countrycode: 'US' });
    expect(target?.kind).toBe('station');
    expect(target?.lat).toBeCloseTo(40.7);
    expect(target?.lon).toBeCloseTo(-74.0);
  });

  it('falls back to the country when a station has no coordinates', () => {
    const target = resolveStationMapTarget({ geo_lat: null, geo_long: null, countrycode: 'us' });
    const us = countryCentroid('US');
    expect(target?.kind).toBe('country');
    expect(target?.lat).toBe(us?.lat);
    expect(target?.lon).toBe(us?.lon);
  });

  it('returns null when there is no geo and no country', () => {
    expect(resolveStationMapTarget({ geo_lat: null, geo_long: null, countrycode: '' })).toBeNull();
  });

  it('treats antimeridian-crossing bounds as wrapping', () => {
    const bounds = { south: -10, west: 170, north: 10, east: -170 };
    expect(pointInBounds(0, 175, bounds)).toBe(true);
    expect(pointInBounds(0, -175, bounds)).toBe(true);
    expect(pointInBounds(0, 0, bounds)).toBe(false);
  });

  it('computes solar hour from longitude', () => {
    const noon = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));
    expect(localSolarHour(0, noon)).toBeCloseTo(12, 5);
    expect(localSolarHour(15, noon)).toBeCloseTo(13, 5);
    expect(localSolarHour(-75, noon)).toBeCloseTo(7, 5);
    expect(formatSolarClock(0, noon)).toBe('12:00');
  });

  it('maps solar hour to period and mood', () => {
    expect(solarPeriodFromHour(7)).toBe('morning');
    expect(solarPeriodFromHour(13)).toBe('day');
    expect(solarPeriodFromHour(19)).toBe('evening');
    expect(solarPeriodFromHour(2)).toBe('night');
    expect(solarMoodLabel(5.2)).toBe('almost dawn');
    expect(solarMoodLabel(12)).toBe('midday');
  });

  it('knows enough country centroids for a passport', () => {
    expect(PASSPORT_COUNTRY_TOTAL).toBeGreaterThan(180);
  });
});
