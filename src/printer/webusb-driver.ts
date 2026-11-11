// WebUSB driver for the DYMO LabelWriter DUO (first generation, VID 0x0922 PID 0x001D).
//
// Device layout (measured on the real unit, docs/protocol.md "Device probe"):
//   interface 0  "LabelWriter DUO Label"     bulk OUT 0x01 / IN 0x81, wMaxPacketSize 16
//   interface 1  "LabelWriter DUO Tape 128"  bulk OUT 0x02 / IN 0x82, wMaxPacketSize 64
// Endpoints are read from the descriptors at runtime, only the interface numbers are fixed.
//
// The USB types below are structural subsets of the WebUSB API so this file compiles without
// @types/w3c-web-usb and can be exercised in tests with a fake device.

import type { Calibration, DesignRaster, PrintOptions, PrintTarget, PrinterDriver, PrinterStatus } from './types';
import { buildLabelJob, buildTapeJob, cmdStatus, decodeLabelStatus, decodeTapeStatus } from './commands';
import { mmToDots, rasterize, type DitherMode } from './raster';
import { DEFAULT_CALIBRATION, deviceKey, loadCalibration } from './calibration';
import { stripSerialFields, type DeviceIdEntry, type StatusSnapshot, type UsbDeviceSummary } from './diagnostics';

export const DYMO_VENDOR_ID = 0x0922;
export const DUO_PRODUCT_ID = 0x001d;
export const ENGINE_INTERFACE: Record<PrintTarget, number> = { label: 0, tape: 1 };

// --- minimal WebUSB surface ---------------------------------------------------------------

export interface UsbEndpointLike {
  endpointNumber: number;
  direction: 'in' | 'out';
  type: 'bulk' | 'interrupt' | 'isochronous';
  packetSize: number;
}
export interface UsbInterfaceLike {
  interfaceNumber: number;
  claimed?: boolean;
  alternate: {
    endpoints: UsbEndpointLike[];
    alternateSetting?: number;
    interfaceClass?: number;
    interfaceSubclass?: number;
    interfaceProtocol?: number;
    interfaceName?: string | null;
  };
}
export interface UsbTransferInLike {
  status?: 'ok' | 'stall' | 'babble';
  data?: DataView;
}
export interface UsbTransferOutLike {
  status?: 'ok' | 'stall' | 'babble';
  bytesWritten: number;
}
export interface UsbDeviceLike {
  vendorId: number;
  productId: number;
  productName?: string;
  manufacturerName?: string;
  usbVersionMajor?: number;
  usbVersionMinor?: number;
  deviceClass?: number;
  deviceSubclass?: number;
  deviceProtocol?: number;
  deviceVersionMajor?: number;
  deviceVersionMinor?: number;
  deviceVersionSubminor?: number;
  opened: boolean;
  configuration: { configurationValue: number; interfaces: UsbInterfaceLike[] } | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(value: number): Promise<void>;
  claimInterface(n: number): Promise<void>;
  releaseInterface(n: number): Promise<void>;
  transferOut(ep: number, data: BufferSource): Promise<UsbTransferOutLike>;
  transferIn(ep: number, length: number): Promise<UsbTransferInLike>;
  controlTransferIn?(
    setup: { requestType: 'class'; recipient: 'interface'; request: number; value: number; index: number },
    length: number,
  ): Promise<UsbTransferInLike>;
}
export interface UsbLike {
  requestDevice(options: { filters: { vendorId?: number; productId?: number }[] }): Promise<UsbDeviceLike>;
  getDevices(): Promise<UsbDeviceLike[]>;
}

export interface WebUsbDriverOptions {
  /** Injected for tests or non-browser runtimes; defaults to navigator.usb. */
  usb?: UsbLike;
  /** Bytes per transferOut call. Default 4096 (a multiple of both packet sizes). */
  chunkSize?: number;
  /** ESC C tape type 0..12 used for tape jobs. Default 0 (black on white or clear). */
  tapeType?: number;
  /** Rasterization mode. Default 'threshold'. */
  dither?: DitherMode;
  /** Status reply timeout in ms. Default 2000. */
  statusTimeoutMs?: number;
  /**
   * Stored calibration for a device key ("0922:001d"), consulted on every print.
   * Defaults to localStorage (calibration.ts); return null to use DEFAULT_CALIBRATION.
   */
  calibrationFor?: (deviceKey: string) => Calibration | null;
}

