import { describe, expect, test } from 'bun:test';
import {
  measurementTargets,
  solveCalibration,
  solveLabelAcross,
  solveLabelFeed,
  solveTapeCenter,
} from '../calibrate';
import { DEFAULT_CALIBRATION, cloneCalibration } from '../calibration';
import { findMedia } from '../media';
import { headOffsetDots, mmToDots, rasterize } from '../raster';
import type { Calibration, Media } from '../types';

const media = (id: string): Media => {
  const m = findMedia(id);
  if (!m) throw new Error(id);
  return m;
};
const MM = 25.4;
const lw99012 = media('lw-99012');
const t99012 = measurementTargets(lw99012);
const tick = (mm: number) => t99012.ticks.find((t) => t.mm === mm)!.xMm;

/** Forward model of a printer: row 0 at p0Mm from the leading edge, q nominal rows per row. */
function physical(xMm: number, p0Mm: number, q: number, cal: Calibration['label'], dpi = 300) {
  const s = (cal.feedStartDots / dpi) * MM;
  return p0Mm + ((xMm - s) / cal.feedScale) * q;
}

describe('measurement targets', () => {
  test('99012: frame at printable.xMm, numbered ticks from the label edge, bottom margin 1.52 mm', () => {
    expect(t99012.frameXMm).toBeCloseTo(6.01, 2);
    expect(t99012.ticks.map((t) => t.mm)).toContain(80);
    expect(tick(80)).toBeCloseTo(80, 1);
    expect(t99012.bottomMm).toBeCloseTo(1.52, 2);
  });
});

