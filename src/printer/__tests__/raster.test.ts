import { describe, expect, test } from 'bun:test';
import {
  LABEL_FEED_SCALE,
  labelSourceSpan,
  LABEL_HEAD_OFFSET_DOTS as O,
  feedRows,
  headOffsetDots,
  mmToDots,
  rasterize,
  toMonoDesign,
} from '../raster';
import { findMedia } from '../media';
import type { Media } from '../types';

type Img = { width: number; height: number; data: Uint8ClampedArray };

function blank(width: number, height: number): Img {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) };
}
function setPx(img: Img, x: number, y: number, v = 0, a = 255) {
  const p = (y * img.width + x) * 4;
  img.data[p] = img.data[p + 1] = img.data[p + 2] = v;
  img.data[p + 3] = a;
}
const asImageData = (img: Img) => img as unknown as ImageData;
const bit = (bm: { data: Uint8Array; bytesPerRow: number }, row: number, dot: number) =>
  (bm.data[row * bm.bytesPerRow + (dot >> 3)] >> (7 - (dot & 7))) & 1;
const media = (id: string): Media => {
  const m = findMedia(id);
  if (!m) throw new Error(id);
  return m;
};

describe('toMonoDesign', () => {
  test('threshold with alpha compositing over white paper', () => {
    const img = blank(4, 1);
    setPx(img, 0, 0, 0); // black
    setPx(img, 1, 0, 127); // dark grey -> ink
    setPx(img, 2, 0, 128); // mid grey -> paper
    setPx(img, 3, 0, 0, 0); // fully transparent black -> paper
    expect(Array.from(toMonoDesign(asImageData(img)))).toEqual([1, 1, 0, 0]);
  });

  test('Floyd-Steinberg renders 50 % grey as roughly half the dots', () => {
    const img = blank(64, 64);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) setPx(img, x, y, 128);
    const mono = toMonoDesign(asImageData(img), 'floyd-steinberg');
    const ink = mono.reduce((a, b) => a + b, 0) / mono.length;
    expect(ink).toBeGreaterThan(0.45);
    expect(ink).toBeLessThan(0.55);
    // plain threshold of the same image prints nothing
    expect(toMonoDesign(asImageData(img)).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('rasterize: label engine', () => {
  const m = media('lw-99010'); // 28 x 89 mm
  const W = mmToDots(89, 300); // 1051 rows along the feed
  const H = mmToDots(28, 300); // 331 dots across
  const F = labelSourceSpan(0)[0]; // first design column on raster row 0
  const rowOf = (x: number) => {
    for (let r = 0; r < 2000; r++) {
      const [a, b] = labelSourceSpan(r);
      if (x >= a && x < b) return r;
    }
    return -1;
  };

  test('output is full head width and label length', () => {
    const bm = rasterize({ image: asImageData(blank(W, H)), media: m });
    expect(bm.width).toBe(672);
    expect(bm.bytesPerRow).toBe(84);
    expect(bm.height).toBe(W);
  });

  test('rotation: design bottom-left prints first on dot 0, top-left on dot H-1', () => {
    const img = blank(W, H);
    // Calibrated: design column F prints on row 0, design row H-1+O (O < 0) on dot 0.
    setPx(img, F, H - 1 + O); // bottom-left of the printable area
    setPx(img, F, 0); // top-left
    setPx(img, W - 1, H - 1 + O); // bottom-right
    setPx(img, F - 1, H - 1 + O); // before the first raster line: dropped
    setPx(img, F, H - 1); // below head dot 0: dropped
    const bm = rasterize({ image: asImageData(img), media: m });
    expect(bit(bm, 0, 0)).toBe(1);
    expect(bit(bm, 0, H - 1 + O)).toBe(1);
    expect(bit(bm, rowOf(W - 1), 0)).toBe(1);
    // nothing else set
    let total = 0;
    for (const v of bm.data) total += v.toString(2).split('1').length - 1;
    expect(total).toBe(3);
  });

  test('label edge offset follows the measured calibration', () => {
    expect(headOffsetDots(m, H)).toBe(O);
    expect(O).toBe(-18);
    expect(F).toBe(62);
    expect(LABEL_FEED_SCALE).toBeGreaterThan(1);
  });

  test('feed mapping covers every design column exactly once', () => {
    let next = labelSourceSpan(0)[0];
    for (let r = 0; r < 1200; r++) {
      const [a, b] = labelSourceSpan(r);
      expect(a).toBe(next);
      expect(b).toBeGreaterThan(a);
      next = b;
    }
  });

  test('labels wider than the head lose the design top, not the bottom', () => {
    const wide = media('lw-99019'); // 59 mm across = 697 dots
    const h = mmToDots(59, 300);
    const img = blank(F + 10, h);
    setPx(img, F, 0); // design top row: beyond dot 671
    setPx(img, F + 1, h - 1 + O); // lowest printable design row: dot 0
    const bm = rasterize({ image: asImageData(img), media: wide });
    expect(bit(bm, 1, 0)).toBe(1);
    expect(bm.data.slice(0, bm.bytesPerRow).every((v) => v === 0)).toBe(true);
  });

  test('continuous paper takes lengthMm from options, else the image width', () => {
    const c = media('lw-continuous-57');
    expect(feedRows(c, { width: 500 })).toBe(500);
    expect(feedRows(c, { width: 500 }, 100)).toBe(mmToDots(100, 300));
    const bm = rasterize({ image: asImageData(blank(500, 673)), media: c }, { lengthMm: 10 });
    expect(bm.height).toBe(118);
  });
});

describe('rasterize: tape engine', () => {
  test('24 mm tape is centred on the 128-dot head', () => {
    const m = media('d1-24mm');
    const H = mmToDots(24, 180); // 170
    expect(headOffsetDots(m, H)).toBe(64 - 85);
    const img = blank(400, H);
    // design rows 21..148 are the 128 printable dots
    setPx(img, 0, H - 1 - 21); // -> dot 0
    setPx(img, 0, H - 1 - 148); // -> dot 127
    setPx(img, 0, 0); // design top edge -> off the head
    const bm = rasterize({ image: asImageData(img), media: m });
    expect(bm.width).toBe(128);
    expect(bm.bytesPerRow).toBe(16);
    expect(bit(bm, 0, 0)).toBe(1);
    expect(bit(bm, 0, 127)).toBe(1);
    expect(bm.data.slice(0, 16).reduce((a, v) => a + (v.toString(2).split('1').length - 1), 0)).toBe(2);
  });

  test('12 mm tape: centre of the tape lands on head dot 64', () => {
    const m = media('d1-12mm');
    const H = mmToDots(12, 180); // 85
    const img = blank(300, H);
    setPx(img, 0, 42); // centre row of the design
    const bm = rasterize({ image: asImageData(img), media: m });
    const dot = headOffsetDots(m, H) + (H - 1 - 42);
    expect(dot).toBe(64);
    expect(bit(bm, 0, 64)).toBe(1);
  });

  test('tape length follows the image width (or lengthMm)', () => {
    const m = media('d1-9mm');
    const img = blank(321, mmToDots(9, 180));
    expect(rasterize({ image: asImageData(img), media: m }).height).toBe(321);
    expect(rasterize({ image: asImageData(img), media: m }, { lengthMm: 50 }).height).toBe(mmToDots(50, 180));
  });
});