interface EngineIo {
  iface: number;
  outEp: number;
  inEp: number;
  inPacketSize: number;
}

export class WebUsbPrinterDriver implements PrinterDriver {
  private device: UsbDeviceLike | null = null;
  private claimed = new Set<number>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly opts: Required<Omit<WebUsbDriverOptions, 'usb'>> & { usb?: UsbLike };
  private statusLog: Partial<Record<PrintTarget, StatusSnapshot>> = {};

  constructor(opts: WebUsbDriverOptions = {}) {
    this.opts = {
      usb: opts.usb,
      chunkSize: opts.chunkSize ?? 4096,
      tapeType: opts.tapeType ?? 0,
      dither: opts.dither ?? 'threshold',
      statusTimeoutMs: opts.statusTimeoutMs ?? 2000,
      calibrationFor: opts.calibrationFor ?? ((key) => loadCalibration(key)?.calibration ?? null),
    };
  }

  setTapeType(n: number): void {
    this.opts.tapeType = n;
  }

  setDither(mode: DitherMode): void {
    this.opts.dither = mode;
  }

  private usb(): UsbLike {
    const usb = this.opts.usb ?? (globalThis.navigator as unknown as { usb?: UsbLike } | undefined)?.usb;
    if (!usb) throw new Error('WebUSB is not available. Use a Chromium based browser on https:// or localhost.');
    return usb;
  }

  async connect(): Promise<void> {
    const device = await this.usb().requestDevice({ filters: [{ vendorId: DYMO_VENDOR_ID }] });
    await this.attach(device);
  }

  async reconnect(): Promise<boolean> {
    const devices = await this.usb().getDevices();
    const device = devices.find((d) => d.vendorId === DYMO_VENDOR_ID);
    if (!device) return false;
    await this.attach(device);
    return true;
  }

  async disconnect(): Promise<void> {
    const device = this.device;
    if (!device) return;
    await this.serialize(async () => {
      for (const n of this.claimed) {
        try {
          await device.releaseInterface(n);
        } catch {
          // device may already be gone (unplugged); closing below is what matters
        }
      }
      this.claimed.clear();
      if (device.opened) await device.close();
    });
    this.device = null;
  }

  isConnected(): boolean {
    return !!this.device?.opened;
  }

  async getStatus(target: PrintTarget): Promise<PrinterStatus> {
    if (!this.device) return { connected: false, message: 'Not connected' };
    return this.serialize(() => this.readStatus(target));
  }

  /** IEEE 1284 Device ID of an engine, e.g. "MFG:DYMO;...;MDL:LabelWriter DUO Tape 128;...". */
  async getDeviceId(target: PrintTarget): Promise<string | null> {
    const device = this.requireDevice();
    if (!device.controlTransferIn) return null;
    return this.serialize(async () => {
      const io = await this.engine(target);
      return this.readDeviceIdRaw(io.iface);
    });
  }

  // --- calibration and diagnostics ---------------------------------------------------------

  /** Calibration storage key of the connected model ("0922:001d"), null when not connected. */
  deviceKey(): string | null {
    return this.device ? deviceKey(this.device.vendorId, this.device.productId) : null;
  }

  /** Calibration used for the next print: stored for this model, else the defaults. */
  activeCalibration(): Calibration {
    const key = this.deviceKey();
    return (key && this.opts.calibrationFor(key)) || DEFAULT_CALIBRATION;
  }

