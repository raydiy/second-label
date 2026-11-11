// Swap point between the simulated backend and the real WebUSB driver.
// For simulation without hardware use:
//   export { MEDIA } from './media-fallback';
//   export { MockDriver as Driver } from './mock-driver';
export { MEDIA } from '../printer/media';
export { WebUsbPrinterDriver as Driver } from '../printer/webusb-driver';
