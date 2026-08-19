import type { Station } from './types';

export interface MediaSessionHandlers {
  play: () => void;
  pause: () => void;
  next?: () => void;
  previous?: () => void;
  stop?: () => void;
}

function toAbsoluteUrl(src: string): string {
  try {
    return new URL(src, window.location.href).href;
  } catch {
    return src;
  }
}

export function updateMediaSession(
  station: Station | null,
  playing: boolean,
  handlers: MediaSessionHandlers
) {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;

  if (!station) {
    ms.metadata = null;
    ms.playbackState = 'none';
    return;
  }

  const artwork: MediaImage[] = [
    { src: toAbsoluteUrl('./icon-512.png?v=4'), sizes: '512x512', type: 'image/png' },
    { src: toAbsoluteUrl('./icon-192.png?v=4'), sizes: '192x192', type: 'image/png' },
    { src: toAbsoluteUrl('./apple-touch-icon.png?v=4'), sizes: '180x180', type: 'image/png' },
    { src: toAbsoluteUrl('./favicon-32x32.png?v=4'), sizes: '32x32', type: 'image/png' },
  ];

  if (station.favicon && station.favicon.trim().length > 0) {
    artwork.unshift({
      src: station.favicon,
      sizes: '96x96',
    });
  }

  try {
    ms.metadata = new MediaMetadata({
      title: station.name || 'World Radio',
      artist: station.country || station.countrycode || 'Live radio',
      album: 'World Radio',
      artwork,
    });
  } catch {
    // Some browsers reject remote artwork
    try {
      ms.metadata = new MediaMetadata({
        title: station.name || 'World Radio',
        artist: station.country || 'Live radio',
        album: 'World Radio',
      });
    } catch {
      // ignore
    }
  }

  ms.playbackState = playing ? 'playing' : 'paused';

  try {
    ms.setActionHandler('play', () => handlers.play());
    ms.setActionHandler('pause', () => handlers.pause());
    ms.setActionHandler('nexttrack', handlers.next ? () => handlers.next!() : null);
    ms.setActionHandler('previoustrack', handlers.previous ? () => handlers.previous!() : null);
    ms.setActionHandler('stop', () => {
      if (handlers.stop) handlers.stop();
      else handlers.pause();
    });
  } catch {
    // setActionHandler can throw if action unsupported
  }
}
