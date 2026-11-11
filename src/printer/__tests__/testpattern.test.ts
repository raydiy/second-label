import { describe, expect, test } from 'bun:test';
import { FRAME_THICKNESS_DOTS, TAPE_PATTERN_LENGTH_MM, renderTestPattern, testPatternGeometry } from '../testpattern';
import { MEDIA, findMedia } from '../media';
import { mmToDots, rasterize } from '../raster';

const isInk = (img: { width: number; data: Uint8ClampedArray }, x: number, y: number) => img.data[(y * img.width + x) * 4] === 0;

describe('test pattern', () => {
  test('99012: label size, frame on media.printable, numbered ticks from the label edge', () => {
    const m = findMedia('lw-99012')!;
    const g = testPatternGeometry(m);
    const img = renderTestPattern(m);
    expect([img.width, img.height]).toEqual([mmToDots(89, 300), mmToDots(36, 300)]);
    expect(g.frame.x0).toBe(mmToDots(m.printable.xMm, 300));
    expect(g.frame.y1).toBe(mmToDots(m.printable.yMm + m.printable.heightMm, 300));
    // frame corners are inked, just outside is paper
    expect(isInk(img, g.frame.x0, g.frame.y0)).toBe(true);
    expect(isInk(img, g.frame.x1 - 1, g.frame.y1 - 1)).toBe(true);
    expect(isInk(img, g.frame.x0 - 1, g.frame.y1 - 1)).toBe(false);
    expect(isInk(img, g.frame.x0, g.frame.y1)).toBe(false);
    // ticks every 10 mm measured from the left label edge, 50 is a major tick
    expect(g.ticks.map((t) => t.mm)).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
    expect(g.ticks.find((t) => t.mm === 50)!.major).toBe(true);
    const t80 = g.ticks.find((t) => t.mm === 80)!;
    expect(t80.x).toBe(mmToDots(80, 300));
    expect(t80.numbered).toBe(true);
    expect(g.digitScale).toBeGreaterThan(0);
    expect(isInk(img, t80.x, g.frame.y1 - FRAME_THICKNESS_DOTS - 1)).toBe(true);
  });

  test('every medium renders with a closed frame and at least some numbered ticks', () => {
    for (const m of MEDIA) {
      const g = testPatternGeometry(m);
      const img = renderTestPattern(m);
      expect(img.data.length).toBe(img.width * img.height * 4);
      expect(g.frame.x1).toBeGreaterThan(g.frame.x0);
      expect(g.frame.y1).toBeGreaterThan(g.frame.y0);
      expect(g.ticks.some((t) => t.numbered)).toBe(true);
      // nothing is drawn outside the frame
      for (let y = 0; y < img.height; y += 3) {
        for (const x of [0, g.frame.x0 - 1, g.frame.x1, img.width - 1]) if (x >= 0 && x < img.width && (x < g.frame.x0 || x >= g.frame.x1)) expect(isInk(img, x, y)).toBe(false);
      }
    }
  });

  test('tape pattern has the fixed tape length and rasterizes on the tape head', () => {
    const m = findMedia('d1-24mm')!;
    const img = renderTestPattern(m);
    expect(img.width).toBe(mmToDots(TAPE_PATTERN_LENGTH_MM, 180));
    const bm = rasterize({ image: img as unknown as ImageData, media: m }, { lengthMm: TAPE_PATTERN_LENGTH_MM });
    expect(bm.width).toBe(128);
    expect(bm.data.some((b) => b !== 0)).toBe(true);
  });

  test('deterministic', () => {
    const m = findMedia('lw-99010')!;
    expect(Buffer.from(renderTestPattern(m).data).equals(Buffer.from(renderTestPattern(m).data))).toBe(true);
  });
});
