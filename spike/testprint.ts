// Supervised first test print for both DUO engines.
//
//   bun spike/testprint.ts                          build both jobs, write *.bin, print a summary (no USB)
//   bun spike/testprint.ts --tape-mm 9              same, for another tape width (6, 9, 12, 19, 24)
//   bun spike/testprint.ts --send label --confirm   SEND the label job (consumes one 99010 label)
//   bun spike/testprint.ts --send tape --confirm    SEND the tape job (consumes ~50 mm of tape)
//
// Run from the project root. Sending without --confirm is refused.
//
// Pattern (design orientation, as the label is read):
//   - 3-dot outline of the printable area from media.ts
//   - big filled square at the TOP-LEFT corner of the printable area
//   - small filled square at the BOTTOM-LEFT corner
//   - ticks every 10 mm along the bottom edge
// From the physical result we learn: rotation (where the big square ends up), head offset
// (is the outline complete and centred) and scale (tick spacing).

import { writeFileSync } from 'node:fs';
import { findMedia } from '../src/printer/media';
import { mmToDots, rasterize } from '../src/printer/raster';
import { buildLabelJob, buildTapeJob, planTapeLayout } from '../src/printer/commands';
import type { Media } from '../src/printer/types';

const argv = process.argv.slice(2);
const arg = (k: string) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};
const tapeMm = Number(arg('--tape-mm') ?? 12);

function pattern(media: Media, lengthMm: number) {
  const dpi = media.dpi;
  const W = mmToDots(lengthMm, dpi);
  const H = mmToDots(media.widthMm, dpi);
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  const ink = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const p = (y * W + x) * 4;
    data[p] = data[p + 1] = data[p + 2] = 0;
  };
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) ink(x, y);
  };
  const p = media.printable;
  const px0 = mmToDots(p.xMm, dpi);
  const px1 = media.lengthMm === null ? W - mmToDots(p.xMm, dpi) : mmToDots(p.xMm + p.widthMm, dpi);
  const py0 = mmToDots(p.yMm, dpi);
  const py1 = mmToDots(p.yMm + p.heightMm, dpi);
  const t = 3; // outline thickness in dots
  rect(px0, py0, px1, py0 + t);
  rect(px0, py1 - t, px1, py1);
  rect(px0, py0, px0 + t, py1);
  rect(px1 - t, py0, px1, py1);
  const big = Math.min(mmToDots(6, dpi), Math.floor((py1 - py0) / 2));
  const small = Math.max(4, Math.floor(big / 2));
  rect(px0 + t + 2, py0 + t + 2, px0 + t + 2 + big, py0 + t + 2 + big); // top-left, big
  rect(px0 + t + 2, py1 - t - 2 - small, px0 + t + 2 + small, py1 - t - 2); // bottom-left, small
  for (let mm = 10; mm < lengthMm; mm += 10) {
    const x = mmToDots(mm, dpi);
    if (x > px0 && x < px1) rect(x - 1, py1 - t - mmToDots(1.5, dpi), x + 1, py1 - t);
  }
  return { width: W, height: H, data } as unknown as ImageData;
}

const hex = (u8: Uint8Array) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join(' ');

const labelMedia = findMedia(arg('--label') ?? 'lw-99010')!;
const labelBitmap = rasterize({ image: pattern(labelMedia, labelMedia.lengthMm!), media: labelMedia });
const labelJob = buildLabelJob(labelBitmap, { labelLengthDots: mmToDots(labelMedia.lengthMm!, 300), copies: Number(arg('--copies') ?? 1) });

const tapeMedia = findMedia(`d1-${tapeMm}mm`);
if (!tapeMedia) throw new Error(`no tape media for ${tapeMm} mm`);
const tapeLenMm = 50;
const tapeBitmap = rasterize({ image: pattern(tapeMedia, tapeLenMm), media: tapeMedia }, { lengthMm: tapeLenMm });
const tapeJob = buildTapeJob(tapeBitmap, { tapeType: 0 });

writeFileSync('spike/testprint-label-99010.bin', labelJob);
writeFileSync(`spike/testprint-tape-${tapeMm}mm.bin`, tapeJob);

console.log(`LABEL 99010: ${labelJob.length} bytes, ${labelBitmap.height} rows x ${labelBitmap.width} dots`);
console.log(`  head: ${hex(labelJob.subarray(156, 166))} (after 156 x ESC)`);
console.log(`  tail: ${hex(labelJob.subarray(labelJob.length - 12))}`);
const lay = planTapeLayout(tapeBitmap);
console.log(`TAPE ${tapeMm} mm: ${tapeJob.length} bytes, ${tapeBitmap.height} rows x ${tapeBitmap.width} dots, cut-to-cut ${lay.totalRows} rows`);
console.log(`  head: ${hex(tapeJob.subarray(0, 32))}`);
console.log(`  tail: ${hex(tapeJob.subarray(tapeJob.length - 6))}`);

const send = arg('--send');
if (send) {
  if (!argv.includes('--confirm')) {
    console.error('Refusing to send without --confirm (this consumes media).');
    process.exit(2);
  }
  const { usb } = await import('usb');
  const dev = (await usb.getDevices()).find((d) => d.vendorId === 0x0922);
  if (!dev) throw new Error('DUO not found');
  await dev.open();
  if (!dev.configuration) await dev.selectConfiguration(1);
  const iface = send === 'tape' ? 1 : 0;
  const ep = send === 'tape' ? 2 : 1;
  const job = send === 'tape' ? tapeJob : labelJob;
  await dev.claimInterface(iface);
  try {
    await dev.transferOut(ep, Uint8Array.of(0x1b, 0x41));
    const st = await dev.transferIn(ep, send === 'tape' ? 64 : 16);
    const b = st.data!.getUint8(0);
    console.log(`status before: 0x${b.toString(16)}`);
    if (send === 'label' && (b & 0xe0)) throw new Error('label engine not ready');
    if (send === 'tape' && !(b & 0x40)) throw new Error('no tape cassette');
    for (let o = 0; o < job.length; o += 4096) await dev.transferOut(ep, job.subarray(o, o + 4096));
    console.log(`sent ${job.length} bytes to interface ${iface}`);
  } finally {
    await dev.releaseInterface(iface);
    await dev.close();
  }
}