  /** USB descriptors of the connected device. Never includes the serial number. */
  describeDevice(): UsbDeviceSummary | null {
    const d = this.device;
    if (!d) return null;
    const ver = (a?: number, b?: number, c?: number) => (a === undefined ? undefined : [a, b ?? 0, c].filter((v) => v !== undefined).join('.'));
    return {
      vendorId: d.vendorId,
      productId: d.productId,
      productName: d.productName ?? null,
      manufacturerName: d.manufacturerName ?? null,
      usbVersion: ver(d.usbVersionMajor, d.usbVersionMinor) ?? null,
      deviceVersion: ver(d.deviceVersionMajor, d.deviceVersionMinor, d.deviceVersionSubminor) ?? null,
      deviceClass: d.deviceClass ?? null,
      deviceSubclass: d.deviceSubclass ?? null,
      deviceProtocol: d.deviceProtocol ?? null,
      configurationValue: d.configuration?.configurationValue ?? null,
      interfaces: (d.configuration?.interfaces ?? []).map((i) => ({
        number: i.interfaceNumber,
        alternateSetting: i.alternate.alternateSetting ?? 0,
        interfaceClass: i.alternate.interfaceClass ?? null,
        interfaceSubclass: i.alternate.interfaceSubclass ?? null,
        interfaceProtocol: i.alternate.interfaceProtocol ?? null,
        name: i.alternate.interfaceName ?? null,
        endpoints: i.alternate.endpoints.map((e) => ({
          number: e.endpointNumber,
          direction: e.direction,
          type: e.type,
          packetSize: e.packetSize,
        })),
      })),
    };
  }

  /**
   * IEEE 1284 Device ID of every interface (USB printer class GET_DEVICE_ID), with any
   * serial number field removed. Interfaces that cannot be read report an error instead.
   */
  async readDeviceIds(): Promise<DeviceIdEntry[]> {
    const device = this.requireDevice();
    const ifaces = device.configuration?.interfaces ?? [];
    return this.serialize(async () => {
      const out: DeviceIdEntry[] = [];
      for (const i of ifaces) {
        const n = i.interfaceNumber;
        const cls = i.alternate.interfaceClass;
        if (cls !== undefined && cls !== 7) {
          out.push({ interface: n, value: null, error: `not a printer class interface (class ${cls})` });
          continue;
        }
        try {
          if (!device.controlTransferIn) throw new Error('control transfers not supported');
          if (!this.claimed.has(n)) {
            await device.claimInterface(n);
            this.claimed.add(n);
          }
          const raw = await this.readDeviceIdRaw(n, i.alternate.alternateSetting ?? 0);
          out.push(raw === null ? { interface: n, value: null, error: 'no answer' } : { interface: n, value: stripSerialFields(raw) });
        } catch (e) {
          out.push({ interface: n, value: null, error: (e as Error).message });
        }
      }
      return out;
    });
  }

  /** Last status reply per engine (raw bytes and decoded message). */
  lastStatuses(): Partial<Record<PrintTarget, StatusSnapshot>> {
    return { ...this.statusLog };
  }

  async print(raster: DesignRaster, options: PrintOptions = {}): Promise<void> {
    const target = raster.media.target;
    const bytes = buildJob(raster, options, {
      tapeType: this.opts.tapeType,
      dither: this.opts.dither,
      calibration: this.activeCalibration(),
    });
    await this.serialize(async () => {
      const status = await this.readStatus(target);
      if (!status.ready) throw new Error(`Printer not ready (${target}): ${status.message}`);
      const io = await this.engine(target);
      const device = this.requireDevice();
      for (let o = 0; o < bytes.length; o += this.opts.chunkSize) {
        const chunk = bytes.subarray(o, Math.min(o + this.opts.chunkSize, bytes.length));
        const r = await device.transferOut(io.outEp, asBufferSource(chunk));
        if (r.status && r.status !== 'ok') throw new Error(`transferOut ${r.status} at byte ${o}`);
        if (r.bytesWritten !== chunk.length) throw new Error(`short write at byte ${o}: ${r.bytesWritten}/${chunk.length}`);
      }
    });
  }

  // --- internals ---------------------------------------------------------------------------

  private async attach(device: UsbDeviceLike): Promise<void> {
    if (this.device && this.device !== device) await this.disconnect();
    if (!device.opened) await device.open();
    if (!device.configuration) await device.selectConfiguration(1);
    this.device = device;
    this.claimed.clear();
  }

  private requireDevice(): UsbDeviceLike {
    if (!this.device) throw new Error('Not connected');
    return this.device;
  }

  /** Run USB work strictly one at a time: a status poll must never interleave with a job. */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async engine(target: PrintTarget): Promise<EngineIo> {
    const device = this.requireDevice();
    const n = ENGINE_INTERFACE[target];
    const iface = device.configuration?.interfaces.find((i) => i.interfaceNumber === n);
    if (!iface) throw new Error(`Interface ${n} (${target}) not found. Is this a LabelWriter DUO?`);
    const eps = iface.alternate.endpoints;
    const out = eps.find((e) => e.direction === 'out' && e.type === 'bulk');
    const inn = eps.find((e) => e.direction === 'in' && e.type === 'bulk');
    if (!out || !inn) throw new Error(`Interface ${n} has no bulk IN/OUT pair`);
    if (!this.claimed.has(n)) {
      await device.claimInterface(n);
      this.claimed.add(n);
    }
    return { iface: n, outEp: out.endpointNumber, inEp: inn.endpointNumber, inPacketSize: inn.packetSize };
  }

