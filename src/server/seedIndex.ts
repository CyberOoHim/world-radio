import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Station } from '../types.ts';
import { getStationGeoLabels } from './geoTaxonomy.ts';

export const SEED_EMBEDDING_DIM = 768;
export const SEED_EMBEDDING_MODEL = 'gemini-embedding-2';
export const SEED_DESCRIPTOR_VERSION = 2;
export const DEFAULT_SEED_SWEET_SPOT_COUNT = 6000;
export const SEED_SWEET_SPOT_COUNT = DEFAULT_SEED_SWEET_SPOT_COUNT;
export const MIN_SEED_SWEET_SPOT_COUNT = 100;
export const MAX_SEED_SWEET_SPOT_COUNT = 25000;

/**
 * Resolve the target AI seed catalog size from an explicit override or
 * `process.env.SEED_SWEET_SPOT_COUNT`, falling back to `6000` when unset/invalid.
 */
export function resolveSeedSweetSpotCount(override?: string | number | null): number {
  const raw =
    override !== undefined && override !== null
      ? String(override).trim()
      : (process.env.SEED_SWEET_SPOT_COUNT || '').trim();
  if (!raw) return DEFAULT_SEED_SWEET_SPOT_COUNT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SEED_SWEET_SPOT_COUNT;
  }
  return Math.max(MIN_SEED_SWEET_SPOT_COUNT, Math.min(MAX_SEED_SWEET_SPOT_COUNT, parsed));
}

export function computeSeedConfigHash(cfg: {
  targetCount: number;
  model?: string;
  dim?: number;
  descriptorVersion?: number;
}): string {
  const normalized = {
    targetCount: cfg.targetCount,
    model: cfg.model || SEED_EMBEDDING_MODEL,
    dim: cfg.dim || SEED_EMBEDDING_DIM,
    descriptorVersion: cfg.descriptorVersion ?? SEED_DESCRIPTOR_VERSION,
  };
  return crypto.createHash('sha1').update(JSON.stringify(normalized)).digest('hex').slice(0, 12);
}

export interface SeedStationItem {
  station: Station;
  /** Base64-encoded Int8 quantized unit vector (length = dim) */
  vec?: string;
}

export interface SeedIndexFile {
  version: number;
  model: string;
  dim: number;
  generatedAt: string;
  targetCount?: number;
  descriptorVersion?: number;
  configHash?: string;
  items: SeedStationItem[];
}

export interface LoadedSeedEntry {
  station: Station;
  vector: Float32Array | null;
  searchHaystack: string;
}

export interface SeedSyncStatus {
  currentCount: number;
  vectorCount: number;
  targetCount: number;
  fileTargetCount: number | null;
  modelMatches: boolean;
  dimMatches: boolean;
  descriptorMatches: boolean;
  needsGrow: boolean;
  needsTrim: boolean;
  needsReembed: boolean;
  needsHydration: boolean;
  configChanged: boolean;
  needsAnySync: boolean;
}

/** Build a dense, semantically rich text descriptor for embedding a radio station. */
export function buildStationDescriptor(station: Station): string {
  const parts: string[] = [];
  if (station.name) parts.push(`Station: ${station.name.trim()}`);
  const geo = getStationGeoLabels(station.countrycode);
  if (station.country || station.countrycode || geo) {
    const baseLoc = [station.state, station.country || geo?.countryName || station.countrycode]
      .filter(Boolean)
      .join(', ');
    const macroLoc = geo ? `${geo.subRegion}, ${geo.continent}` : '';
    const loc = baseLoc && macroLoc ? `${baseLoc} (${macroLoc})` : baseLoc || macroLoc;
    if (loc) parts.push(`Location: ${loc}`);
  }
  if (station.language) parts.push(`Language: ${station.language}`);
  if (station.tags) {
    const cleanTags = station.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 14)
      .join(', ');
    if (cleanTags) parts.push(`Genres & Moods: ${cleanTags}`);
  }
  if (station.codec || station.bitrate) {
    const audio = [station.codec, station.bitrate ? `${station.bitrate}kbps` : '']
      .filter(Boolean)
      .join(' ');
    if (audio) parts.push(`Audio: ${audio}`);
  }
  return parts.join(' | ');
}

