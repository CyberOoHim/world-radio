import type { IncomingMessage, ServerResponse } from 'node:http';
import crypto from 'node:crypto';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { validateAiRequestAuth, validateRequestAuth } from './auth.ts';
import {
  SEED_EMBEDDING_DIM,
  buildStationDescriptor,
  cosineUnitSimilarity,
  normalizeVector,
  seedIndexStore,
} from './seedIndex.ts';
import type { AiModelId, AiSearchResponse, AiThinkingLevel, Station } from '../types.ts';

import dns from 'node:dns/promises';

export const DEFAULT_AI_MODEL: AiModelId = 'gemini-flash-lite-latest';
const EMBEDDING_MODEL = 'gemini-embedding-2';

const DEFAULT_RADIO_MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://all.api.radio-browser.info',
];

let resolvedMirrorsCache: { expiresAt: number; mirrors: string[] } | null = null;
async function getActiveMirrors(): Promise<string[]> {
  if (resolvedMirrorsCache && resolvedMirrorsCache.expiresAt > Date.now()) {
    return resolvedMirrorsCache.mirrors;
  }
  const set = new Set<string>();
  try {
    const srv = await Promise.race([
      dns.resolveSrv('_api._tcp.radio-browser.info'),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('srv timeout')), 2000)),
    ]);
    for (const entry of srv) {
      if (entry.name) set.add(`https://${entry.name}`);
    }
  } catch {
    // ignore SRV failure
  }
  for (const m of DEFAULT_RADIO_MIRRORS) set.add(m);
  const mirrors = [...set];
  resolvedMirrorsCache = { expiresAt: Date.now() + 10 * 60 * 1000, mirrors };
  return mirrors;
}

const LIVE_LRU_MAX = 2500;
const RESPONSE_CACHE_MAX = 100;
const RESPONSE_CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedVectorEntry {
  signature: string;
  vector: Float32Array;
}

interface CachedResponseEntry {
  expiresAt: number;
  data: AiSearchResponse;
}

interface CachedDjNotesEntry {
  expiresAt: number;
  djNotes: Record<string, string>;
}

class LruCache<K, V> {
  private map = new Map<K, V>();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const val = this.map.get(key);
    if (val !== undefined) {
      this.map.delete(key);
      this.map.set(key, val);
    }
    return val;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }
    this.map.set(key, value);
  }
}

const liveVectorCache = new LruCache<string, CachedVectorEntry>(LIVE_LRU_MAX);
const responseCache = new LruCache<string, CachedResponseEntry>(RESPONSE_CACHE_MAX);
const djNotesCache = new LruCache<string, CachedDjNotesEntry>(RESPONSE_CACHE_MAX);
let seedWarmStarted = false;
let seedHydratePromise: Promise<void> | null = null;

async function hydrateMissingSeedVectors(ai: GoogleGenAI): Promise<void> {
  if (seedHydratePromise) return seedHydratePromise;
  const missing = seedIndexStore.getMissingVectorStations();
  if (missing.length === 0) return;

  seedHydratePromise = (async () => {
    const BATCH = 64;
    const CONCURRENCY = 3;
    const batches: Station[][] = [];
    for (let i = 0; i < missing.length; i += BATCH) {
      batches.push(missing.slice(i, i + BATCH));
    }
    for (let i = 0; i < batches.length; i += CONCURRENCY) {
      const wave = batches.slice(i, i + CONCURRENCY);
      await Promise.all(
        wave.map(async (slice) => {
          const vecs = await embedTexts(
            ai,
            slice.map((st) => buildStationDescriptor(st))
          );
          slice.forEach((st, idx) => {
            const vec = vecs[idx];
            if (vec && vec.length > 0) {
              seedIndexStore.setVector(st.stationuuid, vec);
            }
          });
        })
      );
      if (i + CONCURRENCY < batches.length) {
        await new Promise((r) => setTimeout(r, 60));
      }
    }
  })().finally(() => {
    seedHydratePromise = null;
  });

  return seedHydratePromise;
}

function warmSeedIndexInBackground(ai: GoogleGenAI): void {
  if (seedWarmStarted) return;
  const missing = seedIndexStore.getMissingVectorStations();
  if (missing.length === 0) {
    seedWarmStarted = true;
    return;
  }
  seedWarmStarted = true;

  void hydrateMissingSeedVectors(ai).catch(() => {
    // Stop background warming on transient/quota failure; user searches still embed on demand
  });
}

