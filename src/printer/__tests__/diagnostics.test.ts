import { describe, expect, test } from 'bun:test';
import {
  MAX_ISSUE_URL_LENGTH,
  buildReport,
  githubIssueUrl,
  reportFileName,
  reportMarkdown,
  reportTitle,
  stripSerialFields,
  type ReportInput,
} from '../diagnostics';
import { DEFAULT_CALIBRATION } from '../calibration';
import { findMedia } from '../media';

const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  app: { version: '0.3.0', commit: 'abc1234', buildDate: '2026-11-11' },
  userAgent: 'Mozilla/5.0 Test',
  device: {
    vendorId: 0x0922,
    productId: 0x001d,
    productName: 'LabelWriter DUO',
    manufacturerName: 'DYMO',
    usbVersion: '2.0',
    deviceVersion: '1.0.0',
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
    configurationValue: 1,
    interfaces: [
      { number: 0, alternateSetting: 0, interfaceClass: 7, interfaceSubclass: 1, interfaceProtocol: 2, name: null,
        endpoints: [{ number: 1, direction: 'out', type: 'bulk', packetSize: 16 }, { number: 1, direction: 'in', type: 'bulk', packetSize: 16 }] },
    ],
  },
  deviceIds: [{ interface: 0, value: 'MFG:DYMO;CMD:;MDL:LabelWriter DUO Label;SERN:12345678;CLS:PRINTER;' }],
  lastStatus: { label: { raw: [0x03], ready: true, message: 'Ready', at: '2026-11-11T10:00:00.000Z' } },
  calibration: { deviceKey: '0922:001d', stored: false, savedAt: null, values: DEFAULT_CALIBRATION },
  media: findMedia('lw-99012')!,
  note: '  Prints fine.  ',
  now: new Date('2026-11-11T12:00:00Z'),
  ...over,
});

describe('stripSerialFields', () => {
  test('removes SERN and SN fields, keeps the rest', () => {
    expect(stripSerialFields('MFG:DYMO;SERN:123;MDL:X;')).toBe('MFG:DYMO;MDL:X;');
    expect(stripSerialFields('MFG:A;SN:9;CLS:PRINTER')).toBe('MFG:A;CLS:PRINTER');
    expect(stripSerialFields('MFG:A;MDL:B')).toBe('MFG:A;MDL:B');
  });
});

describe('buildReport', () => {
  test('hex ids, no serial anywhere, trimmed note, media summary', () => {
    const r = buildReport(input());
    expect(r.device!.vendorId).toBe('0x0922');
    expect(r.device!.productId).toBe('0x001d');
    expect(r.deviceIds[0].value).not.toContain('SERN');
    expect(JSON.stringify(r)).not.toContain('12345678');
    expect(JSON.stringify(r).toLowerCase()).not.toContain('serialnumber');
    expect(r.lastStatus.label!.raw).toBe('0x03');
    expect(r.note).toBe('Prints fine.');
    expect(r.media!.id).toBe('lw-99012');
    expect(r.calibration.source).toBe('default');
    expect(reportTitle(r)).toBe('Printer report: LabelWriter DUO (0922:001d)');
    expect(reportFileName(r)).toBe('second-label-printer-0922-001d-2026-11-11.json');
  });

  test('works without a device', () => {
    const r = buildReport(input({ device: null, deviceIds: [], lastStatus: {} }));
    expect(reportTitle(r)).toContain('no device');
    expect(reportMarkdown(r)).toContain('No device connected');
  });
});

describe('github issue link', () => {
  test('short report: complete body with JSON in a prefilled URL', () => {
    const r = buildReport(input());
    const link = githubIssueUrl(r);
    expect(link.complete).toBe(true);
    expect(link.url.startsWith('https://github.com/raydiy/second-label/issues/new?')).toBe(true);
    const params = new URL(link.url).searchParams;
    expect(params.get('title')).toBe(reportTitle(r));
    expect(params.get('body')).toContain('```json');
    expect(params.get('body')).toContain('## Calibration');
    expect(link.url.length).toBeLessThanOrEqual(MAX_ISSUE_URL_LENGTH);
  });

  test('long report: drops the JSON and stays under the limit', () => {
    const r = buildReport(input({ note: 'x'.repeat(9000) }));
    const link = githubIssueUrl(r);
    expect(link.complete).toBe(false);
    expect(link.url.length).toBeLessThanOrEqual(MAX_ISSUE_URL_LENGTH);
    expect(new URL(link.url).searchParams.get('body')).not.toContain('```json');
  });
});
