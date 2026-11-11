import './styles.css';
import { Driver, MEDIA } from './app/backend';
import { showPreview } from './app/preview';
import { LabelEditor } from './editor/editor';
import { preloadBundledFonts } from './editor/fonts';
import { designSize, isContinuous, mmToDots, printableMm } from './editor/geometry';
import { renderRaster, renderThumbnail } from './editor/render';
import type { Media, PrintTarget, PrinterDriver } from './printer/types';
import { getLayout, importLayouts, listLayouts, newId, putLayout, requestPersistentStorage } from './storage/db';
import { LAYOUT_FORMAT, LAYOUT_VERSION, downloadLayout, downloadLibrary, readImportFile, type LayoutFile } from './storage/layout-file';
import { askBarcode, pickIcon } from './ui/dialogs';
import { $, decorateIcons, h, num, toast } from './ui/dom';
import { renderLibrary, type LibraryActions } from './ui/library';
import { renderProperties } from './ui/properties';

// ---------- state ----------

const driver: PrinterDriver & { simulated?: boolean } = new Driver();
const mediaById = (id: string) => MEDIA.find((m) => m.id === id);
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

let currentId: string | null = null;
let createdAt: string | null = null;
let dirty = false;

const els = {
  canvas: $<HTMLCanvasElement>('#editorCanvas'),
  frame: $('#labelFrame'),
  scroll: $('#stageScroll'),
  mediaSelect: $<HTMLSelectElement>('#mediaSelect'),
  tapeOptions: $('#tapeOptions'),
  tapeLength: $<HTMLInputElement>('#tapeLength'),
  mediaInfo: $('#mediaInfo'),
  name: $<HTMLInputElement>('#layoutName'),
  saveState: $('#saveState'),
  library: $('#libraryList'),
  props: $('#props'),
  status: $('#statusBar'),
  zoom: $('#zoomLabel'),
  conn: $('#connStatus'),
  connectBtn: $<HTMLButtonElement>('#connectBtn'),
  copies: $<HTMLInputElement>('#copies'),
  fileImport: $<HTMLInputElement>('#fileImport'),
  fileImage: $<HTMLInputElement>('#fileImage'),
  notices: $('#notices'),
};

// ---------- boot ----------

decorateIcons();
await preloadBundledFonts();

const initialMedia = mediaById(store.get('dymo.mediaId') ?? '') ?? MEDIA[0];
const editor = new LabelEditor(els.canvas, initialMedia);

// Clicking the dark stage around the label leaves text editing and clears the selection.
document.querySelector('.stage')?.addEventListener('pointerdown', (e) => {
  if (!(e.target as Element).closest('#labelFrame')) editor.deselect();
});
(window as unknown as { __editor: LabelEditor }).__editor = editor; // debugging aid

setEngineRadio(initialMedia.target);
fillMediaSelect(initialMedia.target, initialMedia.id);
showBrowserNotices();
requestAnimationFrame(() => zoomFit());


// ---------- media ----------

function setEngineRadio(t: PrintTarget) {
  document.querySelectorAll<HTMLInputElement>('input[name=engine]').forEach((r) => { r.checked = r.value === t; });
}

function fillMediaSelect(target: PrintTarget, selectedId?: string) {
  const list = MEDIA.filter((m) => m.target === target);
  els.mediaSelect.replaceChildren(...list.map((m) => h('option', { value: m.id }, m.name)));
  els.mediaSelect.value = selectedId && list.some((m) => m.id === selectedId) ? selectedId : list[0]?.id ?? '';
  els.tapeOptions.hidden = target !== 'tape';
}

function applyMedia(m: Media) {
  editor.setMedia(m);
  store.set('dymo.mediaId', m.id);
  els.tapeOptions.hidden = !isContinuous(m);
  zoomFit();
}

document.querySelectorAll<HTMLInputElement>('input[name=engine]').forEach((r) =>
  r.addEventListener('change', () => {
    fillMediaSelect(r.value as PrintTarget);
    const m = mediaById(els.mediaSelect.value);
    if (m) applyMedia(m);
  }));
