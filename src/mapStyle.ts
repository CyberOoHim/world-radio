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
}

export const MAP_STYLES: Record<MapStyleId, MapStyleSpec> = {
  streets: {
    id: 'streets',
    label: 'Streets',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20,
    background: '#cddde6',
  },
  terrain: {
    id: 'terrain',
    label: 'Terrain',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution:
      'Tiles &copy; <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a> — Esri, TomTom, Garmin, FAO, NOAA, USGS, &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    maxZoom: 19,
    maxNativeZoom: 19,
    background: '#d4ddd0',
  },
  satellite: {
    id: 'satellite',
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution:
      'Tiles &copy; <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a> — Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
    maxNativeZoom: 19,
    background: '#1a2330',
  },
};

export function sanitizeMapStyle(raw: unknown): MapStyleId {
  return raw === 'terrain' || raw === 'satellite' ? raw : DEFAULT_MAP_STYLE;
}
