// Calibration wizard: print the test pattern, measure with a ruler, save per-device values.
// The math lives in src/printer/calibrate.ts, storage in src/printer/calibration.ts.
import type { Calibration, Media, PrintTarget, PrinterDriver } from '../printer/types';
import { loadCalibration, resetCalibration, saveCalibration } from '../printer/calibration';
import { UNSUPPORTED_MESSAGE, printBlockReason } from '../printer/devices';
import { measurementTargets, solveCalibration, type CalibrationInput, type CalibrationSolution } from '../printer/calibrate';
import type { DiagnosticDriver } from '../printer/diagnostics';
import { patternLengthMm, renderTestPattern } from '../printer/testpattern';
import { threshold } from '../app/preview';
import { h, num, parseNum, toast } from './dom';

export type CalibrationDriver = PrinterDriver & DiagnosticDriver & { simulated?: boolean };

export interface CalibrationHost {
  driver: CalibrationDriver;
  /** Media of the connected model (changes when a printer connects while the wizard is open). */
  media(): Media[];
  currentMedia: Media;
  /** Connect via the app (updates the connection pill). Resolves true when connected. */
  connect(): Promise<boolean>;
  errorText(e: unknown): string;
}

const STEPS = ['Medium wählen', 'Testmuster drucken', 'Messen', 'Ergebnis'];

/** Media the wizard can calibrate with: die-cut labels (need a label edge) and all tapes. */
const calibratable = (m: Media) => m.target === 'tape' || m.lengthMm !== null;

function patternImageData(media: Media): ImageData {
  const p = renderTestPattern(media);
  return new ImageData(p.data as unknown as Uint8ClampedArray<ArrayBuffer>, p.width, p.height);
}

const fmt = (v: number, d = 1) => num(v, d);

