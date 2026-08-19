import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { getStationsInViewport, type SearchParams } from './api/radioBrowser';
import { escapeHtml } from './html';
import {
  formatSolarClock,
  isBrowserOffline,
  localSolarHour,
  OFFLINE_MAP_ALERT,
  resolveStationMapTarget,
  shouldLoadPins,
  solarMoodLabel,
  solarPeriodFromHour,
  STATION_PIN_ZOOM,
  stationCoords,
  type SolarPeriod,
  viewportRadiusMeters,
  type MapBounds,
} from './mapGeo';
import {
  countrySealPosition,
  isStationStamped,
  latestStampPerCountry,
  passportStats,
  routeStampPoints,
  stampsNewestFirst,
  type PassportStamp,
} from './mapPassport';
import { MAP_STYLE_IDS, MAP_STYLES, sanitizeMapStyle, type MapStyleId } from './mapStyle';
import { loadMapStyle, loadMapViewport, saveMapStyle, saveMapViewport } from './storage';
import type { Station } from './types';

export {
  isBrowserOffline,
  MIN_PIN_ZOOM,
  OFFLINE_MAP_ALERT,
  shouldLoadPins,
  viewportRadiusMeters,
} from './mapGeo';

const DEFAULT_CENTER: L.LatLngExpression = [20, 10];
const DEFAULT_ZOOM = 2;
const FETCH_DEBOUNCE_MS = 320;
const LOCATE_ZOOM = 9;
const STATION_ZOOM = STATION_PIN_ZOOM;
const BLIND_MS = 20_000;
const HUD_TICK_MS = 30_000;
const SEAL_MAX_ZOOM = 5;

export interface MapViewport {
  lat: number;
  lon: number;
  zoom: number;
}

export interface MapViewHandlers {
  isFavorite: (uuid: string) => boolean;
  getFilters: () => SearchParams;
  onStations: (stations: Station[]) => void;
  onViewport: (viewport: MapViewport) => void;
  toast: (message: string) => void;
  playStamp?: (uuid: string) => void;
}

function countryFlag(code: string): string {
  if (!code || code.length !== 2) return '📻';
  const cc = code.toUpperCase();
  return String.fromCodePoint(...[...cc].map((c) => 127397 + c.charCodeAt(0)));
}

function stationHasGeo(
  station: Station
): station is Station & { geo_lat: number; geo_long: number } {
  return stationCoords(station) != null;
}

let map: L.Map | null = null;
let tiles: L.TileLayer | null = null;
let currentStyle: MapStyleId = loadMapStyle();
let markersLayer: L.LayerGroup | null = null;
let stampsLayer: L.LayerGroup | null = null;
let handlers: MapViewHandlers | null = null;
let fetchTimer: ReturnType<typeof setTimeout> | null = null;
let fetchSeq = 0;
let visible = false;
let lastStations: Station[] = [];
let markerById = new Map<string, L.Marker>();
let playingId: string | null = null;
let pendingPopupId: string | null = null;
let offlineAlertShown = false;
let resizeBound = false;
let netBound = false;
let pendingView: { center: L.LatLngExpression; zoom: number } | null = null;
let lastPassport: PassportStamp[] = [];
let hudStation: Station | null = null;
let hudTimer: ReturnType<typeof setInterval> | null = null;
let wanderBusy = false;
let blind: { station: Station; timer: ReturnType<typeof setTimeout> } | null = null;
let passportOpen = false;

export function getMapStations(): Station[] {
  return lastStations;
}

export function getMapViewport(): MapViewport | null {
  if (!map) return null;
  const c = map.getCenter();
  return { lat: c.lat, lon: c.lng, zoom: map.getZoom() };
}

export function getMapBounds(): MapBounds | null {
  if (!map) return null;
  const b = map.getBounds();
  return {
    south: b.getSouth(),
    west: b.getWest(),
    north: b.getNorth(),
    east: b.getEast(),
  };
}

export function dismissMapAlert(): boolean {
  const dialog = document.querySelector<HTMLElement>('.map-alert-dialog');
  if (!dialog || dialog.hidden) return false;
  dialog.hidden = true;
  return true;
}

function alertEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.map-offline-banner');
}

function statusEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.map-status');
}

