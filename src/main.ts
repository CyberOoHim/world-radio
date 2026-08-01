import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/instrument-serif/400.css';
import './style.css';

import {
  CONTINENTS,
  MOOD_TAGS,
  getCountries,
  getStationsByCountry,
  getStationsByTag,
  getStationsByUuid,
  getTags,
  getTopStations,
  searchStations,
} from './api/radioBrowser';
import { player } from './player';
import {
  loadFavorites,
  loadRecent,
  loadVolume,
  saveFavorites,
  saveRecent,
  saveVolume,
} from './storage';
import type { AppState, Country, Station, ViewId } from './types';

const PAGE = 48;

const state: AppState = {
  view: 'discover',
  stations: [],
  countries: [],
  tags: [],
  favorites: loadFavorites(),
  recent: loadRecent(),
  current: null,
  playing: false,
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
};

let searchTimer: ReturnType<typeof setTimeout> | null = null;
let navOpen = false;
let totalStationHint = 0;

// ─── Icons ───────────────────────────────────────────────

const icons = {
  radio: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 5v2M12 17v2M5 12h2M17 12h2"/><path d="M7.05 7.05l1.4 1.4M15.55 15.55l1.4 1.4M7.05 16.95l1.4-1.4M15.55 8.45l1.4-1.4" opacity=".6"/></svg>`,
  discover: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M14.5 9.5l-2.2 5.3-2.3-2.3z"/></svg>`,
  globe: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/></svg>`,
  music: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2.5"/><circle cx="17" cy="16" r="2.5"/></svg>`,
  heart: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s-7-4.5-7-10a4 4 0 017-2.5A4 4 0 0119 11c0 5.5-7 10-7 10z"/></svg>`,
  heartFill: `<svg class="icon" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.2"><path d="M12 21s-7-4.5-7-10a4 4 0 017-2.5A4 4 0 0119 11c0 5.5-7 10-7 10z"/></svg>`,
  clock: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  search: `<svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>`,
  play: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`,
  volume: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="20" height="20"><path d="M4 10v4h3l5 4V6L7 10H4z"/><path d="M16 9a4 4 0 010 6M18.5 7a7 7 0 010 10"/></svg>`,
  mute: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="20" height="20"><path d="M4 10v4h3l5 4V6L7 10H4z"/><path d="M18 10l4 4M22 10l-4 4"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`,
  loader: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><circle cx="12" cy="12" r="9" opacity=".25"/><path d="M21 12a9 9 0 00-9-9"/></svg>`,
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isFav(id: string): boolean {
  return state.favorites.includes(id);
}

function toggleFavorite(station: Station) {
  if (isFav(station.stationuuid)) {
    state.favorites = state.favorites.filter((id) => id !== station.stationuuid);
  } else {
    state.favorites = [station.stationuuid, ...state.favorites];
  }
  saveFavorites(state.favorites);
  render();
}

function pushRecent(station: Station) {
  const rest = state.recent.filter((s) => s.stationuuid !== station.stationuuid);
  state.recent = [station, ...rest].slice(0, 40);
  saveRecent(state.recent);
}

async function playStation(station: Station) {
  state.current = station;
  pushRecent(station);
  render();
  await player.play(station);
}

// ─── Data loading ────────────────────────────────────────

async function loadDiscover(reset = true) {
  if (reset) {
    state.loading = true;
    state.error = null;
    state.offset = 0;
    state.stations = [];
    render();
  } else {
    state.loadingMore = true;
    render();
  }

  try {
    let list: Station[];
    if (state.selectedTag) {
      list = await getStationsByTag(state.selectedTag, PAGE, state.offset);
    } else {
      list = await getTopStations(PAGE, state.offset);
    }
    state.stations = reset ? list : [...state.stations, ...list];
    state.hasMore = list.length >= PAGE;
    state.offset += list.length;
    if (reset && !state.selectedTag) {
      totalStationHint = Math.max(totalStationHint, 30000);
    }
  } catch (e) {
    state.error = e instanceof Error ? e.message : 'Failed to load stations';
  } finally {
    state.loading = false;
    state.loadingMore = false;
    render();
  }
}

async function loadSearch(q: string, reset = true) {
  if (reset) {
    state.loading = true;
    state.error = null;
    state.offset = 0;
    state.stations = [];
    render();
  } else {
    state.loadingMore = true;
    render();
  }

  try {
    const list = await searchStations({
      name: q,
      limit: PAGE,
      offset: state.offset,
      order: 'clickcount',
      reverse: true,
    });
    state.stations = reset ? list : [...state.stations, ...list];
    state.hasMore = list.length >= PAGE;
    state.offset += list.length;
  } catch (e) {
    state.error = e instanceof Error ? e.message : 'Search failed';
  } finally {
    state.loading = false;
    state.loadingMore = false;
    render();
  }
}

async function loadCountryStations(code: string, reset = true) {
  if (reset) {
    state.loading = true;
    state.error = null;
    state.offset = 0;
    state.stations = [];
    render();
  } else {
    state.loadingMore = true;
    render();
  }

  try {
    const list = await getStationsByCountry(code, PAGE, state.offset);
    state.stations = reset ? list : [...state.stations, ...list];
    state.hasMore = list.length >= PAGE;
    state.offset += list.length;
  } catch (e) {
    state.error = e instanceof Error ? e.message : 'Failed to load country stations';
  } finally {
    state.loading = false;
    state.loadingMore = false;
    render();
  }
}

async function ensureMeta() {
  try {
    const [countries, tags] = await Promise.all([getCountries(), getTags(150)]);
    state.countries = countries;
    state.tags = tags;
    totalStationHint = countries.reduce((sum, c) => sum + c.stationcount, 0);
  } catch {
    // non-fatal; browse views can retry
  }
  render();
}

async function loadFavoritesStations() {
  state.loading = true;
  state.error = null;
  state.hasMore = false;
  render();

  try {
    if (state.favorites.length === 0) {
      state.stations = [];
    } else {
      // Resolve favorites from recent first, then fetch missing by uuid batch via search
      const byId = new Map<string, Station>();
      for (const s of state.recent) byId.set(s.stationuuid, s);
      for (const s of state.stations) byId.set(s.stationuuid, s);

      const missing = state.favorites.filter((id) => !byId.has(id));
      if (missing.length > 0) {
        const stations = await fetchStationsByUuids(missing);
        for (const s of stations) byId.set(s.stationuuid, s);
      }

      state.stations = state.favorites
        .map((id) => byId.get(id))
        .filter((s): s is Station => Boolean(s));
    }
  } catch (e) {
    state.error = e instanceof Error ? e.message : 'Failed to load favorites';
  } finally {
    state.loading = false;
    render();
  }
}

async function fetchStationsByUuids(uuids: string[]): Promise<Station[]> {
  // API: POST /json/stations/byuuid with body as comma-separated or one per line
  // Use search by uuid via GET /json/stations/byuuid/{uuid} in batches
  const results: Station[] = [];
  const chunk = 20;
  for (let i = 0; i < uuids.length; i += chunk) {
    const slice = uuids.slice(i, i + chunk);
    const settled = await Promise.allSettled(
      slice.map(async (uuid) => {
        const list = await searchStationsByUuid(uuid);
        return list[0];
      })
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) results.push(r.value);
    }
  }
  return results;
}

