// Fabric.js based label editor. World unit: pt (1/72 inch).
import { TAPE_MIN_LENGTH_MM } from '../printer/media';
import {
  ActiveSelection,
  Canvas,
  Ellipse,
  FabricImage,
  FabricObject,
  Line,
  Point,
  Rect,
  Textbox,
  type TPointerEventInfo,
} from 'fabric';
import type { Media } from '../printer/types';
import { BLACK, forceBW } from './bw';
import { DEFAULT_FONT, ensureFonts, fontsInJson } from './fonts';
import { designSize, isContinuous, mmToPt, printableMm, ptToMm, type DesignSize, type Rect as RectMm } from './geometry';
import { barcodeToObject, svgToObject, type DlMeta } from './objects';

// Persist our metadata with every object.
FabricObject.customProperties = ['dl'];
// Interaction defaults for all objects.
Object.assign(FabricObject.ownDefaults, {
  transparentCorners: false,
  cornerSize: 9,
  cornerStyle: 'circle',
  borderScaleFactor: 1.5,
  snapAngle: 15,
  snapThreshold: 4,
});

export type TapeMode = 'auto' | 'fixed';
export type AlignKind = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
type Meta = FabricObject & { dl?: DlMeta };

const HISTORY_MAX = 100;
const MIN_TAPE_MM = Math.ceil(TAPE_MIN_LENGTH_MM);

export class LabelEditor extends EventTarget {
  readonly canvas: Canvas;
  media: Media;
  tapeMode: TapeMode = 'auto';
  tapeFixedMm = 60;
  private tapeAutoMm = 40;
  zoom = 3; // screen px per pt
  private history: string[] = [];
  private historyIdx = -1;
  private busy = 0; // >0 while loading/restoring: suppress history
  private commitQueued = false;
  private guides: { v?: number; h?: number } = {};

  constructor(el: HTMLCanvasElement, media: Media) {
    super();
    this.media = media;
    this.canvas = new Canvas(el, {
      backgroundColor: '#ffffff',
      preserveObjectStacking: true,
      selectionColor: 'rgba(37, 99, 235, 0.08)',
      selectionBorderColor: '#2563eb',
      stopContextMenu: true,
      fireRightClick: false,
    });
    this.bindEvents();
    this.updateSize();
    this.resetHistory();
  }

  // ---------- geometry ----------

  get tapeLengthMm(): number {
    return this.tapeMode === 'fixed' ? this.tapeFixedMm : this.tapeAutoMm;
  }

  size(): DesignSize {
    return designSize(this.media, this.tapeLengthMm);
  }

  printablePt(): RectMm {
    const p = printableMm(this.media, this.size());
    return { x: mmToPt(p.x), y: mmToPt(p.y), w: mmToPt(p.w), h: mmToPt(p.h) };
  }

  /** Centre of the physical label (not of the printable area, whose margins are asymmetric). */
  centerPt(): { x: number; y: number } {
    const s = this.size();
    return { x: mmToPt(s.widthMm) / 2, y: mmToPt(s.heightMm) / 2 };
  }

  setMedia(media: Media) {
    this.media = media;
    this.recomputeAutoLength(false);
    this.updateSize();
    this.emit('change');
  }

  setTape(mode: TapeMode, fixedMm?: number) {
    this.tapeMode = mode;
    if (fixedMm != null && Number.isFinite(fixedMm)) this.tapeFixedMm = Math.min(1000, Math.max(MIN_TAPE_MM, fixedMm));
    this.recomputeAutoLength(false);
    this.updateSize();
    this.emit('change');
  }

  setZoom(z: number) {
    this.zoom = Math.min(12, Math.max(0.5, z));
    this.updateSize();
  }

  fitZoom(availW: number, availH: number) {
    const s = this.size();
    const z = Math.min(availW / mmToPt(s.widthMm), availH / mmToPt(s.heightMm));
    this.setZoom(Math.floor(z * 4) / 4);
  }

  private updateSize() {
    const s = this.size();
    const w = mmToPt(s.widthMm);
    const h = mmToPt(s.heightMm);
    this.canvas.setDimensions({ width: Math.round(w * this.zoom), height: Math.round(h * this.zoom) });
    this.canvas.setZoom(this.zoom);
    this.canvas.calcOffset();
    this.canvas.requestRenderAll();
    this.emit('size');
  }