els.mediaSelect.addEventListener('change', () => {
  const m = mediaById(els.mediaSelect.value);
  if (m) applyMedia(m);
});
document.querySelectorAll<HTMLInputElement>('input[name=tapeMode]').forEach((r) =>
  r.addEventListener('change', () => {
    els.tapeLength.disabled = r.value !== 'fixed';
    editor.setTape(r.value as 'auto' | 'fixed', Number(els.tapeLength.value));
    syncFrame();
  }));
els.tapeLength.addEventListener('change', () => {
  editor.setTape('fixed', Number(els.tapeLength.value));
  els.tapeLength.value = String(editor.tapeFixedMm);
});

function syncTapeControls() {
  document.querySelectorAll<HTMLInputElement>('input[name=tapeMode]').forEach((r) => { r.checked = r.value === editor.tapeMode; });
  els.tapeLength.disabled = editor.tapeMode !== 'fixed';
  els.tapeLength.value = String(editor.tapeFixedMm);
}

function syncFrame() {
  els.frame.classList.toggle('tape', isContinuous(editor.media));
  els.zoom.textContent = `${Math.round((editor.zoom / (96 / 72)) * 100)} %`;
}

function updateStatus() {
  const m = editor.media;
  const s = designSize(m, editor.tapeLengthMm);
  const p = printableMm(m, s);
  const dots = `${mmToDots(s.widthMm, m.dpi)} x ${mmToDots(s.heightMm, m.dpi)} Punkte`;
  els.status.replaceChildren(
    h('span', {}, m.name),
    h('span', {}, `${num(s.widthMm)} x ${num(s.heightMm)} mm${isContinuous(m) ? (editor.tapeMode === 'auto' ? ' (Länge automatisch)' : ' (Länge fest)') : ''}`),
    h('span', {}, `${dots} bei ${m.dpi} dpi`),
    h('span', {}, `Druckbar ${num(p.w)} x ${num(p.h)} mm`),
    h('span', {}, `${editor.canvas.getObjects().length} Objekte`),
  );
  els.mediaInfo.textContent = `${m.target === 'tape' ? 'Band' : 'Etikett'} ${m.widthMm} mm breit${m.lengthMm ? `, ${m.lengthMm} mm lang` : ', endlos'}${m.sku ? `, Art.-Nr. ${m.sku}` : ''}. ${m.notes ? m.notes + '. ' : ''}Rot schraffiert: nicht bedruckbarer Rand.`;
  syncFrame();
}

// ---------- zoom ----------

function zoomFit() {
  const r = els.scroll.getBoundingClientRect();
  editor.fitZoom(Math.max(100, r.width - 72), Math.max(60, r.height - 72));
  syncFrame();
}

// ---------- undo / dirty ----------

function updateUndoButtons() {
  $<HTMLButtonElement>('[data-cmd=undo]').disabled = !editor.canUndo();
  $<HTMLButtonElement>('[data-cmd=redo]').disabled = !editor.canRedo();
}

function setDirty(d: boolean) {
  dirty = d;
  els.saveState.textContent = currentId
    ? (d ? 'Ungespeicherte Änderungen' : 'Gespeichert')
    : (editor.isEmpty() ? 'Neues Layout' : 'Noch nicht gespeichert');
  document.title = `${d ? '* ' : ''}${els.name.value || 'Unbenannt'} · Second Label`;
}
els.name.addEventListener('input', () => setDirty(true));

function confirmDiscard(): boolean {
  return !dirty || editor.isEmpty() || confirm('Ungespeicherte Änderungen verwerfen?');
}

// ---------- layouts ----------

function currentLayout(): LayoutFile {
  const m = editor.media;
  const now = new Date().toISOString();
  return {
    format: LAYOUT_FORMAT,
    version: LAYOUT_VERSION,
    name: els.name.value.trim() || 'Unbenannt',
    mediaId: m.id,
    mediaInfo: { name: m.name, target: m.target, widthMm: m.widthMm, lengthMm: m.lengthMm },
    tape: isContinuous(m) ? { mode: editor.tapeMode, lengthMm: editor.tapeMode === 'fixed' ? editor.tapeFixedMm : editor.tapeLengthMm } : undefined,
    design: editor.getDesignJSON(),
    createdAt: createdAt ?? now,
    updatedAt: now,
  };
}

