import type { Country, Language, Station, Tag } from '../types';

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
  geo_lat?: number;
  geo_long?: number;
}

function toQuery(params: SearchParams): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    q.set(k, String(v));
  }
  return q.toString();
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
  return apiFetch<Station[]>(`/json/stations/search?${toQuery(defaults)}`);
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
  return apiFetch<Station[]>(`/json/stations/byuuid/${encodeURIComponent(uuid)}`);
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
      const list = await apiFetch<Station[]>(path);
      if (Array.isArray(list) && list.length) {
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

export async function getRandomStations(
  limit = 1,
  extra: SearchParams = {}
): Promise<Station[]> {
  return searchStations({
    limit,
    offset: 0,
    order: 'random',
    reverse: false,
    hidebroken: true,
    ...extra,
  });
}

export async function getStationsNear(
  lat: number,
  lon: number,
  limit = 48,
  offset = 0,
  extra: SearchParams = {}
): Promise<Station[]> {
  // Radio Browser supports geo search via search with geo_lat/geo_long and order=distance on some mirrors
  return searchStations({
    geo_lat: lat,
    geo_long: lon,
    order: 'distance',
    reverse: false,
    limit,
    offset,
    hidebroken: true,
    ...extra,
  });
}

export async function getCountries(): Promise<Country[]> {
  const list = await apiFetch<Country[]>(
    '/json/countries?order=stationcount&reverse=true&hidebroken=true'
  );
  return list.filter((c) => c.stationcount > 0 && c.iso_3166_1);
}

export async function getTags(limit = 120): Promise<Tag[]> {
  const list = await apiFetch<Tag[]>(
    `/json/tags?order=stationcount&reverse=true&hidebroken=true&limit=${limit}`
  );
  return list.filter((t) => t.stationcount > 0 && t.name.trim().length > 0);
}

export async function getLanguages(limit = 80): Promise<Language[]> {
  try {
    const list = await apiFetch<Language[]>(
      `/json/languages?order=stationcount&reverse=true&hidebroken=true&limit=${limit}`
    );
    return list.filter((l) => l.stationcount > 0 && l.name.trim().length > 0);
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
  { id: 'soul', label: 'Soul', emoji: '💜' },
  { id: 'blues', label: 'Blues', emoji: '🎸' },
  { id: 'folk', label: 'Folk', emoji: '🪕' },
  { id: 'world music', label: 'World', emoji: '🌍' },
  { id: 'news', label: 'News', emoji: '📰' },
  { id: 'talk', label: 'Talk', emoji: '🎙' },
  { id: 'pop', label: 'Pop', emoji: '💫' },
  { id: 'rock', label: 'Rock', emoji: '🤘' },
  { id: 'electronic', label: 'Electronic', emoji: '⚡' },
  { id: 'dance', label: 'Dance', emoji: '🪩' },
  { id: 'hip hop', label: 'Hip Hop', emoji: '🎤' },
  { id: 'reggae', label: 'Reggae', emoji: '🌴' },
];

/** Time-of-day curated chip sets */
export function timeOfDayMoods(): { id: string; label: string; emoji: string }[] {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 11) {
    return [
      { id: 'news', label: 'Morning news', emoji: '📰' },
      { id: 'classical', label: 'Classical', emoji: '🎻' },
      { id: 'jazz', label: 'Jazz', emoji: '🎷' },
      { id: 'easy listening', label: 'Easy', emoji: '☕' },
    ];
  }
  if (hour >= 11 && hour < 17) {
    return [
      { id: 'pop', label: 'Pop', emoji: '💫' },
      { id: 'chillout', label: 'Chillout', emoji: '🍃' },
      { id: 'world music', label: 'World', emoji: '🌍' },
      { id: 'soul', label: 'Soul', emoji: '💜' },
    ];
  }
  if (hour >= 17 && hour < 22) {
    return [
      { id: 'jazz', label: 'Evening jazz', emoji: '🎷' },
      { id: 'lounge', label: 'Lounge', emoji: '🍸' },
      { id: 'smooth jazz', label: 'Smooth', emoji: '✨' },
      { id: 'blues', label: 'Blues', emoji: '🎸' },
    ];
  }
  return [
    { id: 'ambient', label: 'Late ambient', emoji: '🌙' },
    { id: 'meditation', label: 'Meditation', emoji: '🕊' },
    { id: 'classical', label: 'Classical', emoji: '🎻' },
    { id: 'nature', label: 'Nature', emoji: '🌲' },
  ];
}
