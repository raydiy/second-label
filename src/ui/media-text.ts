// Display texts for media. Media.name / Media.notes stay English in the catalogue (layout files
// and the diagnostic report use them); the UI translates by media id.
import type { Media } from '../printer/types';
import { formatNumber, hasKey, t } from '../i18n';

export function mediaName(m: Media): string {
  if (m.target === 'tape') return t('media.tape', { width: m.widthMm });
  const key = `media.${m.id}`;
  return hasKey(key) ? t(key) : m.name;
}

export function mediaNote(m: Media): string {
  if (m.target === 'tape') {
    const band = m.printable.heightMm;
    return t('mediaNote.tape', {
      band: formatNumber(band, 2),
      dots: Math.round((band / 25.4) * m.dpi),
      min: formatNumber(m.minLengthMm ?? 0, 2),
    });
  }
  const key = `mediaNote.${m.id}`;
  return hasKey(key) ? t(key) : (m.notes ?? '');
}

export const engineName = (target: Media['target']) => (target === 'tape' ? t('engine.tape') : t('engine.label'));
