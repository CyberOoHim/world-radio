import {
  CULTURAL_SEED_TAGS,
  REGIONAL_SEED_COUNTRY_GROUPS,
} from './geoTaxonomy.ts';
import type { Station } from '../types.ts';

const DEFAULT_MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://all.api.radio-browser.info',
];

export interface ScaledSamplingPlan {
  targetCount: number;
  scaleFactor: number;
  regionalGroups: Array<{
    region: string;
    perCountryLimit: number;
    countries: string[];
  }>;
  culturalTagLimit: number;
  globalPageLimit: number;
  globalOffsets: number[];
}

export function computeScaledSamplingPlan(targetCount: number): ScaledSamplingPlan {
  const safeTarget = Math.max(100, Math.round(targetCount));
  const scaleFactor = Math.max(1, safeTarget / 4500);
  const regionalGroups = REGIONAL_SEED_COUNTRY_GROUPS.map((group) => ({
    region: group.region,
    perCountryLimit: Math.min(200, Math.max(15, Math.ceil(group.perCountryLimit * scaleFactor))),
    countries: group.countries,
  }));
  const culturalTagLimit = Math.min(200, Math.max(40, Math.ceil(60 * scaleFactor)));
  const globalPageLimit = 400;
  const pageCount = Math.max(5, Math.ceil(safeTarget / 450));
  const globalOffsets = Array.from({ length: pageCount }, (_, i) => i * globalPageLimit);

  return {
    targetCount: safeTarget,
    scaleFactor,
    regionalGroups,
    culturalTagLimit,
    globalPageLimit,
    globalOffsets,
  };
}

export function cleanPlayableStation(raw: unknown): Station | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.stationuuid !== 'string' || !s.stationuuid) return null;
  const name = typeof s.name === 'string' ? s.name.trim() : '';
  const url_resolved = typeof s.url_resolved === 'string' ? s.url_resolved.trim() : '';
  const url = typeof s.url === 'string' ? s.url.trim() : '';
  const stream = url_resolved || url;
  if (!name || !/^https?:\/\//i.test(stream)) return null;
  if (s.lastcheckok === 0) return null;

  const toNum = (v: unknown, def = 0): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : def;
  const toCoord = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };

  return {
    changeuuid: typeof s.changeuuid === 'string' ? s.changeuuid : '',
    stationuuid: s.stationuuid,
    name,
    url,
    url_resolved: url_resolved || url,
    homepage: typeof s.homepage === 'string' ? s.homepage : '',
    favicon: typeof s.favicon === 'string' ? s.favicon : '',
    tags: typeof s.tags === 'string' ? s.tags : '',
    country: typeof s.country === 'string' ? s.country : '',
    countrycode: typeof s.countrycode === 'string' ? s.countrycode : '',
    state: typeof s.state === 'string' ? s.state : '',
    language: typeof s.language === 'string' ? s.language : '',
    languagecodes: typeof s.languagecodes === 'string' ? s.languagecodes : '',
    votes: toNum(s.votes),
    codec: typeof s.codec === 'string' ? s.codec : '',
    bitrate: toNum(s.bitrate),
    lastcheckok: toNum(s.lastcheckok, 1),
    clickcount: toNum(s.clickcount),
    clicktrend: toNum(s.clicktrend),
    geo_lat: toCoord(s.geo_lat),
    geo_long: toCoord(s.geo_long),
  };
}

export async function fetchRadioBrowserJson(pathUrl: string, timeoutMs = 20000): Promise<unknown> {
  for (const mirror of DEFAULT_MIRRORS) {
    try {
      const res = await fetch(`${mirror}${pathUrl}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'World-Radio-Seeder/1.0' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return await res.json();
    } catch {
      // retry next mirror
    }
  }
  return [];
}

/**
 * Sample a geographically balanced pool of playable stations up to `targetCount`.
 * When `existingStations` is provided, preserves them and gathers only the delta
 * needed to reach `targetCount`.
 */
export async function gatherDiverseStations(
  targetCount: number,
  opts: {
    existingStations?: Station[];
    fetchJsonFn?: (pathUrl: string) => Promise<unknown>;
    onLog?: (message: string) => void;
  } = {}
): Promise<Station[]> {
  const safeTarget = Math.max(1, Math.round(targetCount));
  const pool = new Map<string, Station>();
  for (const st of opts.existingStations ?? []) {
    if (st?.stationuuid && !pool.has(st.stationuuid)) {
      pool.set(st.stationuuid, st);
      if (pool.size >= safeTarget) break;
    }
  }

  if (pool.size >= safeTarget) {
    return [...pool.values()].slice(0, safeTarget);
  }

  const fetchJson = opts.fetchJsonFn ?? fetchRadioBrowserJson;
  const plan = computeScaledSamplingPlan(safeTarget);

  const addRows = (rows: unknown, maxAdd?: number): number => {
    if (!Array.isArray(rows)) return 0;
    let added = 0;
    for (const r of rows) {
      if (pool.size >= safeTarget) break;
      const st = cleanPlayableStation(r);
      if (st && !pool.has(st.stationuuid)) {
        pool.set(st.stationuuid, st);
        added++;
        if (maxAdd && added >= maxAdd) break;
      }
    }
    return added;
  };

  // 1. Stratified regional quotas across every continent (HTTPS-first, then general playable)
  for (const group of plan.regionalGroups) {
    if (pool.size >= safeTarget) break;
    opts.onLog?.(`Sampling region: ${group.region} (${group.countries.length} countries, limit ${group.perCountryLimit})...`);
    const CONCURRENCY = 6;
    for (let i = 0; i < group.countries.length; i += CONCURRENCY) {
      if (pool.size >= safeTarget) break;
      const slice = group.countries.slice(i, i + CONCURRENCY);
      await Promise.all(
        slice.map(async (cc) => {
          if (pool.size >= safeTarget) return;
          const httpsRows = await fetchJson(
            `/json/stations/search?hidebroken=true&is_https=true&order=clickcount&reverse=true&limit=${group.perCountryLimit}&countrycode=${cc}`
          );
          const addedHttps = addRows(httpsRows, group.perCountryLimit);
          if (pool.size < safeTarget && addedHttps < Math.min(8, group.perCountryLimit)) {
            const anyRows = await fetchJson(
              `/json/stations/search?hidebroken=true&order=clickcount&reverse=true&limit=${group.perCountryLimit}&countrycode=${cc}`
            );
            addRows(anyRows, group.perCountryLimit - addedHttps);
          }
        })
      );
    }
  }

  // 2. Stratified cultural & genre sampling for sonic & regional music breadth
  for (const tag of CULTURAL_SEED_TAGS) {
    if (pool.size >= safeTarget) break;
    const rows = await fetchJson(
      `/json/stations/search?hidebroken=true&is_https=true&order=votes&reverse=true&limit=${plan.culturalTagLimit}&tag=${encodeURIComponent(tag)}`
    );
    addRows(rows, plan.culturalTagLimit);
  }

  // 3. Top global popular stations to fill remaining capacity up to targetCount
  for (const offset of plan.globalOffsets) {
    if (pool.size >= safeTarget) break;
    const rows = await fetchJson(
      `/json/stations/search?hidebroken=true&is_https=true&order=clickcount&reverse=true&limit=${plan.globalPageLimit}&offset=${offset}`
    );
    addRows(rows);
  }

  return [...pool.values()].slice(0, safeTarget);
}
