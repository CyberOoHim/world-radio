import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { normalizeThinkingLevel, handleAiSearchRequest } from './aiSearch';
import {
  SEED_EMBEDDING_DIM,
  SeedIndexStore,
  buildStationDescriptor,
  cosineUnitSimilarity,
  decodeBase64ToUnitVector,
  quantizeUnitVectorToBase64,
} from './seedIndex';
import type { Station } from '../types';

function createMockRes() {
  const headers: Record<string, string> = {};
  let body = '';
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    end(chunk?: string | Buffer) {
      if (chunk) body += chunk.toString();
    },
  } as unknown as ServerResponse;
  return {
    res,
    headers,
    getBody: () => body,
  };
}

describe('normalizeThinkingLevel', () => {
  it('accepts low, medium, high and falls back to high for unsupported levels', () => {
    expect(normalizeThinkingLevel('low')).toBe('low');
    expect(normalizeThinkingLevel('medium')).toBe('medium');
    expect(normalizeThinkingLevel('high')).toBe('high');
    expect(normalizeThinkingLevel('xhigh')).toBe('high');
    expect(normalizeThinkingLevel('minimal')).toBe('high');
    expect(normalizeThinkingLevel(undefined)).toBe('high');
  });
});

describe('seedIndex vector quantization & descriptors', () => {
  it('roundtrips Int8 quantized unit vectors while preserving cosine direction', () => {
    const raw = Array.from({ length: SEED_EMBEDDING_DIM }, (_, i) => Math.sin(i * 0.17));
    const b64 = quantizeUnitVectorToBase64(raw);
    const decoded = decodeBase64ToUnitVector(b64, SEED_EMBEDDING_DIM);
    expect(decoded).not.toBeNull();
    expect(decoded?.length).toBe(SEED_EMBEDDING_DIM);

    // Self-similarity should be ~1.0
    const selfSim = cosineUnitSimilarity(decoded!, decoded!);
    expect(selfSim).toBeCloseTo(1, 3);

    // Negated vector should have similarity ~ -1.0
    const negB64 = quantizeUnitVectorToBase64(raw.map((v) => -v));
    const negDecoded = decodeBase64ToUnitVector(negB64, SEED_EMBEDDING_DIM);
    expect(cosineUnitSimilarity(decoded!, negDecoded!)).toBeCloseTo(-1, 3);
  });

  it('returns null when base64 vector length mismatches expected dimension', () => {
    expect(decodeBase64ToUnitVector('AAAA', SEED_EMBEDDING_DIM)).toBeNull();
  });

  it('builds clean station text descriptors', () => {
    const station: Station = {
      changeuuid: '',
      stationuuid: 'st-1',
      name: 'Midnight Tokyo Jazz',
      url: 'https://example.com/stream',
      url_resolved: 'https://example.com/stream',
      homepage: '',
      favicon: '',
      tags: 'jazz, lounge, vinyl',
      country: 'Japan',
      countrycode: 'JP',
      state: 'Tokyo',
      language: 'japanese',
      languagecodes: 'ja',
      votes: 120,
      codec: 'AAC',
      bitrate: 192,
      lastcheckok: 1,
      clickcount: 450,
      clicktrend: 12,
      geo_lat: 35.68,
      geo_long: 139.77,
    };
    const desc = buildStationDescriptor(station);
    expect(desc).toContain('Station: Midnight Tokyo Jazz');
    expect(desc).toContain('Location: Tokyo, Japan');
    expect(desc).toContain('Genres & Moods: jazz, lounge, vinyl');
    expect(desc).toContain('Audio: AAC 192kbps');
  });

  it('finds metadata candidates from bundled stations even without pre-computed vectors', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-test-'));
    const seedPath = path.join(tmpDir, 'seed.json');
    const makeStation = (id: string, name: string, tags: string, countrycode: string): Station => ({
      changeuuid: '',
      stationuuid: id,
      name,
      url: `https://example.com/${id}`,
      url_resolved: `https://example.com/${id}`,
      homepage: '',
      favicon: '',
      tags,
      country: countrycode === 'JP' ? 'Japan' : 'France',
      countrycode,
      state: '',
      language: '',
      languagecodes: '',
      votes: 50,
      codec: 'MP3',
      bitrate: 128,
      lastcheckok: 1,
      clickcount: 200,
      clicktrend: 5,
      geo_lat: null,
      geo_long: null,
    });

    fs.writeFileSync(
      seedPath,
      JSON.stringify({
        version: 1,
        model: 'gemini-embedding-2',
        dim: SEED_EMBEDDING_DIM,
        generatedAt: '2026-01-01T00:00:00Z',
        items: [
          { station: makeStation('s1', 'Tokyo Rain Jazz', 'jazz, sax, midnight', 'JP') },
          { station: makeStation('s2', 'Paris Electro Club', 'house, techno', 'FR') },
        ],
      })
    );

    const store = new SeedIndexStore();
    store.load(seedPath);
    const hits = store.searchMetadataCandidates(['jazz', 'midnight'], {
      limit: 5,
      httpsOnly: true,
      countryCodes: ['JP'],
    });
    expect(hits[0]?.stationuuid).toBe('s1');

    const unitVec = new Float32Array(SEED_EMBEDDING_DIM);
    unitVec[0] = 1;
    store.setVector('s1', unitVec);
    const exported = store.exportSeedFile();
    expect(exported.items.find((i) => i.station.stationuuid === 's1')?.vec).toBeTruthy();
    expect(exported.items.find((i) => i.station.stationuuid === 's2')?.vec).toBeUndefined();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('handleAiSearchRequest', () => {
  it('ignores non-AI routes', async () => {
    const req = { url: '/api/health', method: 'GET', headers: {} } as unknown as IncomingMessage;
    const { res } = createMockRes();
    const handled = await handleAiSearchRequest(req, res);
    expect(handled).toBe(false);
  });

  it('rejects unauthenticated requests with 401 AUTH_REQUIRED', async () => {
    const req = {
      url: '/api/ai/search',
      method: 'POST',
      headers: {},
    } as unknown as IncomingMessage;
    const mock = createMockRes();
    const handled = await handleAiSearchRequest(req, mock.res);
    expect(handled).toBe(true);
    expect(mock.res.statusCode).toBe(401);
    expect(JSON.parse(mock.getBody())).toEqual({
      error: 'Unauthorized: Passcode authentication required',
      code: 'AUTH_REQUIRED',
    });
  });

  it('rejects unauthenticated GET /api/ai/seed-export with 401 AUTH_REQUIRED', async () => {
    const req = {
      url: '/api/ai/seed-export?hydrate=1',
      method: 'GET',
      headers: {},
    } as unknown as IncomingMessage;
    const mock = createMockRes();
    const handled = await handleAiSearchRequest(req, mock.res);
    expect(handled).toBe(true);
    expect(mock.res.statusCode).toBe(401);
  });

  it('rejects non-POST methods with 405', async () => {
    const req = {
      url: '/api/ai/search',
      method: 'GET',
      headers: {},
    } as unknown as IncomingMessage;
    const mock = createMockRes();
    const handled = await handleAiSearchRequest(req, mock.res);
    expect(handled).toBe(true);
    expect(mock.res.statusCode).toBe(405);
  });
});