function cleanEnvSecret(raw: string | undefined): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function resolveGeminiApiKey(): string {
  const candidates = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.API_KEY,
    process.env.GOOGLE_GEMINI_API_KEY,
    process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  ];
  for (const candidate of candidates) {
    const cleaned = cleanEnvSecret(candidate);
    if (cleaned) return cleaned;
  }
  return '';
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = resolveGeminiApiKey();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function normalizeAiModel(raw: unknown): AiModelId {
  if (raw === 'gemini-flash-lite-latest' || raw === 'gemini-4-hydrogen') {
    return raw;
  }
  return DEFAULT_AI_MODEL;
}

export function normalizeThinkingLevel(raw: unknown): AiThinkingLevel {
  if (raw === 'low' || raw === 'medium' || raw === 'high') {
    return raw;
  }
  return 'medium';
}

function toGenAiThinkingLevel(level: AiThinkingLevel): ThinkingLevel {
  switch (level) {
    case 'low':
      return ThinkingLevel.LOW;
    case 'high':
      return ThinkingLevel.HIGH;
    case 'medium':
    default:
      return ThinkingLevel.MEDIUM;
  }
}

export function getPlannerConfig(model: unknown, level: unknown): {
  model: AiModelId;
  thinkingLevel: ThinkingLevel;
} {
  return {
    model: normalizeAiModel(model),
    thinkingLevel: toGenAiThinkingLevel(normalizeThinkingLevel(level)),
  };
}

export function getDjNotesConfig(model: unknown, level: unknown): {
  model: AiModelId;
  thinkingLevel: ThinkingLevel;
} {
  return {
    model: normalizeAiModel(model),
    thinkingLevel: toGenAiThinkingLevel(normalizeThinkingLevel(level)),
  };
}

function parseJsonBody<T>(req: IncomingMessage): Promise<T | null> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 128 * 1024) {
        req.destroy();
        resolve(null);
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? (JSON.parse(data) as T) : null);
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function hashDescriptor(text: string): string {
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 12);
}

function sanitizeServerStation(raw: unknown): Station | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.stationuuid !== 'string' || !s.stationuuid) return null;
  const url = typeof s.url === 'string' ? s.url : '';
  const url_resolved = typeof s.url_resolved === 'string' ? s.url_resolved : url;
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
    name: typeof s.name === 'string' ? s.name : '',
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

