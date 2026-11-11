// Byte-level command builders for both engines of the DYMO LabelWriter DUO.
// Pure functions only (no I/O) so they can be unit tested with `bun test`.
// Protocol reference and sources: docs/protocol.md.

import type { MonoBitmap } from './types';

export const ESC = 0x1b;
export const SYN = 0x16;

// ---------------------------------------------------------------------------
// Engine geometry
// ---------------------------------------------------------------------------

/** Label engine (interface 0): 672-dot, 300 dpi head (LW 450 Series Tech Ref p. 7). */
export const LABEL_HEAD_DOTS = 672;
export const LABEL_DPI = 300;
export const LABEL_MAX_BYTES_PER_LINE = LABEL_HEAD_DOTS / 8; // 84

/**
 * Tape engine (interface 1): 128-dot, 180 dpi head. The device reports
 * "LabelWriter DUO Tape 128" in its IEEE 1284 Device ID (measured, see docs).
 */
export const TAPE_HEAD_DOTS = 128;
export const TAPE_DPI = 180;
export const TAPE_MAX_BYTES_PER_LINE = TAPE_HEAD_DOTS / 8; // 16

/**
 * Distance from the tape print head to the cutter, in dot lines.
 * dymo-cups-drivers CupsFilterLabelManager.cpp, "DYMO LabelWriter DUO Tape 128": SetMinLeader(61).
 * After a cut the tape end sits at the cutter, so the first 61 lines of the next
 * label are already past the head and cannot be printed.
 */
export const TAPE_HEAD_TO_CUTTER_DOTS = 61;
/** Default blank leader/trailer per label, dymo-cups-drivers SetNormalLeader(75). */
export const TAPE_NORMAL_LEADER_DOTS = 75;
/** Minimum printed body, dymo-cups-drivers SetMinPageLines(133). */
export const TAPE_MIN_PAGE_DOTS = 133;
/** Minimum total label length the vendor driver ever produces: leader + min body + trailer. */
export const TAPE_MIN_LABEL_DOTS = TAPE_NORMAL_LEADER_DOTS + TAPE_MIN_PAGE_DOTS + TAPE_NORMAL_LEADER_DOTS; // 283

// ---------------------------------------------------------------------------
// Shared single commands
// ---------------------------------------------------------------------------

/** ESC A: status request. Label engine replies 1 byte, tape engine replies 1 byte (measured). */
export const cmdStatus = (): Uint8Array => Uint8Array.of(ESC, 0x41);
/** ESC B n: dot tab, skip n bytes (8n dots) from the left edge of the head. */
export const cmdDotTab = (n: number): Uint8Array => Uint8Array.of(ESC, 0x42, byte(n, 'dot tab'));
/** ESC D n: bytes per line that follow each SYN. */
export const cmdBytesPerLine = (n: number): Uint8Array => Uint8Array.of(ESC, 0x44, byte(n, 'bytes per line'));

// ---------------------------------------------------------------------------
// Label engine (LabelWriter 400/450 command set)
// ---------------------------------------------------------------------------

/**
 * Parser resync: a run of ESC bytes longer than any raster line (manual p. 9 asks for >= 85).
 * dymo-cups-drivers uses 156; an even count keeps ESC ESC pairs aligned so the next
 * real command is parsed from its own ESC.
 */
