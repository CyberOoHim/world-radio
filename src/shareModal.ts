import QRCode from 'qrcode';
import { escapeHtml } from './html';
import type { Station } from './types';

export interface ShareCardOptions {
  stationName: string;
  url: string;
  subtitle?: string;
  tags?: string;
}

export interface ShareModalOptions {
  station: Station | { name: string; country?: string; bitrate?: number; stationuuid?: string };
  url: string;
  isMap?: boolean;
  toast: (msg: string) => void;
}

export const BOTTOM_BRAND_TEXT = 'Sè-kài La-jí-o͘h';

/**
 * Creates a slug suitable for saving downloaded files.
 */
function fileSlug(name: string): string {
  const clean = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return clean || 'station';
}

/**
 * Helper to draw a rounded rectangle on a 2D canvas context.
 */
function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Wraps text into lines that fit within maxWidth.
 */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 2
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(testLine).width <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
      if (lines.length === maxLines - 1) break;
    }
  }

  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }

  // If text exceeded maxLines, truncate the last line with ellipsis
  if (lines.length === maxLines && words.length > 0) {
    let last = lines[lines.length - 1];
    while (last.length > 0 && ctx.measureText(`${last}…`).width > maxWidth) {
      last = last.slice(0, -1);
    }
    lines[lines.length - 1] = `${last}…`;
  }

  return lines.length > 0 ? lines : [text];
}

/**
 * Generates the high-resolution downloadable card image.
 * Features:
 *  - Station name on top
 *  - QR code in the middle
 *  - “Sè-kài La-jí-o͘h” in the bottom
 */
