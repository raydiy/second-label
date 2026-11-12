// Right-hand properties panel.
import { ActiveSelection, Ellipse, FabricObject, Group, Line, Rect, Textbox } from 'fabric';
import { BLACK, WHITE } from '../editor/bw';
import type { LabelEditor } from '../editor/editor';
import { BUNDLED_FONTS, localFontsSupported, queryLocalFamilies } from '../editor/fonts';
import { mmToPt, ptToMm } from '../editor/geometry';
import type { DlMeta } from '../editor/objects';
import { askBarcode } from './dialogs';
import { h, parseNum, toast } from './dom';
import { hasKey, t } from '../i18n';
import { errorText } from '../i18n/errors';

type Meta = FabricObject & { dl?: DlMeta };

function kindLabel(kind: string): string {
  const key = `kind.${kind}`;
  return hasKey(key) ? t(key) : kind;
}

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
const BW_OPTS = (): [string, string][] => [['black', t('color.black')], ['white', t('color.white')]];
const BW_NONE_OPTS = (): [string, string][] => [['none', t('color.none')], ...BW_OPTS()];

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
      numField(t('props.x'), ptToMm(b.left), (v) => moveTo('x', v), { id: 'p-x' }),
      numField(t('props.y'), ptToMm(b.top), (v) => moveTo('y', v), { id: 'p-y' }),
      numField(t('props.width'), ptToMm(o.getScaledWidth()), setW, { id: 'p-w', min: 0.5 }),
      numField(t('props.height'), ptToMm(o.getScaledHeight()), setH, { id: 'p-h', min: 0.5, disabled: isText }),
      numField(t('props.rotation'), o.angle, (v) => ed.update(o, { angle: ((v % 360) + 360) % 360 }), { id: 'p-angle', step: 15 }),
    ),
  );
}

function arrangeSection(ed: LabelEditor) {
  return h('div', { class: 'prop-section' },
    h('h2', {}, t('props.align')),
    h('div', { class: 'btnrow' },
      iconButton('align-start-vertical', t('props.alignLeft'), () => ed.align('left')),
      iconButton('align-center-vertical', t('props.alignHCenter'), () => ed.align('hcenter')),
      iconButton('align-end-vertical', t('props.alignRight'), () => ed.align('right')),
      iconButton('align-start-horizontal', t('props.alignTop'), () => ed.align('top')),
      iconButton('align-center-horizontal', t('props.alignVCenter'), () => ed.align('vcenter')),
      iconButton('align-end-horizontal', t('props.alignBottom'), () => ed.align('bottom')),
    ),
    h('h2', {}, t('props.layer')),
    h('div', { class: 'btnrow' },
      iconButton('bring-to-front', t('props.toFront'), () => ed.zOrder('front')),
      iconButton('arrow-up', t('props.forward'), () => ed.zOrder('forward')),
      iconButton('arrow-down', t('props.backward'), () => ed.zOrder('backward')),
      iconButton('send-to-back', t('props.toBack'), () => ed.zOrder('back')),
    ),
    h('div', { class: 'btnrow' },
      h('button', { icon: 'copy', onclick: () => ed.duplicateSelection() }, t('props.duplicate')),
      h('button', { icon: 'trash-2', class: 'danger', onclick: () => ed.deleteSelection() }, t('props.delete')),
    ),
  );
}

function fontOptions(current: string): HTMLSelectElement {
  const sel = h('select', { id: 'p-font' },
    h('optgroup', { label: t('props.fontsBundled') } as never, ...BUNDLED_FONTS.map((f) =>
      h('option', { value: f.family, style: `font-family:'${f.family}'` }, f.hint ? `${f.family} (${t(`font.${f.hint}`)})` : f.family))),
  );
  const extra = [...systemFonts];
  if (current && !BUNDLED_FONTS.some((f) => f.family === current) && !extra.includes(current)) extra.unshift(current);
  if (extra.length) {
    sel.append(h('optgroup', { label: t('props.fontsSystem') } as never, ...extra.map((f) => h('option', { value: f }, f))));
  }
  sel.value = current;
  return sel;
}

