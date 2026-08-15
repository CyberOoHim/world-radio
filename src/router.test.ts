import { describe, expect, it } from 'vitest';
import { parseHash } from './router';

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
    expect(parseHash('#/map/not-a-coord')).toEqual({ kind: 'map' });
    expect(parseHash('#/')).toBeNull();
  });

  it('returns null on malformed percent-encoding instead of throwing', () => {
    expect(parseHash('#/search/%')).toBeNull();
    expect(parseHash('#/tag/%E0')).toBeNull();
  });
});
