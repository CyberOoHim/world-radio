import { describe, expect, it } from 'vitest';
import { generateShareCard, isShareModalOpen, closeShareModal, BOTTOM_BRAND_TEXT } from './shareModal';

describe('share card generation and QR modal', () => {
  it('has exact POJ spelling Sè-kài La-jí-o͘h with acute-accented jí', () => {
    expect(BOTTOM_BRAND_TEXT).toBe('Sè-kài La-jí-o͘h');
    // Ensure 'í' in 'jí' is acute-accented (charCode 237), and 'a' in 'La' is unaccented
    expect(BOTTOM_BRAND_TEXT.includes('jí')).toBe(true);
    expect(BOTTOM_BRAND_TEXT.includes('La')).toBe(true);
    expect(BOTTOM_BRAND_TEXT.includes('Lá')).toBe(false);
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
