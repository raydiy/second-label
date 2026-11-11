// Small DOM helpers.
import { icon } from './ui-icons';

type Attrs = Record<string, string | number | boolean | undefined | ((e: Event) => void)>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Attrs = {}, ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, '').toLowerCase(), v);
    else if (k === 'icon') el.insertAdjacentHTML('afterbegin', icon(String(v)));
    else if (k in el && typeof v !== 'string') (el as any)[k] = v;
    else if (k === 'value' && 'value' in el) (el as any).value = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c != null && c !== false) el.append(c);
  return el;
}

export const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

export function toast(msg: string, kind: 'info' | 'ok' | 'error' = 'info', ms = 4000) {
  const box = $('#toasts');
  const t = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, msg);
  box.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? Math.max(ms, 7000) : ms);
}

/** Adds the icon referenced by data-icon to static toolbar buttons. */
export function decorateIcons(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    if (el.querySelector('svg')) return;
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon!));
  });
}

/** Simple modal dialog with arbitrary body; resolves with the clicked action or null. */
export function modal(title: string, body: Node, actions: { id: string; label: string; primary?: boolean }[], cls = ''): {
  dialog: HTMLDialogElement; result: Promise<string | null>;
} {
  const dlg = h('dialog', { class: cls, 'aria-label': title });
  const bar = h('div', { class: 'dialog-actions' });
  let resolveFn!: (v: string | null) => void;
  const result = new Promise<string | null>((r) => (resolveFn = r));
  let value: string | null = null;
  for (const a of actions) {
    bar.append(h('button', { class: a.primary ? 'primary' : '', onclick: () => { value = a.id; dlg.close(); } }, a.label));
  }
  dlg.append(h('h2', {}, title), body, bar);
  dlg.addEventListener('close', () => { dlg.remove(); resolveFn(value); }, { once: true });
  document.body.append(dlg);
  dlg.showModal();
  return { dialog: dlg, result };
}

export function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export const num = (v: number, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toString().replace('.', ',');
export const parseNum = (s: string) => Number(String(s).replace(',', '.'));
