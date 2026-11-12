import { describe, expect, test } from 'bun:test';
import {
  CALIBRATION_STORAGE_PREFIX,
  DEFAULT_CALIBRATION,
  activeCalibration,
  calibrationEquals,
  cloneCalibration,
  deviceKey,
  loadCalibration,
  normalizeCalibration,
  resetCalibration,
  saveCalibration,
  type KeyValueStore,
} from '../calibration';
import { LABEL_FEED_SCALE, LABEL_FEED_START_DOTS, LABEL_HEAD_OFFSET_DOTS, labelSourceSpan, rasterize, mmToDots } from '../raster';
import { findMedia } from '../media';

function memStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

describe('calibration defaults', () => {
  test('equal the historical constants', () => {
    expect(DEFAULT_CALIBRATION.label).toEqual({
      headOffsetDots: LABEL_HEAD_OFFSET_DOTS,
      feedStartDots: LABEL_FEED_START_DOTS,
      feedScale: LABEL_FEED_SCALE,
    });
    expect(DEFAULT_CALIBRATION.tape.centerCorrectionDots).toEqual({ 6: 0, 9: 0, 12: 0, 19: 0, 24: 0 });
  });

  test('rasterize with explicit defaults is byte-identical to no calibration', () => {
    for (const id of ['lw-99012', 'd1-12mm']) {
      const m = findMedia(id)!;
      const w = 600;
      const h = mmToDots(m.widthMm, m.dpi);
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < data.length; i += 4) data[i] = data[i + 1] = data[i + 2] = (i * 2654435761) % 251 < 120 ? 0 : 255, data[i + 3] = 255;
      const img = { width: w, height: h, data } as unknown as ImageData;
      const a = rasterize({ image: img, media: m });
      const b = rasterize({ image: img, media: m }, { calibration: cloneCalibration(DEFAULT_CALIBRATION) });
      expect(Buffer.from(b.data).equals(Buffer.from(a.data))).toBe(true);
    }
  });

  test('labelSourceSpan follows the given calibration', () => {
    expect(labelSourceSpan(0, { headOffsetDots: 0, feedStartDots: 10, feedScale: 1 })).toEqual([10, 11]);
    expect(labelSourceSpan(0)).toEqual([62, 63]);
  });
});

describe('deviceKey', () => {
  test('lower-case hex vendor:product, never a serial', () => {
    expect(deviceKey(0x0922, 0x001d)).toBe('0922:001d');
    expect(deviceKey(0x922, 0x20)).toBe('0922:0020');
  });
});

describe('normalizeCalibration', () => {
  test('fills missing parts from the defaults', () => {
    const c = normalizeCalibration({ label: { headOffsetDots: -10 } })!;
    expect(c.label).toEqual({ ...DEFAULT_CALIBRATION.label, headOffsetDots: -10 });
    expect(c.tape).toEqual(DEFAULT_CALIBRATION.tape);
  });

  test('rejects out-of-range or malformed values', () => {
    expect(normalizeCalibration(null)).toBeNull();
    expect(normalizeCalibration({ label: { feedScale: 1.5 } })).toBeNull();
    expect(normalizeCalibration({ label: { headOffsetDots: 1.5 } })).toBeNull();
    expect(normalizeCalibration({ label: { feedStartDots: 'x' } })).toBeNull();
    expect(normalizeCalibration({ tape: { centerCorrectionDots: { 12: 99 } } })).toBeNull();
    expect(normalizeCalibration({ tape: { centerCorrectionDots: { abc: 1 } } })).toBeNull();
  });

  test('string keys from JSON become tape widths', () => {
    const c = normalizeCalibration(JSON.parse('{"tape":{"centerCorrectionDots":{"12":3}}}'))!;
    expect(c.tape.centerCorrectionDots[12]).toBe(3);
  });
});

describe('storage', () => {
  test('save, load, active, reset per device key', () => {
    const s = memStore();
    const key = deviceKey(0x0922, 0x001d);
    expect(loadCalibration(key, s)).toBeNull();
    expect(activeCalibration(key, s)).toBe(DEFAULT_CALIBRATION);
    const c = cloneCalibration(DEFAULT_CALIBRATION);
    c.label.feedStartDots = 65.8;
    saveCalibration(key, c, s);
    expect([...s.map.keys()]).toEqual([CALIBRATION_STORAGE_PREFIX + '0922:001d']);
    const loaded = loadCalibration(key, s)!;
    expect(calibrationEquals(loaded.calibration, c)).toBe(true);
    expect(loaded.savedAt).toMatch(/^\d{4}-/);
    expect(activeCalibration(key, s).label.feedStartDots).toBe(65.8);
    expect(activeCalibration('0922:0020', s)).toBe(DEFAULT_CALIBRATION);
    resetCalibration(key, s);
    expect(loadCalibration(key, s)).toBeNull();
  });

  test('corrupt or foreign entries are ignored, invalid calibrations are not saved', () => {
    const s = memStore();
    s.setItem(CALIBRATION_STORAGE_PREFIX + 'a', '{not json');
    s.setItem(CALIBRATION_STORAGE_PREFIX + 'b', JSON.stringify({ version: 99, calibration: DEFAULT_CALIBRATION }));
    expect(loadCalibration('a', s)).toBeNull();
    expect(loadCalibration('b', s)).toBeNull();
    const bad = cloneCalibration(DEFAULT_CALIBRATION);
    bad.label.feedScale = 2;
    expect(() => saveCalibration('c', bad, s)).toThrow('Invalid calibration');
    expect(loadCalibration('x', null)).toBeNull();
  });
});
