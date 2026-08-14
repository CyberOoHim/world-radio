import { describe, expect, it } from 'vitest';
import {
  nearExpansionComplete,
  playbackUrlCandidates,
  safeHttpUrl,
  upgradeHttpToHttps,
} from './safeUrl';

describe('safeHttpUrl', () => {
  it('allows http and https', () => {
    expect(safeHttpUrl('https://example.com/x')).toBe('https://example.com/x');
    expect(safeHttpUrl('http://radio.example/stream')).toBe('http://radio.example/stream');
  });

  it('rejects javascript and data schemes', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('data:text/html,hi')).toBeNull();
    expect(safeHttpUrl('//evil.example')).toBeNull();
    expect(safeHttpUrl('/relative')).toBeNull();
    expect(safeHttpUrl('')).toBeNull();
  });
});

describe('upgradeHttpToHttps', () => {
  it('upgrades mixed-case http', () => {
    expect(upgradeHttpToHttps('HTTP://stream.example/x')).toBe('https://stream.example/x');
    expect(upgradeHttpToHttps('https://ok.example')).toBe('https://ok.example');
  });
});

describe('playbackUrlCandidates', () => {
  it('tries https first then keeps the http original on an https page', () => {
    expect(
      playbackUrlCandidates(['http://stream.example/live'], 'https:')
    ).toEqual(['https://stream.example/live', 'http://stream.example/live']);
  });

  it('upgrades mixed-case http and still keeps the original', () => {
    expect(playbackUrlCandidates(['HTTP://stream.example/x'], 'https:')).toEqual([
      'https://stream.example/x',
      'HTTP://stream.example/x',
    ]);
  });

  it('does not rewrite when the page itself is http', () => {
    expect(playbackUrlCandidates(['http://stream.example/live'], 'http:')).toEqual([
      'http://stream.example/live',
    ]);
  });

  it('dedupes resolved + original when they match', () => {
    expect(
      playbackUrlCandidates(
        ['https://a.example/s', 'https://a.example/s', 'http://a.example/s'],
        'https:'
      )
    ).toEqual(['https://a.example/s', 'http://a.example/s']);
  });

  it('falls back to http when the catalog only has https', () => {
    expect(playbackUrlCandidates(['https://stream.example/live'], 'https:')).toEqual([
      'https://stream.example/live',
      'http://stream.example/live',
    ]);
  });
});

describe('nearExpansionComplete', () => {
  it('stops only when found meets the page need', () => {
    expect(nearExpansionComplete(48, 96)).toBe(false);
    expect(nearExpansionComplete(96, 96)).toBe(true);
    expect(nearExpansionComplete(50, 48)).toBe(true);
  });
});
