import { describe, expect, it } from 'vitest';
import {
  MAX_RAW_IMAGE_BYTES,
  extractImageFileFromDataTransfer,
  parseDataUrlBase64,
  prepareAiImageFile,
  resolveImageMimeType,
} from './imageQuery';

describe('imageQuery helpers', () => {
  it('resolves supported MIME types from type or filename extension', () => {
    expect(resolveImageMimeType({ type: 'image/jpeg', name: 'a.bin' })).toBe('image/jpeg');
    expect(resolveImageMimeType({ type: 'image/jpg', name: 'a.jpg' })).toBe('image/jpeg');
    expect(resolveImageMimeType({ type: '', name: 'tokyo-night.webp' })).toBe('image/webp');
    expect(resolveImageMimeType({ type: 'application/pdf', name: 'doc.pdf' })).toBeNull();
  });

  it('extracts an image file from DataTransfer files or items', () => {
    const pngFile = new File(['abc'], 'cover.png', { type: 'image/png' });
    const txtFile = new File(['hello'], 'note.txt', { type: 'text/plain' });

    const fromFiles = extractImageFileFromDataTransfer({
      files: [txtFile, pngFile] as unknown as FileList,
      items: [] as unknown as DataTransferItemList,
    } as DataTransfer);
    expect(fromFiles).toBe(pngFile);

    const fromItems = extractImageFileFromDataTransfer({
      files: [] as unknown as FileList,
      items: [
        { kind: 'string', getAsFile: () => null },
        { kind: 'file', getAsFile: () => pngFile },
      ] as unknown as DataTransferItemList,
    } as DataTransfer);
    expect(fromItems).toBe(pngFile);
  });

  it('parses base64 data URLs cleanly', () => {
    expect(parseDataUrlBase64('data:image/png;base64,AQID')).toEqual({
      mimeType: 'image/png',
      data: 'AQID',
    });
    expect(parseDataUrlBase64('not-a-data-url')).toBeNull();
  });

  it('rejects unsupported MIME types and oversized raw files in prepareAiImageFile', async () => {
    const badFile = new File(['text'], 'readme.txt', { type: 'text/plain' });
    await expect(prepareAiImageFile(badFile)).rejects.toThrow(/JPEG, PNG, WebP, or GIF/);

    const emptyFile = new File([], 'empty.jpg', { type: 'image/jpeg' });
    await expect(prepareAiImageFile(emptyFile)).rejects.toThrow(/empty/i);

    const oversized = {
      name: 'huge.jpg',
      type: 'image/jpeg',
      size: MAX_RAW_IMAGE_BYTES + 1,
    } as unknown as File;
    await expect(prepareAiImageFile(oversized)).rejects.toThrow(/too large/i);
  });
});
