// Simulated printer: implements the driver contract and shows the raster instead of printing.
// Also simulates the calibration and diagnostic surface (device key 0000:0000).
import type { Calibration, DesignRaster, PrintOptions, PrintTarget, PrinterDriver, PrinterStatus } from '../printer/types';
import { DEFAULT_CALIBRATION, deviceKey, loadCalibration } from '../printer/calibration';
import type { DeviceIdEntry, DiagnosticDriver, StatusSnapshot, UsbDeviceSummary } from '../printer/diagnostics';
import { showPreview } from './preview';

const MOCK_VENDOR_ID = 0x0000;
const MOCK_PRODUCT_ID = 0x0000;

export class MockDriver implements PrinterDriver, DiagnosticDriver {
  readonly simulated = true;
  private connected = false;
  private statusLog: Partial<Record<PrintTarget, StatusSnapshot>> = {};

  async connect(): Promise<void> { this.connected = true; }
  async reconnect(): Promise<boolean> { return false; }
  async disconnect(): Promise<void> { this.connected = false; }
  isConnected(): boolean { return this.connected; }

  async getStatus(target: PrintTarget): Promise<PrinterStatus> {
    const status = { connected: this.connected, ready: this.connected, message: `Simulation (${target === 'tape' ? 'Band' : 'Etikett'})` };
    if (this.connected) {
      this.statusLog[target] = { raw: [target === 'tape' ? 0xc0 : 0x03], ready: true, message: status.message, at: new Date().toISOString() };
    }
    return status;
  }

  deviceKey(): string | null {
    return this.connected ? deviceKey(MOCK_VENDOR_ID, MOCK_PRODUCT_ID) : null;
  }

  activeCalibration(): Calibration {
    const key = this.deviceKey();
    return (key && loadCalibration(key)?.calibration) || DEFAULT_CALIBRATION;
  }

  describeDevice(): UsbDeviceSummary | null {
    if (!this.connected) return null;
    const ep = (number: number, direction: 'in' | 'out', packetSize: number) => ({ number, direction, type: 'bulk', packetSize });
    return {
      vendorId: MOCK_VENDOR_ID,
      productId: MOCK_PRODUCT_ID,
      productName: 'Simulierter Drucker',
      manufacturerName: 'Second Label',
      usbVersion: '2.0',
      deviceVersion: '0.0.0',
      deviceClass: 0,
      deviceSubclass: 0,
      deviceProtocol: 0,
      configurationValue: 1,
      interfaces: [
        { number: 0, alternateSetting: 0, interfaceClass: 7, interfaceSubclass: 1, interfaceProtocol: 2, name: 'Simulation Label', endpoints: [ep(1, 'in', 16), ep(1, 'out', 16)] },
        { number: 1, alternateSetting: 0, interfaceClass: 7, interfaceSubclass: 1, interfaceProtocol: 2, name: 'Simulation Tape', endpoints: [ep(2, 'in', 64), ep(2, 'out', 64)] },
      ],
    };
  }

  async readDeviceIds(): Promise<DeviceIdEntry[]> {
    if (!this.connected) throw new Error('Drucker ist nicht verbunden.');
    return [
      { interface: 0, value: 'MFG:Second Label;MDL:Simulation Label;CLS:PRINTER;' },
      { interface: 1, value: 'MFG:Second Label;MDL:Simulation Tape;CLS:PRINTER;' },
    ];
  }

  lastStatuses(): Partial<Record<PrintTarget, StatusSnapshot>> {
    return { ...this.statusLog };
  }

  async print(raster: DesignRaster, options: PrintOptions = {}): Promise<void> {
    if (!this.connected) throw new Error('Drucker ist nicht verbunden.');
    const { image, media } = raster;
    if (image.width < 1 || image.height < 1) throw new Error('Leeres Druckbild.');
    await this.getStatus(media.target);
    console.info('[MockDriver] print', { media: media.id, w: image.width, h: image.height, ...options, calibration: this.activeCalibration() });
    await showPreview(raster, {
      title: 'Simulierter Druck',
      copies: options.copies ?? 1,
      note: `Kein Drucker angeschlossen (Simulation).${options.lengthMm ? ` Bandlänge ${options.lengthMm.toFixed(1).replace('.', ',')} mm.` : ''}`,
    });
  }
}
