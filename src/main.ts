import './styles.css';
import { Driver, MEDIA } from './app/backend';
import { showPreview } from './app/preview';
import { LabelEditor } from './editor/editor';
import { preloadBundledFonts } from './editor/fonts';
import { designSize, isContinuous, mmToDots, printableMm } from './editor/geometry';
import { renderRaster, renderThumbnail } from './editor/render';
import type { Media, PrintTarget } from './printer/types';
import { printBlocker } from './printer/devices';
import { mediaForDevice } from './printer/media';
import { getLayout, importLayouts, listLayouts, newId, putLayout, requestPersistentStorage } from './storage/db';
import { LAYOUT_FORMAT, LAYOUT_VERSION, downloadLayout, downloadLibrary, readImportFile, type LayoutFile } from './storage/layout-file';
import { askBarcode, pickIcon } from './ui/dialogs';
import { openCalibrationWizard, type CalibrationDriver } from './ui/calibration';
import { openDiagnostics } from './ui/diagnostics';
import { $, decorateIcons, h, num, toast } from './ui/dom';
import { renderLibrary, type LibraryActions } from './ui/library';
import { renderProperties } from './ui/properties';
import { APP_BUILD_DATE, APP_COMMIT, APP_VERSION } from './build-info';
import { LOCALES, formatPercent, getLocale, setLocale, t, translateDom, type Locale } from './i18n';
import { LocalizedError, errorText } from './i18n/errors';
import { engineName, mediaName, mediaNote } from './ui/media-text';

// ---------- state ----------

const driver: CalibrationDriver = new Driver();
/** Media the connected model can print (all of MEDIA while nothing or an unknown model is connected). */
let available: Media[] = MEDIA;
const mediaById = (id: string) => available.find((m) => m.id === id) ?? MEDIA.find((m) => m.id === id);
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

translateDom();
decorateIcons();
renderLanguageSwitch();
els.name.value = t('layout.untitled');
await preloadBundledFonts();

const initialMedia = mediaById(store.get('dymo.mediaId') ?? '') ?? MEDIA[0];
const editor = new LabelEditor(els.canvas, initialMedia);

const versionEl = document.querySelector<HTMLElement>('#appVersion');
if (versionEl) {
  versionEl.textContent = `v${APP_VERSION}`;
  versionEl.title = t('app.versionTitle', { version: APP_VERSION, commit: APP_COMMIT, date: APP_BUILD_DATE });
}

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
  const list = available.filter((m) => m.target === target);
  els.mediaSelect.replaceChildren(...list.map((m) => h('option', { value: m.id }, mediaName(m))));
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
  els.zoom.textContent = formatPercent(Math.round((editor.zoom / (96 / 72)) * 100) / 100);
}

function updateStatus() {
  const m = editor.media;
  const s = designSize(m, editor.tapeLengthMm);
  const p = printableMm(m, s);
  const size = { w: num(s.widthMm), h: num(s.heightMm) };
  els.status.replaceChildren(
    h('span', {}, mediaName(m)),
    h('span', {}, t(!isContinuous(m) ? 'status.size' : editor.tapeMode === 'auto' ? 'status.sizeAuto' : 'status.sizeFixed', size)),
    h('span', {}, t('status.dots', { w: mmToDots(s.widthMm, m.dpi), h: mmToDots(s.heightMm, m.dpi), dpi: m.dpi })),
    h('span', {}, t('status.printable', { w: num(p.w), h: num(p.h) })),
    h('span', {}, t('status.objects', { count: editor.canvas.getObjects().length })),
  );
  const dims = m.lengthMm
    ? t('mediaInfo.sizeFixed', { engine: engineName(m.target), width: m.widthMm, length: m.lengthMm })
    : t('mediaInfo.sizeContinuous', { engine: engineName(m.target), width: m.widthMm });
  const note = mediaNote(m);
  els.mediaInfo.textContent = `${dims}${m.sku ? `, ${t('mediaInfo.sku', { sku: m.sku })}` : ''}. ${note ? `${note} ` : ''}${t('mediaInfo.margin')}`;
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
    ? t(d ? 'layout.unsaved' : 'layout.saved')
    : t(editor.isEmpty() ? 'layout.new' : 'layout.notSaved');
  document.title = `${d ? '* ' : ''}${els.name.value || t('layout.untitled')} · Second Label`;
  const unsaved = currentId ? d : !editor.isEmpty();
  document.querySelector('[data-cmd="save"]')?.classList.toggle('unsaved', unsaved);
}
els.name.addEventListener('input', () => setDirty(true));

