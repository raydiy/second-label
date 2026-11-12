// Errors that reach the UI. Code throws English messages; the UI shows translated text.
import { PrinterError } from '../printer/errors';
import { hasKey, t, translate, type MessageKey, type Params } from './index';

/** Error with a message key: `message` is English, errorText() shows the active language. */
export class LocalizedError extends Error {
  readonly key: MessageKey;
  readonly params: Params;

  constructor(key: MessageKey, params: Params = {}) {
    super(translate('en', key, params));
    this.name = 'LocalizedError';
    this.key = key;
    this.params = params;
  }
}

/** User-facing text for any error: localized errors, printer error codes, WebUSB DOMExceptions. */
export function errorText(e: unknown): string {
  if (e instanceof LocalizedError) return t(e.key, e.params);
  if (e instanceof PrinterError) {
    if (e.code === 'notReady') {
      const engine = e.params.target === 'tape' ? t('engine.tape') : t('engine.label');
      const status = String(e.params.status ?? 'printerError');
      return t('printerError.notReady', { engine, status: statusText(status, e.message) });
    }
    return t(`printerError.${e.code}`, e.params);
  }
  const err = e as (DOMException & Error) | null;
  switch (err?.name) {
    case 'NotFoundError': return t('usbError.notFound');
    case 'SecurityError': return t('usbError.security');
    case 'NetworkError': return t('usbError.network');
    case 'InvalidStateError': return t('usbError.invalidState');
    default: return err?.message || String(e);
  }
}

/** Translated printer status for a status code, or `fallback` for an unknown one. */
export function statusText(code: string | undefined, fallback: string): string {
  const key = `printerStatus.${code}`;
  return code && hasKey(key) ? t(key) : fallback;
}
