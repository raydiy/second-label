// Read-only probe for the DYMO LabelWriter DUO (VID 0x0922).
//
// What it does:
//   1. Finds the device, prints device/configuration/interface/endpoint descriptors.
//   2. Reads the IEEE 1284 Device ID of every printer-class interface
//      (USB Printer Class GET_DEVICE_ID control request). This is the strongest
//      evidence of which interface is the label engine and which the tape engine.
//   3. Claims each interface, sends ESC A (status request) and reads the reply.
//      Optionally sends ESC @ first on the label engine (--reset), which the
//      LabelWriter manual documents as a parameter reset with no paper motion.
//   4. Releases every interface and closes the device.
//
// What it NEVER does: send SYN/ETB raster data, ESC E (form feed / cut), ESC G,
// ESC f, or any other command that moves media. Running it consumes no labels.
//
// Usage: node probe.mjs [--reset] [--version]
//   --version  also sends ESC V to the label engine (returns model/firmware string)

import { usb } from 'usb';

const VID = 0x0922;
const ESC = 0x1b;
const args = new Set(process.argv.slice(2));

const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join(' ');
const bin = (b) => b.toString(2).padStart(8, '0');

function decodeLabelStatus(b) {
  // LabelWriter 450 Series Technical Reference, p. 17 (ESC A).
  return {
    ready: !!(b & 0x01),
    topOfForm: !!(b & 0x02),
    noPaper: !!(b & 0x20),
    paperJam: !!(b & 0x40),
    error: !!(b & 0x80),
  };
}

function decodeTapeStatus(b) {
  // Bit names from dymo-cups-drivers LabelManagerLanguageMonitor.h.
  return {
    cassetteSizeBits: b & 0x03,
    generalError: !!(b & 0x04),
    headOverheat: !!(b & 0x08),
    slotStatus_or_cutterJam: !!(b & 0x10),
    busy: !!(b & 0x20),
    cassettePresent: !!(b & 0x40),
    bit7_autoCutter_or_noPower: !!(b & 0x80),
  };
}

async function getDeviceId(device, ifaceNum, alt) {
  // USB Printer Class 1.1, GET_DEVICE_ID: bmRequestType 0xA1, bRequest 0,
  // wValue = config index (0-based), wIndex = (interface << 8) | altsetting.
  // First two bytes are a big-endian length that includes themselves.
  try {
    const r = await device.controlTransferIn(
      { requestType: 'class', recipient: 'interface', request: 0, value: 0, index: (ifaceNum << 8) | alt },
      1023,
    );
    if (r.status !== 'ok' || !r.data) return `(status ${r.status})`;
    const u8 = new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
    const len = (u8[0] << 8) | u8[1];
    return new TextDecoder().decode(u8.subarray(2, Math.min(len, u8.length)));
  } catch (e) {
    return `(error: ${e.message})`;
  }
}

async function query(device, outEp, inEp, cmd, readLen = 64, timeoutMs = 2000) {
  await device.transferOut(outEp, new Uint8Array(cmd));
  const t = new Promise((_, rej) => setTimeout(() => rej(new Error(`no reply within ${timeoutMs} ms`)), timeoutMs));
  const r = await Promise.race([device.transferIn(inEp, readLen), t]);
  const u8 = r.data ? new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength) : new Uint8Array();
  return { status: r.status, data: u8 };
}