function confirmDiscard(): boolean {
  return !dirty || editor.isEmpty() || confirm(t('layout.confirmDiscard'));
}

// ---------- layouts ----------

function currentLayout(): LayoutFile {
  const m = editor.media;
  const now = new Date().toISOString();
  return {
    format: LAYOUT_FORMAT,
    version: LAYOUT_VERSION,
    name: els.name.value.trim() || t('layout.untitled'),
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
    if (asNew) { l.name = currentId ? t('layout.copyName', { name: l.name }) : l.name; l.createdAt = l.updatedAt; }
    const thumbnail = await renderThumbnail(l.design, editor.media, editor.tapeLengthMm);
    await putLayout({ ...l, id, thumbnail });
    currentId = id;
    createdAt = l.createdAt;
    els.name.value = l.name;
    setDirty(false);
    toast(t('toast.saved', { name: l.name }), 'ok');
    refreshLibrary();
  } catch (e) {
    toast(t('toast.saveFailed', { error: errorText(e) }), 'error');
  }
}

async function openLayout(l: LayoutFile, id: string | null) {
  let media = mediaById(l.mediaId);
  if (!media) {
    const target = (l.mediaInfo?.target as PrintTarget) ?? 'label';
    media = available.find((m) => m.target === target) ?? available[0];
    toast(t('toast.mediaUnknown', { media: l.mediaInfo?.name ?? l.mediaId, fallback: mediaName(media) }), 'error');
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
    toast(t('toast.loadFailed', { error: errorText(e) }), 'error');
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
    const name = prompt(t('layout.renamePrompt'), l.name)?.trim();
    if (!name) return;
    const fresh = (await getLayout(l.id)) ?? l;
    await putLayout({ ...fresh, name, updatedAt: new Date().toISOString() });
    if (currentId === l.id) { els.name.value = name; setDirty(dirty); }
    refreshLibrary();
  },
  duplicate: async (l) => {
    const now = new Date().toISOString();
    await putLayout({ ...l, id: newId(), name: t('layout.copyName', { name: l.name }), createdAt: now, updatedAt: now });
    toast(t('toast.duplicated'), 'ok');
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
    if (!all.length) { toast(t('toast.libraryEmpty'), 'info'); return; }
    downloadLibrary(all);
    toast(t('toast.backedUp', { count: all.length }), 'ok');
  } catch (e) {
    toast(t('toast.backupFailed', { error: errorText(e) }), 'error');
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
      toast(t('toast.backupImported', { added, updated, skipped }), 'ok');
      return;
    }
    const l = r.layout;
    if (!confirmDiscard()) return;
    await openLayout(l, null);
    setDirty(true);
    toast(t('toast.layoutImported', { name: l.name }), 'ok');
  } catch (e) {
    toast(t('toast.importFailed', { error: errorText(e) }), 'error');
  }
});

els.fileImage.addEventListener('change', async () => {
  const f = els.fileImage.files?.[0];
  els.fileImage.value = '';
  if (!f) return;
  try {
    if (f.size > 8 * 1024 * 1024) throw new LocalizedError('error.imageTooLarge');
    if (f.type === 'image/svg+xml' || f.name.toLowerCase().endsWith('.svg')) {
      await editor.addSvg(await f.text(), 'svg', f.name);
    } else {
      const url = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(new LocalizedError('error.fileRead'));
        r.readAsDataURL(f);
      });
      await editor.addImage(url, f.name);
    }
  } catch (e) {
    toast(t('toast.imageFailed', { error: errorText(e) }), 'error');
  }
});

