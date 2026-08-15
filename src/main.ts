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
  getLastNearMeta,
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
import { FX_PRESETS } from './audioFx';
import { type EqBands } from './equalizer';
import {
  closeFxModal,
  isFxModalOpen,
  openFxModal,
  renderFxModal,
  setFxModalTab,
  toggleFxModal,
  type ModalTab,
} from './fxModal';
import { escapeHtml } from './html';
import {
  beginBlindWander,
  clearMapBlind,
  closePassportPanel,
  dismissMapAlert,
  flyToMap,
  flyToNowPlaying,
  getMapBounds,
  getMapStations,
  getMapViewport,
  gotoMapStamp,
  hideMapView,
  highlightMapStation,
  isBrowserOffline,
  isMapBlind,
  locateOnMap,
  mountMapView,
  refreshMapStations,
  revealMapWander,
  setMapWanderBusy,
  showMapView,
  syncMapHud,
  syncMapNowPlaying,
  syncMapPassport,
  togglePassportPanel,
} from './mapView';
import {
  PASSPORT_LISTEN_MS,
  mergeStamp,
  seedStampsFromStations,
  stampedCountryCodes,
  stampFromStation,
  type PassportStamp,
} from './mapPassport';
import { pickWanderOrder } from './mapWander';
import { safeHttpUrl } from './safeUrl';
import { updateMediaSession } from './mediaSession';
import { player } from './player';
import { parseHash, setHash, stationShareUrl } from './router';
import { formatSleepRemaining, sleepTimer } from './sleepTimer';
import {
  exportFavoritesJson,
  importFavoritesJson,
  loadFavorites,
  loadLastStation,
  loadMapViewport,
  loadMuted,
  loadPassport,
  loadPrefs,
  loadRecent,
  loadVolume,
  saveFavorites,
  saveLastStation,
  saveMuted,
  savePassport,
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
  SurpriseMode,
  TagPlaybackBehavior,
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
  view: prefs.view,
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
  selectedCountry: prefs.selectedCountry,
  selectedTag: prefs.selectedTag,
  volume: loadVolume(),
  muted: loadMuted(),
  offset: 0,
  hasMore: true,
  continentFilter: prefs.continentFilter,
  browseFilter: prefs.browseFilter,
  sort: prefs.sort,
  languageFilter: prefs.languageFilter,
  httpsOnly: prefs.httpsOnly,
  tagPlaybackBehavior: prefs.tagPlaybackBehavior,
  randomAllGenres: prefs.randomAllGenres,
  isRandomGenre: prefs.isRandomGenre,
  detailStation: null,
  toast: null,
  nearMe: false,
  userLat: null,
  userLon: null,
  timeOfDayMode: prefs.timeOfDayMode,
  surpriseMode: null,
  favoriteGroupFilter: prefs.favoriteGroupFilter,
  recentQuery: '',
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
/** Bumped to abandon in-flight Near me geolocation + list loads. */
let nearMeSeq = 0;
/** Guards concurrent Wander hops. */
let wanderSeq = 0;
let wanderBusy = false;

function loadOrSeedPassport(): PassportStamp[] {
  const stored = loadPassport();
  if (stored) return stored;
  const seeded = seedStampsFromStations(state.recent);
  savePassport(seeded);
  return seeded;
}

let passportStamps: PassportStamp[] = loadOrSeedPassport();

const listenAcc = {
  uuid: null as string | null,
  ms: 0,
  lastTick: 0,
  stamped: false,
};
let listenTimer: ReturnType<typeof setInterval> | null = null;

const SURPRISE_BATCH = 20;
/** ~60s total: pool fetch ≤ 12s, then up to 6 connect attempts. */
const SURPRISE_TOTAL_MS = 60_000;
const SURPRISE_POOL_TIMEOUT_MS = 12_000;
const SURPRISE_MAX_TRIES = 6;
const SURPRISE_PLAY_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

// ─── Icons ───────────────────────────────────────────────

const icons = {
  // Smooth-line retro radio set icon
  radio: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6.5C8 4.8 16 4.8 16 6.5"/><path d="M7 6.5L4.2 2.8"/><circle cx="4" cy="2.5" r="0.75" fill="currentColor"/><path d="M6 1.8A3 3 0 018.5 4" opacity="0.85"/><rect x="2.5" y="6.5" width="19" height="14" rx="2.5"/><path d="M5 9.5h14"/><path d="M12 8.5v2" stroke-width="2"/><path d="M5.5 13h4.5M5.5 15.5h4.5M5.5 18h4.5"/><circle cx="15.5" cy="15.5" r="2.75"/><path d="M15.5 15.5l1.25-1.25"/></svg>`,
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
  map: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"><path d="M9 4l-5 2v14l5-2 6 2 5-2V4l-5 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg>`,
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

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function titleCaseTag(name: string): string {
  return name
    .split(/[\s_-]+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ''))
    .join(' ');
}

/** Format API geo_distance (meters) for station cards. */
function formatDistance(meters: number | null | undefined): string | null {
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) return null;
  if (meters < 1000) return `${Math.round(meters)} m`;
  if (meters < 100_000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000)} km`;
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
  }, prefersReducedMotion() ? Math.min(ms, 1800) : ms);
}

function persistPrefs() {
  savePrefs({
    httpsOnly: state.httpsOnly,
    tagPlaybackBehavior: state.tagPlaybackBehavior,
    randomAllGenres: state.randomAllGenres,
    isRandomGenre: state.isRandomGenre,
    sort: state.sort,
    timeOfDayMode: state.timeOfDayMode,
    selectedTag: state.selectedTag,
    selectedCountry: state.selectedCountry,
    continentFilter: state.continentFilter,
    languageFilter: state.languageFilter,
    browseFilter: state.browseFilter,
    view: state.view,
    favoriteGroupFilter: state.favoriteGroupFilter,
  });
}

function applyMute(muted: boolean) {
  state.muted = muted;
  player.setMuted(muted, { silent: true });
  player.setVolume(state.volume);
  saveMuted(muted);
  updatePlaybackUI();
}

function applyVolume(v: number) {
  state.volume = Math.min(1, Math.max(0, v));
  state.muted = state.volume === 0;
  player.setVolume(state.volume);
  player.setMuted(state.muted, { silent: true });
  saveVolume(state.volume);
  saveMuted(state.muted);
}

