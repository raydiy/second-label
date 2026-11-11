// Thermal printing knows only black dots: force every colour to black or white.
import { Color, FabricImage, Group, filters, type FabricObject } from 'fabric';

export const BLACK = '#000000';
export const WHITE = '#ffffff';

/** Maps any CSS colour to black or white. Transparent / none stay as they are. */
export function toBW(c: unknown): unknown {
  if (typeof c !== 'string') return c && typeof c === 'object' ? BLACK : c; // gradients/patterns -> black
  const s = c.trim().toLowerCase();
  if (!s || s === 'none' || s === 'transparent') return c;
  const [r, g, b, a] = new Color(s).getSource();
  if (a === 0) return c;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum < 128 ? BLACK : WHITE;
}

/** Recursively enforce black/white on an object tree. Returns true if something changed. */
export function forceBW(obj: FabricObject): boolean {
  let changed = false;
  if (obj instanceof Group) {
    for (const child of obj.getObjects()) changed = forceBW(child) || changed;
    if (changed) obj.set('dirty', true);
    return changed;
  }
  if (obj instanceof FabricImage) {
    if (!obj.filters.some((f) => f instanceof filters.Grayscale)) {
      obj.filters.push(new filters.Grayscale());
      obj.applyFilters();
      changed = true;
    }
    return changed;
  }
  for (const key of ['fill', 'stroke'] as const) {
    const v = obj.get(key);
    const bw = toBW(v);
    if (bw !== v) { obj.set(key, bw); changed = true; }
  }
  return changed;
}
