import { describe, expect, it } from 'vitest';
import { mapShareUrl, parseHash } from './router';

describe('parseHash', () => {
  it('parses view, station, tag, country, search, near, map', () => {
    expect(parseHash('#/favorites')).toEqual({ kind: 'view', view: 'favorites' });
    expect(parseHash('#/station/abc-123')).toEqual({ kind: 'station', uuid: 'abc-123' });
    expect(parseHash('#/tag/jazz')).toEqual({ kind: 'tag', tag: 'jazz' });
    expect(parseHash('#/country/us')).toEqual({ kind: 'country', code: 'US' });
    expect(parseHash('#/search/bbc')).toEqual({ kind: 'search', q: 'bbc' });
    expect(parseHash('#/near')).toEqual({ kind: 'near' });
    expect(parseHash('#/map')).toEqual({ kind: 'map' });
    expect(parseHash('#/map/35.680,139.770/10')).toEqual({
      kind: 'map',
      lat: 35.68,
      lon: 139.77,
      zoom: 10,
    });
    expect(parseHash('#/map/35.680,139.770/10/station-uuid-123')).toEqual({
      kind: 'map',
      lat: 35.68,
      lon: 139.77,
      zoom: 10,
      stationUuid: 'station-uuid-123',
    });
    expect(parseHash('#/map/35.680,139.770/10?station=station-uuid-456')).toEqual({
      kind: 'map',
      lat: 35.68,
      lon: 139.77,
      zoom: 10,
      stationUuid: 'station-uuid-456',
    });
    expect(parseHash('#/map/not-a-coord')).toEqual({ kind: 'map' });
    expect(parseHash('#/')).toBeNull();
  });

  it('builds map share URLs including map selection and station', () => {
    const urlWithStation = mapShareUrl({ lat: 25.033, lon: 121.565, zoom: 11 }, 'uuid-taiwan');
    expect(urlWithStation).toContain('#/map/25.033,121.565/11/uuid-taiwan');

    const urlViewportOnly = mapShareUrl({ lat: 51.507, lon: -0.127, zoom: 8 });
    expect(urlViewportOnly).toContain('#/map/51.507,-0.127/8');

    const urlFallback = mapShareUrl(null, 'uuid-fallback');
    expect(urlFallback).toContain('#/station/uuid-fallback');
  });

  it('returns null on malformed percent-encoding instead of throwing', () => {
    expect(parseHash('#/search/%')).toBeNull();
    expect(parseHash('#/tag/%E0')).toBeNull();
  });
});
