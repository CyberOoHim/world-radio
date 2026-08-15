import { DEFAULT_EQ_BANDS, type EqBands } from './equalizer';
import type { AppPrefs, SortId, Station, TagPlaybackBehavior, TimeOfDayMode, ViewId } from './types';

const FAV_KEY = 'world-radio:favorites';
const RECENT_KEY = 'world-radio:recent';
const VOLUME_KEY = 'world-radio:volume';
const MUTE_KEY = 'world-radio:muted';
const LAST_KEY = 'world-radio:last-station';
const PREFS_KEY = 'world-radio:prefs';

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function toCoord(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function sanitizeStation(raw: unknown): Station | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (!isNonEmptyString(s.stationuuid)) return null;
  const name = typeof s.name === 'string' ? s.name : '';
  const url = typeof s.url === 'string' ? s.url : '';
  const url_resolved = typeof s.url_resolved === 'string' ? s.url_resolved : url;
  return {
    changeuuid: typeof s.changeuuid === 'string' ? s.changeuuid : '',
    stationuuid: s.stationuuid,
    name,
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
    votes: typeof s.votes === 'number' ? s.votes : 0,
    codec: typeof s.codec === 'string' ? s.codec : '',
    bitrate: typeof s.bitrate === 'number' ? s.bitrate : 0,
    lastcheckok: typeof s.lastcheckok === 'number' ? s.lastcheckok : 0,
    clickcount: typeof s.clickcount === 'number' ? s.clickcount : 0,
    clicktrend: typeof s.clicktrend === 'number' ? s.clicktrend : 0,
    geo_lat: toCoord(s.geo_lat),
    geo_long: toCoord(s.geo_long),
    geo_distance: typeof s.geo_distance === 'number' && Number.isFinite(s.geo_distance) ? s.geo_distance : null,
    group:
      typeof s.group === 'string' && s.group.trim()
        ? s.group.trim().slice(0, 40)
        : undefined,
  };
}

/** Slim snapshot for favorites/last-played (same shape as Station for simplicity). */
export function toSnapshot(station: Station): Station {
  return sanitizeStation(station) ?? station;
}

export function loadFavorites(): Station[] {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // Migrate legacy UUID-only arrays
    if (parsed.every((x) => typeof x === 'string')) {
      return (parsed as string[]).map((id) => ({
        changeuuid: '',
        stationuuid: id,
        name: 'Saved station',
        url: '',
        url_resolved: '',
        homepage: '',
        favicon: '',
        tags: '',
        country: '',
        countrycode: '',
        state: '',
        language: '',
        languagecodes: '',
        votes: 0,
        codec: '',
        bitrate: 0,
        lastcheckok: 0,
        clickcount: 0,
        clicktrend: 0,
        geo_lat: null,
        geo_long: null,
        group: undefined,
      }));
    }

    return parsed
      .map(sanitizeStation)
      .filter((s): s is Station => s != null)
      .slice(0, 200);
  } catch {
    return [];
  }
}

export function saveFavorites(stations: Station[]): void {
  try {
    localStorage.setItem(
      FAV_KEY,
      JSON.stringify(stations.map(toSnapshot).slice(0, 200))
    );
  } catch {
    // Quota / private mode
  }
}

export function loadRecent(): Station[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeStation)
      .filter((s): s is Station => s != null)
      .slice(0, 40);
  } catch {
    return [];
  }
}

export function saveRecent(stations: Station[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(stations.slice(0, 40)));
  } catch {
    // Quota / private mode
  }
}

export function loadVolume(): number {
  try {
    const v = localStorage.getItem(VOLUME_KEY);
    if (v == null) return 0.75;
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.75;
  } catch {
    return 0.75;
  }
}

export function saveVolume(v: number): void {
  try {
    localStorage.setItem(VOLUME_KEY, String(v));
  } catch {
    // Quota / private mode
  }
}

export function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // Quota / private mode
  }
}