function listQueryExtras(): SearchParams {
  const extra: SearchParams = {};
  if (state.languageFilter) extra.language = state.languageFilter;
  if (state.httpsOnly) extra.is_https = true;
  if (state.selectedTag) extra.tag = state.selectedTag;
  if (state.sort === 'random') {
    extra.order = 'random';
    extra.reverse = false;
    extra._t = Date.now();
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

function applyPassportStamp(station: Station): void {
  const stamp = stampFromStation(station);
  if (!stamp) return;
  const result = mergeStamp(passportStamps, stamp);
  if (!result.added && !result.upgraded) return;
  passportStamps = result.stamps;
  savePassport(passportStamps);
  syncMapPassport(passportStamps);
  showToast(
    result.upgraded ? `Passport upgraded: ${stamp.country}` : `Passport stamped: ${stamp.country}`
  );
}

function stopListenClock(): void {
  if (listenAcc.uuid && listenAcc.lastTick) {
    listenAcc.ms += Date.now() - listenAcc.lastTick;
    listenAcc.lastTick = 0;
  }
  if (listenTimer) {
    clearInterval(listenTimer);
    listenTimer = null;
  }
}

function tickListenClock(): void {
  if (!player.playing || !player.station) {
    stopListenClock();
    return;
  }
  const id = player.station.stationuuid;
  const now = Date.now();
  if (listenAcc.uuid !== id) {
    listenAcc.uuid = id;
    listenAcc.ms = 0;
    listenAcc.lastTick = now;
    listenAcc.stamped = passportStamps.some((s) => s.stationuuid === id);
    return;
  }
  if (!listenAcc.lastTick) listenAcc.lastTick = now;
  listenAcc.ms += now - listenAcc.lastTick;
  listenAcc.lastTick = now;
  if (!listenAcc.stamped && listenAcc.ms >= PASSPORT_LISTEN_MS) {
    listenAcc.stamped = true;
    applyPassportStamp(player.station);
  }
}

function syncListenClock(): void {
  if (player.playing && player.station) {
    const id = player.station.stationuuid;
    if (listenAcc.uuid !== id) {
      listenAcc.uuid = id;
      listenAcc.ms = 0;
      listenAcc.lastTick = Date.now();
      listenAcc.stamped = passportStamps.some((s) => s.stationuuid === id);
    } else if (!listenAcc.lastTick) {
      listenAcc.lastTick = Date.now();
    }
    if (!listenTimer) listenTimer = window.setInterval(tickListenClock, 1000);
    return;
  }
  stopListenClock();
}

function cancelWanderHunt(): void {
  wanderSeq++;
  wanderBusy = false;
  setMapWanderBusy(false);
  clearMapBlind();
}

function syncMediaSession() {
  updateMediaSession(state.current, player.playing, {
    play: () => togglePlayback(),
    pause: () => player.pause(),
    next: () => void playRelative(1),
    previous: () => void playRelative(-1),
    stop: () => closePlayerAndCleanActivity(),
  });
}

async function playStation(station: Station) {
  if (isMapBlind()) clearMapBlind();
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

/**
 * Close the player bar: stop stream, cancel Surprise/Near me hunts,
 * drop current station, clear near-me mode, abandon in-flight list loads.
 */
function closePlayerAndCleanActivity() {
  const wasNearMe = state.nearMe;
  const hadStation = Boolean(state.current);
  const hadSurprise = surpriseBusy;
  const wasLoadingList = state.loading || state.loadingMore;

  // Cancel Surprise · Anywhere / Here retries and stream attempts.
  surpriseSeq++;
  surpriseBusy = false;
  cancelWanderHunt();

  // Cancel Near me geolocation callback + any in-flight discover/search loads.
  nearMeSeq++;
  loadSeq++;

  // Hard-stop audio (invalidates playGeneration so in-flight play() no-ops).
  player.stop();

  state.current = null;
  state.detailStation = null;
  sleepMenuOpen = false;
  sleepTimer.cancel();

  // Clear Near me findings / mode entirely.
  state.nearMe = false;
  state.surpriseMode = null;
  state.userLat = null;
  state.userLon = null;
  state.loading = false;
  state.loadingMore = false;

  // Leave station / near deep links; keep the actual browse view.
  if (!applyingRoute) {
    const route = parseHash();
    if (!route || route.kind === 'station' || route.kind === 'near') {
      if (state.view === 'map') {
        const vp = getMapViewport();
        setHash(vp ? { kind: 'map', lat: vp.lat, lon: vp.lon, zoom: vp.zoom } : { kind: 'map' });
      } else {
        setHash({ kind: 'view', view: state.view });
      }
    }
  }

  if (wasNearMe && state.view === 'discover') {
    // Drop near-me list and reload popular (fresh loadSeq path).
    state.error = null;
    void loadDiscover(true);
  } else {
    renderPlayer();
    renderMain();
    renderNav();
    renderMobileTabs();
    renderDetail();
    updatePlaybackUI();
  }

  syncMediaSession();
  announce('Playback stopped');
  if (hadStation || wasNearMe || hadSurprise || wasLoadingList) {
    showToast('Stopped — all connections cleared');
  } else {
    showToast('Stopped');
  }
}

function queueList(): Station[] {
  if (state.stations.length) return state.stations;
  if (state.recent.length) return state.recent;
  return state.favorites;
}

function getQueueContextName(): string {
  if (state.stations.length) {
    if (state.nearMe) return 'Near me';
    if (state.selectedTag) return state.selectedTag;
    if (state.selectedCountry) return state.selectedCountry;
    if (state.view === 'search' && state.query.trim()) return `Search "${state.query.trim()}"`;
    if (state.view === 'favorites') return 'Favorites';
    if (state.view === 'recent') return 'Recent history';
    if (state.view === 'map') return 'Map';
    return 'Popular';
  }
  if (state.recent.length) return 'Recent history';
  if (state.favorites.length) return 'Favorites';
  return 'Queue';
}

async function waitForLoading(maxWaitMs = 3000): Promise<void> {
  if (!state.loading) return;
  const start = Date.now();
  while (state.loading && Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function playRelative(delta: number) {
  if (state.loading) {
    await waitForLoading();
  }
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

  const dir = delta > 0 ? 'Next' : 'Prev';
  const ctxName = getQueueContextName();
  showToast(`${dir} (${next + 1}/${list.length} in ${ctxName})`);

  await playStation(list[next]);
}

type SurpriseAttemptResult = 'played' | 'blocked' | 'failed' | 'cancelled';

interface SurpriseContext {
  /** Short scope for toasts, e.g. "jazz", "near you" */
  label: string;
  /** Human summary for tooltips */
  summary: string;
  /** True when user has an explicit browse filter (not just time-of-day soft focus) */
  hasStrongCondition: boolean;
  filters: SearchParams;
  localPool: Station[] | null;
  tag: string | null;
  countrycode: string | null;
  near: { lat: number; lon: number } | null;
  nameQuery: string | null;
  /** Soft tags when Discover has no genre selected */
  periodTags: string[] | null;
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

function surpriseHttpsFilter(): SearchParams {
  const filters: SearchParams = { hidebroken: true };
  // Global safety pref only — not a browse "condition".
  if (state.httpsOnly) filters.is_https = true;
  return filters;
}

function isSurpriseCandidate(station: Station, excludeId: string | null): boolean {
  if (excludeId && station.stationuuid === excludeId) return false;
  return isLikelyPlayable(station, { httpsOnly: state.httpsOnly });
}

function collectSurprisePool(
  lists: Station[][],
  excludeId: string | null
): Station[] {
  const seen = new Set<string>();
  const pool: Station[] = [];
  for (const list of lists) {
    for (const s of list) {
      if (seen.has(s.stationuuid)) continue;
      if (!isSurpriseCandidate(s, excludeId)) continue;
      seen.add(s.stationuuid);
      pool.push(s);
    }
  }
  return shuffleInPlace(pool);
}

async function runSurpriseStrategies(
  strategies: Array<() => Promise<Station[]>>,
  excludeId: string | null,
  minPool = 4
): Promise<Station[]> {
  const gathered: Station[][] = [];
  for (const run of strategies) {
    try {
      gathered.push(await withTimeout(run(), SURPRISE_POOL_TIMEOUT_MS));
    } catch {
      // try next strategy
    }
    const pool = collectSurprisePool(gathered, excludeId);
    if (pool.length >= minPool) return pool;
  }
  return collectSurprisePool(gathered, excludeId);
}

/** Snapshot of current browse conditions for Surprise · Here */
function getSurpriseContext(): SurpriseContext {
  const filters = surpriseHttpsFilter();
  if (state.languageFilter) filters.language = state.languageFilter;

  if (state.view === 'favorites') {
    return {
      label: 'favorites',
      summary: 'Your favorites',
      hasStrongCondition: state.favorites.length > 0,
      filters,
      localPool: state.favorites,
      tag: null,
      countrycode: null,
      near: null,
      nameQuery: null,
      periodTags: null,
    };
  }

  if (state.view === 'recent') {
    return {
      label: 'recent',
      summary: 'Recently played',
      hasStrongCondition: state.recent.length > 0,
      filters,
      localPool: state.recent,
      tag: null,
      countrycode: null,
      near: null,
      nameQuery: null,
      periodTags: null,
    };
  }

  const parts: string[] = [];
  let hasStrongCondition = false;

  const countrycode = state.selectedCountry;
  if (countrycode) {
    hasStrongCondition = true;
    const c = state.countries.find((x) => x.iso_3166_1 === countrycode);
    parts.push(c?.name || countrycode);
  }

  const near =
    state.nearMe && state.userLat != null && state.userLon != null
      ? { lat: state.userLat, lon: state.userLon }
      : null;
  if (near) {
    hasStrongCondition = true;
    parts.push('near you');
  }

  const tag = state.selectedTag;
  if (tag) {
    hasStrongCondition = true;
    const mood = MOOD_TAGS.find((t) => t.id === tag);
    parts.push(mood?.label || titleCaseTag(tag));
  }

  const nameQuery =
    state.view === 'search' && state.query.trim() ? state.query.trim() : null;
  if (nameQuery) {
    hasStrongCondition = true;
    parts.push(`“${nameQuery}”`);
  }

  if (state.languageFilter) {
    hasStrongCondition = true;
    parts.push(titleCaseTag(state.languageFilter));
  }

  let periodTags: string[] | null = null;
  if (!hasStrongCondition) {
    const period = resolveTimeOfDayPeriod(state.timeOfDayMode);
    periodTags = timeOfDayMoods(period).map((t) => t.id);
    parts.push(timeOfDayPeriodLabel(period).toLowerCase());
  }

  return {
    label: parts[0]?.replace(/^“|”$/g, '') || 'here',
    summary: parts.join(' · ') || 'Current filters',
    hasStrongCondition,
    filters,
    localPool: null,
    tag,
    countrycode,
    near,
    nameQuery,
    periodTags,
  };
}

/** Pure worldwide random (HTTPS-only pref only). Fast path first, then one parallel fallback. */
async function fetchSurprisePoolAnywhere(excludeId: string | null): Promise<Station[]> {
  const soft = surpriseHttpsFilter();

  // Fast path: single random batch (most common success case).
  try {
    const list = await withTimeout(getRandomStations(SURPRISE_BATCH, soft), SURPRISE_POOL_TIMEOUT_MS);
    const pool = collectSurprisePool([list], excludeId);
    if (pool.length >= 3) return pool;
    if (pool.length) {
      // Keep partial; still try to top up once.
      try {
        const offset = Math.floor(Math.random() * 400);
        const more = await withTimeout(
          searchStations({
            ...soft,
            limit: SURPRISE_BATCH,
            offset,
            order: 'clickcount',
            reverse: true,
          }),
          SURPRISE_POOL_TIMEOUT_MS
        );
        return collectSurprisePool([list, more], excludeId);
      } catch {
        return pool;
      }
    }
  } catch {
    // fall through
  }

  // Parallel fallback: random mood + popular window
  const randomMood = MOOD_TAGS[Math.floor(Math.random() * MOOD_TAGS.length)]?.id;
  const offset = Math.floor(Math.random() * 400);
  try {
    const settled = await withTimeout(
      Promise.all([
        getRandomStations(SURPRISE_BATCH, randomMood ? { ...soft, tag: randomMood } : soft).catch(
          () => [] as Station[]
        ),
        searchStations({
          ...soft,
          limit: SURPRISE_BATCH,
          offset,
          order: 'clickcount',
          reverse: true,
        }).catch(() => [] as Station[]),
      ]),
      SURPRISE_POOL_TIMEOUT_MS
    );
    return collectSurprisePool(settled, excludeId);
  } catch {
    return [];
  }
}

/** Random within current browse conditions / list. */
async function fetchSurprisePoolHere(
  excludeId: string | null,
  ctx: SurpriseContext
): Promise<Station[]> {
  if (ctx.localPool) {
    return shuffleInPlace(
      ctx.localPool.filter((s) => isSurpriseCandidate(s, excludeId))
    );
  }

  const soft = { ...ctx.filters };
  const strategies: Array<() => Promise<Station[]>> = [];

  if (ctx.near) {
    const { lat, lon } = ctx.near;
    strategies.push(() => getStationsNear(lat, lon, SURPRISE_BATCH, 0, soft));
  }

  if (ctx.countrycode) {
    strategies.push(() =>
      getRandomStations(SURPRISE_BATCH, {
        ...soft,
        countrycode: ctx.countrycode!,
      })
    );
  }

  if (ctx.tag) {
    strategies.push(() =>
      getRandomStations(SURPRISE_BATCH, { ...soft, tag: ctx.tag! })
    );
  }

  if (ctx.nameQuery) {
    strategies.push(() =>
      searchStations({
        ...soft,
        name: ctx.nameQuery!,
        limit: SURPRISE_BATCH,
        offset: 0,
        order: 'random',
        reverse: false,
      })
    );
    // Fallback: name search by popularity if random+name is sparse
    strategies.push(() =>
      searchStations({
        ...soft,
        name: ctx.nameQuery!,
        limit: SURPRISE_BATCH,
        offset: 0,
        order: 'clickcount',
        reverse: true,
      })
    );
  }

  if (ctx.periodTags?.length) {
    const pick =
      ctx.periodTags[Math.floor(Math.random() * ctx.periodTags.length)]!;
    strategies.push(() => getRandomStations(SURPRISE_BATCH, { ...soft, tag: pick }));
    // Second period tag if the first is thin
    const pick2 =
      ctx.periodTags[Math.floor(Math.random() * ctx.periodTags.length)]!;
    if (pick2 !== pick) {
      strategies.push(() =>
        getRandomStations(SURPRISE_BATCH, { ...soft, tag: pick2 })
      );
    }
  }

  // Language-only (or residual soft filters): pure random inside filters
  if (!strategies.length || state.languageFilter) {
    strategies.push(() => getRandomStations(SURPRISE_BATCH, soft));
  }

  // Scoped popular window as last resort inside the same filters
  strategies.push(async () => {
    const offset = Math.floor(Math.random() * 200);
    return searchStations({
      ...soft,
      ...(ctx.tag ? { tag: ctx.tag } : {}),
      ...(ctx.countrycode ? { countrycode: ctx.countrycode } : {}),
      ...(ctx.nameQuery ? { name: ctx.nameQuery } : {}),
      limit: SURPRISE_BATCH,
      offset,
      order: 'clickcount',
      reverse: true,
    });
  });

  return runSurpriseStrategies(strategies, excludeId);
}

/**
 * Try candidates until one plays. Does not restore previous on failure
 * (caller may fall back to another mode).
 */
async function runSurpriseAttempts(
  pool: Station[],
  seq: number,
  scopeLabel: string,
  deadlineMs: number
): Promise<SurpriseAttemptResult> {
  if (!pool.length) return 'failed';

  const tries = pool.slice(0, SURPRISE_MAX_TRIES);
  let attempt = 0;

  for (const station of tries) {
    if (seq !== surpriseSeq) return 'cancelled';
    if (Date.now() > deadlineMs) return 'failed';

    attempt++;
    if (!prefersReducedMotion() || attempt === 1) {
      if (attempt > 1) {
        showToast(`Trying another… (${attempt}/${tries.length})`);
      } else {
        showToast(`Connecting (${scopeLabel})…`);
      }
    }

    // Only switch UI to the candidate once we start this attempt.
    state.current = station;
    state.detailStation = null;
    sleepMenuOpen = false;
    renderPlayer();
    renderDetail();
    updatePlaybackUI();
    announce(`Trying ${station.name}`);

    // play() includes resolveStream + audio.play timeouts; leave a little headroom for waitForOutcome.
    const remaining = Math.max(2_000, deadlineMs - Date.now());
    const attemptBudget = Math.min(SURPRISE_PLAY_TIMEOUT_MS + 5_000, remaining);

    try {
      await withTimeout(player.play(station), attemptBudget);
    } catch {
      // play hung past budget — next player.play() bumps generation and cancels it
      if (seq !== surpriseSeq) return 'cancelled';
      continue;
    }
    if (seq !== surpriseSeq) return 'cancelled';

    // If play already marked success, skip long wait.
    if (player.playing && player.station?.stationuuid === station.stationuuid) {
      pushRecent(station);
      saveLastStation(station);
      if (!applyingRoute) {
        setHash({ kind: 'station', uuid: station.stationuuid });
      }
      syncMediaSession();
      updatePlaybackUI();
      announce(`Playing ${station.name}`);
      const short =
        station.name.slice(0, 40) + (station.name.length > 40 ? '…' : '');
      showToast(`Surprise (${scopeLabel}): ${short}`, 3200);
      return 'played';
    }

    const waitMs = Math.min(
      SURPRISE_PLAY_TIMEOUT_MS,
      Math.max(1_500, deadlineMs - Date.now())
    );
    const outcome = await player.waitForOutcome(waitMs);
    if (seq !== surpriseSeq) return 'cancelled';
    if (outcome === 'cancelled') return 'cancelled';

    if (outcome === 'playing') {
      pushRecent(station);
      saveLastStation(station);
      if (!applyingRoute) {
        setHash({ kind: 'station', uuid: station.stationuuid });
      }
      syncMediaSession();
      updatePlaybackUI();
      announce(`Playing ${station.name}`);
      const short =
        station.name.slice(0, 40) + (station.name.length > 40 ? '…' : '');
      showToast(`Surprise (${scopeLabel}): ${short}`, 3200);
      return 'played';
    }

    if (player.error?.includes('Click play')) {
      pushRecent(station);
      saveLastStation(station);
      if (!applyingRoute) {
        setHash({ kind: 'station', uuid: station.stationuuid });
      }
      showToast('Tap play to start the surprise station');
      return 'blocked';
    }
  }

  return 'failed';
}

function restoreSurprisePrevious(previous: Station | null) {
  state.surpriseMode = null;
  player.stop();
  state.current = previous;
  renderPlayer();
  renderMain();
  updatePlaybackUI();
}

let lastHereCtx: SurpriseContext | null = null;

function rememberHereContext(ctx: SurpriseContext) {
  lastHereCtx = {
    ...ctx,
    filters: { ...ctx.filters },
    periodTags: ctx.periodTags ? [...ctx.periodTags] : null,
    localPool: ctx.localPool,
  };
}

/**
 * Surprise · Anywhere — worldwide random.
 * Surprise · Here — respect current filters/list; one auto-fallback to Anywhere.
 * Re-click cancels the previous hunt and starts a new one (no permanent hang).
 */
async function playSurprise(mode: SurpriseMode = 'anywhere', overrideCtx?: SurpriseContext) {
  cancelWanderHunt();
  if (surpriseBusy) {
    surpriseSeq++;
    showToast('Restarting surprise…');
  }

  const seq = ++surpriseSeq;
  surpriseBusy = true;
  state.surpriseMode = mode;
  if (!overrideCtx?.near) state.nearMe = false;
  renderMain();

  const previous = state.current;
  const excludeId = previous?.stationuuid ?? null;
  const deadlineMs = Date.now() + SURPRISE_TOTAL_MS;

  try {
    if (mode === 'here') {
      const ctx = overrideCtx ?? getSurpriseContext();

      if (ctx.localPool && ctx.localPool.length === 0) {
        state.surpriseMode = null;
        renderMain();
        showToast(
          ctx.label === 'favorites'
            ? 'No favorites yet — heart a station first'
            : 'No recent stations yet — play something first'
        );
        return;
      }

      showToast(`Finding a surprise (${ctx.label})…`);
      let pool = await fetchSurprisePoolHere(excludeId, ctx);
      if (seq !== surpriseSeq) return;

      if (!pool.length) {
        showToast('Nothing in this filter — trying anywhere…');
        pool = await fetchSurprisePoolAnywhere(excludeId);
        if (seq !== surpriseSeq) return;
        const result = await runSurpriseAttempts(pool, seq, 'anywhere', deadlineMs);
        if (result === 'failed') {
          restoreSurprisePrevious(previous);
          showToast('No working surprise found — try again');
        }
        return;
      }

      let result = await runSurpriseAttempts(pool, seq, ctx.label, deadlineMs);
      if (result === 'played' || result === 'blocked') {
        rememberHereContext(ctx);
        return;
      }
      if (result === 'cancelled') return;

      // Scoped streams all dead — one-shot global fallback
      if (Date.now() > deadlineMs) {
        restoreSurprisePrevious(previous);
        showToast('Surprise timed out — try again');
        return;
      }
      showToast('Those streams failed — trying anywhere…');
      const anywherePool = await fetchSurprisePoolAnywhere(excludeId);
      if (seq !== surpriseSeq) return;
      result = await runSurpriseAttempts(anywherePool, seq, 'anywhere', deadlineMs);
      if (result === 'failed') {
        restoreSurprisePrevious(previous);
        showToast('No working surprise found — try again');
      }
      return;
    }

    // Anywhere
    showToast('Finding a surprise (anywhere)…');
    const pool = await fetchSurprisePoolAnywhere(excludeId);
    if (seq !== surpriseSeq) return;
    if (!pool.length) {
      restoreSurprisePrevious(previous);
      showToast('No surprise stations available — try again');
      return;
    }
    const result = await runSurpriseAttempts(pool, seq, 'anywhere', deadlineMs);
    if (result === 'failed') {
      restoreSurprisePrevious(previous);
      showToast('Those streams failed — try again');
    } else if (result === 'cancelled') {
      // superseded by a newer surprise or close — leave UI alone
    }
  } catch {
    if (seq !== surpriseSeq) return;
    showToast('Could not load a random station');
    restoreSurprisePrevious(previous);
  } finally {
    if (seq === surpriseSeq) surpriseBusy = false;
  }
}

function playPeriodMix() {
  const period = resolveTimeOfDayPeriod(state.timeOfDayMode);
  const ctx: SurpriseContext = {
    label: timeOfDayPeriodLabel(period).toLowerCase(),
    summary: `${timeOfDayPeriodLabel(period)} mix`,
    hasStrongCondition: true,
    filters: surpriseHttpsFilter(),
    localPool: null,
    tag: null,
    countrycode: null,
    near: null,
    nameQuery: null,
    periodTags: timeOfDayMoods(period).map((t) => t.id),
  };
  void playSurprise('here', ctx);
}

function finishWanderPlay(station: Station): void {
  pushRecent(station);
  saveLastStation(station);
  if (!applyingRoute && state.view !== 'map') {
    setHash({ kind: 'station', uuid: station.stationuuid });
  }
  syncMediaSession();
  updatePlaybackUI();
  announce(`Playing ${station.name}`);
  beginBlindWander(station);
  showToast('On the air — guess where', 2800);
}

async function runWanderAttempts(
  pool: Station[],
  seq: number,
  deadlineMs: number
): Promise<SurpriseAttemptResult> {
  if (!pool.length) return 'failed';
  const tries = pool.slice(0, SURPRISE_MAX_TRIES);
  let attempt = 0;

  for (const station of tries) {
    if (seq !== wanderSeq) return 'cancelled';
    if (Date.now() > deadlineMs) return 'failed';
    attempt++;
    if (!prefersReducedMotion() || attempt === 1) {
      showToast(attempt > 1 ? `Trying another… (${attempt}/${tries.length})` : 'Tuning the shortwave…');
    }

    state.current = station;
    state.detailStation = null;
    sleepMenuOpen = false;
    renderPlayer();
    renderDetail();
    updatePlaybackUI();
    announce(`Trying ${station.name}`);

    const remaining = Math.max(2_000, deadlineMs - Date.now());
    const attemptBudget = Math.min(SURPRISE_PLAY_TIMEOUT_MS + 5_000, remaining);
    try {
      await withTimeout(player.play(station), attemptBudget);
    } catch {
      if (seq !== wanderSeq) return 'cancelled';
      continue;
    }
    if (seq !== wanderSeq) return 'cancelled';

    if (player.playing && player.station?.stationuuid === station.stationuuid) {
      finishWanderPlay(station);
      return 'played';
    }

    const waitMs = Math.min(
      SURPRISE_PLAY_TIMEOUT_MS,
      Math.max(1_500, deadlineMs - Date.now())
    );
    const outcome = await player.waitForOutcome(waitMs);
    if (seq !== wanderSeq) return 'cancelled';
    if (outcome === 'cancelled') return 'cancelled';
    if (outcome === 'playing') {
      finishWanderPlay(station);
      return 'played';
    }
    if (player.error?.includes('Click play')) {
      finishWanderPlay(station);
      showToast('Tap play, then listen for the reveal');
      return 'blocked';
    }
  }

  return 'failed';
}

async function playWander(): Promise<void> {
  if (isBrowserOffline()) {
    showToast('Wander needs a connection');
    return;
  }
  if (wanderBusy) {
    wanderSeq++;
    showToast('Retuning…');
  }
  surpriseSeq++;
  surpriseBusy = false;
  state.surpriseMode = null;
  clearMapBlind();

  const seq = ++wanderSeq;
  wanderBusy = true;
  setMapWanderBusy(true);

  const previous = state.current;
  const excludeId = previous?.stationuuid ?? null;
  const deadlineMs = Date.now() + SURPRISE_TOTAL_MS;
  const vp = getMapViewport();
  const ctx = {
    bounds: getMapBounds(),
    zoom: vp?.zoom ?? 2,
    center: vp ? { lat: vp.lat, lon: vp.lon } : null,
    stampedCountries: stampedCountryCodes(passportStamps),
    excludeId,
  };

  try {
    showToast('Tuning the shortwave…');
    const soft = surpriseHttpsFilter();
    let gathered: Station[] = [];
    try {
      gathered = await withTimeout(
        getRandomStations(SURPRISE_BATCH, { ...soft, has_geo_info: true }),
        SURPRISE_POOL_TIMEOUT_MS
      );
    } catch {
      gathered = [];
    }
    if (seq !== wanderSeq) return;

    let pool = pickWanderOrder(collectSurprisePool([gathered], excludeId), ctx);
    if (pool.length < 3) {
      try {
        const more = await withTimeout(
          getRandomStations(SURPRISE_BATCH, soft),
          SURPRISE_POOL_TIMEOUT_MS
        );
        if (seq !== wanderSeq) return;
        pool = pickWanderOrder(collectSurprisePool([gathered, more], excludeId), ctx);
      } catch {
        // keep what we have
      }
    }

    if (!pool.length) {
      showToast('No wander station found — try again');
      return;
    }

    const result = await runWanderAttempts(pool, seq, deadlineMs);
    if (seq !== wanderSeq) return;
    if (result === 'failed') {
      showToast('No working wander found — try again');
      if (previous && !player.playing) {
        state.current = previous;
        renderPlayer();
        updatePlaybackUI();
      }
    }
  } catch {
    if (seq === wanderSeq) showToast('Wander failed — try again');
  } finally {
    if (seq === wanderSeq) {
      wanderBusy = false;
      setMapWanderBusy(false);
    }
  }
}

function replayPassportStamp(uuid: string): void {
  if (state.current?.stationuuid === uuid && (player.playing || player.loading)) return;
  const station = findStation(uuid);
  if (station) {
    void playStation(station);
    return;
  }
  void getStationsByUuid(uuid).then((list) => {
    if (list[0]) void playStation(list[0]);
    else showToast('Could not replay that stamp');
  });
}

/** Dual surprise chips for hero / idle player */
function surpriseActionsHtml(opts?: { compact?: boolean }): string {
  const ctx = getSurpriseContext();
  const hereTitle = `Surprise within: ${ctx.summary}`;
  const hereMuted = ctx.hasStrongCondition ? '' : ' chip-muted';
  const icon = icons.surprise;
  const activeAnywhere = state.surpriseMode === 'anywhere' ? ' active' : '';
  const activeHere = state.surpriseMode === 'here' ? ' active' : '';
  const again = lastHereCtx
    ? `<button type="button" class="chip" data-action="surprise-again" title="Another like: ${escapeHtml(lastHereCtx.summary)}">↻ Another like this</button>`
    : '';
  if (opts?.compact) {
    return `
      <button type="button" class="chip${activeAnywhere}" data-action="surprise" data-mode="anywhere" title="Random station from anywhere">${icon} Anywhere</button>
      <button type="button" class="chip${hereMuted}${activeHere}" data-action="surprise" data-mode="here" title="${escapeHtml(hereTitle)}">🎯 Here</button>
      ${again}
    `;
  }
  return `
    <button type="button" class="chip${activeAnywhere}" data-action="surprise" data-mode="anywhere" title="Random station from all stations">${icon} Anywhere</button>
    <button type="button" class="chip${hereMuted}${activeHere}" data-action="surprise" data-mode="here" title="${escapeHtml(hereTitle)}">🎯 Here</button>
    ${again}
  `;
}

function announce(text: string) {
  const el = document.getElementById('live-region');
  if (el) el.textContent = text;
}

// ─── Data loading ────────────────────────────────────────

async function loadDiscover(reset = true, opts?: { autoPlayTag?: boolean }) {
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
      // Soft filters only — getStationsNear owns geo radius + distance sort.
      list = await getStationsNear(state.userLat, state.userLon, PAGE, offsetAtStart, {
        language: extras.language,
        is_https: extras.is_https,
        hidebroken: true,
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
    // Near-me uses expanding radius + client sort; allow more if page was full.
    state.hasMore = list.length >= PAGE && state.sort !== 'random';
    state.offset = offsetAtStart + list.length;

    if (reset && opts?.autoPlayTag && list.length > 0) {
      if (state.tagPlaybackBehavior === 'first') {
        void playStation(list[0]);
      } else if (state.tagPlaybackBehavior === 'random') {
        const idx = Math.floor(Math.random() * list.length);
        void playStation(list[idx]);
      }
    }
  } catch (e) {
    if (seq !== loadSeq) return;
    if (state.view !== 'discover' || state.selectedTag !== tagAtStart || state.nearMe !== nearAtStart)
      return;
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

async function loadCountryStations(code: string, reset = true, opts?: { autoPlayTag?: boolean }) {
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

    if (reset && opts?.autoPlayTag && list.length > 0) {
      if (state.tagPlaybackBehavior === 'first') {
        void playStation(list[0]);
      } else if (state.tagPlaybackBehavior === 'random') {
        const idx = Math.floor(Math.random() * list.length);
        void playStation(list[idx]);
      }
    }
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
      state.favorites = state.favorites.map((s) => byId.get(s.stationuuid) ?? s);
      applyFavoriteFilter();
    }
  } catch (e) {
    if (seq !== loadSeq || state.view !== 'favorites') return;
    // Fall back to local snapshots
    applyFavoriteFilter();
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
  state.nearMe = false;
  state.surpriseMode = null;
  navOpen = false;
  state.detailStation = null;
  persistPrefs();

  if (!opts?.skipHash && !applyingRoute) {
    if (view === 'map') {
      const vp = getMapViewport() ?? loadMapViewport();
      setHash(vp ? { kind: 'map', lat: vp.lat, lon: vp.lon, zoom: vp.zoom } : { kind: 'map' });
    } else {
      setHash({ kind: 'view', view });
    }
  }

  if (view === 'discover') {
    void loadDiscover(true);
  } else if (view === 'countries') {
    if (state.selectedCountry) {
      void loadCountryStations(state.selectedCountry, true);
    } else {
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
    applyRecentFilter();
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
  } else if (view === 'map') {
    state.loading = false;
    state.hasMore = false;
    state.error = null;
    renderAllChrome();
  }
  renderNav();
  renderMobileTabs();
  renderDetail();
}

function openCountry(code: string, opts?: { skipHash?: boolean; autoPlay?: boolean }) {
  state.view = 'countries';
  state.selectedCountry = code;
  state.selectedTag = null;
  state.isRandomGenre = false;
  state.nearMe = false;
  state.surpriseMode = null;
  navOpen = false;
  persistPrefs();
  if (!opts?.skipHash && !applyingRoute) {
    setHash({ kind: 'country', code });
  }
  renderNav();
  renderMobileTabs();
  void loadCountryStations(code, true, { autoPlayTag: opts?.autoPlay ?? true });
}

function openTag(tag: string, opts?: { skipHash?: boolean; isRandom?: boolean; autoPlayTag?: boolean }) {
  state.view = 'discover';
  state.selectedTag = tag;
  state.isRandomGenre = Boolean(opts?.isRandom);
  state.nearMe = false;
  state.surpriseMode = null;
  navOpen = false;
  persistPrefs();
  if (!opts?.skipHash && !applyingRoute) {
    setHash({ kind: 'tag', tag });
  }
  renderNav();
  renderMobileTabs();
  void loadDiscover(true, { autoPlayTag: opts?.autoPlayTag ?? true });
}

function handlePickRandomGenre() {
  let pickedId = '';
  let pickedLabel = '';

  if (state.randomAllGenres && state.tags.length > 0) {
    // Full Radio Browser genre catalog
    const candidates = state.tags.filter(
      (t) => t.stationcount >= 5 && t.name.toLowerCase() !== state.selectedTag?.toLowerCase()
    );
    const pool = candidates.length > 0 ? candidates : state.tags;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) {
      pickedId = pick.name;
      pickedLabel = titleCaseTag(pick.name);
    }
  }

  if (!pickedId) {
    // Curated mood tags
    const candidates = MOOD_TAGS.filter(
      (t) => t.id.toLowerCase() !== state.selectedTag?.toLowerCase()
    );
    const pool = candidates.length > 0 ? candidates : MOOD_TAGS;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    pickedId = pick.id;
    pickedLabel = pick.label;
  }

  showToast(`🎲 Picked genre: ${pickedLabel}`);
  if (state.view === 'countries' && state.selectedCountry) {
    state.selectedTag = pickedId;
    state.isRandomGenre = true;
    persistPrefs();
    void loadCountryStations(state.selectedCountry, true, { autoPlayTag: true });
  } else {
    openTag(pickedId, { isRandom: true, autoPlayTag: true });
  }
}

function handlePickRandomCountry() {
  const list = filteredCountries();
  const pool = list.length ? list : state.countries;
  if (!pool.length) {
    showToast('No countries available');
    return;
  }
  const candidates = state.selectedCountry
    ? pool.filter((c) => c.iso_3166_1 !== state.selectedCountry)
    : pool;
  const choice = candidates.length ? candidates : pool;
  const picked = choice[Math.floor(Math.random() * choice.length)];
  openCountry(picked.iso_3166_1, { autoPlay: true });
  showToast(`🎲 Random country: ${picked.name}`);
}

function openNearMe() {
  if (!navigator.geolocation) {
    showToast('Geolocation not available on this device');
    return;
  }
  const seq = ++nearMeSeq;
  showToast('Finding stations near you…');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (seq !== nearMeSeq) return;
      state.userLat = pos.coords.latitude;
      state.userLon = pos.coords.longitude;
      state.nearMe = true;
      state.surpriseMode = null;
      state.selectedTag = null;
      state.selectedCountry = null;
      state.view = 'discover';
      if (!applyingRoute) setHash({ kind: 'near' });
      renderNav();
      renderMobileTabs();
      void loadDiscover(true).then(() => {
        if (seq !== nearMeSeq) return;
        if (state.nearMe && !state.loading) {
          if (state.stations.length) {
            const n = state.stations.length;
            showToast(
              `Near you: ${n}${state.hasMore ? '+' : ''} station${n === 1 ? '' : 's'}`,
              3200
            );
          } else if (!state.error) {
            showToast('No geo-tagged stations found nearby — try a wider filter or Popular');
          }
        }
      });
    },
    (err) => {
      if (seq !== nearMeSeq) return;
      const msg =
        err.code === err.PERMISSION_DENIED
          ? 'Location permission denied'
          : err.code === err.POSITION_UNAVAILABLE
            ? 'Location unavailable'
            : err.code === err.TIMEOUT
              ? 'Location request timed out — try again'
              : 'Could not get your location';
      showToast(msg);
    },
    { enableHighAccuracy: false, timeout: 15_000, maximumAge: 600_000 }
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
        openTag(route.tag, { skipHash: true, autoPlayTag: false });
        break;
      case 'country':
        openCountry(route.code, { skipHash: true, autoPlay: false });
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
      case 'map':
        if (route.lat != null && route.lon != null) {
          flyToMap(route.lat, route.lon, route.zoom ?? 9);
        } else {
          const saved = loadMapViewport();
          if (saved) {
            flyToMap(saved.lat, saved.lon, saved.zoom);
            setHash({ kind: 'map', lat: saved.lat, lon: saved.lon, zoom: saved.zoom });
          }
        }
        setView('map', { skipHash: true });
        break;
      case 'station': {
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
          renderPlayer();
          hydrateBrowseView();
        } else {
          showToast('Station not found');
          setView(prefs.view || 'discover', { skipHash: true });
        }
        break;
      }
    }
  } finally {
    applyingRoute = false;
  }
}

function hydrateBrowseView() {
  const view = state.view;
  if (view === 'favorites') {
    void loadFavoritesStations();
    return;
  }
  if (view === 'recent') {
    applyRecentFilter();
    state.loading = false;
    state.hasMore = false;
    renderMain();
    return;
  }
  if (view === 'countries' && state.selectedCountry) {
    void loadCountryStations(state.selectedCountry, true);
    return;
  }
  if (view === 'search' && state.query.trim()) {
    void loadSearch(state.query.trim(), true);
    return;
  }
  if (view === 'discover' && !state.stations.length) {
    void loadDiscover(true);
    return;
  }
  if (view === 'map') {
    renderMain();
    return;
  }
  renderMain();
}

function applyRecentFilter() {
  const q = state.recentQuery.trim().toLowerCase();
  state.stations = q
    ? state.recent.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.country.toLowerCase().includes(q) ||
          s.tags.toLowerCase().includes(q)
      )
    : [...state.recent];
}

function favoriteGroups(): string[] {
  const names = new Set<string>();
  for (const s of state.favorites) {
    if (s.group) names.add(s.group);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function applyFavoriteFilter() {
  const group = state.favoriteGroupFilter;
  const list = group
    ? group === '__none__'
      ? state.favorites.filter((s) => !s.group)
      : state.favorites.filter((s) => s.group === group)
    : [...state.favorites];
  state.stations = list;
}

// ─── Render pieces ───────────────────────────────────────

function stationArtHtml(station: Station, cls = 'station-art'): string {
  const initial = escapeHtml((station.name || '?').trim().charAt(0).toUpperCase() || '♪');
  const favicon = safeHttpUrl(station.favicon);
  if (favicon) {
    return `<div class="${cls}" data-fallback="${initial}">
      <img src="${escapeHtml(favicon)}" alt="" loading="lazy" referrerpolicy="no-referrer"
        onerror="const p=this.parentElement;this.remove();if(p)p.textContent=p.dataset.fallback||'♪'"/>
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
  const dist =
    state.nearMe || typeof station.geo_distance === 'number'
      ? formatDistance(station.geo_distance)
      : null;

  return `
    <article class="station-card ${current ? 'is-current' : ''} ${playing ? 'is-playing' : ''}" data-id="${escapeHtml(station.stationuuid)}" data-action="card-play">
      <div class="station-card-top">
        ${stationArtHtml(station)}
        <div class="station-info">
          <div class="station-name" title="${escapeHtml(station.name)}" data-action="detail" data-id="${escapeHtml(station.stationuuid)}">${escapeHtml(station.name)}</div>
          <div class="station-meta">
            ${country ? `<span>${flag} ${escapeHtml(country)}</span>` : ''}
            ${dist ? `<span class="dot"></span><span title="Distance">${escapeHtml(dist)}</span>` : ''}
            ${typeof station.bitrate === 'number' && station.bitrate > 0 ? `<span class="dot"></span><span>${station.bitrate} kbps</span>` : ''}
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
      <div class="filter-toggles">
        <label class="toggle-https">
          <input type="checkbox" data-action="https-only" ${state.httpsOnly ? 'checked' : ''} />
          <span>HTTPS streams only</span>
        </label>
        <label class="toggle-https" title="Unchecked: curated mood tags. Checked: full Radio Browser genre catalog.">
          <input type="checkbox" data-action="random-all-genres" ${state.randomAllGenres ? 'checked' : ''} />
          <span>Random all genres</span>
        </label>
        <label class="toggle-select" title="Playback behavior when selecting a Mood & Genre tag or Country">
          <span>On selection:</span>
          <select class="select-compact" data-action="tag-playback-behavior">
            <option value="keep" ${state.tagPlaybackBehavior === 'keep' ? 'selected' : ''}>Keep current station</option>
            <option value="first" ${state.tagPlaybackBehavior === 'first' ? 'selected' : ''}>Play 1st station</option>
            <option value="random" ${state.tagPlaybackBehavior === 'random' ? 'selected' : ''}>Play random station</option>
          </select>
        </label>
      </div>
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
    const last = getLastStation();
    return `<div class="error-box">
      <p>${escapeHtml(state.error)}</p>
      <button type="button" class="btn-more" data-action="retry">Retry</button>
      ${
        last
          ? `<button type="button" class="btn-more" data-action="resume" data-id="${escapeHtml(last.stationuuid)}">Resume ${escapeHtml(last.name.slice(0, 32))}</button>`
          : ''
      }
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

/**
 * Resolves the LAST station listened to (distinct from the currently active station, if any).
 * - If a station is currently playing, returns the previous station in recent history.
 * - If no station is active (or player is idle), returns the most recent station played.
 */
function nearYouTitle(): string {
  const meta = getLastNearMeta();
  if (!meta.radiusMeters) return 'Near you';
  const km = Math.round(meta.radiusMeters / 1000);
  if (meta.nextRadiusMeters && state.hasMore) {
    const nextKm = Math.round(meta.nextRadiusMeters / 1000);
    return `Showing within ${km} km — expand to ${nextKm} km`;
  }
  return `Showing within ${km} km`;
}

let deferredInstall: { prompt: () => Promise<unknown> } | null = null;
let playSuccessCount = 0;
let lastPlaySuccessId: string | null = null;

function installHintDismissed(): boolean {
  try {
    return localStorage.getItem('world-radio:a2hs-dismissed') === '1';
  } catch {
    return false;
  }
}

function installChipHtml(): string {
  if (!deferredInstall || playSuccessCount < 2 || installHintDismissed()) return '';
  return `<button type="button" class="chip" data-action="install-app">Install World Radio</button>`;
}

function getLastStation(): Station | null {
  const current = state.current;
  if (current) {
    const prev = state.recent.find((s) => s.stationuuid !== current.stationuuid);
    if (prev) return prev;
    if (!player.playing) return current;
    return null;
  }
  return state.recent[0] ?? loadLastStation();
}

function renderDiscover(): string {
  const period = resolveTimeOfDayPeriod(state.timeOfDayMode);
  const periodLabel = timeOfDayPeriodLabel(period).toLowerCase();
  const tod = timeOfDayMoods(period);
  const last = getLastStation();
  return `
    <section class="hero">
      <h2>Listen to the world, softly.</h2>
      <div class="hero-stats">
        ${totalStationHint > 0 ? `<span>${Math.floor(totalStationHint / 1000)}k+ stations</span>` : ''}
        ${state.countries.length ? `<span>${state.countries.length} countries</span>` : ''}
        ${state.tags.length ? `<span>${state.tags.length}+ genres</span>` : ''}
      </div>
      <div class="hero-actions">
        ${surpriseActionsHtml()}
        <button type="button" class="chip ${state.nearMe ? 'active' : ''}" data-action="near-me">${icons.pin} Near me</button>
        <button type="button" class="chip" data-action="open-map">${icons.map} Map</button>
        ${
          last
            ? `<button type="button" class="chip" data-action="resume" data-id="${escapeHtml(last.stationuuid)}">▶ Resume ${escapeHtml(last.name.slice(0, 28))}${last.name.length > 28 ? '…' : ''}</button>`
            : ''
        }
        ${installChipHtml()}
      </div>
      <p class="hero-privacy">Near me sends your coordinates to Radio Browser to rank nearby stations. They are not stored.</p>
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
      <button type="button" class="chip" data-action="play-period" title="Play a random station for this period">
        ▶ Play ${escapeHtml(periodLabel)} mix
      </button>
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
      <button type="button" class="chip ${!state.selectedTag && !state.nearMe && !state.surpriseMode ? 'active' : ''}" data-action="tag" data-tag="">
        ✨ Popular
      </button>
      <button type="button" class="chip random-chip ${state.isRandomGenre ? 'active' : ''}" data-action="random-genre" title="Pick a random genre (${state.randomAllGenres ? 'full catalog' : 'curated moods'})">
        🎲 Random${state.isRandomGenre && state.selectedTag ? `: ${escapeHtml(titleCaseTag(state.selectedTag))}` : ''}
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
        ? nearYouTitle()
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
        <div class="chip-row compact" style="margin:0;">
          <button type="button" class="chip" data-action="back-countries">← Back</button>
          <button type="button" class="chip random-chip" data-action="random-country" title="Pick another country at random">🎲 Random</button>
          ${surpriseActionsHtml({ compact: true })}
        </div>
      </div>
      <div class="section-head sticky-section"><h3>Moods &amp; genres</h3></div>
      <div class="chip-row chip-row-scroll chip-fade">
        <button type="button" class="chip ${!state.selectedTag && !state.nearMe && !state.surpriseMode ? 'active' : ''}" data-action="tag" data-tag="">
          ✨ Popular
        </button>
        <button type="button" class="chip random-chip ${state.isRandomGenre ? 'active' : ''}" data-action="random-genre" title="Pick a random genre (${state.randomAllGenres ? 'full catalog' : 'curated moods'})">
          🎲 Random${state.isRandomGenre && state.selectedTag ? `: ${escapeHtml(titleCaseTag(state.selectedTag))}` : ''}
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
        state.selectedTag
          ? MOOD_TAGS.find((t) => t.id === state.selectedTag)?.label ||
            titleCaseTag(state.selectedTag)
          : 'Stations',
        `${state.stations.length}${state.hasMore ? '+' : ''}`
      )}
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
      <div class="hero-actions">
        <button type="button" class="chip random-chip" data-action="random-country" title="Pick a country at random">
          🎲 Random Country
        </button>
        ${surpriseActionsHtml()}
      </div>
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
      <button type="button" class="chip random-chip ${state.isRandomGenre ? 'active' : ''}" data-action="random-genre" title="Pick a random genre (${state.randomAllGenres ? 'full catalog' : 'curated moods'})">
        🎲 Random${state.isRandomGenre && state.selectedTag ? `: ${escapeHtml(titleCaseTag(state.selectedTag))}` : ''}
      </button>
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
          <p>Stations you’ve saved for later evenings. Pin them into folders from station details.</p>
          <div class="hero-actions">
            <button type="button" class="chip" data-action="export-favs">Export JSON</button>
            <label class="chip file-chip">Import JSON
              <input type="file" accept="application/json,.json" data-action="import-favs" hidden />
            </label>
            ${surpriseActionsHtml({ compact: true })}
          </div>
        </section>
        <div class="chip-row chip-row-scroll compact">
          <button type="button" class="chip ${!state.favoriteGroupFilter ? 'active' : ''}" data-action="fav-group-filter" data-group="">All</button>
          <button type="button" class="chip ${state.favoriteGroupFilter === '__none__' ? 'active' : ''}" data-action="fav-group-filter" data-group="__none__">Ungrouped</button>
          ${favoriteGroups()
            .map(
              (g) =>
                `<button type="button" class="chip ${state.favoriteGroupFilter === g ? 'active' : ''}" data-action="fav-group-filter" data-group="${escapeHtml(g)}">${escapeHtml(g)}</button>`
            )
            .join('')}
        </div>
        ${stationsSection('Favorites', `${state.stations.length}`)}
      `;
    case 'recent':
      return `
        <section class="hero">
          <h2>Recently tuned.</h2>
          <p>Pick up where you left off.</p>
          <div class="hero-actions">
            <button type="button" class="chip" data-action="clear-recent">Clear history</button>
            ${surpriseActionsHtml({ compact: true })}
          </div>
        </section>
        <div class="browse-search-wrap">
          <input type="search" class="browse-search" placeholder="Search history…" value="${escapeHtml(state.recentQuery)}" data-action="recent-filter" autocomplete="off" />
        </div>
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
          ${surpriseActionsHtml({ compact: true })}
          <button type="button" class="chip ${state.httpsOnly ? 'active' : ''}" data-action="toggle-https-chip" title="Prefer HTTPS streams">${state.httpsOnly ? '🔒 HTTPS on' : '🔓 HTTPS off'}</button>
          ${
            state.languageFilter
              ? `<button type="button" class="chip active" data-action="lang" data-lang="">✕ ${escapeHtml(titleCaseTag(state.languageFilter))}</button>`
              : ''
          }
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
  const nowLabel = player.reconnecting
    ? `Reconnecting to ${s.name.slice(0, 28)}${s.name.length > 28 ? '…' : ''}…`
    : loading
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
      <button type="button" class="btn-icon btn-close-station" data-action="close-station" title="Close station and stop all connections" aria-label="Close station">
        ${icons.close}
      </button>
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
      <button type="button" class="btn-icon ${player.fxEnabled || player.eqEnabled ? 'is-active fx-active-btn' : ''}" data-action="toggle-fx-modal" title="Audio FX & Equalizer" aria-label="Audio FX & Equalizer">
        🎛️
      </button>
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
        ${typeof s.bitrate === 'number' && s.bitrate > 0 ? `<div><dt>Bitrate</dt><dd>${s.bitrate} kbps</dd></div>` : ''}
        ${typeof s.votes === 'number' && s.votes > 0 ? `<div><dt>Votes</dt><dd>${s.votes.toLocaleString()}</dd></div>` : ''}
        ${typeof s.clickcount === 'number' && s.clickcount > 0 ? `<div><dt>Clicks</dt><dd>${s.clickcount.toLocaleString()}</dd></div>` : ''}
        ${
          typeof s.geo_lat === 'number' && typeof s.geo_long === 'number'
            ? `<div><dt>Location</dt><dd>
                <button type="button" class="link-btn" data-action="show-on-map" data-id="${escapeHtml(s.stationuuid)}">${s.geo_lat.toFixed(2)}, ${s.geo_long.toFixed(2)} · Show on map</button>
              </dd></div>`
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
          safeHttpUrl(s.homepage)
            ? `<a class="btn-icon" href="${escapeHtml(safeHttpUrl(s.homepage)!)}" target="_blank" rel="noopener" title="Website">${icons.external}</a>`
            : ''
        }
      </div>
      ${
        isFav(s.stationuuid)
          ? `<label class="folder-label">Folder
              <input type="text" class="eq-save-input" maxlength="40" placeholder="e.g. Night jazz" value="${escapeHtml(s.group || '')}" data-action="set-fav-group" data-id="${escapeHtml(s.stationuuid)}" />
            </label>`
          : ''
      }
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
    ${navBtn('map', icons.map, 'Map')}
    ${navBtn('countries', icons.globe, 'Countries')}
    ${navBtn('genres', icons.music, 'Genres')}
    <div class="nav-section">Library</div>
    ${navBtn('favorites', icons.heart, 'Favorites', state.favorites.length)}
    ${navBtn('recent', icons.clock, 'Recent')}
    <div class="nav-footer">
      Streams via <a href="https://www.radio-browser.info/" target="_blank" rel="noopener">Radio Browser</a>
      — community-powered, free radio directory.
      <div class="kbd-hint">Shortcuts: Space play · / search · N/P next · ↑↓ vol · M mute · Esc close</div>
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
      <div class="map-root" hidden></div>
    </main>
    <footer class="player" aria-label="Player"></footer>
    <nav class="mobile-tabs" aria-label="Primary"></nav>
    <div class="detail-root"></div>
    <div class="fx-modal-root"></div>
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

function ensureMapMounted() {
  const root = qs<HTMLElement>('.map-root');
  if (!root) return;
  mountMapView(root, {
    isFavorite: (uuid) => isFav(uuid),
    getFilters: () => {
      const extra = listQueryExtras();
      const filters: SearchParams = { hidebroken: true };
      if (extra.language) filters.language = extra.language;
      if (extra.is_https) filters.is_https = extra.is_https;
      return filters;
    },
    onStations: (stations) => {
      if (state.view !== 'map') return;
      state.stations = stations;
      state.hasMore = false;
    },
    onViewport: (vp) => {
      if (state.view !== 'map' || applyingRoute) return;
      const route = parseHash();
      if (route?.kind === 'station') return;
      setHash({ kind: 'map', lat: vp.lat, lon: vp.lon, zoom: vp.zoom });
    },
    toast: (message) => showToast(message),
    playStamp: (uuid) => replayPassportStamp(uuid),
  });
  syncMapPassport(passportStamps);
  syncMapHud(state.current ?? player.station);
}

function renderMain() {
  ensureShell();
  const content = qs<HTMLElement>('.content');
  const mapRoot = qs<HTMLElement>('.map-root');
  if (!content) return;

  if (state.view === 'map') {
    content.hidden = true;
    if (mapRoot) mapRoot.hidden = false;
    document.body.classList.add('map-view');
    ensureMapMounted();
    showMapView();
    highlightMapStation(state.current?.stationuuid ?? player.station?.stationuuid ?? null);
    syncMapNowPlaying(state.current ?? player.station);
    syncMapHud(state.current ?? player.station);
    syncMapPassport(passportStamps);
    return;
  }

  document.body.classList.remove('map-view');
  hideMapView();
  if (mapRoot) mapRoot.hidden = true;
  content.hidden = false;

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
  if (state.detailStation) {
    root.querySelector<HTMLElement>('.sheet-close')?.focus();
  }
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
    { view: 'map', label: 'Map', icon: icons.map },
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
  renderFxModal();
  renderToast();
}

function updateHeroResumeUI() {
  const container = qs('.hero-actions');
  if (!container) return;
  const last = getLastStation();
  let resumeBtn = container.querySelector<HTMLButtonElement>('[data-action="resume"]');
  if (last) {
    const btnHtml = `<button type="button" class="chip" data-action="resume" data-id="${escapeHtml(last.stationuuid)}">▶ Resume ${escapeHtml(last.name.slice(0, 28))}${last.name.length > 28 ? '…' : ''}</button>`;
    if (resumeBtn) {
      resumeBtn.outerHTML = btnHtml;
    } else {
      container.insertAdjacentHTML('beforeend', btnHtml);
    }
  } else if (resumeBtn) {
    resumeBtn.remove();
  }
}

function updatePlaybackUI() {
  if (player.playing && player.station) {
    state.current = player.station;
    saveLastStation(player.station);
    if (lastPlaySuccessId !== player.station.stationuuid) {
      lastPlaySuccessId = player.station.stationuuid;
      playSuccessCount++;
      if (playSuccessCount === 2 && deferredInstall) renderMain();
    }
    document.title = `${player.station.name} — World Radio`;
  } else if (player.station && !player.error) {
    state.current = player.station;
    document.title = state.current
      ? `${state.current.name} — World Radio`
      : 'World Radio — Relax & Listen';
  } else {
    document.title = state.current
      ? `${state.current.name} — World Radio`
      : 'World Radio — Relax & Listen';
  }
  document.body.classList.toggle('is-playing', player.playing);
  renderPlayer();
  syncMediaSession();
  updateHeroResumeUI();
  if (state.view === 'map') {
    highlightMapStation(state.current?.stationuuid ?? player.station?.stationuuid ?? null);
  }
  syncMapNowPlaying(state.current ?? player.station);
  syncMapHud(state.current ?? player.station);
  syncListenClock();

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
    (state.detailStation?.stationuuid === id ? state.detailStation : undefined) ||
    getMapStations().find((s) => s.stationuuid === id)
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
  else if (state.view === 'map') refreshMapStations();
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
      if (state.view === 'countries' && view === 'countries' && state.selectedCountry) {
        state.selectedCountry = null;
        persistPrefs();
      }
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
      action === 'recent-filter' ||
      action === 'set-fav-group' ||
      action === 'https-only' ||
      action === 'random-all-genres' ||
      action === 'import-favs' ||
      action === 'map-style'
    ) {
      return;
    }

    switch (action) {
      case 'random-country':
        handlePickRandomCountry();
        break;
      case 'random-genre':
        handlePickRandomGenre();
        break;
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
      case 'close-station':
        closePlayerAndCleanActivity();
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
      case 'open-map':
        setView('map');
        break;
      case 'map-locate':
        locateOnMap();
        break;
      case 'map-wander':
        void playWander();
        break;
      case 'map-reveal':
        if (!revealMapWander(false)) showToast('Nothing to reveal');
        break;
      case 'map-passport':
        togglePassportPanel();
        break;
      case 'map-stamp-goto': {
        const lat = Number(t.dataset.lat);
        const lon = Number(t.dataset.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) break;
        gotoMapStamp({
          lat,
          lon,
          kind: t.dataset.kind === 'country' ? 'country' : 'station',
          stationuuid: t.dataset.id,
        });
        break;
      }
      case 'map-now-playing': {
        const raw = state.current ?? player.station;
        if (!raw) {
          showToast('Nothing is playing');
          break;
        }
        if (isMapBlind()) {
          revealMapWander(false);
          break;
        }
        const station = findStation(raw.stationuuid) ?? raw;
        if (!flyToNowPlaying(station)) {
          showToast('This station has no map location');
        }
        break;
      }
      case 'map-alert-ok':
        dismissMapAlert();
        break;
      case 'show-on-map': {
        const id = t.dataset.id;
        const station = id ? findStation(id) : state.detailStation;
        if (!station || typeof station.geo_lat !== 'number' || typeof station.geo_long !== 'number') {
          showToast('This station has no map location');
          break;
        }
        state.detailStation = null;
        renderDetail();
        setView('map');
        flyToMap(station.geo_lat, station.geo_long, 10);
        break;
      }
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
        if (state.view === 'countries' && state.selectedCountry) {
          state.selectedTag = tag || null;
          state.isRandomGenre = false;
          persistPrefs();
          void loadCountryStations(state.selectedCountry, true, { autoPlayTag: true });
        } else {
          if (!tag) {
            state.selectedTag = null;
            state.nearMe = false;
            state.surpriseMode = null;
            state.view = 'discover';
            persistPrefs();
            if (!applyingRoute) setHash({ kind: 'view', view: 'discover' });
            void loadDiscover(true, { autoPlayTag: true });
          } else {
            openTag(tag, { autoPlayTag: true });
          }
        }
        break;
      }
      case 'surprise': {
        const mode: SurpriseMode = t.dataset.mode === 'here' ? 'here' : 'anywhere';
        void playSurprise(mode);
        break;
      }
      case 'surprise-again':
        if (lastHereCtx) void playSurprise('here', lastHereCtx);
        else void playSurprise('here');
        break;
      case 'play-period':
        playPeriodMix();
        break;
      case 'install-app':
        void promptInstall();
        break;
      case 'toggle-https-chip':
        state.httpsOnly = !state.httpsOnly;
        persistPrefs();
        if (!state.httpsOnly) {
          showToast('HTTPS-only off — remaining HTTP streams may be blocked on this site');
        }
        renderMain();
        renderPlayer();
        reloadCurrentList();
        break;
      case 'fav-group-filter':
        state.favoriteGroupFilter = t.dataset.group || null;
        persistPrefs();
        applyFavoriteFilter();
        renderMain();
        break;
      case 'clear-recent':
        state.recent = [];
        state.recentQuery = '';
        saveRecent([]);
        if (state.view === 'recent') {
          state.stations = [];
          renderMain();
        }
        renderNav();
        showToast('History cleared');
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
      case 'toggle-fx-modal':
        toggleFxModal();
        break;
      case 'open-eq-tab':
        openFxModal('Equalizer');
        break;
      case 'close-fx-modal':
        closeFxModal();
        break;
      case 'toggle-fx': {
        const next = !player.fxEnabled;
        player.setFxEnabled(next);
        renderFxModal();
        renderPlayer();
        showToast(next ? 'Audio FX Enabled' : 'Audio FX Bypassed');
        break;
      }
      case 'toggle-eq': {
        const next = !player.eqEnabled;
        player.setEqEnabled(next);
        renderFxModal();
        renderPlayer();
        showToast(next ? 'Equalizer Active' : 'Equalizer Bypassed');
        break;
      }
      case 'select-fx-tab': {
        const tab = t.dataset.tab as ModalTab | undefined;
        if (tab) setFxModalTab(tab);
        break;
      }
      case 'select-fx-preset': {
        const id = t.dataset.id;
        if (id) {
          player.setFxPreset(id);
          player.setFxEnabled(true);
          renderFxModal();
          renderPlayer();
          const p = FX_PRESETS.find((preset) => preset.id === id);
          if (p) showToast(`Audio FX: ${p.emoji} ${p.name}`);
        }
        break;
      }
      case 'select-eq-preset': {
        const id = t.dataset.id;
        if (id) {
          player.setEqPreset(id);
          player.setEqEnabled(true);
          renderFxModal();
          renderPlayer();
          showToast(`EQ Mode: ${id.toUpperCase()}`);
        }
        break;
      }
      case 'save-custom-eq': {
        const input = document.getElementById('eq-preset-name-input') as HTMLInputElement | null;
        const name = input?.value.trim() || 'Custom Preset';
        const newPreset = player.saveCustomEqPreset(name);
        player.setEqEnabled(true);
        renderFxModal();
        renderPlayer();
        showToast(`Saved EQ Preset: ${newPreset.name}`);
        break;
      }
      case 'delete-custom-eq': {
        const id = t.dataset.id;
        if (id) {
          player.deleteCustomEqPreset(id);
          renderFxModal();
          renderPlayer();
          showToast('Deleted custom EQ preset');
        }
        break;
      }
      case 'reset-eq':
        player.setEqPreset('flat');
        renderFxModal();
        renderPlayer();
        showToast('Equalizer reset to Flat (0 dB)');
        break;
      case 'near-me':
        openNearMe();
        break;
      case 'resume': {
        const id = t.dataset.id;
        const station =
          (id
            ? findStation(id) ||
              state.recent.find((s) => s.stationuuid === id) ||
              (loadLastStation()?.stationuuid === id ? loadLastStation() : null)
            : null) || getLastStation();
        if (station) void playStation(station);
        break;
      }
      case 'country': {
        const code = t.dataset.code;
        if (code) openCountry(code, { autoPlay: true });
        break;
      }
      case 'continent':
        state.continentFilter = t.dataset.continent || null;
        persistPrefs();
        renderMain();
        break;
      case 'back-countries':
        state.selectedCountry = null;
        state.selectedTag = null;
        state.isRandomGenre = false;
        state.stations = [];
        persistPrefs();
        if (!applyingRoute) setHash({ kind: 'view', view: 'countries' });
        renderMain();
        break;
      case 'sort': {
        const sort = t.dataset.sort as SortId;
        if (!sort) return;
        state.sort = sort;
        persistPrefs();
        reloadCurrentList();
        if (sort === 'random') {
          showToast('Shuffled station list');
        }
        break;
      }
      case 'lang': {
        state.languageFilter = t.dataset.lang || null;
        persistPrefs();
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
      if (!state.httpsOnly) {
        showToast('HTTPS-only off — remaining HTTP streams may be blocked on this site');
      }
      reloadCurrentList();
      return;
    }
    if (t.dataset.action === 'random-all-genres' && t instanceof HTMLInputElement) {
      state.randomAllGenres = t.checked;
      persistPrefs();
      showToast(
        state.randomAllGenres
          ? '🎲 Random mode: full genre catalog'
          : '🎲 Random mode: curated moods'
      );
      renderMain();
      return;
    }
    if (t.dataset.action === 'tag-playback-behavior' && t instanceof HTMLSelectElement) {
      const mode = t.value as TagPlaybackBehavior;
      if (mode === 'keep' || mode === 'first' || mode === 'random') {
        state.tagPlaybackBehavior = mode;
        persistPrefs();
        const labels: Record<TagPlaybackBehavior, string> = {
          keep: 'On selection: Keep current station',
          first: 'On selection: Play 1st station',
          random: 'On selection: Play random station',
        };
        showToast(labels[mode]);
        renderMain();
      }
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
      persistPrefs();
      renderMain();
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

    if (action === 'recent-filter' && t instanceof HTMLInputElement) {
      state.recentQuery = t.value;
      applyRecentFilter();
      renderMain();
      const input = qs<HTMLInputElement>('[data-action="recent-filter"]');
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

    if (action === 'set-fav-group' && t instanceof HTMLInputElement) {
      const id = t.dataset.id;
      if (!id) return;
      const group = t.value.trim().slice(0, 40);
      state.favorites = state.favorites.map((s) =>
        s.stationuuid === id ? { ...s, group: group || undefined } : s
      );
      saveFavorites(state.favorites);
      if (state.detailStation?.stationuuid === id) {
        state.detailStation = { ...state.detailStation, group: group || undefined };
      }
      if (state.view === 'favorites') applyFavoriteFilter();
      return;
    }

    if (action === 'change-eq-band' && t instanceof HTMLInputElement) {
      const band = t.dataset.band as keyof EqBands | undefined;
      if (band) {
        const val = parseFloat(t.value);
        player.setEqBand(band, val);
        const label = t.closest('.eq-slider-col')?.querySelector('.eq-db-val');
        if (label) label.textContent = `${val > 0 ? '+' : ''}${val} dB`;
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

    if (t.classList.contains('station-card') && (ke.key === 'Enter' || ke.key === ' ')) {
      ke.preventDefault();
      ke.stopPropagation();
      const id = t.dataset.id;
      const station = id ? findStation(id) : undefined;
      if (station) {
        if (state.current?.stationuuid === station.stationuuid) togglePlayback();
        else void playStation(station);
      }
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
    if (isFxModalOpen()) {
      if (e.key === 'Escape') return;
      if ([' ', 'n', 'N', 'p', 'P', 'm', 'M', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        return;
      }
    }

    if (isTypingTarget(e.target)) {
      if (e.key === 'Escape') {
        (e.target as HTMLElement).blur();
      }
      return;
    }

    const target = e.target as HTMLElement | null;
    if (target?.closest('button, [role="button"], a, input, select, textarea')) {
      if (e.key === ' ' || e.key === 'Enter') return;
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
      case 'ArrowDown':
        e.preventDefault();
        applyVolume(state.volume - 0.05);
        renderPlayer();
        break;
      case 'ArrowRight':
      case 'ArrowUp':
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
        if (dismissMapAlert()) {
          break;
        } else if (closePassportPanel()) {
          break;
        } else if (state.detailStation) {
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

async function promptInstall() {
  if (!deferredInstall) {
    showToast('Use your browser menu to add World Radio to the home screen');
    return;
  }
  try {
    await deferredInstall.prompt();
  } catch {
    // ignore
  }
  deferredInstall = null;
  try {
    localStorage.setItem('world-radio:a2hs-dismissed', '1');
  } catch {
    // ignore
  }
  renderMain();
}

// ─── Boot ────────────────────────────────────────────────

player.setVolume(state.volume);
player.setMuted(state.muted, { silent: true });

player.subscribe(() => {
  updatePlaybackUI();
});

// Popup when FX/EQ cannot process a stream (CORS, silent graph, etc.) and dry play is used.
player.onNotice((msg) => {
  // Longer toast so dry-play notice is readable on iPad.
  showToast(msg, 5500);
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

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e as unknown as { prompt: () => Promise<unknown> };
  if (playSuccessCount >= 2) renderMain();
});

sleepTimer.restore();

renderAllChrome();
void ensureMeta();

const initialRoute = parseHash();
if (initialRoute) {
  void applyRouteFromHash();
} else if (prefs.view && prefs.view !== 'discover') {
  setView(prefs.view);
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
