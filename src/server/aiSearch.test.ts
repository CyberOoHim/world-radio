import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ThinkingLevel } from '@google/genai';
import {
  getDjNotesConfig,
  getPlannerConfig,
  handleAiSearchRequest,
  normalizeAiModel,
  normalizeThinkingLevel,
  resolveGeminiApiKey,
} from './aiSearch';
import { getJwtSecret, signJwt } from './auth';
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

describe('normalizeAiModel and normalizeThinkingLevel', () => {
  it('accepts gemini-flash-lite-latest and gemini-4-hydrogen and falls back to flash-lite-latest', () => {
    expect(normalizeAiModel('gemini-flash-lite-latest')).toBe('gemini-flash-lite-latest');
    expect(normalizeAiModel('gemini-4-hydrogen')).toBe('gemini-4-hydrogen');
    expect(normalizeAiModel('gemini-3.1-flash-lite')).toBe('gemini-flash-lite-latest');
    expect(normalizeAiModel('gemini-2.0-flash')).toBe('gemini-flash-lite-latest');
    expect(normalizeAiModel(undefined)).toBe('gemini-flash-lite-latest');
  });

  it('accepts low, medium, high and falls back to medium for unsupported levels', () => {
    expect(normalizeThinkingLevel('low')).toBe('low');
    expect(normalizeThinkingLevel('medium')).toBe('medium');
    expect(normalizeThinkingLevel('high')).toBe('high');
    expect(normalizeThinkingLevel('xhigh')).toBe('medium');
    expect(normalizeThinkingLevel('minimal')).toBe('medium');
    expect(normalizeThinkingLevel(undefined)).toBe('medium');
  });

  it('maps independent Station and DJ Note models and thinking levels cleanly', () => {
    expect(getPlannerConfig('gemini-flash-lite-latest', 'low')).toEqual({
      model: 'gemini-flash-lite-latest',
      thinkingLevel: ThinkingLevel.LOW,
    });
    expect(getPlannerConfig('gemini-flash-lite-latest', 'medium')).toEqual({
      model: 'gemini-flash-lite-latest',
      thinkingLevel: ThinkingLevel.MEDIUM,
    });
    expect(getPlannerConfig('gemini-4-hydrogen', 'high')).toEqual({
      model: 'gemini-4-hydrogen',
      thinkingLevel: ThinkingLevel.HIGH,
    });
    expect(getDjNotesConfig('gemini-flash-lite-latest', 'medium')).toEqual({
      model: 'gemini-flash-lite-latest',
      thinkingLevel: ThinkingLevel.MEDIUM,
    });
    expect(getDjNotesConfig('gemini-4-hydrogen', 'low')).toEqual({
      model: 'gemini-4-hydrogen',
      thinkingLevel: ThinkingLevel.LOW,
    });
    expect(getDjNotesConfig('gemini-4-hydrogen', 'high')).toEqual({
      model: 'gemini-4-hydrogen',
      thinkingLevel: ThinkingLevel.HIGH,
    });
  });
});

describe('resolveGeminiApiKey', () => {
  it('prefers GEMINI_API_KEY and falls back to GOOGLE_API_KEY or API_KEY while stripping quotes', () => {
    const prev = {
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
      API_KEY: process.env.API_KEY,
      GOOGLE_GEMINI_API_KEY: process.env.GOOGLE_GEMINI_API_KEY,
      GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    };

    try {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      delete process.env.API_KEY;
      delete process.env.GOOGLE_GEMINI_API_KEY;
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      expect(resolveGeminiApiKey()).toBe('');

      process.env.API_KEY = '  "key-from-api-key"  ';
      expect(resolveGeminiApiKey()).toBe('key-from-api-key');

      process.env.GOOGLE_API_KEY = 'key-from-google-api-key';
      expect(resolveGeminiApiKey()).toBe('key-from-google-api-key');

      process.env.GEMINI_API_KEY = "'key-from-gemini-api-key'";
      expect(resolveGeminiApiKey()).toBe('key-from-gemini-api-key');
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
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

  it('returns null when base64 vector length mismatches expected dimension or is all-zero', () => {
    expect(decodeBase64ToUnitVector('AAAA', SEED_EMBEDDING_DIM)).toBeNull();
    const zeroBytes = Buffer.alloc(SEED_EMBEDDING_DIM, 0).toString('base64');
    expect(decodeBase64ToUnitVector(zeroBytes, SEED_EMBEDDING_DIM)).toBeNull();
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

  it('rejects general-passcode JWTs (ai: false) with 403 AI_AUTH_REQUIRED', async () => {
    const generalToken = signJwt(
      {
        sub: 'authorized_user',
        role: 'listener',
        ai: false,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      getJwtSecret()
    );

    for (const target of [
      { url: '/api/ai/search', method: 'POST' },
      { url: '/api/ai/similar', method: 'POST' },
      { url: '/api/ai/dj-notes', method: 'POST' },
      { url: '/api/ai/seed-export', method: 'GET' },
    ]) {
      const req = {
        url: target.url,
        method: target.method,
        headers: { authorization: `Bearer ${generalToken}` },
      } as unknown as IncomingMessage;
      const mock = createMockRes();
      const handled = await handleAiSearchRequest(req, mock.res);
      expect(handled).toBe(true);
      expect(mock.res.statusCode).toBe(403);
      expect(JSON.parse(mock.getBody())).toEqual({
        error:
          'Forbidden: The general passcode does not authorize AI search. An AI passcode is required.',
        code: 'AI_AUTH_REQUIRED',
      });
    }
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
