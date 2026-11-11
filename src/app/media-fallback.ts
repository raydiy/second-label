// Placeholder media list used until src/printer/media.ts exists.
// Values are plausible, not measured. Replace via src/app/backend.ts.
import type { Media } from '../printer/types';

export const MEDIA: Media[] = [
  {
    id: 'lw-99010',
    target: 'label',
    name: '99010 Adresse 28 x 89 mm',
    sku: 'S0722370',
    widthMm: 28,
    lengthMm: 89,
    dpi: 300,
    printable: { xMm: 2, yMm: 1.5, widthMm: 85, heightMm: 25 },
  },
  {
    id: 'lw-11352',
    target: 'label',
    name: '11352 Rücksende 25 x 54 mm',
    sku: 'S0722520',
    widthMm: 25,
    lengthMm: 54,
    dpi: 300,
    printable: { xMm: 2, yMm: 1.5, widthMm: 50, heightMm: 22 },
  },
  {
    id: 'd1-12mm',
    target: 'tape',
    name: 'D1 Band 12 mm (endlos)',
    widthMm: 12,
    lengthMm: null,
    dpi: 180,
    printable: { xMm: 3, yMm: 1.5, widthMm: 0, heightMm: 9 },
    notes: 'Schwarz auf Weiß empfohlen',
  },
  {
    id: 'd1-9mm',
    target: 'tape',
    name: 'D1 Band 9 mm (endlos)',
    widthMm: 9,
    lengthMm: null,
    dpi: 180,
    printable: { xMm: 3, yMm: 1, widthMm: 0, heightMm: 7 },
  },
];
