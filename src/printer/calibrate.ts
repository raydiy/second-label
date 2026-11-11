// Calibration solver: ruler measurements of a printed test pattern -> new calibration.
// Pure functions, unit tested in __tests__/calibrate.test.ts.
//
// Every solve is RELATIVE to the calibration that was active when the pattern was printed,
// so the wizard must pass exactly that one (not whatever is stored by the time the user types).
//
// Label, along the feed (x). The rasterizer sends design column s + r * k on raster row r
// (s = feedStartDots, k = feedScale). The printer puts raster row r at physical position
// P0 + r * q from the leading label edge, where P0 (start offset) and q (advance per row) are
// properties of the printer. Hence for a design position x:
//     physical(x) = P0 + (x - s) / k * q
// Two measurements (frame line x1, numbered tick x2) give
//     q  = (m2 - m1) * k / (x2 - x1)
//     P0 = m1 - (x1 - s) / k * q
// and physical(x) = x for all x requires k' = q and s' = P0.
//
// Label, across the head (y). Design row y prints on head dot offset + (H - 1 - y), i.e. the
// design bottom sits on low dot numbers next to the label guide. Expected distance from the
// bottom label edge to the bottom frame line is widthMm - (printable.yMm + printable.heightMm).
// Content printed too high (measured > expected) needs a smaller offset:
//     offset' = offset - round((measured - expected) * dpi / 25.4)
//
// Tape, across the head. Same mapping, and a POSITIVE correction moves every design row to a
// HIGHER dot number, which is towards the design TOP (design top = highest dots). If the gap
// above the frame is larger than the gap below, the content sits too low and must move up:
//     correction' = correction + round((gapTop - gapBottom) / 2 * dpi / 25.4)

import type { Calibration, Media } from './types';
import { CALIBRATION_LIMITS, cloneCalibration } from './calibration';
import { testPatternGeometry } from './testpattern';

export type SolveResult<T> = { ok: true; value: T } | { ok: false; error: string };

const MM_PER_INCH = 25.4;
const de = (v: number, d = 1) => v.toFixed(d).replace('.', ',');
const fail = <T>(error: string): SolveResult<T> => ({ ok: false, error });
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Design positions (mm) the user measures against, taken from the exact pattern geometry. */
export function measurementTargets(media: Media) {
  const g = testPatternGeometry(media);
  const toMm = (dots: number) => (dots / g.dpi) * MM_PER_INCH;
  return {
    /** Left edge of the left frame line, from the left label edge. */
    frameXMm: toMm(g.frame.x0),
    /** Numbered ticks: nominal label (mm) and exact design position of the tick centre. */
    ticks: g.ticks.filter((t) => t.numbered).map((t) => ({ mm: t.mm, xMm: toMm(t.x) })),
    /** Expected distance bottom label edge -> bottom edge of the bottom frame line. */
    bottomMm: media.widthMm - (media.printable.yMm + media.printable.heightMm),
    /** Tape: expected gap above and below the frame (equal when centred). */
    gapMm: (media.widthMm - media.printable.heightMm) / 2,
  };
}

export interface LabelFeedInput {
  /** Design x of the left frame line in mm. */
  frameDesignMm: number;
  /** Measured distance left label edge -> left frame line in mm. */
  frameMeasuredMm: number;
  /** Design x of the chosen tick in mm. */
  tickDesignMm: number;
  /** Measured distance left label edge -> that tick in mm. */
  tickMeasuredMm: number;
}

