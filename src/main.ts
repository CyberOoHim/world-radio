import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/instrument-serif/400.css';
import './style.css';

import {
  CONTINENTS,
  MOOD_TAGS,
  TIME_OF_DAY_PERIODS,
  getCountries,
  getLanguages,
  getRandomStations,
  getStationsByCountry,
  getStationsByTag,
  getStationsByUuid,
  getStationsByUuids,
  getStationsNear,
  getTags,
  getTopStations,
  isLikelyPlayable,
  resolveTimeOfDayPeriod,
  searchStations,
  timeOfDayMoods,
  timeOfDayPeriodLabel,
  type SearchParams,
} from './api/radioBrowser';
import { updateMediaSession } from './mediaSession';
import { player } from './player';
import { parseHash, setHash, stationShareUrl } from './router';
import { formatSleepRemaining, sleepTimer } from './sleepTimer';
import {
  exportFavoritesJson,
  importFavoritesJson,
  loadFavorites,
  loadLastStation,
  loadPrefs,
  loadRecent,
  loadVolume,
  saveFavorites,
  saveLastStation,
  savePrefs,
  saveRecent,
  saveVolume,
  toSnapshot,
} from './storage';
import type {
  AppState,
  Country,
  SleepMinutes,
  SortId,
  Station,
  TimeOfDayMode,
  ViewId,
} from './types';

const PAGE = 48;
const SLEEP_OPTIONS: SleepMinutes[] = [15, 30, 45, 60, 90];
const SORT_OPTIONS: { id: SortId; label: string }[] = [
  { id: 'clickcount', label: 'Popular' },
  { id: 'clicktrend', label: 'Trending' },
  { id: 'votes', label: 'Votes' },
  { id: 'name', label: 'Name' },
  { id: 'bitrate', label: 'Bitrate' },
  { id: 'random', label: 'Random' },
];

const prefs = loadPrefs();

const state: AppState = {
  view: 'discover',
  stations: [],
  countries: [],
  tags: [],
  languages: [],
  favorites: loadFavorites(),
  recent: loadRecent(),
  current: loadLastStation(),
  loading: true,
  loadingMore: false,
  error: null,
  query: '',
  selectedCountry: null,
  selectedTag: null,
  volume: loadVolume(),
  muted: false,
  offset: 0,
  hasMore: true,
  continentFilter: null,
  browseFilter: '',
  sort: prefs.sort,
  languageFilter: null,
  httpsOnly: prefs.httpsOnly,
  detailStation: null,
  toast: null,
  nearMe: false,
  userLat: null,
  userLon: null,
  timeOfDayMode: prefs.timeOfDayMode,
};

let searchTimer: ReturnType<typeof setTimeout> | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let navOpen = false;
let sleepMenuOpen = false;
let totalStationHint = 0;
let loadSeq = 0;
let eventsBound = false;
let shellBuilt = false;
let applyingRoute = false;
let infiniteObserver: IntersectionObserver | null = null;
/** Guards concurrent Surprise Me runs; bumped to cancel in-flight retries. */
let surpriseSeq = 0;
let surpriseBusy = false;

const SURPRISE_BATCH = 16;
const SURPRISE_MAX_TRIES = 6;
const SURPRISE_PLAY_TIMEOUT_MS = 10_000;

// ─── Icons ───────────────────────────────────────────────

const icons = {
  // Retro chunky set: thick strokes, geometric forms, vintage radio brand mark
  radio: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"><rect x="3" y="9" width="18" height="12" rx="2"/><path d="M7 5v4M7 5h2"/><path d="M14 5l4-2" opacity=".85"/><path d="M16 4c1.2.8 2 2 2.2 3.2" opacity=".7"/><circle cx="9" cy="15" r="2.5"/><circle cx="16" cy="14" r="2"/><path d="M15 17h2M18 17h1"/></svg>`,
  discover: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"><circle cx="12" cy="12" r="9"/><path d="M15 9l-2.5 6.5L9 13z" fill="currentColor" stroke="none"/></svg>`,
  globe: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.8 4 5.8 4 9s-1.5 6.2-4 9c-2.5-2.8-4-5.8-4-9s1.5-6.2 4-9z"/></svg>`,
  music: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"><path d="M9 18V5l11-2v13"/><circle cx="7" cy="18" r="3" fill="currentColor" stroke="none"/><circle cx="17" cy="16" r="3" fill="currentColor" stroke="none"/><path d="M9 8l11-2"/></svg>`,
  heart: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"><path d="M12 20l-7-7a4.5 4.5 0 017-5.5 4.5 4.5 0 017 5.5l-7 7z"/></svg>`,
  heartFill: `<svg class="icon" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter"><path d="M12 20l-7-7a4.5 4.5 0 017-5.5 4.5 4.5 0 017 5.5l-7 7z"/></svg>`,
  clock: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2.5"/></svg>`,
  search: `<svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>`,
  play: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="5" height="16" rx="0.5"/><rect x="14" y="4" width="5" height="16" rx="0.5"/></svg>`,
  prev: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="3" height="16"/><path d="M19 5v14L8 12l11-7z"/></svg>`,
  next: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="17" y="4" width="3" height="16"/><path d="M5 5v14l11-7L5 5z"/></svg>`,
  volume: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" width="20" height="20"><path d="M3 10v4h3l5 4V6L6 10H3z" fill="currentColor" stroke="none"/><path d="M16 9v6M19 7v10"/></svg>`,
  mute: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" width="20" height="20"><path d="M3 10v4h3l5 4V6L6 10H3z" fill="currentColor" stroke="none"/><path d="M17 10l5 5M22 10l-5 5"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`,
  loader: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="22" height="22" stroke-linecap="square"><rect x="3" y="3" width="18" height="18" rx="2" opacity=".25"/><path d="M12 3h9v9"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" width="18" height="18"><path d="M16 3a8 8 0 108 8 6.5 6.5 0 01-8-8z"/></svg>`,
  share: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" width="18" height="18"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.4 13.2l7.2 4.1M15.6 6.7l-7.2 4.1"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square" width="20" height="20"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  surprise: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" width="18" height="18"><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/><rect x="9" y="9" width="6" height="6" fill="currentColor" stroke="none"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" width="16" height="16"><path d="M12 21s6.5-5 6.5-10a6.5 6.5 0 10-13 0c0 5 6.5 10 6.5 10z"/><circle cx="12" cy="11" r="2.2" fill="currentColor" stroke="none"/></svg>`,
  external: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" width="16" height="16"><path d="M14 4h6v6M20 4l-9 9"/><path d="M10 6H5a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1v-5"/></svg>`,
};

// ─── Helpers ─────────────────────────────────────────────

function countryFlag(code: string): string {
  if (!code || code.length !== 2) return '🌐';
  const cc = code.toUpperCase();
  return String.fromCodePoint(...[...cc].map((c) => 127397 + c.charCodeAt(0)));
}

function formatTags(tags: string, max = 3): string[] {
  if (!tags) return [];
  return tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, max);
}

function escapeHtml(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function titleCaseTag(name: string): string {
  return name
    .split(/[\s_-]+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ''))
    .join(' ');
}

function isFav(id: string): boolean {
  return state.favorites.some((s) => s.stationuuid === id);
}

function showToast(msg: string, ms = 2600) {
  state.toast = msg;
  if (toastTimer) clearTimeout(toastTimer);
  renderToast();
  toastTimer = setTimeout(() => {
    state.toast = null;
    renderToast();
  }, ms);
}

function persistPrefs() {
  savePrefs({
    httpsOnly: state.httpsOnly,
    sort: state.sort,
    timeOfDayMode: state.timeOfDayMode,
  });
}

function applyMute(muted: boolean) {
  state.muted = muted;
  player.setMuted(muted, { silent: true });
  player.setVolume(state.volume);
  updatePlaybackUI();
}

function applyVolume(v: number) {
  state.volume = Math.min(1, Math.max(0, v));
  state.muted = state.volume === 0;
  player.setVolume(state.volume);
  player.setMuted(state.muted, { silent: true });
  saveVolume(state.volume);
}

function listQueryExtras(): SearchParams {
  const extra: SearchParams = {};
  if (state.languageFilter) extra.language = state.languageFilter;
  if (state.httpsOnly) extra.is_https = true;
  if (state.sort === 'random') {
    extra.order = 'random';
    extra.reverse = false;
  } else if (state.sort === 'name') {
    extra.order = 'name';
    extra.reverse = false;
  } else {
    extra.order = state.sort;
    extra.reverse = true;
  }
  return extra;
}

function toggleFavorite(station: Station) {
  if (isFav(station.stationuuid)) {
    state.favorites = state.favorites.filter((s) => s.stationuuid !== station.stationuuid);
    showToast('Removed from favorites');
  } else {
    state.favorites = [toSnapshot(station), ...state.favorites.filter((s) => s.stationuuid !== station.stationuuid)];
    showToast('Added to favorites');
  }
  saveFavorites(state.favorites);
  renderNav();
  renderMain();
  updatePlaybackUI();
  if (state.detailStation?.stationuuid === station.stationuuid) {
    state.detailStation = station;
    renderDetail();
  }
}

