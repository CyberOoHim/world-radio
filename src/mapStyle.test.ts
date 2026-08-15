import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAP_STYLE,
  MAP_STYLE_IDS,
  MAP_STYLES,
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
    expect(MAP_STYLES.streets.url).toContain('voyager');
    expect(MAP_STYLES.terrain.url).toContain('World_Topo_Map');
    expect(MAP_STYLES.satellite.url).toContain('World_Imagery');
  });
});
