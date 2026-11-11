// Right-hand properties panel.
import { ActiveSelection, Ellipse, FabricObject, Group, Line, Rect, Textbox } from 'fabric';
import { BLACK, WHITE } from '../editor/bw';
import type { LabelEditor } from '../editor/editor';
import { BUNDLED_FONTS, localFontsSupported, queryLocalFamilies } from '../editor/fonts';
import { mmToPt, ptToMm } from '../editor/geometry';
import type { DlMeta } from '../editor/objects';
import { askBarcode } from './dialogs';
import { h, parseNum, toast } from './dom';

type Meta = FabricObject & { dl?: DlMeta };

const KIND_LABEL: Record<string, string> = {
  text: 'Text', icon: 'Symbol', svg: 'Vektorgrafik', image: 'Bild', barcode: 'Code', rect: 'Rechteck', line: 'Linie', ellipse: 'Ellipse',
};

let systemFonts: string[] = [];

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

function numField(label: string, value: number, onChange: (v: number) => void, opts: { step?: number; min?: number; max?: number; id: string; disabled?: boolean }) {
  const input = h('input', {
    type: 'number', id: opts.id, step: opts.step ?? 0.5, min: opts.min, max: opts.max, value: String(round(value, 1)), disabled: opts.disabled,
  });
  input.addEventListener('change', () => {
    const v = parseNum(input.value);
    if (Number.isFinite(v)) onChange(v);
  });
  return h('label', { class: 'field' }, h('span', {}, label), input);
}

function selectField(label: string, value: string, options: [string, string][], onChange: (v: string) => void, id: string) {
  const sel = h('select', { id }, ...options.map(([v, l]) => h('option', { value: v }, l)));
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  return h('label', { class: 'field' }, h('span', {}, label), sel);
}

const bwValue = (c: unknown) => (typeof c !== 'string' || c === '' || c === 'transparent' || c === 'none' ? 'none' : c.toLowerCase() === WHITE ? 'white' : 'black');
const bwColor = (v: string) => (v === 'none' ? 'transparent' : v === 'white' ? WHITE : BLACK);
const BW_OPTS: [string, string][] = [['black', 'Schwarz'], ['white', 'Weiß']];
const BW_NONE_OPTS: [string, string][] = [['none', 'Keine'], ['black', 'Schwarz'], ['white', 'Weiß']];

function iconButton(iconName: string, label: string, onClick: () => void, pressed?: boolean) {
  const attrs: Record<string, string | boolean | ((e: Event) => void)> = { icon: iconName, title: label, 'aria-label': label, class: 'icon-only', onclick: onClick };
  if (pressed !== undefined) attrs['aria-pressed'] = String(pressed);
  return h('button', attrs);
}

function commonSection(ed: LabelEditor, o: FabricObject) {
  o.setCoords();
  const b = o.getBoundingRect();
  const isText = o instanceof Textbox;
  const moveTo = (axis: 'x' | 'y', mm: number) => {
    const bb = o.getBoundingRect();
    const d = mmToPt(mm) - (axis === 'x' ? bb.left : bb.top);
    ed.update(o, axis === 'x' ? { left: o.left + d } : { top: o.top + d });
  };
  const lockRatio = !(o instanceof Rect || o instanceof Ellipse || o instanceof Line);
  const setW = (mm: number) => {
    if (mm <= 0) return;
    if (isText) {
      const t = o as Textbox;
      (t as Meta).dl = { ...(t as Meta).dl!, autoWidth: false };
      ed.update(t, { width: mmToPt(mm) / t.scaleX });
      return;
    }
    const k = mmToPt(mm) / o.getScaledWidth();
    ed.update(o, lockRatio ? { scaleX: o.scaleX * k, scaleY: o.scaleY * k } : { scaleX: o.scaleX * k });
  };
  const setH = (mm: number) => {
    if (mm <= 0) return;
    const k = mmToPt(mm) / o.getScaledHeight();
    ed.update(o, lockRatio ? { scaleX: o.scaleX * k, scaleY: o.scaleY * k } : { scaleY: o.scaleY * k });
  };
  return h('div', { class: 'prop-section' },
    h('div', { class: 'grid2' },
      numField('X (mm)', ptToMm(b.left), (v) => moveTo('x', v), { id: 'p-x' }),
      numField('Y (mm)', ptToMm(b.top), (v) => moveTo('y', v), { id: 'p-y' }),
      numField('Breite (mm)', ptToMm(o.getScaledWidth()), setW, { id: 'p-w', min: 0.5 }),
      numField('Höhe (mm)', ptToMm(o.getScaledHeight()), setH, { id: 'p-h', min: 0.5, disabled: isText }),
      numField('Drehung (°)', o.angle, (v) => ed.update(o, { angle: ((v % 360) + 360) % 360 }), { id: 'p-angle', step: 15 }),
    ),
  );
}

