// Swap point between the simulated backend and the real WebUSB driver.
// Append ?mock to the URL (e.g. http://localhost:5173/?mock) to use the MockDriver: no
// hardware needed, "Drucken" shows the print image, calibration and diagnostics use a
// simulated device. The real media catalogue is used in both modes.
// For the old placeholder media list use: export { MEDIA } from './media-fallback';
import { WebUsbPrinterDriver } from '../printer/webusb-driver';
import { MockDriver } from './mock-driver';

export { MEDIA } from '../printer/media';

const useMock = (() => {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').has('mock');
  } catch {
    return false;
  }
})();

export const Driver: typeof WebUsbPrinterDriver | typeof MockDriver = useMock ? MockDriver : WebUsbPrinterDriver;
