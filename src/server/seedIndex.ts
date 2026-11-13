import fs from 'node:fs';
import path from 'node:path';
import type { Station } from '../types.ts';

export const SEED_EMBEDDING_DIM = 768;
export const SEED_SWEET_SPOT_COUNT = 2500;

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
  items: SeedStationItem[];
}

export interface LoadedSeedEntry {
  station: Station;
  vector: Float32Array | null;
}

/** Build a dense, semantically rich text descriptor for embedding a radio station. */
export function buildStationDescriptor(station: Station): string {
  const parts: string[] = [];
  if (station.name) parts.push(`Station: ${station.name.trim()}`);
  if (station.country || station.countrycode) {
    const loc = [station.state, station.country || station.countrycode].filter(Boolean).join(', ');
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

/** Decode base64 Int8 vector back into an L2-normalized Float32Array. */
export function decodeBase64ToUnitVector(b64: string, expectedDim = SEED_EMBEDDING_DIM): Float32Array | null {
  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length !== expectedDim) return null;
    const raw = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
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
      this.generatedAt = typeof parsed.generatedAt === 'string' ? parsed.generatedAt : '';

      for (const item of parsed.items) {
        if (!item || typeof item !== 'object' || !item.station?.stationuuid) continue;
        const vec = typeof item.vec === 'string' && item.vec.length > 0
          ? decodeBase64ToUnitVector(item.vec, dim)
          : null;
        if (vec) this.vectorCount++;
        const entry: LoadedSeedEntry = { station: item.station, vector: vec };
        this.entries.push(entry);
        this.byUuid.set(item.station.stationuuid, entry);
      }
    } catch (err) {
      console.warn('Could not load bundled AI seed index:', err);
    }
  }

  getStats(): { totalStations: number; vectorCount: number; generatedAt: string } {
    this.load();
    return {
      totalStations: this.entries.length,
      vectorCount: this.vectorCount,
      generatedAt: this.generatedAt,
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

  exportSeedFile(): SeedIndexFile {
    this.load();
    return {
      version: 1,
      model: 'gemini-embedding-2',
      dim: SEED_EMBEDDING_DIM,
      generatedAt: this.generatedAt || new Date().toISOString(),
      items: this.entries.map((entry) =>
        entry.vector
          ? { station: entry.station, vec: quantizeUnitVectorToBase64(entry.vector) }
          : { station: entry.station }
      ),
    };
  }

  /** Fast <3ms brute-force cosine search across all bundled seed stations with vectors. */
  searchTopMatches(
    queryVector: Float32Array,
    opts: { limit?: number; httpsOnly?: boolean; excludeUuid?: string } = {}
  ): Array<{ station: Station; similarity: number }> {
    this.load();
    if (this.vectorCount === 0) return [];

    const limit = opts.limit ?? 24;
    const httpsOnly = Boolean(opts.httpsOnly);
    const excludeUuid = opts.excludeUuid;

    const scored: Array<{ station: Station; similarity: number }> = [];
    for (const entry of this.entries) {
      if (!entry.vector) continue;
      const st = entry.station;
      if (excludeUuid && st.stationuuid === excludeUuid) continue;
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

  /** Fast <2ms lexical/tag/country fallback search across all bundled seed stations (works with or without pre-computed vectors). */
  searchMetadataCandidates(
    terms: string[],
    opts: {
      limit?: number;
      httpsOnly?: boolean;
      excludeUuid?: string;
      countryCodes?: string[];
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

    const scored: Array<{ station: Station; score: number }> = [];
    for (const entry of this.entries) {
      const st = entry.station;
      if (excludeUuid && st.stationuuid === excludeUuid) continue;
      const streamUrl = (st.url_resolved || st.url || '').trim();
      if (!streamUrl || !/^https?:\/\//i.test(streamUrl)) continue;
      if (httpsOnly && !/^https:\/\//i.test(streamUrl)) continue;
      if (st.lastcheckok === 0) continue;

      const haystack = `${st.name} ${st.tags} ${st.country} ${st.state} ${st.language}`.toLowerCase();
      let matchScore = 0;
      for (const term of cleanTerms) {
        if (haystack.includes(term)) {
          matchScore += st.tags.toLowerCase().includes(term) ? 3 : 2;
        }
      }
      if (countrySet.size > 0 && countrySet.has((st.countrycode || '').toUpperCase())) {
        matchScore += 3;
      }
      const popBoost = Math.min(1.5, Math.log10(Math.max(10, st.clickcount || 10)) / 4);
      scored.push({ station: st, score: matchScore + popBoost * 0.25 });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((item) => item.station);
  }
}

export const seedIndexStore = new SeedIndexStore();
