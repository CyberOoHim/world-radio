import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { getStationsInViewport, type SearchParams } from './api/radioBrowser';
import { escapeHtml } from './html';
import {
  isBrowserOffline,
  OFFLINE_MAP_ALERT,
  shouldLoadPins,
  viewportRadiusMeters,
} from './mapGeo';
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
const STATION_ZOOM = 10;

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
}

function countryFlag(code: string): string {
  if (!code || code.length !== 2) return '📻';
  const cc = code.toUpperCase();
  return String.fromCodePoint(...[...cc].map((c) => 127397 + c.charCodeAt(0)));
}

function stationHasGeo(
  station: Station
): station is Station & { geo_lat: number; geo_long: number } {
  return (
    typeof station.geo_lat === 'number' &&
    Number.isFinite(station.geo_lat) &&
    typeof station.geo_long === 'number' &&
    Number.isFinite(station.geo_long)
  );
}

let map: L.Map | null = null;
let tiles: L.TileLayer | null = null;
let markersLayer: L.LayerGroup | null = null;
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

export function getMapStations(): Station[] {
  return lastStations;
}

export function getMapViewport(): MapViewport | null {
  if (!map) return null;
  const c = map.getCenter();
  return { lat: c.lat, lon: c.lng, zoom: map.getZoom() };
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

export function syncMapNowPlaying(station: Station | null): void {
  const btn = nowPlayingBtn();
  if (!btn) return;
  const hasGeo = Boolean(station && stationHasGeo(station));
  btn.disabled = !hasGeo;
  if (!station) {
    btn.title = 'Nothing is playing';
  } else if (!hasGeo) {
    btn.title = 'This station has no map location';
  } else {
    btn.title = `Center the map on ${station.name}`;
  }
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
  const flag = countryFlag(station.countrycode);
  return `<span class="map-pin${playing ? ' is-playing' : ''}" title="${escapeHtml(station.name)}"><span class="map-pin-flag">${flag}</span></span>`;
}

function popupHtml(station: Station): string {
  const fav = handlers?.isFavorite(station.stationuuid);
  const country = station.country || station.countrycode || '';
  const meta = [
    country ? `${countryFlag(station.countrycode)} ${escapeHtml(country)}` : '',
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
      title: station.name,
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

function reportViewport() {
  if (!map || !handlers) return;
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
}

function bindResize() {
  if (resizeBound) return;
  resizeBound = true;
  window.addEventListener('resize', () => {
    if (visible && map) map.invalidateSize();
  });
}

function shellHtml(): string {
  return `
    <div class="map-offline-banner" role="alert" hidden>
      <strong>Offline.</strong> ${escapeHtml(OFFLINE_MAP_ALERT)}
    </div>
    <div class="map-toolbar">
      <button type="button" class="chip" data-action="map-locate" title="Center the map on your location">📍 Near me</button>
      <button type="button" class="chip" data-action="map-now-playing" title="Nothing is playing" disabled>▶ Now playing</button>
      <span class="map-status">Move the map to discover stations</span>
    </div>
    <div class="map-canvas" role="application" aria-label="World radio map"></div>
  `;
}

function createMap(canvas: HTMLElement) {
  const start = pendingView;
  pendingView = null;
  map = L.map(canvas, {
    zoomControl: false,
    worldCopyJump: true,
    minZoom: 2,
    maxZoom: 18,
    attributionControl: true,
  }).setView(start?.center ?? DEFAULT_CENTER, start?.zoom ?? DEFAULT_ZOOM);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  tiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20,
    className: 'map-tiles',
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
  map.on('moveend', scheduleFetch);
}

export function mountMapView(root: HTMLElement, nextHandlers: MapViewHandlers): void {
  handlers = nextHandlers;
  if (!root.querySelector('.map-canvas')) {
    root.innerHTML = shellHtml();
  }
  const canvas = root.querySelector<HTMLElement>('.map-canvas');
  if (!canvas) return;
  if (!map) createMap(canvas);
  bindNetwork();
  bindResize();
}

export function showMapView(opts?: { center?: [number, number]; zoom?: number }): void {
  const alreadyVisible = visible;
  visible = true;
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
  });
}

export function hideMapView(): void {
  visible = false;
  fetchSeq++;
  if (fetchTimer) {
    clearTimeout(fetchTimer);
    fetchTimer = null;
  }
}

export function flyToMap(lat: number, lon: number, zoom = STATION_ZOOM): void {
  if (!map) {
    pendingView = { center: [lat, lon], zoom };
    return;
  }
  map.setView([lat, lon], zoom);
}

/** Center the map on a playing station and open its pin when the marker exists. */
export function flyToNowPlaying(station: Station): boolean {
  if (!stationHasGeo(station)) return false;
  highlightMapStation(station.stationuuid);
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
  flyToMap(station.geo_lat, station.geo_long, STATION_ZOOM);
  openPendingPopup(false);
  return true;
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