function pushRecent(station: Station) {
  const rest = state.recent.filter((s) => s.stationuuid !== station.stationuuid);
  state.recent = [toSnapshot(station), ...rest].slice(0, 40);
  saveRecent(state.recent);
}

function syncMediaSession() {
  updateMediaSession(state.current, player.playing, {
    play: () => togglePlayback(),
    pause: () => player.pause(),
    next: () => void playRelative(1),
    previous: () => void playRelative(-1),
  });
}

async function playStation(station: Station) {
  state.current = station;
  state.detailStation = null;
  pushRecent(station);
  saveLastStation(station);
  sleepMenuOpen = false;
  renderPlayer();
  renderDetail();
  updatePlaybackUI();
  announce(`Playing ${station.name}`);
  if (!applyingRoute) {
    setHash({ kind: 'station', uuid: station.stationuuid });
  }
  await player.play(station);
  syncMediaSession();
}

/**
 * Play / pause for the restored or current station.
 * After a reload, state.current exists but the audio player has no station yet —
 * player.toggle() alone is a no-op in that case, so we start a full play().
 */
function togglePlayback() {
  if (!state.current) return;

  const sameStation =
    player.station?.stationuuid === state.current.stationuuid;

  // Player never loaded this station (typical after page reload).
  if (!sameStation) {
    void playStation(state.current);
    return;
  }

  // Same station, but stream was never attached (edge: station set without play).
  if (!player.hasSource && !player.playing) {
    void playStation(state.current);
    return;
  }

  player.toggle();
  syncMediaSession();
  updatePlaybackUI();
}

function queueList(): Station[] {
  if (state.stations.length) return state.stations;
  if (state.recent.length) return state.recent;
  return state.favorites;
}

