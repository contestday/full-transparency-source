// Watch links saved in this browser only (never sent anywhere else).
const KEY = "ft-watch-links";

export interface SavedWatchLink {
  token: string;
  savedAt: string;
}

export function loadWatchLinks(): SavedWatchLink[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as SavedWatchLink[]) : [];
    return Array.isArray(list) ? list.filter((l) => typeof l.token === "string") : [];
  } catch {
    return [];
  }
}

export function saveWatchLink(token: string) {
  try {
    const list = loadWatchLinks().filter((l) => l.token !== token);
    list.unshift({ token, savedAt: new Date().toISOString() });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 10)));
  } catch {
    /* storage unavailable: the user still has the link itself */
  }
}

export function forgetWatchLink(token: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadWatchLinks().filter((l) => l.token !== token)));
  } catch {
    /* ignore */
  }
}

/** Accepts a full link or a bare token. */
export function tokenFromInput(input: string): string | null {
  const m = input.trim().toUpperCase().match(/([A-Z0-9]{24})\/?$/);
  return m ? m[1] : null;
}
