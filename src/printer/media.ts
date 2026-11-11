// Media catalogue for the DYMO LabelWriter DUO (label engine + "Tape 128" engine).
//
// Sources (full citations in docs/protocol.md, "Media"):
//   [DS]  DYMO LabelWriter label datasheet, Farnell, (c) 2022 Newell Brands:
//         https://www.farnell.com/datasheets/3749804.pdf  (item codes, W x H in mm, W = across feed)
//   [PPD] dymo-cups-drivers ppd/lwduol.ppd ("DYMO LabelWriter DUO Label") and
//         ppd/lwduot2.ppd ("DYMO LabelWriter DUO Tape 128"): *PageSize and *ImageableArea,
//         in PostScript points, portrait (x across the head, y along the feed).
//   [TR]  LabelWriter 450 Series Technical Reference, Appendix B: tape widths 6/9/12/19/24 mm.
//   [DRV] dymo-cups-drivers CupsFilterLabelManager.cpp: DUO Tape 128 leader of 75 dots.
//
// Printable area: the vendor non-printable margins are taken from the PPD and converted to the
// landscape design orientation used by the editor (see raster.ts for the rotation):
//   design left  (leading edge, printed first) = PageHeight - ury
//   design right (trailing edge)               = lly
//   design top                                 = widthMm - min(urx, 672-dot head)
//   design bottom                              = llx
// Nominal sizes come from [DS] where DYMO lists a metric size, otherwise from the PPD page size.

import type { Media } from './types';
import { LABEL_DPI, LABEL_HEAD_DOTS, TAPE_DPI, TAPE_HEAD_DOTS, TAPE_MIN_LABEL_DOTS, TAPE_NORMAL_LEADER_DOTS } from './commands';

const PT = 25.4 / 72; // mm per PostScript point
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Usable width of the label head in mm (672 dots at 300 dpi = 56.90 mm). */
export const LABEL_HEAD_MM = (LABEL_HEAD_DOTS / LABEL_DPI) * 25.4;
/** Usable width of the tape head in mm (128 dots at 180 dpi = 18.06 mm). */
export const TAPE_HEAD_MM = (TAPE_HEAD_DOTS / TAPE_DPI) * 25.4;
/** Default leading/trailing blank margin on tape, per the vendor driver (75 dots = 10.58 mm). */
export const TAPE_MARGIN_MM = r2((TAPE_NORMAL_LEADER_DOTS / TAPE_DPI) * 25.4);
/** Shortest tape label the driver produces cut to cut (283 dots = 39.93 mm); shorter jobs are padded. */
export const TAPE_MIN_LENGTH_MM = r2((TAPE_MIN_LABEL_DOTS / TAPE_DPI) * 25.4);

type Ppd = { page: [number, number]; area: [number, number, number, number] };

function label(
  id: string,
  name: string,
  sku: string,
  widthMm: number,
  lengthMm: number | null,
  ppd: Ppd,
  notes?: string,
): Media {
  const ph = ppd.page[1];
  const [llx, lly, urx, ury] = ppd.area;
  // Across the head the PPD coordinates are absolute positions from the label edge, which
  // sits at head dot 0, so the band is [llx, min(urx, head)] regardless of the nominal width.
  const bottom = llx * PT;
  const top = Math.max(0, widthMm - Math.min(urx * PT, LABEL_HEAD_MM));
  const lead = (ph - ury) * PT;
  const trail = lly * PT;
  return {
    id,
    target: 'label',
    name,
    sku,
    widthMm,
    lengthMm,
    dpi: LABEL_DPI,
    printable: {
      xMm: r2(lead),
      yMm: r2(top),
      // Continuous media: there is no fixed length; xMm is the leading and trailing margin.
      widthMm: lengthMm === null ? 0 : r2(lengthMm - lead - trail),
      heightMm: r2(widthMm - top - bottom),
    },
    notes,
  };
}

/** Printable band height on tape per [PPD] lwduot2.ppd (urx - llx), centred on the tape. */
function tape(widthMm: number, bandPt: number): Media {
  const band = Math.min(bandPt * PT, TAPE_HEAD_MM);
  return {
    id: `d1-${widthMm}mm`,
    target: 'tape',
    name: `D1 tape ${widthMm} mm`,
    sku: `D1 ${widthMm} mm`,
    widthMm,
    lengthMm: null,
    dpi: TAPE_DPI,
    printable: {
      xMm: TAPE_MARGIN_MM,
      yMm: r2((widthMm - band) / 2),
      widthMm: 0,
      heightMm: r2(band),
    },
    notes:
      `Continuous. Printable band ${r2(band)} mm (${Math.round((band / 25.4) * TAPE_DPI)} dots) centred on the tape. ` +
      `Minimum label length ${TAPE_MIN_LENGTH_MM} mm cut to cut. Tape colour is set with ESC C (tape type).`,
  };
}

