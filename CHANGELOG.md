# Changelog

All notable changes to Second Label. Versions follow [Semantic Versioning](https://semver.org): new features raise the middle number, fixes the last one.

## 0.5.0 (2026-11-12)

- New label medium: 2112284 Barcode (film) 19 x 64 mm. Margins taken from 11355, which has the same width

## 0.4.0 (2026-11-12)

- Device table (`src/printer/devices.ts`): engines, USB interfaces, head widths and tape constants per model instead of hardcoded DUO values. The DUO `0922:001D` prints byte-identically to 0.3.0 (golden test)
- Experimental, untested support for LabelWriter 450 Duo (`0023`), DUO with 96-dot tape (`0017`), 450 (`0020`), 450 Turbo (`0021`), 400 (`0019`) and 400 Turbo (`001A`). They start from a neutral calibration; the app shows a hint to calibrate and to send a report
- Label-only models: tape engine and tape media are not offered; a tape medium is switched to a label when such a printer connects. The 96-dot DUO offers tape up to 19 mm with the printable band limited to its head
- Unknown printers of the same vendor still connect and can send a diagnostic report, printing and calibration are disabled with a message
- Diagnostic report: new "Support status" field (verified, experimental, unknown)
- Developer: `?mock=<pid>` (hex, e.g. `?mock=0020`) simulates a model from the table or an unknown one
- The user interface is available in English and German. The language follows the browser (`navigator.languages`, English otherwise) and can be switched with EN / DE next to the version; the choice is remembered. Switching reloads the page and asks first when there are unsaved changes
- Media names and notes, printer status and error messages, the calibration wizard and the diagnostics view are translated; numbers and dates follow the selected language (decimal comma in German). The diagnostic report and the GitHub issue text stay English
- Developer: UI text lives in `src/i18n/locales/*.json` with a typed `t()` helper; driver and solver errors carry codes instead of German text. `bun test src` also runs a locale consistency test (CI updated)

## 0.3.0 (2026-11-11)

- Calibration wizard ("Kalibrieren"): prints a test pattern with numbered 10 mm ticks, asks for a few ruler measurements, shows old and new values and saves them per printer model (USB vendor and product id, never the serial number). Every print uses the stored values; "Auf Standard zurücksetzen" restores the defaults. Labels: feed start, feed scale and position across the head. Tape: centring per tape width
- Printer profile / diagnostics ("Druckerprofil / Diagnose"): collects USB descriptors, IEEE 1284 device ids (serial removed), last status bytes, active calibration, medium, app version and browser, with a free-text note. Download as JSON or open a prefilled GitHub issue ("Auf GitHub melden"); new issue template `printer-report.md`
- Calibration is data now (`Calibration` type, `DEFAULT_CALIBRATION`); printing without a stored calibration is byte-identical to before
- The test pattern lives in `src/printer/testpattern.ts` and is shared with `spike/testprint.ts`
- Developer: `?mock` in the URL selects the simulated printer

## 0.2.0 (2026-11-11)

- Library backup: "Alle sichern" downloads all saved layouts as one file; "Import" restores it and merges by date
- The browser is asked to keep saved layouts persistently
- The save button is highlighted while there are unsaved changes
- Version, commit and build date are shown next to the logo

## 0.1.0 (2026-11-11)

- First public release: label designer with WebUSB printing for the LabelWriter DUO (labels and D1 tape)