function nowPlayingBtn(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('[data-action="map-now-playing"]');
}

function wanderBtn(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('[data-action="map-wander"]');
}

function passportBtn(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('[data-action="map-passport"]');
}

function styleSelect(): HTMLSelectElement | null {
  return document.querySelector<HTMLSelectElement>('[data-action="map-style"]');
}

function styleSelectHtml(): string {
  const options = MAP_STYLE_IDS.map((id) => {
    const spec = MAP_STYLES[id];
    return `<option value="${spec.id}"${id === currentStyle ? ' selected' : ''}>${escapeHtml(spec.label)}</option>`;
  }).join('');
  return `<label class="map-style-field"><span class="sr-only">Map style</span><select class="select-compact map-style-select" data-action="map-style" aria-label="Map style">${options}</select></label>`;
}

function tileLayerFor(id: MapStyleId): L.TileLayer {
  const spec = MAP_STYLES[id];
  const options: L.TileLayerOptions = {
    attribution: spec.attribution,
    maxZoom: spec.maxZoom,
    className: 'map-tiles',
  };
  if (spec.subdomains) options.subdomains = spec.subdomains;
  if (spec.maxNativeZoom != null) options.maxNativeZoom = spec.maxNativeZoom;
  return L.tileLayer(spec.url, options);
}

function syncStyleChrome(): void {
  const el = styleSelect();
  if (el && el.value !== currentStyle) el.value = currentStyle;
  const canvas = document.querySelector<HTMLElement>('.map-canvas');
  if (!canvas) return;
  canvas.classList.remove('is-style-streets', 'is-style-terrain', 'is-style-satellite');
  canvas.classList.add(`is-style-${currentStyle}`);
}

export function getMapStyle(): MapStyleId {
  return currentStyle;
}

export function setMapStyle(next: unknown): MapStyleId {
  const id = sanitizeMapStyle(next);
  if (id !== currentStyle) {
    currentStyle = id;
    saveMapStyle(id);
    if (map) {
      if (tiles) {
        map.removeLayer(tiles);
        tiles = null;
      }
      tiles = tileLayerFor(id).addTo(map);
    }
  }
  syncStyleChrome();
  return currentStyle;
}

function bindStyleSelect(): void {
  const el = styleSelect();
  if (!el || el.dataset.bound === '1') return;
  el.dataset.bound = '1';
  el.addEventListener('change', () => {
    setMapStyle(el.value);
  });
}

function hudEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.map-hud');
}

function passportPanelEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.map-passport-panel');
}

export function syncMapNowPlaying(station: Station | null): void {
  const btn = nowPlayingBtn();
  if (!btn) return;
  btn.disabled = !station;
  if (!station) {
    btn.title = 'Nothing is playing';
    return;
  }
  const target = resolveStationMapTarget(station);
  btn.title = target
    ? `Center the map on ${station.name}`
    : `${station.name} has no map location`;
}

export function setMapWanderBusy(busy: boolean): void {
  wanderBusy = busy;
  const btn = wanderBtn();
  if (!btn) return;
  btn.disabled = busy;
  btn.textContent = busy ? 'Tuning…' : '🧭 Wander';
  btn.title = busy ? 'Finding a station somewhere else' : 'Hop to a live station somewhere else';
}

export function isMapBlind(): boolean {
  return blind != null;
}

function placeCaption(station: Station): string {
  const city = (station.state || '').trim();
  const country = (station.country || station.countrycode || '').trim();
  if (city && country && city.toLowerCase() !== country.toLowerCase()) {
    return `${city}, ${country}`;
  }
  return country || station.name;
}

function solarForStation(station: Station): { lon: number; hour: number; period: SolarPeriod } | null {
  const target = resolveStationMapTarget(station);
  if (!target) return null;
  const hour = localSolarHour(target.lon);
  return { lon: target.lon, hour, period: solarPeriodFromHour(hour) };
}