async function playRelative(delta: number) {
  const list = queueList();
  if (!list.length) {
    showToast('No station queue — browse or search first');
    return;
  }
  const curId = state.current?.stationuuid;
  let idx = curId ? list.findIndex((s) => s.stationuuid === curId) : -1;
  if (idx < 0) idx = delta > 0 ? -1 : 0;
  let next = idx + delta;
  if (next < 0) next = list.length - 1;
  if (next >= list.length) next = 0;
  await playStation(list[next]);
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/** Filters shared by Surprise Me (not list sort order — that broke true random). */
function surpriseSoftFilters(): SearchParams {
  const filters: SearchParams = { hidebroken: true };
  if (state.languageFilter) filters.language = state.languageFilter;
  if (state.httpsOnly) filters.is_https = true;
  return filters;
}

function isSurpriseCandidate(station: Station, excludeId: string | null): boolean {
  if (excludeId && station.stationuuid === excludeId) return false;
  return isLikelyPlayable(station, { httpsOnly: state.httpsOnly });
}

/**
 * Build a pool of random playable stations.
 * Strategies: pure random → context tag → popular random offset (fallback).
 */
async function fetchSurprisePool(excludeId: string | null): Promise<Station[]> {
  const soft = surpriseSoftFilters();
  const seen = new Set<string>();
  const pool: Station[] = [];

  const add = (list: Station[]) => {
    for (const s of list) {
      if (seen.has(s.stationuuid)) continue;
      if (!isSurpriseCandidate(s, excludeId)) continue;
      seen.add(s.stationuuid);
      pool.push(s);
    }
  };

  const strategies: Array<() => Promise<Station[]>> = [
    () => getRandomStations(SURPRISE_BATCH, soft),
  ];

  // Prefer current Discover tag / time-of-day mood when set, else a random mood.
  const contextTag =
    state.selectedTag ||
    (state.view === 'discover'
      ? timeOfDayMoods(resolveTimeOfDayPeriod(state.timeOfDayMode))[
          Math.floor(Math.random() * 4)
        ]?.id
      : null) ||
    MOOD_TAGS[Math.floor(Math.random() * MOOD_TAGS.length)]?.id;

  if (contextTag) {
    strategies.push(() =>
      getRandomStations(SURPRISE_BATCH, { ...soft, tag: contextTag })
    );
  }

  // Fallback if order=random is empty/broken on a mirror: random window of popular.
  strategies.push(async () => {
    const offset = Math.floor(Math.random() * 500);
    return searchStations({
      ...soft,
      limit: SURPRISE_BATCH,
      offset,
      order: 'clickcount',
      reverse: true,
    });
  });

  for (const run of strategies) {
    try {
      add(await run());
    } catch {
      // try next strategy
    }
    if (pool.length >= 8) break;
  }

  return shuffleInPlace(pool);
}

/**
 * Surprise Me: pick a truly random station (not current sort), skip dead streams,
 * and retry a few candidates until one actually starts playing.
 */
async function playSurprise() {
  if (surpriseBusy) {
    showToast('Still finding a surprise…');
    return;
  }

  const seq = ++surpriseSeq;
  surpriseBusy = true;
  const previous = state.current;
  showToast('Finding a surprise…');

  try {
    const pool = await fetchSurprisePool(previous?.stationuuid ?? null);
    if (seq !== surpriseSeq) return;

    if (!pool.length) {
      showToast('No surprise stations available — try again');
      return;
    }

    const tries = pool.slice(0, SURPRISE_MAX_TRIES);
    let attempt = 0;

    for (const station of tries) {
      if (seq !== surpriseSeq) return;
      attempt++;
      if (attempt > 1) {
        showToast(`Trying another… (${attempt}/${tries.length})`);
      }

      // Update UI without committing to recent until playback succeeds.
      state.current = station;
      state.detailStation = null;
      sleepMenuOpen = false;
      renderPlayer();
      renderDetail();
      updatePlaybackUI();
      announce(`Trying ${station.name}`);

      await player.play(station);
      if (seq !== surpriseSeq) return;

      const outcome = await player.waitForOutcome(SURPRISE_PLAY_TIMEOUT_MS);
      if (seq !== surpriseSeq) return;

      // Superseded by another play (user picked a station) — stop the hunt.
      if (outcome === 'cancelled') return;

      if (outcome === 'playing') {
        pushRecent(station);
        saveLastStation(station);
        if (!applyingRoute) {
          setHash({ kind: 'station', uuid: station.stationuuid });
        }
        syncMediaSession();
        updatePlaybackUI();
        announce(`Playing ${station.name}`);
        showToast(
          `Surprise: ${station.name.slice(0, 42)}${station.name.length > 42 ? '…' : ''}`,
          3200
        );
        return;
      }

      // Autoplay blocked — keep this station selected; user can tap play.
      if (player.error?.includes('Click play')) {
        pushRecent(station);
        saveLastStation(station);
        if (!applyingRoute) {
          setHash({ kind: 'station', uuid: station.stationuuid });
        }
        showToast('Tap play to start the surprise station');
        return;
      }
    }

    // All candidates failed — restore previous selection for a calmer recovery.
    if (previous) {
      state.current = previous;
      renderPlayer();
      updatePlaybackUI();
      showToast('Those streams failed — try Surprise me again');
    } else {
      state.current = null;
      renderPlayer();
      updatePlaybackUI();
      showToast('No working surprise found — try again');
    }
  } catch {
    if (seq !== surpriseSeq) return;
    showToast('Could not load a random station');
    if (previous && state.current?.stationuuid !== previous.stationuuid) {
      state.current = previous;
      renderPlayer();
      updatePlaybackUI();
    }
  } finally {
    if (seq === surpriseSeq) surpriseBusy = false;
  }
}

function announce(text: string) {
  const el = document.getElementById('live-region');
  if (el) el.textContent = text;
}

// ─── Data loading ────────────────────────────────────────

async function loadDiscover(reset = true) {
  const seq = ++loadSeq;
  const tagAtStart = state.selectedTag;
  const nearAtStart = state.nearMe;
  const offsetAtStart = reset ? 0 : state.offset;
  const extras = listQueryExtras();

  if (reset) {
    state.loading = true;
    state.error = null;
    state.offset = 0;
    state.stations = [];
    renderMain();
  } else {
    state.loadingMore = true;
    renderLoadMore();
  }

  try {
    let list: Station[];
    if (nearAtStart && state.userLat != null && state.userLon != null) {
      list = await getStationsNear(state.userLat, state.userLon, PAGE, offsetAtStart, {
        ...extras,
        order: 'distance',
        reverse: false,
      });
    } else if (tagAtStart) {
      list = await getStationsByTag(tagAtStart, PAGE, offsetAtStart, extras);
    } else {
      list = await getTopStations(PAGE, offsetAtStart, extras);
    }
    if (seq !== loadSeq) return;
    if (state.view !== 'discover' || state.selectedTag !== tagAtStart || state.nearMe !== nearAtStart)
      return;

    state.stations = reset ? list : [...state.stations, ...list];
    state.hasMore = list.length >= PAGE && state.sort !== 'random';
    state.offset = offsetAtStart + list.length;
  } catch (e) {
    if (seq !== loadSeq) return;
    if (state.view !== 'discover' || state.selectedTag !== tagAtStart) return;
    state.error = e instanceof Error ? e.message : 'Failed to load stations';
  } finally {
    if (seq !== loadSeq) return;
    state.loading = false;
    state.loadingMore = false;
    renderMain();
    setupInfiniteScroll();
  }
}

async function loadSearch(q: string, reset = true) {
  const seq = ++loadSeq;
  const offsetAtStart = reset ? 0 : state.offset;
  const extras = listQueryExtras();

  if (reset) {
    state.loading = true;
    state.error = null;
    state.offset = 0;
    state.stations = [];
    renderMain();
  } else {
    state.loadingMore = true;
    renderLoadMore();
  }

  try {
    const list = await searchStations({
      name: q,
      limit: PAGE,
      offset: offsetAtStart,
      ...extras,
    });
    if (seq !== loadSeq) return;
    if (state.view !== 'search' || state.query.trim() !== q) return;

    state.stations = reset ? list : [...state.stations, ...list];
    state.hasMore = list.length >= PAGE && state.sort !== 'random';
    state.offset = offsetAtStart + list.length;
  } catch (e) {
    if (seq !== loadSeq) return;
    if (state.view !== 'search' || state.query.trim() !== q) return;
    state.error = e instanceof Error ? e.message : 'Search failed';
  } finally {
    if (seq !== loadSeq) return;
    state.loading = false;
    state.loadingMore = false;
    renderMain();
    setupInfiniteScroll();
  }
}

async function loadCountryStations(code: string, reset = true) {
  const seq = ++loadSeq;
  const offsetAtStart = reset ? 0 : state.offset;
  const extras = listQueryExtras();

  if (reset) {
    state.loading = true;
    state.error = null;
    state.offset = 0;
    state.stations = [];
    renderMain();
  } else {
    state.loadingMore = true;
    renderLoadMore();
  }

  try {
    const list = await getStationsByCountry(code, PAGE, offsetAtStart, extras);
    if (seq !== loadSeq) return;
    if (state.view !== 'countries' || state.selectedCountry !== code) return;

    state.stations = reset ? list : [...state.stations, ...list];
    state.hasMore = list.length >= PAGE && state.sort !== 'random';
    state.offset = offsetAtStart + list.length;
  } catch (e) {
    if (seq !== loadSeq) return;
    if (state.view !== 'countries' || state.selectedCountry !== code) return;
    state.error = e instanceof Error ? e.message : 'Failed to load country stations';
  } finally {
    if (seq !== loadSeq) return;
    state.loading = false;
    state.loadingMore = false;
    renderMain();
    setupInfiniteScroll();
  }
}

async function ensureMeta() {
  try {
    const [countries, tags, languages] = await Promise.all([
      getCountries(),
      getTags(200),
      getLanguages(80),
    ]);
    state.countries = countries;
    state.tags = tags;
    state.languages = languages;
    totalStationHint = countries.reduce((sum, c) => sum + c.stationcount, 0);
  } catch {
    // non-fatal
  }
  renderNav();
  renderMain();
  renderTopbar();
}

async function loadFavoritesStations() {
  const seq = ++loadSeq;
  state.loading = true;
  state.error = null;
  state.hasMore = false;
  renderMain();

  try {
    if (state.favorites.length === 0) {
      if (seq !== loadSeq || state.view !== 'favorites') return;
      state.stations = [];
    } else {
      const byId = new Map<string, Station>();
      for (const s of state.favorites) byId.set(s.stationuuid, s);
      for (const s of state.recent) byId.set(s.stationuuid, s);

      const missing = state.favorites
        .filter((s) => !s.url && !s.url_resolved)
        .map((s) => s.stationuuid)
        .filter((id) => {
          const cached = byId.get(id);
          return !cached?.url && !cached?.url_resolved;
        });

      // Also refresh stubs that only have uuid
      const stubIds = state.favorites
        .filter((s) => s.name === 'Saved station' || !s.name)
        .map((s) => s.stationuuid);

      const toFetch = [...new Set([...missing, ...stubIds])];
      if (toFetch.length > 0) {
        const stations = await getStationsByUuids(toFetch);
        if (seq !== loadSeq || state.view !== 'favorites') return;
        for (const s of stations) byId.set(s.stationuuid, s);
        // Upgrade stored favorites
        state.favorites = state.favorites.map((s) => byId.get(s.stationuuid) ?? s);
        saveFavorites(state.favorites);
      }

      if (seq !== loadSeq || state.view !== 'favorites') return;
      state.stations = state.favorites
        .map((s) => byId.get(s.stationuuid) ?? s)
        .filter(Boolean);
    }
  } catch (e) {
    if (seq !== loadSeq || state.view !== 'favorites') return;
    // Fall back to local snapshots
    state.stations = [...state.favorites];
    if (!state.stations.length) {
      state.error = e instanceof Error ? e.message : 'Failed to load favorites';
    }
  } finally {
    if (seq !== loadSeq || state.view !== 'favorites') return;
    state.loading = false;
    renderMain();
    renderNav();
  }
}

// ─── Navigation ──────────────────────────────────────────

function setView(view: ViewId, opts?: { skipHash?: boolean }) {
  state.view = view;
  state.selectedCountry = null;
  state.nearMe = false;
  if (view !== 'discover') state.selectedTag = null;
  if (view !== 'countries' && view !== 'genres') state.browseFilter = '';
  navOpen = false;
  state.detailStation = null;

  if (!opts?.skipHash && !applyingRoute) {
    setHash({ kind: 'view', view });
  }

  if (view === 'discover') {
    void loadDiscover(true);
  } else if (view === 'countries') {
    state.loading = state.countries.length === 0;
    state.stations = [];
    state.error = null;
    if (state.countries.length === 0) {
      void ensureMeta().then(() => {
        state.loading = false;
        renderMain();
      });
    } else {
      state.loading = false;
      renderAllChrome();
    }
  } else if (view === 'genres') {
    state.loading = state.tags.length === 0;
    state.stations = [];
    state.error = null;
    if (state.tags.length === 0) {
      void ensureMeta().then(() => {
        state.loading = false;
        renderMain();
      });
    } else {
      state.loading = false;
      renderAllChrome();
    }
  } else if (view === 'favorites') {
    void loadFavoritesStations();
  } else if (view === 'recent') {
    state.stations = [...state.recent];
    state.loading = false;
    state.hasMore = false;
    state.error = null;
    renderAllChrome();
  } else if (view === 'search') {
    if (state.query.trim()) void loadSearch(state.query.trim(), true);
    else {
      state.stations = [];
      state.loading = false;
      renderAllChrome();
    }
  }
  renderNav();
  renderMobileTabs();
  renderDetail();
}

function openCountry(code: string, opts?: { skipHash?: boolean }) {
  state.view = 'countries';
  state.selectedCountry = code;
  state.nearMe = false;
  navOpen = false;
  if (!opts?.skipHash && !applyingRoute) {
    setHash({ kind: 'country', code });
  }
  renderNav();
  renderMobileTabs();
  void loadCountryStations(code, true);
}

function openTag(tag: string, opts?: { skipHash?: boolean }) {
  state.view = 'discover';
  state.selectedTag = tag;
  state.nearMe = false;
  state.selectedCountry = null;
  navOpen = false;
  if (!opts?.skipHash && !applyingRoute) {
    setHash({ kind: 'tag', tag });
  }
  renderNav();
  renderMobileTabs();
  void loadDiscover(true);
}

function openNearMe() {
  if (!navigator.geolocation) {
    showToast('Geolocation not available on this device');
    return;
  }
  showToast('Finding stations near you…');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.userLat = pos.coords.latitude;
      state.userLon = pos.coords.longitude;
      state.nearMe = true;
      state.selectedTag = null;
      state.view = 'discover';
      if (!applyingRoute) setHash({ kind: 'near' });
      renderNav();
      void loadDiscover(true);
    },
    () => showToast('Location permission denied'),
    { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 }
  );
}

