// Lucide icon set (ISC licence), loaded lazily as one sprite + tag list.
export interface IconEntry { name: string; tags: string[]; svg: string }

let cache: Promise<IconEntry[]> | null = null;

export function loadIcons(): Promise<IconEntry[]> {
  cache ??= (async () => {
    const [{ default: sprite }, { default: tags }] = await Promise.all([
      import('lucide-static/sprite.svg?raw'),
      import('lucide-static/tags.json'),
    ]);
    const doc = new DOMParser().parseFromString(sprite, 'image/svg+xml');
    const tagMap = tags as Record<string, string[]>;
    return [...doc.querySelectorAll('symbol')].map((sym) => {
      const name = sym.id;
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="${sym.getAttribute('viewBox') ?? '0 0 24 24'}" ` +
        `fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${sym.innerHTML}</svg>`;
      return { name, tags: tagMap[name] ?? [], svg };
    });
  })();
  return cache;
}

// A few German search aliases for common label icons.
const DE: Record<string, string> = {
  haus: 'house', telefon: 'phone', post: 'mail', brief: 'mail', stern: 'star', herz: 'heart',
  pfeil: 'arrow', warnung: 'triangle-alert', achtung: 'triangle-alert', blitz: 'zap', strom: 'zap',
  kabel: 'cable', ordner: 'folder', datei: 'file', werkzeug: 'wrench', schluessel: 'key', schlüssel: 'key',
  kalender: 'calendar', uhr: 'clock', auto: 'car', drucker: 'printer', paket: 'package', karton: 'package',
  muell: 'trash', müll: 'trash', kueche: 'utensils', küche: 'utensils', feuer: 'flame', wasser: 'droplet',
  sonne: 'sun', mond: 'moon', musik: 'music', person: 'user', schloss: 'lock', netzwerk: 'network',
};

export function searchIcons(all: IconEntry[], query: string, limit = 240): IconEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return all.slice(0, limit);
  const qs = [q, DE[q]].filter(Boolean) as string[];
  const scored: { e: IconEntry; s: number }[] = [];
  for (const e of all) {
    let s = 0;
    for (const t of qs) {
      if (e.name === t) s = Math.max(s, 100);
      else if (e.name.startsWith(t)) s = Math.max(s, 60);
      else if (e.name.includes(t)) s = Math.max(s, 40);
      else if (e.tags.some((x) => x.includes(t))) s = Math.max(s, 20);
    }
    if (s) scored.push({ e, s });
  }
  scored.sort((a, b) => b.s - a.s || a.e.name.localeCompare(b.e.name));
  return scored.slice(0, limit).map((x) => x.e);
}
