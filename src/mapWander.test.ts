import { describe, expect, it } from 'vitest';
import { pickWanderOrder, scoreWanderCandidate } from './mapWander';

describe('wander hop ranking', () => {
  const bounds = { south: 0, west: 0, north: 20, east: 20 };
  const ctx = {
    bounds,
    zoom: 6,
    center: { lat: 10, lon: 10 },
    stampedCountries: new Set(['US']),
    excludeId: 'here',
  };

  it('drops the playing station and stations with no location', () => {
    expect(scoreWanderCandidate({ stationuuid: 'here', geo_lat: 50, geo_long: 50, countrycode: 'FR' }, ctx)).toBe(-1);
    expect(scoreWanderCandidate({ stationuuid: 'lost', countrycode: '' }, ctx)).toBe(-1);
  });

  it('prefers an unstamped station outside the viewport', () => {
    const inside = {
      stationuuid: 'in',
      geo_lat: 10,
      geo_long: 10,
      countrycode: 'US',
    };
    const outside = {
      stationuuid: 'out',
      geo_lat: 48.8,
      geo_long: 2.3,
      countrycode: 'FR',
    };
    const order = pickWanderOrder([inside, outside], ctx);
    expect(order[0]?.stationuuid).toBe('out');
    expect(scoreWanderCandidate(outside, ctx)).toBeGreaterThan(scoreWanderCandidate(inside, ctx));
  });
});