async function applyRouteFromHash() {
  const route = parseHash();
  if (!route) return;
  applyingRoute = true;
  try {
    switch (route.kind) {
      case 'view':
        setView(route.view, { skipHash: true });
        break;
      case 'tag':
        openTag(route.tag, { skipHash: true });
        break;
      case 'country':
        openCountry(route.code, { skipHash: true });
        break;
      case 'search':
        state.query = route.q;
        state.view = 'search';
        renderTopbar();
        if (route.q.trim()) void loadSearch(route.q.trim(), true);
        else setView('search', { skipHash: true });
        break;
      case 'near':
        openNearMe();
        break;
      case 'station': {
        // Show station in player; load meta if needed
        let station =
          findStation(route.uuid) ||
          state.favorites.find((s) => s.stationuuid === route.uuid) ||
          state.recent.find((s) => s.stationuuid === route.uuid) ||
          (state.current?.stationuuid === route.uuid ? state.current : null);
        if (!station) {
          try {
            const list = await getStationsByUuid(route.uuid);
            station = list[0] ?? null;
          } catch {
            station = null;
          }
        }
        if (station) {
          state.current = station;
          saveLastStation(station);
          renderPlayer();
          // Stay on discover for browsing context
          if (state.view === 'discover' && !state.stations.length) void loadDiscover(true);
          else renderMain();
        } else {
          showToast('Station not found');
          setView('discover', { skipHash: true });
        }
        break;
      }
    }
  } finally {
    applyingRoute = false;
  }
}

// ─── Render pieces ───────────────────────────────────────

function stationArtHtml(station: Station, cls = 'station-art'): string {
  const initial = escapeHtml((station.name || '?').trim().charAt(0).toUpperCase() || '♪');
  if (station.favicon) {
    return `<div class="${cls}" data-fallback="${initial}">
      <img src="${escapeHtml(station.favicon)}" alt="" loading="lazy" referrerpolicy="no-referrer"
        onerror="this.remove();this.parentElement.textContent=this.parentElement.dataset.fallback"/>
    </div>`;
  }
  return `<div class="${cls}">${initial}</div>`;
}

function stationCard(station: Station): string {
  const current = state.current?.stationuuid === station.stationuuid;
  const playing = current && player.playing;
  const fav = isFav(station.stationuuid);
  const tags = formatTags(station.tags);
  const country = station.country || station.countrycode || '';
  const flag = countryFlag(station.countrycode);
  const lang = station.language ? station.language.split(',')[0].trim() : '';

  return `
    <article class="station-card ${current ? 'is-current' : ''} ${playing ? 'is-playing' : ''}" data-id="${escapeHtml(station.stationuuid)}" data-action="card-play" tabindex="0" role="button" aria-label="Play ${escapeHtml(station.name)}">
      <div class="station-card-top">
        ${stationArtHtml(station)}
        <div class="station-info">
          <div class="station-name" title="${escapeHtml(station.name)}" data-action="detail" data-id="${escapeHtml(station.stationuuid)}">${escapeHtml(station.name)}</div>
          <div class="station-meta">
            ${country ? `<span>${flag} ${escapeHtml(country)}</span>` : ''}
            ${station.bitrate ? `<span class="dot"></span><span>${station.bitrate} kbps</span>` : ''}
            ${station.codec ? `<span class="dot"></span><span class="codec-badge">${escapeHtml(station.codec)}</span>` : ''}
            ${lang ? `<span class="dot"></span><span>${escapeHtml(lang)}</span>` : ''}
          </div>
          ${
            tags.length
              ? `<div class="station-tags">${tags
                  .map(
                    (t) =>
                      `<button type="button" class="tag-pill is-clickable" data-action="tag" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`
                  )
                  .join('')}</div>`
              : ''
          }
        </div>
      </div>
      <div class="station-actions">
        <button type="button" class="btn-play ${playing ? 'is-playing' : ''}" data-action="play" data-id="${escapeHtml(station.stationuuid)}">
          ${playing ? icons.pause : icons.play}
          <span>${playing ? 'Playing' : current && player.loading ? 'Loading…' : 'Listen'}</span>
        </button>
        <button type="button" class="btn-icon ${fav ? 'is-fav' : ''}" data-action="fav" data-id="${escapeHtml(station.stationuuid)}" title="${fav ? 'Remove favorite' : 'Add favorite'}" aria-label="Favorite" aria-pressed="${fav}">
          ${fav ? icons.heartFill : icons.heart}
        </button>
        <button type="button" class="btn-icon" data-action="detail" data-id="${escapeHtml(station.stationuuid)}" title="Details" aria-label="Station details">
          ${icons.external}
        </button>
      </div>
    </article>
  `;
}

function skeletonGrid(): string {
  return `<div class="station-grid" aria-hidden="true">${Array.from({ length: 8 })
    .map(
      () => `<div class="station-card skeleton-card">
      <div class="skeleton-line w60"></div>
      <div class="skeleton-line w40"></div>
      <div class="skeleton-line w80"></div>
    </div>`
    )
    .join('')}</div>`;
}

function filterBar(): string {
  const langs = state.languages.slice(0, 24);
  return `
    <div class="filter-bar">
      <div class="filter-group">
        <span class="filter-label">Sort</span>
        <div class="chip-row chip-row-scroll compact">
          ${SORT_OPTIONS.map(
            (s) => `
            <button type="button" class="chip ${state.sort === s.id ? 'active' : ''}" data-action="sort" data-sort="${s.id}">
              ${escapeHtml(s.label)}
            </button>`
          ).join('')}
        </div>
      </div>
      <div class="filter-group">
        <span class="filter-label">Language</span>
        <div class="chip-row chip-row-scroll compact">
          <button type="button" class="chip ${!state.languageFilter ? 'active' : ''}" data-action="lang" data-lang="">All</button>
          ${langs
            .map(
              (l) => `
            <button type="button" class="chip ${state.languageFilter === l.name ? 'active' : ''}" data-action="lang" data-lang="${escapeHtml(l.name)}">
              ${escapeHtml(titleCaseTag(l.name))}
            </button>`
            )
            .join('')}
        </div>
      </div>
      <label class="toggle-https">
        <input type="checkbox" data-action="https-only" ${state.httpsOnly ? 'checked' : ''} />
        <span>HTTPS streams only</span>
      </label>
    </div>
  `;
}

function stationsSection(title: string, meta?: string): string {
  if (state.loading && state.stations.length === 0) {
    return `
      <div class="loading-box">
        <div class="spinner"></div>
        <p>Tuning into the world…</p>
      </div>
      ${skeletonGrid()}
    `;
  }
  if (state.error && state.stations.length === 0) {
    return `<div class="error-box">
      <p>${escapeHtml(state.error)}</p>
      <button type="button" class="btn-more" data-action="retry">Retry</button>
    </div>`;
  }
  if (state.stations.length === 0) {
    return `<div class="empty">
      <p>${emptyMessage()}</p>
      ${
        state.view === 'favorites'
          ? `<button type="button" class="btn-more" data-action="goto-discover">Discover stations</button>`
          : ''
      }
    </div>`;
  }

  return `
    <div class="section-head">
      <h3>${escapeHtml(title)}</h3>
      ${meta ? `<span class="meta">${escapeHtml(meta)}</span>` : ''}
    </div>
    <div class="station-grid">
      ${state.stations.map(stationCard).join('')}
    </div>
    ${
      state.hasMore && state.view !== 'favorites' && state.view !== 'recent'
        ? `<div class="load-more-wrap">
            <button type="button" class="btn-more" data-action="more" ${state.loadingMore ? 'disabled' : ''}>
              ${state.loadingMore ? 'Loading…' : 'Load more stations'}
            </button>
            <div class="infinite-sentinel" data-infinite-sentinel aria-hidden="true"></div>
          </div>`
        : ''
    }
  `;
}

function emptyMessage(): string {
  switch (state.view) {
    case 'favorites':
      return 'No favorites yet. Heart a station to save it here.';
    case 'recent':
      return 'Stations you play will appear here.';
    case 'search':
      return state.query.trim()
        ? 'No stations match that search. Try another name or city.'
        : 'Search for a station, city, or keyword.';
    default:
      return 'No stations found.';
  }
}

