import { getStoredAuthToken } from '../auth';
import { sanitizeStation } from '../storage';
import type { AiModelId, AiSearchResponse, AiThinkingLevel, Station } from '../types';

export class AiAuthError extends Error {
  code: string;
  constructor(message = 'Backend passcode required for AI search', code = 'AUTH_REQUIRED') {
    super(message);
    this.name = 'AiAuthError';
    this.code = code;
  }
}

export interface VibePreset {
  id: string;
  label: string;
  prompt: string;
}

export const AI_VIBE_PRESETS: VibePreset[] = [
  {
    id: 'tokyo-rain',
    label: 'Rainy Tokyo midnight jazz',
    prompt: 'Rainy midnight vinyl jazz bar in Tokyo with warm saxophone and gentle hiss',
  },
  {
    id: 'lisbon-cafe',
    label: 'Sunny Lisbon café acoustic',
    prompt: 'Sunny afternoon terrace in Lisbon with warm acoustic guitar, bossa, and Lusophone soul',
  },
  {
    id: 'highway-synth',
    label: '1980s coastal highway synth',
    prompt: '1980s late-night coastal highway drive with nostalgic synthwave and retro pop',
  },
  {
    id: 'deep-ambient',
    label: 'Deep-focus analog ambient',
    prompt: 'Distraction-free nocturnal ambient drones, gentle piano, and warm tape textures for deep focus',
  },
  {
    id: 'paris-espresso',
    label: 'Morning espresso & Parisian talk',
    prompt: 'Morning café in Paris with French cultural talk, chanson, and light acoustic jazz',
  },
  {
    id: 'buenos-aires',
    label: 'Buenos Aires late-night tango',
    prompt: 'Smoky Buenos Aires midnight salon playing classic tango, bandoneon, and Argentine folklore',
  },
  {
    id: 'ethio-jazz',
    label: '70s Addis Ababa Ethio-jazz',
    prompt: 'Hypnotic 1970s Ethio-jazz grooves, Afro-funk horns, and vintage East African rhythms',
  },
  {
    id: 'nordic-winter',
    label: 'Nordic winter cabin folk',
    prompt: 'Quiet Scandinavian winter evening with Nordic folk, cello, and atmospheric indie',
  },
];

export const AI_MODEL_OPTIONS: Array<{
  id: AiModelId;
  label: string;
  detail: string;
}> = [
  {
    id: 'gemini-flash-lite-latest',
    label: 'Flash Lite Latest',
    detail: 'Fast, lightweight curation',
  },
  {
    id: 'gemini-flash-latest',
    label: 'Flash Latest',
    detail: 'Richer reasoning & voice',
  },
];

export const AI_THINKING_OPTIONS: Array<{
  id: AiThinkingLevel;
  label: string;
  detail: string;
}> = [
  { id: 'low', label: 'Low · Fast', detail: 'Snappiest results' },
  { id: 'medium', label: 'Medium · Balanced', detail: 'Balanced depth & speed' },
  { id: 'high', label: 'High · Deep', detail: 'Richest vibe curation' },
];

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const token = getStoredAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