function renderHud() {
  const el = hudEl();
  if (!el) return;
  if (blind) {
    el.hidden = false;
    el.classList.add('is-blind');
    el.innerHTML = `
      <div class="map-hud-kicker">Shortwave</div>
      <div class="map-hud-clock">??:??</div>
      <div class="map-hud-place">Somewhere on the air · listen…</div>
      <button type="button" class="chip" data-action="map-reveal">Reveal</button>
    `;
    return;
  }
  const station = hudStation;
  if (!station) {
    el.hidden = true;
    el.classList.remove('is-blind');
    el.innerHTML = '';
    return;
  }
  const solar = solarForStation(station);
  const place = placeCaption(station);
  el.hidden = false;
  el.classList.remove('is-blind');
  if (solar) {
    el.innerHTML = `
      <div class="map-hud-kicker">Local sun</div>
      <div class="map-hud-clock">${escapeHtml(formatSolarClock(solar.lon))}</div>
      <div class="map-hud-place">in ${escapeHtml(place)} · ${escapeHtml(solarMoodLabel(solar.hour))}</div>
    `;
  } else {
    el.innerHTML = `
      <div class="map-hud-kicker">Now playing</div>
      <div class="map-hud-clock">${escapeHtml(station.name)}</div>
      <div class="map-hud-place">${escapeHtml(place)}</div>
    `;
  }
}

export function syncMapHud(station: Station | null): void {
  hudStation = station;
  renderHud();
}

function renderPassportChip() {
  const btn = passportBtn();
  if (!btn) return;
  const stats = passportStats(lastPassport);
  btn.textContent = `✦ ${stats.countries} / ${stats.total}`;
  btn.title =
    stats.countries === 0
      ? 'Passport — listen to stamp countries'
      : `Passport · ${stats.countries} ${stats.countries === 1 ? 'country' : 'countries'} · ${stats.cities} ${stats.cities === 1 ? 'city' : 'cities'}`;
  btn.classList.toggle('active', passportOpen);
}

function renderPassportPanel() {
  const panel = passportPanelEl();
  if (!panel) return;
  panel.hidden = !passportOpen;
  if (!passportOpen) return;
  const stats = passportStats(lastPassport);
  const rows = stampsNewestFirst(lastPassport);
  const list = rows.length
    ? rows
        .map((stamp) => {
          const flag = countryFlag(stamp.countrycode);
          const title = escapeHtml(stamp.country);
          const detail = [stamp.stationName, stamp.place].filter(Boolean).join(' · ');
          const idAttr = stamp.stationuuid
            ? ` data-id="${escapeHtml(stamp.stationuuid)}"`
            : '';
          return `<button type="button" class="map-stamp-row" data-action="map-stamp-goto"${idAttr} data-lat="${stamp.lat}" data-lon="${stamp.lon}" data-kind="${stamp.kind}">
            <span class="map-stamp-flag">${flag}</span>
            <span class="map-stamp-copy">
              <strong>${title}</strong>
              ${detail ? `<span>${escapeHtml(detail)}</span>` : ''}
            </span>
          </button>`;
        })
        .join('')
    : `<p class="map-passport-empty">Listen for about 90 seconds to stamp a place. Stations in Recents are already in your book.</p>`;
  panel.innerHTML = `
    <div class="map-passport-head">
      <strong>Passport</strong>
      <span>${stats.countries} / ${stats.total} countries · ${stats.cities} ${stats.cities === 1 ? 'city' : 'cities'}</span>
    </div>
    <div class="map-passport-list">${list}</div>
  `;
}

