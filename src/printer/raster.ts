// Design-orientation ImageData -> 1-bit bitmap in print-head orientation.
// Pure functions, unit tested in __tests__/raster.test.ts.
//
// Orientation (docs/protocol.md, "Orientation"):
//   The design is landscape as the user reads the label: x runs along the feed, y across it.
//   Both DYMO PPDs for this device declare *LandscapeOrientation: Minus90, i.e. the landscape
//   page is turned 90 degrees clockwise onto the portrait page the printer rasterizes.
//   Portrait row 0 is printed first; portrait column 0 is the MSB of the first byte (dot 0).
//   Clockwise rotation maps design pixel (x, y) to portrait (column H-1-y, row x):
//     - the left edge of the design is printed first,
//     - the bottom edge of the design lands on the low dot numbers of the head.
//   This follows the vendor PPD; the supervised test print must confirm it (see report).
//
// Placement across the head:
//   label: the label edge sits at head dot 0 (every DUO Label PageSize has cupsInteger0 0,
//          i.e. no offset, in dymo-cups-drivers lwduol.ppd). Dots beyond 671 are dropped.
//   tape:  the tape is centred on the 128-dot head (the vendor CUPS driver also centres the
//          raster line), plus an optional per-width correction.

import type { Calibration, DesignRaster, Media, MonoBitmap } from './types';
import { LABEL_DPI, LABEL_HEAD_DOTS, TAPE_DPI, TAPE_HEAD_DOTS } from './commands';

export type DitherMode = 'threshold' | 'floyd-steinberg';

export interface RasterizeOptions {
  /** Default 'threshold' (keeps text and barcodes sharp). */
  dither?: DitherMode;
  /** Luminance cut-off 0..255, pixels darker than this print. Default 128. */
  threshold?: number;
  /**
   * Continuous media only: feed length in mm. Defaults to the image width.
   * Die-cut labels always use media.lengthMm.
   */
  lengthMm?: number;
  /** Per-device calibration. Defaults to DEFAULT_CALIBRATION (René's DUO, PID 0x001D). */
  calibration?: Calibration;
}

/**
 * Tape centring correction in dots per tape width, positive = towards higher dot numbers.
 * All zero until the supervised test print measures an offset. The vendor driver applies
 * small empirical corrections of the same order (+2 dots for 12 mm, -4 for 19 mm on its
 * truncated raster), see docs/protocol.md.
 */
export const TAPE_CENTER_CORRECTION_DOTS: Record<number, number> = { 6: 0, 9: 0, 12: 0, 19: 0, 24: 0 };

/**
 * Default label engine calibration (DEFAULT_CALIBRATION below). Per-device values measured with
 * the in-app wizard are stored by calibration.ts and passed in via RasterizeOptions.calibration.
 * Measured on the DUO (PID 0x001D) with 99012 labels, 3 identical
 * prints in two jobs (so not a first-label / reverse-feed effect):
 *   - across the head the label edge sits about 1.5 mm below head dot 0 (content printed 1.5 mm
 *     too far towards the design top with offset 0),
 *   - along the feed the printer starts about 5 mm into the label and advances about 1 %
 *     more per raster line than nominal (measured: design 6.0 mm -> 6.3 mm, design 80 mm ->
 *     81 mm). Raster row r therefore lands at design position
 *     LABEL_FEED_START_DOTS + r * LABEL_FEED_SCALE.
 * The vendor PPD margins (1.5 mm across, 6 mm leading) are larger, so nothing printable is lost.
 */
export const LABEL_HEAD_OFFSET_DOTS = -18;
export const LABEL_FEED_START_DOTS = 62.4;
export const LABEL_FEED_SCALE = 1.0095;

/**
 * The constants above as a Calibration. Used whenever no per-device calibration is stored;
 * printing with it is byte-identical to the hardcoded behaviour before calibration existed.
 */
export const DEFAULT_CALIBRATION: Calibration = Object.freeze({
  label: Object.freeze({
    headOffsetDots: LABEL_HEAD_OFFSET_DOTS,
    feedStartDots: LABEL_FEED_START_DOTS,
    feedScale: LABEL_FEED_SCALE,
  }),
  tape: Object.freeze({ centerCorrectionDots: Object.freeze({ ...TAPE_CENTER_CORRECTION_DOTS }) }),
}) as Calibration;

/**
 * Design columns [from, to) that raster row r covers. Every column is covered by exactly one
 * row (no thin vertical line can be dropped); a row ORs the columns it covers.
 */
export function labelSourceSpan(r: number, cal: Calibration['label'] = DEFAULT_CALIBRATION.label): [number, number] {
  const from = Math.floor(cal.feedStartDots + r * cal.feedScale);
  const to = Math.floor(cal.feedStartDots + (r + 1) * cal.feedScale);
  return [from, Math.max(from + 1, to)];
}