async function saveLayout(asNew: boolean) {
  try {
    const l = currentLayout();
    const id = asNew || !currentId ? newId() : currentId;
    if (asNew) { l.name = currentId ? `${l.name} (Kopie)` : l.name; l.createdAt = l.updatedAt; }
    const thumbnail = await renderThumbnail(l.design, editor.media, editor.tapeLengthMm);
    await putLayout({ ...l, id, thumbnail });
    currentId = id;
    createdAt = l.createdAt;
    els.name.value = l.name;
    setDirty(false);
    toast(`„${l.name}“ gespeichert.`, 'ok');
    refreshLibrary();
  } catch (e) {
    toast(`Speichern fehlgeschlagen: ${(e as Error).message}`, 'error');
  }
}

async function openLayout(l: LayoutFile, id: string | null) {
  let media = mediaById(l.mediaId);
  if (!media) {
    const t = (l.mediaInfo?.target as PrintTarget) ?? 'label';
    media = MEDIA.find((m) => m.target === t) ?? MEDIA[0];
    toast(`Medium „${l.mediaInfo?.name ?? l.mediaId}“ ist hier unbekannt, verwende „${media.name}“.`, 'error');
  }
  if (l.tape) { editor.tapeMode = l.tape.mode; editor.tapeFixedMm = l.tape.lengthMm; }
  setEngineRadio(media.target);
  fillMediaSelect(media.target, media.id);
  editor.setMedia(media);
  store.set('dymo.mediaId', media.id);
  syncTapeControls();
  try {
    await editor.loadDesign(l.design);
  } catch (e) {
    toast(`Layout konnte nicht geladen werden: ${(e as Error).message}`, 'error');
    return;
  }
  currentId = id;
  createdAt = l.createdAt;
  els.name.value = l.name;
  setDirty(false);
  zoomFit();
  refreshLibrary();
}

const libraryActions: LibraryActions = {
  open: (l) => { if (confirmDiscard()) openLayout(l, l.id); },
  rename: async (l) => {
    const name = prompt('Neuer Name:', l.name)?.trim();
    if (!name) return;
    const fresh = (await getLayout(l.id)) ?? l;
    await putLayout({ ...fresh, name, updatedAt: new Date().toISOString() });
    if (currentId === l.id) { els.name.value = name; setDirty(dirty); }
    refreshLibrary();
  },
  duplicate: async (l) => {
    const now = new Date().toISOString();
    await putLayout({ ...l, id: newId(), name: `${l.name} (Kopie)`, createdAt: now, updatedAt: now });
    toast('Layout dupliziert.', 'ok');
    refreshLibrary();
  },
  exportFile: (l) => downloadLayout(l),
  currentId: () => currentId,
  mediaById,
};

function refreshLibrary() {
  renderLibrary(els.library, libraryActions);
}

document.querySelector('#libraryBackup')?.addEventListener('click', async () => {
  try {
    const all = await listLayouts();
    if (!all.length) { toast('Die Bibliothek ist leer, es gibt nichts zu sichern.', 'info'); return; }
    downloadLibrary(all);
    toast(`${all.length} Layouts gesichert.`, 'ok');
  } catch (e) {
    toast(`Sicherung fehlgeschlagen: ${(e as Error).message}`, 'error');
  }
});

void requestPersistentStorage();

els.fileImport.addEventListener('change', async () => {
  const f = els.fileImport.files?.[0];
  els.fileImport.value = '';
  if (!f) return;
  try {
    const r = await readImportFile(f);
    if (r.kind === 'library') {
      const { added, updated, skipped } = await importLayouts(r.layouts);
      refreshLibrary();
      toast(`Sicherung eingelesen: ${added} neu, ${updated} aktualisiert, ${skipped} unverändert.`, 'ok');
      return;
    }
    const l = r.layout;
    if (!confirmDiscard()) return;
    await openLayout(l, null);
    setDirty(true);
    toast(`„${l.name}“ importiert. Mit „Speichern“ in die Bibliothek übernehmen.`, 'ok');
  } catch (e) {
    toast(`Import fehlgeschlagen: ${(e as Error).message}`, 'error');
  }
});

