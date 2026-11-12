// Factories for vector content: SVG (icons, uploads) and barcodes.
import { loadSVGFromString, util, type FabricObject } from 'fabric';
import { forceBW } from './bw';
import { LocalizedError } from '../i18n/errors';

/** Custom metadata stored on objects (serialised via FabricObject.customProperties). */
export interface DlMeta {
  kind: 'text' | 'icon' | 'svg' | 'image' | 'barcode' | 'rect' | 'line' | 'ellipse';
  name?: string;
  bcid?: string;
  data?: string;
  autoWidth?: boolean;
}

export async function svgToObject(svg: string): Promise<FabricObject> {
  const clean = svg.replace(/currentColor/g, '#000000');
  const { objects, options } = await loadSVGFromString(clean);
  const items = objects.filter((o): o is NonNullable<typeof o> => !!o) as FabricObject[];
  if (!items.length) throw new LocalizedError('error.svgEmpty');
  const obj = items.length === 1 ? items[0] : util.groupSVGElements(items, options);
  forceBW(obj);
  return obj;
}

/** `label` is the English name; the UI shows barcode.types.<bcid> from the locale files. */
export interface BarcodeType { bcid: string; label: string; sample: string; linear: boolean }

export const BARCODE_TYPES: BarcodeType[] = [
  { bcid: 'qrcode', label: 'QR code', sample: 'https://example.org', linear: false },
  { bcid: 'datamatrix', label: 'Data Matrix', sample: 'ABC-123', linear: false },
  { bcid: 'code128', label: 'Code 128', sample: 'ABC-12345', linear: true },
  { bcid: 'code39', label: 'Code 39', sample: 'ABC123', linear: true },
  { bcid: 'ean13', label: 'EAN-13', sample: '4006381333931', linear: true },
  { bcid: 'upca', label: 'UPC-A', sample: '036000291452', linear: true },
];

/** Renders a barcode as vector SVG via bwip-js (loaded on demand). */
export async function barcodeToObject(bcid: string, text: string): Promise<FabricObject> {
  const bwip = await import('bwip-js/browser');
  const type = BARCODE_TYPES.find((t) => t.bcid === bcid);
  let svg: string;
  try {
    const opts: Parameters<typeof bwip.toSVG>[0] = { bcid, text, scale: 2 };
    if (type?.linear) Object.assign(opts, { includetext: true, textxalign: 'center', height: 10 });
    svg = bwip.toSVG(opts);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).replace(/^Error:\s*/, '');
    throw new LocalizedError('error.barcode', { detail: msg });
  }
  return svgToObject(svg);
}
