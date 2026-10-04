import { describe, expect, it } from 'vitest';
import {
  buildStreetsStyle,
  CARTO_VOYAGER_BASE_URL,
  DEFAULT_MAP_STYLE,
  MAP_STYLE_IDS,
  MAP_STYLES,
  OSM_STANDARD_URL,
  sanitizeMapStyle,
} from './mapStyle';

describe('map styles', () => {
  it('defaults unknown values to streets', () => {
    expect(sanitizeMapStyle(undefined)).toBe(DEFAULT_MAP_STYLE);
    expect(sanitizeMapStyle('voyager')).toBe('streets');
    expect(sanitizeMapStyle('terrain')).toBe('terrain');
    expect(sanitizeMapStyle('satellite')).toBe('satellite');
  });

  it('offers streets, terrain, and satellite over https', () => {
    expect([...MAP_STYLE_IDS]).toEqual(['streets', 'terrain', 'satellite']);
    for (const id of MAP_STYLE_IDS) {
      expect(MAP_STYLES[id].url.startsWith('https://')).toBe(true);
      expect(MAP_STYLES[id].label.length).toBeGreaterThan(0);
      expect(MAP_STYLES[id].attribution.toLowerCase()).toMatch(/openstreetmap|esri|carto/);
    }
    expect(MAP_STYLES.terrain.url).toContain('World_Topo_Map');
    expect(MAP_STYLES.satellite.url).toContain('World_Imagery');
  });

  it('falls back to OpenStreetMap standard tiles without an API key', () => {
    const streets = buildStreetsStyle('');
    expect(streets.url).toBe(OSM_STANDARD_URL);
    expect(streets.attribution.toLowerCase()).toContain('openstreetmap');
    expect(streets.maxZoom).toBe(19);
  });

  it('uses CARTO Voyager when an API key is configured', () => {
    const streetsWithKey = buildStreetsStyle('my-carto-key');
    expect(streetsWithKey.url).toBe(`${CARTO_VOYAGER_BASE_URL}?key=my-carto-key`);
    expect(streetsWithKey.attribution.toLowerCase()).toContain('carto');
    expect(streetsWithKey.maxZoom).toBe(20);
    expect(streetsWithKey.subdomains).toBe('abcd');
  });
});