async function searchStationsByUuid(uuid: string): Promise<Station[]> {
  try {
    return await getStationsByUuid(uuid);
  } catch {
    return [];
  }
}

// ─── Navigation ──────────────────────────────────────────

function setView(view: ViewId) {
  state.view = view;
  state.selectedCountry = null;
  state.selectedTag = view === 'discover' ? state.selectedTag : null;
  if (view !== 'discover') state.selectedTag = null;
  navOpen = false;

  if (view === 'discover') {
    void loadDiscover(true);
  } else if (view === 'countries') {
    state.loading = state.countries.length === 0;
    state.stations = [];
    state.error = null;
    if (state.countries.length === 0) void ensureMeta().then(() => {
      state.loading = false;
      render();
    });
    else {
      state.loading = false;
      render();
    }
  } else if (view === 'genres') {
    state.loading = state.tags.length === 0;
    state.stations = [];
    state.error = null;
    if (state.tags.length === 0) void ensureMeta().then(() => {
      state.loading = false;
      render();
    });
    else {
      state.loading = false;
      render();
    }
  } else if (view === 'favorites') {
    void loadFavoritesStations();
  } else if (view === 'recent') {
    state.stations = [...state.recent];
    state.loading = false;
    state.hasMore = false;
    state.error = null;
    render();
  } else if (view === 'search') {
    if (state.query.trim()) void loadSearch(state.query.trim(), true);
    else {
      state.stations = [];
      state.loading = false;
      render();
    }
  }
}