function textSection(ed: LabelEditor, tb: Textbox, rerender: () => void) {
  const dl = (tb as Meta).dl;
  const text = h('textarea', { id: 'p-text', rows: 3, 'aria-label': t('props.textAria') });
  text.value = tb.text;
  text.addEventListener('change', () => ed.setTextProps(tb, { text: text.value }));
  text.addEventListener('input', () => {
    tb.set({ text: text.value });
    if (dl?.autoWidth !== false) ed.fitTextWidth(tb);
    ed.canvas.requestRenderAll();
  });

  const font = fontOptions(tb.fontFamily);
  font.addEventListener('change', () => ed.setTextProps(tb, { fontFamily: font.value }).then(rerender));
  const sysBtn = h('button', {
    type: 'button',
    disabled: !localFontsSupported(),
    title: localFontsSupported() ? t('props.sysFontsTitle') : t('props.sysFontsUnavailable'),
    onclick: async () => {
      try {
        systemFonts = await queryLocalFamilies();
        toast(t('props.sysFontsLoaded', { count: systemFonts.length }), 'ok');
        rerender();
      } catch (e) {
        toast(t('props.sysFontsFailed', { error: errorText(e) }), 'error');
      }
    },
  }, t('props.sysFonts'));

  const bold = String(tb.fontWeight) === 'bold' || Number(tb.fontWeight) >= 600;
  const italic = tb.fontStyle === 'italic';
  const set = (p: Parameters<LabelEditor['setTextProps']>[1]) => ed.setTextProps(tb, p).then(rerender);
  const autoW = h('input', { type: 'checkbox', id: 'p-autow', checked: dl?.autoWidth !== false });
  autoW.addEventListener('change', () => {
    (tb as Meta).dl = { ...(dl ?? { kind: 'text' }), autoWidth: autoW.checked };
    if (autoW.checked) ed.fitTextWidth(tb);
    ed.commit();
    ed.canvas.requestRenderAll();
    rerender();
  });

  return h('div', { class: 'prop-section' },
    h('h2', {}, t('props.text')),
    h('label', { class: 'field' }, h('span', {}, t('props.content')), text),
    h('label', { class: 'field' }, h('span', {}, t('props.font')), font),
    h('div', { class: 'btnrow' }, sysBtn),
    h('div', { class: 'grid2' },
      numField(t('props.size'), tb.fontSize * tb.scaleY, (v) => v > 0 && set({ fontSize: v / tb.scaleY }), { id: 'p-size', step: 0.5, min: 2 }),
      numField(t('props.lineHeight'), tb.lineHeight, (v) => v > 0 && set({ lineHeight: v }), { id: 'p-lh', step: 0.05, min: 0.5 }),
    ),
    h('div', { class: 'btnrow', style: 'margin-top:6px' },
      iconButton('bold', t('props.bold'), () => set({ fontWeight: bold ? 'normal' : 'bold' }), bold),
      iconButton('italic', t('props.italic'), () => set({ fontStyle: italic ? 'normal' : 'italic' }), italic),
      iconButton('underline', t('props.underline'), () => set({ underline: !tb.underline }), !!tb.underline),
      iconButton('align-left', t('props.textLeft'), () => set({ textAlign: 'left' }), tb.textAlign === 'left'),
      iconButton('align-center', t('props.textCenter'), () => set({ textAlign: 'center' }), tb.textAlign === 'center'),
      iconButton('align-right', t('props.textRight'), () => set({ textAlign: 'right' }), tb.textAlign === 'right'),
    ),
    h('label', { class: 'check' }, autoW, t('props.autoWidth')),
    selectField(t('props.textColor'), bwValue(tb.fill) === 'white' ? 'white' : 'black', BW_OPTS(), (v) => set({ fill: bwColor(v) }), 'p-fill'),
  );
}