function isPlayableStation(station: Station, httpsOnly: boolean): boolean {
  const url = (station.url_resolved || station.url || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) return false;
  if (httpsOnly && !/^https:\/\//i.test(url)) return false;
  if (station.lastcheckok === 0) return false;
  return Boolean(station.stationuuid && station.name.trim());
}

interface FilterPlan {
  tag?: string;
  countrycode?: string;
  language?: string;
  name?: string;
}

interface QueryPlanResult {
  headline: string;
  intro: string;
  semanticProfile: string;
  planTags: string[];
  plans: FilterPlan[];
}

let popularFallbackCache: { expiresAt: number; stations: Station[] } | null = null;

async function fetchRadioBrowserPath(
  pathUrl: string,
  httpsOnly: boolean,
  timeoutMs = 3500
): Promise<Station[]> {
  const mirrors = await getActiveMirrors();
  for (const mirror of mirrors.slice(0, 3)) {
    try {
      const res = await fetch(`${mirror}${pathUrl}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'World-Radio-AI/1.0' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) continue;
      const raw = (await res.json()) as unknown;
      if (!Array.isArray(raw)) continue;
      const out: Station[] = [];
      for (const item of raw) {
        const st = sanitizeServerStation(item);
        if (st && isPlayableStation(st, httpsOnly)) {
          out.push(st);
        }
      }
      // Valid HTTP 200 JSON array from Radio Browser mirror is authoritative; do not retry mirrors on []
      return out;
    } catch {
      // try next mirror on network/timeout/non-200 failure
    }
  }
  return [];
}

function buildPlanQueryPath(plan: FilterPlan, httpsOnly: boolean, limit: number): string {
  const q = new URLSearchParams();
  q.set('hidebroken', 'true');
  q.set('order', 'clickcount');
  q.set('reverse', 'true');
  q.set('limit', String(limit));
  if (httpsOnly) q.set('is_https', 'true');
  if (plan.tag) q.set('tag', plan.tag.trim().toLowerCase());
  if (plan.countrycode && plan.countrycode.trim().length === 2) {
    q.set('countrycode', plan.countrycode.trim().toUpperCase());
  }
  if (plan.language) q.set('language', plan.language.trim().toLowerCase());
  if (plan.name) q.set('name', plan.name.trim());
  return `/json/stations/search?${q.toString()}`;
}

function buildRelaxedPlans(plans: FilterPlan[]): FilterPlan[] {
  const seen = new Set<string>();
  const out: FilterPlan[] = [];
  const pushPlan = (p: FilterPlan) => {
    const key = `${p.tag || ''}|${p.countrycode || ''}|${p.language || ''}|${p.name || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(p);
  };

  for (const plan of plans) {
    if (plan.tag && (plan.countrycode || plan.language || plan.name)) {
      if (plan.countrycode) pushPlan({ tag: plan.tag, countrycode: plan.countrycode });
      pushPlan({ tag: plan.tag });
    }
    if (plan.tag && plan.tag.includes(' ')) {
      const firstToken = plan.tag
        .split(/\s+/)
        .map((t) => t.trim())
        .find((t) => t.length >= 3);
      if (firstToken) pushPlan({ tag: firstToken });
    }
    if (!plan.tag && plan.countrycode && (plan.language || plan.name)) {
      pushPlan({ countrycode: plan.countrycode });
    }
  }
  return out.slice(0, 4);
}

async function fetchRadioBrowserPlan(
  plan: FilterPlan,
  httpsOnly: boolean,
  limit = 16
): Promise<Station[]> {
  return fetchRadioBrowserPath(buildPlanQueryPath(plan, httpsOnly, limit), httpsOnly, 3500);
}

async function fetchPopularFallbackStations(httpsOnly: boolean): Promise<Station[]> {
  if (popularFallbackCache && popularFallbackCache.expiresAt > Date.now()) {
    return popularFallbackCache.stations.filter((st) => isPlayableStation(st, httpsOnly));
  }
  const q = new URLSearchParams({
    hidebroken: 'true',
    order: 'clickcount',
    reverse: 'true',
    limit: '60',
  });
  if (httpsOnly) q.set('is_https', 'true');
  const list = await fetchRadioBrowserPath(`/json/stations/search?${q.toString()}`, httpsOnly, 3500);
  if (list.length > 0) {
    popularFallbackCache = { expiresAt: Date.now() + 10 * 60 * 1000, stations: list };
  }
  return list;
}

function stripJsonFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

async function planSearchWithLlm(
  ai: GoogleGenAI,
  model: AiModelId,
  thinkingLevel: AiThinkingLevel,
  opts: { mode: 'search'; query: string } | { mode: 'similar'; station: Station }
): Promise<QueryPlanResult> {
  const systemInstruction =
    'You are an expert global radio curator for World Radio. Translate a listener prompt or seed radio station into structured Radio Browser directory search filters plus a rich semantic mood profile for vector matching. Keep tags lowercase single/two-word Radio Browser genres (e.g., jazz, ambient, lo-fi, classical, chillout, bossa nova, synthwave, acoustic, world music, news, talk, soul, indie, electronic, folk, tango, dub). Keep countrycode as 2-letter ISO-3166-1 uppercase codes when geography is implied or helpful.';

  const userPrompt =
    opts.mode === 'search'
      ? `Listener prompt: "${opts.query}"\nGenerate 2 to 4 diverse Radio Browser search plans (at least one broad tag plan without country restriction for fallback coverage), a short atmospheric editorial headline (3-6 words), a 1-sentence host intro, and a rich semanticProfile describing the sonic texture, tempo, mood, era, and geography.`
      : `Seed radio station:\n${buildStationDescriptor(opts.station)}\nGenerate 2 to 4 Radio Browser search plans to discover spiritual and sonic cousins from around the world (include both same/adjacent genres and regional/cultural echoes), an editorial headline like "Echoes of ${opts.station.name.slice(0, 28)}", a 1-sentence host intro, and a rich semanticProfile capturing its sonic essence.`;

  const plannerCfg = getPlannerConfig(model, thinkingLevel);

  const response = await ai.models.generateContent({
    model: plannerCfg.model,
    contents: userPrompt,
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel: plannerCfg.thinkingLevel },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          headline: { type: Type.STRING },
          intro: { type: Type.STRING },
          semanticProfile: { type: Type.STRING },
          planTags: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          plans: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                tag: { type: Type.STRING },
                countrycode: { type: Type.STRING },
                language: { type: Type.STRING },
                name: { type: Type.STRING },
              },
            },
          },
        },
        required: ['headline', 'intro', 'semanticProfile', 'planTags', 'plans'],
      },
    },
  });

  const rawText = stripJsonFence(response.text || '{}');
  const parsed = JSON.parse(rawText) as Partial<QueryPlanResult>;

  const plans = Array.isArray(parsed.plans)
    ? parsed.plans
        .filter((p): p is FilterPlan => Boolean(p && typeof p === 'object'))
        .slice(0, 4)
    : [];

  return {
    headline:
      typeof parsed.headline === 'string' && parsed.headline.trim()
        ? parsed.headline.trim()
        : opts.mode === 'search'
          ? 'Curated Frequencies'
          : `Echoes of ${opts.station.name}`,
    intro:
      typeof parsed.intro === 'string' && parsed.intro.trim()
        ? parsed.intro.trim()
        : 'Live stations tuned semantically to match your listening mood.',
    semanticProfile:
      typeof parsed.semanticProfile === 'string' && parsed.semanticProfile.trim()
        ? parsed.semanticProfile.trim()
        : opts.mode === 'search'
          ? opts.query
          : buildStationDescriptor(opts.station),
    planTags: Array.isArray(parsed.planTags)
      ? parsed.planTags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).slice(0, 6)
      : [],
    plans: plans.length > 0 ? plans : [{ tag: 'jazz' }, { tag: 'ambient' }],
  };
}

