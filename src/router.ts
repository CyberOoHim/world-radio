import type { ViewId } from './types';

export type Route =
  | { kind: 'view'; view: ViewId }
  | { kind: 'station'; uuid: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'country'; code: string }
  | { kind: 'search'; q: string }
  | { kind: 'near' }
  | { kind: 'map'; lat?: number; lon?: number; zoom?: number; stationUuid?: string };

const VIEW_SET = new Set<ViewId>([
  'discover',
  'countries',
  'genres',
  'favorites',
  'recent',
  'search',
]);

function decodeSegment(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

export function parseHash(hash = location.hash): Route | null {
  const rawWithQuery = hash.replace(/^#\/?/, '').trim();
  if (!rawWithQuery) return null;

  const [pathPart, queryPart] = rawWithQuery.split('?');
  const queryParams = new URLSearchParams(queryPart || '');
  const queryStation = queryParams.get('station') || undefined;

  const parts: string[] = [];
  for (const part of pathPart.split('/')) {
    const decoded = decodeSegment(part);
    if (decoded == null) return null;
    parts.push(decoded);
  }
  const [a, b, c, d] = parts;

  if (a === 'station' && b) return { kind: 'station', uuid: b };
  if (a === 'tag' && b) return { kind: 'tag', tag: b };
  if (a === 'country' && b) return { kind: 'country', code: b.toUpperCase() };
  if (a === 'search') return { kind: 'search', q: b || '' };
  if (a === 'near') return { kind: 'near' };
  if (a === 'map') return parseMapRoute(b, c, d, queryStation);
  if (a && VIEW_SET.has(a as ViewId)) return { kind: 'view', view: a as ViewId };
  return null;
}

function parseMapRoute(
  coordPart?: string,
  zoomPart?: string,
  stationPart?: string,
  queryStation?: string
): Route {
  const stationUuid = stationPart || queryStation || undefined;
  if (!coordPart) return stationUuid ? { kind: 'map', stationUuid } : { kind: 'map' };
  const [latS, lonS] = coordPart.split(',');
  const lat = Number(latS);
  const lon = Number(lonS);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return stationUuid ? { kind: 'map', stationUuid } : { kind: 'map' };
  }
  const zoom = zoomPart != null && zoomPart !== '' ? Number(zoomPart) : undefined;
  const safeZoom =
    typeof zoom === 'number' && Number.isFinite(zoom) ? Math.min(18, Math.max(1, Math.round(zoom))) : undefined;
  return { kind: 'map', lat, lon, zoom: safeZoom, stationUuid };
}

function routeToHash(route: Route): string {
  switch (route.kind) {
    case 'view':
      return route.view === 'discover' ? '#/' : `#/${route.view}`;
    case 'station':
      return `#/station/${encodeURIComponent(route.uuid)}`;
    case 'tag':
      return `#/tag/${encodeURIComponent(route.tag)}`;
    case 'country':
      return `#/country/${encodeURIComponent(route.code)}`;
    case 'search':
      return route.q ? `#/search/${encodeURIComponent(route.q)}` : '#/search';
    case 'near':
      return '#/near';
    case 'map': {
      if (route.lat == null || route.lon == null) {
        if (route.stationUuid) return `#/map?station=${encodeURIComponent(route.stationUuid)}`;
        return '#/map';
      }
      const coord = `${route.lat.toFixed(3)},${route.lon.toFixed(3)}`;
      const zoom = route.zoom != null ? Math.round(route.zoom) : undefined;
      if (route.stationUuid && zoom != null) {
        return `#/map/${coord}/${zoom}/${encodeURIComponent(route.stationUuid)}`;
      }
      if (zoom != null) return `#/map/${coord}/${zoom}`;
      return `#/map/${coord}`;
    }
  }
}

function sameHash(a: string, b: string): boolean {
  const norm = (h: string) => {
    if (!h || h === '#' || h === '#/') return '#/';
    return h;
  };
  return norm(a) === norm(b);
}

/** Update the URL hash. Prefer replace so browsing does not spam history. */
export function setHash(route: Route, replace = true) {
  const next = routeToHash(route);
  if (sameHash(location.hash, next)) return;
  if (replace) history.replaceState(null, '', next);
  else location.hash = next;
}

function getOriginBase(): string {
  if (typeof location !== 'undefined' && location.origin) {
    return `${location.origin}${location.pathname || ''}`;
  }
  return '';
}

export function stationShareUrl(uuid: string): string {
  return `${getOriginBase()}#/station/${encodeURIComponent(uuid)}`;
}

export function mapShareUrl(
  viewport?: { lat: number; lon: number; zoom: number } | null,
  stationUuid?: string
): string {
  const origin = getOriginBase();
  if (viewport) {
    const coord = `${viewport.lat.toFixed(3)},${viewport.lon.toFixed(3)}`;
    const zoom = Math.round(viewport.zoom);
    if (stationUuid) {
      return `${origin}#/map/${coord}/${zoom}/${encodeURIComponent(stationUuid)}`;
    }
    return `${origin}#/map/${coord}/${zoom}`;
  }
  if (stationUuid) {
    return stationShareUrl(stationUuid);
  }
  return `${origin}#/map`;
}
