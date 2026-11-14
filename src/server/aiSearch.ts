import type { IncomingMessage, ServerResponse } from 'node:http';
import crypto from 'node:crypto';
import {
  GoogleGenAI,
  ThinkingLevel,
  Type,
  type ContentListUnion,
  type GenerateContentConfig,
  type GenerateContentResponse,
  type SchemaUnion,
} from '@google/genai';
import { validateAiRequestAuth, validateRequestAuth } from './auth.ts';
import {
  SEED_EMBEDDING_DIM,
  buildStationDescriptor,
  cosineUnitSimilarity,
  normalizeVector,
  seedIndexStore,
} from './seedIndex.ts';
import { getStationGeoLabels, resolveGeoIntentFromText } from './geoTaxonomy.ts';
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
  if (raw === 'gemini-flash-lite-latest' || raw === 'gemini-flash-latest') {
    return raw;
  }
  return DEFAULT_AI_MODEL;
}

export function normalizeThinkingLevel(raw: unknown): AiThinkingLevel {
  if (raw === 'low' || raw === 'medium' || raw === 'high') {
    return raw;
  }
  return 'low';
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

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function getErrorStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object') {
    const obj = err as {
      status?: unknown;
      code?: unknown;
      error?: { code?: unknown; status?: unknown };
      response?: { status?: unknown };
    };
    for (const val of [obj.status, obj.code, obj.error?.code, obj.response?.status]) {
      if (typeof val === 'number' && Number.isFinite(val)) return val;
    }
  }
  const match = extractErrorMessage(err).match(/\b(400|401|403|404|429|500|502|503|504)\b/);
  return match ? Number(match[1]) : undefined;
}

function isFatalAuthOrQuotaError(err: unknown): boolean {
  const status = getErrorStatus(err);
  if (status === 401 || status === 403 || status === 429) return true;
  return /PERMISSION_DENIED|API_KEY_INVALID|API key not valid|RESOURCE_EXHAUSTED|QUOTA_EXCEEDED|UNAUTHENTICATED|billing/i.test(
    extractErrorMessage(err)
  );
}

function isModelNotFoundError(err: unknown): boolean {
  const status = getErrorStatus(err);
  if (status === 404) return true;
  return /NOT_FOUND|is not found|not supported for generateContent|unknown model|model not found/i.test(
    extractErrorMessage(err)
  );
}

function isTransientError(err: unknown): boolean {
  const status = getErrorStatus(err);
  if (status === 500 || status === 503 || status === 504) return true;
  return /UNAVAILABLE|DEADLINE_EXCEEDED|fetch failed|ECONNRESET|ETIMEDOUT/i.test(
    extractErrorMessage(err)
  );
}

function isSchemaConfigError(err: unknown): boolean {
  const status = getErrorStatus(err);
  const msg = extractErrorMessage(err);
  return (
    (status === 400 || /INVALID_ARGUMENT/i.test(msg)) &&
    /response_schema|responseSchema|response_mime_type|responseMimeType|json mode|controlled generation|schema/i.test(
      msg
    )
  );
}

function isRecoverableBadRequestError(err: unknown): boolean {
  const status = getErrorStatus(err);
  const msg = extractErrorMessage(err);
  return (
    status === 400 ||
    /INVALID_ARGUMENT|thinking|thinkingLevel|thinking_level|thinkingConfig|thinking_config/i.test(msg)
  );
}

export interface GenerateContentFallbackInput {
  model: AiModelId;
  contents: ContentListUnion;
  systemInstruction: string;
  thinkingLevel: ThinkingLevel;
  responseMimeType?: string;
  responseSchema?: SchemaUnion;
  jsonFallbackHint?: string;
}

