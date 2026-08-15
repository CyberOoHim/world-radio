import { describe, expect, it } from 'vitest';
import { countryCentroid } from './mapGeo';
import {
  countrySealPosition,
  mergeStamp,
  passportStats,
  sanitizePassportStamp,
  seedStampsFromStations,
  stampFromStation,
  type PassportStamp,
} from './mapPassport';
import type { Station } from './types';

function station(partial: Partial<Station> & Pick<Station, 'stationuuid'>): Station {
  return {
    changeuuid: '',
    name: 'Test FM',
    url: 'https://example.com/stream',
    url_resolved: 'https://example.com/stream',
    homepage: '',
    favicon: '',
    tags: '',
    country: 'Japan',
    countrycode: 'JP',
    state: 'Tokyo',
    language: '',
    languagecodes: '',
    votes: 0,
    codec: 'MP3',
    bitrate: 128,
    lastcheckok: 1,
    clickcount: 0,
    clicktrend: 0,
    geo_lat: 35.68,
    geo_long: 139.69,
    ...partial,
  };
}

function stamp(partial: Partial<PassportStamp>): PassportStamp {
  return {
    countrycode: 'JP',
    country: 'Japan',
    lat: 35.68,
    lon: 139.69,
    kind: 'station',
    stationuuid: 'jp-1',
    stationName: 'NHK',
    stampedAt: 1,
    ...partial,
  };
}

describe('passport stamps', () => {
  it('rejects incomplete stamp payloads', () => {
    expect(sanitizePassportStamp(null)).toBeNull();
    expect(sanitizePassportStamp({ countrycode: 'JAPAN', kind: 'country', lat: 1, lon: 1 })).toBeNull();
    expect(sanitizePassportStamp({ countrycode: 'JP', kind: 'station', lat: 1, lon: 1 })).toBeNull();
  });

  it('builds a station stamp from exact coordinates', () => {
    const s = stampFromStation(station({ stationuuid: 'a' }));
    expect(s?.kind).toBe('station');
    expect(s?.countrycode).toBe('JP');
    expect(s?.lat).toBeCloseTo(35.68);
  });

  it('falls back to a country stamp when geo is missing', () => {
    const s = stampFromStation(
      station({ stationuuid: 'b', geo_lat: null, geo_long: null, countrycode: 'br', country: 'Brazil' })
    );
    const br = countryCentroid('BR');
    expect(s?.kind).toBe('country');
    expect(s?.lat).toBe(br?.lat);
  });

  it('does not add a second country-only stamp', () => {
    const first = mergeStamp([], stamp({ kind: 'country', stationuuid: undefined, lat: 0, lon: 0 }));
    const second = mergeStamp(first.stamps, stamp({ kind: 'country', stationuuid: undefined, stampedAt: 2 }));
    expect(first.added).toBe(true);
    expect(second.added).toBe(false);
    expect(second.stamps).toHaveLength(1);
  });

  it('upgrades a country stamp into a city stamp', () => {
    const country = mergeStamp([], stamp({ kind: 'country', stationuuid: undefined }));
    const city = mergeStamp(country.stamps, stamp({ kind: 'station', stationuuid: 'jp-2', stampedAt: 9 }));
    expect(city.added).toBe(true);
    expect(city.upgraded).toBe(true);
    expect(city.stamps).toHaveLength(1);
    expect(city.stamps[0].kind).toBe('station');
    expect(city.stamps[0].stationuuid).toBe('jp-2');
  });

  it('keeps multiple cities in the same country', () => {
    const one = mergeStamp([], stamp({ stationuuid: 'osaka', place: 'Osaka' }));
    const two = mergeStamp(one.stamps, stamp({ stationuuid: 'kyoto', place: 'Kyoto', stampedAt: 2 }));
    expect(two.stamps).toHaveLength(2);
    expect(passportStats(two.stamps).countries).toBe(1);
    expect(passportStats(two.stamps).cities).toBe(2);
  });

  it('seeds unique countries from recents, oldest first', () => {
    const stamps = seedStampsFromStations(
      [
        station({ stationuuid: 'now', countrycode: 'US', country: 'United States', geo_lat: 40, geo_long: -74 }),
        station({ stationuuid: 'older', countrycode: 'FR', country: 'France', geo_lat: 48.8, geo_long: 2.3 }),
      ],
      10_000
    );
    expect(stamps.map((s) => s.countrycode)).toEqual(['FR', 'US']);
    expect(stamps[0].stampedAt).toBeLessThan(stamps[1].stampedAt);
  });

  it('puts country seals on the centroid', () => {
    const pos = countrySealPosition(stamp({ lat: 35.68, lon: 139.69, countrycode: 'JP' }));
    const jp = countryCentroid('JP');
    expect(pos.lat).toBe(jp?.lat);
    expect(pos.lon).toBe(jp?.lon);
  });
});
