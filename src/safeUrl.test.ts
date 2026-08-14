import { describe, expect, it } from 'vitest';
import { nearExpansionComplete, safeHttpUrl, upgradeHttpToHttps } from './safeUrl';

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

describe('nearExpansionComplete', () => {
  it('stops only when found meets the page need', () => {
    expect(nearExpansionComplete(48, 96)).toBe(false);
    expect(nearExpansionComplete(96, 96)).toBe(true);
    expect(nearExpansionComplete(50, 48)).toBe(true);
  });
});