export const cmdLabelResync = (): Uint8Array => new Uint8Array(156).fill(ESC);
/** ESC @: reset all parameters to defaults, sets top-of-form true. No paper motion. */
export const cmdLabelReset = (): Uint8Array => Uint8Array.of(ESC, 0x40);
/** ESC V: model + firmware string (this unit answers "93105v0N"). */
export const cmdLabelVersion = (): Uint8Array => Uint8Array.of(ESC, 0x56);
/** ESC L n1 n2: label length in dot lines, big endian. 0xFFFF (any negative) = continuous. */
export function cmdLabelLength(dots: number | null): Uint8Array {
  const v = dots === null ? 0xffff : dots;
  if (!Number.isInteger(v) || v < 1 || v > 0xffff) throw new RangeError(`label length ${dots} out of range`);
  if (dots !== null && v >= 0x8000) throw new RangeError(`label length ${dots} would select continuous mode`);
  return Uint8Array.of(ESC, 0x4c, (v >> 8) & 0xff, v & 0xff);
}
/** ESC E: form feed, moves the printed label to the tear bar. */
export const cmdLabelFormFeed = (): Uint8Array => Uint8Array.of(ESC, 0x45);
/** ESC G: short form feed, between labels of a multi-label job. */
export const cmdLabelShortFormFeed = (): Uint8Array => Uint8Array.of(ESC, 0x47);
/** ESC f 1 n: skip n blank lines (1..255). */
export function cmdLabelSkipLines(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 1 || n > 255) throw new RangeError(`skip ${n} out of range 1..255`);
  return Uint8Array.of(ESC, 0x66, 0x01, n);
}
/** ESC h: text mode 300x300 dpi (default). ESC i would be 300x600 graphics mode. */
export const cmdLabelTextMode = (): Uint8Array => Uint8Array.of(ESC, 0x68);

export type Density = 'light' | 'normal' | 'dark';
/** ESC c / ESC e / ESC g: strobe time 75 % / 100 % / 112.5 %. (ESC d = 87.5 % is not exposed.) */
export function cmdLabelDensity(d: Density = 'normal'): Uint8Array {
  const code = d === 'light' ? 0x63 : d === 'dark' ? 0x67 : 0x65;
  return Uint8Array.of(ESC, code);
}

// ---------------------------------------------------------------------------
// Tape engine (D1 / LabelManager command subset, Tech Ref Appendix B)
// ---------------------------------------------------------------------------

/** ESC C n: tape type (heat profile), 0..12. 0 = black on white or clear. */
export function cmdTapeType(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 12) throw new RangeError(`tape type ${n} out of range 0..12`);
  return Uint8Array.of(ESC, 0x43, n);
}
/** ESC E: cut the tape. Must be sent at the end of every tape label. */
export const cmdTapeCut = (): Uint8Array => Uint8Array.of(ESC, 0x45);
/** Blank feed on the tape engine: ESC D 0, then one bare SYN per line. */
export function cmdTapeSkipLines(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`skip ${n} must be >= 1`);
  const out = new Uint8Array(3 + n);
  out.set(cmdBytesPerLine(0), 0);
  out.fill(SYN, 3);
  return out;
}

// ---------------------------------------------------------------------------
// Status decoding
// ---------------------------------------------------------------------------

export interface LabelStatusBits {
  ready: boolean;
  topOfForm: boolean;
  paperOut: boolean;
  paperJam: boolean;
  error: boolean;
}

/** LW 450 Series Tech Ref p. 17. A healthy idle printer returns 0x03. */
export function decodeLabelStatus(b: number): LabelStatusBits {
  return {
    ready: (b & 0x01) !== 0,
    topOfForm: (b & 0x02) !== 0,
    paperOut: (b & 0x20) !== 0,
    paperJam: (b & 0x40) !== 0,
    error: (b & 0x80) !== 0,
  };
}

export interface TapeStatusBits {
  cassettePresent: boolean;
  generalError: boolean;
  /** Bit 4: "CJ cutter jammed" in the Tech Ref, "SLOT_STATUS" in dymo-cups-drivers. */
  cutterJam: boolean;
  /** Bit 3: HEAD_OVERHEAT in dymo-cups-drivers; "ignore" in the Tech Ref. */
  headOverheat: boolean;
  /** Bit 5: BUSY in dymo-cups-drivers; "ignore" in the Tech Ref. */
  busy: boolean;
}

/**
 * Tech Ref Appendix B plus bit names from dymo-cups-drivers LabelManagerLanguageMonitor.h.
 * This unit returns 0xC0 when idle (cassette present, bit 7 set; bit 7 is "ignore").
 */
export function decodeTapeStatus(b: number): TapeStatusBits {
  return {
    cassettePresent: (b & 0x40) !== 0,
    generalError: (b & 0x04) !== 0,
    cutterJam: (b & 0x10) !== 0,
    headOverheat: (b & 0x08) !== 0,
    busy: (b & 0x20) !== 0,
  };
}

