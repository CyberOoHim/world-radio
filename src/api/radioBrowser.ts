import { nearExpansionComplete } from '../safeUrl';
import { sanitizeStation } from '../storage';
import type {
  Country,
  Language,
  Station,
  Tag,
  TimeOfDayMode,
  TimeOfDayPeriod,
} from '../types';

export type { TimeOfDayMode, TimeOfDayPeriod };

const MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
  'https://fr1.api.radio-browser.info',
];

const FETCH_TIMEOUT_MS = 15_000;
const MIRROR_PROBE_MS = 4_000;

let baseUrl = MIRRORS[0];
let baseReady: Promise<void> | null = null;
let pickGeneration = 0;

async function probeMirror(mirror: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), MIRROR_PROBE_MS);
    const res = await fetch(`${mirror}/json/stats`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

/** Select a healthy mirror. When `force` is true, re-probe even if already ready. */
async function pickMirror(force = false): Promise<void> {
  if (!force && baseReady) return baseReady;

  const gen = ++pickGeneration;
  baseReady = (async () => {
    const order = force
      ? [...MIRRORS.filter((m) => m !== baseUrl), baseUrl]
      : [...MIRRORS];

    for (const mirror of order) {
      if (gen !== pickGeneration) return;
      if (await probeMirror(mirror)) {
        if (gen !== pickGeneration) return;
        baseUrl = mirror;
        return;
      }
    }
    if (gen !== pickGeneration) return;
    if (!force) baseUrl = MIRRORS[0];
  })();

  return baseReady;
}

function withTimeoutSignal(
  external?: AbortSignal | null,
  ms = FETCH_TIMEOUT_MS
): { signal: AbortSignal; clear: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);

  const onExternalAbort = () => ctrl.abort();
  if (external) {
    if (external.aborted) ctrl.abort();
    else external.addEventListener('abort', onExternalAbort, { once: true });
  }

  return {
    signal: ctrl.signal,
    clear: () => {
      clearTimeout(timer);
      if (external) external.removeEventListener('abort', onExternalAbort);
    },
  };
}

async function fetchOnce<T>(path: string, init?: RequestInit): Promise<T> {
  const { signal, clear } = withTimeoutSignal(init?.signal ?? null);
  try {
    const url = `${baseUrl}${path}`;
    const res = await fetch(url, {
      ...init,
      signal,
      headers: {
        Accept: 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new Error(`Radio API error ${res.status}: ${res.statusText}`);
    }
    return (await res.json()) as T;
  } finally {
    clear();
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  await pickMirror(false);
  try {
    return await fetchOnce<T>(path, init);
  } catch (err) {
    if (init?.signal?.aborted) throw err;
    if (err instanceof DOMException && err.name === 'AbortError' && init?.signal?.aborted) {
      throw err;
    }

    baseReady = null;
    await pickMirror(true);
    return fetchOnce<T>(path, init);
  }
}

export interface SearchParams {
  name?: string;
  country?: string;
  countrycode?: string;
  tag?: string;
  tagList?: string;
  language?: string;
  limit?: number;
  offset?: number;
  order?: string;
  reverse?: boolean;
  hidebroken?: boolean;
  is_https?: boolean;
  /** Reference latitude for geo_distance filtering / distance annotation */
  geo_lat?: number;
  /** Reference longitude for geo_distance filtering / distance annotation */
  geo_long?: number;
  /** Max distance in meters from (geo_lat, geo_long). Required to actually filter “near”. */
  geo_distance?: number;
  /** true = only stations that have geo coordinates */
  has_geo_info?: boolean;
  /** Cache-busting timestamp parameter */
  _t?: number;
}

function toQuery(params: SearchParams): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    q.set(k, String(v));
  }
  return q.toString();
}

function sanitizeStationList(raw: unknown): Station[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(sanitizeStation).filter((s): s is Station => s != null);
}

export async function searchStations(params: SearchParams = {}): Promise<Station[]> {
  const defaults: SearchParams = {
    hidebroken: true,
    order: 'clickcount',
    reverse: true,
    limit: 48,
    offset: 0,
    ...params,
  };
  return sanitizeStationList(await apiFetch<unknown>(`/json/stations/search?${toQuery(defaults)}`));
}

export async function getTopStations(
  limit = 48,
  offset = 0,
  extra: SearchParams = {}
): Promise<Station[]> {
  return searchStations({
    limit,
    offset,
    order: extra.order ?? 'clickcount',
    reverse: extra.reverse ?? true,
    ...extra,
  });
}

export async function getStationsByCountry(
  countrycode: string,
  limit = 48,
  offset = 0,
  extra: SearchParams = {}
): Promise<Station[]> {
  return searchStations({ countrycode, limit, offset, ...extra });
}

export async function getStationsByTag(
  tag: string,
  limit = 48,
  offset = 0,
  extra: SearchParams = {}
): Promise<Station[]> {
  return searchStations({ tag, limit, offset, ...extra });
}

export async function getStationsByUuid(uuid: string): Promise<Station[]> {
  return sanitizeStationList(
    await apiFetch<unknown>(`/json/stations/byuuid/${encodeURIComponent(uuid)}`)
  );
}

/** Batch resolve stations by UUID (comma-separated GET, with per-uuid fallback). */
export async function getStationsByUuids(uuids: string[]): Promise<Station[]> {
  if (uuids.length === 0) return [];
  const unique = [...new Set(uuids.filter(Boolean))];
  const results: Station[] = [];
  const chunk = 20;
  for (let i = 0; i < unique.length; i += chunk) {
    const slice = unique.slice(i, i + chunk);
    try {
      const path = `/json/stations/byuuid/${slice.map(encodeURIComponent).join(',')}`;
      const list = sanitizeStationList(await apiFetch<unknown>(path));
      if (list.length) {
        results.push(...list);
        continue;
      }
    } catch {
      // fall through to individual
    }
    const settled = await Promise.allSettled(slice.map((uuid) => getStationsByUuid(uuid)));
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value[0]) results.push(r.value[0]);
    }
  }
  return results;
}