export function openCalibrationWizard(host: CalibrationHost): Promise<void> {
  const { driver } = host;
  const start = calibratable(host.currentMedia) && host.media().some((m) => m.id === host.currentMedia.id)
    ? host.currentMedia
    : host.media().find(calibratable)!;
  const st = {
    step: 0,
    target: start.target as PrintTarget,
    mediaId: start.id,
    printedWith: null as Calibration | null,
    printedMediaId: null as string | null,
    inputs: { a: '', b: '', tick: '', c: '', top: '', bottom: '' },
    solution: null as CalibrationSolution | null,
    saved: false,
    busy: false,
  };
  const media = () => host.media().find((m) => m.id === st.mediaId) ?? host.media().find(calibratable)!;

  const dlg = h('dialog', { class: 'calib-dialog', 'aria-label': 'Drucker kalibrieren' });
  const title = h('h2', {}, 'Drucker kalibrieren');
  const steps = h('ol', { class: 'calib-steps', 'aria-label': 'Schritte' });
  const body = h('div', { class: 'calib-body' });
  const bar = h('div', { class: 'dialog-actions' });
  dlg.append(title, steps, body, bar);
  document.body.append(dlg);

  let resolveFn!: () => void;
  const done = new Promise<void>((r) => (resolveFn = r));
  dlg.addEventListener('close', () => { dlg.remove(); resolveFn(); }, { once: true });

  const btn = (label: string, onclick: () => unknown, opts: { primary?: boolean; disabled?: boolean; icon?: string; cls?: string } = {}) =>
    h('button', {
      type: 'button',
      class: [opts.primary ? 'primary' : '', opts.cls ?? ''].join(' ').trim(),
      disabled: opts.disabled || st.busy,
      icon: opts.icon,
      onclick: () => { Promise.resolve(onclick()).catch((e) => toast(host.errorText(e), 'error')); },
    }, label);

  const deviceLine = () => {
    const key = driver.deviceKey();
    const dev = driver.describeDevice();
    if (!key) return h('p', { class: 'calib-device warn' }, 'Kein Drucker verbunden. Zum Drucken des Testmusters und zum Speichern bitte verbinden.');
    const stored = loadCalibration(key);
    const spec = driver.deviceSpec();
    if (!spec) return h('p', { class: 'calib-device warn' }, `Gerät: ${dev?.productName ?? 'unbekannt'} (${key}). ${UNSUPPORTED_MESSAGE}`);
    return h('p', { class: 'calib-device' },
      `Gerät: ${dev?.productName ?? 'unbekannt'} (${key}). `,
      stored ? `Gespeicherte Kalibrierung vom ${new Date(stored.savedAt ?? '').toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}.` : 'Es gelten die Standardwerte.',
      spec.status === 'experimental' ? ` Der ${spec.name} ist noch nicht getestet und startet ohne Korrekturen: hier einmal einmessen.` : '');
  };

  const render = () => {
    steps.replaceChildren(...STEPS.map((s, i) =>
      h('li', { class: i === st.step ? 'current' : i < st.step ? 'done' : '', 'aria-current': i === st.step ? 'step' : undefined }, `${i + 1}. ${s}`)));
    body.replaceChildren(...[renderChoose, renderPrint, renderMeasure, renderResult][st.step]());
    bar.replaceChildren(...buttons());
  };

  // ---------- step 1: medium ----------

  function renderChoose(): Node[] {
    const seg = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Druckwerk' });
    if (!host.media().some((m) => m.id === st.mediaId)) {
      st.mediaId = media().id;
      st.target = media().target;
      st.printedWith = null;
    }
    const engines = (['label', 'tape'] as const).filter((t) => host.media().some((m) => m.target === t && calibratable(m)));
    for (const [v, label] of ([['label', 'Etikett'], ['tape', 'Band']] as const).filter(([t]) => engines.includes(t))) {
      const input = h('input', { type: 'radio', name: 'calibEngine', value: v, checked: st.target === v });
      input.addEventListener('change', () => {
        st.target = v;
        st.mediaId = host.media().find((m) => m.target === v && calibratable(m))!.id;
        st.printedWith = null;
        render();
      });
      seg.append(h('label', {}, input, ' ', h('span', {}, label)));
    }
    const select = h('select', { 'aria-label': 'Eingelegtes Medium' },
      ...host.media().filter((m) => m.target === st.target && calibratable(m)).map((m) => h('option', { value: m.id }, m.name)));
    select.value = st.mediaId;
    select.addEventListener('change', () => { st.mediaId = select.value; st.printedWith = null; render(); });
    const cal = driver.activeCalibration();
    const m = media();
    const current = m.target === 'label'
      ? `Aktuell: Versatz quer ${cal.label.headOffsetDots} Punkte, Druckbeginn ${fmt(cal.label.feedStartDots)} Punkte, Vorschub-Faktor ${fmt(cal.label.feedScale, 5)}.`
      : `Aktuell: Korrektur für ${m.widthMm}-mm-Band ${cal.tape.centerCorrectionDots[m.widthMm] ?? 0} Punkte.`;
    return [
      h('p', {}, 'Die Kalibrierung gleicht aus, wo dein Drucker tatsächlich druckt. Sie wird für dieses Druckermodell in diesem Browser gespeichert und bei jedem Druck verwendet.'),
      deviceLine(),
      h('div', { class: 'field' }, h('span', {}, 'Druckwerk'), seg),
      h('label', { class: 'field' }, h('span', {}, 'Eingelegtes Medium'), select),
      h('p', { class: 'muted small' }, current),
      m.target === 'label'
        ? h('p', { class: 'muted small' }, 'Etiketten: Länge und Querlage werden kalibriert. Endlospapier eignet sich nicht, weil eine feste Etikettenkante fehlt.')
        : h('p', { class: 'muted small' }, 'Band: die Mittenlage quer zum Band wird für die gewählte Bandbreite kalibriert.'),
    ];
  }

  // ---------- step 2: print ----------

  async function printPattern(): Promise<void> {
    if (!driver.isConnected() && !(await host.connect())) return;
    const m = media();
    const blocked = printBlockReason(driver.deviceSpec(), m.target);
    if (blocked) {
      render();
      throw new Error(blocked);
    }
    st.busy = true;
    render();
    try {
      const status = await driver.getStatus(m.target).catch(() => null);
      if (status?.paperOut) throw new Error(m.target === 'tape' ? 'Kein Band eingelegt oder Band leer.' : 'Keine Etiketten eingelegt oder Rolle leer.');
      const used = driver.activeCalibration();
      await driver.print({ image: patternImageData(m), media: m }, { copies: 1, lengthMm: m.lengthMm === null ? patternLengthMm(m) : undefined });
      st.printedWith = used;
      st.printedMediaId = m.id;
      toast(driver.simulated ? 'Testmuster simuliert gedruckt.' : 'Testmuster gesendet.', 'ok');
    } finally {
      st.busy = false;
      render();
    }
  }

  function renderPrint(): Node[] {
    const m = media();
    const img = threshold(patternImageData(m)).image;
    const cv = h('canvas', { class: 'calib-pattern', role: 'img', 'aria-label': 'Vorschau des Testmusters' });
    cv.width = img.width;
    cv.height = img.height;
    cv.getContext('2d')!.putImageData(img, 0, 0);
    const consumes = m.target === 'label'
      ? `Verbraucht ein Etikett (${m.name}).`
      : `Verbraucht etwa ${Math.round(Math.max(patternLengthMm(m), 40))} mm Band (${m.widthMm} mm).`;
    const already = h('input', { type: 'checkbox', checked: !!st.printedWith && st.printedMediaId === m.id });
    already.addEventListener('change', () => {
      st.printedWith = already.checked ? driver.activeCalibration() : null;
      st.printedMediaId = already.checked ? m.id : null;
      render();
    });
    return [
      h('p', {}, 'Das Testmuster zeigt einen Rahmen um den druckbaren Bereich, ein großes Quadrat oben links, ein kleines unten links und nummerierte Striche alle 10 mm, gemessen ab der linken Etikettenkante.'),
      h('div', { class: 'calib-pattern-wrap' }, cv),
      h('p', { class: 'calib-device' + (driver.isConnected() ? '' : ' warn') },
        driver.isConnected() ? consumes : `Kein Drucker verbunden. ${consumes}`),
      h('div', { class: 'btnrow' },
        btn(driver.isConnected() ? 'Testmuster drucken' : 'Verbinden und drucken', printPattern, { primary: !st.printedWith, icon: 'printer' })),
      h('label', { class: 'check' }, already, 'Ich habe das Testmuster mit der aktuellen Kalibrierung schon gedruckt.'),
      st.printedWith ? h('p', { class: 'ok-text small' }, 'Bereit zum Messen. Lass den Ausdruck kurz abkühlen und lege ihn flach hin.') : null,
    ].filter(Boolean) as Node[];
  }

  // ---------- step 3: measure ----------

  const mmField = (key: keyof typeof st.inputs, label: string, letter: string, expected: number) => {
    const input = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: fmt(expected), 'aria-label': `${letter}: ${label} in mm` });
    input.value = st.inputs[key];
    input.addEventListener('input', () => { st.inputs[key] = input.value; });
    return h('label', { class: 'calib-field' },
      h('span', { class: 'calib-letter', 'aria-hidden': 'true' }, letter),
      h('span', { class: 'calib-label' }, label, h('small', { class: 'muted' }, ` Soll etwa ${fmt(expected)} mm`)),
      h('span', { class: 'calib-input' }, input, ' mm'));
  };

  function renderMeasure(): Node[] {
    const m = media();
    const t = measurementTargets(m);
    const out: Node[] = [];
    const diagram = h('div', { class: 'calib-diagram' });
    if (m.target === 'label') {
      if (!st.inputs.tick || !t.ticks.some((x) => String(x.mm) === st.inputs.tick)) st.inputs.tick = String(t.ticks[t.ticks.length - 1]?.mm ?? '');
      diagram.innerHTML = labelDiagram(st.inputs.tick);
      const tickSel = h('select', { class: 'calib-tick', 'aria-label': 'Strich für Messung B' },
        ...t.ticks.map((x) => h('option', { value: String(x.mm) }, `Strich „${x.mm}“`)));
      tickSel.value = st.inputs.tick;
      tickSel.addEventListener('change', () => { st.inputs.tick = tickSel.value; render(); });
      const tickMm = t.ticks.find((x) => String(x.mm) === st.inputs.tick)?.xMm ?? 0;
      const fieldB = mmField('b', 'Linke Etikettenkante bis Mitte von', 'B', tickMm);
      fieldB.querySelector('.calib-label')!.insertBefore(tickSel, fieldB.querySelector('.calib-label small'));
      out.push(
        h('p', {}, 'Halte das Etikett so, dass das große Quadrat oben links ist. Miss mit einem Lineal in Millimetern, möglichst auf 0,5 mm genau.'),
        diagram,
        h('ul', { class: 'calib-rules small' },
          h('li', {}, h('strong', {}, 'Immer ab der Etikettenkante messen'), ', nicht ab dem Rahmen.'),
          h('li', {}, 'Zur Rahmenlinie: bis zu ihrer äußeren Kante. Zum Strich: bis zur Strichmitte. Die Zahl über dem Strich ist sein Sollabstand in mm.')),
        mmField('a', 'Linke Etikettenkante bis linke Rahmenlinie', 'A', t.frameXMm),
        fieldB,
        mmField('c', 'Untere Etikettenkante bis untere Rahmenlinie', 'C', t.bottomMm),
        h('p', { class: 'muted small' }, 'A und B kalibrieren die Länge (nur zusammen), C die Querlage. Ein leeres Feld lässt den jeweiligen Wert unverändert.'),
      );
    } else {
      diagram.innerHTML = tapeDiagram();
      out.push(
        h('p', {}, 'Halte das Band so, dass das große Quadrat oben links ist. Miss quer zum Band von der Bandkante bis zur äußeren Kante der Rahmenlinie.'),
        diagram,
        mmField('top', 'Obere Bandkante bis obere Rahmenlinie', 'D', t.gapMm),
        mmField('bottom', 'Untere Bandkante bis untere Rahmenlinie', 'E', t.gapMm),
        h('p', { class: 'muted small' }, `Die Korrektur gilt nur für ${m.widthMm}-mm-Band. Ist das Muster zu klein zum Messen, lieber mit einer Lupe als geschätzt.`),
      );
    }
    return out;
  }

  function collect(): CalibrationInput | string {
    const m = media();
    const val = (s: string) => (s.trim() === '' ? null : parseNum(s.trim()));
    const bad = (v: number | null) => v !== null && !Number.isFinite(v);
    if (m.target === 'label') {
      const a = val(st.inputs.a), b = val(st.inputs.b), c = val(st.inputs.c);
      if (bad(a) || bad(b) || bad(c)) return 'Bitte nur Zahlen eingeben, z. B. 6,5.';
      if ((a === null) !== (b === null)) return 'A und B bitte gemeinsam ausfüllen (oder beide leer lassen).';
      if (a === null && c === null) return 'Bitte mindestens A und B oder C ausfüllen.';
      return {
        labelFeed: a !== null && b !== null ? { frameMeasuredMm: a, tickMm: Number(st.inputs.tick), tickMeasuredMm: b } : undefined,
        labelAcross: c !== null ? { bottomMeasuredMm: c } : undefined,
      };
    }
    const top = val(st.inputs.top), bottom = val(st.inputs.bottom);
    if (top === null || bottom === null) return 'Bitte beide Abstände D und E eingeben.';
    if (bad(top) || bad(bottom)) return 'Bitte nur Zahlen eingeben, z. B. 2,5.';
    return { tape: { gapTopMm: top, gapBottomMm: bottom } };
  }

  // ---------- step 4: result ----------

  function renderResult(): Node[] {
    const s = st.solution!;
    const m = media();
    const out: Node[] = [];
    if (s.errors.length) out.push(h('div', { class: 'calib-errors', role: 'alert' }, ...s.errors.map((e) => h('p', {}, e))));
    if (s.changes.length) {
      const mmPerDot = 25.4 / m.dpi;
      out.push(h('table', { class: 'calib-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Wert'), h('th', {}, 'Bisher'), h('th', {}, 'Neu'), h('th', {}, 'Wirkung'))),
        h('tbody', {}, ...s.changes.map((c) => {
          const diff = c.after - c.before;
          const effect = c.key === 'feedScale'
            ? `${fmt(Math.abs(diff) * (m.lengthMm ?? 0), 2)} mm auf ${m.lengthMm} mm Länge`
            : `${diff === 0 ? '0' : fmt(Math.abs(diff) * mmPerDot, 2)} mm`;
          const digits = c.key === 'feedScale' ? 5 : c.key === 'feedStartDots' ? 1 : 0;
          return h('tr', { class: diff === 0 ? 'same' : '' },
            h('td', {}, c.label), h('td', {}, fmt(c.before, digits)), h('td', {}, h('strong', {}, fmt(c.after, digits))), h('td', { class: 'muted' }, effect));
        }))));
      if (s.changes.every((c) => c.after === c.before)) out.push(h('p', { class: 'ok-text' }, 'Der Druck sitzt bereits richtig, es gibt nichts zu korrigieren.'));
    }
    if (st.saved) {
      out.push(h('p', { class: 'ok-text' }, `Gespeichert für ${driver.deviceKey() ?? 'dieses Gerät'}. Ab jetzt wird jeder Druck damit ausgeführt.`));
      out.push(h('p', { class: 'muted small' }, 'Zur Kontrolle ein weiteres Testmuster drucken und wieder messen. Die Werte sollten jetzt nahe am Soll liegen.'));
    } else if (!s.errors.length || s.changes.length) {
      out.push(h('p', { class: 'muted small' }, s.errors.length
        ? 'Nur die fehlerfreien Messungen werden übernommen. Oder zurück und nachmessen.'
        : 'Mit „Speichern“ übernehmen.'));
    }
    return out;
  }

  async function save(): Promise<void> {
    if (!driver.deviceKey() && !(await host.connect())) return;
    const key = driver.deviceKey();
    if (!key) throw new Error('Kein Drucker verbunden.');
    if (!driver.deviceSpec()) throw new Error(UNSUPPORTED_MESSAGE);
    saveCalibration(key, st.solution!.calibration);
    st.saved = true;
    toast('Kalibrierung gespeichert.', 'ok');
    render();
  }

  async function verify(): Promise<void> {
    await printPattern();
    if (st.printedWith) {
      st.saved = false;
      st.solution = null;
      st.inputs = { ...st.inputs, a: '', b: '', c: '', top: '', bottom: '' };
      st.step = 2;
      render();
    }
  }

  async function reset(): Promise<void> {
    const key = driver.deviceKey();
    if (!key) { toast('Kein Drucker verbunden.', 'error'); return; }
    if (!loadCalibration(key)) { toast('Es gelten bereits die Standardwerte.', 'info'); return; }
    if (!confirm('Gespeicherte Kalibrierung für dieses Gerät löschen und die Standardwerte verwenden?')) return;
    resetCalibration(key);
    st.printedWith = null;
    toast('Kalibrierung zurückgesetzt, es gelten die Standardwerte.', 'ok');
    render();
  }

  // ---------- navigation ----------

  function buttons(): Node[] {
    const close = btn(st.saved ? 'Fertig' : 'Abbrechen', () => dlg.close(), { primary: st.saved });
    const back = btn('Zurück', () => { st.step--; st.saved = false; render(); });
    const left: Node[] = [];
    const right: Node[] = [];
    switch (st.step) {
      case 0: {
        const hasStored = !!(driver.deviceKey() && loadCalibration(driver.deviceKey()!));
        left.push(btn('Auf Standard zurücksetzen', reset, { icon: 'rotate-ccw', disabled: !hasStored }));
        right.push(close, btn('Weiter', () => { st.step = 1; render(); }, { primary: true }));
        break;
      }
      case 1:
        right.push(close, back, btn('Weiter', () => { st.step = 2; render(); }, { primary: !!st.printedWith, disabled: !st.printedWith || st.printedMediaId !== st.mediaId }));
        break;
      case 2:
        right.push(close, back, btn('Berechnen', () => {
          const input = collect();
          if (typeof input === 'string') { toast(input, 'error'); return; }
          st.solution = solveCalibration(media(), st.printedWith ?? driver.activeCalibration(), input);
          st.saved = false;
          st.step = 3;
          render();
        }, { primary: true }));
        break;
      case 3: {
        const s = st.solution!;
        const changed = s.changes.some((c) => c.after !== c.before);
        if (st.saved) right.push(btn('Kontrolldruck', verify, { icon: 'printer' }), close);
        else right.push(close, back, btn('Speichern', save, { primary: true, disabled: !changed }));
        break;
      }
    }
    return [h('div', { class: 'calib-left' }, ...left), ...right];
  }

  render();
  dlg.showModal();
  return done;
}

