const HTTP = new Set(['http:', 'https:']);

/** Allow only absolute http(s) URLs. Rejects javascript:, data:, and relatives. */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;
  try {
    const u = new URL(trimmed);
    if (!HTTP.has(u.protocol)) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Mixed-content upgrade. Case-insensitive so `HTTP://` is not left on a Pages host. */
export function upgradeHttpToHttps(url: string): string {
  return url.replace(/^http:\/\//i, 'https://');
}

export function nearExpansionComplete(found: number, need: number): boolean {
  return found >= need;
}
