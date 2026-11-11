// Bundled web fonts (Fontsource, OFL-1.1). Served locally by Vite, no CDN at runtime.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-400-italic.css';
import '@fontsource/inter/latin-700-italic.css';
import '@fontsource/roboto/latin-400.css';
import '@fontsource/roboto/latin-700.css';
import '@fontsource/roboto/latin-400-italic.css';
import '@fontsource/roboto/latin-700-italic.css';
import '@fontsource/roboto-condensed/latin-400.css';
import '@fontsource/roboto-condensed/latin-700.css';
import '@fontsource/roboto-condensed/latin-400-italic.css';
import '@fontsource/roboto-condensed/latin-700-italic.css';
import '@fontsource/barlow-condensed/latin-400.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-400-italic.css';
import '@fontsource/barlow-condensed/latin-700-italic.css';
import '@fontsource/archivo-narrow/latin-400.css';
import '@fontsource/archivo-narrow/latin-700.css';
import '@fontsource/archivo-narrow/latin-400-italic.css';
import '@fontsource/archivo-narrow/latin-700-italic.css';
import '@fontsource/oswald/latin-400.css';
import '@fontsource/oswald/latin-700.css';
import '@fontsource/merriweather/latin-400.css';
import '@fontsource/merriweather/latin-700.css';
import '@fontsource/merriweather/latin-400-italic.css';
import '@fontsource/merriweather/latin-700-italic.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import '@fontsource/jetbrains-mono/latin-400-italic.css';
import '@fontsource/jetbrains-mono/latin-700-italic.css';

export interface FontDef { family: string; label: string; italic: boolean }

export const BUNDLED_FONTS: FontDef[] = [
  { family: 'Inter', label: 'Inter', italic: true },
  { family: 'Roboto', label: 'Roboto', italic: true },
  { family: 'Roboto Condensed', label: 'Roboto Condensed (schmal)', italic: true },
  { family: 'Barlow Condensed', label: 'Barlow Condensed (schmal)', italic: true },
  { family: 'Archivo Narrow', label: 'Archivo Narrow (schmal)', italic: true },
  { family: 'Oswald', label: 'Oswald (schmal)', italic: false },
  { family: 'Merriweather', label: 'Merriweather (Serif)', italic: true },
  { family: 'JetBrains Mono', label: 'JetBrains Mono (Mono)', italic: true },
];

export const DEFAULT_FONT = 'Inter';

export interface FontUse { family: string; weight: string; style: string }

/** Load the given font variants; resolves when the browser has them (or gave up). */
export async function ensureFonts(uses: FontUse[]): Promise<void> {
  const seen = new Set<string>();
  const jobs: Promise<unknown>[] = [];
  for (const u of uses) {
    const spec = `${u.style} ${u.weight} 16px "${u.family}"`;
    if (seen.has(spec)) continue;
    seen.add(spec);
    jobs.push(document.fonts.load(spec).catch(() => undefined));
  }
  await Promise.all(jobs);
}

export function preloadBundledFonts(): Promise<void> {
  return ensureFonts(BUNDLED_FONTS.map((f) => ({ family: f.family, weight: 'normal', style: 'normal' })));
}

/** Collect font variants used in a Fabric JSON tree. */
export function fontsInJson(json: unknown): FontUse[] {
  const out: FontUse[] = [];
  const walk = (o: any) => {
    if (!o || typeof o !== 'object') return;
    if (typeof o.fontFamily === 'string') {
      out.push({ family: o.fontFamily, weight: String(o.fontWeight ?? 'normal'), style: String(o.fontStyle ?? 'normal') });
    }
    for (const k of ['objects']) if (Array.isArray(o[k])) o[k].forEach(walk);
  };
  walk(json);
  return out;
}

// Local Font Access API (Chromium only, needs permission).
interface LocalFontData { family: string }
declare global {
  interface Window { queryLocalFonts?: () => Promise<LocalFontData[]> }
}

export const localFontsSupported = () => typeof window.queryLocalFonts === 'function';

export async function queryLocalFamilies(): Promise<string[]> {
  if (!window.queryLocalFonts) throw new Error('Diese Funktion gibt es nur in Chromium-Browsern (Chrome, Edge, Brave, Vivaldi).');
  const fonts = await window.queryLocalFonts();
  const bundled = new Set(BUNDLED_FONTS.map((f) => f.family));
  return [...new Set(fonts.map((f) => f.family))].filter((f) => !bundled.has(f)).sort((a, b) => a.localeCompare(b));
}
