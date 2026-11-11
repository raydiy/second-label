import { describe, expect, test } from 'bun:test';
import { WebUsbPrinterDriver, type UsbDeviceLike, type UsbLike } from '../webusb-driver';
import { findMedia } from '../media';
import { mmToDots } from '../raster';

/** Fake DUO with the descriptor layout measured on the real unit (docs/protocol.md). */
class FakeDuo implements UsbDeviceLike {
  vendorId = 0x0922;
  productId = 0x001d;
  productName = 'DYMO LabelWriter DUO';
  opened = false;
  claimedIfaces = new Set<number>();
  writes: { ep: number; data: Uint8Array }[] = [];
  statusByte: Record<number, number> = { 1: 0x03, 2: 0xc0 };
  configuration = {
    configurationValue: 1,
    interfaces: [
      {
        interfaceNumber: 0,
        alternate: {
          endpoints: [
            { endpointNumber: 1, direction: 'in' as const, type: 'bulk' as const, packetSize: 16 },
            { endpointNumber: 1, direction: 'out' as const, type: 'bulk' as const, packetSize: 16 },
          ],
        },
      },
      {
        interfaceNumber: 1,
        alternate: {
          endpoints: [
            { endpointNumber: 2, direction: 'in' as const, type: 'bulk' as const, packetSize: 64 },
            { endpointNumber: 2, direction: 'out' as const, type: 'bulk' as const, packetSize: 64 },
          ],
        },
      },
    ],
  };
  async open() {
    this.opened = true;
  }
  async close() {
    this.opened = false;
  }
  async selectConfiguration() {}
  async claimInterface(n: number) {
    this.claimedIfaces.add(n);
  }
  async releaseInterface(n: number) {
    this.claimedIfaces.delete(n);
  }
  async transferOut(ep: number, data: BufferSource) {
    const u8 = data instanceof Uint8Array ? data.slice() : new Uint8Array(data as ArrayBuffer);
    this.writes.push({ ep, data: u8 });
    return { status: 'ok' as const, bytesWritten: u8.length };
  }
  async transferIn(ep: number, length: number) {
    expect(length).toBe(ep === 1 ? 16 : 64);
    return { status: 'ok' as const, data: new DataView(Uint8Array.of(this.statusByte[ep]).buffer) };
  }
}

function setup() {
  const dev = new FakeDuo();
  const usb: UsbLike = { requestDevice: async () => dev, getDevices: async () => [dev] };
  return { dev, driver: new WebUsbPrinterDriver({ usb, chunkSize: 1000 }) };
}

function blankImage(w: number, h: number) {
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) } as unknown as ImageData;
}

describe('WebUsbPrinterDriver', () => {
  test('connect / status per engine uses interface 0 for label and 1 for tape', async () => {
    const { dev, driver } = setup();
    expect(await driver.getStatus('label')).toEqual({ connected: false, message: 'Not connected' });
    await driver.connect();
    expect(driver.isConnected()).toBe(true);
    const label = await driver.getStatus('label');
    expect(label.ready).toBe(true);
    expect(label.message).toBe('Ready');
    const tape = await driver.getStatus('tape');
    expect(tape.ready).toBe(true);
    expect(Array.from(tape.raw!)).toEqual([0xc0]);
    expect([...dev.claimedIfaces].sort()).toEqual([0, 1]);
    expect(dev.writes.map((w) => w.ep)).toEqual([1, 2]);
    expect(Array.from(dev.writes[0].data)).toEqual([0x1b, 0x41]);
    await driver.disconnect();
    expect(dev.claimedIfaces.size).toBe(0);
    expect(dev.opened).toBe(false);
  });

  test('reconnect finds an already permitted device', async () => {
    const { driver } = setup();
    expect(await driver.reconnect()).toBe(true);
    expect(driver.isConnected()).toBe(true);
  });

  test('print on tape: status first, then chunked job on the tape endpoint ending with a cut', async () => {
    const { dev, driver } = setup();
    await driver.connect();
    const media = findMedia('d1-12mm')!;
    const img = blankImage(400, mmToDots(12, 180));
    await driver.print({ image: img, media });
    expect(Array.from(dev.writes[0].data)).toEqual([0x1b, 0x41]);
    const job = dev.writes.slice(1);
    expect(job.every((w) => w.ep === 2 && w.data.length <= 1000)).toBe(true);
    const all = job.flatMap((w) => Array.from(w.data));
    expect(all.slice(-2)).toEqual([0x1b, 0x45]);
  });

  test('print refuses when the label engine reports paper out', async () => {
    const { dev, driver } = setup();
    await driver.connect();
    dev.statusByte[1] = 0xa1;
    const media = findMedia('lw-99010')!;
    await expect(driver.print({ image: blankImage(10, 10), media })).rejects.toThrow('Out of labels');
    expect(dev.writes.length).toBe(1); // only the status request
  });
});