export function buildStationSearchHaystack(station: Station): string {
  const code = (station.countrycode || '').trim().toUpperCase();
  const geo = getStationGeoLabels(code);
  return `${station.name} ${station.tags} ${station.country} ${station.state} ${station.language} ${
    geo ? `${geo.subRegion} ${geo.continent}` : ''
  }`.toLowerCase();
}

/** Normalize a numeric vector to L2 unit length (Float32Array). */
export function normalizeVector(values: ArrayLike<number>): Float32Array {
  const len = values.length;
  const out = new Float32Array(len);
  let sumSq = 0;
  for (let i = 0; i < len; i++) {
    const v = Number(values[i]) || 0;
    out[i] = v;
    sumSq += v * v;
  }
  const norm = Math.sqrt(sumSq);
  if (norm > 1e-12) {
    const inv = 1 / norm;
    for (let i = 0; i < len; i++) {
      out[i] *= inv;
    }
  }
  return out;
}

/** Quantize a unit vector into Int8 base64 for compact container bundling. */
export function quantizeUnitVectorToBase64(values: ArrayLike<number>): string {
  const unit = normalizeVector(values);
  let maxAbs = 0;
  for (let i = 0; i < unit.length; i++) {
    const a = Math.abs(unit[i]);
    if (a > maxAbs) maxAbs = a;
  }
  const scale = maxAbs > 1e-8 ? maxAbs : 1;
  const bytes = new Int8Array(unit.length);
  for (let i = 0; i < unit.length; i++) {
    const q = Math.round((unit[i] / scale) * 127);
    bytes[i] = Math.max(-127, Math.min(127, q));
  }
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

/** Decode base64 Int8 vector back into an L2-normalized Float32Array. Returns null for empty/all-zero vectors. */
export function decodeBase64ToUnitVector(b64: string, expectedDim = SEED_EMBEDDING_DIM): Float32Array | null {
  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length !== expectedDim) return null;
    const raw = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    let hasNonZero = false;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] !== 0) {
        hasNonZero = true;
        break;
      }
    }
    if (!hasNonZero) return null;
    return normalizeVector(raw);
  } catch {
    return null;
  }
}

