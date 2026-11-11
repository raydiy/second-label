import { describe, expect, test } from 'bun:test';
import {
  DEVICES,
  DUO_128,
  DYMO_VENDOR_ID,
  NEUTRAL_CALIBRATION,
  UNSUPPORTED_MESSAGE,
  deviceTargets,
  findDevice,
  printBlockReason,
} from '../devices';
import { MEDIA, findMedia, mediaForDevice } from '../media';
import { buildJob } from '../webusb-driver';
import { mmToDots, rasterize } from '../raster';
import { renderTestPattern, patternLengthMm } from '../testpattern';
import { goldenHashes } from './duo-golden';
import type { Media } from '../types';

const spec = (pid: number) => findDevice(DYMO_VENDOR_ID, pid)!;

describe('device table', () => {
  test('exactly the "table entry only" models, DUO 0x001D the only verified one', () => {
    expect(DEVICES.map((d) => d.productId)).toEqual([0x001d, 0x0023, 0x0017, 0x0020, 0x0021, 0x0019, 0x001a]);
    expect(DEVICES.filter((d) => d.status === 'verified')).toEqual([DUO_128]);
    expect(new Set(DEVICES.map((d) => d.productId)).size).toBe(DEVICES.length);
  });

  test('models needing protocol changes are not in the table', () => {
    // 4XL, 450 Twin Turbo, Twin Turbo, SE450, 330, LabelManager PnP, 550
    for (const pid of [0x001f, 0x0022, 0x0018, 0x0400, 0x0007, 0x1002, 0x0028]) expect(findDevice(DYMO_VENDOR_ID, pid)).toBeNull();
    expect(findDevice(0x1234, 0x001d)).toBeNull();
  });

  test('every label engine is the 672-dot 300 dpi head on interface 0', () => {
    for (const d of DEVICES) expect(d.engines.label).toEqual({ interfaceNumber: 0, dpi: 300, headDots: 672 });
  });

  test('DUO family: tape on interface 1, 180 dpi, vendor leaders; 96-dot variant takes up to 19 mm', () => {
    for (const pid of [0x001d, 0x0023]) {
      expect(spec(pid).engines.tape).toEqual({
        interfaceNumber: 1, dpi: 180, headDots: 128, maxTapeMm: 24, headToCutterDots: 61, normalLeaderDots: 75, minPageDots: 133,
      });
    }
    expect(spec(0x0017).engines.tape).toEqual({
      interfaceNumber: 1, dpi: 180, headDots: 96, maxTapeMm: 19, headToCutterDots: 61, normalLeaderDots: 75, minPageDots: 133,
    });
  });

  test('label-only models have no tape engine', () => {
    for (const pid of [0x0020, 0x0021, 0x0019, 0x001a]) {
      expect(spec(pid).engines.tape).toBeUndefined();
      expect(deviceTargets(spec(pid))).toEqual(['label']);
    }
    expect(deviceTargets(DUO_128)).toEqual(['label', 'tape']);
  });

  test('experimental models start from the neutral calibration', () => {
    for (const d of DEVICES.filter((x) => x.status === 'experimental')) expect(d.calibration).toBe(NEUTRAL_CALIBRATION);
    expect(NEUTRAL_CALIBRATION.label).toEqual({ headOffsetDots: 0, feedStartDots: 0, feedScale: 1 });
    expect(Object.values(NEUTRAL_CALIBRATION.tape.centerCorrectionDots).every((v) => v === 0)).toBe(true);
  });
});

describe('printBlockReason', () => {
  test('unknown model: German message pointing to the diagnostics', () => {
    expect(printBlockReason(null, 'label')).toBe(UNSUPPORTED_MESSAGE);
    expect(UNSUPPORTED_MESSAGE).toContain('Druckerprofil / Diagnose');
  });
  test('tape on a label-only model is refused, labels are fine', () => {
    expect(printBlockReason(spec(0x0020), 'tape')).toContain('kein Banddruckwerk');
    expect(printBlockReason(spec(0x0020), 'label')).toBeNull();
    expect(printBlockReason(DUO_128, 'tape')).toBeNull();
  });
});

