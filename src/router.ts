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

export function stationShareUrl(uuid: string): string {
  return `${location.origin}${location.pathname}#/station/${encodeURIComponent(uuid)}`;
}