  /** Tape in auto mode: length = rightmost content edge + trailing margin. */
  private recomputeAutoLength(resize = true) {
    if (!isContinuous(this.media)) return;
    let maxX = 0;
    for (const o of this.canvas.getObjects()) {
      for (const p of o.getCoords()) maxX = Math.max(maxX, p.x);
    }
    const contentMm = ptToMm(maxX) + this.media.printable.xMm;
    const next = Math.max(MIN_TAPE_MM, Math.ceil(contentMm * 2) / 2);
    if (next !== this.tapeAutoMm) {
      this.tapeAutoMm = next;
      if (resize && this.tapeMode === 'auto') this.updateSize();
    }
  }

  // ---------- events ----------

  private emit(type: 'change' | 'selection' | 'size' | 'history') {
    this.dispatchEvent(new Event(type));
  }

  private bindEvents() {
    const c = this.canvas;
    const sel = () => this.emit('selection');
    c.on('selection:created', sel);
    c.on('selection:updated', sel);
    c.on('selection:cleared', sel);

    c.on('object:added', () => this.queueCommit());
    c.on('object:removed', () => this.queueCommit());
    c.on('object:modified', () => { this.queueCommit(); sel(); });
    c.on('text:changed', (e) => { this.autoFitText(e.target as Textbox); });
    c.on('text:editing:exited', () => this.queueCommit());
    c.on('object:resizing', (e) => {
      const t = e.target as Meta;
      if (t.dl) t.dl = { ...t.dl, autoWidth: false } as DlMeta;
    });
    c.on('object:moving', (e) => this.snap(e.target));
    c.on('mouse:up', () => {
      if (this.guides.v != null || this.guides.h != null) {
        this.guides = {};
        c.requestRenderAll();
      }
    });
    c.on('after:render', ({ ctx }) => this.drawOverlay(ctx));
    c.on('mouse:wheel', (opt: TPointerEventInfo<WheelEvent>) => {
      if (!opt.e.ctrlKey && !opt.e.metaKey) return;
      opt.e.preventDefault();
      this.setZoom(this.zoom * (opt.e.deltaY < 0 ? 1.1 : 1 / 1.1));
    });
  }

  private snap(target: FabricObject) {
    const { x: cx, y: cy } = this.centerPt();
    const th = 6 / this.zoom;
    const c = target.getCenterPoint();
    const g: { v?: number; h?: number } = {};
    let x = c.x;
    let y = c.y;
    if (Math.abs(c.x - cx) < th) { x = cx; g.v = cx; }
    if (Math.abs(c.y - cy) < th) { y = cy; g.h = cy; }
    if (x !== c.x || y !== c.y) {
      target.setPositionByOrigin(new Point(x, y), 'center', 'center');
      target.setCoords();
    }
    this.guides = g;
  }

