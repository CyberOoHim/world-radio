import { describe, expect, it } from 'vitest';
import {
  buildStreetsStyle,
  CARTO_VOYAGER_BASE_URL,
  DEFAULT_MAP_STYLE,
  getCartoApiKey,
  MAP_STYLE_IDS,
  MAP_STYLES,
  normalizeCartoApiKey,
  sanitizeMapStyle,
  STREETS_PROXY_URL,
} from './mapStyle';

describe('map styles and security isolation', () => {
  it('defaults unknown values to satellite', () => {
    expect(DEFAULT_MAP_STYLE).toBe('satellite');
    expect(sanitizeMapStyle(undefined)).toBe(DEFAULT_MAP_STYLE);
    expect(sanitizeMapStyle('voyager')).toBe('satellite');
    expect(sanitizeMapStyle('streets')).toBe('streets');
    expect(sanitizeMapStyle('terrain')).toBe('terrain');
    expect(sanitizeMapStyle('satellite')).toBe('satellite');
  });

  it('offers streets, terrain, and satellite over secure protocols and proxies', () => {
    expect([...MAP_STYLE_IDS]).toEqual(['streets', 'terrain', 'satellite']);
    for (const id of MAP_STYLE_IDS) {
      const url = MAP_STYLES[id].url;
      expect(url.startsWith('https://') || url.startsWith('/api/')).toBe(true);
      expect(MAP_STYLES[id].label.length).toBeGreaterThan(0);
      expect(MAP_STYLES[id].attribution.toLowerCase()).toMatch(/openstreetmap|esri|carto/);
    }
    expect(MAP_STYLES.streets.url).toBe(STREETS_PROXY_URL);
    expect(MAP_STYLES.terrain.url).toContain('World_Topo_Map');
    expect(MAP_STYLES.satellite.url).toContain('World_Imagery');
  });

  it('routes streets style through secure backend proxy by default', () => {
    const streets = buildStreetsStyle();
    expect(streets.url).toBe(STREETS_PROXY_URL);
    expect(streets.attribution.toLowerCase()).toContain('carto');
    expect(streets.maxZoom).toBe(20);
    expect(streets.subdomains).toBe('abcd');
    expect(streets.detectRetina).toBe(true);
    expect(streets.crossOrigin).toBe(true);
  });

  it('guarantees frontend API key getter never leaks secrets', () => {
    expect(getCartoApiKey()).toBe('');
  });

  it('sanitizes and strips API keys from tile URLs to prevent frontend leakage', () => {
    // If a raw token is passed, it falls back to the secure proxy URL and never creates a ?key= query
    const streetsFromToken = buildStreetsStyle('my-carto-key');
    expect(streetsFromToken.url).toBe(STREETS_PROXY_URL);
    expect(streetsFromToken.url).not.toContain('my-carto-key');
    expect(streetsFromToken.url).not.toContain('key=');

    // If an external URL with a key query parameter is passed, the key is stripped
    const streetsFromUrl = buildStreetsStyle(
      'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=extracted-token'
    );
    expect(streetsFromUrl.url).not.toContain('extracted-token');
    expect(streetsFromUrl.url).not.toContain('key=');
    expect(streetsFromUrl.url).toBe(
      'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'
    );

    // Clean base URL passes through without modification
    const streetsClean = buildStreetsStyle(CARTO_VOYAGER_BASE_URL);
    expect(streetsClean.url).toBe(CARTO_VOYAGER_BASE_URL);
  });

  it('normalizes CARTO API keys safely for server-side processing', () => {
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
  });
});
