import type { AiImageAttachment } from './types';

export const SUPPORTED_AI_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export const MAX_RAW_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_EDGE_PX = 1024;
const DIRECT_PASS_MAX_BYTES = 350 * 1024;

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

export function resolveImageMimeType(file: Pick<File, 'type' | 'name'>): string | null {
  const rawType = (file.type || '').trim().toLowerCase();
  const normalized = rawType === 'image/jpg' ? 'image/jpeg' : rawType;
  if (SUPPORTED_AI_IMAGE_MIME_TYPES.has(normalized)) {
    return normalized;
  }
  const ext = (file.name || '').split('.').pop()?.trim().toLowerCase() || '';
  const fromExt = EXT_TO_MIME[ext];
  return fromExt && SUPPORTED_AI_IMAGE_MIME_TYPES.has(fromExt) ? fromExt : null;
}

export function extractImageFileFromDataTransfer(dt: DataTransfer | null | undefined): File | null {
  if (!dt) return null;
  if (dt.files && dt.files.length > 0) {
    for (let i = 0; i < dt.files.length; i++) {
      const f = dt.files[i];
      if (f && resolveImageMimeType(f)) return f;
    }
  }
  if (dt.items && dt.items.length > 0) {
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i];
      if (item && item.kind === 'file') {
        const f = item.getAsFile();
        if (f && resolveImageMimeType(f)) return f;
      }
    }
  }
  return null;
}

export function parseDataUrlBase64(dataUrl: string): { mimeType: string; data: string } | null {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!match) return null;
  return { mimeType: match[1].toLowerCase(), data: match[2] };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Could not read image file.'));
      }
    };
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.readAsDataURL(file);
  });
}

async function decodeImageDimensionsAndDraw(
  file: File
): Promise<{ width: number; height: number; canvasDataUrl: string }> {
  let bitmap: ImageBitmap | null = null;
  let imgEl: HTMLImageElement | null = null;
  let objectUrl: string | null = null;

  try {
    let srcWidth = 0;
    let srcHeight = 0;

    if (typeof createImageBitmap === 'function') {
      bitmap = await createImageBitmap(file);
      srcWidth = bitmap.width;
      srcHeight = bitmap.height;
    } else {
      objectUrl = URL.createObjectURL(file);
      imgEl = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Unsupported or corrupted image file.'));
        img.src = objectUrl!;
      });
      srcWidth = imgEl.naturalWidth || imgEl.width;
      srcHeight = imgEl.naturalHeight || imgEl.height;
    }

    if (!srcWidth || !srcHeight) {
      throw new Error('Image has zero dimensions.');
    }

    const scale = Math.min(1, MAX_IMAGE_EDGE_PX / Math.max(srcWidth, srcHeight));
    const outWidth = Math.max(1, Math.round(srcWidth * scale));
    const outHeight = Math.max(1, Math.round(srcHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = outWidth;
    canvas.height = outHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context unavailable.');
    }
    ctx.fillStyle = '#0a0f1d';
    ctx.fillRect(0, 0, outWidth, outHeight);
    if (bitmap) {
      ctx.drawImage(bitmap, 0, 0, outWidth, outHeight);
    } else if (imgEl) {
      ctx.drawImage(imgEl, 0, 0, outWidth, outHeight);
    }

    return {
      width: outWidth,
      height: outHeight,
      canvasDataUrl: canvas.toDataURL('image/jpeg', 0.84),
    };
  } finally {
    bitmap?.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Validate, optionally resize/compress via canvas, and encode a user image
 * for AI Tune upload (keeping payloads compact and compatible with Gemini models).
 */
export async function prepareAiImageFile(file: File): Promise<AiImageAttachment> {
  const detectedMime = resolveImageMimeType(file);
  if (!detectedMime) {
    throw new Error('Please choose a JPEG, PNG, WebP, or GIF image.');
  }
  if (file.size <= 0) {
    throw new Error('Selected image file is empty.');
  }
  if (file.size > MAX_RAW_IMAGE_BYTES) {
    throw new Error('Image is too large (max 20 MB before compression).');
  }

  const name = (file.name || 'uploaded-image').trim().slice(0, 80) || 'uploaded-image';

  // Try resizing/normalizing in browser canvas for fast uploads and wide model compatibility
  if (typeof document !== 'undefined') {
    try {
      const { width, height, canvasDataUrl } = await decodeImageDimensionsAndDraw(file);
      const canPassOriginal =
        (detectedMime === 'image/jpeg' || detectedMime === 'image/png') &&
        file.size <= DIRECT_PASS_MAX_BYTES &&
        width <= MAX_IMAGE_EDGE_PX &&
        height <= MAX_IMAGE_EDGE_PX;

      if (canPassOriginal) {
        const rawUrl = await readFileAsDataUrl(file);
        const parsed = parseDataUrlBase64(rawUrl);
        if (parsed) {
          return {
            mimeType: detectedMime,
            data: parsed.data,
            previewUrl: rawUrl,
            name,
            width,
            height,
          };
        }
      }

      const parsedCanvas = parseDataUrlBase64(canvasDataUrl);
      if (parsedCanvas) {
        return {
          mimeType: parsedCanvas.mimeType,
          data: parsedCanvas.data,
          previewUrl: canvasDataUrl,
          name,
          width,
          height,
        };
      }
    } catch (err) {
      // If browser couldn't decode (e.g., animated or exotic container), fall back to direct read if under 3.5 MB
      if (file.size > 3.5 * 1024 * 1024) {
        throw err instanceof Error ? err : new Error('Could not process image.');
      }
    }
  }

  const fallbackUrl = await readFileAsDataUrl(file);
  const parsedFallback = parseDataUrlBase64(fallbackUrl);
  if (!parsedFallback) {
    throw new Error('Could not encode image as base64.');
  }
  return {
    mimeType: detectedMime,
    data: parsedFallback.data,
    previewUrl: fallbackUrl,
    name,
  };
}