async function main() {
  const all = await usb.getDevices();
  const device = all.find((d) => d.vendorId === VID);
  if (!device) {
    console.error('No DYMO device (VID 0x0922) found.');
    process.exit(1);
  }

  console.log('== Device');
  console.log({
    productName: device.productName,
    manufacturerName: device.manufacturerName,
    serialNumber: device.serialNumber,
    vendorId: '0x' + device.vendorId.toString(16).padStart(4, '0'),
    productId: '0x' + device.productId.toString(16).padStart(4, '0'),
    deviceVersion: `${device.deviceVersionMajor}.${device.deviceVersionMinor}.${device.deviceVersionSubminor}`,
    usbVersion: `${device.usbVersionMajor}.${device.usbVersionMinor}`,
    deviceClass: device.deviceClass,
  });

  await device.open();
  if (!device.configuration) await device.selectConfiguration(1);
  const cfg = device.configuration;
  console.log(`\n== Configuration ${cfg.configurationValue}, ${cfg.interfaces.length} interface(s)`);

  const ifaces = [];
  for (const iface of cfg.interfaces) {
    const alt = iface.alternate;
    const eps = alt.endpoints.map((e) => ({
      number: e.endpointNumber,
      direction: e.direction,
      type: e.type,
      packetSize: e.packetSize,
      address: '0x' + ((e.direction === 'in' ? 0x80 : 0) | e.endpointNumber).toString(16).padStart(2, '0'),
    }));
    // GET_DEVICE_ID is an interface-recipient request: nusb (like Chromium) requires the claim first.
    let deviceId = '(not read)';
    try {
      await device.claimInterface(iface.interfaceNumber);
      deviceId = await getDeviceId(device, iface.interfaceNumber, alt.alternateSetting);
      await device.releaseInterface(iface.interfaceNumber);
    } catch (e) {
      deviceId = `(claim failed: ${e.message})`;
    }
    console.log(`\n-- Interface ${iface.interfaceNumber} alt ${alt.alternateSetting}: class ${alt.interfaceClass} sub ${alt.interfaceSubclass} proto ${alt.interfaceProtocol} name=${JSON.stringify(alt.interfaceName ?? null)}`);
    console.log('   endpoints:', JSON.stringify(eps));
    console.log('   IEEE 1284 Device ID:', deviceId);
    ifaces.push({ iface, eps, deviceId });
  }

  for (const { iface, eps, deviceId } of ifaces) {
    const n = iface.interfaceNumber;
    const outEp = eps.find((e) => e.direction === 'out' && e.type === 'bulk');
    const inEp = eps.find((e) => e.direction === 'in' && e.type === 'bulk');
    if (!outEp || !inEp) {
      console.log(`\n== Interface ${n}: no bulk in/out pair, skipped`);
      continue;
    }
    // Prefer the 1284 ID; fall back to the interface number (0 = label, 1 = tape) if it is unreadable.
    const isTape = /tape/i.test(deviceId) || (!/label/i.test(deviceId) && n === 1);
    console.log(`\n== Interface ${n} (${isTape ? 'TAPE' : 'LABEL'}): claim`);
    try {
      await device.claimInterface(n);
    } catch (e) {
      console.log(`   claimInterface(${n}) FAILED: ${e.message}`);
      continue;
    }
    try {
      if (args.has('--reset') && !isTape) {
        console.log('   -> ESC @ (reset, no paper motion)');
        await device.transferOut(outEp.number, new Uint8Array([ESC, 0x40]));
      }
      if (args.has('--version') && !isTape) {
        const v = await query(device, outEp.number, inEp.number, [ESC, 0x56]);
        console.log(`   ESC V -> [${v.data.length}] ${hex(v.data)}  ascii=${JSON.stringify(new TextDecoder().decode(v.data))}`);
      }
      for (let i = 0; i < 2; i++) {
        const s = await query(device, outEp.number, inEp.number, [ESC, 0x41]);
        console.log(`   ESC A #${i + 1} -> transfer=${s.status} [${s.data.length} byte(s)] ${hex(s.data)}`);
        if (s.data.length) {
          console.log(`      byte0 = 0b${bin(s.data[0])}`, isTape ? decodeTapeStatus(s.data[0]) : decodeLabelStatus(s.data[0]));
        }
      }
    } catch (e) {
      console.log(`   query FAILED: ${e.message}`);
    } finally {
      try {
        await device.releaseInterface(n);
        console.log(`   released interface ${n}`);
      } catch (e) {
        console.log(`   releaseInterface(${n}) FAILED: ${e.message}`);
      }
    }
  }

  await device.close();
  console.log('\n== closed');
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