els.fileImage.addEventListener('change', async () => {
  const f = els.fileImage.files?.[0];
  els.fileImage.value = '';
  if (!f) return;
  try {
    if (f.size > 8 * 1024 * 1024) throw new Error('Bild ist größer als 8 MB.');
    if (f.type === 'image/svg+xml' || f.name.toLowerCase().endsWith('.svg')) {
      await editor.addSvg(await f.text(), 'svg', f.name);
    } else {
      const url = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(new Error('Datei konnte nicht gelesen werden.'));
        r.readAsDataURL(f);
      });
      await editor.addImage(url, f.name);
    }
  } catch (e) {
    toast(`Bild konnte nicht eingefügt werden: ${(e as Error).message}`, 'error');
  }
});

// ---------- printer ----------

function showBrowserNotices() {
  const notes: string[] = [];
  if (!window.isSecureContext) notes.push('Diese Seite läuft nicht über HTTPS. WebUSB funktioniert nur in einem sicheren Kontext (https:// oder localhost).');
  if (!('usb' in navigator)) {
    notes.push('Dieser Browser unterstützt kein WebUSB (z. B. Safari oder Firefox). Zum Drucken bitte Chrome, Edge, Vivaldi oder Brave verwenden. Gestalten, Speichern und die Vorschau funktionieren trotzdem.');
  }
  if (driver.simulated) notes.push('Simulationsmodus: Es ist noch kein echter Druckertreiber eingebunden, „Drucken“ zeigt das Druckbild an.');
  els.notices.replaceChildren(...notes.map((n) => h('div', { class: 'notice', role: 'note' }, n)));
}

function usbErrorText(e: unknown): string {
  const err = e as DOMException & Error;
  switch (err?.name) {
    case 'NotFoundError': return 'Kein Drucker ausgewählt (oder kein passendes Gerät gefunden).';
    case 'SecurityError': return 'Zugriff auf USB nicht erlaubt. Bitte die Seite über HTTPS öffnen und den Zugriff zulassen.';
    case 'NetworkError': return 'Die Verbindung zum Drucker ist abgebrochen. Kabel prüfen und neu verbinden.';
    case 'InvalidStateError': return 'Der Drucker ist belegt. Andere Programme (z. B. die Herstellersoftware) schließen und erneut versuchen.';
    default: return err?.message || String(e);
  }
}

function setConn(state: 'off' | 'on' | 'err', text?: string) {
  els.conn.className = `status-pill${state === 'on' ? ' on' : state === 'err' ? ' err' : ''}`;
  els.conn.textContent = text ?? (state === 'on' ? (driver.simulated ? 'Verbunden (Simulation)' : 'Verbunden') : 'Nicht verbunden');
  els.connectBtn.lastChild!.textContent = state === 'on' ? 'Trennen' : 'Verbinden';
  els.connectBtn.dataset.cmd = state === 'on' ? 'disconnect' : 'connect';
}

async function initConnection() {
  setConn('off');
  try {
    if (await driver.reconnect()) setConn('on');
  } catch { /* silent, user can connect manually */ }
  navigator.usb?.addEventListener('disconnect', () => { if (!driver.isConnected()) setConn('off', 'Getrennt'); });
}

async function connect() {
  if (!('usb' in navigator) && !driver.simulated) {
    toast('WebUSB wird von diesem Browser nicht unterstützt. Bitte Chrome, Edge, Vivaldi oder Brave verwenden.', 'error');
    return;
  }
  try {
    setConn('off', 'Verbinde ...');
    await driver.connect();
    setConn('on');
    toast('Drucker verbunden.', 'ok');
  } catch (e) {
    setConn('err', 'Fehler');
    toast(`Verbindung fehlgeschlagen: ${usbErrorText(e)}`, 'error');
  }
}

async function disconnect() {
  try { await driver.disconnect(); } finally { setConn('off'); }
}

function copies(): number {
  const n = Math.round(Number(els.copies.value));
  return Number.isFinite(n) ? Math.min(99, Math.max(1, n)) : 1;
}

async function preview() {
  try {
    const raster = await renderRaster(editor.getDesignJSON(), editor.media, editor.tapeLengthMm);
    await showPreview(raster, { title: 'Druckvorschau', copies: copies() });
  } catch (e) {
    toast(`Vorschau fehlgeschlagen: ${(e as Error).message}`, 'error');
  }
}