// ---------- printer ----------

function showBrowserNotices() {
  const notes: string[] = [];
  if (!window.isSecureContext) notes.push(t('notice.insecure'));
  if (!('usb' in navigator)) notes.push(t('notice.noWebUsb'));
  if (driver.simulated) notes.push(t('notice.mock'));
  const device = deviceNotice();
  if (device) notes.push(device);
  els.notices.replaceChildren(...notes.map((n) => h('div', { class: 'notice', role: 'note' }, n)));
}

/** Hint for a connected model that is not verified: untested table entry or unknown model. */
function deviceNotice(): string | null {
  if (!driver.isConnected()) return null;
  const spec = driver.deviceSpec();
  if (!spec) {
    const d = driver.describeDevice();
    return t('notice.unknownDevice', {
      device: d?.productName ?? t('common.unknownDevice'),
      key: driver.deviceKey() ?? '?',
      reason: t('printerError.unsupportedModel'),
    });
  }
  if (spec.status === 'experimental') return t('notice.experimental', { model: spec.name });
  return null;
}

/** Adapt engines and media to the connected model (or back to the full list). */
function applyDevice() {
  const spec = driver.isConnected() ? driver.deviceSpec() : null;
  available = spec ? mediaForDevice(spec) : MEDIA;
  const targets = new Set(available.map((m) => m.target));
  document.querySelectorAll<HTMLInputElement>('input[name=engine]').forEach((r) => {
    const off = !targets.has(r.value as PrintTarget);
    r.disabled = off;
    const printer = spec?.name ?? t('engine.thisPrinter');
    r.closest('label')!.title = off ? t(r.value === 'tape' ? 'engine.noTape' : 'engine.noLabel', { printer }) : '';
  });
  const cur = editor.media;
  const match = available.find((m) => m.id === cur.id);
  if (!match) {
    const next = available.find((m) => m.target === cur.target) ?? available[0];
    applyMedia(next);
    toast(t('toast.mediaSwitched', { media: mediaName(cur), printer: spec?.name ?? t('common.printer'), next: mediaName(next) }), 'info');
  } else if (JSON.stringify(match) !== JSON.stringify(cur)) {
    applyMedia(match); // same medium, different geometry (e.g. a narrower tape head)
  }
  setEngineRadio(editor.media.target);
  fillMediaSelect(editor.media.target, editor.media.id);
  showBrowserNotices();
}

function setConn(state: 'off' | 'on' | 'err', text?: string) {
  els.conn.className = `status-pill${state === 'on' ? ' on' : state === 'err' ? ' err' : ''}`;
  els.conn.textContent = text ?? (state === 'on' ? t(driver.simulated ? 'conn.onSimulated' : 'conn.on') : t('conn.off'));
  els.connectBtn.lastChild!.textContent = t(state === 'on' ? 'printbar.disconnect' : 'printbar.connect');
  els.connectBtn.dataset.cmd = state === 'on' ? 'disconnect' : 'connect';
  applyDevice();
}

async function initConnection() {
  setConn('off');
  try {
    if (await driver.reconnect()) setConn('on');
  } catch { /* silent, user can connect manually */ }
  navigator.usb?.addEventListener('disconnect', () => { if (!driver.isConnected()) setConn('off', t('conn.disconnected')); });
}

async function connect() {
  if (!('usb' in navigator) && !driver.simulated) {
    toast(t('toast.noWebUsb'), 'error');
    return;
  }
  try {
    setConn('off', t('conn.connecting'));
    await driver.connect();
    setConn('on');
    toast(t('toast.connected'), 'ok');
  } catch (e) {
    setConn('err', t('conn.error'));
    toast(t('toast.connectFailed', { error: errorText(e) }), 'error');
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
    await showPreview(raster, { title: t('preview.title'), copies: copies() });
  } catch (e) {
    toast(t('toast.previewFailed', { error: errorText(e) }), 'error');
  }
}