describe('mediaForDevice', () => {
  const strip = (l: Media[]) => JSON.parse(JSON.stringify(l));

  test('DUO 0x001D and 450 Duo get the full catalogue unchanged', () => {
    expect(strip(mediaForDevice(DUO_128))).toEqual(strip(MEDIA));
    expect(strip(mediaForDevice(spec(0x0023)))).toEqual(strip(MEDIA));
  });

  test('label-only models get labels only', () => {
    const list = mediaForDevice(spec(0x0020));
    expect(list.length).toBe(MEDIA.filter((m) => m.target === 'label').length);
    expect(list.every((m) => m.target === 'label')).toBe(true);
  });

  test('96-dot DUO: tapes up to 19 mm, bands clipped to the 13.55 mm head', () => {
    const tapes = mediaForDevice(spec(0x0017)).filter((m) => m.target === 'tape');
    expect(tapes.map((m) => m.id)).toEqual(['d1-6mm', 'd1-9mm', 'd1-12mm', 'd1-19mm']);
    const head = (96 / 180) * 25.4;
    for (const t of tapes) expect(t.printable.heightMm).toBeLessThanOrEqual(Math.round(head * 100) / 100);
    // Narrow tapes keep the DUO band, 19 mm is limited by the head.
    for (const id of ['d1-6mm', 'd1-9mm', 'd1-12mm']) expect(tapes.find((m) => m.id === id)!.printable).toEqual(findMedia(id)!.printable);
    expect(tapes.find((m) => m.id === 'd1-19mm')!.printable.heightMm).toBe(13.55);
  });
});

describe('jobs for other models', () => {
  const sha = (o: Record<string, string>) => Object.values(o).join();

  test('450: label jobs use the neutral calibration, so the bytes differ from the DUO', () => {
    const m = findMedia('lw-99012')!;
    const img = renderTestPattern(m) as unknown as ImageData;
    const duo = buildJob({ image: img, media: m });
    const l450 = buildJob({ image: img, media: m }, {}, { device: spec(0x0020) });
    expect(l450).not.toEqual(duo);
    // With the DUO calibration passed explicitly, the 450 job equals the DUO job (same engine).
    expect(buildJob({ image: img, media: m }, {}, { device: spec(0x0020), calibration: DUO_128.calibration })).toEqual(duo);
    expect(sha(goldenHashes(spec(0x0023)))).not.toEqual(sha(goldenHashes(DUO_128)));
  });

  test('450: a tape job is refused', () => {
    const m = findMedia('d1-12mm')!;
    expect(() => buildJob({ image: renderTestPattern(m) as unknown as ImageData, media: m }, { lengthMm: 60 }, { device: spec(0x0020) }))
      .toThrow('kein Banddruckwerk');
  });

  test('96-dot DUO tape job: 12 clean bytes, no line wider than 12 bytes, ends with a cut', () => {
    const m = mediaForDevice(spec(0x0017)).find((x) => x.id === 'd1-19mm')!;
    const img = renderTestPattern(m) as unknown as ImageData;
    const job = buildJob({ image: img, media: m }, { lengthMm: patternLengthMm(m) }, { device: spec(0x0017) });
    expect(Array.from(job.subarray(0, 12))).toEqual(new Array(12).fill(0));
    expect(Array.from(job.subarray(12, 15))).toEqual([0x1b, 0x43, 0]); // ESC C 0 right after the clean bytes
    expect(Array.from(job.subarray(-2))).toEqual([0x1b, 0x45]);
    // The raster is 96 dots wide, centred: a 19 mm design (135 dots) loses the same margin on both sides.
    const bm = rasterize({ image: img, media: m }, { lengthMm: patternLengthMm(m), headDots: 96 });
    expect(bm.width).toBe(96);
    expect(bm.bytesPerRow).toBe(12);
    expect(mmToDots(m.widthMm, m.dpi)).toBe(img.height);
  });
});
