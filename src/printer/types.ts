// Shared contract between the editor (src/editor, src/app) and the printer driver (src/printer).
// Owned by the master task. Change only with coordination.

/** The DUO has two print engines on one USB device. */
export type PrintTarget = 'label' | 'tape';

/**
 * 1-bit raster in print-head orientation.
 * width  = dots across the print head (perpendicular to feed)
 * height = raster lines along the feed direction
 * data   = row-major, MSB first, each row padded to whole bytes, 1 = black dot.
 */
export interface MonoBitmap {
  width: number;
  height: number;
  bytesPerRow: number;
  data: Uint8Array;
}

export interface Media {
  id: string;            // e.g. 'lw-99010', 'd1-12mm'
  target: PrintTarget;
  name: string;          // human readable, e.g. '99010 Address 28 x 89 mm'
  sku?: string;          // Dymo article number(s)
  widthMm: number;       // across the feed
  lengthMm: number | null; // along the feed; null = continuous (tape, continuous labels)
  dpi: number;           // engine resolution
  /** Printable area in design orientation (landscape, as the user reads the label), in mm. */
  printable: { xMm: number; yMm: number; widthMm: number; heightMm: number };
  /** Tape only: allowed tape/text colour combos are informational. */
  notes?: string;
}

export interface PrinterStatus {
  connected: boolean;
  ready?: boolean;
  paperOut?: boolean;
  raw?: Uint8Array;
  message?: string;
}

export interface PrintOptions {
  copies?: number;
  /** Continuous media: length to print in mm (editor decides; defaults to content length). */
  lengthMm?: number;
  density?: 'light' | 'normal' | 'dark';
}

/**
 * Design-orientation image as rendered by the editor at media.dpi.
 * The driver is responsible for rotation, thresholding/dithering and margins.
 */
export interface DesignRaster {
  image: ImageData;
  media: Media;
}

export interface PrinterDriver {
  /** Must be called from a user gesture (navigator.usb.requestDevice). */
  connect(): Promise<void>;
  /** Reconnect to an already-permitted device without prompting (navigator.usb.getDevices). */
  reconnect(): Promise<boolean>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getStatus(target: PrintTarget): Promise<PrinterStatus>;
  print(raster: DesignRaster, options?: PrintOptions): Promise<void>;
}
