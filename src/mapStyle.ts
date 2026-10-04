export type MapStyleId = 'streets' | 'terrain' | 'satellite';

export const DEFAULT_MAP_STYLE: MapStyleId = 'streets';

export const MAP_STYLE_IDS: readonly MapStyleId[] = ['streets', 'terrain', 'satellite'];

export interface MapStyleSpec {
  id: MapStyleId;
  label: string;
  url: string;
  attribution: string;
  subdomains?: string;
  maxZoom: number;
  maxNativeZoom?: number;
  background: string;
  detectRetina?: boolean;
  crossOrigin?: boolean | 'anonymous' | 'use-credentials' | '';
}

export const CARTO_VOYAGER_BASE_URL =
  'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';

export const CARTO_VOYAGER_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>';

export const OSM_STANDARD_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export const OSM_STANDARD_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

export function normalizeCartoApiKey(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let key = raw.trim();
  if (!key) return '';

  // Extract key parameter if user pasted full URL or query snippet (e.g. ?key=... or key=...)
  if (key.includes('key=')) {
    const match = key.match(/[?&]key=([^&#\s]+)/) || key.match(/^key=([^&#\s]+)/);
    if (match?.[1]) {
      try {
        key = decodeURIComponent(match[1]);
      } catch {
        key = match[1];
      }
    }
  }

  // Strip wrapping quotes if user pasted '"key"'
  key = key.replace(/^["']|["']$/g, '').trim();
  return key;
}

export function getCartoApiKey(): string {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_CARTO_API_KEY) {
      return normalizeCartoApiKey(import.meta.env.VITE_CARTO_API_KEY);
    }
  } catch {
    // ignore
  }
  if (typeof window !== 'undefined') {
    const globalKey = (window as unknown as { CARTO_API_KEY?: string }).CARTO_API_KEY;
    if (globalKey) return normalizeCartoApiKey(globalKey);
  }
  return '';
}

export function buildStreetsStyle(apiKey?: string): MapStyleSpec {
  const raw = apiKey !== undefined ? apiKey : getCartoApiKey();
  const key = normalizeCartoApiKey(raw);
  const url = key
    ? `${CARTO_VOYAGER_BASE_URL}?key=${encodeURIComponent(key)}`
    : CARTO_VOYAGER_BASE_URL;

  return {
    id: 'streets',
    label: 'Streets',
    url,
    attribution: CARTO_VOYAGER_ATTRIBUTION,
    subdomains: 'abcd',
    detectRetina: true,
    crossOrigin: true,
    maxZoom: 20,
    background: '#cddde6',
  };
}

export const TERRAIN_STYLE: MapStyleSpec = {
  id: 'terrain',
  label: 'Terrain',
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
  attribution:
    'Tiles &copy; <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a> — Esri, TomTom, Garmin, FAO, NOAA, USGS, &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  maxZoom: 19,
  maxNativeZoom: 19,
  background: '#d4ddd0',
};

export const SATELLITE_STYLE: MapStyleSpec = {
  id: 'satellite',
  label: 'Satellite',
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution:
    'Tiles &copy; <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a> — Esri, Maxar, Earthstar Geographics',
  maxZoom: 19,
  maxNativeZoom: 19,
  background: '#1a2330',
};

export const MAP_STYLES: Record<MapStyleId, MapStyleSpec> = {
  get streets() {
    return buildStreetsStyle();
  },
  terrain: TERRAIN_STYLE,
  satellite: SATELLITE_STYLE,
};

export function sanitizeMapStyle(raw: unknown): MapStyleId {
  return raw === 'terrain' || raw === 'satellite' ? raw : DEFAULT_MAP_STYLE;
}
