import type { Station } from './types';

const FAV_KEY = 'world-radio:favorites';
const RECENT_KEY = 'world-radio:recent';
const VOLUME_KEY = 'world-radio:volume';

export function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveFavorites(ids: string[]): void {
  localStorage.setItem(FAV_KEY, JSON.stringify(ids));
}

export function loadRecent(): Station[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Station[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRecent(stations: Station[]): void {
  localStorage.setItem(RECENT_KEY, JSON.stringify(stations.slice(0, 40)));
}

export function loadVolume(): number {
  try {
    const v = localStorage.getItem(VOLUME_KEY);
    if (v == null) return 0.75;
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.75;
  } catch {
    return 0.75;
  }
}

export function saveVolume(v: number): void {
  localStorage.setItem(VOLUME_KEY, String(v));
}