// ---------------------------------------------------------------------------
// Job builders
// ---------------------------------------------------------------------------

export interface LabelJobOptions {
  /** Die-cut label length in dots (ESC L). null = continuous paper. */
  labelLengthDots: number | null;
  copies?: number;
  density?: Density;
}

/**
 * Full label-engine job. Command order per the vendor technical reference; the resulting
 * byte stream was cross-checked against the documented behaviour of dymo-cups-drivers
 * (GPL-2.0, used as a protocol reference only, no code included):
 *   resync, ESC h, ESC <density>, then per copy: ESC L, rows, feed.
 * Rows: blank lines become ESC f 1 n, inked lines become ESC B tab, ESC D n (when it
 * changes), SYN + n bytes with leading and trailing zero bytes trimmed.
 * Between copies ESC G, after the last copy ESC E (manual p. 16 recommendation).
 * Trailing blank lines are not sent; the form feed moves to the next top of form.
 */
export function buildLabelJob(bitmap: MonoBitmap, opts: LabelJobOptions): Uint8Array {
  assertBitmap(bitmap, LABEL_MAX_BYTES_PER_LINE);
  const copies = clampCopies(opts.copies);
  const w = new ByteWriter();
  w.put(cmdLabelResync());
  w.put(cmdLabelTextMode());
  w.put(cmdLabelDensity(opts.density));
  for (let c = 0; c < copies; c++) {
    w.put(cmdLabelLength(opts.labelLengthDots));
    let pendingBlank = 0;
    let lastBpl = -1;
    for (let r = 0; r < bitmap.height; r++) {
      const span = inkSpan(bitmap, r);
      if (!span) {
        pendingBlank++;
        continue;
      }
      while (pendingBlank > 0) {
        const n = Math.min(255, pendingBlank);
        w.put(cmdLabelSkipLines(n));
        pendingBlank -= n;
      }
      const [first, last] = span;
      const bpl = last - first + 1;
      // dymo-cups-drivers sends ESC B on every line (bug fix DLS80AM-1421); we do the same.
      w.put(cmdDotTab(first));
      if (bpl !== lastBpl) {
        w.put(cmdBytesPerLine(bpl));
        lastBpl = bpl;
      }
      w.byte(SYN);
      w.put(rowBytes(bitmap, r).subarray(first, last + 1));
    }
    w.put(c === copies - 1 ? cmdLabelFormFeed() : cmdLabelShortFormFeed());
  }
  return w.toUint8Array();
}

export interface TapeJobOptions {
  copies?: number;
  /** ESC C tape type 0..12, default 0 (black on white/clear). */
  tapeType?: number;
}

/**
 * Plan for one tape label: how the bitmap rows map onto the physical label.
 * Exposed for tests and for the editor (it may want to show the real label length).
 */
export interface TapeLayout {
  /** Blank rows prepended so that no ink falls into the unprintable head-to-cutter zone. */
  prependRows: number;
  /** Blank rows appended to reach the vendor minimum label length. */
  appendRows: number;
  /** Total label length in dot lines, cut to cut. */
  totalRows: number;
}

export function planTapeLayout(bitmap: MonoBitmap): TapeLayout {
  let firstInk = -1;
  for (let r = 0; r < bitmap.height && firstInk < 0; r++) if (inkSpan(bitmap, r)) firstInk = r;
  const prependRows = firstInk >= 0 && firstInk < TAPE_HEAD_TO_CUTTER_DOTS ? TAPE_HEAD_TO_CUTTER_DOTS - firstInk : 0;
  const body = prependRows + bitmap.height;
  const totalRows = Math.max(body, TAPE_MIN_LABEL_DOTS);
  return { prependRows, appendRows: totalRows - body, totalRows };
}

