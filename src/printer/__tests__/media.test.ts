import { describe, expect, test } from 'bun:test';
import { LABEL_HEAD_MM, MEDIA, TAPE_HEAD_MM, TAPE_MARGIN_MM, findMedia } from '../media';

describe('MEDIA', () => {
  test('ids are unique', () => {
    expect(new Set(MEDIA.map((m) => m.id)).size).toBe(MEDIA.length);
  });

  test('engine resolution per target', () => {
    for (const m of MEDIA) expect(m.dpi).toBe(m.target === 'label' ? 300 : 180);
  });

  test('printable area lies inside the medium and within the head', () => {
    for (const m of MEDIA) {
      const p = m.printable;
      expect(p.xMm).toBeGreaterThanOrEqual(0);
      expect(p.yMm).toBeGreaterThanOrEqual(0);
      expect(p.heightMm).toBeGreaterThan(0);
      expect(p.yMm + p.heightMm).toBeLessThanOrEqual(m.widthMm + 1e-9);
      const head = m.target === 'label' ? LABEL_HEAD_MM : TAPE_HEAD_MM;
      expect(p.heightMm).toBeLessThanOrEqual(head + 0.01);
      if (m.lengthMm === null) {
        expect(p.widthMm).toBe(0);
      } else {
        expect(p.widthMm).toBeGreaterThan(0);
        expect(p.xMm + p.widthMm).toBeLessThanOrEqual(m.lengthMm + 1e-9);
      }
    }
  });

  test('tape widths of the DUO Tape 128 engine', () => {
    const tapes = MEDIA.filter((m) => m.target === 'tape').map((m) => m.widthMm);
    expect(tapes).toEqual([6, 9, 12, 19, 24]);
    for (const m of MEDIA.filter((x) => x.target === 'tape')) {
      expect(m.lengthMm).toBeNull();
      expect(m.printable.xMm).toBe(TAPE_MARGIN_MM);
    }
    // 24 mm uses the full 128-dot head, 12 mm a 64-dot band (PPD lwduot2.ppd)
    expect(findMedia('d1-24mm')!.printable.heightMm).toBeCloseTo(18.06, 2);
    expect(findMedia('d1-12mm')!.printable.heightMm).toBeCloseTo(9.03, 2);
  });

  test('99010 address label values derived from the PPD', () => {
    const m = findMedia('lw-99010')!;
    expect(m.widthMm).toBe(28);
    expect(m.lengthMm).toBe(89);
    expect(m.printable).toEqual({ xMm: 5.84, yMm: 1.16, widthMm: 81.63, heightMm: 25.32 });
  });
});
