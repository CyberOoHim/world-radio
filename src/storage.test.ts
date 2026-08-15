import { describe, expect, it } from 'vitest';
import {
  clearAllStorage,
  loadFontScale,
  loadMapStyle,
  loadMapViewport,
  sanitizeCustomEqPreset,
  sanitizeEqBands,
  sanitizeMapViewport,
  sanitizeStation,
  saveFontScale,
  saveMapStyle,
  saveMapViewport,
} from './storage';

describe('sanitizeStation', () => {
  it('requires a uuid and coerces numbers', () => {
    expect(sanitizeStation(null)).toBeNull();
    expect(sanitizeStation({ name: 'x' })).toBeNull();
    const s = sanitizeStation({
      stationuuid: 'u1',
      name: 'Jazz FM',
      votes: 'nope',
      bitrate: 128,
      geo_lat: 12.5,
      homepage: 'javascript:alert(1)',
      group: ' Night jazz ',
    });
    expect(s?.stationuuid).toBe('u1');
    expect(s?.name).toBe('Jazz FM');
    expect(s?.votes).toBe(0);
    expect(s?.bitrate).toBe(128);
    expect(s?.geo_lat).toBe(12.5);
    expect(s?.group).toBe('Night jazz');
  });

  it('coerces string geo coordinates from the API', () => {
    const s = sanitizeStation({
      stationuuid: 'u2',
      name: 'City FM',
      geo_lat: '51.5074',
      geo_long: '-0.1278',
    });
    expect(s?.geo_lat).toBeCloseTo(51.5074);
    expect(s?.geo_long).toBeCloseTo(-0.1278);
  });
});

describe('sanitizeEqBands', () => {
  it('clamps dB and fills missing bands', () => {
    const bands = sanitizeEqBands({ b60: 99, b150: -40, b1k: 'x' });
    expect(bands.b60).toBe(12);
    expect(bands.b150).toBe(-12);
    expect(bands.b1k).toBe(0);
    expect(bands.b16k).toBe(0);
  });
});

describe('sanitizeMapViewport', () => {
  it('accepts a map center and clamps zoom to the Leaflet range', () => {
    expect(sanitizeMapViewport({ lat: 35.68, lon: 139.77, zoom: 10 })).toEqual({
      lat: 35.68,
      lon: 139.77,
      zoom: 10,
    });
    expect(sanitizeMapViewport({ lat: '51.5', lon: '-0.12', zoom: '4.4' })).toEqual({
      lat: 51.5,
      lon: -0.12,
      zoom: 4,
    });
    expect(sanitizeMapViewport({ lat: 0, lon: 0, zoom: 1 })?.zoom).toBe(2);
    expect(sanitizeMapViewport({ lat: 0, lon: 0, zoom: 99 })?.zoom).toBe(18);
  });

  it('rejects missing or out-of-range coordinates', () => {
    expect(sanitizeMapViewport(null)).toBeNull();
    expect(sanitizeMapViewport({ lat: 91, lon: 0, zoom: 4 })).toBeNull();
    expect(sanitizeMapViewport({ lat: 0, lon: 181, zoom: 4 })).toBeNull();
    expect(sanitizeMapViewport({ lat: 0, lon: 0 })).toBeNull();
  });

  it('round-trips through localStorage', () => {
    const memory = new Map<string, string>();
    const stub = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => {
        memory.set(k, String(v));
      },
      removeItem: (k: string) => {
        memory.delete(k);
      },
    };
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: stub });
    try {
      saveMapViewport({ lat: 40.7, lon: -74.0, zoom: 9 });
      expect(loadMapViewport()).toEqual({ lat: 40.7, lon: -74.0, zoom: 9 });
    } finally {
      if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});

describe('map style persistence', () => {
  it('round-trips streets, terrain, and satellite and defaults junk to streets', () => {
    const memory = new Map<string, string>();
    const stub = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => {
        memory.set(k, String(v));
      },
      removeItem: (k: string) => {
        memory.delete(k);
      },
    };
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: stub });
    try {
      expect(loadMapStyle()).toBe('streets');
      saveMapStyle('terrain');
      expect(loadMapStyle()).toBe('terrain');
      saveMapStyle('satellite');
      expect(loadMapStyle()).toBe('satellite');
      memory.set('world-radio:map-style', 'voyager');
      expect(loadMapStyle()).toBe('streets');
    } finally {
      if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});

describe('sanitizeCustomEqPreset', () => {
  it('rejects unsafe ids and caps names', () => {
    expect(sanitizeCustomEqPreset({ id: 'flat', name: 'x', bands: {} })).toBeNull();
    const p = sanitizeCustomEqPreset({
      id: 'custom-1',
      name: 'A'.repeat(80),
      bands: { b60: 3 },
    });
    expect(p?.id).toBe('custom-1');
    expect(p?.name.length).toBe(40);
    expect(p?.bands.b60).toBe(3);
  });
});

describe('clearAllStorage', () => {
  it('clears all world-radio localStorage items', () => {
    const memory = new Map<string, string>();
    memory.set('world-radio:favorites', '[]');
    memory.set('world-radio:recent', '[]');
    memory.set('world-radio:prefs', '{}');
    memory.set('world-radio:volume', '0.5');
    memory.set('world-radio:font-scale', '1.1');
    memory.set('unrelated-key', 'keep-me');

    const stub = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => {
        memory.set(k, String(v));
      },
      removeItem: (k: string) => {
        memory.delete(k);
      },
      key: (i: number) => Array.from(memory.keys())[i] ?? null,
      get length() {
        return memory.size;
      },
    };
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: stub });
    try {
      clearAllStorage();
      expect(memory.has('world-radio:favorites')).toBe(false);
      expect(memory.has('world-radio:recent')).toBe(false);
      expect(memory.has('world-radio:prefs')).toBe(false);
      expect(memory.has('world-radio:volume')).toBe(false);
      expect(memory.has('world-radio:font-scale')).toBe(false);
      expect(memory.get('unrelated-key')).toBe('keep-me');
    } finally {
      if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});

describe('fontScale persistence', () => {
  it('loads default 1.0, clamps within 0.8 and 1.3, and roundtrips', () => {
    const memory = new Map<string, string>();
    const stub = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => {
        memory.set(k, String(v));
      },
      removeItem: (k: string) => {
        memory.delete(k);
      },
    };
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: stub });
    try {
      expect(loadFontScale()).toBe(1.0);
      saveFontScale(1.15);
      expect(loadFontScale()).toBe(1.15);
      saveFontScale(2.5);
      expect(loadFontScale()).toBe(1.3);
      saveFontScale(0.4);
      expect(loadFontScale()).toBe(0.8);
    } finally {
      if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});


