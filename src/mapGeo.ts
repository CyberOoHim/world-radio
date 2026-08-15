export const MIN_PIN_ZOOM = 4;

export const OFFLINE_MAP_ALERT =
  "You're offline. Map tiles and nearby stations need an internet connection.";

export interface MapBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export function haversineMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function viewportRadiusMeters(bounds: MapBounds): number {
  const center = {
    lat: (bounds.south + bounds.north) / 2,
    lon: (bounds.west + bounds.east) / 2,
  };
  return haversineMeters(center, { lat: bounds.north, lon: bounds.east });
}

export function shouldLoadPins(zoom: number): boolean {
  return zoom >= MIN_PIN_ZOOM;
}
