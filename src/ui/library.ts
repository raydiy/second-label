// Left panel: saved layouts in IndexedDB.
import type { Media } from '../printer/types';
import { deleteLayout, listLayouts } from '../storage/db';
import type { StoredLayout } from '../storage/layout-file';
import { fmtDate, h, toast } from './dom';

export interface LibraryActions {
  open(l: StoredLayout): void;
  rename(l: StoredLayout): void;
  duplicate(l: StoredLayout): void;
  exportFile(l: StoredLayout): void;
  currentId(): string | null;
  mediaById(id: string): Media | undefined;
}

export async function renderLibrary(root: HTMLElement, act: LibraryActions) {
  let items: StoredLayout[];
  try {
    items = await listLayouts();
  } catch (e) {
    root.replaceChildren(h('li', { class: 'empty' }, (e as Error).message));
    return;
  }
  if (!items.length) {
    root.replaceChildren(h('li', { class: 'empty' }, 'Noch keine Layouts gespeichert.'));
    return;
  }
  const cur = act.currentId();
  root.replaceChildren(...items.map((l) => {
    const media = act.mediaById(l.mediaId);
    const thumb = h('button', { class: 'thumb', title: `„${l.name}“ öffnen`, 'aria-label': `${l.name} öffnen`, onclick: () => act.open(l) },
      l.thumbnail ? h('img', { src: l.thumbnail, alt: '' }) : '');
    return h('li', { class: l.id === cur ? 'current' : '', 'data-layout-id': l.id },
      thumb,
      h('div', { class: 'name', title: l.name }, l.name),
      h('div', { class: 'meta' }, `${media?.name ?? l.mediaInfo?.name ?? l.mediaId} · ${fmtDate(l.updatedAt)}`),
      h('div', { class: 'actions' },
        h('button', { onclick: () => act.open(l) }, 'Öffnen'),
        h('button', { onclick: () => act.rename(l) }, 'Umbenennen'),
        h('button', { onclick: () => act.duplicate(l) }, 'Duplizieren'),
        h('button', { onclick: () => act.exportFile(l) }, 'Export'),
        h('button', {
          class: 'danger',
          onclick: async () => {
            if (!confirm(`Layout „${l.name}“ aus der Bibliothek entfernen?`)) return;
            await deleteLayout(l.id);
            toast('Layout entfernt.');
            renderLibrary(root, act);
          },
        }, 'Entfernen'),
      ),
    );
  }));
}
