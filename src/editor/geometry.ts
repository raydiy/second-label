// Unit handling. The editor's world unit is the typographic point (1/72 inch),
// so font sizes in pt map 1:1 to Fabric's fontSize.
import type { Media } from '../printer/types';

export const PT_PER_MM = 72 / 25.4;
export const mmToPt = (mm: number) => mm * PT_PER_MM;
export const ptToMm = (pt: number) => pt / PT_PER_MM;
export const mmToDots = (mm: number, dpi: number) => Math.round((mm / 25.4) * dpi);

export interface DesignSize {
  /** Design orientation (landscape as read by the user). */
  widthMm: number;
  heightMm: number;
}

export interface Rect { x: number; y: number; w: number; h: number }

export const isContinuous = (m: Media) => m.lengthMm == null;

/** Design size: height = width across the head, width = length along feed. */
export function designSize(media: Media, tapeLengthMm: number): DesignSize {
  if (media.lengthMm == null) return { widthMm: tapeLengthMm, heightMm: media.widthMm };
  return {
    widthMm: Math.max(media.widthMm, media.lengthMm),
    heightMm: Math.min(media.widthMm, media.lengthMm),
  };
}

/** Printable rect in mm, design orientation. */
export function printableMm(media: Media, size: DesignSize): Rect {
  const p = media.printable;
  if (media.lengthMm == null) {
    return { x: p.xMm, y: p.yMm, w: Math.max(0, size.widthMm - 2 * p.xMm), h: p.heightMm };
  }
  return { x: p.xMm, y: p.yMm, w: p.widthMm, h: p.heightMm };
}

export function rasterSizeDots(media: Media, size: DesignSize) {
  return { width: mmToDots(size.widthMm, media.dpi), height: mmToDots(size.heightMm, media.dpi) };
}