function normalizeAiResponse(raw: unknown): AiSearchResponse {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const stationsRaw = Array.isArray(obj.stations) ? obj.stations : [];
  const stations = stationsRaw
    .map((s) => sanitizeStation(s))
    .filter((s): s is Station => s != null);

  const djNotesRaw = obj.djNotes && typeof obj.djNotes === 'object'
    ? (obj.djNotes as Record<string, unknown>)
    : {};
  const djNotes: Record<string, string> = {};
  for (const [k, v] of Object.entries(djNotesRaw)) {
    if (typeof v === 'string' && v.trim()) djNotes[k] = v.trim();
  }

  const planTags = Array.isArray(obj.planTags)
    ? obj.planTags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    : [];

  const model: AiModelId =
    obj.model === 'gemini-flash-latest' ? 'gemini-flash-latest' : 'gemini-flash-lite-latest';

  const level = obj.thinkingLevel;
  const thinkingLevel: AiThinkingLevel =
    level === 'low' || level === 'medium' || level === 'high' ? level : 'low';

  const targetRegions = Array.isArray(obj.targetRegions)
    ? obj.targetRegions.filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
    : [];

  return {
    headline: typeof obj.headline === 'string' ? obj.headline : 'Curated Frequencies',
    intro: typeof obj.intro === 'string' ? obj.intro : '',
    stations,
    djNotes,
    planTags,
    usedSeedIndex: Boolean(obj.usedSeedIndex),
    seedCount: typeof obj.seedCount === 'number' ? obj.seedCount : 0,
    model,
    thinkingLevel,
    usedReranker: typeof obj.usedReranker === 'boolean' ? obj.usedReranker : undefined,
    targetRegions,
  };
}

export async function aiSearchStations(params: {
  query: string;
  model: AiModelId;
  thinkingLevel: AiThinkingLevel;
  httpsOnly: boolean;
  useReranker?: boolean;
  signal?: AbortSignal;
}): Promise<AiSearchResponse> {
  const res = await fetch('/api/ai/search', {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'same-origin',
    signal: params.signal,
    body: JSON.stringify({
      query: params.query,
      model: params.model,
      thinkingLevel: params.thinkingLevel,
      httpsOnly: params.httpsOnly,
      useReranker: params.useReranker ?? true,
    }),
  });

  if (res.status === 401 || res.status === 403) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new AiAuthError(
      errBody.error || 'Passcode unlock is required for AI Station Search.',
      errBody.code || (res.status === 403 ? 'AI_AUTH_REQUIRED' : 'AUTH_REQUIRED')
    );
  }

  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `AI search failed (${res.status})`);
  }

  return normalizeAiResponse(data);
}

export async function aiFindSimilarStations(params: {
  station: Station;
  model: AiModelId;
  thinkingLevel: AiThinkingLevel;
  httpsOnly: boolean;
  useReranker?: boolean;
  signal?: AbortSignal;
}): Promise<AiSearchResponse> {
  const res = await fetch('/api/ai/similar', {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'same-origin',
    signal: params.signal,
    body: JSON.stringify({
      station: params.station,
      model: params.model,
      thinkingLevel: params.thinkingLevel,
      httpsOnly: params.httpsOnly,
      useReranker: params.useReranker ?? true,
    }),
  });

  if (res.status === 401 || res.status === 403) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new AiAuthError(
      errBody.error || 'Passcode unlock is required to find similar stations.',
      errBody.code || (res.status === 403 ? 'AI_AUTH_REQUIRED' : 'AUTH_REQUIRED')
    );
  }

  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Similar station search failed (${res.status})`);
  }

  return normalizeAiResponse(data);
}

export async function aiFetchDjNotes(params: {
  query?: string;
  seedStation?: Station | null;
  stations: Station[];
  notesModel: AiModelId;
  notesThinkingLevel: AiThinkingLevel;
  httpsOnly: boolean;
  signal?: AbortSignal;
}): Promise<Record<string, string>> {
  const res = await fetch('/api/ai/dj-notes', {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'same-origin',
    signal: params.signal,
    body: JSON.stringify({
      query: params.query,
      seedStation: params.seedStation ?? undefined,
      stations: params.stations,
      notesModel: params.notesModel,
      notesThinkingLevel: params.notesThinkingLevel,
      httpsOnly: params.httpsOnly,
    }),
  });

  if (!res.ok) {
    return {};
  }

  const data = (await res.json().catch(() => ({}))) as { djNotes?: Record<string, unknown> };
  const raw = data?.djNotes && typeof data.djNotes === 'object' ? data.djNotes : {};
  const djNotes: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string' && v.trim()) {
      djNotes[k] = v.trim();
    }
  }
  return djNotes;
}
