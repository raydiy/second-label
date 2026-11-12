// Printer profile / diagnostics: collect what we need to support a printer, download it as JSON
// or open a prefilled GitHub issue. Report building is pure (src/printer/diagnostics.ts).
import type { Media, PrintTarget } from '../printer/types';
import { loadCalibration } from '../printer/calibration';
import { deviceTargets } from '../printer/devices';
import {
  buildReport,
  githubIssueUrl,
  hex,
  reportFileName,
  type DeviceIdEntry,
  type PrinterReport,
} from '../printer/diagnostics';
import { APP_BUILD_DATE, APP_COMMIT, APP_VERSION } from '../build-info';
import type { CalibrationDriver } from './calibration';
import { h, num, toast } from './dom';
import { t } from '../i18n';
import { statusText } from '../i18n/errors';
import { engineName, mediaName } from './media-text';

export interface DiagnosticsHost {
  driver: CalibrationDriver;
  media: Media;
  errorText(e: unknown): string;
}

function calSource(r: PrinterReport): string {
  const source = t(r.calibration.source === 'stored' ? 'diag.calStored' : 'diag.calDefaults');
  return r.calibration.deviceKey ? t('diag.calSourceFor', { source, key: r.calibration.deviceKey }) : source;
}

function download(report: PrinterReport) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = reportFileName(report);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function openDiagnostics(host: DiagnosticsHost): Promise<void> {
  const { driver } = host;
  let deviceIds: DeviceIdEntry[] = [];
  let readError: string | null = null;

  const dlg = h('dialog', { class: 'diag-dialog', 'aria-label': t('diag.title') });
  const content = h('div', { class: 'diag-content' });
  const note = h('textarea', {
    rows: 3,
    'aria-label': t('diag.note'),
    placeholder: t('diag.notePlaceholder'),
  });
  const notice = h('p', { class: 'diag-notice', role: 'status', hidden: true });
  const raw = h('pre', { class: 'diag-json' });

  const report = (): PrinterReport => {
    const key = driver.deviceKey();
    const stored = key ? loadCalibration(key) : null;
    return buildReport({
      app: { version: APP_VERSION, commit: APP_COMMIT, buildDate: APP_BUILD_DATE },
      userAgent: navigator.userAgent,
      simulated: !!driver.simulated,
      device: driver.describeDevice(),
      spec: driver.deviceSpec(),
      deviceIds,
      lastStatus: driver.lastStatuses(),
      calibration: { deviceKey: key, stored: !!stored, savedAt: stored?.savedAt ?? null, values: driver.activeCalibration() },
      media: host.media,
      note: note.value,
    });
  };

  const row = (k: string, v: string | Node) => h('tr', {}, h('th', {}, k), h('td', {}, v));

  const render = () => {
    const r = report();
    const d = r.device;
    const rows: Node[] = [];
    if (d) {
      rows.push(
        row(t('diag.device'), `${d.productName ?? t('common.unknown')}${d.manufacturerName ? ` (${d.manufacturerName})` : ''}`),
        row(t('diag.usbId'), t('diag.usbIdValue', { vendor: d.vendorId, product: d.productId })),
        row(t('diag.support'), r.support?.status === 'verified'
          ? t('diag.verified', { model: r.support.model ?? '' })
          : r.support?.status === 'experimental'
            ? t('diag.experimental', { model: r.support.model ?? '' })
            : t('diag.unknownModel')),
        row(t('diag.interfaces'), h('ul', { class: 'diag-list' }, ...d.interfaces.map((i) =>
          h('li', {}, `#${i.number}${i.name ? ` ${i.name}` : ''}${i.interfaceClass !== null ? `, ${t('diag.interfaceClass', { n: i.interfaceClass })}` : ''}: `,
            i.endpoints.map((e) => `${e.direction === 'in' ? 'IN' : 'OUT'} ${hex(e.number | (e.direction === 'in' ? 0x80 : 0), 2)} (${e.packetSize} B)`).join(', '))))),
        row(t('diag.deviceId'), r.deviceIds.length
          ? h('ul', { class: 'diag-list' }, ...r.deviceIds.map((x) => h('li', {}, `#${x.interface}: `, x.value !== null ? h('code', {}, x.value) : t('diag.unreadable', { error: x.error ?? t('common.unknown') }))))
          : readError ? t('diag.unreadable', { error: readError }) : t('diag.reading')),
      );
    } else {
      rows.push(row(t('diag.device'), t('diag.noDevice')));
    }
    const snapshots = driver.lastStatuses();
    const statuses = Object.entries(r.lastStatus) as [PrintTarget, PrinterReport['lastStatus'][PrintTarget]][];
    rows.push(
      row(t('diag.lastStatus'), statuses.length
        ? h('ul', { class: 'diag-list' }, ...statuses.map(([target, s]) => h('li', {}, `${engineName(target)}: `,
          h('code', {}, s!.raw || t('diag.empty')), ` ${statusText(snapshots[target]?.code, s!.message)}`)))
        : t('diag.notQueried')),
      row(t('diag.calibration'), `${calSource(r)}: ${t('diag.calValues', {
        offset: r.calibration.values.label.headOffsetDots,
        start: num(r.calibration.values.label.feedStartDots),
        scale: num(r.calibration.values.label.feedScale, 5),
        tape: Object.entries(r.calibration.values.tape.centerCorrectionDots).map(([w, v]) => `${w} mm: ${v}`).join(', '),
      })}`),
      row(t('diag.media'), mediaName(host.media)),
      row(t('diag.app'), `${r.app.version} (${r.app.commit}, ${r.app.buildDate})`),
      row(t('diag.browser'), r.userAgent),
    );
    content.replaceChildren(h('table', { class: 'diag-table' }, h('tbody', {}, ...rows)));
    raw.textContent = JSON.stringify(r, null, 2);
  };

  const refresh = async () => {
    readError = null;
    deviceIds = [];
    render();
    if (!driver.isConnected()) return;
    // Read-only queries: one status request per engine of a known model (an unknown model gets
    // no data on its endpoints), then the device ID of each interface via control transfers.
    const spec = driver.deviceSpec();
    for (const t of spec ? deviceTargets(spec) : []) await driver.getStatus(t).catch(() => null);
    try {
      deviceIds = await driver.readDeviceIds();
    } catch (e) {
      readError = host.errorText(e);
    }
    render();
  };

  note.addEventListener('input', () => { raw.textContent = JSON.stringify(report(), null, 2); });

  const actions = h('div', { class: 'dialog-actions' },
    h('button', { type: 'button', class: 'diag-refresh', icon: 'rotate-ccw', onclick: () => { void refresh(); } }, t('diag.refresh')),
    h('button', { type: 'button', icon: 'download', onclick: () => { download(report()); toast(t('diag.downloaded'), 'ok'); } }, t('diag.download')),
    h('button', {
      type: 'button',
      icon: 'external-link',
      onclick: () => {
        const r = report();
        const link = githubIssueUrl(r);
        if (!link.complete) {
          download(r);
          notice.hidden = false;
          notice.textContent = t('diag.tooLong');
        }
        window.open(link.url, '_blank', 'noopener');
      },
    }, t('diag.github')),
    h('button', { type: 'button', class: 'primary', onclick: () => dlg.close() }, t('common.close')),
  );

  dlg.append(
    h('h2', {}, t('diag.title')),
    h('p', { class: 'muted small' }, t('diag.intro')),
    content,
    h('label', { class: 'field diag-note' }, h('span', {}, t('diag.note')), note),
    h('details', { class: 'diag-details' }, h('summary', {}, t('diag.details')), raw),
    notice,
    actions,
  );
  document.body.append(dlg);
  dlg.showModal();
  void refresh();
  return new Promise((resolve) => dlg.addEventListener('close', () => { dlg.remove(); resolve(); }, { once: true }));
}