function extractTextFromContents(contents: ContentListUnion): string {
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) {
    return contents
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'text' in item && typeof item.text === 'string') {
          return item.text;
        }
        if (item && typeof item === 'object' && 'parts' in item && Array.isArray(item.parts)) {
          return item.parts
            .map((p) => (p && typeof p === 'object' && 'text' in p && typeof p.text === 'string' ? p.text : ''))
            .filter(Boolean)
            .join('\n');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (contents && typeof contents === 'object' && 'parts' in contents && Array.isArray(contents.parts)) {
    return contents.parts
      .map((p) => (p && typeof p === 'object' && 'text' in p && typeof p.text === 'string' ? p.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function toInteractionThinkingLevel(level: ThinkingLevel): 'low' | 'medium' | 'high' | 'minimal' {
  switch (level) {
    case ThinkingLevel.HIGH:
    case ThinkingLevel.XHIGH:
      return 'high';
    case ThinkingLevel.MEDIUM:
      return 'medium';
    case ThinkingLevel.MINIMAL:
      return 'minimal';
    case ThinkingLevel.LOW:
    default:
      return 'low';
  }
}

export async function generateContentWithFallback(
  ai: GoogleGenAI,
  input: GenerateContentFallbackInput
): Promise<{ response: GenerateContentResponse; usedModel: string }> {
  const modelCandidates: string[] =
    input.model === 'gemini-flash-lite-latest'
      ? ['gemini-flash-lite-latest', 'gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-4-hydrogen']
      : ['gemini-flash-latest', 'gemini-4-hydrogen'];

  const schemaModes: Array<'schema' | 'mimeOnly' | 'plain'> = input.responseSchema
    ? ['schema', 'mimeOnly', 'plain']
    : input.responseMimeType
      ? ['mimeOnly', 'plain']
      : ['plain'];

  let lastError: unknown = null;

  for (const candidateModel of modelCandidates) {
    const apiVersions: Array<'v1beta' | undefined> =
      candidateModel.endsWith('-latest') ? ['v1beta', undefined] : [undefined, 'v1beta'];

    const rawThinking: Array<ThinkingLevel | undefined> =
      candidateModel === 'gemini-3.1-flash-lite'
        ? [input.thinkingLevel, ThinkingLevel.LOW, ThinkingLevel.MINIMAL, undefined]
        : [input.thinkingLevel, ThinkingLevel.LOW, undefined];
    const thinkingCandidates = rawThinking.filter(
      (val, idx) => rawThinking.indexOf(val) === idx
    );

    for (const apiVersion of apiVersions) {
      let moveNextApiVersion = false;

      for (const schemaMode of schemaModes) {
        for (const level of thinkingCandidates) {
          const config: GenerateContentConfig = {
            systemInstruction:
              schemaMode !== 'schema' && input.jsonFallbackHint
                ? `${input.systemInstruction}\n\n${input.jsonFallbackHint}`
                : input.systemInstruction,
          };
          if (level !== undefined) {
            config.thinkingConfig = { thinkingLevel: level };
          }
          if (schemaMode === 'schema') {
            if (input.responseMimeType) config.responseMimeType = input.responseMimeType;
            if (input.responseSchema) config.responseSchema = input.responseSchema;
          } else if (schemaMode === 'mimeOnly' && input.responseMimeType) {
            config.responseMimeType = input.responseMimeType;
          }
          if (apiVersion) {
            config.httpOptions = { apiVersion };
          }

          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const response = await ai.models.generateContent({
                model: candidateModel,
                contents: input.contents,
                config,
              });
              return { response, usedModel: candidateModel };
            } catch (err) {
              lastError = err;
              if (isFatalAuthOrQuotaError(err)) {
                throw err;
              }
              if (attempt === 0 && isTransientError(err)) {
                await new Promise((r) => setTimeout(r, 200));
                continue;
              }
              break;
            }
          }

          if (isModelNotFoundError(lastError)) {
            moveNextApiVersion = true;
            break;
          }
          if (isSchemaConfigError(lastError)) {
            break;
          }
          if (isRecoverableBadRequestError(lastError)) {
            continue;
          }
          throw lastError;
        }

        if (moveNextApiVersion) {
          break;
        }
      }
    }

    if (
      candidateModel === 'gemini-flash-latest' &&
      typeof ai.interactions?.create === 'function'
    ) {
      try {
        const promptText = extractTextFromContents(input.contents);
        const sysPrompt = input.jsonFallbackHint
          ? `${input.systemInstruction}\n\n${input.jsonFallbackHint}`
          : input.systemInstruction;
        const interaction = await ai.interactions.create({
          model: 'models/gemini-flash-latest',
          input: promptText,
          system_instruction: sysPrompt,
          store: false,
          generation_config: {
            max_output_tokens: 65536,
            thinking_level: toInteractionThinkingLevel(input.thinkingLevel),
          },
        });
        let text = interaction.output_text ?? '';
        if (!text && Array.isArray(interaction.steps)) {
          const lastModelStep = [...interaction.steps]
            .reverse()
            .find((step) => step.type === 'model_output');
          if (lastModelStep && 'content' in lastModelStep && Array.isArray(lastModelStep.content)) {
            const textPart = lastModelStep.content.find(
              (c): c is { type: 'text'; text: string } =>
                Boolean(c && typeof c === 'object' && c.type === 'text' && 'text' in c)
            );
            if (textPart?.text) text = textPart.text;
          }
        }
        if (text.trim()) {
          return {
            response: { text } as GenerateContentResponse,
            usedModel: candidateModel,
          };
        }
      } catch (err) {
        lastError = err;
        if (isFatalAuthOrQuotaError(err)) {
          throw err;
        }
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(extractErrorMessage(lastError) || 'Gemini API request failed');
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
  targetCountryCodes: string[];
  targetRegions: string[];
  geoPriority: boolean;
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

function parseJsonObject(raw: string): Record<string, unknown> {
  const cleaned = stripJsonFence(raw || '{}');
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through to substring extraction
  }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  }
  throw new Error('Model returned invalid JSON object for station search plan.');
}

function parseJsonArray(raw: string): unknown[] {
  const cleaned = stripJsonFence(raw || '[]');
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // fall through to substring extraction
  }
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start !== -1 && end > start) {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
    if (Array.isArray(parsed)) return parsed;
  }
  return [];
}

export function mergeGeoIntent(
  queryText: string,
  llmCountryCodes: string[],
  llmRegions: string[],
  llmGeoPriority: boolean
): {
  targetCountryCodes: string[];
  targetRegions: string[];
  geoPriority: boolean;
  regionalTags: string[];
} {
  const deterministic = resolveGeoIntentFromText(queryText);
  const codeSet = new Set<string>();
  for (const c of deterministic.countryCodes) {
    const clean = c.trim().toUpperCase();
    if (clean.length === 2) codeSet.add(clean);
  }
  for (const c of llmCountryCodes) {
    const clean = c.trim().toUpperCase();
    if (clean.length === 2) codeSet.add(clean);
  }

  const regionSet = new Set<string>();
  for (const r of deterministic.regionLabels) {
    if (r.trim()) regionSet.add(r.trim());
  }
  for (const r of llmRegions) {
    if (r.trim()) regionSet.add(r.trim());
  }

  const targetCountryCodes = [...codeSet].slice(0, 20);
  const targetRegions = [...regionSet].slice(0, 6);
  const geoPriority = Boolean(llmGeoPriority || deterministic.hasGeoIntent || targetCountryCodes.length > 0);
  return {
    targetCountryCodes,
    targetRegions,
    geoPriority,
    regionalTags: deterministic.regionalTags,
  };
}

async function planSearchWithLlm(
  ai: GoogleGenAI,
  model: AiModelId,
  thinkingLevel: AiThinkingLevel,
  opts: { mode: 'search'; query: string } | { mode: 'similar'; station: Station }
): Promise<QueryPlanResult> {
  const systemInstruction =
    'You are an expert global radio curator for World Radio. Translate a listener prompt or seed radio station into structured Radio Browser directory search filters plus a rich semantic mood profile for vector matching.\n' +
    'GEOGRAPHY RULES:\n' +
    '- If the prompt mentions or evokes ANY country, city, continent, sub-region, culture, or regional biome (e.g. "Africa safari", "Amazon rainy forest", "Tokyo", "Nordic", "Caribbean"), set geoPriority=true, list the most relevant 2-letter ISO-3166-1 uppercase codes in targetCountryCodes (up to 12 countries, e.g. Africa safari -> ["KE","TZ","ZA","BW","NA","UG","NG","GH","ET","SN"]; Amazon rainforest -> ["BR","PE","CO","EC","BO","VE"]), and list human region names in targetRegions.\n' +
    '- In plans, NEVER invent non-existent Radio Browser scene tags like "safari", "rainforest", "amazon", or "savanna" as tag filters. Use real Radio Browser music/broadcast tags (e.g. african, afrobeat, world music, mpb, bossa nova, cumbia, folk, jazz, ambient, news, talk, soul, indie, electronic, tango, dub, reggae).\n' +
    '- When geoPriority=true, make plans target targetCountryCodes (including at least one country-only plan without a restrictive tag, e.g. { "countrycode": "KE" } or { "countrycode": "BR" }). Only omit countrycode when geoPriority=false (pure global mood/genre queries).';

  const userPrompt =
    opts.mode === 'search'
      ? `Listener prompt: "${opts.query}"\nGenerate 3 to 4 Radio Browser search plans, targetCountryCodes, targetRegions, geoPriority, a short atmospheric editorial headline (3-6 words), a 1-sentence host intro, and a rich semanticProfile describing the sonic texture, tempo, mood, era, and geography.`
      : `Seed radio station:\n${buildStationDescriptor(opts.station)}\nGenerate 2 to 4 Radio Browser search plans to discover spiritual and sonic cousins from around the world (include both same/adjacent genres and regional/cultural echoes), set geoPriority=false unless the station name strongly implies purely local discovery, an editorial headline like "Echoes of ${opts.station.name.slice(0, 28)}", a 1-sentence host intro, and a rich semanticProfile capturing its sonic essence.`;

  const plannerCfg = getPlannerConfig(model, thinkingLevel);

  const { response } = await generateContentWithFallback(ai, {
    model: plannerCfg.model,
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    systemInstruction,
    thinkingLevel: plannerCfg.thinkingLevel,
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        headline: { type: Type.STRING },
        intro: { type: Type.STRING },
        semanticProfile: { type: Type.STRING },
        geoPriority: { type: Type.BOOLEAN },
        targetCountryCodes: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        targetRegions: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
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
      required: ['headline', 'intro', 'semanticProfile', 'geoPriority', 'targetCountryCodes', 'targetRegions', 'planTags', 'plans'],
    },
    jsonFallbackHint:
      'Return ONLY valid JSON matching { "headline": string, "intro": string, "semanticProfile": string, "geoPriority": boolean, "targetCountryCodes": string[], "targetRegions": string[], "planTags": string[], "plans": Array<{ tag?: string, countrycode?: string, language?: string, name?: string }> }.',
  });

  const parsed = parseJsonObject(response.text || '{}') as Partial<QueryPlanResult>;

  const rawLlmCodes = Array.isArray(parsed.targetCountryCodes)
    ? parsed.targetCountryCodes.filter((c): c is string => typeof c === 'string')
    : [];
  const rawLlmRegions = Array.isArray(parsed.targetRegions)
    ? parsed.targetRegions.filter((r): r is string => typeof r === 'string')
    : [];

  const mergedGeo =
    opts.mode === 'search'
      ? mergeGeoIntent(opts.query, rawLlmCodes, rawLlmRegions, Boolean(parsed.geoPriority))
      : {
          targetCountryCodes: rawLlmCodes.map((c) => c.trim().toUpperCase()).filter((c) => c.length === 2),
          targetRegions: rawLlmRegions.map((r) => r.trim()).filter(Boolean),
          geoPriority: false,
          regionalTags: [],
        };

  const plans = Array.isArray(parsed.plans)
    ? parsed.plans
        .filter((p): p is FilterPlan => Boolean(p && typeof p === 'object'))
        .slice(0, 4)
    : [];

  // If geographic intent is active, ensure plans prioritize target countries and don't starve them
  const finalPlans: FilterPlan[] =
    plans.length > 0
      ? plans
      : mergedGeo.targetCountryCodes.length > 0
        ? mergedGeo.targetCountryCodes.slice(0, 3).map((countrycode) => ({ countrycode }))
        : [{ tag: 'jazz' }, { tag: 'ambient' }];

  const rawPlanTags = Array.isArray(parsed.planTags)
    ? parsed.planTags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    : [];
  const combinedTags = [...new Set([...rawPlanTags, ...mergedGeo.regionalTags])].slice(0, 6);

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
    planTags: combinedTags,
    plans: finalPlans,
    targetCountryCodes: mergedGeo.targetCountryCodes,
    targetRegions: mergedGeo.targetRegions,
    geoPriority: mergedGeo.geoPriority,
  };
}