function renderDiscover(): string {
  const period = resolveTimeOfDayPeriod(state.timeOfDayMode);
  const periodLabel = timeOfDayPeriodLabel(period).toLowerCase();
  const tod = timeOfDayMoods(period);
  const last = state.current;
  return `
    <section class="hero">
      <h2>Listen to the world, softly.</h2>
      <p>Thousands of live radio stations from every continent — jazz at midnight in Tokyo, classical in Vienna, ambient from the coast. Pick a mood or drift through the globe.</p>
      <div class="hero-stats">
        ${totalStationHint > 0 ? `<span>${Math.floor(totalStationHint / 1000)}k+ stations</span>` : ''}
        ${state.countries.length ? `<span>${state.countries.length} countries</span>` : ''}
        ${state.tags.length ? `<span>${state.tags.length}+ genres</span>` : ''}
      </div>
      <div class="hero-actions">
        <button type="button" class="chip active" data-action="surprise">${icons.surprise} Surprise me</button>
        <button type="button" class="chip ${state.nearMe ? 'active' : ''}" data-action="near-me">${icons.pin} Near me</button>
        ${
          last
            ? `<button type="button" class="chip" data-action="resume">▶ Resume ${escapeHtml(last.name.slice(0, 28))}${last.name.length > 28 ? '…' : ''}</button>`
            : ''
        }
      </div>
    </section>
    <div class="section-head">
      <h3>Right now <span class="period-tag">(${escapeHtml(periodLabel)})</span></h3>
      <span class="meta">${state.timeOfDayMode === 'auto' ? 'Auto' : 'Manual'}</span>
    </div>
    <div class="chip-row chip-row-scroll compact" role="group" aria-label="Time of day">
      <button type="button" class="chip chip-period ${state.timeOfDayMode === 'auto' ? 'active' : ''}" data-action="time-of-day" data-mode="auto" title="Follow local time">
        ⏱ Auto
      </button>
      ${TIME_OF_DAY_PERIODS.map(
        (p) => `
        <button type="button" class="chip chip-period ${state.timeOfDayMode === p.id ? 'active' : ''}" data-action="time-of-day" data-mode="${p.id}" title="${escapeHtml(p.label)} moods">
          ${p.emoji} ${escapeHtml(p.label)}
        </button>`
      ).join('')}
    </div>
    <div class="chip-row chip-row-scroll">
      ${tod
        .map(
          (t) => `
        <button type="button" class="chip ${state.selectedTag === t.id ? 'active' : ''}" data-action="tag" data-tag="${escapeHtml(t.id)}">
          ${t.emoji} ${escapeHtml(t.label)}
        </button>`
        )
        .join('')}
    </div>
    <div class="section-head sticky-section"><h3>Moods &amp; genres</h3></div>
    <div class="chip-row chip-row-scroll chip-fade">
      <button type="button" class="chip ${!state.selectedTag && !state.nearMe ? 'active' : ''}" data-action="tag" data-tag="">
        ✨ Popular
      </button>
      ${MOOD_TAGS.map(
        (t) => `
        <button type="button" class="chip ${state.selectedTag === t.id ? 'active' : ''}" data-action="tag" data-tag="${escapeHtml(t.id)}">
          ${t.emoji} ${escapeHtml(t.label)}
        </button>`
      ).join('')}
    </div>
    ${filterBar()}
    ${stationsSection(
      state.nearMe
        ? 'Near you'
        : state.selectedTag
          ? MOOD_TAGS.find((t) => t.id === state.selectedTag)?.label ||
            titleCaseTag(state.selectedTag)
          : 'Popular worldwide',
      `${state.stations.length}${state.hasMore ? '+' : ''} stations`
    )}
  `;
}

function filteredCountries(): Country[] {
  let list = state.countries;
  if (state.continentFilter) {
    const codes = new Set(CONTINENTS[state.continentFilter] ?? []);
    list = list.filter((c) => codes.has(c.iso_3166_1.toUpperCase()));
  }
  const q = state.browseFilter.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) || c.iso_3166_1.toLowerCase().includes(q)
    );
  }
  return list;
}

function renderCountries(): string {
  if (state.selectedCountry) {
    const c = state.countries.find((x) => x.iso_3166_1 === state.selectedCountry);
    const name = c?.name || state.selectedCountry;
    return `
      <div class="section-head">
        <h3>${countryFlag(state.selectedCountry)} ${escapeHtml(name)}</h3>
        <button type="button" class="chip" data-action="back-countries">← All countries</button>
      </div>
      ${filterBar()}
      ${stationsSection('Stations', `${state.stations.length}${state.hasMore ? '+' : ''}`)}
    `;
  }

  if (state.loading) {
    return `<div class="loading-box"><div class="spinner"></div><p>Loading countries…</p></div>`;
  }

  const continents = Object.keys(CONTINENTS);
  const list = filteredCountries();

  return `
    <section class="hero">
      <h2>Every corner of the map.</h2>
      <p>Browse ${state.countries.length || 'hundreds of'} countries and territories with live streams.</p>
    </section>
    <div class="browse-search-wrap">
      <input type="search" class="browse-search" placeholder="Filter countries…" value="${escapeHtml(state.browseFilter)}" data-action="browse-filter" autocomplete="off" />
    </div>
    <div class="continent-tabs chip-row chip-row-scroll">
      <button type="button" class="chip ${!state.continentFilter ? 'active' : ''}" data-action="continent" data-continent="">
        All
      </button>
      ${continents
        .map(
          (name) => `
        <button type="button" class="chip ${state.continentFilter === name ? 'active' : ''}" data-action="continent" data-continent="${escapeHtml(name)}">
          ${escapeHtml(name)}
        </button>`
        )
        .join('')}
    </div>
    <div class="section-head">
      <h3>Countries</h3>
      <span class="meta">${list.length} shown</span>
    </div>
    <div class="browse-grid">
      ${list
        .map(
          (c) => `
        <button type="button" class="browse-card" data-action="country" data-code="${escapeHtml(c.iso_3166_1)}">
          <div class="flag">${countryFlag(c.iso_3166_1)}</div>
          <div class="title">${escapeHtml(c.name)}</div>
          <div class="count">${c.stationcount.toLocaleString()} stations</div>
        </button>`
        )
        .join('')}
    </div>
  `;
}

function filteredTags() {
  const q = state.browseFilter.trim().toLowerCase();
  if (!q) return state.tags;
  return state.tags.filter((t) => t.name.toLowerCase().includes(q));
}

function renderGenres(): string {
  if (state.loading) {
    return `<div class="loading-box"><div class="spinner"></div><p>Loading genres…</p></div>`;
  }

  const tags = filteredTags();

  return `
    <section class="hero">
      <h2>Find your frequency.</h2>
      <p>From ambient and classical to local news and world music — pick a genre and explore.</p>
    </section>
    <div class="section-head">
      <h3>Popular moods</h3>
    </div>
    <div class="chip-row chip-row-scroll" style="margin-bottom:20px">
      ${MOOD_TAGS.map(
        (t) => `
        <button type="button" class="chip" data-action="tag" data-tag="${escapeHtml(t.id)}">
          ${t.emoji} ${escapeHtml(t.label)}
        </button>`
      ).join('')}
    </div>
    <div class="browse-search-wrap">
      <input type="search" class="browse-search" placeholder="Filter genres…" value="${escapeHtml(state.browseFilter)}" data-action="browse-filter" autocomplete="off" />
    </div>
    <div class="section-head">
      <h3>All genres</h3>
      <span class="meta">${tags.length} tags</span>
    </div>
    <div class="browse-grid">
      ${tags
        .map(
          (t) => `
        <button type="button" class="browse-card" data-action="tag" data-tag="${escapeHtml(t.name)}">
          <div class="title">${escapeHtml(titleCaseTag(t.name))}</div>
          <div class="count">${t.stationcount.toLocaleString()} stations</div>
        </button>`
        )
        .join('')}
    </div>
  `;
}

function renderMainHtml(): string {
  switch (state.view) {
    case 'discover':
      return renderDiscover();
    case 'countries':
      return renderCountries();
    case 'genres':
      return renderGenres();
    case 'favorites':
      return `
        <section class="hero">
          <h2>Your quiet collection.</h2>
          <p>Stations you’ve saved for later evenings.</p>
          <div class="hero-actions">
            <button type="button" class="chip" data-action="export-favs">Export JSON</button>
            <label class="chip file-chip">Import JSON
              <input type="file" accept="application/json,.json" data-action="import-favs" hidden />
            </label>
          </div>
        </section>
        ${stationsSection('Favorites', `${state.stations.length}`)}
      `;
    case 'recent':
      return `
        <section class="hero">
          <h2>Recently tuned.</h2>
          <p>Pick up where you left off.</p>
        </section>
        ${stationsSection('History', `${state.stations.length}`)}
      `;
    case 'search':
      return `
        <div class="section-head">
          <h3>Search results</h3>
          ${state.query ? `<span class="meta">for “${escapeHtml(state.query)}”</span>` : ''}
        </div>
        ${filterBar()}
        ${stationsSection('Stations', `${state.stations.length}${state.hasMore ? '+' : ''}`)}
      `;
    default:
      return '';
  }
}