export function solveLabelFeed(
  media: Media,
  active: Calibration['label'],
  m: LabelFeedInput,
): SolveResult<{ feedStartDots: number; feedScale: number }> {
  if (media.target !== 'label') return fail('Die Vorschub-Kalibrierung gilt nur für Etiketten.');
  const len = media.lengthMm ?? Infinity;
  if (!isNum(m.frameMeasuredMm) || !isNum(m.tickMeasuredMm)) return fail('Bitte beide Längen-Messwerte als Zahl in mm eingeben.');
  if (m.frameMeasuredMm < 0 || m.frameMeasuredMm > 30) {
    return fail(`Abstand zur linken Rahmenlinie: ${de(m.frameMeasuredMm)} mm ist unplausibel (erwartet etwa ${de(m.frameDesignMm)} mm).`);
  }
  if (m.tickMeasuredMm <= m.frameMeasuredMm) return fail('Der Strich muss weiter von der linken Etikettenkante entfernt sein als die Rahmenlinie.');
  if (m.tickMeasuredMm > len) return fail(`Der Strich kann nicht weiter als die Etikettenlänge (${len} mm) entfernt sein.`);
  if (m.tickDesignMm - m.frameDesignMm < 20) return fail('Bitte einen Strich wählen, der mindestens 20 mm rechts der Rahmenlinie liegt.');

  const dpi = media.dpi;
  const s = (active.feedStartDots / dpi) * MM_PER_INCH; // mm
  const k = active.feedScale;
  const q = ((m.tickMeasuredMm - m.frameMeasuredMm) * k) / (m.tickDesignMm - m.frameDesignMm);
  const p0 = m.frameMeasuredMm - ((m.frameDesignMm - s) / k) * q; // mm
  if (q < CALIBRATION_LIMITS.feedScale.min || q > CALIBRATION_LIMITS.feedScale.max) {
    const pct = (q - 1) * 100;
    return fail(`Die Messung ergibt einen Vorschubfehler von ${de(pct)} %. Das ist unplausibel, bitte nachmessen (richtiger Strich? Ab der linken Etikettenkante gemessen?).`);
  }
  const feedStartDots = Math.round(((p0 / MM_PER_INCH) * dpi) * 10) / 10;
  if (feedStartDots < CALIBRATION_LIMITS.feedStartDots.min || feedStartDots > CALIBRATION_LIMITS.feedStartDots.max) {
    return fail(`Die Messung ergibt einen Druckbeginn bei ${de(p0)} mm. Das ist unplausibel, bitte nachmessen.`);
  }
  return { ok: true, value: { feedStartDots, feedScale: Math.round(q * 1e5) / 1e5 } };
}

export function solveLabelAcross(
  media: Media,
  active: Calibration['label'],
  bottomMeasuredMm: number,
): SolveResult<{ headOffsetDots: number }> {
  if (media.target !== 'label') return fail('Diese Messung gilt nur für Etiketten.');
  if (!isNum(bottomMeasuredMm)) return fail('Bitte den Abstand zur unteren Rahmenlinie als Zahl in mm eingeben.');
  const expected = media.widthMm - (media.printable.yMm + media.printable.heightMm);
  if (bottomMeasuredMm < 0 || bottomMeasuredMm > media.widthMm / 2) {
    return fail(`Abstand zur unteren Rahmenlinie: ${de(bottomMeasuredMm)} mm ist unplausibel (erwartet etwa ${de(expected)} mm).`);
  }
  if (Math.abs(bottomMeasuredMm - expected) > 6) {
    return fail(`Der Rahmen liegt ${de(bottomMeasuredMm - expected)} mm daneben. Das ist mehr als plausibel, bitte nachmessen (untere Kante, großes Quadrat oben links?).`);
  }
  const headOffsetDots = active.headOffsetDots - Math.round(((bottomMeasuredMm - expected) * media.dpi) / MM_PER_INCH);
  const lim = CALIBRATION_LIMITS.headOffsetDots;
  if (headOffsetDots < lim.min || headOffsetDots > lim.max) return fail('Der berechnete Versatz liegt außerhalb des zulässigen Bereichs. Bitte nachmessen.');
  return { ok: true, value: { headOffsetDots } };
}

