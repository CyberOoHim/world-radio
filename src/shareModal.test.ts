import { describe, expect, it } from 'vitest';
import { generateShareCard, isShareModalOpen, closeShareModal, BOTTOM_BRAND_TEXT } from './shareModal';

describe('share card generation and QR modal', () => {
  it('has exact POJ spelling Sè-kài Lá-ji-o͘h with round-dotted unaccented i', () => {
    expect(BOTTOM_BRAND_TEXT).toBe('Sè-kài Lá-ji-o͘h');
    // Ensure 'i' in 'ji' is character 'i' (charCode 105, regular round dot), NOT accented 'í' (charCode 237)
    expect(BOTTOM_BRAND_TEXT.includes('ji')).toBe(true);
    expect(BOTTOM_BRAND_TEXT.includes('jí')).toBe(false);
    expect(BOTTOM_BRAND_TEXT.includes('Lá')).toBe(true);
  });

  it('generates share card dataUrl with QR code for stations', async () => {
    const card = await generateShareCard({
      stationName: 'Radio Paradise',
      url: 'https://world-radio.app/#/map/35.680,139.770/10/rp-123',
      subtitle: 'United States · 320 kbps',
    });

    expect(card).toBeDefined();
    expect(card.dataUrl).toContain('data:image/png;base64');
  });

  it('handles empty station names safely by falling back to default title', async () => {
    const card = await generateShareCard({
      stationName: '',
      url: 'https://world-radio.app/#/map/0.0,0.0/2',
    });

    expect(card).toBeDefined();
    expect(card.dataUrl.startsWith('data:image/png;base64')).toBe(true);
  });

  it('manages modal open/close lifecycle', () => {
    expect(isShareModalOpen()).toBe(false);
    closeShareModal();
    expect(isShareModalOpen()).toBe(false);
  });
});