// ---------- diagrams (schematic, not to scale) ----------

const SVG_STYLE = 'width:100%;max-width:440px;height:auto;display:block;margin:0 auto';

function labelDiagram(tick: string): string {
  // Label 300 x 120, frame inset (exaggerated so the distances are visible).
  const L = { x: 20, y: 10, w: 300, h: 120 };
  const F = { x: L.x + 34, y: L.y + 12, w: 300 - 34 - 14, h: 120 - 12 - 18 };
  const tickX = L.x + 236;
  const ticks = [L.x + 86, L.x + 136, L.x + 186, tickX];
  const yBot = F.y + F.h;
  const arrow = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="dim" marker-start="url(#ca)" marker-end="url(#ca)"/>`;
  return `<svg viewBox="0 0 340 196" role="img" aria-label="Skizze: Messung A, B und C am Etikett" style="${SVG_STYLE}">
  <defs><marker id="ca" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" class="dimhead"/></marker></defs>
  <rect x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}" rx="5" class="paper"/>
  <rect x="${F.x}" y="${F.y}" width="${F.w}" height="${F.h}" class="frame"/>
  <rect x="${F.x + 5}" y="${F.y + 5}" width="22" height="22" class="ink"/>
  <rect x="${F.x + 5}" y="${yBot - 16}" width="11" height="11" class="ink"/>
  ${ticks.map((x, i) => `<rect x="${x - 1}" y="${yBot - (i === 3 ? 12 : 8)}" width="2" height="${i === 3 ? 12 : 8}" class="ink"/><text x="${x}" y="${yBot - (i === 3 ? 15 : 11)}" class="num">${i === 3 ? tick : (i + 2) * 10}</text>`).join('')}
  ${arrow(L.x, L.y + 60, F.x, L.y + 60)}<text x="${(L.x + F.x) / 2}" y="${L.y + 54}" class="letter">A</text>
  <line x1="${L.x}" y1="${L.y + L.h}" x2="${L.x}" y2="${L.y + L.h + 34}" class="ext"/>
  <line x1="${tickX}" y1="${yBot}" x2="${tickX}" y2="${L.y + L.h + 34}" class="ext"/>
  ${arrow(L.x, L.y + L.h + 28, tickX, L.y + L.h + 28)}<text x="${(L.x + tickX) / 2}" y="${L.y + L.h + 22}" class="letter">B</text>
  ${arrow(L.x + 160, yBot, L.x + 160, L.y + L.h)}<text x="${L.x + 172}" y="${L.y + L.h - 3}" class="letter">C</text>
  <text x="${L.x + L.w / 2}" y="${L.y + L.h + 50}" class="cap">Linke Kante = Anfang des Etiketts (kommt zuerst aus dem Drucker)</text>
