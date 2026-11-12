// Left panel: saved layouts in IndexedDB.
import type { Media } from '../printer/types';
import { deleteLayout, listLayouts } from '../storage/db';
import type { StoredLayout } from '../storage/layout-file';
import { fmtDate, h, toast } from './dom';
import { t } from '../i18n';
import { errorText } from '../i18n/errors';
import { mediaName } from './media-text';

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
    root.replaceChildren(h('li', { class: 'empty' }, errorText(e)));
    return;
  }
  if (!items.length) {
    root.replaceChildren(h('li', { class: 'empty' }, t('library.empty')));
    return;
  }
  const cur = act.currentId();
  root.replaceChildren(...items.map((l) => {
    const media = act.mediaById(l.mediaId);
    const thumb = h('button', { class: 'thumb', title: t('library.openTitle', { name: l.name }), 'aria-label': t('library.openAria', { name: l.name }), onclick: () => act.open(l) },
      l.thumbnail ? h('img', { src: l.thumbnail, alt: '' }) : '');
    return h('li', { class: l.id === cur ? 'current' : '', 'data-layout-id': l.id },
      thumb,
      h('div', { class: 'name', title: l.name }, l.name),
      h('div', { class: 'meta' }, `${media ? mediaName(media) : l.mediaInfo?.name ?? l.mediaId} · ${fmtDate(l.updatedAt)}`),
      h('div', { class: 'actions' },
        h('button', { onclick: () => act.open(l) }, t('library.open')),
        h('button', { onclick: () => act.rename(l) }, t('library.rename')),
        h('button', { onclick: () => act.duplicate(l) }, t('library.duplicate')),
        h('button', { onclick: () => act.exportFile(l) }, t('library.export')),
        h('button', {
          class: 'danger',
          onclick: async () => {
            if (!confirm(t('library.confirmRemove', { name: l.name }))) return;
            await deleteLayout(l.id);
            toast(t('library.removed'));
            renderLibrary(root, act);
          },
        }, t('library.remove')),
      ),
    );
  }));
}