async function embedTexts(ai: GoogleGenAI, texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  let res;
  try {
    res = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: texts,
      config: { outputDimensionality: SEED_EMBEDDING_DIM },
    });
  } catch (err) {
    if (
      isFatalAuthOrQuotaError(err) ||
      (!isModelNotFoundError(err) && !isRecoverableBadRequestError(err))
    ) {
      throw err;
    }
    res = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: texts,
      config: {
        outputDimensionality: SEED_EMBEDDING_DIM,
        httpOptions: { apiVersion: 'v1beta' },
      },
    });
  }
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
    const { response } = await generateContentWithFallback(ai, {
      model: notesCfg.model,
      contents: [
        {
          role: 'user',
          parts: [{ text: `Context: ${contextLabel}\nStations:\n${JSON.stringify(compactList)}` }],
        },
      ],
      systemInstruction:
        'You are a warm, knowledgeable late-night radio DJ for World Radio. For each station in the JSON list, write exactly ONE crisp, evocative sentence (max 18 words) explaining why this specific station fits the context. Ground every note strictly in the station\'s real name, country, language, and tags. Never invent percentages, scores, or fake live song titles.',
      thinkingLevel: notesCfg.thinkingLevel,
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
      jsonFallbackHint:
        'Return ONLY a valid JSON array of objects: [{ "stationuuid": string, "note": string }].',
    });

    const parsed = parseJsonArray(response.text || '[]') as Array<{
      stationuuid?: string;
      note?: string;
    }>;
    const notes: Record<string, string> = {};
    for (const item of parsed) {
      if (item?.stationuuid && typeof item.note === 'string' && item.note.trim()) {
        notes[item.stationuuid] = item.note.trim();
      }
    }
    return notes;
  } catch (err) {
    console.warn('[aiSearch] DJ notes generation failed:', extractErrorMessage(err));
    return {};
  }
}

