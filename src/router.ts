import type { ViewId } from './types';

export type Route =
  | { kind: 'view'; view: ViewId }
  | { kind: 'station'; uuid: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'country'; code: string }
  | { kind: 'search'; q: string }
  | { kind: 'near' };

const VIEW_SET = new Set<ViewId>([
  'discover',
  'countries',
  'genres',
  'favorites',
  'recent',
  'search',
]);

export function parseHash(hash = location.hash): Route | null {
  const raw = hash.replace(/^#\/?/, '').trim();
  if (!raw) return null;

  const parts = raw.split('/').map(decodeURIComponent);
  const [a, b] = parts;

  if (a === 'station' && b) return { kind: 'station', uuid: b };
  if (a === 'tag' && b) return { kind: 'tag', tag: b };
  if (a === 'country' && b) return { kind: 'country', code: b.toUpperCase() };
  if (a === 'search') return { kind: 'search', q: b || '' };
  if (a === 'near') return { kind: 'near' };
  if (a && VIEW_SET.has(a as ViewId)) return { kind: 'view', view: a as ViewId };
  return null;
}

export function setHash(route: Route, replace = false) {
  let path = '';
  switch (route.kind) {
    case 'view':
      path = route.view === 'discover' ? '' : `/${route.view}`;
      break;
    case 'station':
      path = `/station/${encodeURIComponent(route.uuid)}`;
      break;
    case 'tag':
      path = `/tag/${encodeURIComponent(route.tag)}`;
      break;
    case 'country':
      path = `/country/${encodeURIComponent(route.code)}`;
      break;
    case 'search':
      path = route.q
        ? `/search/${encodeURIComponent(route.q)}`
        : '/search';
      break;
    case 'near':
      path = '/near';
      break;
  }

  const next = path ? `#${path}` : '#/';
  if (replace) {
    history.replaceState(null, '', next);
  } else if (location.hash !== next && location.hash !== path.replace(/^\//, '#')) {
    // Avoid duplicate history entries when already there
    if (location.hash !== next) location.hash = next.slice(1) ? next : '#/';
  }
}

export function stationShareUrl(uuid: string): string {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#/station/${encodeURIComponent(uuid)}`;
}
