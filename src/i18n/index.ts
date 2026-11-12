// Minimal UI translation: one JSON file per language in ./locales, English is the reference
// and the fallback. Keys are dot paths into the JSON; a wrong key is a compile error because
// MessageKey is derived from en.json. A leaf is either a string or a plural form
// { "one": "...", "other": "..." } chosen by params.count via Intl.PluralRules.
// Placeholders: {name}. Numbers in params are formatted for the active locale.
import en from './locales/en.json';
import de from './locales/de.json';

type Plural = { one: string; other: string };
type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : T[K] extends Plural ? K : `${K}.${Paths<T[K]>}`;
}[keyof T & string];

export type MessageKey = Paths<typeof en>;
export type Params = Record<string, string | number>;

/** Supported UI languages. To add one: add its JSON file and an entry here. */
export const LOCALES = {
  en: { name: 'English', messages: en },
  de: { name: 'Deutsch', messages: de },
} as const;
export type Locale = keyof typeof LOCALES;
export const DEFAULT_LOCALE: Locale = 'en';

const STORAGE_KEY = 'second-label.locale';

const isLocale = (v: unknown): v is Locale => typeof v === 'string' && Object.hasOwn(LOCALES, v);

function storedLocale(): Locale | null {
  try {
    const v = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
}

/** First browser language whose primary subtag is supported, else English. */
export function detectLocale(languages: readonly string[] = globalThis.navigator?.languages ?? []): Locale {
  for (const tag of languages) {
    const primary = tag.toLowerCase().split('-')[0];
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

let current: Locale = storedLocale() ?? detectLocale();

export const getLocale = (): Locale => current;

/** Manual override, persisted. Pass null to go back to browser detection. */
export function setLocale(locale: Locale | null): void {
  try {
    if (locale) globalThis.localStorage?.setItem(STORAGE_KEY, locale);
    else globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    /* storage blocked: the choice lasts until reload */
  }
  current = locale ?? detectLocale();
  if (globalThis.document) document.documentElement.lang = current;
}

function lookup(locale: Locale, key: string): string | Plural | undefined {
  let node: unknown = LOCALES[locale].messages;
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' || (node && typeof node === 'object' && 'other' in node) ? (node as string | Plural) : undefined;
}

/** True when `key` names a message (for keys built at runtime, e.g. from a media id). */
export function hasKey(key: string): key is MessageKey {
  return lookup(DEFAULT_LOCALE, key) !== undefined;
}

/** Number for display: up to `maxDigits` decimals, locale decimal separator, no grouping. */
export function formatNumber(v: number, maxDigits = 1, minDigits = 0, locale: Locale = current): string {
  const k = 10 ** maxDigits;
  const rounded = Math.round(v * k) / k || 0; // `|| 0` turns -0 into 0
  return new Intl.NumberFormat(locale, { maximumFractionDigits: maxDigits, minimumFractionDigits: minDigits, useGrouping: false }).format(rounded);
}

export function formatPercent(fraction: number, locale: Locale = current): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(fraction);
}

export function formatDateTime(iso: string, locale: Locale = current): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
}

export function translate(locale: Locale, key: MessageKey, params: Params = {}): string {
  let msg = lookup(locale, key) ?? lookup(DEFAULT_LOCALE, key);
  if (msg === undefined) return key;
  if (typeof msg !== 'string') {
    const n = Number(params.count ?? 0);
    msg = new Intl.PluralRules(locale).select(n) === 'one' ? msg.one : msg.other;
  }
  return msg.replace(/\{(\w+)\}/g, (all, name: string) => {
    const v = params[name];
    if (v === undefined) return all;
    return typeof v === 'number' ? formatNumber(v, 2, 0, locale) : v;
  });
}

/** Message in the active UI language. */
export function t(key: MessageKey, params?: Params): string {
  return translate(current, key, params);
}

/**
 * Fill static markup: data-i18n sets the text, data-i18n-title / -aria-label / -placeholder
 * set those attributes. Runs once at start; a language switch reloads the page.
 */
export function translateDom(root: ParentNode = document): void {
  const attrs = ['title', 'aria-label', 'placeholder'] as const;
  root.querySelectorAll<HTMLElement>('[data-i18n], [data-i18n-title], [data-i18n-aria-label], [data-i18n-placeholder]').forEach((el) => {
    const text = el.dataset.i18n;
    if (text) el.textContent = t(text as MessageKey);
    for (const a of attrs) {
      const key = el.getAttribute(`data-i18n-${a}`);
      if (key) el.setAttribute(a, t(key as MessageKey));
    }
  });
}

if (globalThis.document) document.documentElement.lang = current;
