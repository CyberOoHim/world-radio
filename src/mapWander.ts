import {
  MIN_PIN_ZOOM,
  countryCentroid,
  haversineMeters,
  pointInBounds,
  stationCoords,
  type MapBounds,
} from './mapGeo';

export interface WanderCandidate {
  stationuuid: string;
  countrycode?: string;
  geo_lat?: unknown;
  geo_long?: unknown;
}

export interface WanderPickContext {
  bounds: MapBounds | null;
  zoom: number;
  center: { lat: number; lon: number } | null;
  stampedCountries: Set<string>;
  excludeId: string | null;
}

function wanderCoords(station: WanderCandidate): { lat: number; lon: number } | null {
  return stationCoords(station) ?? countryCentroid(station.countrycode ?? '');
}

/** Higher score = better hop. Random jitter keeps repeats from feeling scripted. */
export function scoreWanderCandidate(station: WanderCandidate, ctx: WanderPickContext): number {
  if (ctx.excludeId && station.stationuuid === ctx.excludeId) return -1;
  const coords = wanderCoords(station);
  if (!coords) return -1;

  let score = Math.random();
  if (stationCoords(station)) score += 1.2;

  if (ctx.zoom >= MIN_PIN_ZOOM && ctx.bounds) {
    if (pointInBounds(coords.lat, coords.lon, ctx.bounds)) score -= 2.4;
    else score += 3.2;
  }

  const cc = (station.countrycode || '').trim().toUpperCase();
  if (cc && !ctx.stampedCountries.has(cc)) score += 2.1;

  if (ctx.center) {
    const km = haversineMeters(ctx.center, coords) / 1000;
    score += Math.min(2.2, km / 4000);
  }

  return score;
}

export function pickWanderOrder<T extends WanderCandidate>(
  stations: T[],
  ctx: WanderPickContext
): T[] {
  return stations
    .map((station) => ({ station, score: scoreWanderCandidate(station, ctx) }))
    .filter((row) => row.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((row) => row.station);
}