function arrangeSection(ed: LabelEditor) {
  return h('div', { class: 'prop-section' },
    h('h2', {}, 'Ausrichten (druckbarer Bereich)'),
    h('div', { class: 'btnrow' },
      iconButton('align-start-vertical', 'Links', () => ed.align('left')),
      iconButton('align-center-vertical', 'Horizontal zentrieren', () => ed.align('hcenter')),
      iconButton('align-end-vertical', 'Rechts', () => ed.align('right')),
      iconButton('align-start-horizontal', 'Oben', () => ed.align('top')),
      iconButton('align-center-horizontal', 'Vertikal zentrieren', () => ed.align('vcenter')),
      iconButton('align-end-horizontal', 'Unten', () => ed.align('bottom')),
    ),
    h('h2', {}, 'Ebene'),
    h('div', { class: 'btnrow' },
      iconButton('bring-to-front', 'Ganz nach vorne', () => ed.zOrder('front')),
      iconButton('arrow-up', 'Eine Ebene nach vorne', () => ed.zOrder('forward')),
      iconButton('arrow-down', 'Eine Ebene nach hinten', () => ed.zOrder('backward')),
      iconButton('send-to-back', 'Ganz nach hinten', () => ed.zOrder('back')),
    ),
    h('div', { class: 'btnrow' },
      h('button', { icon: 'copy', onclick: () => ed.duplicateSelection() }, 'Duplizieren'),
      h('button', { icon: 'trash-2', class: 'danger', onclick: () => ed.deleteSelection() }, 'Löschen'),
    ),
  );
}

function fontOptions(current: string): HTMLSelectElement {
  const sel = h('select', { id: 'p-font' },
    h('optgroup', { label: 'Mitgeliefert' } as never, ...BUNDLED_FONTS.map((f) => h('option', { value: f.family, style: `font-family:'${f.family}'` }, f.label))),
  );
  const extra = [...systemFonts];
  if (current && !BUNDLED_FONTS.some((f) => f.family === current) && !extra.includes(current)) extra.unshift(current);
  if (extra.length) {
    sel.append(h('optgroup', { label: 'Systemschriften' } as never, ...extra.map((f) => h('option', { value: f }, f))));
  }
  sel.value = current;
  return sel;
}

