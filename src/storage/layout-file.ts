// Versioned layout file format, shared between users as .json.
import type { TapeMode } from '../editor/editor';

export const LAYOUT_FORMAT = 'second-label-layout';
/** Format id used before the rename; still accepted on import. */
const LEGACY_FORMATS = ['dymo-duo-layout'];
export const LAYOUT_VERSION = 1;

export interface LayoutFile {
  format: typeof LAYOUT_FORMAT;
  version: typeof LAYOUT_VERSION;
  name: string;
  mediaId: string;
  /** Informational copy of the media so a recipient sees what it was made for. */
  mediaInfo?: { name: string; target: string; widthMm: number; lengthMm: number | null };
  tape?: { mode: TapeMode; lengthMm: number };
  /** Fabric.js canvas JSON (objects in pt). */
  design: object;
  createdAt: string;
  updatedAt: string;
}

export interface StoredLayout extends LayoutFile {
  id: string;
  thumbnail?: string;
}

/** Validates and migrates arbitrary input to the current version. Throws German messages. */
export function parseLayout(input: unknown): LayoutFile {
  if (!input || typeof input !== 'object') throw new Error('Die Datei ist kein gültiges Layout.');
  const o = input as Record<string, any>;
  if (o.format !== LAYOUT_FORMAT && !LEGACY_FORMATS.includes(o.format)) throw new Error('Unbekanntes Dateiformat (kein Second-Label-Layout).');
  if (typeof o.version !== 'number') throw new Error('Layout ohne Versionsangabe.');
  if (o.version > LAYOUT_VERSION) {
    throw new Error(`Das Layout stammt aus einer neueren Programmversion (v${o.version}). Bitte die Anwendung aktualisieren.`);
  }
  // Future migrations: if (o.version === 1) { ...; o.version = 2 }
  if (typeof o.mediaId !== 'string' || !o.design || typeof o.design !== 'object' || !Array.isArray(o.design.objects)) {
    throw new Error('Das Layout ist unvollständig (Medium oder Inhalt fehlt).');
  }
  const now = new Date().toISOString();
  return {
    format: LAYOUT_FORMAT,
    version: LAYOUT_VERSION,
    name: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : 'Importiertes Layout',
    mediaId: o.mediaId,
    mediaInfo: o.mediaInfo,
    tape: o.tape && (o.tape.mode === 'auto' || o.tape.mode === 'fixed') ? { mode: o.tape.mode, lengthMm: Number(o.tape.lengthMm) || 60 } : undefined,
    design: o.design,
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : now,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : now,
  };
}

export function toFile(l: LayoutFile | StoredLayout): LayoutFile {
  const { format, version, name, mediaId, mediaInfo, tape, design, createdAt, updatedAt } = l;
  return { format, version, name, mediaId, mediaInfo, tape, design, createdAt, updatedAt };
}

export function downloadLayout(l: LayoutFile) {
  const blob = new Blob([JSON.stringify(toFile(l), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const safe = l.name.replace(/[^\p{L}\p{N}._ -]+/gu, '_').trim() || 'layout';
  a.download = `${safe}.label.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export async function readLayoutFile(file: File): Promise<LayoutFile> {
  const r = await readImportFile(file);
  if (r.kind !== 'layout') throw new Error('Die Datei ist eine Bibliotheks-Sicherung, kein einzelnes Layout.');
  return r.layout;
}

// ---------- whole-library backup ----------

export const LIBRARY_FORMAT = 'second-label-library';

export interface LibraryFile {
  format: typeof LIBRARY_FORMAT;
  version: typeof LAYOUT_VERSION;
  exportedAt: string;
  layouts: StoredLayout[];
}

export type ImportResult = { kind: 'layout'; layout: LayoutFile } | { kind: 'library'; layouts: StoredLayout[] };

/** Reads either a single layout file or a whole-library backup. */
export async function readImportFile(file: File): Promise<ImportResult> {
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('Die Datei ist kein gültiges JSON.');
  }
  const o = data as Record<string, any> | null;
  if (o && o.format === LIBRARY_FORMAT) {
    if (typeof o.version !== 'number' || o.version > LAYOUT_VERSION) {
      throw new Error('Die Sicherung stammt aus einer neueren Programmversion. Bitte die Anwendung aktualisieren.');
    }
    if (!Array.isArray(o.layouts)) throw new Error('Die Sicherung enthält keine Layouts.');
    const layouts = o.layouts.map((raw: Record<string, any>) => ({
      ...parseLayout({ ...raw, format: LAYOUT_FORMAT, version: raw.version ?? o.version }),
      id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
      thumbnail: typeof raw.thumbnail === 'string' ? raw.thumbnail : undefined,
    }));
    return { kind: 'library', layouts };
  }
  return { kind: 'layout', layout: parseLayout(data) };
}

export function downloadLibrary(layouts: StoredLayout[]) {
  const file: LibraryFile = {
    format: LIBRARY_FORMAT,
    version: LAYOUT_VERSION,
    exportedAt: new Date().toISOString(),
    layouts: layouts.map((l) => ({ ...toFile(l), id: l.id, thumbnail: l.thumbnail })),
  };
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `second-label-backup-${file.exportedAt.slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