export async function generateShareCard(
  options: ShareCardOptions
): Promise<{ dataUrl: string; blob: Blob | null }> {
  const { stationName, url, subtitle } = options;

  // 1. Generate QR code Data URL (scannable, high contrast)
  const qrDataUrl = await QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 280,
    color: {
      dark: '#0c1222',
      light: '#ffffff',
    },
  });

  // If running in an environment without DOM canvas, return raw QR data URL
  if (typeof document === 'undefined') {
    return { dataUrl: qrDataUrl, blob: null };
  }

  const canvas = document.createElement('canvas');
  const width = 640;
  const height = 820;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { dataUrl: qrDataUrl, blob: null };
  }

  // ── 2. Background Gradient ──
  const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
  bgGrad.addColorStop(0, '#090e1a');
  bgGrad.addColorStop(0.5, '#0f172a');
  bgGrad.addColorStop(1, '#070b14');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Subtle ambient radio glow in the center
  const radial = ctx.createRadialGradient(width / 2, 380, 40, width / 2, 380, 360);
  radial.addColorStop(0, 'rgba(56, 189, 248, 0.12)');
  radial.addColorStop(0.6, 'rgba(14, 165, 233, 0.04)');
  radial.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, width, height);

  // ── 3. Outer Decorative Card Frame ──
  drawRoundRect(ctx, 24, 24, width - 48, height - 48, 24);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  drawRoundRect(ctx, 36, 36, width - 72, height - 72, 18);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // ── 4. Top Badge / Overline ──
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#38bdf8';
  ctx.font = '600 12px "DM Sans", -apple-system, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillText('✦ WORLD RADIO · LIVE ✦', width / 2, 76);
  ctx.letterSpacing = '0px';

  // ── 5. Station Name ON TOP ──
  const displayName = stationName.trim() || 'World Radio Station';
  let titleFontSize = 32;
  if (displayName.length > 28) titleFontSize = 26;
  if (displayName.length > 44) titleFontSize = 22;

  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${titleFontSize}px "DM Sans", -apple-system, sans-serif`;

  const lines = wrapText(ctx, displayName, width - 110, 2);
  const titleStartY = lines.length === 1 ? 122 : 112;
  const lineSpacing = titleFontSize + 8;
  lines.forEach((line, idx) => {
    ctx.fillText(line, width / 2, titleStartY + idx * lineSpacing);
  });

  // Optional subtitle (e.g. Country / Stream details)
  const subY = titleStartY + (lines.length - 1) * lineSpacing + 34;
  if (subtitle) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 14px "DM Sans", -apple-system, sans-serif';
    ctx.fillText(subtitle, width / 2, Math.min(180, subY));
  }

  // ── 6. QR Code Box (MIDDLE) ──
  const qrBoxSize = 290;
  const qrBoxX = (width - qrBoxSize) / 2;
  const qrBoxY = 205;

  // White rounded container with shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  drawRoundRect(ctx, qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 20);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();

  // Draw QR code image onto canvas
  await new Promise<void>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const padding = 16;
      ctx.drawImage(
        img,
        qrBoxX + padding,
        qrBoxY + padding,
        qrBoxSize - padding * 2,
        qrBoxSize - padding * 2
      );
      resolve();
    };
    img.onerror = () => resolve();
    img.src = qrDataUrl;
  });

  // Caption directly below QR Code
  ctx.fillStyle = '#64748b';
  ctx.font = '500 13px "DM Sans", -apple-system, sans-serif';
  ctx.fillText('Scan to listen live · 即掃即聽', width / 2, qrBoxY + qrBoxSize + 28);

  // ── 7. Decorative Vintage Radio Line ──
  const lineY = qrBoxY + qrBoxSize + 60;
  const lineGrad = ctx.createLinearGradient(width / 2 - 140, lineY, width / 2 + 140, lineY);
  lineGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
  lineGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.25)');
  lineGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.strokeStyle = lineGrad;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(width / 2 - 140, lineY);
  ctx.lineTo(width / 2 + 140, lineY);
  ctx.stroke();

  // Accent dial dots
  ctx.fillStyle = '#475569';
  ctx.font = '11px sans-serif';
  ctx.fillText('•   •   •', width / 2, lineY - 8);

  // ── 8. "Sè-kài La-jí-o͘h" IN THE BOTTOM ──
  ctx.fillStyle = '#f8fafc';
  // Upright geometric font so characters render crisply with proper accents
  ctx.font = '700 29px "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.letterSpacing = '1.5px';
  ctx.fillText(BOTTOM_BRAND_TEXT, width / 2, 630);
  ctx.letterSpacing = '0px';

  // Sub-tagline
  ctx.fillStyle = '#94a3b8';
  ctx.font = '600 11px "DM Sans", -apple-system, sans-serif';
  ctx.letterSpacing = '3.5px';
  ctx.fillText('GLOBAL AIRWAVES · WORLD RADIO', width / 2, 664);
  ctx.letterSpacing = '0px';

  // Bottom footer note
  ctx.fillStyle = '#475569';
  ctx.font = '400 12px "DM Sans", -apple-system, sans-serif';
  ctx.fillText('Listen to live stations from everywhere', width / 2, 735);

  // Export results
  const dataUrl = canvas.toDataURL('image/png');
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/png');
  });

  return { dataUrl, blob };
}

/**
 * Triggers browser download for a generated image data URL.
 */
export function downloadShareCard(dataUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

let activeModalOverlay: HTMLElement | null = null;
let activeKeyHandler: ((e: KeyboardEvent) => void) | null = null;

export function isShareModalOpen(): boolean {
  return activeModalOverlay !== null;
}

export function closeShareModal(): void {
  if (activeKeyHandler) {
    window.removeEventListener('keydown', activeKeyHandler);
    activeKeyHandler = null;
  }
  if (activeModalOverlay) {
    activeModalOverlay.remove();
    activeModalOverlay = null;
  }
}

/**
 * Opens a modal displaying the share card preview,
 * with downloadable image button, copy link button, and native share.
 */
export async function openShareModal(options: ShareModalOptions): Promise<void> {
  closeShareModal();

  const { station, url, isMap, toast } = options;
  const stationName = station.name || 'World Radio Station';
  const country = 'country' in station ? station.country || '' : '';
  const bitrate = 'bitrate' in station && station.bitrate ? `${station.bitrate} kbps` : '';
  const subtitle = [country, bitrate, isMap ? 'Map location' : ''].filter(Boolean).join(' · ');

  const filename = `${fileSlug(stationName)}-sekai-lajioh.png`;

  // Render initial modal shell with loading indicator
  const overlay = document.createElement('div');
  overlay.className = 'share-modal-backdrop';
  overlay.innerHTML = `
    <div class="share-modal-container">
      <div class="share-modal-card" role="dialog" aria-modal="true" aria-labelledby="share-title">
        <div class="share-modal-header">
          <div class="share-modal-badge">
            <span class="share-badge-dot"></span>
            <span>${isMap ? 'Map Selection' : 'Station Share'}</span>
          </div>
          <button type="button" class="share-modal-close" data-action="close-share-modal" aria-label="Close modal">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="20" height="20">
              <path d="M6 6l12 12M18 6L6 18"/>
            </svg>
          </button>
        </div>
        <div class="share-modal-body">
          <h2 id="share-title" class="share-modal-title">Share Station</h2>
          <p class="share-modal-desc">
            Download your personalized card with QR code, station name, and <strong>“${BOTTOM_BRAND_TEXT}”</strong>.
          </p>

          <div class="share-card-preview-wrap">
            <div class="share-card-loading">
              <div class="share-spinner"></div>
              <span>Generating share card...</span>
            </div>
            <img class="share-card-image" alt="Share Card for ${escapeHtml(stationName)}" hidden />
          </div>

          <div class="share-url-box">
            <input type="text" class="share-url-input" readonly value="${escapeHtml(url)}" aria-label="Share URL" />
            <button type="button" class="btn btn-secondary share-copy-btn" data-action="copy-share-url">
              📋 Copy
            </button>
          </div>

          <div class="share-modal-actions">
            <button type="button" class="btn btn-primary share-download-btn" data-action="download-share-card" disabled>
              📥 Download Image
            </button>
            <button type="button" class="btn btn-secondary share-native-btn" data-action="native-share-btn">
              🔗 Share...
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  activeModalOverlay = overlay;

  activeKeyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeShareModal();
  };
  window.addEventListener('keydown', activeKeyHandler);

  // Close when clicking outside
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || (e.target as HTMLElement).classList.contains('share-modal-container')) {
      closeShareModal();
    }
  });

  const closeBtn = overlay.querySelector('[data-action="close-share-modal"]');
  closeBtn?.addEventListener('click', () => closeShareModal());

  const copyBtn = overlay.querySelector<HTMLButtonElement>('[data-action="copy-share-url"]');
  const urlInput = overlay.querySelector<HTMLInputElement>('.share-url-input');

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied to clipboard');
    } catch {
      urlInput?.select();
      toast('Selected link — press Ctrl+C / Cmd+C to copy');
    }
  };

  copyBtn?.addEventListener('click', copyUrl);
  urlInput?.addEventListener('click', () => urlInput.select());

  // Asynchronously generate the downloadable image card
  try {
    const { dataUrl, blob } = await generateShareCard({
      stationName,
      url,
      subtitle,
    });

    if (activeModalOverlay !== overlay) return; // closed during generate

    const loadingEl = overlay.querySelector<HTMLElement>('.share-card-loading');
    const imgEl = overlay.querySelector<HTMLImageElement>('.share-card-image');
    const downloadBtn = overlay.querySelector<HTMLButtonElement>('[data-action="download-share-card"]');
    const nativeBtn = overlay.querySelector<HTMLButtonElement>('[data-action="native-share-btn"]');

    if (loadingEl) loadingEl.hidden = true;
    if (imgEl) {
      imgEl.src = dataUrl;
      imgEl.hidden = false;
    }

    if (downloadBtn) {
      downloadBtn.disabled = false;
      downloadBtn.addEventListener('click', () => {
        downloadShareCard(dataUrl, filename);
        toast('Image card downloaded');
      });
    }

    if (nativeBtn) {
      nativeBtn.addEventListener('click', async () => {
        if (navigator.share) {
          try {
            const files =
              blob && navigator.canShare && navigator.canShare({ files: [new File([blob], filename, { type: 'image/png' })] })
                ? [new File([blob], filename, { type: 'image/png' })]
                : undefined;

            await navigator.share({
              title: stationName,
              text: `Listen to ${stationName} on World Radio (${BOTTOM_BRAND_TEXT})`,
              url,
              ...(files ? { files } : {}),
            });
            toast('Shared successfully');
          } catch {
            // User cancelled or share dismissed
          }
        } else {
          await copyUrl();
        }
      });
    }
  } catch (err) {
    if (activeModalOverlay === overlay) {
      const loadingEl = overlay.querySelector<HTMLElement>('.share-card-loading');
      if (loadingEl) {
        loadingEl.innerHTML = `<span style="color:#ef4444">Could not generate QR card</span>`;
      }
    }
  }
}