/**
 * Fetch stations in random order.
 * Soft filters (language, tag, https, …) are allowed; order/offset always stay random.
 */
export async function getRandomStations(
  limit = 12,
  extra: SearchParams = {}
): Promise<Station[]> {
  // Strip pagination/sort so callers cannot accidentally force popular-first results.
  const {
    order: _order,
    reverse: _reverse,
    offset: _offset,
    limit: _limit,
    ...filters
  } = extra;
  return searchStations({
    ...filters,
    limit,
    offset: 0,
    order: 'random',
    reverse: false,
    hidebroken: true,
  });
}

/** Whether a station looks streamable enough to attempt (not a ranking signal). */
export function isLikelyPlayable(
  station: Station,
  opts?: { httpsOnly?: boolean }
): boolean {
  const url = (station.url_resolved || station.url || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) return false;
  if (opts?.httpsOnly && !/^https:\/\//i.test(url)) return false;
  // Prefer online stations, but allow unknown (null/undefined) so snapshots still work.
  if (station.lastcheckok === 0) return false;
  return Boolean(station.stationuuid);
}

export interface NearSearchMeta {
  radiusMeters: number;
  nextRadiusMeters: number | null;
  found: number;
}

let lastNearMeta: NearSearchMeta = { radiusMeters: 0, nextRadiusMeters: null, found: 0 };

export function getLastNearMeta(): NearSearchMeta {
  return lastNearMeta;
}

/**
 * Stations near a lat/lon.
 * Radio Browser has no `order=distance`; we expand radius then sort by geo_distance.
 */
export async function getStationsNear(
  lat: number,
  lon: number,
  limit = 48,
  offset = 0,
  extra: SearchParams = {}
): Promise<Station[]> {
  // Soft filters only — never let list sort/pagination clobber geo query.
  const {
    order: _order,
    reverse: _reverse,
    offset: _offset,
    limit: _limit,
    geo_lat: _glat,
    geo_long: _glon,
    geo_distance: _gdist,
    has_geo_info: _hasGeo,
    ...filters
  } = extra;

  lastNearMeta = { radiusMeters: 0, nextRadiusMeters: null, found: 0 };

  // Progressive radii (m). Cap rounds so Near me cannot hang on many sequential API calls.
  const radiiMeters = [100_000, 350_000, 1_000_000, 2_500_000];
  const need = offset + limit;
  // Over-fetch a bit so sorting still fills the page after filtering.
  const fetchLimit = Math.min(200, Math.max(need + 24, 64));

  const byId = new Map<string, Station>();

  for (const radius of radiiMeters) {
    try {
      const list = await searchStations({
        ...filters,
        geo_lat: lat,
        geo_long: lon,
        geo_distance: radius,
        has_geo_info: true,
        hidebroken: true,
        // `distance` is not a valid order field in the API docs.
        order: 'clickcount',
        reverse: true,
        limit: fetchLimit,
        offset: 0,
      });
      for (const s of list) {
        if (!s.stationuuid) continue;
        const prev = byId.get(s.stationuuid);
        // Keep the row with the better (smaller) distance annotation when present.
        if (
          !prev ||
          (typeof s.geo_distance === 'number' &&
            (typeof prev.geo_distance !== 'number' || s.geo_distance < prev.geo_distance))
        ) {
          byId.set(s.stationuuid, s);
        }
      }
    } catch {
      // try next radius / mirror already retried in apiFetch
    }

    lastNearMeta = {
      radiusMeters: radius,
      nextRadiusMeters: radiiMeters[radiiMeters.indexOf(radius) + 1] ?? null,
      found: byId.size,
    };
    if (nearExpansionComplete(byId.size, need)) break;
  }

  const sorted = [...byId.values()].sort((a, b) => {
    const da = typeof a.geo_distance === 'number' ? a.geo_distance : Number.POSITIVE_INFINITY;
    const db = typeof b.geo_distance === 'number' ? b.geo_distance : Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return (b.clickcount || 0) - (a.clickcount || 0);
  });

  lastNearMeta = {
    ...lastNearMeta,
    found: sorted.length,
  };

  return sorted.slice(offset, offset + limit);
}

export async function getCountries(): Promise<Country[]> {
  const list = await apiFetch<unknown>(
    '/json/countries?order=stationcount&reverse=true&hidebroken=true'
  );
  if (!Array.isArray(list)) return [];
  const out: Country[] = [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const c = row as Record<string, unknown>;
    const iso = typeof c.iso_3166_1 === 'string' ? c.iso_3166_1 : '';
    const count = typeof c.stationcount === 'number' && Number.isFinite(c.stationcount) ? c.stationcount : 0;
    const name = typeof c.name === 'string' ? c.name : '';
    if (!iso || count <= 0) continue;
    out.push({ name, iso_3166_1: iso, stationcount: count });
  }
  return out;
}

export async function getTags(limit = 120): Promise<Tag[]> {
  const list = await apiFetch<unknown>(
    `/json/tags?order=stationcount&reverse=true&hidebroken=true&limit=${limit}`
  );
  if (!Array.isArray(list)) return [];
  const out: Tag[] = [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const t = row as Record<string, unknown>;
    const name = typeof t.name === 'string' ? t.name.trim() : '';
    const count = typeof t.stationcount === 'number' && Number.isFinite(t.stationcount) ? t.stationcount : 0;
    if (!name || count <= 0) continue;
    out.push({ name, stationcount: count });
  }
  return out;
}

export async function getLanguages(limit = 80): Promise<Language[]> {
  try {
    const list = await apiFetch<unknown>(
      `/json/languages?order=stationcount&reverse=true&hidebroken=true&limit=${limit}`
    );
    if (!Array.isArray(list)) return [];
    const out: Language[] = [];
    for (const row of list) {
      if (!row || typeof row !== 'object') continue;
      const l = row as Record<string, unknown>;
      const name = typeof l.name === 'string' ? l.name.trim() : '';
      const count = typeof l.stationcount === 'number' && Number.isFinite(l.stationcount) ? l.stationcount : 0;
      if (!name || count <= 0) continue;
      out.push({
        name,
        iso_639: typeof l.iso_639 === 'string' ? l.iso_639 : undefined,
        stationcount: count,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Resolve a playable stream URL and register a click (improves ranking). */
export async function resolveStream(stationuuid: string): Promise<string | null> {
  try {
    const data = await apiFetch<{ url?: string; name?: string } | Array<{ url?: string }>>(
      `/json/url/${encodeURIComponent(stationuuid)}`
    );
    if (Array.isArray(data)) return data[0]?.url ?? null;
    return data.url ?? null;
  } catch {
    return null;
  }
}

export const CONTINENTS: Record<string, string[]> = {
  Africa: [
    'DZ', 'AO', 'BJ', 'BW', 'BF', 'BI', 'CM', 'CV', 'CF', 'TD', 'KM', 'CG', 'CD',
    'CI', 'DJ', 'EG', 'GQ', 'ER', 'SZ', 'ET', 'GA', 'GM', 'GH', 'GN', 'GW', 'KE',
    'LS', 'LR', 'LY', 'MG', 'MW', 'ML', 'MR', 'MU', 'MA', 'MZ', 'NA', 'NE', 'NG',
    'RW', 'ST', 'SN', 'SC', 'SL', 'SO', 'ZA', 'SS', 'SD', 'TZ', 'TG', 'TN', 'UG',
    'ZM', 'ZW',
  ],
  Asia: [
    'AF', 'AM', 'AZ', 'BH', 'BD', 'BT', 'BN', 'KH', 'CN', 'CY', 'GE', 'HK', 'IN',
    'ID', 'IR', 'IQ', 'IL', 'JP', 'JO', 'KZ', 'KW', 'KG', 'LA', 'LB', 'MO', 'MY',
    'MV', 'MN', 'MM', 'NP', 'KP', 'OM', 'PK', 'PS', 'PH', 'QA', 'SA', 'SG', 'KR',
    'LK', 'SY', 'TW', 'TJ', 'TH', 'TL', 'TR', 'TM', 'AE', 'UZ', 'VN', 'YE',
  ],
  Europe: [
    'AL', 'AD', 'AT', 'BY', 'BE', 'BA', 'BG', 'HR', 'CZ', 'DK', 'EE', 'FI', 'FR',
    'DE', 'GR', 'HU', 'IS', 'IE', 'IT', 'XK', 'LV', 'LI', 'LT', 'LU', 'MT', 'MD',
    'MC', 'ME', 'NL', 'MK', 'NO', 'PL', 'PT', 'RO', 'RU', 'SM', 'RS', 'SK', 'SI',
    'ES', 'SE', 'CH', 'UA', 'GB', 'VA',
  ],
  'North America': [
    'AG', 'BS', 'BB', 'BZ', 'CA', 'CR', 'CU', 'DM', 'DO', 'SV', 'GD', 'GT', 'HT',
    'HN', 'JM', 'MX', 'NI', 'PA', 'KN', 'LC', 'VC', 'TT', 'US',
  ],
  'South America': [
    'AR', 'BO', 'BR', 'CL', 'CO', 'EC', 'GY', 'PY', 'PE', 'SR', 'UY', 'VE',
  ],
  Oceania: [
    'AU', 'FJ', 'KI', 'MH', 'FM', 'NR', 'NZ', 'PW', 'PG', 'WS', 'SB', 'TO', 'TV', 'VU',
  ],
};

/** Curated relaxing / popular mood tags for discovery. */
export const MOOD_TAGS = [
  { id: 'jazz', label: 'Jazz', emoji: '🎷' },
  { id: 'classical', label: 'Classical', emoji: '🎻' },
  { id: 'ambient', label: 'Ambient', emoji: '🌙' },
  { id: 'chillout', label: 'Chillout', emoji: '🍃' },
  { id: 'lounge', label: 'Lounge', emoji: '🍸' },
  { id: 'relax', label: 'Relax', emoji: '☁️' },
  { id: 'meditation', label: 'Meditation', emoji: '🕊' },
  { id: 'nature', label: 'Nature', emoji: '🌲' },
  { id: 'piano', label: 'Piano', emoji: '🎹' },
  { id: 'smooth jazz', label: 'Smooth Jazz', emoji: '✨' },
  { id: 'easy listening', label: 'Easy Listening', emoji: '☕' },
  { id: 'new age', label: 'New Age', emoji: '🌊' },
  { id: 'lo-fi', label: 'Lo-Fi', emoji: '🎧' },
  { id: 'soul', label: 'Soul', emoji: '💜' },
  { id: 'blues', label: 'Blues', emoji: '🎸' },
  { id: 'folk', label: 'Folk', emoji: '🪕' },
  { id: 'country', label: 'Country', emoji: '🤠' },
  { id: 'latin', label: 'Latin', emoji: '💃' },
  { id: 'world music', label: 'World', emoji: '🌍' },
  { id: 'news', label: 'News', emoji: '📰' },
  { id: 'talk', label: 'Talk', emoji: '🎙' },
  { id: 'sports', label: 'Sports', emoji: '⚽' },
  { id: 'pop', label: 'Pop', emoji: '💫' },
  { id: 'rock', label: 'Rock', emoji: '🤘' },
  { id: 'metal', label: 'Metal', emoji: '⚡' },
  { id: 'indie', label: 'Indie', emoji: '🎸' },
  { id: 'electronic', label: 'Electronic', emoji: '🎹' },
  { id: 'dance', label: 'Dance', emoji: '🪩' },
  { id: 'hip hop', label: 'Hip Hop', emoji: '🎤' },
  { id: 'reggae', label: 'Reggae', emoji: '🌴' },
  { id: '80s', label: '80s', emoji: '🕺' },
  { id: 'soundtrack', label: 'Soundtrack', emoji: '🎬' },
];

/** Time-of-day periods for the Discover "Right now" strip */
export const TIME_OF_DAY_PERIODS: {
  id: TimeOfDayPeriod;
  label: string;
  emoji: string;
}[] = [
  { id: 'morning', label: 'Morning', emoji: '🌅' },
  { id: 'day', label: 'Day', emoji: '☀️' },
  { id: 'evening', label: 'Evening', emoji: '🌇' },
  { id: 'night', label: 'Night', emoji: '🌙' },
];

const TIME_OF_DAY_MOODS: Record<
  TimeOfDayPeriod,
  { id: string; label: string; emoji: string }[]
> = {
  morning: [
    { id: 'news', label: 'Morning news', emoji: '📰' },
    { id: 'classical', label: 'Classical', emoji: '🎻' },
    { id: 'jazz', label: 'Jazz', emoji: '🎷' },
    { id: 'easy listening', label: 'Easy', emoji: '☕' },
  ],
  day: [
    { id: 'pop', label: 'Pop', emoji: '💫' },
    { id: 'chillout', label: 'Chillout', emoji: '🍃' },
    { id: 'world music', label: 'World', emoji: '🌍' },
    { id: 'soul', label: 'Soul', emoji: '💜' },
  ],
  evening: [
    { id: 'jazz', label: 'Evening jazz', emoji: '🎷' },
    { id: 'lounge', label: 'Lounge', emoji: '🍸' },
    { id: 'smooth jazz', label: 'Smooth', emoji: '✨' },
    { id: 'blues', label: 'Blues', emoji: '🎸' },
  ],
  night: [
    { id: 'ambient', label: 'Late ambient', emoji: '🌙' },
    { id: 'meditation', label: 'Meditation', emoji: '🕊' },
    { id: 'classical', label: 'Classical', emoji: '🎻' },
    { id: 'nature', label: 'Nature', emoji: '🌲' },
  ],
};

/** Resolve period from local clock (5–11 morning, 11–17 day, 17–22 evening, else night). */
export function currentTimeOfDayPeriod(date = new Date()): TimeOfDayPeriod {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'day';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

export function resolveTimeOfDayPeriod(mode: TimeOfDayMode): TimeOfDayPeriod {
  return mode === 'auto' ? currentTimeOfDayPeriod() : mode;
}

export function timeOfDayPeriodLabel(period: TimeOfDayPeriod): string {
  return TIME_OF_DAY_PERIODS.find((p) => p.id === period)?.label ?? period;
}

/** Time-of-day curated chip sets. Pass a period, or omit to use the clock. */
export function timeOfDayMoods(
  period?: TimeOfDayPeriod
): { id: string; label: string; emoji: string }[] {
  const p = period ?? currentTimeOfDayPeriod();
  return TIME_OF_DAY_MOODS[p];
}