function shapeSection(ed: LabelEditor, o: FabricObject) {
  const parts: Node[] = [h('h2', {}, t('props.shape'))];
  const isLine = o instanceof Line;
  if (!isLine) parts.push(selectField(t('props.fill'), bwValue(o.fill), BW_NONE_OPTS(), (v) => ed.update(o, { fill: bwColor(v) }), 'p-sfill'));
  parts.push(selectField(t('props.stroke'), bwValue(o.stroke), isLine ? BW_OPTS() : BW_NONE_OPTS(), (v) => ed.update(o, { stroke: v === 'none' ? null : bwColor(v) }), 'p-stroke'));
  parts.push(h('div', { class: 'grid2' },
    numField(t('props.strokeWidth'), o.strokeWidth, (v) => v >= 0 && ed.update(o, { strokeWidth: v }), { id: 'p-sw', step: 0.25, min: 0 }),
    o instanceof Rect ? numField(t('props.cornerRadius'), ptToMm(o.rx), (v) => ed.update(o, { rx: mmToPt(v), ry: mmToPt(v) }), { id: 'p-rx', min: 0 }) : '',
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
    h('h2', {}, t('props.colorHeading')),
    selectField(t('props.color'), cur === 'white' ? 'white' : 'black', BW_OPTS(), (v) => { recolor(o, bwColor(v)); ed.update(o, {}); }, 'p-vcolor'),
  );
}

function barcodeSection(ed: LabelEditor, o: FabricObject) {
  const dl = (o as Meta).dl!;
  return h('div', { class: 'prop-section' },
    h('h2', {}, t('props.code')),
    h('p', { class: 'small', style: 'word-break: break-all' }, `${dl.bcid}: ${dl.data}`),
    h('button', {
      icon: 'pencil',
      onclick: async () => {
        const r = await askBarcode({ bcid: dl.bcid!, data: dl.data ?? '' });
        if (!r) return;
        try { await ed.updateBarcode(o, r.bcid, r.data); } catch (e) { toast(errorText(e), 'error'); }
      },
    }, t('props.editContent')),
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
      h('h2', {}, t('props.heading')),
      h('p', { class: 'muted small' }, t('props.hint')),
    ));
    out.push(h('div', { class: 'kbd-help' },
      h('h2', {}, t('kbd.heading')),
      h('div', {}, h('kbd', {}, t('kbd.del')), ` ${t('kbd.delete')}`),
      h('div', {}, h('kbd', {}, t('kbd.ctrlD')), ` ${t('kbd.duplicate')}`),
      h('div', {}, h('kbd', {}, t('kbd.ctrlZ')), ' / ', h('kbd', {}, t('kbd.ctrlShiftZ')), ` ${t('kbd.undoRedo')}`),
      h('div', {}, h('kbd', {}, t('kbd.arrows')), ` ${t('kbd.move')}`),
      h('div', {}, h('kbd', {}, t('kbd.ctrlWheel')), ` ${t('kbd.zoom')}`),
      h('div', {}, t('kbd.snap')),
    ));
  } else if (act instanceof ActiveSelection) {
    out.push(h('h2', {}, t('props.selected', { count: objs.length })));
    out.push(arrangeSection(ed));
  } else {
    const dl = (act as Meta).dl;
    const kind = dl?.kind ?? (act instanceof Textbox ? 'text' : act.type);
    out.push(h('h2', {}, kindLabel(kind)));
    out.push(commonSection(ed, act));
    if (act instanceof Textbox) out.push(textSection(ed, act, rerender));
    else if (kind === 'barcode') out.push(barcodeSection(ed, act));
    else if (act instanceof Rect || act instanceof Ellipse || act instanceof Line) out.push(shapeSection(ed, act));
    else if (kind === 'icon' || kind === 'svg') out.push(vectorSection(ed, act));
    else if (kind === 'image') {
      out.push(h('p', { class: 'muted small prop-section' }, t('props.imageHint')));
    }
    out.push(arrangeSection(ed));
  }
  root.replaceChildren(...out);
  if (focusedId) (root.querySelector(`#${CSS.escape(focusedId)}`) as HTMLElement | null)?.focus();
}