function textSection(ed: LabelEditor, t: Textbox, rerender: () => void) {
  const dl = (t as Meta).dl;
  const text = h('textarea', { id: 'p-text', rows: 3, 'aria-label': 'Textinhalt' });
  text.value = t.text;
  text.addEventListener('change', () => ed.setTextProps(t, { text: text.value }));
  text.addEventListener('input', () => {
    t.set({ text: text.value });
    if (dl?.autoWidth !== false) ed.fitTextWidth(t);
    ed.canvas.requestRenderAll();
  });

  const font = fontOptions(t.fontFamily);
  font.addEventListener('change', () => ed.setTextProps(t, { fontFamily: font.value }).then(rerender));
  const sysBtn = h('button', {
    type: 'button',
    disabled: !localFontsSupported(),
    title: localFontsSupported() ? 'Installierte Schriften des Systems anzeigen (Berechtigung nötig)' : 'Nur in Chromium-Browsern verfügbar',
    onclick: async () => {
      try {
        systemFonts = await queryLocalFamilies();
        toast(`${systemFonts.length} Systemschriften geladen. Hinweis: Wer das Layout öffnet, braucht dieselbe Schrift.`, 'ok');
        rerender();
      } catch (e) {
        toast(`Systemschriften nicht verfügbar: ${(e as Error).message}`, 'error');
      }
    },
  }, 'Systemschriften');

  const bold = String(t.fontWeight) === 'bold' || Number(t.fontWeight) >= 600;
  const italic = t.fontStyle === 'italic';
  const set = (p: Parameters<LabelEditor['setTextProps']>[1]) => ed.setTextProps(t, p).then(rerender);
  const autoW = h('input', { type: 'checkbox', id: 'p-autow', checked: dl?.autoWidth !== false });
  autoW.addEventListener('change', () => {
    (t as Meta).dl = { ...(dl ?? { kind: 'text' }), autoWidth: autoW.checked };
    if (autoW.checked) ed.fitTextWidth(t);
    ed.commit();
    ed.canvas.requestRenderAll();
    rerender();
  });

  return h('div', { class: 'prop-section' },
    h('h2', {}, 'Text'),
    h('label', { class: 'field' }, h('span', {}, 'Inhalt (mehrzeilig möglich)'), text),
    h('label', { class: 'field' }, h('span', {}, 'Schrift'), font),
    h('div', { class: 'btnrow' }, sysBtn),
    h('div', { class: 'grid2' },
      numField('Größe (pt)', t.fontSize * t.scaleY, (v) => v > 0 && set({ fontSize: v / t.scaleY }), { id: 'p-size', step: 0.5, min: 2 }),
      numField('Zeilenabstand', t.lineHeight, (v) => v > 0 && set({ lineHeight: v }), { id: 'p-lh', step: 0.05, min: 0.5 }),
    ),
    h('div', { class: 'btnrow', style: 'margin-top:6px' },
      iconButton('bold', 'Fett', () => set({ fontWeight: bold ? 'normal' : 'bold' }), bold),
      iconButton('italic', 'Kursiv', () => set({ fontStyle: italic ? 'normal' : 'italic' }), italic),
      iconButton('underline', 'Unterstrichen', () => set({ underline: !t.underline }), !!t.underline),
      iconButton('align-left', 'Linksbündig', () => set({ textAlign: 'left' }), t.textAlign === 'left'),
      iconButton('align-center', 'Zentriert', () => set({ textAlign: 'center' }), t.textAlign === 'center'),
      iconButton('align-right', 'Rechtsbündig', () => set({ textAlign: 'right' }), t.textAlign === 'right'),
    ),
    h('label', { class: 'check' }, autoW, 'Breite automatisch an Text anpassen'),
    selectField('Textfarbe', bwValue(t.fill) === 'white' ? 'white' : 'black', BW_OPTS, (v) => set({ fill: bwColor(v) }), 'p-fill'),
  );
}

function shapeSection(ed: LabelEditor, o: FabricObject) {
  const parts: Node[] = [h('h2', {}, 'Form')];
  const isLine = o instanceof Line;
  if (!isLine) parts.push(selectField('Füllung', bwValue(o.fill), BW_NONE_OPTS, (v) => ed.update(o, { fill: bwColor(v) }), 'p-sfill'));
  parts.push(selectField('Kontur', bwValue(o.stroke), isLine ? BW_OPTS : BW_NONE_OPTS, (v) => ed.update(o, { stroke: v === 'none' ? null : bwColor(v) }), 'p-stroke'));
  parts.push(h('div', { class: 'grid2' },
    numField('Linienstärke (pt)', o.strokeWidth, (v) => v >= 0 && ed.update(o, { strokeWidth: v }), { id: 'p-sw', step: 0.25, min: 0 }),
    o instanceof Rect ? numField('Eckenradius (mm)', ptToMm(o.rx), (v) => ed.update(o, { rx: mmToPt(v), ry: mmToPt(v) }), { id: 'p-rx', min: 0 }) : '',
  ));
  return h('div', { class: 'prop-section' }, ...parts);
}

function recolor(o: FabricObject, color: string) {
  if (o instanceof Group) { o.getObjects().forEach((c) => recolor(c, color)); o.set('dirty', true); return; }
  for (const k of ['fill', 'stroke'] as const) if (bwValue(o.get(k)) !== 'none') o.set(k, color);
}

