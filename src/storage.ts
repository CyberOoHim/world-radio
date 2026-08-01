import type { Station } from './types';

const FAV_KEY = 'world-radio:favorites';
const RECENT_KEY = 'world-radio:recent';
const VOLUME_KEY = 'world-radio:volume';

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function sanitizeStation(raw: unknown): Station | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (!isNonEmptyString(s.stationuuid)) return null;
  const name = typeof s.name === 'string' ? s.name : '';
  const url = typeof s.url === 'string' ? s.url : '';
  const url_resolved = typeof s.url_resolved === 'string' ? s.url_resolved : url;
  return {
    changeuuid: typeof s.changeuuid === 'string' ? s.changeuuid : '',
    stationuuid: s.stationuuid,
    name,
    url,
    url_resolved,
    homepage: typeof s.homepage === 'string' ? s.homepage : '',
    favicon: typeof s.favicon === 'string' ? s.favicon : '',
    tags: typeof s.tags === 'string' ? s.tags : '',
    country: typeof s.country === 'string' ? s.country : '',
    countrycode: typeof s.countrycode === 'string' ? s.countrycode : '',
    state: typeof s.state === 'string' ? s.state : '',
    language: typeof s.language === 'string' ? s.language : '',
    languagecodes: typeof s.languagecodes === 'string' ? s.languagecodes : '',
    votes: typeof s.votes === 'number' ? s.votes : 0,
    codec: typeof s.codec === 'string' ? s.codec : '',
    bitrate: typeof s.bitrate === 'number' ? s.bitrate : 0,
    lastcheckok: typeof s.lastcheckok === 'number' ? s.lastcheckok : 0,
    clickcount: typeof s.clickcount === 'number' ? s.clickcount : 0,
    clicktrend: typeof s.clicktrend === 'number' ? s.clicktrend : 0,
    geo_lat: typeof s.geo_lat === 'number' ? s.geo_lat : null,
    geo_long: typeof s.geo_long === 'number' ? s.geo_long : null,
  };
}

export function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isNonEmptyString);
  } catch {
    return [];
  }
}

export function saveFavorites(ids: string[]): void {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(ids));
  } catch {
    // Quota / private mode — keep in-memory state as source of truth
  }
}

export function loadRecent(): Station[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeStation)
      .filter((s): s is Station => s != null)
      .slice(0, 40);
  } catch {
    return [];
  }
}

export function saveRecent(stations: Station[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(stations.slice(0, 40)));
  } catch {
    // Quota / private mode
  }
}

export function loadVolume(): number {
  try {
    const v = localStorage.getItem(VOLUME_KEY);
    if (v == null) return 0.75;
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.75;
  } catch {
    return 0.75;
  }
}

export function saveVolume(v: number): void {
  try {
    localStorage.setItem(VOLUME_KEY, String(v));
  } catch {
    // Quota / private mode
  }
}