function renderPlayerHtml(): string {
  const s = state.current;
  if (!s) {
    return `
      <div class="player-idle">
        <div class="player-placeholder">Choose a station and let the world drift in…</div>
        <div class="player-quick">
          <button type="button" class="chip" data-action="tag" data-tag="jazz">🎷 Jazz</button>
          <button type="button" class="chip" data-action="tag" data-tag="ambient">🌙 Ambient</button>
          <button type="button" class="chip" data-action="surprise">${icons.surprise} Surprise</button>
        </div>
      </div>`;
  }

  const playing = player.playing;
  const loading = player.loading;
  const err = player.error;
  const hydrated = player.station?.stationuuid === s.stationuuid;
  const country = s.country || s.countrycode || '';
  const sleepLabel = formatSleepRemaining(sleepTimer.remainingMs);
  const sleepActive = sleepTimer.active;
  const nowLabel = loading
    ? 'Connecting…'
    : playing
      ? 'Now playing'
      : hydrated
        ? 'Paused'
        : 'Ready';

  return `
    <div class="player-now">
      ${stationArtHtml(s, `player-art ${playing ? 'live' : ''}`)}
      <div class="player-meta">
        <div class="now-label">${nowLabel}</div>
        <div class="now-name" title="${escapeHtml(s.name)}" data-action="detail" data-id="${escapeHtml(s.stationuuid)}">${escapeHtml(s.name)}</div>
        <div class="now-sub">${countryFlag(s.countrycode)} ${escapeHtml(country)}${s.bitrate ? ` · ${s.bitrate} kbps` : ''}${s.codec ? ` · ${escapeHtml(s.codec)}` : ''}</div>
        ${
          err
            ? `<div class="now-error">
                <span>${escapeHtml(err)}</span>
                <button type="button" class="link-btn" data-action="retry-play">Retry</button>
                <button type="button" class="link-btn" data-action="play-next">Play next</button>
              </div>`
            : ''
        }
      </div>
    </div>
    <div class="player-controls">
      <div class="eq ${playing ? 'on' : ''}" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
      <button type="button" class="btn-icon btn-skip" data-action="prev" aria-label="Previous station" title="Previous">
        ${icons.prev}
      </button>
      <button type="button" class="btn-main-play" data-action="toggle-play" aria-label="${playing ? 'Pause' : 'Play'}">
        ${loading && !playing ? icons.loader : playing ? icons.pause : icons.play}
      </button>
      <button type="button" class="btn-icon btn-skip" data-action="next" aria-label="Next station" title="Next">
        ${icons.next}
      </button>
      <button type="button" class="btn-icon ${isFav(s.stationuuid) ? 'is-fav' : ''}" data-action="fav" data-id="${escapeHtml(s.stationuuid)}" title="Favorite" aria-pressed="${isFav(s.stationuuid)}">
        ${isFav(s.stationuuid) ? icons.heartFill : icons.heart}
      </button>
      <button type="button" class="btn-icon" data-action="share" title="Share station" aria-label="Share">
        ${icons.share}
      </button>
      <div class="sleep-wrap">
        <button type="button" class="btn-icon ${sleepActive ? 'is-active' : ''}" data-action="toggle-sleep-menu" title="Sleep timer" aria-label="Sleep timer" aria-expanded="${sleepMenuOpen}">
          ${icons.moon}
        </button>
        ${sleepActive && sleepLabel ? `<span class="sleep-badge">${sleepLabel}</span>` : ''}
        ${
          sleepMenuOpen
            ? `<div class="sleep-menu" role="menu">
                ${SLEEP_OPTIONS.map(
                  (m) =>
                    `<button type="button" class="sleep-opt" data-action="sleep" data-min="${m}" role="menuitem">${m} min</button>`
                ).join('')}
                ${sleepActive ? `<button type="button" class="sleep-opt" data-action="sleep-cancel" role="menuitem">Cancel</button>` : ''}
              </div>`
            : ''
        }
      </div>
    </div>
    <div class="player-volume">
      <button type="button" class="btn-icon" data-action="mute" title="${state.muted ? 'Unmute' : 'Mute'}" aria-label="${state.muted ? 'Unmute' : 'Mute'}">
        ${state.muted || state.volume === 0 ? icons.mute : icons.volume}
      </button>
      <input type="range" class="volume-slider" min="0" max="1" step="0.01" value="${state.muted ? 0 : state.volume}" data-action="volume" aria-label="Volume" />
    </div>
  `;
}

function renderDetailHtml(): string {
  const s = state.detailStation;
  if (!s) return '';
  const tags = formatTags(s.tags, 20);
  const fav = isFav(s.stationuuid);

  return `
    <div class="sheet-backdrop open" data-action="close-detail"></div>
    <div class="detail-sheet open" role="dialog" aria-modal="true" aria-label="Station details">
      <div class="sheet-handle" aria-hidden="true"></div>
      <button type="button" class="btn-icon sheet-close" data-action="close-detail" aria-label="Close">${icons.close}</button>
      <div class="detail-head">
        ${stationArtHtml(s, 'detail-art')}
        <div>
          <h2 class="detail-title">${escapeHtml(s.name)}</h2>
          <p class="detail-sub">${countryFlag(s.countrycode)} ${escapeHtml(s.country || s.countrycode || 'Unknown')}
            ${s.state ? ` · ${escapeHtml(s.state)}` : ''}
          </p>
        </div>
      </div>
      <dl class="detail-meta">
        ${s.language ? `<div><dt>Language</dt><dd>${escapeHtml(s.language)}</dd></div>` : ''}
        ${s.codec ? `<div><dt>Codec</dt><dd>${escapeHtml(s.codec)}</dd></div>` : ''}
        ${s.bitrate ? `<div><dt>Bitrate</dt><dd>${s.bitrate} kbps</dd></div>` : ''}
        ${s.votes ? `<div><dt>Votes</dt><dd>${s.votes.toLocaleString()}</dd></div>` : ''}
        ${s.clickcount ? `<div><dt>Clicks</dt><dd>${s.clickcount.toLocaleString()}</dd></div>` : ''}
        ${
          s.geo_lat != null && s.geo_long != null
            ? `<div><dt>Location</dt><dd>${s.geo_lat.toFixed(2)}, ${s.geo_long.toFixed(2)}</dd></div>`
            : ''
        }
      </dl>
      ${
        tags.length
          ? `<div class="detail-tags">${tags
              .map(
                (t) =>
                  `<button type="button" class="chip" data-action="tag" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`
              )
              .join('')}</div>`
          : ''
      }
      <div class="detail-actions">
        <button type="button" class="btn-play" data-action="play" data-id="${escapeHtml(s.stationuuid)}">
          ${icons.play} <span>Listen</span>
        </button>
        <button type="button" class="btn-icon ${fav ? 'is-fav' : ''}" data-action="fav" data-id="${escapeHtml(s.stationuuid)}" aria-pressed="${fav}">
          ${fav ? icons.heartFill : icons.heart}
        </button>
        <button type="button" class="btn-icon" data-action="share" data-id="${escapeHtml(s.stationuuid)}" title="Share">${icons.share}</button>
        ${
          s.homepage
            ? `<a class="btn-icon" href="${escapeHtml(s.homepage)}" target="_blank" rel="noopener" title="Website">${icons.external}</a>`
            : ''
        }
      </div>
    </div>
  `;
}

function navBtn(view: ViewId, icon: string, label: string, badge?: number): string {
  return `
    <button type="button" class="nav-btn ${state.view === view ? 'active' : ''}" data-view="${view}" aria-current="${state.view === view ? 'page' : 'false'}">
      ${icon} ${label}
      ${badge != null && badge > 0 ? `<span class="nav-badge">${badge}</span>` : ''}
    </button>`;
}

function renderNavHtml(): string {
  return `
    <div class="brand">
      <div class="brand-mark">${icons.radio}</div>
      <div class="brand-text">
        <h1>World Radio</h1>
        <p>Relax &amp; listen</p>
      </div>
    </div>
    <div class="nav-section">Explore</div>
    ${navBtn('discover', icons.discover, 'Discover')}
    ${navBtn('countries', icons.globe, 'Countries')}
    ${navBtn('genres', icons.music, 'Genres')}
    <div class="nav-section">Library</div>
    ${navBtn('favorites', icons.heart, 'Favorites', state.favorites.length)}
    ${navBtn('recent', icons.clock, 'Recent')}
    <div class="nav-footer">
      Streams via <a href="https://www.radio-browser.info/" target="_blank" rel="noopener">Radio Browser</a>
      — community-powered, free radio directory.
      <div class="kbd-hint">Shortcuts: Space play · / search · N/P next · M mute</div>
    </div>
  `;
}

// ─── Partial render API ──────────────────────────────────

function qs<T extends Element>(sel: string): T | null {
  return document.querySelector(sel) as T | null;
}

function ensureShell() {
  const app = document.querySelector('#app');
  if (!app) return;
  if (shellBuilt && app.querySelector('.main')) return;

  app.innerHTML = `
    <div id="live-region" class="sr-only" aria-live="polite" aria-atomic="true"></div>
    <div class="nav-backdrop" data-action="close-nav"></div>
    <aside class="nav" aria-label="Main"></aside>
    <main class="main">
      <div class="topbar">
        <button type="button" class="mobile-nav-toggle" data-action="toggle-nav" aria-label="Menu">
          ${icons.menu}
        </button>
        <div class="search-wrap">
          ${icons.search}
          <input
            type="search"
            class="search-input"
            placeholder="Search stations, cities, countries…"
            value=""
            data-action="search"
            autocomplete="off"
            spellcheck="false"
          />
        </div>
        <div class="stats-pill"><strong>—</strong> online</div>
      </div>
      <div class="content" tabindex="-1"></div>
    </main>
    <footer class="player" aria-label="Player"></footer>
    <nav class="mobile-tabs" aria-label="Primary"></nav>
    <div class="detail-root"></div>
    <div class="toast-root" aria-live="polite"></div>
  `;
  shellBuilt = true;
  ensureAppEvents();
}

