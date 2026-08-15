import {
  PASSPORT_COUNTRY_TOTAL,
  countryCentroid,
  resolveStationMapTarget,
} from './mapGeo';
import type { Station } from './types';

export const PASSPORT_LISTEN_MS = 90_000;
export const PASSPORT_MAX_STAMPS = 400;

export interface PassportStamp {
  countrycode: string;
  country: string;
  lat: number;
  lon: number;
  kind: 'station' | 'country';
  stationuuid?: string;
  stationName?: string;
  place?: string;
  stampedAt: number;
}

export interface StampMergeResult {
  stamps: PassportStamp[];
  added: boolean;
  upgraded: boolean;
}

export interface PassportStats {
  countries: number;
  cities: number;
  total: number;
}

function isIso2(code: string): boolean {
  return /^[A-Z]{2}$/.test(code);
}

export function sanitizePassportStamp(raw: unknown): PassportStamp | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const countrycode = typeof o.countrycode === 'string' ? o.countrycode.trim().toUpperCase() : '';
  if (!isIso2(countrycode)) return null;
  const lat = typeof o.lat === 'number' && Number.isFinite(o.lat) ? o.lat : NaN;
  const lon = typeof o.lon === 'number' && Number.isFinite(o.lon) ? o.lon : NaN;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const kind = o.kind === 'station' ? 'station' : o.kind === 'country' ? 'country' : null;
  if (!kind) return null;
  const stampedAt =
    typeof o.stampedAt === 'number' && Number.isFinite(o.stampedAt) ? o.stampedAt : Date.now();
  const stationuuid =
    typeof o.stationuuid === 'string' && o.stationuuid.trim() ? o.stationuuid.trim() : undefined;
  if (kind === 'station' && !stationuuid) return null;
  const country =
    typeof o.country === 'string' && o.country.trim() ? o.country.trim().slice(0, 80) : countrycode;
  const stationName =
    typeof o.stationName === 'string' && o.stationName.trim()
      ? o.stationName.trim().slice(0, 80)
      : undefined;
  const place =
    typeof o.place === 'string' && o.place.trim() ? o.place.trim().slice(0, 80) : undefined;
  return { countrycode, country, lat, lon, kind, stationuuid, stationName, place, stampedAt };
}

export function stampFromStation(station: Station, at = Date.now()): PassportStamp | null {
  const target = resolveStationMapTarget(station);
  if (!target) return null;
  const countrycode = (station.countrycode || '').trim().toUpperCase();
  if (!isIso2(countrycode)) return null;
  return {
    countrycode,
    country: (station.country || '').trim() || countrycode,
    lat: target.lat,
    lon: target.lon,
    kind: target.kind,
    stationuuid: station.stationuuid,
    stationName: station.name,
    place: (station.state || '').trim() || undefined,
    stampedAt: at,
  };
}

export function mergeStamp(stamps: PassportStamp[], next: PassportStamp): StampMergeResult {
  if (next.stationuuid) {
    const existing = stamps.findIndex((s) => s.stationuuid === next.stationuuid);
    if (existing >= 0) {
      const copy = stamps.slice();
      copy[existing] = { ...copy[existing], ...next };
      return { stamps: capStamps(copy), added: false, upgraded: false };
    }
  }

  if (next.kind === 'country') {
    if (stamps.some((s) => s.countrycode === next.countrycode)) {
      return { stamps, added: false, upgraded: false };
    }
    return { stamps: capStamps([...stamps, next]), added: true, upgraded: false };
  }

  const withoutPlaceholder = stamps.filter(
    (s) => !(s.countrycode === next.countrycode && s.kind === 'country')
  );
  const upgraded = withoutPlaceholder.length !== stamps.length;
  return { stamps: capStamps([...withoutPlaceholder, next]), added: true, upgraded };
}

function capStamps(stamps: PassportStamp[]): PassportStamp[] {
  if (stamps.length <= PASSPORT_MAX_STAMPS) return stamps;
  return [...stamps].sort((a, b) => a.stampedAt - b.stampedAt).slice(-PASSPORT_MAX_STAMPS);
}

export function seedStampsFromStations(stations: Station[], baseTime = Date.now()): PassportStamp[] {
  let stamps: PassportStamp[] = [];
  const oldestFirst = [...stations].reverse();
  oldestFirst.forEach((station, i) => {
    const stamp = stampFromStation(station, baseTime - (oldestFirst.length - i) * 1000);
    if (!stamp) return;
    stamps = mergeStamp(stamps, stamp).stamps;
  });
  return stamps;
}

export function passportStats(stamps: PassportStamp[]): PassportStats {
  const countries = new Set(stamps.map((s) => s.countrycode));
  const cities = stamps.filter((s) => s.kind === 'station').length;
  return { countries: countries.size, cities, total: PASSPORT_COUNTRY_TOTAL };
}

export function stampedCountryCodes(stamps: PassportStamp[]): Set<string> {
  return new Set(stamps.map((s) => s.countrycode));
}

export function isStationStamped(stamps: PassportStamp[], uuid: string): boolean {
  return stamps.some((s) => s.stationuuid === uuid);
}

export function latestStampPerCountry(stamps: PassportStamp[]): PassportStamp[] {
  const byCode = new Map<string, PassportStamp>();
  for (const stamp of stamps) {
    const prev = byCode.get(stamp.countrycode);
    if (!prev || stamp.stampedAt >= prev.stampedAt) byCode.set(stamp.countrycode, stamp);
  }
  return [...byCode.values()];
}

/** Country seals sit on the centroid so they do not cover a city pin. */
export function countrySealPosition(stamp: PassportStamp): { lat: number; lon: number } {
  return countryCentroid(stamp.countrycode) ?? { lat: stamp.lat, lon: stamp.lon };
}

export function routeStampPoints(stamps: PassportStamp[], limit = 12): PassportStamp[] {
  return [...stamps].sort((a, b) => a.stampedAt - b.stampedAt).slice(-limit);
}

export function stampsNewestFirst(stamps: PassportStamp[]): PassportStamp[] {
  return [...stamps].sort((a, b) => b.stampedAt - a.stampedAt);
}
