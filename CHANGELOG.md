# Changelog

All notable changes to Second Label. Versions follow [Semantic Versioning](https://semver.org): new features raise the middle number, fixes the last one.

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