describe('solveLabelFeed', () => {
  test('real history: print with s=62.4, k=1.0095 measured frame 6.3 mm and tick 80 at 80.0 mm', () => {
    const r = solveLabelFeed(lw99012, DEFAULT_CALIBRATION.label, {
      frameDesignMm: t99012.frameXMm,
      frameMeasuredMm: 6.3,
      tickDesignMm: tick(80),
      tickMeasuredMm: 80.0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // q = 73.7 * 1.0095 / 73.999 = 1.00543, P0 = 6.3 - 0.7200 * q = 5.576 mm = 65.8 dots
    expect(r.value.feedScale).toBeCloseTo(1.00543, 4);
    expect(r.value.feedStartDots).toBeCloseTo(65.8, 1);
    // With the new values both measured marks land on their design positions.
    const next = { ...DEFAULT_CALIBRATION.label, ...r.value };
    const p0 = (r.value.feedStartDots / 300) * MM;
    expect(physical(t99012.frameXMm, p0, r.value.feedScale, next)).toBeCloseTo(t99012.frameXMm, 2);
    expect(physical(tick(80), p0, r.value.feedScale, next)).toBeCloseTo(tick(80), 2);
  });

  test('recovers a simulated printer from any active calibration', () => {
    const printer = { p0: 4.7, q: 1.012 };
    for (const active of [
      { headOffsetDots: 0, feedStartDots: 0, feedScale: 1 },
      DEFAULT_CALIBRATION.label,
      { headOffsetDots: 0, feedStartDots: 30, feedScale: 0.99 },
    ]) {
      const r = solveLabelFeed(lw99012, active, {
        frameDesignMm: t99012.frameXMm,
        frameMeasuredMm: physical(t99012.frameXMm, printer.p0, printer.q, active),
        tickDesignMm: tick(70),
        tickMeasuredMm: physical(tick(70), printer.p0, printer.q, active),
      });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.value.feedScale).toBeCloseTo(printer.q, 4);
      expect(r.value.feedStartDots).toBeCloseTo((printer.p0 / MM) * 300, 0);
    }
  });

  test('a perfect print keeps the active calibration', () => {
    const r = solveLabelFeed(lw99012, DEFAULT_CALIBRATION.label, {
      frameDesignMm: t99012.frameXMm,
      frameMeasuredMm: t99012.frameXMm,
      tickDesignMm: tick(80),
      tickMeasuredMm: tick(80),
    });
    expect(r.ok && r.value).toEqual({ feedStartDots: 62.4, feedScale: 1.0095 });
  });

  test('implausible input yields issue codes', () => {
    const base = { frameDesignMm: t99012.frameXMm, frameMeasuredMm: 6, tickDesignMm: tick(80), tickMeasuredMm: 80 };
    const err = (m: Partial<typeof base>) => {
      const r = solveLabelFeed(lw99012, DEFAULT_CALIBRATION.label, { ...base, ...m });
      return r.ok ? '' : r.error.code;
    };
    expect(err({ frameMeasuredMm: 45 })).toBe('frameImplausible');
    expect(err({ tickMeasuredMm: 5 })).toBe('tickBeforeFrame');
    expect(err({ tickMeasuredMm: 95 })).toBe('tickBeyondLength');
    expect(err({ tickMeasuredMm: 70 })).toBe('feedScaleImplausible'); // measured tick 70 as 80
    expect(err({ tickDesignMm: 10 })).toBe('tickTooClose');
    expect(err({ frameMeasuredMm: Number.NaN })).toBe('feedNotNumbers');
  });
});

describe('solveLabelAcross', () => {
  const zero = { headOffsetDots: 0, feedStartDots: 0, feedScale: 1 };

  test('offset 0, expected 1.52 mm, measured 3.0 mm: label edge 17.4 dots below dot 0', () => {
    // (3.0 - 1.52) mm * 300 / 25.4 = 17.48 -> 17. The current -18 (1.52 mm) corresponds to a
    // measurement of 3.05 mm or more, within ruler resolution of the historical 3 mm.
    const r = solveLabelAcross(lw99012, zero, 3.0);
    expect(r.ok && r.value.headOffsetDots).toBe(-17);
    const r2 = solveLabelAcross(lw99012, zero, 3.06);
    expect(r2.ok && r2.value.headOffsetDots).toBe(-18);
  });

  test('relative to the active offset, and a perfect print keeps it', () => {
    const r = solveLabelAcross(lw99012, DEFAULT_CALIBRATION.label, t99012.bottomMm);
    expect(r.ok && r.value.headOffsetDots).toBe(-18);
    const lower = solveLabelAcross(lw99012, DEFAULT_CALIBRATION.label, t99012.bottomMm - 1);
    expect(lower.ok && lower.value.headOffsetDots).toBe(-18 + 12); // content too low -> larger offset
  });

  test('sign matches the rasterizer: smaller offset moves the frame towards the label edge (dot 0)', () => {
    const H = mmToDots(lw99012.widthMm, 300);
    const yBottom = mmToDots(lw99012.printable.yMm + lw99012.printable.heightMm, 300) - 1;
    const dot = (o: number) => headOffsetDots(lw99012, H, { ...DEFAULT_CALIBRATION, label: { ...DEFAULT_CALIBRATION.label, headOffsetDots: o } }) + (H - 1 - yBottom);
    expect(dot(-17) - dot(0)).toBe(-17);
  });

  test('implausible input', () => {
    const r = solveLabelAcross(lw99012, zero, 30);
    expect(r.ok).toBe(false);
    const r2 = solveLabelAcross(lw99012, zero, 9);
    expect(!r2.ok && r2.error.code).toBe('frameOff');
  });
});

describe('solveTapeCenter', () => {
  const t24 = media('d1-24mm');

  test('gap above larger than below: content too low, positive correction moves it up', () => {
    const r = solveTapeCenter(t24, 0, 3, 1);
    // half the difference = 1 mm = 7.09 dots at 180 dpi
    expect(r.ok && r.value.centerCorrectionDots).toBe(7);
    const r2 = solveTapeCenter(t24, 7, 1, 3);
    expect(r2.ok && r2.value.centerCorrectionDots).toBe(0);
  });

  test('positive correction = higher dot numbers = towards the design top', () => {
    const H = mmToDots(24, 180);
    const img = { width: 10, height: H, data: new Uint8ClampedArray(10 * H * 4).fill(255) };
    const y = 80;
    const p = (y * 10) * 4;
    img.data[p] = img.data[p + 1] = img.data[p + 2] = 0;
    const cal: Calibration = cloneCalibration(DEFAULT_CALIBRATION);
    const dotOf = (c: Calibration) => {
      const bm = rasterize({ image: img as unknown as ImageData, media: t24 }, { calibration: c });
      for (let d = 0; d < 128; d++) if ((bm.data[d >> 3] >> (7 - (d & 7))) & 1) return d;
      return -1;
    };
    const base = dotOf(cal);
    cal.tape.centerCorrectionDots[24] = 5;
    expect(dotOf(cal)).toBe(base + 5);
    // Design row y - 1 (one row closer to the design top) also lands one dot higher.
    expect(headOffsetDots(t24, H) + (H - 1 - (y - 1))).toBe(base + 1);
  });

  test('implausible input', () => {
    expect(solveTapeCenter(t24, 0, -1, 2).ok).toBe(false);
    const r = solveTapeCenter(t24, 0, 9, 9);
    expect(!r.ok && r.error.code).toBe('gapSumOff');
  });
});

describe('solveCalibration', () => {
  test('label: applies feed and across, reports changes, leaves tape untouched', () => {
    const s = solveCalibration(lw99012, DEFAULT_CALIBRATION, {
      labelFeed: { frameMeasuredMm: 6.3, tickMm: 80, tickMeasuredMm: 80 },
      labelAcross: { bottomMeasuredMm: 1.52 },
    });
    expect(s.errors).toEqual([]);
    expect(s.calibration.label).toEqual({ headOffsetDots: -18, feedStartDots: 65.8, feedScale: 1.00543 });
    expect(s.changes.map((c) => c.key)).toEqual(['feedStartDots', 'feedScale', 'headOffsetDots']);
    expect(s.calibration.tape).toEqual(DEFAULT_CALIBRATION.tape);
  });

  test('only one group given keeps the other values', () => {
    const s = solveCalibration(lw99012, DEFAULT_CALIBRATION, { labelAcross: { bottomMeasuredMm: 2.52 } });
    expect(s.calibration.label.feedStartDots).toBe(62.4);
    expect(s.calibration.label.headOffsetDots).toBe(-30);
  });

  test('unknown tick and empty input are reported', () => {
    expect(solveCalibration(lw99012, DEFAULT_CALIBRATION, { labelFeed: { frameMeasuredMm: 6, tickMm: 85, tickMeasuredMm: 85 } }).errors[0]).toEqual({ code: 'noTick', params: { tick: 85 } });
    expect(solveCalibration(lw99012, DEFAULT_CALIBRATION, {}).errors.length).toBe(1);
  });

  test('tape: only the measured width changes', () => {
    const s = solveCalibration(media('d1-12mm'), DEFAULT_CALIBRATION, { tape: { gapTopMm: 1.7, gapBottomMm: 2.5 } });
    expect(s.errors).toEqual([]);
    expect(s.calibration.tape.centerCorrectionDots[12]).toBe(-3);
    expect(s.calibration.tape.centerCorrectionDots[24]).toBe(0);
    expect(s.calibration.label).toEqual(DEFAULT_CALIBRATION.label);
  });
});
