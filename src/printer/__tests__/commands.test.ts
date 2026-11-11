import { describe, expect, test } from 'bun:test';
import {
  ESC,
  SYN,
  TAPE_HEAD_TO_CUTTER_DOTS,
  TAPE_MIN_LABEL_DOTS,
  buildLabelJob,
  buildTapeJob,
  cmdLabelDensity,
  cmdLabelLength,
  cmdLabelSkipLines,
  cmdStatus,
  cmdTapeSkipLines,
  cmdTapeType,
  decodeLabelStatus,
  decodeTapeStatus,
  inkSpan,
  planTapeLayout,
} from '../commands';
import type { MonoBitmap } from '../types';

const hex = (u8: Uint8Array) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join(' ');

function bitmap(widthDots: number, rows: number, ink: Record<number, Record<number, number>> = {}): MonoBitmap {
  const bytesPerRow = widthDots / 8;
  const data = new Uint8Array(bytesPerRow * rows);
  for (const [r, cols] of Object.entries(ink)) for (const [c, v] of Object.entries(cols)) data[+r * bytesPerRow + +c] = v;
  return { width: widthDots, height: rows, bytesPerRow, data };
}

/** Index of the first occurrence of `needle` in `hay` at or after `from`. */
function indexOf(hay: Uint8Array, needle: number[], from = 0): number {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

describe('single commands', () => {
  test('status, density, tape type', () => {
    expect(hex(cmdStatus())).toBe('1b 41');
    expect(hex(cmdLabelDensity('light'))).toBe('1b 63');
    expect(hex(cmdLabelDensity())).toBe('1b 65');
    expect(hex(cmdLabelDensity('dark'))).toBe('1b 67');
    expect(hex(cmdTapeType(10))).toBe('1b 43 0a');
    expect(() => cmdTapeType(13)).toThrow();
  });

  test('label length is big endian, null means continuous', () => {
    expect(hex(cmdLabelLength(1051))).toBe('1b 4c 04 1b');
    expect(hex(cmdLabelLength(null))).toBe('1b 4c ff ff');
    expect(() => cmdLabelLength(0x8000)).toThrow();
  });

  test('skip lines', () => {
    expect(hex(cmdLabelSkipLines(255))).toBe('1b 66 01 ff');
    expect(() => cmdLabelSkipLines(256)).toThrow();
    expect(hex(cmdTapeSkipLines(3))).toBe('1b 44 00 16 16 16');
  });
});

describe('status decoding', () => {
  test('label 0x03 (measured idle value) is ready + top of form', () => {
    expect(decodeLabelStatus(0x03)).toEqual({ ready: true, topOfForm: true, paperOut: false, paperJam: false, error: false });
    expect(decodeLabelStatus(0xa1).paperOut).toBe(true);
  });

  test('tape 0xC0 (measured idle value) is cassette present, no errors', () => {
    expect(decodeTapeStatus(0xc0)).toEqual({
      cassettePresent: true,
      generalError: false,
      cutterJam: false,
      headOverheat: false,
      busy: false,
    });
    expect(decodeTapeStatus(0x80).cassettePresent).toBe(false);
    expect(decodeTapeStatus(0x54).generalError).toBe(true);
  });
});

describe('inkSpan', () => {
  test('finds first and last non-zero byte', () => {
    const b = bitmap(32, 2, { 1: { 1: 0x01, 2: 0x80 } });
    expect(inkSpan(b, 0)).toBeNull();
    expect(inkSpan(b, 1)).toEqual([1, 2]);
  });
});

describe('buildLabelJob', () => {
  test('header, rows, skip and form feed for a single copy', () => {
    // 672 dots wide, 5 rows: row 0 blank, rows 1-2 ink at bytes 3..4, rows 3-4 blank.
    const b = bitmap(672, 5, { 1: { 3: 0xff, 4: 0x0f }, 2: { 3: 0xaa, 4: 0x01 } });
    const job = buildLabelJob(b, { labelLengthDots: 1051 });
    // 156 x ESC resync
    expect(job.subarray(0, 156).every((v) => v === ESC)).toBe(true);
    const body = job.subarray(156);
    expect(hex(body)).toBe(
      [
        '1b 68', // ESC h text mode
        '1b 65', // ESC e normal density
        '1b 4c 04 1b', // ESC L 1051
        '1b 66 01 01', // skip 1 blank row
        '1b 42 03', '1b 44 02', '16 ff 0f', // row 1
        '1b 42 03', '16 aa 01', // row 2: ESC B again, ESC D unchanged
        '1b 45', // trailing blanks not sent, form feed
      ].join(' '),
    );
  });

  test('copies use ESC G between labels and ESC E after the last', () => {
    const b = bitmap(672, 1, { 0: { 0: 0x80 } });
    const job = buildLabelJob(b, { labelLengthDots: 100, copies: 3 }).subarray(156);
    const s = hex(job);
    expect(s.match(/1b 4c 00 64/g)?.length).toBe(3);
    expect(s.match(/1b 47/g)?.length).toBe(2);
    expect(s.endsWith('16 80 1b 45')).toBe(true);
  });

  test('long blank runs split into ESC f 1 255 chunks (599 = 255 + 255 + 89)', () => {
    const b = bitmap(672, 600, { 599: { 0: 0x80 } });
    const s = hex(buildLabelJob(b, { labelLengthDots: 600 }).subarray(156));
    expect(s).toContain('1b 66 01 ff 1b 66 01 ff 1b 66 01 59');
  });

  test('continuous paper sends ESC L ff ff', () => {
    const b = bitmap(672, 1, { 0: { 0: 1 } });
    expect(hex(buildLabelJob(b, { labelLengthDots: null }))).toContain('1b 4c ff ff');
  });

  test('rejects a bitmap wider than the head', () => {
    expect(() => buildLabelJob(bitmap(680, 1), { labelLengthDots: 10 })).toThrow();
  });
});

describe('tape layout and job', () => {
  test('ink inside the head-to-cutter zone is pushed back, short labels are padded', () => {
    const b = bitmap(128, 100, { 10: { 5: 0xff } });
    const l = planTapeLayout(b);
    expect(l.prependRows).toBe(TAPE_HEAD_TO_CUTTER_DOTS - 10);
    expect(l.totalRows).toBe(TAPE_MIN_LABEL_DOTS);
    expect(l.prependRows + 100 + l.appendRows).toBe(l.totalRows);
  });

  test('long label with margins keeps its exact length', () => {
    const b = bitmap(128, 500, { 100: { 0: 1 } });
    expect(planTapeLayout(b)).toEqual({ prependRows: 0, appendRows: 0, totalRows: 500 });
  });

  test('job bytes: clean, tape type, first row at line 61, feed to cutter, cut', () => {
    // Row 100 inked at bytes 4..11 (12 mm style band on the 128-dot head), 400 rows total.
    const ink: Record<number, number> = {};
    for (let i = 4; i <= 11; i++) ink[i] = 0xff;
    const b = bitmap(128, 400, { 100: ink });
    const job = buildTapeJob(b, { tapeType: 0 });
    expect(hex(job.subarray(0, 16))).toBe(new Array(16).fill('00').join(' '));
    expect(hex(job.subarray(16, 19))).toBe('1b 43 00');
    // Rows 61..99 blank: ESC D 0 + 39 SYN
    const blank = job.subarray(19, 19 + 3 + 39);
    expect(hex(blank.subarray(0, 3))).toBe('1b 44 00');
    expect(blank.subarray(3).every((v) => v === SYN)).toBe(true);
    const rowAt = 19 + 3 + 39;
    expect(hex(job.subarray(rowAt, rowAt + 7))).toBe('1b 42 04 1b 44 08 16');
    expect(job.subarray(rowAt + 7, rowAt + 15).every((v) => v === 0xff)).toBe(true);
    // Rows 101..399 blank (299) + 61 to the cutter = 360 SYN, then cut.
    const tail = job.subarray(rowAt + 15);
    expect(hex(tail.subarray(0, 3))).toBe('1b 44 00');
    expect(tail.length).toBe(3 + 360 + 2);
    expect(hex(tail.subarray(tail.length - 2))).toBe('1b 45');
  });

  test('copies repeat the body and cut each label, tape type sent once', () => {
    const b = bitmap(128, 300, { 150: { 0: 0x80 } });
    const job = buildTapeJob(b, { copies: 2 });
    expect(indexOf(job, [ESC, 0x43])).toBe(16);
    expect(indexOf(job, [ESC, 0x43], 17)).toBe(-1);
    let cuts = 0;
    for (let i = 0; i < job.length - 1; i++) if (job[i] === ESC && job[i + 1] === 0x45) cuts++;
    expect(cuts).toBe(2);
  });

  test('rejects a bitmap wider than the 128-dot head', () => {
    expect(() => buildTapeJob(bitmap(136, 10))).toThrow();
  });
});