  private drawOverlay(ctx: CanvasRenderingContext2D) {
    const s = this.size();
    const W = mmToPt(s.widthMm);
    const H = mmToPt(s.heightMm);
    const pr = this.printablePt();
    const v = this.canvas.viewportTransform;
    ctx.save();
    ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
    // Non-printable margins.
    ctx.fillStyle = 'rgba(220, 38, 38, 0.10)';
    ctx.fillRect(0, 0, W, pr.y);
    ctx.fillRect(0, pr.y + pr.h, W, H - pr.y - pr.h);
    ctx.fillRect(0, pr.y, pr.x, pr.h);
    ctx.fillRect(pr.x + pr.w, pr.y, W - pr.x - pr.w, pr.h);
    ctx.lineWidth = 1 / this.zoom;
    ctx.setLineDash([4 / this.zoom, 3 / this.zoom]);
    ctx.strokeStyle = 'rgba(220, 38, 38, 0.7)';
    ctx.strokeRect(pr.x, pr.y, pr.w, pr.h);
    // Centre guides while snapping.
    ctx.setLineDash([]);
    ctx.strokeStyle = '#db2777';
    if (this.guides.v != null) {
      ctx.beginPath(); ctx.moveTo(this.guides.v, 0); ctx.lineTo(this.guides.v, H); ctx.stroke();
    }
    if (this.guides.h != null) {
      ctx.beginPath(); ctx.moveTo(0, this.guides.h); ctx.lineTo(W, this.guides.h); ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- history ----------

  private snapshot(): string {
    return JSON.stringify(this.canvas.toObject());
  }

  resetHistory() {
    this.history = [this.snapshot()];
    this.historyIdx = 0;
    this.emit('history');
  }

  private queueCommit() {
    if (this.busy || this.commitQueued) return;
    this.commitQueued = true;
    queueMicrotask(() => {
      this.commitQueued = false;
      this.commit();
    });
  }

  /** Record current state (call after programmatic property changes). */
  commit() {
    if (this.busy) return;
    this.recomputeAutoLength();
    const snap = this.snapshot();
    if (snap === this.history[this.historyIdx]) return;
    this.history = this.history.slice(0, this.historyIdx + 1);
    this.history.push(snap);
    if (this.history.length > HISTORY_MAX) this.history.shift();
    this.historyIdx = this.history.length - 1;
    this.emit('history');
    this.emit('change');
  }

  canUndo() { return this.historyIdx > 0; }
  canRedo() { return this.historyIdx < this.history.length - 1; }

  async undo() {
    if (!this.canUndo()) return;
    this.historyIdx--;
    await this.restore(this.history[this.historyIdx]);
  }

  async redo() {
    if (!this.canRedo()) return;
    this.historyIdx++;
    await this.restore(this.history[this.historyIdx]);
  }

  private async restore(snap: string) {
    this.busy++;
    try {
      this.canvas.discardActiveObject();
      await this.canvas.loadFromJSON(JSON.parse(snap));
      this.canvas.backgroundColor = '#ffffff';
    } finally {
      this.busy--;
    }
    this.recomputeAutoLength();
    this.canvas.requestRenderAll();
    this.emit('history');
    this.emit('selection');
    this.emit('change');
  }

  // ---------- design (de)serialisation ----------

  getDesignJSON(): object {
    return this.canvas.toObject();
  }

  isEmpty() { return this.canvas.getObjects().length === 0; }

  async loadDesign(json: object | null) {
    this.busy++;
    try {
      this.canvas.discardActiveObject();
      if (json) {
        await ensureFonts(fontsInJson(json));
        await this.canvas.loadFromJSON(json);
      } else {
        this.canvas.clear();
      }
      this.canvas.backgroundColor = '#ffffff';
      this.canvas.getObjects().forEach((o) => forceBW(o));
    } finally {
      this.busy--;
    }
    this.recomputeAutoLength(false);
    this.updateSize();
    this.resetHistory();
    this.emit('selection');
    this.emit('change');
  }

  // ---------- insertion ----------

  private place(obj: FabricObject, meta: DlMeta, maxW: number, maxH: number, allowUpscale = true) {
    const w = obj.getScaledWidth();
    const h = obj.getScaledHeight();
    let k = Math.min(maxW / w, maxH / h);
    if (!allowUpscale) k = Math.min(1, k);
    if (Number.isFinite(k) && k > 0) obj.scale(obj.scaleX * k);
    (obj as Meta).dl = meta;
    const c = this.centerPt();
    obj.setPositionByOrigin(new Point(c.x, c.y), 'center', 'center');
    obj.setCoords();
    this.canvas.add(obj);
    this.canvas.setActiveObject(obj);
    this.canvas.requestRenderAll();
    this.emit('selection');
  }

  async addText(text = 'Text') {
    const pr = this.printablePt();
    const fontSize = Math.max(6, Math.min(14, Math.round(pr.h * 0.6)));
    await ensureFonts([{ family: DEFAULT_FONT, weight: 'normal', style: 'normal' }]);
    const t = new Textbox(text, {
      fontFamily: DEFAULT_FONT,
      fontSize,
      fill: BLACK,
      textAlign: 'left',
      lineHeight: 1.1,
      width: 40,
      splitByGrapheme: false,
    });
    (t as Meta).dl = { kind: 'text', autoWidth: true } as DlMeta;
    this.fitTextWidth(t);
    this.place(t, (t as Meta).dl!, Infinity, Infinity, false);
    return t;
  }

  addRect() {
    const pr = this.printablePt();
    const r = new Rect({
      width: Math.min(pr.w * 0.5, 60), height: pr.h * 0.6,
      fill: 'transparent', stroke: BLACK, strokeWidth: 1.5, strokeUniform: true, rx: 0, ry: 0,
    });
    this.place(r, { kind: 'rect' }, Infinity, Infinity, false);
  }

  addEllipse() {
    const pr = this.printablePt();
    const s = pr.h * 0.6;
    const e = new Ellipse({ rx: s / 2, ry: s / 2, fill: 'transparent', stroke: BLACK, strokeWidth: 1.5, strokeUniform: true });
    this.place(e, { kind: 'ellipse' }, Infinity, Infinity, false);
  }

  addLine() {
    const pr = this.printablePt();
    const l = new Line([0, 0, Math.min(pr.w * 0.6, 80), 0], { stroke: BLACK, strokeWidth: 1.5, strokeUniform: true, fill: BLACK });
    this.place(l, { kind: 'line' }, Infinity, Infinity, false);
  }

  async addSvg(svg: string, kind: 'icon' | 'svg', name?: string) {
    const obj = await svgToObject(svg);
    const pr = this.printablePt();
    const s = Math.min(pr.h * 0.85, kind === 'icon' ? 40 : 80);
    this.place(obj, { kind, name }, kind === 'icon' ? s : pr.w * 0.8, s);
  }

  async addImage(dataUrl: string, name?: string) {
    const img = await FabricImage.fromURL(dataUrl);
    forceBW(img);
    const pr = this.printablePt();
    this.place(img, { kind: 'image', name }, pr.w * 0.8, pr.h * 0.9);
  }

  async addBarcode(bcid: string, data: string) {
    const obj = await barcodeToObject(bcid, data);
    const pr = this.printablePt();
    const square = bcid === 'qrcode' || bcid === 'datamatrix';
    const h = Math.min(pr.h * 0.95, square ? 70 : 45);
    this.place(obj, { kind: 'barcode', bcid, data }, square ? h : pr.w * 0.9, h);
  }

  /** Replace a barcode object with a regenerated one, keeping position and size. */
  async updateBarcode(old: FabricObject, bcid: string, data: string) {
    const obj = await barcodeToObject(bcid, data);
    const square = bcid === 'qrcode' || bcid === 'datamatrix';
    const targetH = old.getScaledHeight();
    obj.scale(targetH / obj.height);
    if (!square) {
      // Keep the old width for linear codes when reasonable.
      const kx = old.getScaledWidth() / obj.getScaledWidth();
      if (kx > 0.3 && kx < 3) obj.set({ scaleX: obj.scaleX * kx });
    }
    obj.set({ angle: old.angle });
    obj.setPositionByOrigin(old.getCenterPoint(), 'center', 'center');
    (obj as Meta).dl = { kind: 'barcode', bcid, data };
    const idx = this.canvas.getObjects().indexOf(old);
    this.busy++;
    this.canvas.remove(old);
    this.canvas.insertAt(Math.max(0, idx), obj);
    this.busy--;
    this.canvas.setActiveObject(obj);
    this.canvas.requestRenderAll();
    this.commit();
    this.emit('selection');
  }

  // ---------- text helpers ----------

  /** Grow/shrink an auto-width textbox to its longest line. */
  fitTextWidth(t: Textbox) {
    t.set({ width: 5000 });
    t.initDimensions();
    let max = 0;
    for (let i = 0; i < t._textLines.length; i++) max = Math.max(max, t.getLineWidth(i));
    t.set({ width: Math.max(4, Math.ceil(max) + 1) });
    t.initDimensions();
    t.setCoords();
  }

  private autoFitText(t: Textbox) {
    const dl = (t as Meta).dl as (DlMeta & { autoWidth?: boolean }) | undefined;
    if (!(t instanceof Textbox) || !dl || dl.autoWidth === false) return;
    const left = t.left;
    this.fitTextWidth(t);
    t.set({ left });
    t.setCoords();
  }

  /** Apply text properties, loading the font first. */
  async setTextProps(t: Textbox, props: Partial<Pick<Textbox, 'fontFamily' | 'fontSize' | 'fontWeight' | 'fontStyle' | 'textAlign' | 'lineHeight' | 'underline' | 'text' | 'fill'>>) {
    const family = props.fontFamily ?? t.fontFamily;
    await ensureFonts([{ family, weight: String(props.fontWeight ?? t.fontWeight), style: String(props.fontStyle ?? t.fontStyle) }]);
    t.set(props);
    t.initDimensions();
    this.autoFitText(t);
    t.setCoords();
    this.canvas.requestRenderAll();
    this.commit();
  }

  // ---------- selection operations ----------

  active(): FabricObject | undefined {
    return this.canvas.getActiveObject();
  }

  /** Leave text editing and clear the selection (click outside the label). */
  deselect() {
    const act = this.canvas.getActiveObject() as (FabricObject & { isEditing?: boolean; exitEditing?: () => void }) | undefined;
    if (!act) return;
    if (act.isEditing) act.exitEditing?.();
    this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
    this.emit('selection');
  }

  deleteSelection() {
    const objs = this.canvas.getActiveObjects();
    if (!objs.length) return;
    this.canvas.discardActiveObject();
    this.busy++;
    objs.forEach((o) => this.canvas.remove(o));
    this.busy--;
    this.commit();
    this.canvas.requestRenderAll();
    this.emit('selection');
  }

  async duplicateSelection() {
    const act = this.active();
    if (!act) return;
    const clone = await act.clone(['dl']);
    this.canvas.discardActiveObject();
    clone.set({ left: clone.left + 8, top: clone.top + 8, evented: true });
    this.busy++;
    if (clone instanceof ActiveSelection) {
      clone.canvas = this.canvas;
      clone.forEachObject((o) => this.canvas.add(o));
      clone.setCoords();
    } else {
      this.canvas.add(clone);
    }
    this.busy--;
    this.canvas.setActiveObject(clone);
    this.commit();
    this.canvas.requestRenderAll();
    this.emit('selection');
  }

  zOrder(op: 'front' | 'forward' | 'backward' | 'back') {
    const objs = this.canvas.getActiveObjects();
    if (!objs.length) return;
    for (const o of op === 'front' || op === 'backward' ? objs : [...objs].reverse()) {
      if (op === 'front') this.canvas.bringObjectToFront(o);
      else if (op === 'back') this.canvas.sendObjectToBack(o);
      else if (op === 'forward') this.canvas.bringObjectForward(o);
      else this.canvas.sendObjectBackwards(o);
    }
    this.canvas.requestRenderAll();
    this.commit();
  }

  /** Align to the printable area edges; the two centre modes use the label centre. */
  align(kind: AlignKind) {
    const o = this.active();
    if (!o) return;
    const pr = this.printablePt();
    const c = this.centerPt();
    o.setCoords();
    const b = o.getBoundingRect();
    let dx = 0;
    let dy = 0;
    if (kind === 'left') dx = pr.x - b.left;
    if (kind === 'hcenter') dx = c.x - (b.left + b.width / 2);
    if (kind === 'right') dx = pr.x + pr.w - (b.left + b.width);
    if (kind === 'top') dy = pr.y - b.top;
    if (kind === 'vcenter') dy = c.y - (b.top + b.height / 2);
    if (kind === 'bottom') dy = pr.y + pr.h - (b.top + b.height);
    o.set({ left: o.left + dx, top: o.top + dy });
    o.setCoords();
    this.canvas.requestRenderAll();
    this.commit();
    this.emit('selection');
  }

  nudge(dx: number, dy: number) {
    const o = this.active();
    if (!o) return;
    o.set({ left: o.left + dx, top: o.top + dy });
    o.setCoords();
    this.canvas.requestRenderAll();
    this.queueCommit();
    this.emit('selection');
  }

  /** Programmatic property change on the active object followed by a history entry. */
  update(o: FabricObject, props: Record<string, unknown>) {
    o.set(props);
    o.setCoords();
    this.canvas.requestRenderAll();
    this.commit();
  }
}