async function embedTexts(ai: GoogleGenAI, texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const res = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: texts,
    config: { outputDimensionality: SEED_EMBEDDING_DIM },
  });
  const embeddings = res.embeddings ?? [];
  return texts.map((_, idx) => {
    const vals = embeddings[idx]?.values;
    if (!vals || vals.length === 0) return new Float32Array(SEED_EMBEDDING_DIM);
    return normalizeVector(vals);
  });
}

async function getOrEmbedStations(
  ai: GoogleGenAI,
  stations: Station[]
): Promise<Map<string, Float32Array>> {
  const result = new Map<string, Float32Array>();
  const missing: Array<{ station: Station; descriptor: string; sig: string }> = [];

  for (const station of stations) {
    // 1. Check bundled pre-computed seed index first (zero API call)
    const seedVec = seedIndexStore.getVector(station.stationuuid);
    if (seedVec) {
      result.set(station.stationuuid, seedVec);
      continue;
    }

    // 2. Check server RAM LRU cache
    const descriptor = buildStationDescriptor(station);
    const sig = hashDescriptor(descriptor);
    const cached = liveVectorCache.get(station.stationuuid);
    if (cached && cached.signature === sig) {
      result.set(station.stationuuid, cached.vector);
      continue;
    }

    missing.push({ station, descriptor, sig });
  }

  // 3. Batch-embed uncached live stations in parallel via gemini-embedding-2
  const BATCH_SIZE = 32;
  const slices: Array<Array<{ station: Station; descriptor: string; sig: string }>> = [];
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    slices.push(missing.slice(i, i + BATCH_SIZE));
  }
  await Promise.all(
    slices.map(async (slice) => {
      const vecs = await embedTexts(
        ai,
        slice.map((m) => m.descriptor)
      );
      slice.forEach((m, idx) => {
        const vec = vecs[idx];
        if (vec) {
          liveVectorCache.set(m.station.stationuuid, { signature: m.sig, vector: vec });
          result.set(m.station.stationuuid, vec);
        }
      });
    })
  );

  return result;
}