  private async readDeviceIdRaw(iface: number, alternate = 0): Promise<string | null> {
    const device = this.requireDevice();
    const r = await device.controlTransferIn!(
      { requestType: 'class', recipient: 'interface', request: 0, value: 0, index: (iface << 8) | alternate },
      1023,
    );
    if (r.status !== 'ok' || !r.data) return null;
    const u8 = new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
    const len = Math.min((u8[0] << 8) | u8[1], u8.length);
    return new TextDecoder().decode(u8.subarray(2, len));
  }

  private async readStatus(target: PrintTarget): Promise<PrinterStatus> {
    const status = await this.queryStatus(target);
    this.statusLog[target] = {
      raw: status.raw ? Array.from(status.raw) : [],
      ready: status.ready ?? false,
      message: status.message ?? '',
      at: new Date().toISOString(),
    };
    return status;
  }

  private async queryStatus(target: PrintTarget): Promise<PrinterStatus> {
    try {
      const io = await this.engine(target);
      const device = this.requireDevice();
      await device.transferOut(io.outEp, asBufferSource(cmdStatus()));
      const r = await withTimeout(device.transferIn(io.inEp, io.inPacketSize), this.opts.statusTimeoutMs, 'status reply');
      const raw = r.data ? new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength).slice() : new Uint8Array();
      if (raw.length === 0) return { connected: true, ready: false, raw, message: 'Empty status reply' };
      return target === 'label' ? labelStatus(raw) : tapeStatus(raw);
    } catch (e) {
      return { connected: this.isConnected(), ready: false, message: (e as Error).message };
    }
  }
}

/** Rasterize and encode a job. Exported so the editor can preview byte counts without a device. */
export function buildJob(
  raster: DesignRaster,
  options: PrintOptions = {},
  extra: { tapeType?: number; dither?: DitherMode; calibration?: Calibration } = {},
): Uint8Array {
  const bitmap = rasterize(raster, { lengthMm: options.lengthMm, dither: extra.dither, calibration: extra.calibration });
  const { media } = raster;
  if (media.target === 'label') {
    return buildLabelJob(bitmap, {
      labelLengthDots: media.lengthMm === null ? null : mmToDots(media.lengthMm, media.dpi),
      copies: options.copies,
      density: options.density,
    });
  }
  return buildTapeJob(bitmap, { copies: options.copies, tapeType: extra.tapeType });
}

export function labelStatus(raw: Uint8Array): PrinterStatus {
  const s = decodeLabelStatus(raw[0]);
  const problem = s.paperOut ? 'Out of labels' : s.paperJam ? 'Paper jam' : s.error ? 'Printer error' : null;
  return {
    connected: true,
    ready: s.ready && !problem,
    paperOut: s.paperOut,
    raw,
    message: problem ?? (s.topOfForm ? 'Ready' : 'Ready (not at top of form)'),
  };
}

export function tapeStatus(raw: Uint8Array): PrinterStatus {
  const s = decodeTapeStatus(raw[0]);
  const problem = !s.cassettePresent
    ? 'No tape cassette'
    : s.generalError
      ? 'General error (motor stalled or tape jammed)'
      : s.cutterJam
        ? 'Cutter jammed'
        : s.headOverheat
          ? 'Print head overheated'
          : s.busy
            ? 'Busy'
            : null;
  return { connected: true, ready: !problem, paperOut: !s.cassettePresent, raw, message: problem ?? 'Ready' };
}

/** TS 5.7+ types Uint8Array over ArrayBufferLike; ours are always plain ArrayBuffer backed. */
const asBufferSource = (u8: Uint8Array): BufferSource => u8 as unknown as BufferSource;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<T>((_, rej) => {
      t = setTimeout(() => rej(new Error(`${what}: no answer within ${ms} ms`)), ms);
    }),
  ]);
}