function renderNav() {
  ensureShell();
  const nav = qs<HTMLElement>('aside.nav');
  if (!nav) return;
  nav.innerHTML = renderNavHtml();
  nav.classList.toggle('open', navOpen);
  const backdrop = qs('.nav-backdrop');
  backdrop?.classList.toggle('open', navOpen);
}

function renderTopbar() {
  ensureShell();
  const pill = qs('.stats-pill');
  if (pill) {
    const stationCountLabel =
      totalStationHint > 0
        ? `${Math.floor(totalStationHint / 1000) >= 1 ? `${Math.floor(totalStationHint / 1000)}k+` : totalStationHint} stations`
        : 'World stations';
    pill.innerHTML = `<strong>${stationCountLabel}</strong> online`;
  }
  const input = qs<HTMLInputElement>('.search-input');
  if (input && document.activeElement !== input) {
    input.value = state.query;
  }
}

function renderMain() {
  ensureShell();
  const content = qs('.content');
  if (!content) return;
  const scrollTop = content.scrollTop;
  content.innerHTML = renderMainHtml();
  // Restore scroll only if same view roughly — simple approach
  content.scrollTop = state.loading && state.stations.length === 0 ? 0 : scrollTop;
  setupInfiniteScroll();
}

function renderPlayer() {
  ensureShell();
  const footer = qs('footer.player');
  if (!footer) return;

  const activeEl = document.activeElement;
  const volActive =
    activeEl instanceof HTMLInputElement && activeEl.classList.contains('volume-slider');
  const volValue = volActive ? activeEl.value : String(state.muted ? 0 : state.volume);

  footer.innerHTML = renderPlayerHtml();
  document.body.classList.toggle('has-player-station', Boolean(state.current));

  if (volActive) {
    const slider = footer.querySelector<HTMLInputElement>('.volume-slider');
    if (slider) {
      slider.value = volValue;
      slider.focus();
    }
  }
}

function renderDetail() {
  ensureShell();
  const root = qs('.detail-root');
  if (!root) return;
  root.innerHTML = renderDetailHtml();
  document.body.classList.toggle('sheet-open', Boolean(state.detailStation));
}

function renderToast() {
  ensureShell();
  const root = qs('.toast-root');
  if (!root) return;
  root.innerHTML = state.toast
    ? `<div class="toast">${escapeHtml(state.toast)}</div>`
    : '';
}

function renderMobileTabs() {
  ensureShell();
  const tabs = qs('.mobile-tabs');
  if (!tabs) return;
  const items: { view: ViewId; label: string; icon: string }[] = [
    { view: 'discover', label: 'Discover', icon: icons.discover },
    { view: 'countries', label: 'Places', icon: icons.globe },
    { view: 'favorites', label: 'Saved', icon: icons.heart },
    { view: 'search', label: 'Search', icon: icons.search },
  ];
  tabs.innerHTML = items
    .map(
      (it) => `
    <button type="button" class="tab-btn ${state.view === it.view || (it.view === 'search' && state.view === 'search') ? 'active' : ''}" data-view="${it.view}" data-action="${it.view === 'search' ? 'focus-search' : ''}">
      ${it.icon}
      <span>${it.label}</span>
    </button>`
    )
    .join('');
}

function renderLoadMore() {
  const btn = qs<HTMLButtonElement>('[data-action="more"]');
  if (btn) {
    btn.disabled = state.loadingMore;
    btn.textContent = state.loadingMore ? 'Loading…' : 'Load more stations';
  }
}

function renderAllChrome() {
  renderNav();
  renderTopbar();
  renderMain();
  renderPlayer();
  renderMobileTabs();
  renderDetail();
  renderToast();
}

function updatePlaybackUI() {
  state.current = player.station ?? state.current;
  document.body.classList.toggle('is-playing', player.playing);
  renderPlayer();
  syncMediaSession();

  const currentId = state.current?.stationuuid;
  document.querySelectorAll<HTMLElement>('.station-card').forEach((card) => {
    const id = card.dataset.id;
    const isCurrent = Boolean(currentId && id === currentId);
    const playing = isCurrent && player.playing;
    card.classList.toggle('is-current', isCurrent);
    card.classList.toggle('is-playing', playing);
    const btn = card.querySelector<HTMLButtonElement>('[data-action="play"]');
    if (!btn) return;
    const loading = isCurrent && player.loading;
    btn.classList.toggle('is-playing', playing);
    btn.innerHTML = `${playing ? icons.pause : icons.play}<span>${
      playing ? 'Playing' : loading ? 'Loading…' : 'Listen'
    }</span>`;
  });
}

function setupInfiniteScroll() {
  if (infiniteObserver) {
    infiniteObserver.disconnect();
    infiniteObserver = null;
  }
  const sentinel = qs('[data-infinite-sentinel]');
  if (!sentinel || !state.hasMore) return;
  infiniteObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        void loadMore();
      }
    },
    { root: qs('.content'), rootMargin: '200px' }
  );
  infiniteObserver.observe(sentinel);
}

function findStation(id: string): Station | undefined {
  return (
    state.stations.find((s) => s.stationuuid === id) ||
    state.recent.find((s) => s.stationuuid === id) ||
    state.favorites.find((s) => s.stationuuid === id) ||
    (state.current?.stationuuid === id ? state.current : undefined) ||
    (state.detailStation?.stationuuid === id ? state.detailStation : undefined)
  );
}

async function shareStation(station: Station) {
  const url = stationShareUrl(station.stationuuid);
  const data = {
    title: station.name,
    text: `Listen to ${station.name} on World Radio`,
    url,
  };
  try {
    if (navigator.share) {
      await navigator.share(data);
      return;
    }
  } catch {
    // user cancelled or failed — fall through to clipboard
  }
  try {
    await navigator.clipboard.writeText(url);
    showToast('Link copied');
  } catch {
    showToast(url);
  }
}

function openDetail(station: Station) {
  state.detailStation = station;
  sleepMenuOpen = false;
  renderDetail();
}

function reloadCurrentList() {
  if (state.view === 'discover') void loadDiscover(true);
  else if (state.view === 'search' && state.query.trim()) void loadSearch(state.query.trim(), true);
  else if (state.view === 'countries' && state.selectedCountry)
    void loadCountryStations(state.selectedCountry, true);
  else renderMain();
}

// ─── Events ──────────────────────────────────────────────