async function print() {
  if (editor.isEmpty()) { toast(t('toast.emptyLabel'), 'error'); return; }
  if (!driver.isConnected()) {
    const ok = await driver.reconnect().catch(() => false);
    if (!ok) { toast(t('toast.notConnected'), 'error'); return; }
    setConn('on');
  }
  const btn = $<HTMLButtonElement>('[data-cmd=print]');
  btn.disabled = true;
  try {
    const media = editor.media;
    const blocked = printBlocker(driver.deviceSpec(), media.target);
    if (blocked) throw blocked;
    const status = await driver.getStatus(media.target).catch(() => null);
    if (status?.paperOut) throw new LocalizedError(media.target === 'tape' ? 'error.noTape' : 'error.noLabels');
    const raster = await renderRaster(editor.getDesignJSON(), media, editor.tapeLengthMm);
    await driver.print(raster, { copies: copies(), lengthMm: isContinuous(media) ? editor.tapeLengthMm : undefined });
    toast(t(driver.simulated ? 'toast.printSimulated' : 'toast.printSent'), 'ok');
  } catch (e) {
    toast(t('toast.printFailed', { error: errorText(e) }), 'error');
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
    els.name.value = t('layout.untitled');
    setDirty(false);
    refreshLibrary();
  },
  save: () => saveLayout(false),
  saveAs: () => saveLayout(true),
  import: () => els.fileImport.click(),
  export: () => downloadLayout(currentLayout()),
  undo: () => editor.undo(),
  redo: () => editor.redo(),
  addText: () => editor.addText(t('editor.newText')),
  addLine: () => editor.addLine(),
  addRect: () => editor.addRect(),
  addEllipse: () => editor.addEllipse(),
  addImage: () => els.fileImage.click(),
  addIcon: async () => {
    try {
      const icon = await pickIcon();
      if (icon) await editor.addSvg(icon.svg, 'icon', icon.name);
    } catch (e) {
      toast(t('toast.iconFailed', { error: errorText(e) }), 'error');
    }
  },
  addBarcode: async () => {
    const r = await askBarcode();
    if (!r) return;
    try { await editor.addBarcode(r.bcid, r.data); } catch (e) { toast(errorText(e), 'error'); }
  },
  zoomIn: () => { editor.setZoom(editor.zoom * 1.25); syncFrame(); },
  zoomOut: () => { editor.setZoom(editor.zoom / 1.25); syncFrame(); },
  zoomFit,
  connect,
  disconnect,
  preview,
  print,
  calibrate: () => {
    if (driver.isConnected() && !driver.deviceSpec()) { toast(t('printerError.unsupportedModel'), 'error'); return; }
    return openCalibrationWizard({
      driver,
      media: () => available,
      currentMedia: editor.media,
      connect: async () => { await connect(); return driver.isConnected(); },
      errorText,
    });
  },
  diagnostics: () => openDiagnostics({ driver, media: editor.media, errorText }),
};

document.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-cmd]');
  if (!btn || (btn as HTMLButtonElement).disabled) return;
  const fn = commands[btn.dataset.cmd!];
  if (fn) Promise.resolve(fn()).catch((err) => toast(errorText(err), 'error'));
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

let reloading = false;
window.addEventListener('beforeunload', (e) => {
  if (!reloading && dirty && !editor.isEmpty()) e.preventDefault();
});

// ---------- language ----------

/** DE / EN switch next to the version. Switching reloads the page (asks first if work is unsaved). */
function renderLanguageSwitch() {
  const box = document.querySelector('#langSwitch');
  if (!box) return;
  const active = getLocale();
  box.replaceChildren(...(Object.keys(LOCALES) as Locale[]).map((l) => h('button', {
    type: 'button',
    lang: l,
    title: LOCALES[l].name,
    'aria-label': LOCALES[l].name,
    'aria-pressed': String(l === active),
    onclick: () => switchLanguage(l),
  }, l.toUpperCase())));
}

function switchLanguage(l: Locale) {
  if (l === getLocale()) return;
  if (dirty && !editor.isEmpty() && !confirm(t('lang.confirmReload'))) return;
  setLocale(l);
  reloading = true;
  location.reload();
}

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