export function computeGeoTieredRank(
  station: Station,
  sim: number,
  opts: {
    geoPriority: boolean;
    targetCountrySet: Set<string>;
    targetRegionTokens: string[];
  }
): { score: number; isExactCountry: boolean; isRegionTextMatch: boolean } {
  const pop = Math.log10(Math.max(10, (station.clickcount || 0) + (station.votes || 0) * 2)) / 6;
  const clampedPop = Math.min(1, pop);

  if (!opts.geoPriority || opts.targetCountrySet.size === 0) {
    const bitrateBonus = station.bitrate >= 128 ? 0.03 : 0;
    return {
      score: sim * 0.84 + clampedPop * 0.13 + bitrateBonus,
      isExactCountry: false,
      isRegionTextMatch: false,
    };
  }

  const code = (station.countrycode || '').trim().toUpperCase();
  const isExactCountry = code.length === 2 && opts.targetCountrySet.has(code);
  const geoLabels = getStationGeoLabels(code);
  const stationText = `${station.name} ${station.tags} ${station.country} ${station.state} ${geoLabels?.continent || ''} ${geoLabels?.subRegion || ''}`.toLowerCase();
  const isRegionTextMatch =
    !isExactCountry &&
    opts.targetRegionTokens.some((tok) => tok.length >= 4 && stationText.includes(tok));

  const geoBonus = isExactCountry ? 0.55 : isRegionTextMatch ? 0.25 : 0;
  const bitrateBonus = station.bitrate >= 128 ? 0.015 : 0;
  return {
    score: geoBonus + sim * 0.65 + clampedPop * 0.06 + bitrateBonus,
    isExactCountry,
    isRegionTextMatch,
  };
}

