// "Druckerprofil / Diagnose": collect what we need to support a printer, download it as JSON
// or open a prefilled GitHub issue. Report building is pure (src/printer/diagnostics.ts).
import type { Media, PrintTarget } from '../printer/types';
import { loadCalibration } from '../printer/calibration';
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

export interface DiagnosticsHost {
  driver: CalibrationDriver;
  media: Media;
  errorText(e: unknown): string;
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

  const dlg = h('dialog', { class: 'diag-dialog', 'aria-label': 'Druckerprofil / Diagnose' });
  const content = h('div', { class: 'diag-content' });
  const note = h('textarea', {
    rows: 3,
    'aria-label': 'Notiz',
    placeholder: 'Was funktioniert, was nicht? Druckermodell laut Typenschild, Betriebssystem, eingelegtes Medium ...',
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
        row('Gerät', `${d.productName ?? 'unbekannt'}${d.manufacturerName ? ` (${d.manufacturerName})` : ''}`),
        row('USB-Kennung', `Hersteller ${d.vendorId}, Produkt ${d.productId}`),
        row('Schnittstellen', h('ul', { class: 'diag-list' }, ...d.interfaces.map((i) =>
          h('li', {}, `#${i.number}${i.name ? ` ${i.name}` : ''}${i.interfaceClass !== null ? `, Klasse ${i.interfaceClass}` : ''}: `,
            i.endpoints.map((e) => `${e.direction === 'in' ? 'IN' : 'OUT'} ${hex(e.number | (e.direction === 'in' ? 0x80 : 0), 2)} (${e.packetSize} B)`).join(', '))))),
        row('Geräte-ID (IEEE 1284)', r.deviceIds.length
          ? h('ul', { class: 'diag-list' }, ...r.deviceIds.map((x) => h('li', {}, `#${x.interface}: `, x.value !== null ? h('code', {}, x.value) : `nicht lesbar (${x.error ?? 'unbekannt'})`)))
          : readError ? `nicht lesbar (${readError})` : 'wird gelesen ...'),
      );
    } else {
      rows.push(row('Gerät', 'Kein Drucker verbunden. Bitte zuerst „Verbinden“, dann diese Ansicht erneut öffnen.'));
    }
    const statuses = Object.entries(r.lastStatus) as [PrintTarget, PrinterReport['lastStatus'][PrintTarget]][];
    rows.push(
      row('Letzter Status', statuses.length
        ? h('ul', { class: 'diag-list' }, ...statuses.map(([t, s]) => h('li', {}, `${t === 'tape' ? 'Band' : 'Etikett'}: `, h('code', {}, s!.raw || '(leer)'), ` ${s!.message}`)))
        : 'noch nicht abgefragt'),
      row('Kalibrierung', `${r.calibration.source === 'stored' ? 'gespeichert' : 'Standardwerte'}${r.calibration.deviceKey ? ` für ${r.calibration.deviceKey}` : ''}: ` +
        `quer ${r.calibration.values.label.headOffsetDots}, Beginn ${num(r.calibration.values.label.feedStartDots)}, Faktor ${num(r.calibration.values.label.feedScale, 5)}, ` +
        `Band ${Object.entries(r.calibration.values.tape.centerCorrectionDots).map(([w, v]) => `${w} mm: ${v}`).join(', ')}`),
      row('Medium', r.media ? r.media.name : '-'),
      row('App', `${r.app.version} (${r.app.commit}, ${r.app.buildDate})`),
      row('Browser', r.userAgent),
    );
    content.replaceChildren(h('table', { class: 'diag-table' }, h('tbody', {}, ...rows)));
    raw.textContent = JSON.stringify(r, null, 2);
  };

  const refresh = async () => {
    readError = null;
    deviceIds = [];
    render();
    if (!driver.isConnected()) return;
    // Read-only queries: one status request per engine, then the device ID of each interface.
    for (const t of ['label', 'tape'] as PrintTarget[]) await driver.getStatus(t).catch(() => null);
    try {
      deviceIds = await driver.readDeviceIds();
    } catch (e) {
      readError = host.errorText(e);
    }
    render();
  };

  note.addEventListener('input', () => { raw.textContent = JSON.stringify(report(), null, 2); });

  const actions = h('div', { class: 'dialog-actions' },
    h('button', { type: 'button', class: 'diag-refresh', icon: 'rotate-ccw', onclick: () => { void refresh(); } }, 'Neu einlesen'),
    h('button', { type: 'button', icon: 'download', onclick: () => { download(report()); toast('Bericht heruntergeladen.', 'ok'); } }, 'JSON herunterladen'),
    h('button', {
      type: 'button',
      icon: 'external-link',
      onclick: () => {
        const r = report();
        const link = githubIssueUrl(r);
        if (!link.complete) {
          download(r);
          notice.hidden = false;
          notice.textContent = 'Der Bericht ist zu lang für den Link. Die JSON-Datei wurde heruntergeladen: bitte im GitHub-Formular per Drag and Drop anhängen.';
        }
        window.open(link.url, '_blank', 'noopener');
      },
    }, 'Auf GitHub melden'),
    h('button', { type: 'button', class: 'primary', onclick: () => dlg.close() }, 'Schließen'),
  );

  dlg.append(
    h('h2', {}, 'Druckerprofil / Diagnose'),
    h('p', { class: 'muted small' }, 'Diese Angaben helfen, weitere Druckermodelle zu unterstützen. Die Seriennummer wird nicht erfasst. Es wird nichts automatisch gesendet: du lädst den Bericht herunter oder öffnest ein vorausgefülltes GitHub-Issue (GitHub-Konto nötig) und schickst es selbst ab.'),
    content,
    h('label', { class: 'field diag-note' }, h('span', {}, 'Notiz'), note),
    h('details', { class: 'diag-details' }, h('summary', {}, 'Gesammelte Daten (JSON)'), raw),
    notice,
    actions,
  );
  document.body.append(dlg);
  dlg.showModal();
  void refresh();
  return new Promise((resolve) => dlg.addEventListener('close', () => { dlg.remove(); resolve(); }, { once: true }));
}