/** Cosine similarity between two L2-normalized vectors. */
export function cosineUnitSimilarity(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

export class SeedIndexStore {
  private loaded = false;
  private entries: LoadedSeedEntry[] = [];
  private byUuid = new Map<string, LoadedSeedEntry>();
  private vectorCount = 0;
  private generatedAt = '';
  private fileModel: string | null = null;
  private fileDim: number | null = null;
  private fileTargetCount: number | null = null;
  private fileDescriptorVersion: number | null = null;
  private fileConfigHash: string | null = null;

  load(seedFilePath = path.resolve(process.cwd(), 'data', 'station-seed-index.json')): void {
    if (this.loaded) return;
    this.loaded = true;

    if (!fs.existsSync(seedFilePath)) {
      return;
    }

    try {
      const raw = fs.readFileSync(seedFilePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<SeedIndexFile>;
      if (!Array.isArray(parsed.items)) return;

      const dim = typeof parsed.dim === 'number' && parsed.dim > 0 ? parsed.dim : SEED_EMBEDDING_DIM;
      this.fileDim = typeof parsed.dim === 'number' && parsed.dim > 0 ? parsed.dim : null;
      this.fileModel = typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model.trim() : null;
      this.fileTargetCount =
        typeof parsed.targetCount === 'number' && Number.isFinite(parsed.targetCount) && parsed.targetCount > 0
          ? Math.round(parsed.targetCount)
          : null;
      this.fileDescriptorVersion =
        typeof parsed.descriptorVersion === 'number' && Number.isFinite(parsed.descriptorVersion)
          ? parsed.descriptorVersion
          : null;
      this.fileConfigHash = typeof parsed.configHash === 'string' && parsed.configHash ? parsed.configHash : null;
      this.generatedAt = typeof parsed.generatedAt === 'string' ? parsed.generatedAt : '';

      for (const item of parsed.items) {
        if (!item || typeof item !== 'object' || !item.station?.stationuuid) continue;
        if (this.byUuid.has(item.station.stationuuid)) continue;
        const vec =
          typeof item.vec === 'string' && item.vec.length > 0
            ? decodeBase64ToUnitVector(item.vec, dim)
            : null;
        if (vec) this.vectorCount++;
        const entry: LoadedSeedEntry = {
          station: item.station,
          vector: vec,
          searchHaystack: buildStationSearchHaystack(item.station),
        };
        this.entries.push(entry);
        this.byUuid.set(item.station.stationuuid, entry);
      }
    } catch (err) {
      console.warn('Could not load bundled AI seed index:', err);
    }
  }

  getStats(): {
    totalStations: number;
    vectorCount: number;
    generatedAt: string;
    targetCount: number;
    fileTargetCount: number | null;
  } {
    this.load();
    return {
      totalStations: this.entries.length,
      vectorCount: this.vectorCount,
      generatedAt: this.generatedAt,
      targetCount: resolveSeedSweetSpotCount(),
      fileTargetCount: this.fileTargetCount,
    };
  }

  inspectSyncStatus(targetCountOverride?: number): SeedSyncStatus {
    this.load();
    const targetCount = resolveSeedSweetSpotCount(targetCountOverride);
    const currentCount = this.entries.length;
    const modelMatches = this.fileModel === null || this.fileModel === SEED_EMBEDDING_MODEL;
    const dimMatches = this.fileDim === null || this.fileDim === SEED_EMBEDDING_DIM;
    const descriptorMatches =
      this.fileDescriptorVersion === null || this.fileDescriptorVersion === SEED_DESCRIPTOR_VERSION;

    const needsGrow = currentCount < targetCount;
    const needsTrim = currentCount > targetCount;
    const needsReembed = this.entries.length > 0 && (!modelMatches || !dimMatches || !descriptorMatches);
    const needsHydration = needsReembed ? currentCount > 0 : this.vectorCount < currentCount;
    const expectedHash = computeSeedConfigHash({ targetCount });
    const configChanged =
      (this.fileTargetCount !== null && this.fileTargetCount !== targetCount) ||
      (this.fileConfigHash !== null && this.fileConfigHash !== expectedHash) ||
      needsGrow ||
      needsTrim ||
      needsReembed;

    return {
      currentCount,
      vectorCount: this.vectorCount,
      targetCount,
      fileTargetCount: this.fileTargetCount,
      modelMatches,
      dimMatches,
      descriptorMatches,
      needsGrow,
      needsTrim,
      needsReembed,
      needsHydration,
      configChanged,
      needsAnySync: needsGrow || needsTrim || needsReembed || needsHydration,
    };
  }

  getVector(stationuuid: string): Float32Array | null {
    this.load();
    return this.byUuid.get(stationuuid)?.vector ?? null;
  }

  setVector(stationuuid: string, vector: Float32Array): void {
    this.load();
    const entry = this.byUuid.get(stationuuid);
    if (!entry) return;
    if (!entry.vector) {
      this.vectorCount++;
    }
    entry.vector = vector;
  }

  invalidateVectors(): number {
    this.load();
    let cleared = 0;
    for (const entry of this.entries) {
      if (entry.vector) {
        entry.vector = null;
        cleared++;
      }
    }
    this.vectorCount = 0;
    this.fileModel = SEED_EMBEDDING_MODEL;
    this.fileDim = SEED_EMBEDDING_DIM;
    this.fileDescriptorVersion = SEED_DESCRIPTOR_VERSION;
    return cleared;
  }

  trimToTargetCount(targetCount: number): number {
    this.load();
    const normalizedTarget = Math.max(0, Math.round(targetCount));
    if (this.entries.length <= normalizedTarget) {
      this.markConfigSynced(normalizedTarget);
      return 0;
    }
    const removed = this.entries.length - normalizedTarget;
    const kept = this.entries.slice(0, normalizedTarget);
    const nextByUuid = new Map<string, LoadedSeedEntry>();
    let nextVecCount = 0;
    for (const entry of kept) {
      nextByUuid.set(entry.station.stationuuid, entry);
      if (entry.vector) nextVecCount++;
    }
    this.entries = kept;
    this.byUuid = nextByUuid;
    this.vectorCount = nextVecCount;
    this.markConfigSynced(normalizedTarget);
    return removed;
  }

  appendStations(stations: Station[], targetCount: number): number {
    this.load();
    const normalizedTarget = Math.max(0, Math.round(targetCount));
    let added = 0;
    for (const station of stations) {
      if (this.entries.length >= normalizedTarget) break;
      if (!station?.stationuuid || this.byUuid.has(station.stationuuid)) continue;
      const entry: LoadedSeedEntry = {
        station,
        vector: null,
        searchHaystack: buildStationSearchHaystack(station),
      };
      this.entries.push(entry);
      this.byUuid.set(station.stationuuid, entry);
      added++;
    }
    this.markConfigSynced(normalizedTarget);
    return added;
  }

  applyTargetStations(
    stations: Station[],
    opts: { targetCount?: number; preserveExistingVectors?: boolean } = {}
  ): { totalStations: number; preservedVectors: number } {
    this.load();
    const targetCount = resolveSeedSweetSpotCount(opts.targetCount);
    const preserve = opts.preserveExistingVectors !== false;
    const prevVectors = new Map<string, Float32Array>();
    if (preserve) {
      for (const entry of this.entries) {
        if (entry.vector) {
          prevVectors.set(entry.station.stationuuid, entry.vector);
        }
      }
    }

    const nextEntries: LoadedSeedEntry[] = [];
    const nextByUuid = new Map<string, LoadedSeedEntry>();
    let nextVecCount = 0;

    for (const station of stations) {
      if (nextEntries.length >= targetCount) break;
      if (!station?.stationuuid || nextByUuid.has(station.stationuuid)) continue;
      const vector = prevVectors.get(station.stationuuid) ?? null;
      if (vector) nextVecCount++;
      const entry: LoadedSeedEntry = {
        station,
        vector,
        searchHaystack: buildStationSearchHaystack(station),
      };
      nextEntries.push(entry);
      nextByUuid.set(station.stationuuid, entry);
    }

    this.entries = nextEntries;
    this.byUuid = nextByUuid;
    this.vectorCount = nextVecCount;
    this.markConfigSynced(targetCount);
    return { totalStations: nextEntries.length, preservedVectors: nextVecCount };
  }

  markConfigSynced(targetCount = resolveSeedSweetSpotCount()): void {
    this.fileModel = SEED_EMBEDDING_MODEL;
    this.fileDim = SEED_EMBEDDING_DIM;
    this.fileTargetCount = targetCount;
    this.fileDescriptorVersion = SEED_DESCRIPTOR_VERSION;
    this.fileConfigHash = computeSeedConfigHash({ targetCount });
    this.generatedAt = new Date().toISOString();
  }

  getMissingVectorStations(): Station[] {
    this.load();
    const missing: Station[] = [];
    for (const entry of this.entries) {
      if (!entry.vector) missing.push(entry.station);
    }
    return missing;
  }

  getAllEntries(): LoadedSeedEntry[] {
    this.load();
    return this.entries;
  }

  exportSeedFile(targetCountOverride?: number): SeedIndexFile {
    this.load();
    const targetCount = resolveSeedSweetSpotCount(targetCountOverride ?? this.fileTargetCount);
    return {
      version: 1,
      model: SEED_EMBEDDING_MODEL,
      dim: SEED_EMBEDDING_DIM,
      generatedAt: this.generatedAt || new Date().toISOString(),
      targetCount,
      descriptorVersion: SEED_DESCRIPTOR_VERSION,
      configHash: computeSeedConfigHash({ targetCount }),
      items: this.entries.map((entry) =>
        entry.vector
          ? { station: entry.station, vec: quantizeUnitVectorToBase64(entry.vector) }
          : { station: entry.station }
      ),
    };
  }

  /** Fast brute-force cosine search across all bundled seed stations with vectors. */
  searchTopMatches(
    queryVector: Float32Array,
    opts: { limit?: number; httpsOnly?: boolean; excludeUuid?: string; countryCodes?: string[] } = {}
  ): Array<{ station: Station; similarity: number }> {
    this.load();
    if (this.vectorCount === 0) return [];

    const limit = opts.limit ?? 24;
    const httpsOnly = Boolean(opts.httpsOnly);
    const excludeUuid = opts.excludeUuid;
    const countrySet =
      opts.countryCodes && opts.countryCodes.length > 0
        ? new Set(opts.countryCodes.map((c) => c.trim().toUpperCase()).filter((c) => c.length === 2))
        : null;

    const scored: Array<{ station: Station; similarity: number }> = [];
    for (const entry of this.entries) {
      if (!entry.vector) continue;
      const st = entry.station;
      if (excludeUuid && st.stationuuid === excludeUuid) continue;
      if (countrySet && !countrySet.has((st.countrycode || '').trim().toUpperCase())) continue;
      const streamUrl = (st.url_resolved || st.url || '').trim();
      if (!streamUrl || !/^https?:\/\//i.test(streamUrl)) continue;
      if (httpsOnly && !/^https:\/\//i.test(streamUrl)) continue;
      if (st.lastcheckok === 0) continue;

      const sim = cosineUnitSimilarity(queryVector, entry.vector);
      scored.push({ station: st, similarity: sim });
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit);
  }

  /** Fast lexical/tag/country fallback search across all bundled seed stations (works with or without pre-computed vectors). */
  searchMetadataCandidates(
    terms: string[],
    opts: {
      limit?: number;
      httpsOnly?: boolean;
      excludeUuid?: string;
      countryCodes?: string[];
      requireCountryMatch?: boolean;
    } = {}
  ): Station[] {
    this.load();
    if (this.entries.length === 0) return [];

    const limit = opts.limit ?? 30;
    const httpsOnly = Boolean(opts.httpsOnly);
    const excludeUuid = opts.excludeUuid;
    const cleanTerms = [
      ...new Set(
        terms
          .flatMap((t) => t.toLowerCase().split(/[\s,/|]+/))
          .map((w) => w.trim())
          .filter((w) => w.length >= 2)
      ),
    ];
    const countrySet = new Set(
      (opts.countryCodes ?? []).map((c) => c.trim().toUpperCase()).filter((c) => c.length === 2)
    );
    const requireCountry = Boolean(opts.requireCountryMatch && countrySet.size > 0);

    const scored: Array<{ station: Station; score: number }> = [];
    for (const entry of this.entries) {
      const st = entry.station;
      if (excludeUuid && st.stationuuid === excludeUuid) continue;
      const code = (st.countrycode || '').trim().toUpperCase();
      const inCountrySet = countrySet.size > 0 && countrySet.has(code);
      if (requireCountry && !inCountrySet) continue;

      const streamUrl = (st.url_resolved || st.url || '').trim();
      if (!streamUrl || !/^https?:\/\//i.test(streamUrl)) continue;
      if (httpsOnly && !/^https:\/\//i.test(streamUrl)) continue;
      if (st.lastcheckok === 0) continue;

      const haystack = entry.searchHaystack;
      let matchScore = 0;
      for (const term of cleanTerms) {
        if (haystack.includes(term)) {
          matchScore += st.tags.toLowerCase().includes(term) ? 3 : 2;
        }
      }
      if (inCountrySet) {
        matchScore += 8;
      }
      const popBoost = Math.min(1.5, Math.log10(Math.max(10, st.clickcount || 10)) / 4);
      scored.push({ station: st, score: matchScore + popBoost * 0.25 });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((item) => item.station);
  }
}

export const seedIndexStore = new SeedIndexStore();

