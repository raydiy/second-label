// Icon picker and barcode dialogs.
import { loadIcons, searchIcons, type IconEntry } from '../editor/icons';
import { BARCODE_TYPES } from '../editor/objects';
import { h, modal } from './dom';

/** Searchable Lucide icon picker. Resolves with the chosen icon or null. */
export async function pickIcon(): Promise<IconEntry | null> {
  const search = h('input', { type: 'search', placeholder: 'Suchen, z. B. haus, kabel, warning, arrow ...', 'aria-label': 'Symbol suchen' });
  const grid = h('div', { class: 'icon-grid', role: 'listbox', 'aria-label': 'Symbole' });
  const count = h('p', { class: 'muted small' }, 'Lade Symbole ...');
  const body = h('div', {}, search, count, grid,
    h('p', { class: 'muted small' }, 'Symbole: Lucide (ISC-Lizenz), werden als Vektor eingefügt.'));
  let chosen: IconEntry | null = null;
  const { dialog, result } = modal('Symbol einfügen', body, [{ id: 'cancel', label: 'Abbrechen' }], 'icon-dialog');
  search.focus();

  const all = await loadIcons();
  const render = () => {
    const list = searchIcons(all, search.value);
    count.textContent = `${list.length} von ${all.length} Symbolen${list.length >= 240 ? ' (Suche eingrenzen)' : ''}`;
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

export interface BarcodeChoice { bcid: string; data: string }

export async function askBarcode(initial?: BarcodeChoice): Promise<BarcodeChoice | null> {
  const type = h('select', { 'aria-label': 'Code-Typ' },
    ...BARCODE_TYPES.map((t) => h('option', { value: t.bcid }, t.label)));
  type.value = initial?.bcid ?? 'qrcode';
  const data = h('textarea', { rows: 3, 'aria-label': 'Inhalt' });
  data.value = initial?.data ?? BARCODE_TYPES[0].sample;
  type.addEventListener('change', () => {
    const t = BARCODE_TYPES.find((x) => x.bcid === type.value)!;
    if (!initial) data.value = t.sample;
  });
  const body = h('div', { style: 'width: 380px' },
    h('label', { class: 'field' }, h('span', {}, 'Typ'), type),
    h('label', { class: 'field' }, h('span', {}, 'Inhalt (Text, URL, Nummer)'), data),
    h('p', { class: 'muted small' }, 'Tipp: Codes nicht zu klein drucken; QR-Codes auf 9-mm-Band nur mit kurzem Inhalt.'));
  const { result } = modal(initial ? 'Code bearbeiten' : 'Barcode / QR-Code einfügen', body,
    [{ id: 'cancel', label: 'Abbrechen' }, { id: 'ok', label: initial ? 'Übernehmen' : 'Einfügen', primary: true }]);
  data.focus();
  const r = await result;
  if (r !== 'ok' || !data.value.trim()) return null;
  return { bcid: type.value, data: data.value.trim() };
}
