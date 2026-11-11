// Simulated printer: implements the driver contract and shows the raster instead of printing.
// Also simulates the calibration and diagnostic surface.
//
// Dev only: `?mock` simulates the DUO 0x001D (device key 0000:0000, as before). `?mock=0020`
// simulates the model with that product id (hex) from the device table, or an unknown model
// when the id has no entry, so the experimental, label-only and unsupported paths can be
// checked without hardware. Simulated keys use vendor 0000 so they never share stored
// calibration with a real printer.
import type { Calibration, DesignRaster, PrintOptions, PrintTarget, PrinterDriver, PrinterStatus } from '../printer/types';
import { deviceKey, loadCalibration } from '../printer/calibration';
import type { DeviceIdEntry, DiagnosticDriver, StatusSnapshot, UsbDeviceSummary } from '../printer/diagnostics';
import { DUO_128, DYMO_VENDOR_ID, NEUTRAL_CALIBRATION, deviceTargets, findDevice, printBlockReason, type DeviceSpec } from '../printer/devices';
import { showPreview } from './preview';

const MOCK_VENDOR_ID = 0x0000;

/** Product id requested via ?mock=<hex>, or null for plain ?mock. */
export function mockProductId(search: string = globalThis.location?.search ?? ''): number | null {
  const v = new URLSearchParams(search).get('mock');
  if (!v) return null;
  const n = parseInt(v.replace(/^0x/i, ''), 16);
  return Number.isInteger(n) && n >= 0 && n <= 0xffff ? n : null;
}

export class MockDriver implements PrinterDriver, DiagnosticDriver {
  readonly simulated = true;
  private connected = false;
  private statusLog: Partial<Record<PrintTarget, StatusSnapshot>> = {};
  /** Simulated product id; null = plain ?mock (DUO behaviour, key 0000:0000). */
  private readonly pid: number | null;
  private readonly spec: DeviceSpec | null;

  constructor(productId: number | null = mockProductId()) {
    this.pid = productId;
    this.spec = productId === null ? DUO_128 : findDevice(DYMO_VENDOR_ID, productId);
  }

  async connect(): Promise<void> { this.connected = true; }
  async reconnect(): Promise<boolean> { return false; }
  async disconnect(): Promise<void> { this.connected = false; }
  isConnected(): boolean { return this.connected; }

  async getStatus(target: PrintTarget): Promise<PrinterStatus> {
    const blocked = this.connected ? printBlockReason(this.spec, target) : null;
    if (blocked) return { connected: true, ready: false, message: blocked };
    const status = { connected: this.connected, ready: this.connected, message: `Simulation (${target === 'tape' ? 'Band' : 'Etikett'})` };
    if (this.connected) {
      this.statusLog[target] = { raw: [target === 'tape' ? 0xc0 : 0x03], ready: true, message: status.message, at: new Date().toISOString() };
    }
    return status;
  }

  deviceKey(): string | null {
    return this.connected ? deviceKey(MOCK_VENDOR_ID, this.pid ?? 0) : null;
  }

  deviceSpec(): DeviceSpec | null {
    return this.connected ? this.spec : null;
  }

  activeCalibration(): Calibration {
    const key = this.deviceKey();
    const stored = key ? loadCalibration(key)?.calibration : null;
    if (stored) return stored;
    if (!this.connected) return DUO_128.calibration;
    return this.spec?.calibration ?? NEUTRAL_CALIBRATION;
  }

  describeDevice(): UsbDeviceSummary | null {
    if (!this.connected) return null;
    const ep = (number: number, direction: 'in' | 'out', packetSize: number) => ({ number, direction, type: 'bulk', packetSize });
    const targets = this.spec ? deviceTargets(this.spec) : (['label'] as PrintTarget[]);
    const iface = (t: PrintTarget) => {
      const n = this.spec?.engines[t]?.interfaceNumber ?? 0;
      const size = t === 'label' ? 16 : 64;
      return { number: n, alternateSetting: 0, interfaceClass: 7, interfaceSubclass: 1, interfaceProtocol: 2, name: `Simulation ${t === 'label' ? 'Label' : 'Tape'}`, endpoints: [ep(n + 1, 'in', size), ep(n + 1, 'out', size)] };
    };
    return {
      vendorId: this.pid === null ? MOCK_VENDOR_ID : DYMO_VENDOR_ID,
      productId: this.pid ?? 0,
      productName: `Simulierter Drucker${this.spec ? ` (${this.spec.name})` : ' (unbekanntes Modell)'}`,
      manufacturerName: 'Second Label',
      usbVersion: '2.0',
      deviceVersion: '0.0.0',
      deviceClass: 0,
      deviceSubclass: 0,
      deviceProtocol: 0,
      configurationValue: 1,
      interfaces: targets.map(iface),
    };
  }

  async readDeviceIds(): Promise<DeviceIdEntry[]> {
    if (!this.connected) throw new Error('Drucker ist nicht verbunden.');
    return (this.describeDevice()?.interfaces ?? []).map((i) => ({
      interface: i.number,
      value: `MFG:Second Label;MDL:${i.name};CLS:PRINTER;`,
    }));
  }

  lastStatuses(): Partial<Record<PrintTarget, StatusSnapshot>> {
    return { ...this.statusLog };
  }

  async print(raster: DesignRaster, options: PrintOptions = {}): Promise<void> {
    if (!this.connected) throw new Error('Drucker ist nicht verbunden.');
    const { image, media } = raster;
    if (image.width < 1 || image.height < 1) throw new Error('Leeres Druckbild.');
    const blocked = printBlockReason(this.spec, media.target);
    if (blocked) throw new Error(blocked);
    await this.getStatus(media.target);
    console.info('[MockDriver] print', { media: media.id, w: image.width, h: image.height, ...options, calibration: this.activeCalibration() });
    await showPreview(raster, {
      title: 'Simulierter Druck',
      copies: options.copies ?? 1,
      note: `Kein Drucker angeschlossen (Simulation).${options.lengthMm ? ` Bandlänge ${options.lengthMm.toFixed(1).replace('.', ',')} mm.` : ''}`,
    });
  }
}
