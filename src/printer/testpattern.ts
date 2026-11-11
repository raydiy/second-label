// Calibration test pattern, design orientation (landscape, as the label is read).
// Pure function, no DOM: returns an ImageData-shaped object the driver can print as is.
//
//   - 3-dot outline of media.printable (the frame)
//   - big filled square at the TOP-LEFT corner of the frame, small one at the BOTTOM-LEFT
//     (hold the print so the big square is top left, then "left", "top" and "bottom" are clear)
//   - ticks along the bottom of the frame every 10 mm, measured from the LEFT EDGE OF THE
//     LABEL (design x = 10, 20, ... mm), not from the frame; every tick that has room carries
//     its distance in mm as a small number above it, every 50 mm tick is longer and thicker.
//
// The geometry is exported so the calibration solver uses the exact dot positions.

import type { Media } from './types';
import { mmToDots } from './raster';

/** Length of the tape test pattern in mm. */
export const TAPE_PATTERN_LENGTH_MM = 60;
/** Outline thickness in dots. */
export const FRAME_THICKNESS_DOTS = 3;

export interface PatternTick {
  /** Nominal distance from the left label edge in mm (10, 20, ...). */
  mm: number;
  /** Design column of the tick centre. */
  x: number;
  major: boolean;
  /** Whether the number is printed above the tick. */
  numbered: boolean;
}

export interface PatternGeometry {
  dpi: number;
  /** Design size in dots. */
  width: number;
  height: number;
  /** Frame outer edges in dots: x0 = left edge of the left line, y1 = bottom edge of the bottom line. */
  frame: { x0: number; x1: number; y0: number; y1: number };
  ticks: PatternTick[];
  /** Digit scale (dots per font pixel), 0 when no numbers fit. */
  digitScale: number;
}

export interface PatternImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

// 5 x 7 digit font, one string per row, '1' = ink.
const DIGITS: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
};
const GLYPH_W = 5;
const GLYPH_H = 7;
const GLYPH_GAP = 1;

const textWidth = (s: string, scale: number) => (s.length * (GLYPH_W + GLYPH_GAP) - GLYPH_GAP) * scale;

/** Default pattern length: the label length, or TAPE_PATTERN_LENGTH_MM for continuous media. */
export function patternLengthMm(media: Media): number {
  return media.lengthMm ?? TAPE_PATTERN_LENGTH_MM;
}

type Box = [number, number, number, number]; // x0, y0, x1, y1 (exclusive)
const overlaps = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

interface Layout extends PatternGeometry {
  squares: Box[];
  tickBoxes: Box[];
  numberBoxes: (Box | null)[];
}