async function generateDjNotes(
  ai: GoogleGenAI,
  notesModel: AiModelId,
  notesThinkingLevel: AiThinkingLevel,
  contextLabel: string,
  stations: Station[]
): Promise<Record<string, string>> {
  if (stations.length === 0) return {};

  const compactList = stations.map((s) => ({
    stationuuid: s.stationuuid,
    name: s.name,
    country: s.country || s.countrycode,
    language: s.language,
    tags: s.tags,
  }));

  try {
    const notesCfg = getDjNotesConfig(notesModel, notesThinkingLevel);
    const response = await ai.models.generateContent({
      model: notesCfg.model,
      contents: `Context: ${contextLabel}\nStations:\n${JSON.stringify(compactList)}`,
      config: {
        systemInstruction:
          'You are a warm, knowledgeable late-night radio DJ for World Radio. For each station in the JSON list, write exactly ONE crisp, evocative sentence (max 18 words) explaining why this specific station fits the context. Ground every note strictly in the station\'s real name, country, language, and tags. Never invent percentages, scores, or fake live song titles.',
        thinkingConfig: { thinkingLevel: notesCfg.thinkingLevel },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              stationuuid: { type: Type.STRING },
              note: { type: Type.STRING },
            },
            required: ['stationuuid', 'note'],
          },
        },
      },
    });

    const parsed = JSON.parse(stripJsonFence(response.text || '[]')) as Array<{
      stationuuid?: string;
      note?: string;
    }>;
    const notes: Record<string, string> = {};
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item?.stationuuid && typeof item.note === 'string' && item.note.trim()) {
          notes[item.stationuuid] = item.note.trim();
        }
      }
    }
    return notes;
  } catch {
    return {};
  }
}

