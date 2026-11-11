// Golden-job generator for the DUO 0x001D byte-identity test (duo-identity.test.ts).
// Builds a fixed set of label and tape jobs and returns a SHA-256 per case. The expected hashes
// in the test were produced with this exact case list by the code before the device table (v0.3.0).
import { createHash } from 'node:crypto';
import { buildJob } from '../webusb-driver';
import { MEDIA, findMedia } from '../media';
import { renderTestPattern, patternLengthMm } from '../testpattern';
import { DEFAULT_CALIBRATION } from '../raster';
import type { Calibration, Media, PrintOptions } from '../types';
import type { DeviceSpec } from '../devices';

/** Deterministic grey noise plus a few hard shapes, design orientation. */
export function noiseImage(w: number, h: number, seed: number): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  let s = seed >>> 0;
  for (let i = 0; i < w * h; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const v = (s >>> 24) & 0xff;
    const x = i % w;
    const y = Math.floor(i / w);
    const shape = (x > w * 0.1 && x < w * 0.2) || (y > h * 0.4 && y < h * 0.45) ? 0 : v;
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = shape;
    data[i * 4 + 3] = (s & 0xff) < 16 ? 0 : 255; // some transparent pixels
  }
  return { width: w, height: h, data } as unknown as ImageData;
}

const custom: Calibration = {
  label: { headOffsetDots: -7, feedStartDots: 40.5, feedScale: 0.993 },
  tape: { centerCorrectionDots: { 6: 1, 9: -2, 12: 3, 19: -4, 24: 2 } },
};

const dots = (mm: number, dpi: number) => Math.round((mm / 25.4) * dpi);

export interface GoldenCase {
  name: string;
  bytes: () => Uint8Array;
}

/** With `device`, every job is built with extra.device set to it (the default is the DUO). */
export function goldenCases(device?: DeviceSpec): GoldenCase[] {
  const cases: GoldenCase[] = [];
  const dev = device ? { device } : {};
  for (const m of MEDIA) {
    const len = m.lengthMm === null ? patternLengthMm(m) : undefined;
    const opts: PrintOptions = { copies: 1, lengthMm: len };
    cases.push({
      name: `pattern ${m.id}`,
      bytes: () => buildJob({ image: renderTestPattern(m) as unknown as ImageData, media: m }, opts, dev),
    });
  }
  const add = (name: string, m: Media, lengthMm: number, opts: PrintOptions, extra: Parameters<typeof buildJob>[2]) =>
    cases.push({
      name,
      bytes: () => buildJob({ image: noiseImage(dots(lengthMm, m.dpi), dots(m.widthMm, m.dpi), name.length * 7919), media: m }, opts, { ...extra, ...dev }),
    });
  const l = findMedia('lw-99012')!;
  const c = findMedia('lw-continuous-57')!;
  const wide = findMedia('lw-99019')!;
  add('noise 99012 default', l, 89, {}, {});
  add('noise 99012 fs dark 3 copies', l, 89, { copies: 3, density: 'dark' }, { dither: 'floyd-steinberg' });
  add('noise 99012 custom calibration light', l, 89, { density: 'light' }, { calibration: custom });
  add('noise 99019 wider than head', wide, 190, {}, { calibration: DEFAULT_CALIBRATION });
  add('noise continuous 120 mm', c, 120, { lengthMm: 120, copies: 2 }, {});
  for (const w of [6, 9, 12, 19, 24]) {
    const t = findMedia(`d1-${w}mm`)!;
    add(`noise tape ${w} default`, t, 50, { lengthMm: 50 }, {});
    add(`noise tape ${w} custom type 5 copies 2`, t, 25, { lengthMm: 25, copies: 2 }, { calibration: custom, tapeType: 5 });
  }
  return cases;
}

export function goldenHashes(device?: DeviceSpec): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of goldenCases(device)) out[c.name] = createHash('sha256').update(c.bytes()).digest('hex');
  return out;
}

if (import.meta.main) console.log(JSON.stringify(goldenHashes(), null, 2));