function layout(media: Media, lengthMm: number): Layout {
  const dpi = media.dpi;
  const W = mmToDots(lengthMm, dpi);
  const H = mmToDots(media.widthMm, dpi);
  const p = media.printable;
  const t = FRAME_THICKNESS_DOTS;
  const x0 = mmToDots(p.xMm, dpi);
  const x1 = media.lengthMm === null ? W - mmToDots(p.xMm, dpi) : mmToDots(p.xMm + p.widthMm, dpi);
  const y0 = mmToDots(p.yMm, dpi);
  const y1 = mmToDots(p.yMm + p.heightMm, dpi);

  const big = Math.min(mmToDots(6, dpi), Math.floor((y1 - y0) / 2));
  const small = Math.max(4, Math.floor(big / 2));
  const squares: Box[] = [
    [x0 + t + 2, y0 + t + 2, x0 + t + 2 + big, y0 + t + 2 + big],
    [x0 + t + 2, y1 - t - 2 - small, x0 + t + 2 + small, y1 - t - 2],
  ];

  const minorLen = mmToDots(1.5, dpi);
  const majorLen = mmToDots(3, dpi);
  const ticks: PatternTick[] = [];
  const tickBoxes: Box[] = [];
  for (let mm = 10; mm < lengthMm; mm += 10) {
    const x = mmToDots(mm, dpi);
    const major = mm % 50 === 0;
    const half = major ? 2 : 1;
    if (x - half <= x0 + t || x + half >= x1 - t) continue;
    const len = Math.min(major ? majorLen : minorLen, Math.max(1, y1 - y0 - 2 * t - 2));
    ticks.push({ mm, x, major, numbered: false });
    tickBoxes.push([x - half, y1 - t - len, x + half + 1, y1 - t]); // centred on x: 3 or 5 dots wide
  }

  // Largest digit scale (up to ~1.6 mm glyph height) at which most numbers fit inside the frame.
  const preferred = Math.max(1, Math.round(mmToDots(1.6, dpi) / GLYPH_H));
  const place = (scale: number) =>
    ticks.map((tk, i) => {
      const label = String(tk.mm);
      const w = textWidth(label, scale);
      const bottom = tickBoxes[i][1] - Math.max(2, scale);
      const box: Box = [tk.x - Math.floor(w / 2), bottom - GLYPH_H * scale, tk.x - Math.floor(w / 2) + w, bottom];
      const inside = box[0] > x0 + t && box[2] < x1 - t && box[1] > y0 + t + 1;
      const clear = inside && !squares.some((s) => overlaps(box, s)) && !tickBoxes.some((b, j) => j !== i && overlaps(box, b));
      return clear ? box : null;
    });
  let digitScale = 0;
  let numberBoxes: (Box | null)[] = ticks.map(() => null);
  for (let s = preferred; s >= 1; s--) {
    const boxes = place(s);
    // Neighbouring numbers must not touch each other either.
    for (let i = 1; i < boxes.length; i++) {
      const a = boxes[i - 1];
      const b = boxes[i];
      if (a && b && a[2] + s * 2 > b[0]) boxes[i] = null;
    }
    const placed = boxes.filter(Boolean).length;
    if (placed > 0 && placed >= Math.ceil(ticks.length / 2)) {
      digitScale = s;
      numberBoxes = boxes;
      break;
    }
  }
  ticks.forEach((tk, i) => { tk.numbered = numberBoxes[i] !== null; });

  return { dpi, width: W, height: H, frame: { x0, x1, y0, y1 }, ticks, digitScale, squares, tickBoxes, numberBoxes };
}

/** Geometry of the pattern for a medium (dot positions of frame and ticks). */
export function testPatternGeometry(media: Media, lengthMm = patternLengthMm(media)): PatternGeometry {
  const { squares: _s, tickBoxes: _t, numberBoxes: _n, ...geo } = layout(media, lengthMm);
  return geo;
}

/** Render the pattern at media.dpi. Opaque black on white RGBA. */
export function renderTestPattern(media: Media, lengthMm = patternLengthMm(media)): PatternImage {
  const L = layout(media, lengthMm);
  const { width: W, height: H } = L;
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  const ink = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const p = (y * W + x) * 4;
    data[p] = data[p + 1] = data[p + 2] = 0;
  };
  const rect = ([ax, ay, bx, by]: Box) => {
    for (let y = ay; y < by; y++) for (let x = ax; x < bx; x++) ink(x, y);
  };
  const { x0, x1, y0, y1 } = L.frame;
  const t = FRAME_THICKNESS_DOTS;
  rect([x0, y0, x1, y0 + t]);
  rect([x0, y1 - t, x1, y1]);
  rect([x0, y0, x0 + t, y1]);
  rect([x1 - t, y0, x1, y1]);
  L.squares.forEach(rect);
  L.tickBoxes.forEach(rect);
  L.ticks.forEach((tk, i) => {
    const box = L.numberBoxes[i];
    if (!box) return;
    const s = L.digitScale;
    String(tk.mm).split('').forEach((ch, k) => {
      const gx = box[0] + k * (GLYPH_W + GLYPH_GAP) * s;
      DIGITS[ch].forEach((row, gy) => {
        for (let c = 0; c < GLYPH_W; c++) {
          if (row[c] === '1') rect([gx + c * s, box[1] + gy * s, gx + (c + 1) * s, box[1] + (gy + 1) * s]);
        }
      });
    });
  });
  return { width: W, height: H, data };
}