function vectorSection(ed: LabelEditor, o: FabricObject) {
  const first = (x: FabricObject): FabricObject => (x instanceof Group && x.getObjects().length ? first(x.getObjects()[0]) : x);
  const f = first(o);
  const cur = bwValue(f.stroke) !== 'none' ? bwValue(f.stroke) : bwValue(f.fill);
  return h('div', { class: 'prop-section' },
    h('h2', {}, 'Farbe'),
    selectField('Farbe', cur === 'white' ? 'white' : 'black', BW_OPTS, (v) => { recolor(o, bwColor(v)); ed.update(o, {}); }, 'p-vcolor'),
  );
}

function barcodeSection(ed: LabelEditor, o: FabricObject) {
  const dl = (o as Meta).dl!;
  return h('div', { class: 'prop-section' },
    h('h2', {}, 'Code'),
    h('p', { class: 'small', style: 'word-break: break-all' }, `${dl.bcid}: ${dl.data}`),
    h('button', {
      icon: 'pencil',
      onclick: async () => {
        const r = await askBarcode({ bcid: dl.bcid!, data: dl.data ?? '' });
        if (!r) return;
        try { await ed.updateBarcode(o, r.bcid, r.data); } catch (e) { toast((e as Error).message, 'error'); }
      },
    }, 'Inhalt bearbeiten'),
  );
}

export function renderProperties(ed: LabelEditor, root: HTMLElement) {
  const rerender = () => renderProperties(ed, root);
  const focusedId = (document.activeElement as HTMLElement | null)?.id;
  const objs = ed.canvas.getActiveObjects();
  const act = ed.active();
  const out: Node[] = [];

  if (!act) {
    out.push(h('div', { class: 'prop-section' },
      h('h2', {}, 'Eigenschaften'),
      h('p', { class: 'muted small' }, 'Objekt auswählen, um es zu bearbeiten. Über die Werkzeugleiste Text, Formen, Bilder, Symbole und Codes einfügen.'),
    ));
    out.push(h('div', { class: 'kbd-help' },
      h('h2', {}, 'Tastatur'),
      h('div', {}, h('kbd', {}, 'Entf'), ' Löschen'),
      h('div', {}, h('kbd', {}, 'Strg+D'), ' Duplizieren'),
      h('div', {}, h('kbd', {}, 'Strg+Z'), ' / ', h('kbd', {}, 'Strg+Umschalt+Z'), ' Rückgängig / Wiederholen'),
      h('div', {}, h('kbd', {}, 'Pfeiltasten'), ' Verschieben (mit Umschalt: 10x)'),
      h('div', {}, h('kbd', {}, 'Strg+Mausrad'), ' Zoom'),
      h('div', {}, 'Mittellinien rasten beim Verschieben ein.'),
    ));
  } else if (act instanceof ActiveSelection) {
    out.push(h('h2', {}, `${objs.length} Objekte ausgewählt`));
    out.push(arrangeSection(ed));
  } else {
    const dl = (act as Meta).dl;
    const kind = dl?.kind ?? (act instanceof Textbox ? 'text' : act.type);
    out.push(h('h2', {}, KIND_LABEL[kind] ?? kind));
    out.push(commonSection(ed, act));
    if (act instanceof Textbox) out.push(textSection(ed, act, rerender));
    else if (kind === 'barcode') out.push(barcodeSection(ed, act));
    else if (act instanceof Rect || act instanceof Ellipse || act instanceof Line) out.push(shapeSection(ed, act));
    else if (kind === 'icon' || kind === 'svg') out.push(vectorSection(ed, act));
    else if (kind === 'image') {
      out.push(h('p', { class: 'muted small prop-section' }, 'Bilder werden in Graustufen angezeigt und beim Druck mit 50 % Schwellwert in Schwarz/Weiß umgesetzt. Kontrastreiche Motive verwenden; die Vorschau zeigt das Ergebnis.'));
    }
    out.push(arrangeSection(ed));
  }
  root.replaceChildren(...out);
  if (focusedId) (root.querySelector(`#${CSS.escape(focusedId)}`) as HTMLElement | null)?.focus();
}
