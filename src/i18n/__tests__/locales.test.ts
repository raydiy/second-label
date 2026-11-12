import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { LOCALES, detectLocale, hasKey, translate, type Locale, type MessageKey } from '../index';
import { MEDIA } from '../../printer/media';

/** All leaf paths (plural forms as key.one / key.other) with their string values. */
function leaves(node: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(path, v);
    else if (v && typeof v === 'object') for (const [p, s] of leaves(v, path)) out.set(p, s);
    else throw new Error(`${path}: unexpected value ${JSON.stringify(v)}`);
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

const locales = Object.keys(LOCALES) as Locale[];
const ref = leaves(LOCALES.en.messages);

describe('locale files', () => {
  for (const l of locales) {
    const msgs = leaves(LOCALES[l].messages);

    test(`${l}: same keys as en.json`, () => {
      expect([...msgs.keys()].sort()).toEqual([...ref.keys()].sort());
    });

    test(`${l}: no empty values`, () => {
      expect([...msgs].filter(([, v]) => v.trim() === '').map(([k]) => k)).toEqual([]);
    });

    test(`${l}: same placeholders per key as en.json`, () => {
      const diff = [...ref].filter(([k, v]) => JSON.stringify(placeholders(v)) !== JSON.stringify(placeholders(msgs.get(k) ?? '')));
      expect(diff.map(([k]) => k)).toEqual([]);
    });

    test(`${l}: no em dash, no en dash`, () => {
      expect([...msgs].filter(([, v]) => /[\u2013\u2014]/.test(v)).map(([k]) => k)).toEqual([]);
    });

    test(`${l}: plural forms come as one/other pairs`, () => {
      const plurals = [...msgs.keys()].filter((k) => /\.(one|other)$/.test(k)).map((k) => k.replace(/\.(one|other)$/, ''));
      for (const p of new Set(plurals)) expect(msgs.has(`${p}.one`) && msgs.has(`${p}.other`)).toBe(true);
    });
  }
});

describe('keys used outside TypeScript', () => {
  test('every data-i18n key in index.html exists', () => {
    const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
    const keys = [...html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(40);
    expect(keys.filter((k) => !hasKey(k))).toEqual([]);
  });

  test('every label medium has a translated name, every medium note a translation', () => {
    const labels = MEDIA.filter((m) => m.target === 'label');
    expect(labels.filter((m) => !hasKey(`media.${m.id}`)).map((m) => m.id)).toEqual([]);
    expect(labels.filter((m) => m.notes && !hasKey(`mediaNote.${m.id}`)).map((m) => m.id)).toEqual([]);
  });
});

describe('translate', () => {
  test('interpolates and falls back to the placeholder when a param is missing', () => {
    expect(translate('en', 'library.openAria', { name: 'Box' })).toBe('Open Box');
    expect(translate('de', 'library.openAria', { name: 'Box' })).toBe('Box öffnen');
    expect(translate('en', 'library.openAria')).toBe('Open {name}');
  });

  test('plural forms follow Intl.PluralRules', () => {
    expect(translate('en', 'status.objects', { count: 1 })).toBe('1 object');
    expect(translate('en', 'status.objects', { count: 0 })).toBe('0 objects');
    expect(translate('de', 'status.objects', { count: 1 })).toBe('1 Objekt');
    expect(translate('de', 'status.objects', { count: 3 })).toBe('3 Objekte');
  });

  test('numbers are formatted for the locale', () => {
    expect(translate('de', 'status.size', { w: 88.5, h: 36 })).toBe('88,5 x 36 mm');
    expect(translate('en', 'status.size', { w: 88.5, h: 36 })).toBe('88.5 x 36 mm');
  });

  test('unknown key reports itself', () => {
    expect(translate('en', 'nope.missing' as MessageKey)).toBe('nope.missing');
  });
});

describe('detectLocale', () => {
  test('first supported browser language wins, English otherwise', () => {
    expect(detectLocale(['de-DE', 'en-US'])).toBe('de');
    expect(detectLocale(['de-AT'])).toBe('de');
    expect(detectLocale(['en-US', 'de-DE'])).toBe('en');
    expect(detectLocale(['fr-FR', 'de'])).toBe('de');
    expect(detectLocale(['fr-FR'])).toBe('en');
    expect(detectLocale([])).toBe('en');
  });
});