</svg>`;
}

function tapeDiagram(): string {
  const T = { x: 10, y: 22, w: 320, h: 80 };
  const F = { x: T.x + 46, y: T.y + 16, w: 230, h: 48 };
  const arrow = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="dim" marker-start="url(#cb)" marker-end="url(#cb)"/>`;
  return `<svg viewBox="0 0 340 130" role="img" aria-label="Skizze: Messung D und E am Band" style="${SVG_STYLE}">
  <defs><marker id="cb" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" class="dimhead"/></marker></defs>
  <rect x="${T.x}" y="${T.y}" width="${T.w}" height="${T.h}" class="paper"/>
  <rect x="${F.x}" y="${F.y}" width="${F.w}" height="${F.h}" class="frame"/>
  <rect x="${F.x + 4}" y="${F.y + 4}" width="18" height="18" class="ink"/>
  <rect x="${F.x + 4}" y="${F.y + F.h - 13}" width="9" height="9" class="ink"/>
  ${arrow(F.x + 120, T.y, F.x + 120, F.y)}<text x="${F.x + 132}" y="${T.y + 12}" class="letter">D</text>
  ${arrow(F.x + 120, F.y + F.h, F.x + 120, T.y + T.h)}<text x="${F.x + 132}" y="${T.y + T.h - 3}" class="letter">E</text>
  <text x="${T.x + T.w / 2}" y="${T.y + T.h + 20}" class="cap">D und E quer zum Band messen. Gleich groß = mittig.</text>
</svg>`;
}
