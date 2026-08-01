import type { Country, Station, Tag } from '../types';

const MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
  'https://fr1.api.radio-browser.info',
];

let baseUrl = MIRRORS[0];
let baseReady: Promise<void> | null = null;

async function pickMirror(): Promise<void> {
  if (baseReady) return baseReady;
  baseReady = (async () => {
    for (const mirror of MIRRORS) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch(`${mirror}/json/stats`, { signal: ctrl.signal });
        clearTimeout(t);
        if (res.ok) {
          baseUrl = mirror;
          return;
        }
      } catch {
        // try next mirror
      }
    }
    baseUrl = MIRRORS[0];
  })();
  return baseReady;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  await pickMirror();
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Radio API error ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
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

export async function getTopStations(limit = 48, offset = 0): Promise<Station[]> {
  return searchStations({ limit, offset, order: 'clickcount', reverse: true });
}

export async function getStationsByCountry(
  countrycode: string,
  limit = 48,
  offset = 0
): Promise<Station[]> {
  return searchStations({ countrycode, limit, offset });
}

export async function getStationsByTag(
  tag: string,
  limit = 48,
  offset = 0
): Promise<Station[]> {
  return searchStations({ tag, limit, offset });
}

export async function getStationsByUuid(uuid: string): Promise<Station[]> {
  return apiFetch<Station[]>(`/json/stations/byuuid/${uuid}`);
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

/** Resolve a playable stream URL and register a click (improves ranking). */
export async function resolveStream(stationuuid: string): Promise<string | null> {
  try {
    const data = await apiFetch<{ url?: string; name?: string } | Array<{ url?: string }>>(
      `/json/url/${stationuuid}`
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
