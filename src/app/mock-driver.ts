// Simulated printer: implements the driver contract and shows the raster instead of printing.
import type { DesignRaster, PrintOptions, PrintTarget, PrinterDriver, PrinterStatus } from '../printer/types';
import { showPreview } from './preview';

export class MockDriver implements PrinterDriver {
  readonly simulated = true;
  private connected = false;

  async connect(): Promise<void> { this.connected = true; }
  async reconnect(): Promise<boolean> { return false; }
  async disconnect(): Promise<void> { this.connected = false; }
  isConnected(): boolean { return this.connected; }

  async getStatus(target: PrintTarget): Promise<PrinterStatus> {
    return { connected: this.connected, ready: this.connected, message: `Simulation (${target === 'tape' ? 'Band' : 'Etikett'})` };
  }

  async print(raster: DesignRaster, options: PrintOptions = {}): Promise<void> {
    if (!this.connected) throw new Error('Drucker ist nicht verbunden.');
    const { image, media } = raster;
    if (image.width < 1 || image.height < 1) throw new Error('Leeres Druckbild.');
    console.info('[MockDriver] print', { media: media.id, w: image.width, h: image.height, ...options });
    await showPreview(raster, {
      title: 'Simulierter Druck',
      copies: options.copies ?? 1,
      note: `Kein Drucker angeschlossen (Simulation).${options.lengthMm ? ` Bandlänge ${options.lengthMm.toFixed(1).replace('.', ',')} mm.` : ''}`,
    });
  }
}