export function loadLastStation(): Station | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    return sanitizeStation(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveLastStation(station: Station | null): void {
  try {
    if (!station) {
      localStorage.removeItem(LAST_KEY);
      return;
    }
    localStorage.setItem(LAST_KEY, JSON.stringify(toSnapshot(station)));
  } catch {
    // Quota / private mode
  }
}

const DEFAULT_PREFS: AppPrefs = {
  httpsOnly: true,
  tagPlaybackBehavior: 'keep',
  randomAllGenres: false,
  isRandomGenre: false,
  sort: 'clickcount',
  timeOfDayMode: 'auto',
  selectedTag: null,
  selectedCountry: null,
  continentFilter: null,
  languageFilter: null,
  browseFilter: '',
  view: 'discover',
  favoriteGroupFilter: null,
};

function sanitizeTimeOfDayMode(v: unknown): TimeOfDayMode {
  if (
    v === 'auto' ||
    v === 'morning' ||
    v === 'day' ||
    v === 'evening' ||
    v === 'night'
  ) {
    return v;
  }
  return DEFAULT_PREFS.timeOfDayMode;
}

export function loadPrefs(): AppPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<AppPrefs>;
    const sort = (parsed.sort as SortId) || DEFAULT_PREFS.sort;
    const view = (parsed.view as ViewId) || DEFAULT_PREFS.view;
    const tagPlaybackBehavior = parsed.tagPlaybackBehavior as TagPlaybackBehavior | undefined;
    return {
      httpsOnly:
        typeof parsed.httpsOnly === 'boolean'
          ? parsed.httpsOnly
          : DEFAULT_PREFS.httpsOnly,
      tagPlaybackBehavior:
        tagPlaybackBehavior === 'first' || tagPlaybackBehavior === 'random' || tagPlaybackBehavior === 'keep'
          ? tagPlaybackBehavior
          : DEFAULT_PREFS.tagPlaybackBehavior,
      randomAllGenres:
        typeof parsed.randomAllGenres === 'boolean'
          ? parsed.randomAllGenres
          : DEFAULT_PREFS.randomAllGenres,
      isRandomGenre:
        typeof parsed.isRandomGenre === 'boolean'
          ? parsed.isRandomGenre
          : DEFAULT_PREFS.isRandomGenre,
      sort:
        sort === 'votes' ||
        sort === 'name' ||
        sort === 'bitrate' ||
        sort === 'clicktrend' ||
        sort === 'random' ||
        sort === 'clickcount'
          ? sort
          : DEFAULT_PREFS.sort,
      timeOfDayMode: sanitizeTimeOfDayMode(parsed.timeOfDayMode),
      selectedTag:
        typeof parsed.selectedTag === 'string' ? parsed.selectedTag : null,
      selectedCountry:
        typeof parsed.selectedCountry === 'string' ? parsed.selectedCountry : null,
      continentFilter:
        typeof parsed.continentFilter === 'string' ? parsed.continentFilter : null,
      languageFilter:
        typeof parsed.languageFilter === 'string' ? parsed.languageFilter : null,
      browseFilter:
        typeof parsed.browseFilter === 'string' ? parsed.browseFilter : '',
      view:
        view === 'discover' ||
        view === 'map' ||
        view === 'countries' ||
        view === 'genres' ||
        view === 'favorites' ||
        view === 'recent' ||
        view === 'search'
          ? view
          : DEFAULT_PREFS.view,
      favoriteGroupFilter:
        typeof parsed.favoriteGroupFilter === 'string' && parsed.favoriteGroupFilter.trim()
          ? parsed.favoriteGroupFilter.trim().slice(0, 40)
          : null,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: AppPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Quota / private mode
  }
}

export function exportFavoritesJson(stations: Station[]): string {
  return JSON.stringify(
    {
      app: 'world-radio',
      version: 2,
      exportedAt: new Date().toISOString(),
      favorites: stations.map(toSnapshot),
    },
    null,
    2
  );
}