export const MEDIA: Media[] = [
  // --- LabelWriter labels (die-cut), sizes [DS], margins [PPD lwduol.ppd] -----------------
  label('lw-99010', '99010 Standard Address 28 x 89 mm', '99010 / S0722370', 28, 89,
    { page: [79, 252], area: [4.32, 4.32, 76.08, 235.44] }),
  label('lw-99012', '99012 Large Address 36 x 89 mm', '99012 / S0722400', 36, 89,
    { page: [102, 252], area: [4.32, 4.32, 98.4, 234.96] }),
  label('lw-11352', '11352 Return Address 25 x 54 mm', '11352 / S0722520', 25, 54,
    { page: [72, 154], area: [4.08, 4.32, 69.12, 146.64] }),
  label('lw-11354', '11354 Multi-Purpose 57 x 32 mm', '11354 / S0722540', 57, 32,
    { page: [162, 90], area: [2.88, 4.32, 159.12, 85.68] },
    'DYMO lists 32 x 57 mm; the PPD page (162 x 90 pt) puts the 57 mm side across the head.'),
  label('lw-11355', '11355 Multi-Purpose 19 x 51 mm', '11355 / S0722550', 19, 51,
    { page: [54, 144], area: [4.08, 4.32, 51.12, 127.68] }),
  label('lw-11356', '11356 Name Badge 41 x 89 mm', '11356 / S0722560', 41, 89,
    { page: [118, 252], area: [4.08, 4.32, 114.24, 235.44] }),
  label('lw-99014', '99014 Shipping / Name Badge 54 x 101 mm', '99014 / S0722430', 54, 101,
    { page: [154, 286], area: [4.32, 4.32, 150.24, 270.48] }),
  label('lw-99015', '99015 Large Multi-Purpose 54 x 70 mm', '99015 / S0722440', 54, 70,
    { page: [154, 198], area: [2.88, 4.32, 150.24, 182.16] }),
  label('lw-99017', '99017 Suspension File 12 x 50 mm', '99017 / S0722460', 12, 50,
    { page: [36, 144], area: [2.88, 4.32, 33.12, 127.92] }),
  label('lw-99018', '99018 Small Lever Arch File 38 x 190 mm', '99018 / S0722470', 38, 190,
    { page: [108, 539], area: [4.08, 4.32, 104.88, 522.72] }),
  label('lw-99019', '99019 Large Lever Arch File 59 x 190 mm', '99019 / S0722480', 59, 190,
    { page: [167, 539], area: [4.08, 4.32, 163.68, 522.72] },
    'Wider than the 56.9 mm head: the top 2.1 mm of the design cannot be printed.'),
  label('lw-s0929100', 'Appointment / Name Badge Card 51 x 89 mm', 'S0929100 / 30374', 51, 89,
    { page: [144, 252], area: [8.64, 4.32, 141.12, 225.12] },
    'Non-adhesive card. Margins from the PPD entry "30374 Appointment Card".'),
  // US-market items without a metric datasheet entry: nominal size from the PPD page size.
  label('lw-30256', '30256 Shipping 59 x 102 mm', '30256', 59, 102,
    { page: [167, 288], area: [4.08, 4.32, 163.68, 271.2] },
    'US item, size from the PPD page (167 x 288 pt = 58.9 x 101.6 mm). Wider than the head: the top 2.1 mm of the design cannot be printed.'),
  // Continuous paper: width from DYMO (2191636 / 30270, 57 mm x 91 m), margins from the PPD
  // entry "Continuous, Wide" (154 pt page). xMm is the leading and trailing margin.
  label('lw-continuous-57', 'Continuous paper 57 mm', '2191636 / 30270', 57, null,
    { page: [154, 792], area: [4.32, 4.32, 150.24, 775.68] },
    'Continuous. Printable band limited by the head; length chosen per print (PrintOptions.lengthMm).'),

  // --- D1 tape, widths [TR], printable band [PPD lwduot2.ppd], margins [DRV] ---------------
  tape(6, 16.0 - 1.6),
  tape(9, 22.8 - 2.8),
  tape(12, 30.0 - 4.4),
  tape(19, 47.2 - 7.2),
  tape(24, 59.6 - 8.4),
];

export function findMedia(id: string): Media | undefined {
  return MEDIA.find((m) => m.id === id);
}
