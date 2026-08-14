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

/**
 * Ordered play attempts for a station.
 * Prefer https:// first (mixed content on Pages), then the original http://
 * URL, then an http twin of an https URL. Many Icecast servers have no TLS,
 * and Radio Browser often lists a rewritten https:// that does not exist.
 */
export function playbackUrlCandidates(
  urls: Array<string | null | undefined>,
  pageProtocol: string
): string[] {
  const out: string[] = [];
  const add = (u: string) => {
    if (u && !out.includes(u)) out.push(u);
  };
  for (const raw of urls) {
    if (typeof raw !== 'string') continue;
    const u = raw.trim();
    if (!u) continue;
    if (/^http:\/\//i.test(u)) {
      if (pageProtocol === 'https:') add(upgradeHttpToHttps(u));
      add(u);
    } else if (/^https:\/\//i.test(u)) {
      add(u);
      add(u.replace(/^https:\/\//i, 'http://'));
    } else {
      add(u);
    }
  }
  return out;
}

export function nearExpansionComplete(found: number, need: number): boolean {
  return found >= need;
}