export function solveTapeCenter(
  media: Media,
  activeCorrectionDots: number,
  gapTopMm: number,
  gapBottomMm: number,
): SolveResult<{ centerCorrectionDots: number }> {
  if (media.target !== 'tape') return fail('Diese Messung gilt nur für Band.');
  if (!isNum(gapTopMm) || !isNum(gapBottomMm)) return fail('Bitte beide Abstände als Zahl in mm eingeben.');
  if (gapTopMm < 0 || gapBottomMm < 0) return fail('Abstände können nicht negativ sein.');
  if (gapTopMm > media.widthMm || gapBottomMm > media.widthMm) return fail(`Ein Abstand ist größer als die Bandbreite (${media.widthMm} mm).`);
  const expectedSum = media.widthMm - media.printable.heightMm;
  const sum = gapTopMm + gapBottomMm;
  if (Math.abs(sum - expectedSum) > 2.5) {
    return fail(`Die beiden Abstände ergeben zusammen ${de(sum)} mm, erwartet sind etwa ${de(expectedSum)} mm (Bandbreite minus Rahmenhöhe). Bitte nachmessen.`);
  }
  const shift = Math.round((((gapTopMm - gapBottomMm) / 2) * media.dpi) / MM_PER_INCH);
  const centerCorrectionDots = activeCorrectionDots + shift;
  const lim = CALIBRATION_LIMITS.tapeCorrectionDots;
  if (centerCorrectionDots < lim.min || centerCorrectionDots > lim.max) return fail('Die berechnete Korrektur liegt außerhalb des zulässigen Bereichs. Bitte nachmessen.');
  return { ok: true, value: { centerCorrectionDots } };
}

/** Wizard input. Leave a group undefined to keep the corresponding values. */
export interface CalibrationInput {
  labelFeed?: { frameMeasuredMm: number; tickMm: number; tickMeasuredMm: number };
  labelAcross?: { bottomMeasuredMm: number };
  tape?: { gapTopMm: number; gapBottomMm: number };
}

export interface CalibrationChange {
  key: 'headOffsetDots' | 'feedStartDots' | 'feedScale' | 'centerCorrectionDots';
  label: string;
  before: number;
  after: number;
}

export interface CalibrationSolution {
  calibration: Calibration;
  changes: CalibrationChange[];
  errors: string[];
}

/**
 * Apply all given measurements to `printedWith` (the calibration active at print time).
 * Groups with errors leave their values unchanged and report a German message.
 */
export function solveCalibration(media: Media, printedWith: Calibration, input: CalibrationInput): CalibrationSolution {
  const cal = cloneCalibration(printedWith);
  const changes: CalibrationChange[] = [];
  const errors: string[] = [];
  const t = measurementTargets(media);

  if (media.target === 'label') {
    if (!input.labelFeed && !input.labelAcross) errors.push('Bitte mindestens eine Messung eingeben.');
    if (input.labelFeed) {
      const tick = t.ticks.find((x) => x.mm === input.labelFeed!.tickMm);
      const r = tick
        ? solveLabelFeed(media, printedWith.label, {
            frameDesignMm: t.frameXMm,
            frameMeasuredMm: input.labelFeed.frameMeasuredMm,
            tickDesignMm: tick.xMm,
            tickMeasuredMm: input.labelFeed.tickMeasuredMm,
          })
        : fail<{ feedStartDots: number; feedScale: number }>(`Auf diesem Etikett gibt es keinen beschrifteten Strich „${input.labelFeed.tickMm}“.`);
      if (r.ok) {
        changes.push({ key: 'feedStartDots', label: 'Druckbeginn (Punkte)', before: printedWith.label.feedStartDots, after: r.value.feedStartDots });
        changes.push({ key: 'feedScale', label: 'Vorschub-Faktor', before: printedWith.label.feedScale, after: r.value.feedScale });
        Object.assign(cal.label, r.value);
      } else errors.push(r.error);
    }
    if (input.labelAcross) {
      const r = solveLabelAcross(media, printedWith.label, input.labelAcross.bottomMeasuredMm);
      if (r.ok) {
        changes.push({ key: 'headOffsetDots', label: 'Versatz quer (Punkte)', before: printedWith.label.headOffsetDots, after: r.value.headOffsetDots });
        cal.label.headOffsetDots = r.value.headOffsetDots;
      } else errors.push(r.error);
    }
  } else {
    if (!input.tape) errors.push('Bitte beide Abstände eingeben.');
    else {
      const before = printedWith.tape.centerCorrectionDots[media.widthMm] ?? 0;
      const r = solveTapeCenter(media, before, input.tape.gapTopMm, input.tape.gapBottomMm);
      if (r.ok) {
        changes.push({ key: 'centerCorrectionDots', label: `Korrektur ${media.widthMm}-mm-Band (Punkte)`, before, after: r.value.centerCorrectionDots });
        cal.tape.centerCorrectionDots[media.widthMm] = r.value.centerCorrectionDots;
      } else errors.push(r.error);
    }
  }
  return { calibration: cal, changes, errors };
}
