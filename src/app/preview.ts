// 1-bit print preview: shows what the thermal head will produce.
import type { DesignRaster } from '../printer/types';
import { designSize, printableMm } from '../editor/geometry';

export const THRESHOLD = 128;

const de = (v: number) => v.toFixed(1).replace('.', ',');

/** Luminance threshold to pure black/white. Returns new ImageData and the black dot count. */
export function threshold(img: ImageData, t = THRESHOLD): { image: ImageData; black: number } {
  const out = new ImageData(img.width, img.height);
  const s = img.data;
  const d = out.data;
  let black = 0;
  for (let i = 0; i < s.length; i += 4) {
    const a = s[i + 3] / 255;
    const lum = (0.299 * s[i] + 0.587 * s[i + 1] + 0.114 * s[i + 2]) * a + 255 * (1 - a);
    const v = lum < t ? 0 : 255;
    if (v === 0) black++;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  return { image: out, black };
}

export interface PreviewInfo { title: string; copies?: number; note?: string }

/** Opens a modal dialog with the thresholded raster at integer pixel scale. */
export function showPreview(raster: DesignRaster, info: PreviewInfo): Promise<void> {
  const { image, black } = threshold(raster.image);
  const { media } = raster;
  const w = image.width;
  const h = image.height;
  const mmW = (w / media.dpi) * 25.4;
  const size = designSize(media, mmW);
  const pr = printableMm(media, size);

  const dlg = document.createElement('dialog');
  dlg.className = 'preview-dialog';
  dlg.setAttribute('aria-label', info.title);
  const head = document.createElement('h2');
  head.textContent = info.title;
  const meta = document.createElement('p');
  meta.className = 'muted';
  meta.textContent =
    `${media.name}: ${w} x ${h} Punkte bei ${media.dpi} dpi (${de(mmW)} x ${de(size.heightMm)} mm)` +
    (info.copies ? `, ${info.copies} Kopie(n)` : '') + `, ${black} schwarze Punkte`;

  const wrap = document.createElement('div');
  wrap.className = 'preview-wrap';
  const scale = w > 880 ? 880 / w : Math.min(6, Math.floor(880 / w));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  cv.style.width = `${w * scale}px`;
  cv.style.height = `${h * scale}px`;
  cv.getContext('2d')!.putImageData(image, 0, 0);
  cv.setAttribute('role', 'img');
  cv.setAttribute('aria-label', 'Schwarz-Weiß-Vorschau des Drucks');
  const frame = document.createElement('div');
  frame.className = 'preview-printable';
  const k = (media.dpi / 25.4) * scale;
  Object.assign(frame.style, {
    left: `${pr.x * k}px`, top: `${pr.y * k}px`, width: `${pr.w * k}px`, height: `${pr.h * k}px`,
  });
  wrap.append(cv, frame);

  const legend = document.createElement('p');
  legend.className = 'muted small';
  legend.textContent = (info.note ? info.note + ' ' : '') +
    'Rot gestrichelt: druckbarer Bereich. Alles ist auf Schwarz/Weiß reduziert (Schwellwert 50 %), so wie es der Thermodruckkopf ausgibt.';

  const close = document.createElement('button');
  close.textContent = 'Schließen';
  close.className = 'primary';
  close.addEventListener('click', () => dlg.close());
  const actions = document.createElement('div');
  actions.className = 'dialog-actions';
  actions.append(close);

  dlg.append(head, meta, wrap, legend, actions);
  document.body.append(dlg);
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => { dlg.remove(); resolve(); }, { once: true });
    dlg.showModal();
    close.focus();
  });
}
