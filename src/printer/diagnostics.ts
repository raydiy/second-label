// Printer diagnostic report: what a user can send us so we can support a new model.
// Pure functions (no DOM, no USB), unit tested in __tests__/diagnostics.test.ts.
//
// Privacy: the USB serial number is never collected, and SERN:/SN: fields are removed from
// IEEE 1284 Device ID strings. Calibration is stored per vendorId:productId for the same reason.

import type { Calibration, Media, PrintTarget } from './types';

export const REPORT_FORMAT = 'second-label-printer-report';
export const REPORT_VERSION = 1;
export const ISSUE_URL = 'https://github.com/raydiy/second-label/issues/new';
/** Browsers and GitHub cope with longer URLs, but stay well below the common 8 KB limits. */
export const MAX_ISSUE_URL_LENGTH = 7000;

export interface UsbEndpointSummary {
  number: number;
  direction: 'in' | 'out';
  type: string;
  packetSize: number;
}

export interface UsbInterfaceSummary {
  number: number;
  alternateSetting: number;
  interfaceClass: number | null;
  interfaceSubclass: number | null;
  interfaceProtocol: number | null;
  name: string | null;
  endpoints: UsbEndpointSummary[];
}

export interface UsbDeviceSummary {
  vendorId: number;
  productId: number;
  productName: string | null;
  manufacturerName: string | null;
  usbVersion: string | null;
  deviceVersion: string | null;
  deviceClass: number | null;
  deviceSubclass: number | null;
  deviceProtocol: number | null;
  configurationValue: number | null;
  interfaces: UsbInterfaceSummary[];
}

export interface DeviceIdEntry {
  interface: number;
  value: string | null;
  error?: string;
}

export interface StatusSnapshot {
  raw: number[];
  ready: boolean;
  message: string;
  at: string;
}

/** Driver capabilities the diagnostic view and the calibration wizard rely on. */
export interface DiagnosticDriver {
  deviceKey(): string | null;
  activeCalibration(): Calibration;
  describeDevice(): UsbDeviceSummary | null;
  readDeviceIds(): Promise<DeviceIdEntry[]>;
  lastStatuses(): Partial<Record<PrintTarget, StatusSnapshot>>;
}

export interface PrinterReport {
  format: typeof REPORT_FORMAT;
  version: typeof REPORT_VERSION;
  createdAt: string;
  app: { version: string; commit: string; buildDate: string };
  userAgent: string;
  simulated: boolean;
  device: (Omit<UsbDeviceSummary, 'vendorId' | 'productId'> & { vendorId: string; productId: string }) | null;
  deviceIds: DeviceIdEntry[];
  lastStatus: Partial<Record<PrintTarget, { raw: string; ready: boolean; message: string; at: string }>>;
  calibration: { deviceKey: string | null; source: 'stored' | 'default'; savedAt: string | null; values: Calibration };
  media: { id: string; name: string; target: PrintTarget; widthMm: number; lengthMm: number | null; dpi: number } | null;
  note: string;
}

export const hex = (n: number, digits = 4) => `0x${(n >>> 0).toString(16).padStart(digits, '0')}`;
const hexBytes = (b: number[]) => b.map((v) => hex(v, 2)).join(' ');

/** Remove serial number fields (SERN:, SN:) from an IEEE 1284 Device ID string. */
export function stripSerialFields(id: string): string {
  return id
    .split(';')
    .filter((f) => !/^\s*(SERN|SN|SERIALNUMBER)\s*:/i.test(f))
    .join(';');
}

export interface ReportInput {
  app: { version: string; commit: string; buildDate: string };
  userAgent: string;
  simulated?: boolean;
  device: UsbDeviceSummary | null;
  deviceIds: DeviceIdEntry[];
  lastStatus: Partial<Record<PrintTarget, StatusSnapshot>>;
  calibration: { deviceKey: string | null; stored: boolean; savedAt: string | null; values: Calibration };
  media: Media | null;
  note?: string;
  now?: Date;
}

export function buildReport(i: ReportInput): PrinterReport {
  const lastStatus: PrinterReport['lastStatus'] = {};
  for (const [k, v] of Object.entries(i.lastStatus) as [PrintTarget, StatusSnapshot][]) {
    lastStatus[k] = { raw: hexBytes(v.raw), ready: v.ready, message: v.message, at: v.at };
  }
  return {
    format: REPORT_FORMAT,
    version: REPORT_VERSION,
    createdAt: (i.now ?? new Date()).toISOString(),
    app: i.app,
    userAgent: i.userAgent,
    simulated: !!i.simulated,
    device: i.device ? { ...i.device, vendorId: hex(i.device.vendorId), productId: hex(i.device.productId) } : null,
    deviceIds: i.deviceIds.map((d) => ({ ...d, value: d.value === null ? null : stripSerialFields(d.value) })),
    lastStatus,
    calibration: {
      deviceKey: i.calibration.deviceKey,
      source: i.calibration.stored ? 'stored' : 'default',
      savedAt: i.calibration.savedAt,
      values: i.calibration.values,
    },
    media: i.media
      ? { id: i.media.id, name: i.media.name, target: i.media.target, widthMm: i.media.widthMm, lengthMm: i.media.lengthMm, dpi: i.media.dpi }
      : null,
    note: (i.note ?? '').trim(),
  };
}