function sealIcon(stamp: PassportStamp): L.DivIcon {
  return L.divIcon({
    className: 'map-seal-wrap',
    html: `<span class="map-seal" title="${escapeHtml(stamp.country)}">${countryFlag(stamp.countrycode)}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function renderStampLayer() {
  if (!stampsLayer || !map) return;
  stampsLayer.clearLayers();
  const route = routeStampPoints(lastPassport, 12);
  if (route.length >= 2) {
    L.polyline(
      route.map((s) => [s.lat, s.lon] as L.LatLngExpression),
      {
        color: '#c4a06a',
        weight: 2,
        opacity: 0.72,
        dashArray: '5 8',
        interactive: false,
        className: 'map-route',
      }
    ).addTo(stampsLayer);
  }

  if (map.getZoom() > SEAL_MAX_ZOOM) return;
  for (const stamp of latestStampPerCountry(lastPassport)) {
    const pos = countrySealPosition(stamp);
    const marker = L.marker([pos.lat, pos.lon], {
      icon: sealIcon(stamp),
      keyboard: true,
      title: stamp.country,
      zIndexOffset: -200,
    });
    marker.on('click', () => {
      gotoMapStamp({
        lat: stamp.lat,
        lon: stamp.lon,
        kind: stamp.kind,
        stationuuid: stamp.stationuuid,
      });
    });
    marker.addTo(stampsLayer);
  }
}

export function syncMapPassport(stamps: PassportStamp[]): void {
  lastPassport = stamps;
  renderPassportChip();
  renderPassportPanel();
  renderStampLayer();
  if (lastStations.length) setMarkers(lastStations);
}

export function togglePassportPanel(): void {
  passportOpen = !passportOpen;
  renderPassportChip();
  renderPassportPanel();
}

export function closePassportPanel(): boolean {
  if (!passportOpen) return false;
  passportOpen = false;
  renderPassportChip();
  renderPassportPanel();
  return true;
}

export function gotoMapStamp(stamp: {
  lat: number;
  lon: number;
  kind?: 'station' | 'country';
  stationuuid?: string;
}): void {
  closePassportPanel();
  const zoom = stamp.kind === 'country' ? 5 : STATION_ZOOM;
  if (stamp.stationuuid) pendingPopupId = stamp.stationuuid;
  flyToMap(stamp.lat, stamp.lon, zoom);
  openPendingPopup(false);
  if (stamp.stationuuid) handlers?.playStamp?.(stamp.stationuuid);
}

function openPendingPopup(clear: boolean) {
  if (!pendingPopupId) return;
  const marker = markerById.get(pendingPopupId);
  if (!marker) return;
  marker.openPopup();
  if (clear) pendingPopupId = null;
}

function setStatus(text: string) {
  const el = statusEl();
  if (el) el.textContent = text;
}

function showOfflineBanner(show: boolean) {
  const banner = alertEl();
  if (banner) banner.hidden = !show;
}

function fireOfflineAlert() {
  showOfflineBanner(true);
  if (offlineAlertShown) return;
  offlineAlertShown = true;
  if (typeof window.alert === 'function') {
    window.alert(OFFLINE_MAP_ALERT);
  }
}

function clearOfflineAlert() {
  offlineAlertShown = false;
  showOfflineBanner(false);
}

function pinHtml(station: Station, playing: boolean): string {
  const mystery = Boolean(blind && blind.station.stationuuid === station.stationuuid);
  const solar = solarForStation(station);
  const period = solar?.period ?? 'day';
  const stamped = isStationStamped(lastPassport, station.stationuuid);
  const flag = mystery ? '✦' : countryFlag(station.countrycode);
  const title = mystery ? 'Somewhere on the air' : station.name;
  return `<span class="map-pin period-${period}${playing ? ' is-playing' : ''}${stamped ? ' is-stamped' : ''}${mystery ? ' is-mystery' : ''}" title="${escapeHtml(title)}"><span class="map-pin-flag">${flag}</span></span>`;
}

function popupHtml(station: Station): string {
  if (blind && blind.station.stationuuid === station.stationuuid) {
    return `
      <div class="map-popup">
        <div class="map-popup-name">Somewhere on the air</div>
        <div class="map-popup-meta">Listen — destination hidden</div>
        <div class="map-popup-actions">
          <button type="button" class="chip" data-action="map-reveal">Reveal</button>
        </div>
      </div>`;
  }
  const fav = handlers?.isFavorite(station.stationuuid);
  const country = station.country || station.countrycode || '';
  const solar = solarForStation(station);
  const clock = solar ? `${formatSolarClock(solar.lon)} · ${solarMoodLabel(solar.hour)}` : '';
  const meta = [
    country ? `${countryFlag(station.countrycode)} ${escapeHtml(country)}` : '',
    clock,
    station.bitrate ? `${station.bitrate} kbps` : '',
    station.codec ? escapeHtml(station.codec) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return `
    <div class="map-popup">
      <div class="map-popup-name">${escapeHtml(station.name)}</div>
      ${meta ? `<div class="map-popup-meta">${meta}</div>` : ''}
      <div class="map-popup-actions">
        <button type="button" class="chip" data-action="play" data-id="${escapeHtml(station.stationuuid)}">Listen</button>
        <button type="button" class="chip" data-action="fav" data-id="${escapeHtml(station.stationuuid)}">${fav ? '♥ Saved' : '♡ Save'}</button>
        <button type="button" class="chip" data-action="detail" data-id="${escapeHtml(station.stationuuid)}">Details</button>
      </div>
    </div>`;
}

function pinIcon(station: Station, playing: boolean): L.DivIcon {
  return L.divIcon({
    className: 'map-pin-wrap',
    html: pinHtml(station, playing),
    iconSize: [28, 36],
    iconAnchor: [14, 34],
    popupAnchor: [0, -28],
  });
}

function setMarkers(stations: Station[]) {
  if (!markersLayer) return;
  markersLayer.clearLayers();
  markerById = new Map();
  for (const station of stations) {
    if (!stationHasGeo(station)) continue;
    const playing = station.stationuuid === playingId;
    const marker = L.marker([station.geo_lat, station.geo_long], {
      icon: pinIcon(station, playing),
      title: blind && blind.station.stationuuid === station.stationuuid ? 'Somewhere on the air' : station.name,
      keyboard: true,
    });
    marker.bindPopup(popupHtml(station), { maxWidth: 280, className: 'map-leaflet-popup' });
    marker.addTo(markersLayer);
    markerById.set(station.stationuuid, marker);
  }
  openPendingPopup(true);
}

export function highlightMapStation(uuid: string | null) {
  const prev = playingId;
  playingId = uuid;
  if (prev && prev !== uuid) {
    const old = lastStations.find((s) => s.stationuuid === prev);
    const m = markerById.get(prev);
    if (old && m) m.setIcon(pinIcon(old, false));
  }
  if (uuid) {
    const cur = lastStations.find((s) => s.stationuuid === uuid);
    const m = markerById.get(uuid);
    if (cur && m) m.setIcon(pinIcon(cur, true));
  }
}

function persistViewport(lat: number, lon: number, zoom: number): void {
  saveMapViewport({ lat, lon, zoom });
}

function persistMapViewport(): void {
  if (!map) return;
  const c = map.getCenter();
  persistViewport(c.lat, c.lng, map.getZoom());
}

function reportViewport() {
  if (!map || !handlers) return;
  persistMapViewport();
  const c = map.getCenter();
  handlers.onViewport({ lat: c.lat, lon: c.lng, zoom: map.getZoom() });
}

async function loadViewportStations() {
  if (!map || !handlers || !visible) return;
  if (isBrowserOffline()) {
    setStatus('Offline — waiting for a connection');
    fireOfflineAlert();
    return;
  }

  const zoom = map.getZoom();
  if (!shouldLoadPins(zoom)) {
    lastStations = [];
    setMarkers([]);
    handlers.onStations([]);
    setStatus('Zoom in to load stations');
    renderStampLayer();
    return;
  }

  const b = map.getBounds();
  const radius = viewportRadiusMeters({
    south: b.getSouth(),
    west: b.getWest(),
    north: b.getNorth(),
    east: b.getEast(),
  });
  const center = map.getCenter();
  const seq = ++fetchSeq;
  setStatus('Loading stations…');

  try {
    const list = await getStationsInViewport(center.lat, center.lng, radius, handlers.getFilters());
    if (seq !== fetchSeq || !visible) return;
    const geo = list.filter(stationHasGeo);
    lastStations = geo;
    setMarkers(geo);
    handlers.onStations(geo);
    setStatus(
      geo.length
        ? `${geo.length}${list.length >= 200 ? '+' : ''} station${geo.length === 1 ? '' : 's'} in view`
        : 'No geo-tagged stations here — pan or zoom'
    );
  } catch {
    if (seq !== fetchSeq || !visible) return;
    if (isBrowserOffline()) {
      setStatus('Offline — waiting for a connection');
      fireOfflineAlert();
      return;
    }
    setStatus('Could not load stations — try again');
    handlers.toast('Could not load map stations');
  }
}

function scheduleFetch() {
  if (fetchTimer) clearTimeout(fetchTimer);
  fetchTimer = setTimeout(() => {
    fetchTimer = null;
    void loadViewportStations();
    reportViewport();
    renderStampLayer();
  }, FETCH_DEBOUNCE_MS);
}

function onOnline() {
  if (!visible) {
    offlineAlertShown = false;
    return;
  }
  clearOfflineAlert();
  tiles?.redraw();
  setStatus('Back online — loading stations…');
  handlers?.toast('Back online');
  void loadViewportStations();
}

function onOffline() {
  if (!visible) return;
  setStatus('Offline — waiting for a connection');
  fireOfflineAlert();
}

function bindNetwork() {
  if (netBound) return;
  netBound = true;
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  window.addEventListener('pagehide', persistMapViewport);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (visible) {
        renderHud();
        startHudClock();
      }
    } else {
      stopHudClock();
    }
  });
}

function bindResize() {
  if (resizeBound) return;
  resizeBound = true;
  window.addEventListener('resize', () => {
    if (visible && map) map.invalidateSize();
  });
}

function startHudClock() {
  if (hudTimer || !visible || document.visibilityState === 'hidden') return;
  hudTimer = setInterval(() => {
    if (visible && document.visibilityState !== 'hidden') renderHud();
  }, HUD_TICK_MS);
}

function stopHudClock() {
  if (!hudTimer) return;
  clearInterval(hudTimer);
  hudTimer = null;
}

function shellHtml(): string {
  return `
    <div class="map-offline-banner" role="alert" hidden>
      <strong>Offline.</strong> ${escapeHtml(OFFLINE_MAP_ALERT)}
    </div>
    <div class="map-toolbar">
      <button type="button" class="chip" data-action="map-wander" title="Hop to a live station somewhere else">🧭 Wander</button>
      <button type="button" class="chip" data-action="map-locate" title="Center the map on your location">📍 Near me</button>
      <button type="button" class="chip" data-action="map-now-playing" title="Nothing is playing" disabled>▶ Now playing</button>
      <button type="button" class="chip" data-action="map-passport" title="Passport — listen to stamp countries">✦ 0</button>
      ${styleSelectHtml()}
      <span class="map-status">Move the map to discover stations</span>
    </div>
    <div class="map-stage">
      <div class="map-canvas" role="application" aria-label="World radio map"></div>
      <div class="map-hud" hidden></div>
      <div class="map-passport-panel" hidden></div>
    </div>
  `;
}

function savedStartView(): { center: L.LatLngExpression; zoom: number } | null {
  const saved = loadMapViewport();
  if (!saved) return null;
  return { center: [saved.lat, saved.lon], zoom: saved.zoom };
}

function createMap(canvas: HTMLElement) {
  const start = pendingView ?? savedStartView();
  pendingView = null;
  map = L.map(canvas, {
    zoomControl: false,
    worldCopyJump: true,
    minZoom: 2,
    maxZoom: 18,
    attributionControl: true,
  }).setView(start?.center ?? DEFAULT_CENTER, start?.zoom ?? DEFAULT_ZOOM);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  currentStyle = loadMapStyle();
  tiles = tileLayerFor(currentStyle).addTo(map);
  syncStyleChrome();

  markersLayer = L.layerGroup().addTo(map);
  stampsLayer = L.layerGroup().addTo(map);
  map.on('moveend', () => {
    persistMapViewport();
    scheduleFetch();
  });
  persistMapViewport();
  renderStampLayer();
}

export function mountMapView(root: HTMLElement, nextHandlers: MapViewHandlers): void {
  handlers = nextHandlers;
  if (!root.querySelector('[data-action="map-wander"]')) {
    if (map) {
      map.remove();
      map = null;
      tiles = null;
      markersLayer = null;
      stampsLayer = null;
      markerById = new Map();
    }
    root.innerHTML = shellHtml();
  }
  const canvas = root.querySelector<HTMLElement>('.map-canvas');
  if (!canvas) return;
  if (!map) createMap(canvas);
  bindNetwork();
  bindResize();
  bindStyleSelect();
  syncStyleChrome();
  renderPassportChip();
  setMapWanderBusy(wanderBusy);
}

export function showMapView(opts?: { center?: [number, number]; zoom?: number }): void {
  const alreadyVisible = visible;
  visible = true;
  startHudClock();
  if (!map) return;
  if (opts?.center) {
    map.setView(opts.center, opts.zoom ?? Math.max(map.getZoom(), LOCATE_ZOOM));
  }
  requestAnimationFrame(() => {
    map?.invalidateSize();
    window.setTimeout(() => map?.invalidateSize(), 80);
    if (isBrowserOffline()) {
      setStatus('Offline — waiting for a connection');
      fireOfflineAlert();
    } else if (!alreadyVisible) {
      void loadViewportStations();
    }
    renderStampLayer();
    renderHud();
  });
}

export function hideMapView(): void {
  persistMapViewport();
  visible = false;
  fetchSeq++;
  if (fetchTimer) {
    clearTimeout(fetchTimer);
    fetchTimer = null;
  }
  stopHudClock();
  closePassportPanel();
}

export function flyToMap(lat: number, lon: number, zoom = STATION_ZOOM): void {
  persistViewport(lat, lon, zoom);
  if (!map) {
    pendingView = { center: [lat, lon], zoom };
    return;
  }
  map.setView([lat, lon], zoom);
}

/** Center the map on a playing station (exact pin, or country if it has no coordinates). */
export function flyToNowPlaying(station: Station): boolean {
  const target = resolveStationMapTarget(station);
  if (!target) return false;
  highlightMapStation(station.stationuuid);
  if (target.kind === 'station' && stationHasGeo(station)) {
    pendingPopupId = station.stationuuid;
    if (!lastStations.some((s) => s.stationuuid === station.stationuuid)) {
      lastStations = [...lastStations, station];
    }
    if (markersLayer && !markerById.has(station.stationuuid)) {
      const marker = L.marker([station.geo_lat, station.geo_long], {
        icon: pinIcon(station, true),
        title: station.name,
        keyboard: true,
      });
      marker.bindPopup(popupHtml(station), { maxWidth: 280, className: 'map-leaflet-popup' });
      marker.addTo(markersLayer);
      markerById.set(station.stationuuid, marker);
    }
    flyToMap(target.lat, target.lon, target.zoom);
    openPendingPopup(false);
    return true;
  }
  pendingPopupId = null;
  flyToMap(target.lat, target.lon, target.zoom);
  return true;
}

export function beginBlindWander(station: Station): void {
  clearMapBlind();
  hudStation = station;
  highlightMapStation(station.stationuuid);
  setStatus('On the air somewhere — listen');
  if (!resolveStationMapTarget(station)) {
    renderHud();
    handlers?.toast('On the air — this station has no map location');
    return;
  }
  blind = {
    station,
    timer: window.setTimeout(() => {
      revealMapWander(true);
    }, BLIND_MS),
  };
  renderHud();
}

export function revealMapWander(auto = false): boolean {
  if (!blind) return false;
  const station = blind.station;
  clearMapBlind();
  hudStation = station;
  const place = placeCaption(station);
  const ok = flyToNowPlaying(station);
  renderHud();
  setStatus(ok ? `Landed in ${place}` : 'On the air');
  handlers?.toast(auto ? `You landed in ${place}` : `Revealed: ${place}`);
  return true;
}

export function clearMapBlind(): void {
  if (!blind) return;
  window.clearTimeout(blind.timer);
  blind = null;
  renderHud();
}

export function refreshMapStations(): void {
  if (!visible) return;
  void loadViewportStations();
}

export function locateOnMap(): void {
  if (!handlers) return;
  if (isBrowserOffline()) {
    fireOfflineAlert();
    return;
  }
  if (!navigator.geolocation) {
    handlers.toast('Geolocation not available on this device');
    return;
  }
  setStatus('Finding your location…');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      flyToMap(pos.coords.latitude, pos.coords.longitude, LOCATE_ZOOM);
    },
    (err) => {
      const msg =
        err.code === err.PERMISSION_DENIED
          ? 'Location permission denied'
          : err.code === err.POSITION_UNAVAILABLE
            ? 'Location unavailable'
            : err.code === err.TIMEOUT
              ? 'Location request timed out — try again'
              : 'Could not get your location';
      handlers?.toast(msg);
      setStatus('Move the map to discover stations');
    },
    { enableHighAccuracy: false, timeout: 15_000, maximumAge: 600_000 }
  );
}
