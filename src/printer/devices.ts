// Device table: everything that differs between supported USB products lives here, so adding a
// model of the same protocol family is a data change (refactor R1 in docs/printer-families.md).
//
// Only models that docs/printer-families.md classifies as "same family, table entry only" are
// listed. Models that need protocol changes (4XL, Twin Turbo, SE450, 3xx, LabelManager, 5xx) are
// deliberately absent: they connect as "unknown" (diagnostics only, no printing).
//
// Source keys as in docs/printer-families.md:
//   [device] measured on our DUO 0x001D (docs/protocol.md)
//   [TR450]  LabelWriter 450 Series Technical Reference (PID table p. 14, head p. 7, App. B tape)
//   [DRV]    dymo-cups-drivers (raster2dymolw.cpp driver class, CupsFilterLabelManager.cpp tape
//            constants, ppd/lwduot.ppd and lwduot2.ppd), protocol reference only
//   [USBIDS] linux-usb.org usb.ids, vendor 0922
//   [TL-LW]  thermal-label LabelWriter hardware table, [TL-D1] thermal-label D1 topology

import type { Calibration, PrintTarget } from './types';
import { DEFAULT_CALIBRATION } from './raster';
import { PrinterError } from './errors';

export const DYMO_VENDOR_ID = 0x0922;

/** "verified": tested on real hardware. "experimental": table data from sources, untested. */
export type DeviceStatus = 'verified' | 'experimental';

/** LabelWriter raster engine ("ESC raster", LW 400/450 command set). */
export interface LabelEngineSpec {
  /** USB interface (printer class) that carries this engine. Endpoints are read at runtime. */
  interfaceNumber: number;
  dpi: number;
  /** Dots across the head. Bytes per raster line = headDots / 8. */
  headDots: number;
}

/** D1 tape engine (LabelWriter DUO tape side, TR450 Appendix B). */
export interface TapeEngineSpec extends LabelEngineSpec {
  /** Widest D1 cassette the engine takes, in mm. */
  maxTapeMm: number;
  /** Head to cutter distance in dot lines (DRV SetMinLeader). */
  headToCutterDots: number;
  /** Default blank leader and trailer in dot lines (DRV SetNormalLeader). */
  normalLeaderDots: number;
  /** Minimum printed body in dot lines (DRV SetMinPageLines). */
  minPageDots: number;
}

export interface DeviceSpec {
  productId: number;
  /** Hardware model name. Shown only to identify the printer, never as product branding. */
  name: string;
  status: DeviceStatus;
  engines: { label?: LabelEngineSpec; tape?: TapeEngineSpec };
  /** Calibration used until the user stores one for this model. */
  calibration: Calibration;
  /** Source keys (see header) backing the entry. */
  sources: string[];
}

/**
 * Starting calibration for every untested model: no head offset, raster row 0 = design column 0,
 * nominal feed, tape centred. The DUO 0x001D values (DEFAULT_CALIBRATION) were measured on one
 * unit and are not carried over; the calibration wizard corrects the rest per model.
 */
export const NEUTRAL_CALIBRATION: Calibration = Object.freeze({
  label: Object.freeze({ headOffsetDots: 0, feedStartDots: 0, feedScale: 1 }),
  tape: Object.freeze({ centerCorrectionDots: Object.freeze({ 6: 0, 9: 0, 12: 0, 19: 0, 24: 0 }) }),
}) as Calibration;

/** 672-dot, 300 dpi label head on interface 0, shared by all listed models [TR450 p. 7]. */
const LABEL_672: LabelEngineSpec = Object.freeze({ interfaceNumber: 0, dpi: 300, headDots: 672 });

/** "DUO Tape 128" engine on interface 1 [device], constants from [DRV] "DYMO LabelWriter DUO Tape 128". */
const TAPE_128: TapeEngineSpec = Object.freeze({
  interfaceNumber: 1,
  dpi: 180,
  headDots: 128,
  maxTapeMm: 24,
  headToCutterDots: 61,
  normalLeaderDots: 75,
  minPageDots: 133,
});