export function importFavoritesJson(raw: string): Station[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    const list = Array.isArray(obj.favorites)
      ? obj.favorites
      : Array.isArray(parsed)
        ? parsed
        : null;
    if (!list) return null;
    const stations = list
      .map(sanitizeStation)
      .filter((s): s is Station => s != null);
    return stations.length ? stations : null;
  } catch {
    return null;
  }
}


export interface FxStatePrefs {
  enabled: boolean;
  presetId: string | null;
  customFx: Record<string, number>;
}

const FX_STATE_KEY = 'world-radio:fx-state';

export function loadFxState(): FxStatePrefs {
  try {
    const raw = localStorage.getItem(FX_STATE_KEY);
    if (!raw) return { enabled: false, presetId: 'radio', customFx: {} };
    const parsed = JSON.parse(raw);
    return {
      enabled: Boolean(parsed.enabled),
      presetId: typeof parsed.presetId === 'string' ? parsed.presetId : 'radio',
      customFx: typeof parsed.customFx === 'object' && parsed.customFx ? parsed.customFx : {},
    };
  } catch {
    return { enabled: false, presetId: 'radio', customFx: {} };
  }
}

export function saveFxState(fxState: FxStatePrefs): void {
  try {
    localStorage.setItem(FX_STATE_KEY, JSON.stringify(fxState));
  } catch {
    // Quota / private mode
  }
}

export interface EqStatePrefs {
  enabled: boolean;
  presetId: string;
  bands: EqBands;
}

const EQ_STATE_KEY = 'world-radio:eq-state';
const BAND_KEYS: (keyof EqBands)[] = ['b60', 'b150', 'b400', 'b1k', 'b2k5', 'b6k', 'b10k', 'b16k'];

function clampDb(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-12, Math.min(12, n));
}

export function sanitizeEqBands(raw: unknown): EqBands {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const bands = { ...DEFAULT_EQ_BANDS };
  for (const key of BAND_KEYS) {
    bands[key] = clampDb(src[key]);
  }
  return bands;
}

export function loadEqState(): EqStatePrefs {
  try {
    const raw = localStorage.getItem(EQ_STATE_KEY);
    if (!raw) return { enabled: false, presetId: 'flat', bands: { ...DEFAULT_EQ_BANDS } };
    const parsed = JSON.parse(raw);
    return {
      enabled: Boolean(parsed.enabled),
      presetId: typeof parsed.presetId === 'string' ? parsed.presetId : 'flat',
      bands: sanitizeEqBands(parsed.bands),
    };
  } catch {
    return { enabled: false, presetId: 'flat', bands: { ...DEFAULT_EQ_BANDS } };
  }
}

export function saveEqState(eqState: EqStatePrefs): void {
  try {
    localStorage.setItem(EQ_STATE_KEY, JSON.stringify(eqState));
  } catch {}
}

export interface CustomEqPreset {
  id: string;
  name: string;
  bands: EqBands;
}

const CUSTOM_EQ_PRESETS_KEY = 'world-radio:custom-eq-presets';

export function sanitizeCustomEqPreset(raw: unknown): CustomEqPreset | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id : '';
  if (!id.startsWith('custom-') || id.length > 80) return null;
  const name =
    typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 40) : 'Custom Preset';
  return { id, name, bands: sanitizeEqBands(o.bands) };
}

export function loadCustomEqPresets(): CustomEqPreset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_EQ_PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: CustomEqPreset[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      const preset = sanitizeCustomEqPreset(item);
      if (!preset || seen.has(preset.id)) continue;
      seen.add(preset.id);
      out.push(preset);
      if (out.length >= 24) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function saveCustomEqPresets(presets: CustomEqPreset[]): void {
  try {
    const clean = presets
      .map(sanitizeCustomEqPreset)
      .filter((p): p is CustomEqPreset => p != null)
      .slice(0, 24);
    localStorage.setItem(CUSTOM_EQ_PRESETS_KEY, JSON.stringify(clean));
  } catch {}
}


