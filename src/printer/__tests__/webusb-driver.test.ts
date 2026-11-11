import { describe, expect, test } from 'bun:test';
import { WebUsbPrinterDriver, buildJob, type UsbDeviceLike, type UsbLike } from '../webusb-driver';
import { findMedia } from '../media';
import { mmToDots } from '../raster';
import { DEFAULT_CALIBRATION, cloneCalibration } from '../calibration';
import type { Calibration } from '../types';
import { NEUTRAL_CALIBRATION, UNSUPPORTED_MESSAGE } from '../devices';

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

describe('WebUsbPrinterDriver: calibration and diagnostics', () => {
  const inkRun = (img: ImageData) => {
    const y = img.height - 30;
    for (let x = 100; x < 300; x++) {
      const p = (y * img.width + x) * 4;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = 0;
    }
  };
  const labelJob = async (calibrationFor?: (k: string) => Calibration | null) => {
    const dev = new FakeDuo();
    const usb: UsbLike = { requestDevice: async () => dev, getDevices: async () => [dev] };
    const driver = new WebUsbPrinterDriver({ usb, chunkSize: 1 << 20, calibrationFor });
    await driver.connect();
    const media = findMedia('lw-99012')!;
    const img = blankImage(mmToDots(89, 300), mmToDots(36, 300));
    inkRun(img); // a black run along the bottom design row
    await driver.print({ image: img, media });
    return { driver, bytes: dev.writes.slice(1).flatMap((w) => Array.from(w.data)) };
  };

  test('without a stored calibration the job is byte-identical to buildJob with defaults', async () => {
    const { driver, bytes } = await labelJob();
    expect(driver.deviceKey()).toBe('0922:001d');
    expect(driver.activeCalibration()).toBe(DEFAULT_CALIBRATION);
    const media = findMedia('lw-99012')!;
    const img = blankImage(mmToDots(89, 300), mmToDots(36, 300));
    inkRun(img);
    expect(bytes).toEqual(Array.from(buildJob({ image: img, media })));
  });

  test('the stored calibration of this device key is used on every print', async () => {
    const keys: string[] = [];
    const shifted = cloneCalibration(DEFAULT_CALIBRATION);
    shifted.label.feedStartDots = 0;
    const { bytes: a } = await labelJob();
    const { bytes: b } = await labelJob((k) => { keys.push(k); return shifted; });
    expect(keys).toEqual(['0922:001d']);
    expect(b).not.toEqual(a);
  });

  test('describeDevice omits the serial, readDeviceIds strips SERN, last status is kept', async () => {
    const dev = new FakeDuo() as FakeDuo & { serialNumber: string; controlTransferIn: UsbDeviceLike['controlTransferIn'] };
    dev.serialNumber = 'SECRET123';
    const id = 'MFG:DYMO;MDL:LabelWriter DUO Label;SERN:SECRET123;';
    dev.controlTransferIn = async (setup) => {
      const iface = setup.index >> 8;
      const text = new TextEncoder().encode(iface === 0 ? id : 'MFG:DYMO;MDL:Tape;');
      const buf = new Uint8Array(text.length + 2);
      buf[0] = (buf.length >> 8) & 0xff;
      buf[1] = buf.length & 0xff;
      buf.set(text, 2);
      return { status: 'ok', data: new DataView(buf.buffer) };
    };
    const usb: UsbLike = { requestDevice: async () => dev, getDevices: async () => [dev] };
    const driver = new WebUsbPrinterDriver({ usb });
    expect(driver.describeDevice()).toBeNull();
    await driver.connect();
    const d = driver.describeDevice()!;
    expect(JSON.stringify(d)).not.toContain('SECRET');
    expect(d.interfaces.map((i) => i.endpoints.length)).toEqual([2, 2]);
    const ids = await driver.readDeviceIds();
    expect(ids).toEqual([
      { interface: 0, value: 'MFG:DYMO;MDL:LabelWriter DUO Label;' },
      { interface: 1, value: 'MFG:DYMO;MDL:Tape;' },
    ]);
    expect(await driver.getDeviceId('label')).toBe(id); // raw accessor unchanged
    await driver.getStatus('tape');
    expect(driver.lastStatuses().tape).toMatchObject({ raw: [0xc0], ready: true, message: 'Ready' });
    expect(driver.lastStatuses().label).toBeUndefined();
  });
});