function openCountry(code: string) {
  state.view = 'countries';
  state.selectedCountry = code;
  void loadCountryStations(code, true);
}

function openTag(tag: string) {
  state.view = 'discover';
  state.selectedTag = tag;
  void loadDiscover(true);
}

// ─── Render ──────────────────────────────────────────────

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

  return `
    <article class="station-card ${current ? 'is-current' : ''}" data-id="${escapeHtml(station.stationuuid)}">
      <div class="station-card-top">
        ${stationArtHtml(station)}
        <div class="station-info">
          <div class="station-name" title="${escapeHtml(station.name)}">${escapeHtml(station.name)}</div>
          <div class="station-meta">
            ${country ? `<span>${flag} ${escapeHtml(country)}</span>` : ''}
            ${station.bitrate ? `<span class="dot"></span><span>${station.bitrate} kbps</span>` : ''}
          </div>
          ${
            tags.length
              ? `<div class="station-tags">${tags
                  .map((t) => `<span class="tag-pill">${escapeHtml(t)}</span>`)
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
        <button type="button" class="btn-icon ${fav ? 'is-fav' : ''}" data-action="fav" data-id="${escapeHtml(station.stationuuid)}" title="${fav ? 'Remove favorite' : 'Add favorite'}" aria-label="Favorite">
          ${fav ? icons.heartFill : icons.heart}
        </button>
      </div>
    </article>
  `;
}

function stationsSection(title: string, meta?: string): string {
  if (state.loading && state.stations.length === 0) {
    return `
      <div class="loading-box">
        <div class="spinner"></div>
        <p>Tuning into the world…</p>
      </div>
    `;
  }
  if (state.error && state.stations.length === 0) {
    return `<div class="error-box">${escapeHtml(state.error)}</div>`;
  }
  if (state.stations.length === 0) {
    return `<div class="empty"><p>${emptyMessage()}</p></div>`;
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
  return `
    <section class="hero">
      <h2>Listen to the world, softly.</h2>
      <p>Thousands of live radio stations from every continent — jazz at midnight in Tokyo, classical in Vienna, ambient from the coast. Pick a mood or drift through the globe.</p>
    </section>
    <div class="section-head"><h3>Moods &amp; genres</h3></div>
    <div class="chip-row">
      <button type="button" class="chip ${!state.selectedTag ? 'active' : ''}" data-action="tag" data-tag="">
        ✨ Popular
      </button>
      ${MOOD_TAGS.map(
        (t) => `
        <button type="button" class="chip ${state.selectedTag === t.id ? 'active' : ''}" data-action="tag" data-tag="${escapeHtml(t.id)}">
          ${t.emoji} ${escapeHtml(t.label)}
        </button>`
      ).join('')}
    </div>
    ${stationsSection(
      state.selectedTag
        ? MOOD_TAGS.find((t) => t.id === state.selectedTag)?.label || state.selectedTag
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
    <div class="continent-tabs">
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

function renderGenres(): string {
  if (state.selectedTag && state.view === 'genres') {
    // we use discover for tag stations; keep simple list
  }

  if (state.loading) {
    return `<div class="loading-box"><div class="spinner"></div><p>Loading genres…</p></div>`;
  }

  return `
    <section class="hero">
      <h2>Find your frequency.</h2>
      <p>From ambient and classical to local news and world music — pick a genre and explore.</p>
    </section>
    <div class="section-head">
      <h3>Popular moods</h3>
    </div>
    <div class="chip-row" style="margin-bottom:28px">
      ${MOOD_TAGS.map(
        (t) => `
        <button type="button" class="chip" data-action="tag" data-tag="${escapeHtml(t.id)}">
          ${t.emoji} ${escapeHtml(t.label)}
        </button>`
      ).join('')}
    </div>
    <div class="section-head">
      <h3>All genres</h3>
      <span class="meta">${state.tags.length} tags</span>
    </div>
    <div class="browse-grid">
      ${state.tags
        .map(
          (t) => `
        <button type="button" class="browse-card" data-action="tag" data-tag="${escapeHtml(t.name)}">
          <div class="title">${escapeHtml(t.name)}</div>
          <div class="count">${t.stationcount.toLocaleString()} stations</div>
        </button>`
        )
        .join('')}
    </div>
  `;
}

function renderMain(): string {
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
        ${stationsSection('Stations', `${state.stations.length}${state.hasMore ? '+' : ''}`)}
      `;
    default:
      return '';
  }
}

function renderPlayer(): string {
  const s = state.current;
  if (!s) {
    return `<div class="player-placeholder">Choose a station and let the world drift in…</div>`;
  }

  const playing = player.playing;
  const loading = player.loading;
  const err = player.error;
  const country = s.country || s.countrycode || '';

  return `
    <div class="player-now">
      ${stationArtHtml(s, `player-art ${playing ? 'live' : ''}`)}
      <div class="player-meta">
        <div class="now-label">${loading ? 'Connecting…' : playing ? 'Now playing' : 'Paused'}</div>
        <div class="now-name" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</div>
        <div class="now-sub">${countryFlag(s.countrycode)} ${escapeHtml(country)}${s.bitrate ? ` · ${s.bitrate} kbps` : ''}</div>
        ${err ? `<div class="now-error">${escapeHtml(err)}</div>` : ''}
      </div>
    </div>
    <div class="player-controls">
      <div class="eq ${playing ? 'on' : ''}" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
      <button type="button" class="btn-main-play" data-action="toggle-play" aria-label="${playing ? 'Pause' : 'Play'}" ${loading && !playing ? '' : ''}>
        ${loading && !playing ? icons.loader : playing ? icons.pause : icons.play}
      </button>
      <button type="button" class="btn-icon ${isFav(s.stationuuid) ? 'is-fav' : ''}" data-action="fav" data-id="${escapeHtml(s.stationuuid)}" title="Favorite">
        ${isFav(s.stationuuid) ? icons.heartFill : icons.heart}
      </button>
    </div>
    <div class="player-volume">
      <button type="button" class="btn-icon" data-action="mute" title="${state.muted ? 'Unmute' : 'Mute'}">
        ${state.muted || state.volume === 0 ? icons.mute : icons.volume}
      </button>
      <input type="range" class="volume-slider" min="0" max="1" step="0.01" value="${state.muted ? 0 : state.volume}" data-action="volume" aria-label="Volume" />
    </div>
  `;
}

function render() {
  const app = document.querySelector('#app');
  if (!app) return;

  const playing = player.playing;
  document.body.classList.toggle('is-playing', playing);

  const stationCountLabel =
    totalStationHint > 0
      ? `${Math.round(totalStationHint / 1000) * 1000 >= 1000 ? `${Math.floor(totalStationHint / 1000)}k+` : totalStationHint} stations`
      : 'World stations';

  app.innerHTML = `
    <div class="nav-backdrop ${navOpen ? 'open' : ''}" data-action="close-nav"></div>
    <aside class="nav ${navOpen ? 'open' : ''}">
      <div class="brand">
        <div class="brand-mark">${icons.radio}</div>
        <div class="brand-text">
          <h1>World Radio</h1>
          <p>Relax &amp; listen</p>
        </div>
      </div>
      <div class="nav-section">Explore</div>
      <button type="button" class="nav-btn ${state.view === 'discover' ? 'active' : ''}" data-view="discover">
        ${icons.discover} Discover
      </button>
      <button type="button" class="nav-btn ${state.view === 'countries' ? 'active' : ''}" data-view="countries">
        ${icons.globe} Countries
      </button>
      <button type="button" class="nav-btn ${state.view === 'genres' ? 'active' : ''}" data-view="genres">
        ${icons.music} Genres
      </button>
      <div class="nav-section">Library</div>
      <button type="button" class="nav-btn ${state.view === 'favorites' ? 'active' : ''}" data-view="favorites">
        ${icons.heart} Favorites
      </button>
      <button type="button" class="nav-btn ${state.view === 'recent' ? 'active' : ''}" data-view="recent">
        ${icons.clock} Recent
      </button>
      <div class="nav-footer">
        Streams via <a href="https://www.radio-browser.info/" target="_blank" rel="noopener">Radio Browser</a>
        — community-powered, free radio directory.
      </div>
    </aside>
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
            value="${escapeHtml(state.query)}"
            data-action="search"
            autocomplete="off"
            spellcheck="false"
          />
        </div>
        <div class="stats-pill"><strong>${stationCountLabel}</strong> online</div>
      </div>
      <div class="content">
        ${renderMain()}
      </div>
    </main>
    <footer class="player">
      ${renderPlayer()}
    </footer>
  `;

  bindEvents();
}

function findStation(id: string): Station | undefined {
  return (
    state.stations.find((s) => s.stationuuid === id) ||
    state.recent.find((s) => s.stationuuid === id) ||
    (state.current?.stationuuid === id ? state.current : undefined)
  );
}

function bindEvents() {
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view as ViewId;
      setView(view);
    });
  });

  document.querySelectorAll<HTMLElement>('[data-action]').forEach((el) => {
    const action = el.dataset.action;
    if (action === 'search') {
      el.addEventListener('input', () => {
        const input = el as HTMLInputElement;
        state.query = input.value;
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          const q = state.query.trim();
          if (q.length >= 2) {
            state.view = 'search';
            state.selectedCountry = null;
            state.selectedTag = null;
            void loadSearch(q, true);
          } else if (q.length === 0 && state.view === 'search') {
            setView('discover');
          }
        }, 350);
      });
      el.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') {
          const q = state.query.trim();
          if (q) {
            state.view = 'search';
            void loadSearch(q, true);
          }
        }
      });
      return;
    }

    if (action === 'volume') {
      el.addEventListener('input', () => {
        const v = Number((el as HTMLInputElement).value);
        state.volume = v;
        state.muted = v === 0;
        player.setVolume(v);
        player.setMuted(state.muted);
        saveVolume(v);
      });
      return;
    }

    el.addEventListener('click', () => {
      switch (action) {
        case 'play': {
          const id = el.dataset.id!;
          const station = findStation(id);
          if (!station) return;
          if (state.current?.stationuuid === id && player.playing) {
            player.toggle();
          } else {
            void playStation(station);
          }
          break;
        }
        case 'toggle-play':
          player.toggle();
          break;
        case 'fav': {
          const id = el.dataset.id!;
          const station = findStation(id);
          if (station) toggleFavorite(station);
          break;
        }
        case 'mute':
          state.muted = !state.muted;
          player.setMuted(state.muted);
          render();
          break;
        case 'more':
          void loadMore();
          break;
        case 'tag': {
          const tag = el.dataset.tag ?? '';
          if (!tag) {
            state.selectedTag = null;
            state.view = 'discover';
            void loadDiscover(true);
          } else {
            openTag(tag);
          }
          break;
        }
        case 'country': {
          const code = el.dataset.code!;
          openCountry(code);
          break;
        }
        case 'continent': {
          state.continentFilter = el.dataset.continent || null;
          render();
          break;
        }
        case 'back-countries':
          state.selectedCountry = null;
          state.stations = [];
          render();
          break;
        case 'toggle-nav':
          navOpen = !navOpen;
          render();
          break;
        case 'close-nav':
          navOpen = false;
          render();
          break;
      }
    });
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
  state.playing = player.playing;
  state.current = player.station ?? state.current;
  // Light re-render for player chrome without full thrash if possible
  render();
});

render();
void ensureMeta();
void loadDiscover(true);
