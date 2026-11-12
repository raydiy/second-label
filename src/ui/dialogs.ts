// Icon picker and barcode dialogs.
import { loadIcons, searchIcons, type IconEntry } from '../editor/icons';
import { BARCODE_TYPES } from '../editor/objects';
import { h, modal } from './dom';
import { hasKey, t } from '../i18n';

/** Searchable Lucide icon picker. Resolves with the chosen icon or null. */
export async function pickIcon(): Promise<IconEntry | null> {
  const search = h('input', { type: 'search', placeholder: t('icons.searchPlaceholder'), 'aria-label': t('icons.searchAria') });
  const grid = h('div', { class: 'icon-grid', role: 'listbox', 'aria-label': t('icons.gridAria') });
  const count = h('p', { class: 'muted small' }, t('icons.loading'));
  const body = h('div', {}, search, count, grid,
    h('p', { class: 'muted small' }, t('icons.credit')));
  let chosen: IconEntry | null = null;
  const { dialog, result } = modal(t('icons.title'), body, [{ id: 'cancel', label: t('common.cancel') }], 'icon-dialog');
  search.focus();

  const all = await loadIcons();
  const render = () => {
    const list = searchIcons(all, search.value);
    count.textContent = t(list.length >= 240 ? 'icons.countLimited' : 'icons.count', { shown: list.length, total: all.length });
    grid.replaceChildren(...list.map((e) => {
      const b = h('button', { type: 'button', role: 'option', title: e.name, 'aria-label': e.name, 'data-icon-name': e.name,
        onclick: () => { chosen = e; dialog.close(); } });
      b.innerHTML = e.svg.replace('width="24" height="24"', 'width="26" height="26"').replace('stroke="#000000"', 'stroke="currentColor"');
      return b;
    }));
  };
  let timer = 0;
  search.addEventListener('input', () => { clearTimeout(timer); timer = window.setTimeout(render, 120); });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); (grid.querySelector('button') as HTMLButtonElement | null)?.click(); }
  });
  render();
  await result;
  return chosen;
}

/** Display name of a barcode type (BARCODE_TYPES.label is the English fallback). */
function barcodeLabel(bcid: string, fallback: string): string {
  const key = `barcode.types.${bcid}`;
  return hasKey(key) ? t(key) : fallback;
}

export interface BarcodeChoice { bcid: string; data: string }

export async function askBarcode(initial?: BarcodeChoice): Promise<BarcodeChoice | null> {
  const type = h('select', { 'aria-label': t('barcode.typeAria') },
    ...BARCODE_TYPES.map((b) => h('option', { value: b.bcid }, barcodeLabel(b.bcid, b.label))));
  type.value = initial?.bcid ?? 'qrcode';
  const data = h('textarea', { rows: 3, 'aria-label': t('barcode.contentAria') });
  data.value = initial?.data ?? BARCODE_TYPES[0].sample;
  type.addEventListener('change', () => {
    const b = BARCODE_TYPES.find((x) => x.bcid === type.value)!;
    if (!initial) data.value = b.sample;
  });
  const body = h('div', { style: 'width: 380px' },
    h('label', { class: 'field' }, h('span', {}, t('barcode.type')), type),
    h('label', { class: 'field' }, h('span', {}, t('barcode.content')), data),
    h('p', { class: 'muted small' }, t('barcode.tip')));
  const { result } = modal(t(initial ? 'barcode.editTitle' : 'barcode.insertTitle'), body,
    [{ id: 'cancel', label: t('common.cancel') }, { id: 'ok', label: t(initial ? 'barcode.apply' : 'barcode.insert'), primary: true }]);
  data.focus();
  const r = await result;
  if (r !== 'ok' || !data.value.trim()) return null;
  return { bcid: type.value, data: data.value.trim() };
}
