import { describe, expect, it } from 'vitest';
import { sanitizeCustomEqPreset, sanitizeEqBands, sanitizeStation } from './storage';

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