export function applySoftPrefixDiversity(stations: Station[], limit = 12): Station[] {
  const selected: Station[] = [];
  const deferred: Station[] = [];
  const prefixCounts = new Map<string, number>();

  for (const st of stations) {
    const prefix = st.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .slice(0, 2)
      .join(' ');
    const count = prefixCounts.get(prefix) ?? 0;
    if (prefix && count >= 2) {
      deferred.push(st);
      continue;
    }
    prefixCounts.set(prefix, count + 1);
    selected.push(st);
    if (selected.length >= limit) break;
  }

  if (selected.length < limit && deferred.length > 0) {
    for (const st of deferred) {
      selected.push(st);
      if (selected.length >= limit) break;
    }
  }
  return selected;
}

export async function rerankCandidatesWithLlm(
  ai: GoogleGenAI,
  model: AiModelId,
  thinkingLevel: AiThinkingLevel,
  opts: {
    contextLabel: string;
    targetRegions: string[];
    targetCountryCodes: string[];
    geoPriority: boolean;
    candidates: Array<{ station: Station; isGeoMatch: boolean }>;
  }
): Promise<{ stations: Station[]; usedReranker: boolean }> {
  if (opts.candidates.length <= 1) {
    return { stations: opts.candidates.map((c) => c.station), usedReranker: false };
  }

  const pool = opts.candidates.slice(0, 30);
  const byUuid = new Map<string, Station>();
  const compactCandidates = pool.map(({ station, isGeoMatch }) => {
    byUuid.set(station.stationuuid, station);
    return {
      stationuuid: station.stationuuid,
      name: station.name,
      country: station.country || station.countrycode,
      countrycode: station.countrycode,
      language: station.language,
      tags: station.tags,
      inTargetRegion: isGeoMatch,
    };
  });

  const systemInstruction =
    'You are the final curatorial reranker for World Radio. Select and order the best 12 stations from the provided candidates for the listener request.\n' +
    'STRICT CURATION RULES:\n' +
    '1. GEOGRAPHIC AUTHENTICITY FIRST: When targetRegions/targetCountryCodes are specified, authentic stations actually broadcasting from those countries/regions (inTargetRegion=true or clearly regional broadcasts) MUST come before out-of-region stations.\n' +
    '2. REJECT KEYWORD TRAPS: Reject false-positive stations whose tags only superficially match English words (e.g., reject UK Drum & Bass/electronic "jungle" stations for rainforest prompts, reject German/Italian spa/sleep streams for Amazon or Africa prompts when authentic regional stations are available, and reject unrelated European pop/talk stations).\n' +
    '3. MOOD & VARIETY SECOND: Within authentic regional stations, rank highest those whose genres, culture, or atmosphere best fit the prompt, while avoiding 3+ stations from the exact same broadcaster.\n' +
    '4. NEVER invent UUIDs. Only return UUIDs present in the candidate list.';

  const userPrompt =
    `${opts.contextLabel}\n` +
    (opts.geoPriority && opts.targetCountryCodes.length > 0
      ? `Target Regions: ${opts.targetRegions.join(', ') || 'Specified countries'} | Target ISO codes: ${opts.targetCountryCodes.join(', ')}\n`
      : 'No strict regional restriction; prioritize strongest sonic/mood match.\n') +
    `Candidates:\n${JSON.stringify(compactCandidates)}`;

  try {
    const cfg = getPlannerConfig(model, thinkingLevel);
    const { response } = await generateContentWithFallback(ai, {
      model: cfg.model,
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      systemInstruction,
      thinkingLevel: cfg.thinkingLevel,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          orderedUuids: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          rejectedUuids: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ['orderedUuids'],
      },
      jsonFallbackHint:
        'Return ONLY valid JSON: { "orderedUuids": string[], "rejectedUuids"?: string[] }.',
    });

    const parsed = parseJsonObject(response.text || '{}') as {
      orderedUuids?: unknown;
      rejectedUuids?: unknown;
    };

    const orderedRaw = Array.isArray(parsed.orderedUuids) ? parsed.orderedUuids : [];
    const rejectedSet = new Set(
      Array.isArray(parsed.rejectedUuids)
        ? parsed.rejectedUuids.filter((id): id is string => typeof id === 'string')
        : []
    );

    const chosen: Station[] = [];
    const seen = new Set<string>();
    for (const uuid of orderedRaw) {
      if (typeof uuid !== 'string' || seen.has(uuid) || rejectedSet.has(uuid)) continue;
      const st = byUuid.get(uuid);
      if (st) {
        seen.add(uuid);
        chosen.push(st);
      }
    }

    if (chosen.length === 0) {
      return { stations: applySoftPrefixDiversity(pool.map((c) => c.station), 12), usedReranker: false };
    }

    // Backfill non-rejected candidates first if curator returned fewer than 12
    for (const { station } of pool) {
      if (chosen.length >= 16) break;
      if (!seen.has(station.stationuuid) && !rejectedSet.has(station.stationuuid)) {
        seen.add(station.stationuuid);
        chosen.push(station);
      }
    }

    return {
      stations: applySoftPrefixDiversity(chosen, 12),
      usedReranker: true,
    };
  } catch (err) {
    console.warn('[aiSearch] Curatorial reranker failed, falling back to hybrid ranking:', extractErrorMessage(err));
    return {
      stations: applySoftPrefixDiversity(pool.map((c) => c.station), 12),
      usedReranker: false,
    };
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
        useReranker?: boolean;
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
        useReranker?: boolean;
      }
): Promise<AiSearchResponse> {
  const seedStats = seedIndexStore.getStats();

  // Step 1: Plan structured queries, geo intent & semantic profile
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

  // Build dedicated bare-country live queries for top target countries when geo intent is active
  const plannedBareCountries = new Set(
    plan.plans
      .filter((p) => p.countrycode && !p.tag && !p.language && !p.name)
      .map((p) => p.countrycode!.trim().toUpperCase())
  );
  const extraCountryPlans: FilterPlan[] = plan.geoPriority
    ? plan.targetCountryCodes
        .filter((cc) => !plannedBareCountries.has(cc))
        .slice(0, 6)
        .map((countrycode) => ({ countrycode }))
    : [];

  // Step 2: Embed semantic query + fan out planned and country-level Radio Browser queries in parallel
  const [queryVecArr, ...allLiveLists] = await Promise.all([
    embedTexts(ai, [semanticText]),
    ...plan.plans.map((p) => fetchRadioBrowserPlan(p, opts.httpsOnly, 16)),
    ...extraCountryPlans.map((p) => fetchRadioBrowserPlan(p, opts.httpsOnly, 14)),
  ]);
  const liveLists = allLiveLists.slice(0, plan.plans.length);
  const geoLiveLists = allLiveLists.slice(plan.plans.length);

  const queryVector = queryVecArr[0];
  if (queryVector && seedStats.vectorCount < seedStats.totalStations) {
    warmSeedIndexInBackground(ai);
  }

  // Step 3: Regional-first candidate assembly from seed index & live mirrors
  const excludeUuid = opts.mode === 'similar' ? opts.station.stationuuid : undefined;
  const targetCountrySet = new Set(plan.targetCountryCodes.map((c) => c.toUpperCase()));
  const searchTerms = [
    ...plan.planTags,
    ...plan.targetRegions,
    ...(opts.mode === 'search' ? [opts.query] : [opts.station.tags, opts.station.country]),
    ...plan.plans.flatMap((p) => [p.tag || '', p.name || '', p.language || '']),
  ].filter(Boolean);

  const seedGeoMatches =
    plan.geoPriority && plan.targetCountryCodes.length > 0 && seedStats.vectorCount > 0 && queryVector
      ? seedIndexStore.searchTopMatches(queryVector, {
          limit: 32,
          httpsOnly: opts.httpsOnly,
          excludeUuid,
          countryCodes: plan.targetCountryCodes,
        })
      : [];

  const seedGeoMeta =
    plan.geoPriority && plan.targetCountryCodes.length > 0 && seedStats.totalStations > 0
      ? seedIndexStore.searchMetadataCandidates(searchTerms, {
          limit: 32,
          httpsOnly: opts.httpsOnly,
          excludeUuid,
          countryCodes: plan.targetCountryCodes,
          requireCountryMatch: true,
        })
      : [];

  const seedGlobalMatches =
    seedStats.vectorCount > 0 && queryVector
      ? seedIndexStore.searchTopMatches(queryVector, {
          limit: 24,
          httpsOnly: opts.httpsOnly,
          excludeUuid,
        })
      : [];

  const regionalPool = new Map<string, Station>();
  const globalPool = new Map<string, Station>();

  const addCandidate = (st: Station) => {
    if (excludeUuid && st.stationuuid === excludeUuid) return;
    if (!isPlayableStation(st, opts.httpsOnly)) return;
    const cc = (st.countrycode || '').trim().toUpperCase();
    if (plan.geoPriority && targetCountrySet.has(cc)) {
      if (!regionalPool.has(st.stationuuid)) regionalPool.set(st.stationuuid, st);
    } else if (!globalPool.has(st.stationuuid)) {
      globalPool.set(st.stationuuid, st);
    }
  };

  for (const hit of seedGeoMatches) addCandidate(hit.station);
  for (const st of seedGeoMeta) addCandidate(st);
  for (const list of geoLiveLists) {
    for (const st of list) addCandidate(st);
  }
  for (const list of liveLists) {
    for (const st of list) addCandidate(st);
  }

  // Run relaxed plans when live plans returned sparse results
  const totalLiveHits = liveLists.reduce((acc, list) => acc + list.length, 0) +
    geoLiveLists.reduce((acc, list) => acc + list.length, 0);
  if (totalLiveHits < 12) {
    const relaxedPlans = buildRelaxedPlans(plan.plans);
    if (relaxedPlans.length > 0) {
      const relaxedLists = await Promise.all(
        relaxedPlans.map((p) => fetchRadioBrowserPlan(p, opts.httpsOnly, 16))
      );
      for (const list of relaxedLists) {
        for (const st of list) addCandidate(st);
      }
    }
  }

  for (const hit of seedGlobalMatches) addCandidate(hit.station);

  // Pull general lexical seed matches when candidate pools are sparse or unvectorized
  if (regionalPool.size + globalPool.size < 20 && seedStats.totalStations > 0) {
    const metaCandidates = seedIndexStore.searchMetadataCandidates(searchTerms, {
      limit: 32,
      httpsOnly: opts.httpsOnly,
      excludeUuid,
      countryCodes: plan.targetCountryCodes,
    });
    for (const st of metaCandidates) addCandidate(st);
  }

  // Last-resort live fallback so reranking always has playable candidates
  if (regionalPool.size + globalPool.size < 8) {
    const firstTagToken =
      (plan.planTags[0] || '')
        .split(/\s+/)
        .map((w) => w.trim().toLowerCase())
        .find((w) => w.length >= 3) || 'jazz';
    const fallbackLive = await fetchRadioBrowserPlan({ tag: firstTagToken }, opts.httpsOnly, 24);
    for (const st of fallbackLive) addCandidate(st);
  }

  if (regionalPool.size + globalPool.size < 6) {
    const popular = await fetchPopularFallbackStations(opts.httpsOnly);
    for (const st of popular) addCandidate(st);
  }

  // Reserve regional candidates first (up to 48), then backfill with global matches up to 64
  const MAX_CANDIDATES = plan.geoPriority ? 64 : 56;
  const candidates: Station[] = [
    ...[...regionalPool.values()].slice(0, 48),
    ...[...globalPool.values()],
  ].slice(0, MAX_CANDIDATES);

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
      usedReranker: false,
      targetRegions: plan.targetRegions,
    };
  }

  // Step 4: Embed uncached live candidates (using RAM LRU) & compute geo-tiered hybrid score
  const stationVectors = await getOrEmbedStations(ai, candidates);
  const targetRegionTokens = [
    ...plan.targetRegions.flatMap((r) => r.toLowerCase().split(/[\s,&/]+/)),
    ...plan.targetCountryCodes.map((c) => c.toLowerCase()),
  ].filter((t) => t.length >= 4);

  const ranked = candidates
    .map((station) => {
      const vec = stationVectors.get(station.stationuuid);
      const sim = vec && queryVector ? cosineUnitSimilarity(queryVector, vec) : 0;
      const { score, isExactCountry, isRegionTextMatch } = computeGeoTieredRank(station, sim, {
        geoPriority: plan.geoPriority,
        targetCountrySet,
        targetRegionTokens,
      });
      return { station, score, sim, isGeoMatch: isExactCountry || isRegionTextMatch };
    })
    .sort((a, b) => b.score - a.score);

  // Step 5: Optional LLM Curatorial Reranking Pass (default ON)
  const useReranker = opts.useReranker !== false;
  const contextLabel =
    opts.mode === 'search'
      ? `Listener mood/scene prompt: "${opts.query}" (profile: ${plan.semanticProfile})`
      : `Finding stations similar to "${opts.station.name}" (${opts.station.country}, tags: ${opts.station.tags})`;

  let selected: Station[];
  let usedReranker = false;

  if (useReranker) {
    const reranked = await rerankCandidatesWithLlm(ai, opts.model, opts.thinkingLevel, {
      contextLabel,
      targetRegions: plan.targetRegions,
      targetCountryCodes: plan.targetCountryCodes,
      geoPriority: plan.geoPriority,
      candidates: ranked.map((r) => ({ station: r.station, isGeoMatch: r.isGeoMatch })),
    });
    selected = reranked.stations;
    usedReranker = reranked.usedReranker;
  } else {
    selected = applySoftPrefixDiversity(ranked.map((r) => r.station), 12);
  }

  // Step 6: Optionally generate crisp 1-sentence Radio Sommelier DJ notes
  let djNotes: Record<string, string> = {};
  if (opts.includeDjNotes) {
    const notesContext =
      opts.mode === 'search'
        ? `Listener mood/scene prompt: "${opts.query}"`
        : `Finding stations similar to "${opts.station.name}" (${opts.station.country}, tags: ${opts.station.tags})`;
    djNotes = await generateDjNotes(
      ai,
      opts.notesModel ?? opts.model,
      opts.notesThinkingLevel ?? opts.thinkingLevel,
      notesContext,
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
    usedReranker,
    targetRegions: plan.targetRegions,
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
      useReranker?: boolean;
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
    const useReranker = body?.useReranker !== false;
    const cacheKey = `search|${query.toLowerCase()}|${model}|${thinkingLevel}|${httpsOnly}|${useReranker}`;

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
        useReranker,
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
      useReranker?: boolean;
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
    const useReranker = body?.useReranker !== false;
    const cacheKey = `similar|${station.stationuuid}|${model}|${thinkingLevel}|${httpsOnly}|${useReranker}`;

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
        useReranker,
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