/** Tape centring correction for a tape width (0 when the width has no entry). */
export function tapeCorrectionDots(cal: Calibration, widthMm: number): number {
  return cal.tape.centerCorrectionDots[widthMm] ?? 0;
}

/** Head dot that portrait column 0 of the design lands on. */
export function headOffsetDots(media: Media, designHeightDots: number, cal: Calibration = DEFAULT_CALIBRATION): number {
  if (media.target === 'label') return cal.label.headOffsetDots;
  return Math.round(TAPE_HEAD_DOTS / 2 - designHeightDots / 2) + tapeCorrectionDots(cal, media.widthMm);
}

export function headDots(media: Media): number {
  return media.target === 'label' ? LABEL_HEAD_DOTS : TAPE_HEAD_DOTS;
}

export function engineDpi(media: Media): number {
  return media.target === 'label' ? LABEL_DPI : TAPE_DPI;
}

export const mmToDots = (mm: number, dpi: number): number => Math.round((mm / 25.4) * dpi);

/** Number of raster lines along the feed for this job. */
export function feedRows(media: Media, image: Pick<ImageData, 'width'>, lengthMm?: number): number {
  const dpi = engineDpi(media);
  if (media.lengthMm !== null) return mmToDots(media.lengthMm, dpi);
  if (lengthMm !== undefined) return Math.max(1, mmToDots(lengthMm, dpi));
  return image.width;
}

/**
 * Convert RGBA to a darkness mask in design orientation (1 = print).
 * Transparent pixels count as white paper.
 */
export function toMonoDesign(
  image: Pick<ImageData, 'width' | 'height' | 'data'>,
  dither: DitherMode = 'threshold',
  threshold = 128,
): Uint8Array {
  const { width: w, height: h, data } = image;
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const a = data[p + 3] / 255;
    const y = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    lum[i] = 255 - a * (255 - y);
  }
  const out = new Uint8Array(w * h);
  if (dither === 'threshold') {
    for (let i = 0; i < w * h; i++) out[i] = lum[i] < threshold ? 1 : 0;
    return out;
  }
  // Floyd-Steinberg error diffusion, serpentine scan to avoid directional artefacts.
  for (let y = 0; y < h; y++) {
    const ltr = y % 2 === 0;
    for (let k = 0; k < w; k++) {
      const x = ltr ? k : w - 1 - k;
      const i = y * w + x;
      const old = lum[i];
      const ink = old < threshold;
      out[i] = ink ? 1 : 0;
      const err = old - (ink ? 0 : 255);
      const dx = ltr ? 1 : -1;
      if (x + dx >= 0 && x + dx < w) lum[i + dx] += (err * 7) / 16;
      if (y + 1 < h) {
        if (x - dx >= 0 && x - dx < w) lum[i + w - dx] += (err * 3) / 16;
        lum[i + w] += (err * 5) / 16;
        if (x + dx >= 0 && x + dx < w) lum[i + w + dx] += (err * 1) / 16;
      }
    }
  }
  return out;
}

/**
 * Rotate, binarize and place a design raster on the print head.
 * Result: width = head dots (672 label / 128 tape), height = feed rows.
 * Design columns beyond the feed length are cropped, missing columns stay blank.
 */
export function rasterize(raster: DesignRaster, opts: RasterizeOptions = {}): MonoBitmap {
  const { image, media } = raster;
  const width = headDots(media);
  const bytesPerRow = width / 8;
  const height = feedRows(media, image, opts.lengthMm);
  const data = new Uint8Array(bytesPerRow * height);
  const mono = toMonoDesign(image, opts.dither ?? 'threshold', opts.threshold ?? 128);
  const H = image.height;
  const cal = opts.calibration ?? DEFAULT_CALIBRATION;
  const offset = headOffsetDots(media, H, cal);
  const isLabel = media.target === 'label';
  const W = image.width;
  for (let y = 0; y < H; y++) {
    const dot = offset + (H - 1 - y); // portrait column H-1-y, shifted onto the head
    if (dot < 0 || dot >= width) continue;
    const byteIdx = dot >> 3;
    const mask = 0x80 >> (dot & 7);
    const src = y * image.width;
    for (let r = 0; r < height; r++) {
      let from = r;
      let to = r + 1;
      if (isLabel) [from, to] = labelSourceSpan(r, cal.label);
      if (from >= W) break;
      for (let x = from; x < Math.min(to, W); x++) {
        if (mono[src + x]) {
          data[r * bytesPerRow + byteIdx] |= mask;
          break;
        }
      }
    }
  }
  return { width, height, bytesPerRow, data };
}