async function runHybridPipeline(
  ai: GoogleGenAI,
  opts:
    | {
        mode: 'search';
        query: string;
        model: AiModelId;
        thinkingLevel: AiThinkingLevel;
        notesModel?: AiModelId;
        notesThinkingLevel?: AiThinkingLevel;
        httpsOnly: boolean;
        includeDjNotes?: boolean;
      }
    | {
        mode: 'similar';
        station: Station;
        model: AiModelId;
        thinkingLevel: AiThinkingLevel;
        notesModel?: AiModelId;
        notesThinkingLevel?: AiThinkingLevel;
        httpsOnly: boolean;
        includeDjNotes?: boolean;
      }
): Promise<AiSearchResponse> {
  const seedStats = seedIndexStore.getStats();

  // Step 1: Plan structured queries & semantic profile with selected Station model & thinking level
  const plan = await planSearchWithLlm(
    ai,
    opts.model,
    opts.thinkingLevel,
    opts.mode === 'search'
      ? { mode: 'search', query: opts.query }
      : { mode: 'similar', station: opts.station }
  );

  const semanticText =
    opts.mode === 'search'
      ? `${opts.query}. ${plan.semanticProfile}`
      : `${buildStationDescriptor(opts.station)}. ${plan.semanticProfile}`;

  // Step 2: Embed semantic query + fan out live Radio Browser queries in parallel
  const [queryVecArr, ...liveLists] = await Promise.all([
    embedTexts(ai, [semanticText]),
    ...plan.plans.map((p) => fetchRadioBrowserPlan(p, opts.httpsOnly, 16)),
  ]);
  const queryVector = queryVecArr[0];
  if (queryVector && seedStats.vectorCount < seedStats.totalStations) {
    warmSeedIndexInBackground(ai);
  }

  // Step 3: Pull semantic matches from bundled seed index (<3ms)
  const excludeUuid = opts.mode === 'similar' ? opts.station.stationuuid : undefined;
  const seedMatches =
    seedStats.vectorCount > 0 && queryVector
      ? seedIndexStore.searchTopMatches(queryVector, {
          limit: 24,
          httpsOnly: opts.httpsOnly,
          excludeUuid,
        })
      : [];

  let candidateMap = new Map<string, Station>();
  for (const hit of seedMatches) {
    if (isPlayableStation(hit.station, opts.httpsOnly)) {
      candidateMap.set(hit.station.stationuuid, hit.station);
    }
  }
  for (const list of liveLists) {
    for (const st of list) {
      if (excludeUuid && st.stationuuid === excludeUuid) continue;
      if (!candidateMap.has(st.stationuuid)) {
        candidateMap.set(st.stationuuid, st);
      }
    }
  }

  // If seed vectors aren't pre-computed or live queries were sparse, pull lexical/tag matches from bundled seed index
  if (candidateMap.size < 20 && seedStats.totalStations > 0) {
    const searchTerms = [
      ...plan.planTags,
      ...(opts.mode === 'search' ? [opts.query] : [opts.station.tags, opts.station.country]),
      ...plan.plans.flatMap((p) => [p.tag || '', p.name || '', p.language || '']),
    ].filter(Boolean);
    const countryCodes = plan.plans
      .map((p) => p.countrycode || '')
      .filter((c) => c.length === 2);
    const metaCandidates = seedIndexStore.searchMetadataCandidates(searchTerms, {
      limit: 32,
      httpsOnly: opts.httpsOnly,
      excludeUuid,
      countryCodes,
    });
    for (const st of metaCandidates) {
      if (!candidateMap.has(st.stationuuid)) {
        candidateMap.set(st.stationuuid, st);
      }
    }
  }

  // Parallel wave of relaxed Radio Browser plans only when combined primary results are sparse
  if (candidateMap.size < 12) {
    const relaxedPlans = buildRelaxedPlans(plan.plans);
    if (relaxedPlans.length > 0) {
      const relaxedLists = await Promise.all(
        relaxedPlans.map((p) => fetchRadioBrowserPlan(p, opts.httpsOnly, 16))
      );
      for (const list of relaxedLists) {
        for (const st of list) {
          if (excludeUuid && st.stationuuid === excludeUuid) continue;
          if (!candidateMap.has(st.stationuuid)) {
            candidateMap.set(st.stationuuid, st);
          }
        }
      }
    }
  }

  // Last-resort live fallback so semantic reranking always has playable candidates
  if (candidateMap.size < 8) {
    const firstTagToken =
      (plan.planTags[0] || '')
        .split(/\s+/)
        .map((w) => w.trim().toLowerCase())
        .find((w) => w.length >= 3) || 'jazz';
    const fallbackLive = await fetchRadioBrowserPlan({ tag: firstTagToken }, opts.httpsOnly, 24);
    for (const st of fallbackLive) {
      if (excludeUuid && st.stationuuid === excludeUuid) continue;
      if (!candidateMap.has(st.stationuuid)) {
        candidateMap.set(st.stationuuid, st);
      }
    }
  }

  if (candidateMap.size < 6) {
    const popular = await fetchPopularFallbackStations(opts.httpsOnly);
    for (const st of popular) {
      if (excludeUuid && st.stationuuid === excludeUuid) continue;
      if (!candidateMap.has(st.stationuuid)) {
        candidateMap.set(st.stationuuid, st);
      }
    }
  }

  const candidates = [...candidateMap.values()].slice(0, 56);
  if (candidates.length === 0) {
    return {
      headline: plan.headline,
      intro: plan.intro,
      stations: [],
      djNotes: {},
      planTags: plan.planTags,
      usedSeedIndex: seedStats.totalStations > 0,
      seedCount: seedStats.totalStations,
      model: opts.model,
      thinkingLevel: opts.thinkingLevel,
    };
  }

  // Step 4: Embed uncached live candidates (using RAM LRU) & compute hybrid score
  const stationVectors = await getOrEmbedStations(ai, candidates);

  const ranked = candidates
    .map((station) => {
      const vec = stationVectors.get(station.stationuuid);
      const sim = vec && queryVector ? cosineUnitSimilarity(queryVector, vec) : 0;
      const pop = Math.log10(Math.max(10, (station.clickcount || 0) + (station.votes || 0) * 2)) / 6;
      const bitrateBonus = station.bitrate >= 128 ? 0.03 : 0;
      const score = sim * 0.84 + Math.min(1, pop) * 0.13 + bitrateBonus;
      return { station, score, sim };
    })
    .sort((a, b) => b.score - a.score);

  // Soft diversity filter: avoid 3+ stations with the exact same normalized prefix
  const selected: Station[] = [];
  const deferred: Station[] = [];
  const prefixCounts = new Map<string, number>();
  for (const item of ranked) {
    const prefix = item.station.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 2).join(' ');
    const count = prefixCounts.get(prefix) ?? 0;
    if (prefix && count >= 2) {
      deferred.push(item.station);
      continue;
    }
    prefixCounts.set(prefix, count + 1);
    selected.push(item.station);
    if (selected.length >= 12) break;
  }
  if (selected.length < 12 && deferred.length > 0) {
    for (const st of deferred) {
      selected.push(st);
      if (selected.length >= 12) break;
    }
  }

  // Step 5: Optionally generate crisp 1-sentence Radio Sommelier DJ notes (deferred to /api/ai/dj-notes by default)
  let djNotes: Record<string, string> = {};
  if (opts.includeDjNotes) {
    const contextLabel =
      opts.mode === 'search'
        ? `Listener mood/scene prompt: "${opts.query}"`
        : `Finding stations similar to "${opts.station.name}" (${opts.station.country}, tags: ${opts.station.tags})`;
    djNotes = await generateDjNotes(
      ai,
      opts.notesModel ?? opts.model,
      opts.notesThinkingLevel ?? opts.thinkingLevel,
      contextLabel,
      selected
    );
  }

  return {
    headline: plan.headline,
    intro: plan.intro,
    stations: selected,
    djNotes,
    planTags: plan.planTags,
    usedSeedIndex: seedStats.totalStations > 0,
    seedCount: seedStats.totalStations,
    model: opts.model,
    thinkingLevel: opts.thinkingLevel,
  };
}

