// Offscreen rendering of a design at printer resolution (no selection handles, no guides).
import { StaticCanvas, type FabricObject } from 'fabric';
import type { DesignRaster, Media } from '../printer/types';
import { designSize, rasterSizeDots } from './geometry';
import { ensureFonts, fontsInJson } from './fonts';

async function renderToCanvas(json: object, widthPx: number, heightPx: number, zoom: number): Promise<HTMLCanvasElement> {
  await ensureFonts(fontsInJson(json));
  const el = document.createElement('canvas');
  const sc = new StaticCanvas(el, {
    width: widthPx,
    height: heightPx,
    enableRetinaScaling: false,
    renderOnAddRemove: false,
  });
  try {
    await sc.loadFromJSON(json);
    sc.backgroundColor = '#ffffff';
    sc.getObjects().forEach((o: FabricObject) => { o.objectCaching = false; });
    sc.setZoom(zoom);
    sc.renderAll();
    const out = document.createElement('canvas');
    out.width = widthPx;
    out.height = heightPx;
    out.getContext('2d')!.drawImage(sc.getElement(), 0, 0);
    return out;
  } finally {
    sc.dispose();
  }
}

/** Renders the design exactly at media size in dots, white background, design orientation. */
export async function renderRaster(json: object, media: Media, tapeLengthMm: number): Promise<DesignRaster> {
  const size = designSize(media, tapeLengthMm);
  const { width, height } = rasterSizeDots(media, size);
  const cv = await renderToCanvas(json, width, height, media.dpi / 72);
  const image = cv.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, width, height);
  return { image, media };
}

/** Small PNG thumbnail for the layout library. */
export async function renderThumbnail(json: object, media: Media, tapeLengthMm: number, maxW = 240): Promise<string> {
  const size = designSize(media, tapeLengthMm);
  const wPt = (size.widthMm * 72) / 25.4;
  const hPt = (size.heightMm * 72) / 25.4;
  const zoom = Math.min(maxW / wPt, 120 / hPt);
  const cv = await renderToCanvas(json, Math.max(1, Math.round(wPt * zoom)), Math.max(1, Math.round(hPt * zoom)), zoom);
  return cv.toDataURL('image/png');
}
