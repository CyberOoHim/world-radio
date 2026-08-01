import type { Station } from './types';

export interface MediaSessionHandlers {
  play: () => void;
  pause: () => void;
  next?: () => void;
  previous?: () => void;
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

  const artwork: MediaImage[] = [];
  if (station.favicon) {
    artwork.push({
      src: station.favicon,
      sizes: '96x96',
    });
  }
  artwork.push(
    { src: './icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: './icon-512.png', sizes: '512x512', type: 'image/png' }
  );

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
    ms.setActionHandler('stop', () => handlers.pause());
  } catch {
    // setActionHandler can throw if action unsupported
  }
}