export function reportTitle(r: PrinterReport): string {
  if (!r.device) return 'Printer report: no device connected';
  return `Printer report: ${r.device.productName ?? 'unknown model'} (${r.device.vendorId.slice(2)}:${r.device.productId.slice(2)})`;
}

const cell = (v: unknown) => (v === null || v === undefined || v === '' ? '-' : String(v).replace(/\|/g, '\\|').replace(/\n/g, ' '));

/**
 * Markdown body matching .github/ISSUE_TEMPLATE/printer-report.md.
 * With includeJson the full report is appended as a JSON code block.
 */
export function reportMarkdown(r: PrinterReport, includeJson = true): string {
  const L: string[] = [];
  L.push('## Device', '');
  if (r.device) {
    const d = r.device;
    L.push('| Field | Value |', '|---|---|');
    L.push(`| Vendor ID | ${d.vendorId} |`, `| Product ID | ${d.productId} |`);
    L.push(`| Product name | ${cell(d.productName)} |`, `| Manufacturer | ${cell(d.manufacturerName)} |`);
    L.push(`| USB version | ${cell(d.usbVersion)} |`, `| Device version | ${cell(d.deviceVersion)} |`);
    L.push(`| Configuration | ${cell(d.configurationValue)} |`);
    L.push('', '### Interfaces', '');
    L.push('| # | Class | Name | Endpoints |', '|---|---|---|---|');
    for (const i of d.interfaces) {
      const cls = i.interfaceClass === null ? '-' : `${i.interfaceClass}/${i.interfaceSubclass ?? '-'}/${i.interfaceProtocol ?? '-'}`;
      const eps = i.endpoints.map((e) => `${e.direction.toUpperCase()} ${hex(e.number | (e.direction === 'in' ? 0x80 : 0), 2)} ${e.type} ${e.packetSize}`).join(', ');
      L.push(`| ${i.number} | ${cls} | ${cell(i.name)} | ${cell(eps)} |`);
    }
  } else {
    L.push(r.simulated ? '_Simulation, no real device._' : '_No device connected._');
  }
  L.push('', '### IEEE 1284 Device ID (serial removed)', '');
  if (r.deviceIds.length === 0) L.push('_Not read._');
  for (const d of r.deviceIds) L.push(`- Interface ${d.interface}: ${d.value !== null ? '`' + d.value + '`' : `not readable (${d.error ?? 'unknown'})`}`);
  L.push('', '## Status', '');
  const st = Object.entries(r.lastStatus);
  if (st.length === 0) L.push('_No status read yet._');
  for (const [k, v] of st) L.push(`- ${k}: \`${v.raw || '(empty)'}\` ${v.message}`);
  L.push('', '## Calibration', '');
  const c = r.calibration.values;
  L.push(`Source: ${r.calibration.source}${r.calibration.deviceKey ? ` (${r.calibration.deviceKey})` : ''}${r.calibration.savedAt ? `, saved ${r.calibration.savedAt}` : ''}`, '');
  L.push(`- Label: headOffsetDots ${c.label.headOffsetDots}, feedStartDots ${c.label.feedStartDots}, feedScale ${c.label.feedScale}`);
  L.push(`- Tape centre correction (dots per mm width): ${Object.entries(c.tape.centerCorrectionDots).map(([w, v]) => `${w}: ${v}`).join(', ')}`);
  L.push('', '## Media', '');
  L.push(r.media ? `${r.media.name} (\`${r.media.id}\`, ${r.media.target}, ${r.media.widthMm} x ${r.media.lengthMm ?? 'continuous'} mm, ${r.media.dpi} dpi)` : '-');
  L.push('', '## Environment', '');
  L.push(`- App: ${r.app.version} (${r.app.commit}, ${r.app.buildDate})`, `- Browser: ${r.userAgent}`);
  L.push('', '## Note', '', r.note || '_No note._');
  L.push('', '## What works / what does not', '', '<!-- Status query, label print, tape print, cut, alignment: please describe. -->');
  // Compact JSON: the whole body has to fit into a URL.
  if (includeJson) L.push('', '<details><summary>Full report (JSON)</summary>', '', '```json', JSON.stringify(r), '```', '', '</details>');
  else L.push('', '_The full JSON report is attached as a file._');
  return L.join('\n');
}

export interface IssueLink {
  url: string;
  /** False when the JSON block was dropped to keep the URL short; attach the file instead. */
  complete: boolean;
}

/** Prefilled "new issue" URL. Falls back to a body without the JSON block when too long. */
export function githubIssueUrl(r: PrinterReport, base = ISSUE_URL, maxLength = MAX_ISSUE_URL_LENGTH): IssueLink {
  const make = (body: string) =>
    `${base}?${new URLSearchParams({ template: 'printer-report.md', title: reportTitle(r), body }).toString()}`;
  const full = make(reportMarkdown(r, true));
  if (full.length <= maxLength) return { url: full, complete: true };
  let body = reportMarkdown(r, false);
  let url = make(body);
  // Very long notes or descriptor lists: shorten the body until it fits.
  while (url.length > maxLength && body.length > 200) {
    body = body.slice(0, Math.floor(body.length * 0.9)) + '\n\n_(truncated, see attached JSON)_';
    url = make(body);
  }
  return { url, complete: false };
}

export function reportFileName(r: PrinterReport): string {
  const id = r.device ? `${r.device.vendorId.slice(2)}-${r.device.productId.slice(2)}` : 'no-device';
  return `second-label-printer-${id}-${r.createdAt.slice(0, 10)}.json`;
}