/**
 * Full tape-engine job for the "DUO Tape 128" engine. Feed distances and command order were
 * cross-checked against dymo-cups-drivers (GPL-2.0, protocol reference only, no code included):
 *   16 zero bytes ("clean", ignored by the parser), ESC C type, then per copy:
 *   rows from line 61 onwards (lines 0..60 are already between head and cutter),
 *   61 blank lines to bring the end of the label to the cutter, ESC E cut.
 * The label length cut-to-cut therefore equals TapeLayout.totalRows.
 * Rows: blank lines become ESC D 0 + SYN per line, inked lines ESC B / ESC D (when they
 * change) + SYN + trimmed bytes. Only SYN is used; the tape engine does not support ETB.
 */
export function buildTapeJob(bitmap: MonoBitmap, opts: TapeJobOptions = {}): Uint8Array {
  assertBitmap(bitmap, TAPE_MAX_BYTES_PER_LINE);
  const copies = clampCopies(opts.copies);
  const layout = planTapeLayout(bitmap);
  const w = new ByteWriter();
  w.put(new Uint8Array(TAPE_MAX_BYTES_PER_LINE));
  w.put(cmdTapeType(opts.tapeType ?? 0));
  for (let c = 0; c < copies; c++) {
    let pendingBlank = 0;
    let lastTab = -1;
    let lastBpl = -1;
    for (let lr = TAPE_HEAD_TO_CUTTER_DOTS; lr < layout.totalRows; lr++) {
      const r = lr - layout.prependRows;
      const span = r >= 0 && r < bitmap.height ? inkSpan(bitmap, r) : null;
      if (!span) {
        pendingBlank++;
        continue;
      }
      if (pendingBlank > 0) {
        w.put(cmdTapeSkipLines(pendingBlank));
        pendingBlank = 0;
        lastBpl = -1; // ESC D 0 changed it
      }
      const [first, last] = span;
      const bpl = last - first + 1;
      if (first !== lastTab) {
        w.put(cmdDotTab(first));
        lastTab = first;
      }
      if (bpl !== lastBpl) {
        w.put(cmdBytesPerLine(bpl));
        lastBpl = bpl;
      }
      w.byte(SYN);
      w.put(rowBytes(bitmap, r).subarray(first, last + 1));
    }
    w.put(cmdTapeSkipLines(pendingBlank + TAPE_HEAD_TO_CUTTER_DOTS));
    w.put(cmdTapeCut());
  }
  return w.toUint8Array();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function byte(n: number, what: string): number {
  if (!Number.isInteger(n) || n < 0 || n > 255) throw new RangeError(`${what} ${n} out of byte range`);
  return n;
}

function clampCopies(c: number | undefined): number {
  const n = c ?? 1;
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`copies ${c} must be a positive integer`);
  return n;
}

function assertBitmap(b: MonoBitmap, maxBytes: number): void {
  if (b.bytesPerRow > maxBytes) throw new RangeError(`bitmap is ${b.bytesPerRow} bytes wide, head takes ${maxBytes}`);
  if (b.bytesPerRow !== Math.ceil(b.width / 8)) throw new RangeError('bytesPerRow does not match width');
  if (b.data.length < b.bytesPerRow * b.height) throw new RangeError('bitmap data too short');
}

function rowBytes(b: MonoBitmap, r: number): Uint8Array {
  return b.data.subarray(r * b.bytesPerRow, (r + 1) * b.bytesPerRow);
}

/** [firstNonZeroByte, lastNonZeroByte] of a row, or null for a blank row. */
export function inkSpan(b: MonoBitmap, r: number): [number, number] | null {
  const row = rowBytes(b, r);
  let first = -1;
  let last = -1;
  for (let i = 0; i < row.length; i++) {
    if (row[i] !== 0) {
      if (first < 0) first = i;
      last = i;
    }
  }
  return first < 0 ? null : [first, last];
}

class ByteWriter {
  private chunks: Uint8Array[] = [];
  private size = 0;
  put(a: Uint8Array): void {
    this.chunks.push(a);
    this.size += a.length;
  }
  byte(v: number): void {
    this.put(Uint8Array.of(v));
  }
  toUint8Array(): Uint8Array {
    const out = new Uint8Array(this.size);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }
}