export async function handleAiSearchRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const rawUrl = req.url || '';
  const pathname = rawUrl.split('?')[0];

  if (!pathname.startsWith('/api/ai/')) {
    return false;
  }

  const isSeedExport = pathname === '/api/ai/seed-export';
  if (isSeedExport) {
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET');
      sendJson(res, 405, { error: 'Method Not Allowed' });
      return true;
    }
  } else if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return true;
  }

  // Enforce Passcode / JWT protection and AI-specific authorization
  if (!validateRequestAuth(req)) {
    sendJson(res, 401, {
      error: 'Unauthorized: Passcode authentication required',
      code: 'AUTH_REQUIRED',
    });
    return true;
  }
  if (!validateAiRequestAuth(req)) {
    sendJson(res, 403, {
      error: 'Forbidden: The general passcode does not authorize AI search. An AI passcode is required.',
      code: 'AI_AUTH_REQUIRED',
    });
    return true;
  }

  if (isSeedExport) {
    const queryStr = rawUrl.split('?')[1] || '';
    const params = new URLSearchParams(queryStr);
    const shouldHydrate = params.get('hydrate') === '1' || params.get('hydrate') === 'true';
    if (shouldHydrate) {
      const ai = getGeminiClient();
      if (!ai) {
        sendJson(res, 503, {
          error: 'Gemini API key is not configured on the server.',
          code: 'GEMINI_NOT_CONFIGURED',
        });
        return true;
      }
      try {
        await hydrateMissingSeedVectors(ai);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Seed embedding hydration failed';
        sendJson(res, 502, { error: msg });
        return true;
      }
    }
    const payload = seedIndexStore.exportSeedFile();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="station-seed-index.json"');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(payload));
    return true;
  }

  const ai = getGeminiClient();
  if (!ai) {
    sendJson(res, 503, {
      error: 'Gemini API key is not configured on the server.',
      code: 'GEMINI_NOT_CONFIGURED',
    });
    return true;
  }

  if (pathname === '/api/ai/search') {
    const body = await parseJsonBody<{
      query?: string;
      model?: unknown;
      thinkingLevel?: unknown;
      notesModel?: unknown;
      notesThinkingLevel?: unknown;
      httpsOnly?: boolean;
      includeDjNotes?: boolean;
    }>(req);
    const query = (body?.query || '').trim().slice(0, 240);
    if (!query) {
      sendJson(res, 400, { error: 'Please enter a mood, scene, or station description.' });
      return true;
    }

    const model = normalizeAiModel(body?.model);
    const thinkingLevel = normalizeThinkingLevel(body?.thinkingLevel);
    const notesModel = body?.notesModel !== undefined ? normalizeAiModel(body.notesModel) : model;
    const notesThinkingLevel =
      body?.notesThinkingLevel !== undefined
        ? normalizeThinkingLevel(body.notesThinkingLevel)
        : thinkingLevel;
    const httpsOnly = body?.httpsOnly !== false;
    const includeDjNotes = body?.includeDjNotes === true;
    const cacheKey = `search|${query.toLowerCase()}|${model}|${thinkingLevel}|${httpsOnly}`;

    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() && !includeDjNotes) {
      sendJson(res, 200, cached.data);
      return true;
    }

    try {
      const result = await runHybridPipeline(ai, {
        mode: 'search',
        query,
        model,
        thinkingLevel,
        notesModel,
        notesThinkingLevel,
        httpsOnly,
        includeDjNotes,
      });
      if (result.stations.length > 0 && !includeDjNotes) {
        responseCache.set(cacheKey, {
          expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS,
          data: result,
        });
      }
      sendJson(res, 200, result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI search failed';
      sendJson(res, 502, { error: msg });
    }
    return true;
  }

  if (pathname === '/api/ai/similar') {
    const body = await parseJsonBody<{
      station?: unknown;
      model?: unknown;
      thinkingLevel?: unknown;
      notesModel?: unknown;
      notesThinkingLevel?: unknown;
      httpsOnly?: boolean;
      includeDjNotes?: boolean;
    }>(req);
    const station = sanitizeServerStation(body?.station);
    if (!station) {
      sendJson(res, 400, { error: 'Valid seed station metadata is required.' });
      return true;
    }

    const model = normalizeAiModel(body?.model);
    const thinkingLevel = normalizeThinkingLevel(body?.thinkingLevel);
    const notesModel = body?.notesModel !== undefined ? normalizeAiModel(body.notesModel) : model;
    const notesThinkingLevel =
      body?.notesThinkingLevel !== undefined
        ? normalizeThinkingLevel(body.notesThinkingLevel)
        : thinkingLevel;
    const httpsOnly = body?.httpsOnly !== false;
    const includeDjNotes = body?.includeDjNotes === true;
    const cacheKey = `similar|${station.stationuuid}|${model}|${thinkingLevel}|${httpsOnly}`;

    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() && !includeDjNotes) {
      sendJson(res, 200, cached.data);
      return true;
    }

    try {
      const result = await runHybridPipeline(ai, {
        mode: 'similar',
        station,
        model,
        thinkingLevel,
        notesModel,
        notesThinkingLevel,
        httpsOnly,
        includeDjNotes,
      });
      if (result.stations.length > 0 && !includeDjNotes) {
        responseCache.set(cacheKey, {
          expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS,
          data: result,
        });
      }
      sendJson(res, 200, result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI similarity search failed';
      sendJson(res, 502, { error: msg });
    }
    return true;
  }

  if (pathname === '/api/ai/dj-notes') {
    const body = await parseJsonBody<{
      query?: string;
      seedStation?: unknown;
      stations?: unknown[];
      notesModel?: unknown;
      notesThinkingLevel?: unknown;
      model?: unknown;
      thinkingLevel?: unknown;
      httpsOnly?: boolean;
    }>(req);
    const seedStation = sanitizeServerStation(body?.seedStation);
    const query = (body?.query || '').trim().slice(0, 240);
    const rawStations = Array.isArray(body?.stations) ? body.stations : [];
    const stations = rawStations
      .map((s) => sanitizeServerStation(s))
      .filter((s): s is Station => s !== null)
      .slice(0, 16);

    if (stations.length === 0 || (!query && !seedStation)) {
      sendJson(res, 400, { error: 'Stations and query or seedStation are required for DJ notes.' });
      return true;
    }

    const notesModel = normalizeAiModel(body?.notesModel ?? body?.model);
    const notesThinkingLevel = normalizeThinkingLevel(
      body?.notesThinkingLevel ?? body?.thinkingLevel
    );
    const mode = seedStation ? 'similar' : 'search';
    const queryOrUuid = seedStation ? seedStation.stationuuid : query.toLowerCase();
    const stationsHash = hashDescriptor(stations.map((s) => s.stationuuid).join(','));
    const notesCacheKey = `${mode}|${queryOrUuid}|${stationsHash}|${notesModel}|${notesThinkingLevel}`;

    const cached = djNotesCache.get(notesCacheKey);
    if (cached && cached.expiresAt > Date.now() && Object.keys(cached.djNotes).length > 0) {
      sendJson(res, 200, { djNotes: cached.djNotes });
      return true;
    }

    const contextLabel = seedStation
      ? `Finding stations similar to "${seedStation.name}" (${seedStation.country}, tags: ${seedStation.tags})`
      : `Listener mood/scene prompt: "${query}"`;

    try {
      const djNotes = await generateDjNotes(
        ai,
        notesModel,
        notesThinkingLevel,
        contextLabel,
        stations
      );
      if (Object.keys(djNotes).length > 0) {
        djNotesCache.set(notesCacheKey, {
          expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS,
          djNotes,
        });
      }
      sendJson(res, 200, { djNotes });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'DJ note generation failed';
      sendJson(res, 502, { error: msg });
    }
    return true;
  }

  sendJson(res, 404, { error: 'AI endpoint not found' });
  return true;
}
