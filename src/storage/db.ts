// Minimal IndexedDB store for the layout library.
import type { StoredLayout } from './layout-file';

// Internal name from before the rename, kept so existing saved layouts stay available.
const DB_NAME = 'dymo-duo-labels';
const STORE = 'layouts';

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('Die lokale Layout-Bibliothek (IndexedDB) ist nicht verfügbar.'));
  });
  return dbp;
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error ?? new Error('Speicherfehler'));
    t.onabort = () => reject(t.error ?? new Error('Speichern abgebrochen (Speicher voll?)'));
  });
}

export const newId = () => crypto.randomUUID();

export async function listLayouts(): Promise<StoredLayout[]> {
  const all = await tx<StoredLayout[]>('readonly', (s) => s.getAll() as IDBRequest<StoredLayout[]>);
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export const getLayout = (id: string) => tx<StoredLayout | undefined>('readonly', (s) => s.get(id));
export const putLayout = (l: StoredLayout) => tx('readwrite', (s) => s.put(l)).then(() => undefined);
/**
 * Ask the browser to keep this site's storage (no eviction under storage pressure).
 * Chromium decides silently, without a prompt. Returns whether storage is persistent.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Merge a backup into the library: new ids are added, existing ones only if the backup is newer. */
export async function importLayouts(layouts: StoredLayout[]): Promise<{ added: number; updated: number; skipped: number }> {
  let added = 0, updated = 0, skipped = 0;
  for (const l of layouts) {
    const cur = await getLayout(l.id);
    if (!cur) { await putLayout(l); added++; }
    else if (l.updatedAt > cur.updatedAt) { await putLayout(l); updated++; }
    else skipped++;
  }
  return { added, updated, skipped };
}

export const deleteLayout = (id: string) => tx('readwrite', (s) => s.delete(id)).then(() => undefined);
