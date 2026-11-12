// Printer errors carry a stable code (and parameters) next to an English message, so the UI
// can show a translated text while the driver stays free of any UI language.

export type PrinterErrorCode =
  | 'unsupportedModel'
  | 'noTapeEngine'
  | 'noLabelEngine'
  | 'notConnected'
  | 'notReady'
  | 'calibrationInvalid'
  | 'storageUnavailable';

export type PrinterErrorParams = Record<string, string | number>;

export class PrinterError extends Error {
  readonly code: PrinterErrorCode;
  readonly params: PrinterErrorParams;

  constructor(code: PrinterErrorCode, message: string, params: PrinterErrorParams = {}) {
    super(message);
    this.name = 'PrinterError';
    this.code = code;
    this.params = params;
  }
}