describe('WebUsbPrinterDriver: device table', () => {
  /** Fake single-interface model (450 family) or unknown PID, built from the DUO fake. */
  const fake = (productId: number, interfaces: 1 | 2 = 1) => {
    const dev = new FakeDuo();
    dev.productId = productId;
    dev.productName = 'Test printer';
    if (interfaces === 1) dev.configuration.interfaces = dev.configuration.interfaces.slice(0, 1);
    const usb: UsbLike = { requestDevice: async () => dev, getDevices: async () => [dev] };
    return { dev, driver: new WebUsbPrinterDriver({ usb, calibrationFor: () => null }) };
  };

  test('label-only 450: label status and print on interface 0, tape refused without USB traffic', async () => {
    const { dev, driver } = fake(0x0020);
    await driver.connect();
    expect(driver.deviceSpec()?.name).toBe('LabelWriter 450');
    expect(driver.activeCalibration()).toBe(NEUTRAL_CALIBRATION);
    expect((await driver.getStatus('label')).ready).toBe(true);
    const tape = await driver.getStatus('tape');
    expect(tape).toMatchObject({ connected: true, ready: false });
    expect(tape.message).toContain('kein Banddruckwerk');
    expect(dev.writes.length).toBe(1); // only the label status request
    const t = findMedia('d1-12mm')!;
    await expect(driver.print({ image: blankImage(100, mmToDots(12, 180)), media: t })).rejects.toThrow('kein Banddruckwerk');
    const m = findMedia('lw-99010')!;
    await driver.print({ image: blankImage(10, 10), media: m });
    expect(dev.writes.every((w) => w.ep === 1)).toBe(true);
    expect([...dev.claimedIfaces]).toEqual([0]);
  });

  test('unknown PID: connects, describes and reads IDs, but sends nothing and refuses to print', async () => {
    const { dev, driver } = fake(0x0028);
    (dev as FakeDuo & { controlTransferIn: UsbDeviceLike['controlTransferIn'] }).controlTransferIn = async () => {
      const text = new TextEncoder().encode('MFG:DYMO;MDL:LabelWriter 550;');
      const buf = new Uint8Array(text.length + 2);
      buf[1] = buf.length;
      buf.set(text, 2);
      return { status: 'ok', data: new DataView(buf.buffer) };
    };
    await driver.connect();
    expect(driver.isConnected()).toBe(true);
    expect(driver.deviceSpec()).toBeNull();
    expect(driver.deviceKey()).toBe('0922:0028');
    expect(driver.describeDevice()!.productId).toBe(0x0028);
    expect(await driver.readDeviceIds()).toEqual([{ interface: 0, value: 'MFG:DYMO;MDL:LabelWriter 550;' }]);
    expect((await driver.getStatus('label')).message).toBe(UNSUPPORTED_MESSAGE);
    await expect(driver.print({ image: blankImage(10, 10), media: findMedia('lw-99010')! })).rejects.toThrow(UNSUPPORTED_MESSAGE);
    expect(dev.writes.length).toBe(0);
    expect(driver.activeCalibration()).toBe(NEUTRAL_CALIBRATION);
  });

  test('without a connection the reference calibration is reported', () => {
    expect(fake(0x0020).driver.activeCalibration()).toBe(DEFAULT_CALIBRATION);
  });

  test('reconnect prefers a model from the table over an unknown one', async () => {
    const unknown = fake(0x0028).dev;
    const known = fake(0x0023, 2).dev;
    const usb: UsbLike = { requestDevice: async () => unknown, getDevices: async () => [unknown, known] };
    const driver = new WebUsbPrinterDriver({ usb });
    expect(await driver.reconnect()).toBe(true);
    expect(driver.deviceSpec()?.productId).toBe(0x0023);
  });
});
