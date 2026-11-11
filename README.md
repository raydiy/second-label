# Second Label

A free, browser-based label designer that prints directly to older thermal label printers over USB. No vendor software, no drivers, no account.

Working printers should not end up in the bin just because their official software is no longer maintained. Second Label talks to the printer straight from the browser via [WebUSB](https://developer.mozilla.org/en-US/docs/Web/API/WebUSB_API), so a printer that still works can keep working.

**Open the app:** https://raydiy.github.io/second-label/

## Features

- Paper labels and plastic tape, with the correct size and printable area for each medium
- Text with bundled fonts (works offline, no external font requests)
- Icons with search, images (PNG, JPG, SVG), lines and shapes
- QR codes and barcodes (Code 128, Code 39, EAN-13, UPC-A, Data Matrix)
- Snapping to the label centre, alignment tools, undo and redo
- Saved layouts in your browser, plus export and import as `.label.json` files to share them
- 1-bit print preview that shows exactly what the thermal head will print

All data stays in your browser. Nothing is uploaded anywhere.

## Supported printers

| Printer | USB ID | Labels | Tape | Status |
|---|---|---|---|---|
| DYMO LabelWriter DUO (tape engine with 128 dots, D1 tape 6 to 24 mm) | `0922:001D` | yes | yes | tested |

Other models are not supported yet. Contributions with test results for further printers are welcome.

## Requirements

- A Chromium-based browser: Chrome, Edge, Vivaldi or Brave. Safari and Firefox do not support WebUSB.
- **macOS:** works out of the box. Close any vendor label software before printing, it may hold the printer.
- **Windows:** not tested. The Windows printer driver usually claims the device, which blocks WebUSB. Replacing the driver with WinUSB (for example with [Zadig](https://zadig.akeo.ie/)) should make it accessible, at the cost of the regular Windows print queue.
- **Linux:** not tested. The `usblp` kernel module claims printer-class devices. A udev rule or blacklisting `usblp` for this device should make it accessible.

## Development

Requires [Bun](https://bun.sh).

```sh
bun install
bun run dev        # http://localhost:5173
bun test src/printer
bun run build      # static site in dist/
```

The printer protocol, sources and calibration notes are documented in [docs/protocol.md](docs/protocol.md).

The printer driver is an independent implementation written for this project. No vendor drivers, PPD files or vendor source code are included. Command bytes and media dimensions were taken from the publicly available vendor technical reference and cross-checked against the open-source `dymo-cups-drivers` project (GPL-2.0), which served only as a protocol reference. The `spike/` folder contains standalone scripts for status queries and supervised test prints.

## Disclaimer

Second Label is an independent project. It is not affiliated with, endorsed by or sponsored by DYMO or Newell Brands. DYMO and LabelWriter are trademarks of their respective owners and are used here only to identify compatible hardware.

## License

[MIT](LICENSE). Bundled third-party components: Fabric.js (MIT), bwip-js (MIT), Lucide icons (ISC), fonts from Fontsource (SIL Open Font License 1.1).
