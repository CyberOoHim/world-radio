import { describe, expect, it } from 'vitest';
import {
  buildStreetsStyle,
  CARTO_VOYAGER_BASE_URL,
  DEFAULT_MAP_STYLE,
  MAP_STYLE_IDS,
  MAP_STYLES,
  normalizeCartoApiKey,
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

  it('uses CARTO Voyager directly when no API key is configured', () => {
    const streets = buildStreetsStyle('');
    expect(streets.url).toBe(CARTO_VOYAGER_BASE_URL);
    expect(streets.attribution.toLowerCase()).toContain('carto');
    expect(streets.maxZoom).toBe(20);
    expect(streets.subdomains).toBe('abcd');
    expect(streets.detectRetina).toBe(true);
    expect(streets.crossOrigin).toBe(true);
  });

  it('uses CARTO Voyager with key parameter when an API key is configured', () => {
    const streetsWithKey = buildStreetsStyle('my-carto-key');
    expect(streetsWithKey.url).toBe(`${CARTO_VOYAGER_BASE_URL}?key=my-carto-key`);
    expect(streetsWithKey.attribution.toLowerCase()).toContain('carto');
    expect(streetsWithKey.maxZoom).toBe(20);
    expect(streetsWithKey.subdomains).toBe('abcd');
    expect(streetsWithKey.detectRetina).toBe(true);
  });

  it('normalizes CARTO API keys from full URLs, query strings, and quoted strings', () => {
    expect(normalizeCartoApiKey('')).toBe('');
    expect(normalizeCartoApiKey(null)).toBe('');
    expect(normalizeCartoApiKey('  sample_key_abc  ')).toBe('sample_key_abc');
    expect(normalizeCartoApiKey('"sample_key_abc"')).toBe('sample_key_abc');
    expect(normalizeCartoApiKey('key=sample_key_abc')).toBe('sample_key_abc');
    expect(normalizeCartoApiKey('?key=sample_key_abc')).toBe('sample_key_abc');
    expect(
      normalizeCartoApiKey(
        'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=sample_key_abc'
      )
    ).toBe('sample_key_abc');

    const streetsFromUrl = buildStreetsStyle(
      'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=extracted-token'
    );
    expect(streetsFromUrl.url).toBe(`${CARTO_VOYAGER_BASE_URL}?key=extracted-token`);
  });
});