export const DEVICES: readonly DeviceSpec[] = Object.freeze([
  {
    productId: 0x001d,
    name: 'LabelWriter DUO',
    status: 'verified',
    engines: { label: LABEL_672, tape: TAPE_128 },
    calibration: DEFAULT_CALIBRATION,
    sources: ['device', 'TR450', 'DRV'],
  },
  {
    // PID and composite layout [TR450 p. 14], IF0 label / IF1 tape [TL-D1]; tape head 128 @ 180
    // [TR450 App. B, DRV lw450dt.ppd]; DRV tape constants identical to the DUO Tape 128.
    productId: 0x0023,
    name: 'LabelWriter 450 Duo',
    status: 'experimental',
    engines: { label: LABEL_672, tape: TAPE_128 },
    calibration: NEUTRAL_CALIBRATION,
    sources: ['TR450', 'DRV', 'TL-D1'],
  },
  {
    // Uncertain entry (docs/printer-families.md: medium confidence). The PID is single-sourced
    // [TL-LW, TL-D1] and the interface layout IF0 label / IF1 tape comes from [TL-D1] only.
    // Tape head 96 dots @ 180 dpi [TR450 p. 23, DRV lwduot.ppd]; leaders 75 / 61, min page 133,
    // auto cut [DRV CupsFilterLabelManager.cpp, "DYMO LabelWriter DUO Tape"]. Max cassette 19 mm
    // per [TL-D1]; DRV lwduot.ppd also lists 24 mm page sizes, so this limit is unconfirmed.
    // DRV applies tape centring offsets of -2 (6 mm) and -1 (9 mm) on its own padded raster; not
    // carried over, the wizard measures centring instead.
    productId: 0x0017,
    name: 'LabelWriter DUO (96-dot tape)',
    status: 'experimental',
    engines: {
      label: LABEL_672,
      tape: Object.freeze({ ...TAPE_128, headDots: 96, maxTapeMm: 19 }),
    },
    calibration: NEUTRAL_CALIBRATION,
    sources: ['TL-LW', 'TL-D1', 'TR450', 'DRV'],
  },
  {
    // PID [TR450 p. 14, USBIDS], single printer-class interface [TR450 p. 14], 672 @ 300 [TR450 p. 7].
    productId: 0x0020,
    name: 'LabelWriter 450',
    status: 'experimental',
    engines: { label: LABEL_672 },
    calibration: NEUTRAL_CALIBRATION,
    sources: ['TR450', 'USBIDS', 'DRV'],
  },
  {
    // PID [TR450 p. 14]; same command set as the 450 (speed is mechanical) [TR450, DRV].
    productId: 0x0021,
    name: 'LabelWriter 450 Turbo',
    status: 'experimental',
    engines: { label: LABEL_672 },
    calibration: NEUTRAL_CALIBRATION,
    sources: ['TR450', 'DRV'],
  },
  {
    // PID [USBIDS, TL-LW], 672 @ 300 [TL-LW]; same DRV driver class as the DUO label side.
    // Printer-class interface 0 is assumed, not documented by a vendor source.
    productId: 0x0019,
    name: 'LabelWriter 400',
    status: 'experimental',
    engines: { label: LABEL_672 },
    calibration: NEUTRAL_CALIBRATION,
    sources: ['USBIDS', 'TL-LW', 'DRV'],
  },
  {
    // PID [USBIDS, TL-LW]; as the 400. Interface class assumed.
    productId: 0x001a,
    name: 'LabelWriter 400 Turbo',
    status: 'experimental',
    engines: { label: LABEL_672 },
    calibration: NEUTRAL_CALIBRATION,
    sources: ['USBIDS', 'TL-LW', 'DRV'],
  },
] as DeviceSpec[]);

/** The verified reference device. Its geometry is the default for the pure job builders. */
export const DUO_128: DeviceSpec = DEVICES[0];

/** Table entry for a USB device, or null when the model is not (yet) supported. */
export function findDevice(vendorId: number, productId: number): DeviceSpec | null {
  if (vendorId !== DYMO_VENDOR_ID) return null;
  return DEVICES.find((d) => d.productId === productId) ?? null;
}

/** Engines a device offers, in UI order. */
export function deviceTargets(spec: DeviceSpec): PrintTarget[] {
  return (['label', 'tape'] as const).filter((t) => !!spec.engines[t]);
}

/**
 * Why a print on `target` must not be sent to this device, or null when printing is allowed.
 * `spec` null means a connected but unknown model. The error carries a code for the UI text.
 */
export function printBlocker(spec: DeviceSpec | null, target: PrintTarget): PrinterError | null {
  if (!spec) return new PrinterError('unsupportedModel', UNSUPPORTED_MESSAGE);
  if (target === 'tape' && !spec.engines.tape) {
    return new PrinterError('noTapeEngine', `The ${spec.name} has no tape engine. Choose a label as medium.`, { model: spec.name });
  }
  if (target === 'label' && !spec.engines.label) {
    return new PrinterError('noLabelEngine', `The ${spec.name} has no label engine.`, { model: spec.name });
  }
  return null;
}

/** English message of printBlocker(), or null when printing is allowed. */
export function printBlockReason(spec: DeviceSpec | null, target: PrintTarget): string | null {
  return printBlocker(spec, target)?.message ?? null;
}

export const UNSUPPORTED_MESSAGE =
  'This model is not supported yet. Use "Printer profile / diagnostics" to report it.';
