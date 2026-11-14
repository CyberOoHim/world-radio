import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import {
  CULTURAL_SEED_TAGS,
  REGIONAL_SEED_COUNTRY_GROUPS,
} from '../src/server/geoTaxonomy.ts';
import {
  SEED_EMBEDDING_DIM,
  SEED_SWEET_SPOT_COUNT,
  buildStationDescriptor,
  decodeBase64ToUnitVector,
  quantizeUnitVectorToBase64,
  type SeedIndexFile,
  type SeedStationItem,
} from '../src/server/seedIndex.ts';
import type { Station } from '../src/types.ts';

const MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://all.api.radio-browser.info',
];

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      const k = trimmed.slice(0, idx).trim();
      const v = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      if (!(k in process.env)) process.env[k] = v;
    }
  }
}

async function fetchJson(pathUrl: string): Promise<unknown> {
  for (const mirror of MIRRORS) {
    try {
      const res = await fetch(`${mirror}${pathUrl}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'World-Radio-Seeder/1.0' },
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) return await res.json();
    } catch {
      // retry next mirror
    }
  }
  return [];
}

function cleanStation(raw: unknown): Station | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.stationuuid !== 'string' || !s.stationuuid) return null;
  const name = typeof s.name === 'string' ? s.name.trim() : '';
  const url_resolved = typeof s.url_resolved === 'string' ? s.url_resolved.trim() : '';
  const url = typeof s.url === 'string' ? s.url.trim() : '';
  const stream = url_resolved || url;
  if (!name || !/^https?:\/\//i.test(stream)) return null;
  if (s.lastcheckok === 0) return null;

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
    votes: typeof s.votes === 'number' ? s.votes : 0,
    codec: typeof s.codec === 'string' ? s.codec : '',
    bitrate: typeof s.bitrate === 'number' ? s.bitrate : 0,
    lastcheckok: typeof s.lastcheckok === 'number' ? s.lastcheckok : 1,
    clickcount: typeof s.clickcount === 'number' ? s.clickcount : 0,
    clicktrend: typeof s.clicktrend === 'number' ? s.clicktrend : 0,
    geo_lat: typeof s.geo_lat === 'number' ? s.geo_lat : null,
    geo_long: typeof s.geo_long === 'number' ? s.geo_long : null,
  };
}

async function gatherDiverseStations(targetCount: number): Promise<Station[]> {
  const pool = new Map<string, Station>();

  const addRows = (rows: unknown, maxAdd?: number): number => {
    if (!Array.isArray(rows)) return 0;
    let added = 0;
    for (const r of rows) {
      const st = cleanStation(r);
      if (st && !pool.has(st.stationuuid)) {
        pool.set(st.stationuuid, st);
        added++;
        if (maxAdd && added >= maxAdd) break;
        if (pool.size >= targetCount) break;
      }
    }
    return added;
  };

  // 1. Stratified regional quotas across every continent (HTTPS-first, then general playable)
  for (const group of REGIONAL_SEED_COUNTRY_GROUPS) {
    if (pool.size >= targetCount) break;
    console.log(`Sampling region: ${group.region} (${group.countries.length} countries)...`);
    const CONCURRENCY = 6;
    for (let i = 0; i < group.countries.length; i += CONCURRENCY) {
      if (pool.size >= targetCount) break;
      const slice = group.countries.slice(i, i + CONCURRENCY);
      await Promise.all(
        slice.map(async (cc) => {
          const httpsRows = await fetchJson(
            `/json/stations/search?hidebroken=true&is_https=true&order=clickcount&reverse=true&limit=${group.perCountryLimit}&countrycode=${cc}`
          );
          const addedHttps = addRows(httpsRows, group.perCountryLimit);
          if (addedHttps < Math.min(8, group.perCountryLimit)) {
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
    if (pool.size >= targetCount) break;
    const rows = await fetchJson(
      `/json/stations/search?hidebroken=true&is_https=true&order=votes&reverse=true&limit=60&tag=${encodeURIComponent(tag)}`
    );
    addRows(rows, 60);
  }

  // 3. Top global popular stations to fill remaining capacity up to targetCount
  for (const offset of [0, 400, 800, 1200, 1600]) {
    if (pool.size >= targetCount) break;
    const rows = await fetchJson(
      `/json/stations/search?hidebroken=true&is_https=true&order=clickcount&reverse=true&limit=400&offset=${offset}`
    );
    addRows(rows);
  }

  return [...pool.values()].slice(0, targetCount);
}

async function main(): Promise<void> {
  loadEnvLocal();
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  const outDir = path.resolve(process.cwd(), 'data');
  const outPath = path.join(outDir, 'station-seed-index.json');
  const forceRefresh = process.argv.includes('--refresh');
  const forceReembed = process.argv.includes('--reembed');

  const previousVectors = new Map<string, string>();
  let existingItems: SeedStationItem[] = [];
  if (fs.existsSync(outPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(outPath, 'utf8')) as Partial<SeedIndexFile>;
      if (Array.isArray(existing.items) && existing.items.length > 0) {
        existingItems = existing.items.filter((i): i is SeedStationItem => Boolean(i?.station?.stationuuid));
        for (const it of existingItems) {
          if (typeof it.vec === 'string' && decodeBase64ToUnitVector(it.vec, SEED_EMBEDDING_DIM)) {
            previousVectors.set(it.station.stationuuid, it.vec);
          }
        }
        if (!forceRefresh) {
          console.log(`Loaded ${existingItems.length} existing stations from ${outPath}`);
        }
      }
    } catch {
      existingItems = [];
    }
  }

  let items: SeedStationItem[] = forceRefresh ? [] : existingItems;

  if (items.length === 0) {
    console.log(`Gathering up to ${SEED_SWEET_SPOT_COUNT} geographically balanced stations from Radio Browser...`);
    const stations = await gatherDiverseStations(SEED_SWEET_SPOT_COUNT);
    if (stations.length === 0 && existingItems.length > 0) {
      console.warn('Radio Browser returned 0 stations; keeping existing seed catalog.');
      items = existingItems;
    } else {
      console.log(`Collected ${stations.length} playable stations.`);
      items = stations.map((station) => {
        const prevVec = !forceReembed ? previousVectors.get(station.stationuuid) : undefined;
        return prevVec ? { station, vec: prevVec } : { station };
      });
    }
  } else if (forceReembed) {
    items = items.map((item) => ({ station: item.station }));
  }

  const missing = items.filter(
    (item) => typeof item.vec !== 'string' || !decodeBase64ToUnitVector(item.vec, SEED_EMBEDDING_DIM)
  );
  if (missing.length === 0) {
    console.log(`All ${items.length} stations already have pre-computed vectors.`);
  } else if (apiKey) {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
    const BATCH = 50;
    const CONCURRENCY = 4;
    const batches: SeedStationItem[][] = [];
    for (let i = 0; i < missing.length; i += BATCH) {
      batches.push(missing.slice(i, i + BATCH));
    }
    let completed = 0;
    for (let i = 0; i < batches.length; i += CONCURRENCY) {
      const wave = batches.slice(i, i + CONCURRENCY);
      await Promise.all(
        wave.map(async (slice) => {
          const texts = slice.map((item) => buildStationDescriptor(item.station));
          const res = await ai.models.embedContent({
            model: 'gemini-embedding-2',
            contents: texts,
            config: { outputDimensionality: SEED_EMBEDDING_DIM },
          });
          const embeddings = res.embeddings ?? [];
          slice.forEach((item, idx) => {
            const vals = embeddings[idx]?.values;
            if (vals && vals.length === SEED_EMBEDDING_DIM) {
              item.vec = quantizeUnitVectorToBase64(vals);
            }
          });
          completed += slice.length;
        })
      );
      console.log(`Embedded ${Math.min(completed, missing.length)} / ${missing.length}`);
    }
  } else {
    console.warn('GEMINI_API_KEY not set — writing station metadata (preserving existing vectors, missing new vectors will warm on server).');
  }

  fs.mkdirSync(outDir, { recursive: true });
  const payload: SeedIndexFile = {
    version: 1,
    model: 'gemini-embedding-2',
    dim: SEED_EMBEDDING_DIM,
    generatedAt: new Date().toISOString(),
    items,
  };
  fs.writeFileSync(outPath, JSON.stringify(payload));
  const sizeMb = (fs.statSync(outPath).size / (1024 * 1024)).toFixed(2);
  const vecCount = items.filter((i) => typeof i.vec === 'string' && i.vec.length > 0).length;
  console.log(`Saved seed index (${items.length} stations, ${vecCount} vectors, ${sizeMb} MB) to ${outPath}`);
}

void main();