function ensureAppEvents() {
  if (eventsBound) return;
  const app = document.querySelector('#app');
  if (!app) return;
  eventsBound = true;

  app.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      '[data-view], [data-action], a[href]'
    );
    if (!t || !app.contains(t)) return;

    const view = t.dataset.view as ViewId | undefined;
    if (view && t.dataset.action !== 'focus-search') {
      if (view === 'search') {
        setView('search');
        qs<HTMLInputElement>('.search-input')?.focus();
      } else {
        setView(view);
      }
      return;
    }

    const action = t.dataset.action;
    // Inputs use input/change handlers; ignore bare https checkbox clicks (change handles it)
    if (
      !action ||
      action === 'search' ||
      action === 'volume' ||
      action === 'browse-filter' ||
      action === 'https-only' ||
      action === 'import-favs'
    ) {
      return;
    }

    switch (action) {
      case 'focus-search':
        qs<HTMLInputElement>('.search-input')?.focus();
        if (state.view !== 'search') {
          state.view = 'search';
          renderNav();
          renderMobileTabs();
          renderMain();
        }
        break;
      case 'play': {
        e.stopPropagation();
        const id = t.dataset.id;
        if (!id) return;
        const station = findStation(id);
        if (!station) return;
        if (state.current?.stationuuid === id) {
          togglePlayback();
        } else {
          void playStation(station);
        }
        break;
      }
      case 'card-play': {
        // Ignore if click was on a nested control (handled above ideally)
        if ((e.target as HTMLElement).closest('button, a, .tag-pill')) return;
        const id = t.dataset.id;
        if (!id) return;
        const station = findStation(id);
        if (!station) return;
        if (state.current?.stationuuid === id) togglePlayback();
        else void playStation(station);
        break;
      }
      case 'toggle-play':
        togglePlayback();
        break;
      case 'prev':
        void playRelative(-1);
        break;
      case 'next':
      case 'play-next':
        void playRelative(1);
        break;
      case 'retry-play':
        if (state.current) void playStation(state.current);
        break;
      case 'retry':
        reloadCurrentList();
        break;
      case 'goto-discover':
        setView('discover');
        break;
      case 'fav': {
        e.stopPropagation();
        const id = t.dataset.id;
        if (!id) return;
        const station = findStation(id);
        if (station) toggleFavorite(station);
        break;
      }
      case 'detail': {
        e.stopPropagation();
        const id = t.dataset.id;
        if (!id) return;
        const station = findStation(id);
        if (station) openDetail(station);
        break;
      }
      case 'close-detail':
        state.detailStation = null;
        renderDetail();
        break;
      case 'share': {
        const id = t.dataset.id || state.current?.stationuuid;
        if (!id) return;
        const station = findStation(id);
        if (station) void shareStation(station);
        break;
      }
      case 'mute':
        applyMute(!state.muted);
        break;
      case 'more':
        void loadMore();
        break;
      case 'tag': {
        e.stopPropagation();
        const tag = t.dataset.tag ?? '';
        state.detailStation = null;
        renderDetail();
        if (!tag) {
          state.selectedTag = null;
          state.nearMe = false;
          state.view = 'discover';
          if (!applyingRoute) setHash({ kind: 'view', view: 'discover' });
          void loadDiscover(true);
        } else {
          openTag(tag);
        }
        break;
      }
      case 'surprise':
        void playSurprise();
        break;
      case 'time-of-day': {
        const mode = t.dataset.mode as TimeOfDayMode | undefined;
        if (
          !mode ||
          !(
            mode === 'auto' ||
            mode === 'morning' ||
            mode === 'day' ||
            mode === 'evening' ||
            mode === 'night'
          )
        ) {
          return;
        }
        if (state.timeOfDayMode === mode) return;
        state.timeOfDayMode = mode;
        persistPrefs();
        renderMain();
        break;
      }
      case 'near-me':
        openNearMe();
        break;
      case 'resume':
        if (state.current) void playStation(state.current);
        break;
      case 'country': {
        const code = t.dataset.code;
        if (code) openCountry(code);
        break;
      }
      case 'continent':
        state.continentFilter = t.dataset.continent || null;
        renderMain();
        break;
      case 'back-countries':
        state.selectedCountry = null;
        state.stations = [];
        if (!applyingRoute) setHash({ kind: 'view', view: 'countries' });
        renderMain();
        break;
      case 'sort': {
        const sort = t.dataset.sort as SortId;
        if (!sort) return;
        state.sort = sort;
        persistPrefs();
        reloadCurrentList();
        break;
      }
      case 'lang': {
        state.languageFilter = t.dataset.lang || null;
        reloadCurrentList();
        break;
      }
      case 'toggle-nav':
        navOpen = !navOpen;
        renderNav();
        break;
      case 'close-nav':
        navOpen = false;
        renderNav();
        break;
      case 'toggle-sleep-menu':
        sleepMenuOpen = !sleepMenuOpen;
        renderPlayer();
        break;
      case 'sleep': {
        const min = Number(t.dataset.min) as SleepMinutes;
        if (!SLEEP_OPTIONS.includes(min)) return;
        sleepTimer.start(min);
        sleepMenuOpen = false;
        showToast(`Sleep timer: ${min} minutes`);
        renderPlayer();
        break;
      }
      case 'sleep-cancel':
        sleepTimer.cancel();
        sleepMenuOpen = false;
        showToast('Sleep timer cancelled');
        renderPlayer();
        break;
      case 'export-favs': {
        const blob = new Blob([exportFavoritesJson(state.favorites)], {
          type: 'application/json',
        });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `world-radio-favorites.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        showToast('Favorites exported');
        break;
      }
    }
  });

  app.addEventListener('change', (e) => {
    const t = e.target as HTMLElement | null;
    if (!t || !app.contains(t)) return;
    if (t.dataset.action === 'https-only' && t instanceof HTMLInputElement) {
      state.httpsOnly = t.checked;
      persistPrefs();
      reloadCurrentList();
      return;
    }
    if (t.dataset.action === 'import-favs' && t instanceof HTMLInputElement && t.files?.[0]) {
      const file = t.files[0];
      const reader = new FileReader();
      reader.onload = () => {
        const imported = importFavoritesJson(String(reader.result || ''));
        if (!imported) {
          showToast('Invalid favorites file');
          return;
        }
        const map = new Map(state.favorites.map((s) => [s.stationuuid, s]));
        for (const s of imported) map.set(s.stationuuid, s);
        state.favorites = [...map.values()];
        saveFavorites(state.favorites);
        showToast(`Imported ${imported.length} favorites`);
        if (state.view === 'favorites') void loadFavoritesStations();
        else renderNav();
      };
      reader.readAsText(file);
      t.value = '';
    }
  });

  app.addEventListener('input', (e) => {
    const t = e.target as HTMLElement | null;
    if (!t || !app.contains(t)) return;
    const action = t.dataset.action;

    if (action === 'search' && t instanceof HTMLInputElement) {
      state.query = t.value;
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        const q = state.query.trim();
        if (q.length >= 2) {
          state.view = 'search';
          state.selectedCountry = null;
          state.selectedTag = null;
          state.nearMe = false;
          if (!applyingRoute) setHash({ kind: 'search', q });
          renderNav();
          renderMobileTabs();
          void loadSearch(q, true);
        } else if (q.length === 0 && state.view === 'search') {
          setView('discover');
        }
      }, 350);
      return;
    }

    if (action === 'browse-filter' && t instanceof HTMLInputElement) {
      state.browseFilter = t.value;
      renderMain();
      // restore focus
      const input = qs<HTMLInputElement>('.browse-search');
      if (input) {
        input.focus();
        const len = input.value.length;
        try {
          input.setSelectionRange(len, len);
        } catch {
          // ignore
        }
      }
      return;
    }

    if (action === 'volume' && t instanceof HTMLInputElement) {
      applyVolume(Number(t.value));
      const muteBtn = t.closest('.player-volume')?.querySelector('[data-action="mute"]');
      if (muteBtn) {
        muteBtn.innerHTML = state.muted || state.volume === 0 ? icons.mute : icons.volume;
        muteBtn.setAttribute('title', state.muted ? 'Unmute' : 'Mute');
        muteBtn.setAttribute('aria-label', state.muted ? 'Unmute' : 'Mute');
      }
    }
  });

  app.addEventListener('keydown', (e) => {
    const ke = e as KeyboardEvent;
    const t = ke.target as HTMLElement | null;
    if (!t || !app.contains(t)) return;

    if (t.dataset.action === 'search' && ke.key === 'Enter') {
      const q = state.query.trim();
      if (q) {
        state.view = 'search';
        void loadSearch(q, true);
      }
      return;
    }

    // Card activate
    if (t.classList.contains('station-card') && (ke.key === 'Enter' || ke.key === ' ')) {
      ke.preventDefault();
      const id = t.dataset.id;
      const station = id ? findStation(id) : undefined;
      if (station) void playStation(station);
    }
  });
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

function bindGlobalKeys() {
  document.addEventListener('keydown', (e) => {
    if (isTypingTarget(e.target)) {
      if (e.key === 'Escape') {
        (e.target as HTMLElement).blur();
      }
      return;
    }

    switch (e.key) {
      case ' ':
        e.preventDefault();
        togglePlayback();
        break;
      case 'm':
      case 'M':
        applyMute(!state.muted);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        applyVolume(state.volume - 0.05);
        renderPlayer();
        break;
      case 'ArrowRight':
        e.preventDefault();
        applyVolume(state.volume + 0.05);
        renderPlayer();
        break;
      case '/':
        e.preventDefault();
        qs<HTMLInputElement>('.search-input')?.focus();
        break;
      case 'n':
      case 'N':
        void playRelative(1);
        break;
      case 'p':
      case 'P':
        void playRelative(-1);
        break;
      case 'Escape':
        if (state.detailStation) {
          state.detailStation = null;
          renderDetail();
        } else if (sleepMenuOpen) {
          sleepMenuOpen = false;
          renderPlayer();
        } else if (navOpen) {
          navOpen = false;
          renderNav();
        }
        break;
    }
  });
}

async function loadMore() {
  if (state.loadingMore || !state.hasMore) return;
  if (state.view === 'search' && state.query.trim()) {
    await loadSearch(state.query.trim(), false);
  } else if (state.view === 'countries' && state.selectedCountry) {
    await loadCountryStations(state.selectedCountry, false);
  } else if (state.view === 'discover') {
    await loadDiscover(false);
  }
}

// ─── Boot ────────────────────────────────────────────────

player.setVolume(state.volume);

player.subscribe(() => {
  updatePlaybackUI();
});

sleepTimer.setOnFire(() => {
  const finish = () => {
    player.pause();
    showToast('Sleep timer ended — sweet dreams');
    renderPlayer();
  };
  if (player.playing) player.fadeOutThen(2000, finish);
  else finish();
});

sleepTimer.subscribe(() => {
  const badge = qs('.sleep-badge');
  const label = formatSleepRemaining(sleepTimer.remainingMs);
  if (badge && label) badge.textContent = label;
  else if (sleepTimer.active || badge) renderPlayer();
});

bindGlobalKeys();
window.addEventListener('hashchange', () => {
  void applyRouteFromHash();
});

renderAllChrome();
void ensureMeta();

const initialRoute = parseHash();
if (initialRoute) {
  void applyRouteFromHash();
} else {
  void loadDiscover(true);
}

// Register service worker for PWA shell caching (optional, ignore failures)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
      // SW optional
    });
  });
}