async function print() {
  if (editor.isEmpty()) { toast('Das Etikett ist leer.', 'error'); return; }
  if (!driver.isConnected()) {
    const ok = await driver.reconnect().catch(() => false);
    if (!ok) { toast('Kein Drucker verbunden. Bitte zuerst „Verbinden“ klicken.', 'error'); return; }
    setConn('on');
  }
  const btn = $<HTMLButtonElement>('[data-cmd=print]');
  btn.disabled = true;
  try {
    const media = editor.media;
    const status = await driver.getStatus(media.target).catch(() => null);
    if (status?.paperOut) throw new Error(media.target === 'tape' ? 'Kein Band eingelegt oder Band leer.' : 'Keine Etiketten eingelegt oder Rolle leer.');
    const raster = await renderRaster(editor.getDesignJSON(), media, editor.tapeLengthMm);
    await driver.print(raster, { copies: copies(), lengthMm: isContinuous(media) ? editor.tapeLengthMm : undefined });
    toast(driver.simulated ? 'Simulierter Druck abgeschlossen.' : 'Druckauftrag gesendet.', 'ok');
  } catch (e) {
    toast(`Drucken fehlgeschlagen: ${usbErrorText(e)}`, 'error');
    if (!driver.isConnected()) setConn('off');
  } finally {
    btn.disabled = false;
  }
}

// ---------- commands ----------

const commands: Record<string, () => unknown> = {
  new: async () => {
    if (!confirmDiscard()) return;
    await editor.loadDesign(null);
    currentId = null;
    createdAt = null;
    els.name.value = 'Unbenannt';
    setDirty(false);
    refreshLibrary();
  },
  save: () => saveLayout(false),
  saveAs: () => saveLayout(true),
  import: () => els.fileImport.click(),
  export: () => downloadLayout(currentLayout()),
  undo: () => editor.undo(),
  redo: () => editor.redo(),
  addText: () => editor.addText(),
  addLine: () => editor.addLine(),
  addRect: () => editor.addRect(),
  addEllipse: () => editor.addEllipse(),
  addImage: () => els.fileImage.click(),
  addIcon: async () => {
    try {
      const icon = await pickIcon();
      if (icon) await editor.addSvg(icon.svg, 'icon', icon.name);
    } catch (e) {
      toast(`Symbol konnte nicht eingefügt werden: ${(e as Error).message}`, 'error');
    }
  },
  addBarcode: async () => {
    const r = await askBarcode();
    if (!r) return;
    try { await editor.addBarcode(r.bcid, r.data); } catch (e) { toast((e as Error).message, 'error'); }
  },
  zoomIn: () => { editor.setZoom(editor.zoom * 1.25); syncFrame(); },
  zoomOut: () => { editor.setZoom(editor.zoom / 1.25); syncFrame(); },
  zoomFit,
  connect,
  disconnect,
  preview,
  print,
};

document.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-cmd]');
  if (!btn || (btn as HTMLButtonElement).disabled) return;
  const fn = commands[btn.dataset.cmd!];
  if (fn) Promise.resolve(fn()).catch((err) => toast(String((err as Error).message ?? err), 'error'));
});

document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  const typing = t.matches('input, textarea, select, [contenteditable]') || (editor.active() as { isEditing?: boolean } | undefined)?.isEditing;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveLayout(false); return; }
  if (mod && e.key.toLowerCase() === 'p') { e.preventDefault(); print(); return; }
  if (typing || document.querySelector('dialog[open]')) return;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? editor.redo() : editor.undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); editor.redo(); return; }
  if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); editor.duplicateSelection(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { if (editor.active()) { e.preventDefault(); editor.deleteSelection(); } return; }
  const step = e.shiftKey ? 10 : 1;
  const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (arrows[e.key] && editor.active()) { e.preventDefault(); editor.nudge(...arrows[e.key]); }
});

window.addEventListener('beforeunload', (e) => {
  if (dirty && !editor.isEmpty()) e.preventDefault();
});

let resizeTimer = 0;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = window.setTimeout(zoomFit, 150); });

// ---------- start ----------

editor.addEventListener('selection', () => renderProperties(editor, els.props));
editor.addEventListener('change', () => { setDirty(true); updateStatus(); });
editor.addEventListener('size', () => { updateStatus(); syncFrame(); });
editor.addEventListener('history', updateUndoButtons);
renderProperties(editor, els.props);
updateStatus();
updateUndoButtons();
setDirty(false);
refreshLibrary();
initConnection();
