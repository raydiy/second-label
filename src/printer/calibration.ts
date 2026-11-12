// Per-device calibration: defaults, validation and persistence.
//
// A calibration is stored per USB model (vendorId:productId, never the serial number), so a
// replacement unit of the same model inherits it and nothing identifying ends up in storage.
// The rasterizer (raster.ts) consumes it, the wizard (src/ui/calibration.ts) writes it, and the
// solver (calibrate.ts) derives new values from ruler measurements.

import type { Calibration } from './types';
import { DEFAULT_CALIBRATION } from './raster';
import { PrinterError } from './errors';

export { DEFAULT_CALIBRATION };

export const CALIBRATION_STORAGE_PREFIX = 'second-label.calibration.';
export const CALIBRATION_FORMAT_VERSION = 1;

/** Plausible ranges. Values outside are rejected on load and by the solver. */
export const CALIBRATION_LIMITS = {
  headOffsetDots: { min: -120, max: 120 },
  feedStartDots: { min: -60, max: 240 },
  feedScale: { min: 0.95, max: 1.05 },
  tapeCorrectionDots: { min: -40, max: 40 },
} as const;

/** Minimal Web Storage subset, injectable for tests. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const hex4 = (n: number) => (n & 0xffff).toString(16).padStart(4, '0');

/** Storage key for a USB model, e.g. "0922:001d". */
export function deviceKey(vendorId: number, productId: number): string {
  return `${hex4(vendorId)}:${hex4(productId)}`;
}

export function cloneCalibration(c: Calibration): Calibration {
  return {
    label: { ...c.label },
    tape: { centerCorrectionDots: { ...c.tape.centerCorrectionDots } },
  };
}

export function calibrationEquals(a: Calibration, b: Calibration): boolean {
  return JSON.stringify(normalizeCalibration(a)) === JSON.stringify(normalizeCalibration(b));
}

const inRange = (v: unknown, r: { min: number; max: number }): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= r.min && v <= r.max;

/**
 * Validate an untrusted calibration (from storage or a file). Missing parts are filled from
 * the defaults; any out-of-range or non-numeric value makes the whole calibration invalid.
 */
export function normalizeCalibration(input: unknown): Calibration | null {
  if (!input || typeof input !== 'object') return null;
  const c = input as { label?: Record<string, unknown>; tape?: { centerCorrectionDots?: Record<string, unknown> } };
  const out = cloneCalibration(DEFAULT_CALIBRATION);
  if (c.label !== undefined) {
    if (!c.label || typeof c.label !== 'object') return null;
    const { headOffsetDots, feedStartDots, feedScale } = c.label;
    if (headOffsetDots !== undefined) {
      if (!inRange(headOffsetDots, CALIBRATION_LIMITS.headOffsetDots) || !Number.isInteger(headOffsetDots)) return null;
      out.label.headOffsetDots = headOffsetDots;
    }
    if (feedStartDots !== undefined) {
      if (!inRange(feedStartDots, CALIBRATION_LIMITS.feedStartDots)) return null;
      out.label.feedStartDots = feedStartDots;
    }
    if (feedScale !== undefined) {
      if (!inRange(feedScale, CALIBRATION_LIMITS.feedScale)) return null;
      out.label.feedScale = feedScale;
    }
  }
  if (c.tape !== undefined) {
    const corr = c.tape?.centerCorrectionDots;
    if (corr !== undefined) {
      if (!corr || typeof corr !== 'object') return null;
      for (const [k, v] of Object.entries(corr)) {
        const w = Number(k);
        if (!Number.isFinite(w) || w <= 0 || w > 100) return null;
        if (!inRange(v, CALIBRATION_LIMITS.tapeCorrectionDots) || !Number.isInteger(v)) return null;
        out.tape.centerCorrectionDots[w] = v;
      }
    }
  }
  return out;
}

/** localStorage when available and usable, else null (Node/Bun tests, privacy modes). */
export function browserStore(): KeyValueStore | null {
  try {
    const s = (globalThis as { localStorage?: KeyValueStore }).localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

export interface StoredCalibration {
  calibration: Calibration;
  savedAt: string | null;
}

/** Stored calibration for a device key, or null when none (or an invalid one) is stored. */
export function loadCalibration(key: string, store: KeyValueStore | null = browserStore()): StoredCalibration | null {
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(CALIBRATION_STORAGE_PREFIX + key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { version?: number; savedAt?: string; calibration?: unknown };
    if (parsed?.version !== CALIBRATION_FORMAT_VERSION) return null;
    const calibration = normalizeCalibration(parsed.calibration);
    return calibration ? { calibration, savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : null } : null;
  } catch {
    return null;
  }
}

/** Calibration to print with: the stored one for this device, else the defaults. */
export function activeCalibration(key: string | null, store: KeyValueStore | null = browserStore()): Calibration {
  return (key && loadCalibration(key, store)?.calibration) || DEFAULT_CALIBRATION;
}

export function saveCalibration(key: string, calibration: Calibration, store: KeyValueStore | null = browserStore()): void {
  const valid = normalizeCalibration(calibration);
  if (!valid) throw new PrinterError('calibrationInvalid', 'Invalid calibration, not saved.');
  if (!store) throw new PrinterError('storageUnavailable', 'The browser allows no local storage, the calibration cannot be saved.');
  store.setItem(
    CALIBRATION_STORAGE_PREFIX + key,
    JSON.stringify({ version: CALIBRATION_FORMAT_VERSION, savedAt: new Date().toISOString(), calibration: valid }),
  );
}

/** Forget the stored calibration so the defaults apply again. */
export function resetCalibration(key: string, store: KeyValueStore | null = browserStore()): void {
  store?.removeItem(CALIBRATION_STORAGE_PREFIX + key);
}
