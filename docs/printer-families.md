# Printer families: which other DYMO devices could be added without hardware

Research note for community contributions. Today the driver in `src/printer/` supports exactly one
device, the first-generation LabelWriter DUO (VID `0x0922`, PID `0x001D`), see `docs/protocol.md`.
This document collects which other DYMO models speak the same two protocols (LabelWriter "ESC
raster" on the label side, D1 on the tape side) and would only differ in table data, and which
ones do not.

Status: desk research, 2026-11-11. Nothing here was tested on hardware other than the DUO 0x001D.

## How to read this document

Every fact carries a source key in brackets. Evidence levels:

- **[device]** measured on our own DUO 0x001D (see `docs/protocol.md`).
- **[TR450]**, **[SE450]** DYMO technical reference (vendor primary source).
- **[DRV]** official DYMO CUPS driver source (vendor code, GPL). Model names, head widths and
  feed constants are vendor data, so treated as strong evidence.
- **[3P]** third-party open-source project or community list. Good, but may be single-sourced.
- **UNVERIFIED** marks a value that has only one third-party source, conflicts between sources,
  or is inferred by us. These must be confirmed by a community member who owns the device before
  the entry is marked verified.

## Sources

| Key | Source |
|---|---|
| TR450 | *LabelWriter 450 Series Printers Technical Reference Manual*, Sanford L.P. Covers 450, 450 Turbo, 450 Twin Turbo, 450 Duo. PID table p. 14, `ESC q` p. 16, `ESC h` / `ESC i` p. 18, Appendix B (Duo tape) p. 23 ff. https://download.dymo.com/dymo/technical-data-sheets/LW%20450%20Series%20Technical%20Reference.pdf |
| SE450 | *LabelWriter SE450 Technical Reference*, "USB Specifications" page (PID 0x0400, USB printer class). https://download.dymo.com/UserManuals/labelwriter%20user%20guides/LWSE450_Tech_Ref/Content/USB%20Specifications.htm |
| DRV | `dymo-cups-drivers` (GPL, Sanford L.P.), GitHub mirror https://github.com/matthiasbock/dymo-cups-drivers . Files: model to driver class `src/lw/raster2dymolw.cpp`; per-model head width `src/lw/CupsFilterLabelWriter.cpp`; commands `src/lw/LabelWriterDriver.cpp`; per-model tape constants `src/lm/CupsFilterLabelManager.cpp`; tape job end `src/lm/LabelManagerDriver.cpp`; 5xx protocol `src_v2/lw/LabelWriterDriverV2.cpp` and `src_v2/lw/LabelWriterDriverInitializer.cpp`; PPD list `ppd/`. |
| USBIDS | Linux USB ID repository, vendor 0922. http://www.linux-usb.org/usb.ids |
| TL-LW | thermal-label LabelWriter hardware table. https://thermal-label.github.io/labelwriter/hardware and per-device data https://github.com/thermal-label/labelwriter/tree/main/packages/core/data/devices |
| TL-LM | thermal-label LabelManager hardware table. https://thermal-label.github.io/labelmanager/hardware and per-device data https://github.com/thermal-label/labelmanager/tree/main/packages/core/data/devices |
| TL-D1 | thermal-label, D1 chassis and USB topology. https://thermal-label.github.io/d1-core/topology |
| TL-LW5 | thermal-label, LW5 raster protocol (550 generation). https://thermal-label.github.io/labelwriter/protocol/lw5-raster |
| TL-NFC | thermal-label LabelWriter overview, "550 series NFC label lock". https://thermal-label.github.io/labelwriter/ |
| TL-CONN | thermal-label, "Connecting your printer" (per-OS setup, mode-switch PIDs). https://thermal-label.github.io/connecting |
| LABELLE | labelle (Python LabelManager driver), PID list `src/labelle/lib/constants.py` and interface selection `src/labelle/lib/devices/usb_device.py`. https://github.com/labelle-org/labelle |
| WEBUSB | WebUSB spec, "protected interface classes". https://wicg.github.io/webusb/#protected-interface-class |
| CR-BUILD | Chrome for Developers, "Building a device for WebUSB", OS sections. https://developer.chrome.com/docs/capabilities/build-for-webusb |
| CR-USB | Chrome for Developers, "Access USB devices on the web", Linux udev tip. https://developer.chrome.com/docs/capabilities/usb |
| CR-DETACH | Chromium source: kernel driver detach allowlist (`usblp` allowed) and detach call. https://chromium.googlesource.com/chromium/src/+/main/services/device/usb/usb_interface_detach_allowlist.cc and https://chromium.googlesource.com/chromium/src/+/main/services/device/usb/usb_device_handle_usbfs.cc |
| CR-BLOCK | Chromium WebUSB device blocklist (no `0x0922` entry as of 2026-11-11). https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/usb/usb_blocklist.cc |
| WEBZLP | WebZLP, "Windows Printer Driver Conflicts" (usbprint vs WinUSB, Zadig). https://cellivar.github.io/WebZLP/docs/windows_driver |

## Protocol families in one paragraph each

**LW raster (classic).** One USB printer-class interface per print mechanism, 1-byte `ESC A`
status, raster lines as `ESC B` / `ESC D` / `SYN` (or `ETB` RLE), label length `ESC L`, feeds
`ESC E` / `ESC G`. Shared by the LabelWriter 3xx, 4xx and 450 generations, the SE450, and the
label side of every DUO [TR450 p. 15 ff., DRV `raster2dymolw.cpp`]. This is what our label engine
already sends. In DRV, the 400, 400 Turbo, DUO Label, 4XL, 450, 450 Turbo and 450 DUO Label all
use the same driver class `CLabelWriterDriver400`; the Twin Turbos use a subclass that adds
`ESC q`; everything older (300, 310, 315, 320, 330, 330 Turbo, SE450) uses the base class, which
ends every label with `ESC E` and never sends `ESC G` [DRV `raster2dymolw.cpp`,
`LabelWriterDriver.cpp`].

**D1 tape.** `ESC A..E` plus `SYN`, no `ETB`, 1-byte status, host declares tape type with
`ESC C` [TR450 App. B, TL-D1]. Shared by the DUO tape side and the standalone LabelManager
models. DRV drives all of them with one class and only per-model constants (head width, leaders,
minimum page length, auto cutter yes/no) [DRV `CupsFilterLabelManager.cpp`].

**LW5 raster (550 generation).** Not wire compatible: job header `ESC s`, per-label 12-byte
`ESC D` header followed by an unframed bitmap, 32-byte status, host lock via `ESC A 1`, mandatory
status handshake between labels, `ESC Q` trailer [TL-LW5, DRV `src_v2/lw/LabelWriterDriverV2.cpp`].
Plus NFC media validation in the printer [TL-NFC]. A separate driver, not a table entry.

## 1. Model table

Columns: **PID** all known product IDs (hex), **Proto** protocol family, **Head** dots and dpi,
**USB interfaces** printer-class interfaces and their role, **Special** model-specific commands
or behaviour, **WebUSB** whether the print interface is a non-protected class (printer class
0x07 is not on the WebUSB protected list; HID 0x03 and mass storage 0x08 are [WEBUSB]; no DYMO
device is on Chromium's device blocklist [CR-BLOCK]), **Lock-in** media restrictions.

### 1a. LabelWriter (die-cut / continuous paper labels)

| Model | PID | Proto | Head | USB interfaces | Special | WebUSB | Lock-in |
|---|---|---|---|---|---|---|---|
| LabelWriter DUO (128-dot tape), first gen | `0x001D` [device, TL-LW] | LW raster + D1 | label 672 @ 300; tape 128 @ 180 [device, TR450 App. B] | IF0 label, IF1 tape, both 0x07 [device] | none beyond our driver | yes [device] | none |
| LabelWriter DUO (96-dot tape), first gen | `0x0017` [TL-LW, TL-D1] UNVERIFIED (single source) | LW raster + D1 | label 672 @ 300; tape 96 @ 180, max `ESC D` 12 [TR450 p. 23, DRV `lwduot.ppd`, MaxPrintableWidth 96] | IF0 label, IF1 tape [TL-D1] UNVERIFIED | tape: max 19 mm cassette [TL-D1]; status bits 0..1 report cassette size on the 96-dot engine [DRV `LabelManagerLanguageMonitor`, see `docs/protocol.md`] | yes, printer class [TL-D1] UNVERIFIED | none |
| LabelWriter 450 Duo | `0x0023` [TR450 p. 14] | LW raster + D1 | label 672 @ 300 [TR450 p. 7]; tape 128 @ 180 [TR450 App. B, DRV `lw450dt.ppd` MaxPrintableWidth 128] | composite, "enumerates twice, as two different printers" [TR450 p. 14]; IF0 label, IF1 tape [TL-D1] | DRV tape constants identical to DUO Tape 128 (leaders 75/61/43, min page 133, auto cut) [DRV `CupsFilterLabelManager.cpp`] | yes, printer class [TR450 p. 14] | none |
| LabelWriter 450 | `0x0020` [TR450 p. 14, USBIDS] | LW raster | 672 @ 300 [TR450 p. 7] | 1 x 0x07 [TR450 p. 14] | `ESC i` 300 x 600 graphics mode, generic to the 450 series [TR450 p. 18] | yes | none |
| LabelWriter 450 Turbo | `0x0021` [TR450 p. 14] | LW raster | 672 @ 300 | 1 x 0x07 | no Turbo-specific command in TR450; speed is mechanical. DRV PPD offers 300x600 resolution (`ESC i`) [DRV `lw450t.ppd`] | yes | none |
| LabelWriter 450 Twin Turbo | `0x0022` [TR450 p. 14] | LW raster | 2 x 672 @ 300 [TR450 p. 7] | 1 x 0x07, both rolls behind one interface [TR450 p. 16, TL-LW] | `ESC q n` roll select, `0x30` auto / `0x31` left / `0x32` right, sent once after reset at job start [TR450 p. 16, DRV `CLabelWriterDriverTwinTurbo::StartDoc`]; status bit 3 = roll changed [DRV `LabelWriterLanguageMonitor.h`] | yes | none |
| LabelWriter 400 | `0x0019` [USBIDS, TL-LW verified] | LW raster | 672 @ 300 [TL-LW] | 1 x 0x07 [3P] UNVERIFIED class | same DRV class as DUO Label [DRV] | yes, assumed printer class UNVERIFIED | none |
| LabelWriter 400 Turbo | `0x001A` [USBIDS, TL-LW] | LW raster | 672 @ 300 | 1 x 0x07 UNVERIFIED | same DRV class as DUO Label [DRV] | yes UNVERIFIED | none |
| LabelWriter Twin Turbo (400 gen) | `0x0018` [TL-LW] UNVERIFIED (single source) | LW raster | 2 x 672 @ 300 [TL-LW] | 1 interface, `ESC q` [DRV, TL-LW] | as 450 Twin Turbo [DRV uses same class for "DYMO LabelWriter Twin Turbo"] | yes UNVERIFIED | none |
| LabelWriter 4XL | `0x001F` [TL-LW, verified there] | LW raster | 1248 dots (156 bytes per line) @ 300 [DRV `CupsFilterLabelWriter.cpp` SetMaxPrintWidth(156), TL-LW] | 1 x 0x07 UNVERIFIED class | wide head; some page sizes carry a non-zero x offset (`cupsInteger0` 33 / 44) while 57 mm labels use 0 [DRV `lw4xl.ppd`] | yes UNVERIFIED | none |
| LabelWriter 330 | `0x0007` [USBIDS, TL-LW] | LW raster | 672 @ 300 (DRV default 84 bytes) | USB + serial [TL-LW] | base DRV class: `ESC E` after every label, no `ESC G` [DRV] | UNVERIFIED (USB class not documented) | none |
| LabelWriter 330 Turbo | `0x0008` [TL-LW, lsusb quoted in TL-LW data file] | LW raster | 672 @ 300 [TL-LW, DRV `lw330t.ppd`] | USB + serial | base DRV class, as 330 | UNVERIFIED; TL-LW reports USB printing works on Linux | none |
| LabelWriter 310 | `0x0009` [USBIDS] | LW raster | 464 dots (58 bytes) @ 300 [DRV SetMaxPrintWidth(58)] | USB + serial [TL-LW] | base DRV class | UNVERIFIED | none |
| LabelWriter 300 / 315 / 320 | 300: `0x0009` per TL-LW, conflicts with USBIDS (310); 315 / 320: unknown | LW raster | 300 / 315: 464 @ 300 [DRV]; 320: 672 @ 300 assumed (DRV default) UNVERIFIED | unknown | base DRV class | UNVERIFIED | none |
| LabelWriter SE450 | `0x0400` [SE450, USBIDS] | LW raster | 448 dots (56 bytes) @ 203 dpi [DRV SetMaxPrintWidth(56), `se450.ppd` 203dpi] | 1 x 0x07 [SE450] + RS-232 | resolution command `ESC y` (203 x 203) or `ESC z` (203 x 138) sent at job start [DRV `SendResolution`]; base DRV class; firmware does not accept `ESC G` / `ESC q` [TL-LW] | yes | none |
| LabelWriter 550 | `0x0028` [TL-LW, verified there over WebUSB on macOS] | **LW5 raster** | 672 @ 300 [TL-LW5] | 1 x 0x07 [TL-LW5] | different protocol (see above); `ESC T` speed, `ESC U` SKU dump [TL-LW5] | yes (class), protocol differs | **NFC chip on genuine rolls required, non-genuine rejected in firmware** [TL-NFC, TL-LW5 bay status 10] |
| LabelWriter 550 Turbo | `0x0029` [TL-LW] | LW5 raster | 672 @ 300 | 1 x 0x07 + Ethernet [TL-LW5] | high-speed mode via `ESC T`, only for 5xx models in DRV (`IsLW5xxPrinter`) [DRV `src_v2/lw/LabelWriterDriverInitializer.cpp`] | yes (class) | NFC lock [TL-NFC] |
| LabelWriter 5XL | `0x002A` [TL-LW] | LW5 raster | 1248 @ 300 [TL-LW5] | 1 x 0x07 + Ethernet [TL-LW5] | as 550 | yes (class) | NFC lock [TL-NFC] |
| LabelWriter 550 Pro / 550 Twin Pro / 5XL Pro | unknown | LW5 raster (DRV `lw550p.ppd`, `lw550tp.ppd`, `lw5xlp.ppd` use `raster2dymolw_v2`) [DRV] | unknown | unknown | unknown | unknown | NFC lock assumed UNVERIFIED |
| LabelWriter Wireless | `0x0031` [TL-LW, marked "PID unconfirmed" there] UNVERIFIED | **conflict**: TL-LW lists LW raster, DRV `lww.ppd` uses the v2 (5xx-style) filter `raster2dymolw_v2` [DRV] UNVERIFIED | 672 @ 300 [TL-LW] | USB + Wi-Fi | unknown | unknown | unknown |
| LabelWriter EL40 / EL60 / Turbo (original) | none, serial only [TL-LW] | LW raster (serial) | n/a | no USB | n/a | no | none |

### 1b. LabelManager and LabelPoint (D1 tape, standalone)

All D1 standalone chassis put the print path on **interface 0** (bulk OUT `0x05` / IN `0x85`,
64-byte packets), with a vestigial mass-storage interface and a HID interface beside it
[TL-D1]. The same byte stream prints over the printer-class or the HID endpoint [TL-D1]. labelle
opens the printer-class interface first and falls back to HID [LABELLE `usb_device.py`].
Head widths below are DRV `SetMaxPrintableWidth` values; thermal-label uses 64 for every
standalone model, which **conflicts** with DRV for several models (marked).

| Model | PID (printer mode) | Decoy PID (mass storage) | Head (DRV) | Leaders normal / min, min page, auto cut [DRV] | WebUSB | Notes |
|---|---|---|---|---|---|---|
| LabelManager PnP | `0x1002` [TL-LM verified, LABELLE] | `0x1001` [TL-D1, LABELLE] | 64 @ 180 | 75 / 58, 30, **no cutter** | printer mode: yes (IF0 class 0x07) [TL-D1]; decoy mode: no, mass storage is a protected class [WEBUSB] | mode switch `ESC Z 01` sent by the host (Linux `usb_modeswitch`); TL-D1 says macOS / Windows switch when the OS driver loads; not possible from the browser [TL-D1] |
| LabelManager 280 | `0x1006` [TL-LM, LABELLE] | `0x1005` [TL-D1, LABELLE] | no DRV entry; 64 per TL-LM UNVERIFIED | unknown | as PnP | single-sourced from labelle [TL-LM] |
| LabelManager 420P | `0x1004` [TL-LM; LABELLE marks it unconfirmed] UNVERIFIED | `0x1003` | **128** per DRV vs 64 per TL-LM (conflict) | 75 / 58, 63, no cutter | as PnP | accepts up to 19 mm [TL-LM] |
| LabelManager Wireless PnP | `0x1008` [TL-LM; LABELLE unconfirmed] UNVERIFIED | `0x1007` | **256** per DRV, PPD default 300 dpi [DRV `lmwpnp.ppd`] vs 64 @ 180 per TL-LM (conflict) | 125 / 92, 222, auto cut | as PnP | geometry unclear, treat as different |
| LabelManager PC | `0x0011` [TL-LM, LABELLE] | none [TL-LM] | 96 @ 180 | 75 / 55, 133, no cutter | UNVERIFIED (class of IF0 not documented) | older model |
| LabelManager PC II | `0x001C` [LABELLE] UNVERIFIED (single source) | none | 128 @ 180 | 75 / 55, 133, no cutter | UNVERIFIED | |
| LabelManager 400 | `0x0013` [USBIDS, TL-LM] | none [TL-LM] | 96 @ 180 | 75 / 55, 133, auto cut | UNVERIFIED | |
| LabelManager 450 | unknown | unknown | 128 @ 180 | 75 / 55, 133, auto cut | unknown | DRV `lm450.ppd` only |
| LabelPoint 350 | `0x0015` [TL-LM, LABELLE] | none | 96 @ 180 | 75 / 55, 133, no cutter | UNVERIFIED | |
| MobileLabeler | `0x1009` [TL-LM; LABELLE unconfirmed] | unknown | n/a | n/a | n/a | DRV uses a different filter `raster2dymolm_v2`, 300 dpi [DRV `lmmls.ppd`]; TL-LM status "broken" |
| LabelManager 500TS | unknown | unknown | 256 | 125 / 92, 222, auto cut, plus a "TS device" command wrapper [DRV `SetTSDevice`] | unknown | different framing |

## 2. Verdict per model

The verdicts assume one **one-time refactor** first (R1 below): the driver reads a device table
instead of the constants that are hard-coded today (`DUO_PRODUCT_ID` and `ENGINE_INTERFACE` in
`webusb-driver.ts`; `LABEL_HEAD_DOTS`, `LABEL_MAX_BYTES_PER_LINE`, `TAPE_HEAD_DOTS`,
`TAPE_MAX_BYTES_PER_LINE`, `TAPE_HEAD_TO_CUTTER_DOTS`, `TAPE_NORMAL_LEADER_DOTS`,
`TAPE_MIN_LABEL_DOTS` in `commands.ts`, used by `raster.ts` and `media.ts`). After R1, "table
entry only" means a contributor adds data and nothing else.

R1 scope, for reference: select the device by PID on connect (today `connect()` accepts any
`0x0922` device and `reconnect()` takes the first one); map engine to interface number from the
table; pass head dots, dpi and tape constants into `buildLabelJob`, `buildTapeJob`, `rasterize`
and the media catalog; let the media catalog filter by engine (max tape width, wide labels); and
keep calibration per device (it already is per device in spirit, see `raster.ts`).

### Same family, table entry only

| Model | Why | Confidence |
|---|---|---|
| LabelWriter 450 Duo (`0x0023`) | Same two protocols, same interface layout, same head widths, DRV tape constants identical to DUO Tape 128 | High: PID and composite layout from TR450, constants from DRV |
| LabelWriter DUO 96-dot (`0x0017`) | Same layout; tape head 96 dots, max 19 mm tape, `ESC D` max 12 | Medium: PID single-sourced (TL-LW / TL-D1); head width from TR450 and DRV |
| LabelWriter 450 (`0x0020`) | Label engine only, same DRV class as our DUO label side | High |
| LabelWriter 450 Turbo (`0x0021`) | As 450 | High |
| LabelWriter 400 (`0x0019`) | Same DRV class as DUO Label; verified by TL-LW over USB | High |
| LabelWriter 400 Turbo (`0x001A`) | As 400 | Medium-high |

For the single-engine models the device has only a `label` engine on interface 0; the editor
must hide the tape media.

### Same family, needs small driver changes

| Model | Changes beyond a table entry | Confidence |
|---|---|---|
| LabelWriter 4XL (`0x001F`) | (a) bytes-per-line limit 156 instead of 84, `ESC B` range up to 155; (b) wide media in the catalog (4 x 6 in shipping etc.) with optional per-media x offset; (c) the editor must allow designs wider than 57 mm; (d) where a 57 mm roll sits on the 104 mm head is unknown, needs the calibration page | Medium: head width from DRV, PID verified by TL-LW, placement UNVERIFIED |
| LabelWriter 450 Twin Turbo (`0x0022`) and Twin Turbo (`0x0018`) | (a) two logical engines on one interface, distinguished by `ESC q 0x31` / `0x32` after the resync at job start; (b) UI roll picker incl. auto (`0x30`); (c) status is one byte for the whole printer, how to read per-roll paper-out is unknown; bit 3 "roll changed" should be decoded | Medium for 450 TT (TR450); low for `0x0018` (PID single-sourced) |
| LabelWriter SE450 (`0x0400`) | (a) 203 dpi engine, 448 dots; (b) send `ESC y` (203 x 203) at job start; (c) end every label with `ESC E`, never `ESC G`; (d) separate media calibration | Medium: PID and class from SE450, rest from DRV and TL-LW |
| LabelWriter 330 / 330 Turbo (`0x0007` / `0x0008`) | End every label with `ESC E` instead of `ESC G` between copies (base DRV class); otherwise as 400 | Medium-low: USB class and exact firmware command set UNVERIFIED |
| LabelWriter 310 (`0x0009`) and 300 / 315 | As 330, plus 464-dot head (58 bytes) | Low: PIDs partly conflicting, 315 / 320 PIDs unknown |
| LabelManager PnP (`0x1002`) | (a) D1 engine on interface 0, not 1; (b) 64-dot head; (c) no auto cutter, so skip `ESC E` and tell the user to cut by hand; (d) DRV min leader 58 and min page 30 instead of 61 / 133; (e) detect the decoy PID `0x1001` and show OS-specific help, because a device in mass-storage mode cannot be claimed via WebUSB | Medium: protocol identical and TL-LM verified the device; whether macOS / Windows switch out of the decoy mode without vendor software is UNVERIFIED |
| LabelManager 400 (`0x0013`), PC (`0x0011`), PC II (`0x001C`), LabelPoint 350 (`0x0015`) | As PnP (a), (c) where applicable, per-model head width and leaders from DRV; no decoy mode | Low-medium: PIDs from labelle / TL-LM, interface class UNVERIFIED, all untested in TL-LM |
| LabelManager 280 (`0x1006`), 420P (`0x1004`) | As PnP incl. decoy handling; head width conflict for 420P (DRV 128 vs TL-LM 64) must be resolved by a device owner | Low |

### Different protocol or not feasible without hardware

| Model | Reason |
|---|---|
| LabelWriter 550, 550 Turbo, 5XL, 550 Pro, 550 Twin Pro, 5XL Pro | LW5 protocol (new job framing, 32-byte status, lock and per-label handshake) and NFC media lock. A port is possible from TL-LW5 and DRV `src_v2`, but it is a second driver, and the media lock defeats the project goal of using cheap or existing rolls. Not a table entry. |
| LabelWriter Wireless | PID unconfirmed and sources disagree on the protocol (TL-LW: LW raster, DRV: v2 filter). Needs a device owner to probe first. |
| LabelManager Wireless PnP | DRV geometry (256 dots, 300 dpi, leaders 125 / 92) does not match the D1 tiers; needs a probe. |
| MobileLabeler, LabelManager 500TS | Different DRV filter (`raster2dymolm_v2`) or extra TS command framing; TL-LM reports MobileLabeler as broken. |
| LabelWriter EL40, EL60, original Turbo | Serial only, no USB. |

## 3. Proposed device table (TypeScript, proposal only, not in `src/`)

Design goals: one entry per USB product, engines as a list (DUO = 2, Twin Turbo = 2 on one
interface, everything else = 1), protocol-specific fields in tagged unions, provenance and
verification status in the data so the UI can warn on unverified entries. `PrintTarget` in
`types.ts` would become an engine id instead of the fixed `'label' | 'tape'` pair.

```ts
export type Protocol = 'lw-raster' | 'd1-tape';
export type Verification = 'verified' | 'community-verified' | 'unverified';

export interface DeviceSpec {
  key: string;                    // 'LW_450_DUO'
  name: string;                   // shown only in the hardware table, never as branding
  usb: {
    vendorId: 0x0922;
    productIds: number[];         // all PIDs that behave identically
    /** Mass-storage decoy PID: if seen, show setup help instead of connecting. */
    decoyProductIds?: number[];
  };
  /** Optional cross-check: IEEE 1284 MDL strings per interface (see protocol.md probe). */
  mdl?: Record<number, string>;   // { 0: 'LabelWriter DUO Label', 1: 'LabelWriter DUO Tape 128' }
  engines: EngineSpec[];
  verification: Verification;
  sources: string[];              // URLs, as in docs/printer-families.md
  notes?: string;
}

interface EngineBase {
  id: string;                     // 'label', 'tape', 'left', 'right'
  interfaceNumber: number;        // USB interface to claim
  protocol: Protocol;
  dpi: number;                    // across the head = along the feed in text mode
  headDots: number;               // 672, 1248, 464, 448, 128, 96, 64
  /** Default calibration, overridable per physical unit from the calibration page. */
  calibration: {
    headOffsetDots: number;       // label edge relative to dot 0 (DUO: -18)
    feedStartDots: number;        // DUO label: 62.4
    feedScale: number;            // DUO label: 1.0095
    tapeCentreCorrectionDots?: Record<number, number>; // per tape width mm
  };
}

export interface LwRasterEngine extends EngineBase {
  protocol: 'lw-raster';
  /** ESC q byte sent after resync; Twin Turbo only (0x31 left, 0x32 right). */
  rollSelect?: 0x30 | 0x31 | 0x32;
  /** 'short' = ESC G between labels, ESC E after the last (4xx/450/DUO). 'full' = ESC E always (3xx, SE450). */
  interLabelFeed: 'short' | 'full';
  /** ESC y / ESC z resolution command for the 203 dpi SE450; absent = do not send. */
  resolutionCommand?: 0x79 | 0x7a;
  supportsGraphicsMode: boolean;  // ESC i (300 x 600)
  mediaFamilies: Array<'lw' | 'lw-wide'>;
  /** Status bit 3 meaning: roll changed (Twin Turbo) or unused. */
  statusRollChangedBit?: boolean;
}

export interface D1TapeEngine extends EngineBase {
  protocol: 'd1-tape';
  maxTapeMm: 12 | 19 | 24;
  autoCut: boolean;               // false: no ESC E, user cuts by hand
  headToCutterDots: number;       // DRV MinLeader: 61 (DUO), 58 (PnP), 55 (LM 400)
  normalLeaderDots: number;       // DRV NormalLeader: 75
  minPageDots: number;            // DRV MinPageLines: 133 (DUO), 30 (PnP)
  /** 96-dot DUO: status bits 0..1 report the cassette size. */
  statusReportsTapeWidth: boolean;
}

export type EngineSpec = LwRasterEngine | D1TapeEngine;
```

Example entries, values from the tables above:

```ts
const LW_DUO_128: DeviceSpec = {
  key: 'LW_DUO_128', name: 'LabelWriter DUO (128-dot tape)',
  usb: { vendorId: 0x0922, productIds: [0x001d] },
  mdl: { 0: 'LabelWriter DUO Label', 1: 'LabelWriter DUO Tape 128' },
  verification: 'verified', sources: ['docs/protocol.md'],
  engines: [
    { id: 'label', interfaceNumber: 0, protocol: 'lw-raster', dpi: 300, headDots: 672,
      interLabelFeed: 'short', supportsGraphicsMode: true, mediaFamilies: ['lw'],
      calibration: { headOffsetDots: -18, feedStartDots: 62.4, feedScale: 1.0095 } },
    { id: 'tape', interfaceNumber: 1, protocol: 'd1-tape', dpi: 180, headDots: 128,
      maxTapeMm: 24, autoCut: true, headToCutterDots: 61, normalLeaderDots: 75, minPageDots: 133,
      statusReportsTapeWidth: false,
      calibration: { headOffsetDots: 0, feedStartDots: 0, feedScale: 1 } },
  ],
};

const LW_450_TWIN_TURBO: DeviceSpec = {
  key: 'LW_450_TWIN_TURBO', name: 'LabelWriter 450 Twin Turbo',
  usb: { vendorId: 0x0922, productIds: [0x0022] },
  verification: 'unverified',
  sources: ['https://download.dymo.com/dymo/technical-data-sheets/LW%20450%20Series%20Technical%20Reference.pdf'],
  engines: (['left', 'right'] as const).map((id) => ({
    id, interfaceNumber: 0, protocol: 'lw-raster' as const, dpi: 300, headDots: 672,
    rollSelect: id === 'left' ? 0x31 : 0x32, interLabelFeed: 'short' as const,
    supportsGraphicsMode: true, mediaFamilies: ['lw' as const], statusRollChangedBit: true,
    calibration: { headOffsetDots: 0, feedStartDots: 0, feedScale: 1 },
  })),
};
```

Calibration defaults for any unverified device should be neutral (0 / 0 / 1) and the UI should
route the user to the calibration page before the first real print.

## 4. Known OS issues (WebUSB in Chromium)

**macOS.** Chrome needs no extra setup; a page can claim any interface that no kernel driver or
other application has claimed [CR-BUILD]. Confirmed on our DUO: no kernel driver claims either
printer interface [device]. TL-CONN reports one exception: if the printer was added in System
Settings, Printers & Scanners, remove it there so CUPS does not hold it [TL-CONN] (UNVERIFIED by
us; we have not reproduced a conflict). For LabelManager models in mass-storage decoy mode, TL-D1
states macOS switches them "when the OS driver loads", which implies the DYMO software must be
installed [TL-D1] UNVERIFIED.

**Windows.** Windows binds the class driver `usbprint.sys` (or the DYMO driver) to printer-class
interfaces; a user-mode program, including Chrome, can only open a device whose interface is
bound to WinUSB [CR-BUILD, WEBZLP]. The documented workaround is replacing the driver with Zadig
(WinUSB), which breaks normal Windows printing to that interface and shows an unsigned-driver
warning [WEBZLP]. For a composite DUO this applies per interface (label and tape are separate
functions). Note: TL-CONN claims WebUSB on Windows "does not need Zadig", which contradicts
CR-BUILD and WEBZLP; treat as UNVERIFIED until a Windows user confirms either way. Our driver is
untested on Windows.

**Linux.** Two separate issues. (1) Permissions: most distributions open USB device nodes
read-only for normal users; a udev rule for vendor `0922` is needed (`MODE="0664"`,
`GROUP="plugdev"` per CR-USB, or `TAG+="uaccess"` per TL-CONN) [CR-USB, TL-CONN]. (2) The kernel
`usblp` driver binds every printer-class interface. Current Chromium detaches it automatically
before claiming: `usblp` is on the detach allowlist, and the detach happens in
`UsbDeviceHandleUsbfs` (Linux and Android builds) [CR-DETACH]. Older Chrome builds may not have
this; then `usblp` must be unbound or blacklisted manually UNVERIFIED (version cut-off not
researched). CUPS or `ipp-usb` may also hold the device [TL-CONN]. LabelManager decoy PIDs need
`usb_modeswitch` (`ESC Z 01`) on Linux [TL-D1, TL-CONN].

**All platforms.** WebUSB needs a secure context and a user gesture for the first pairing
[CR-USB]. HID (0x03) and mass storage (0x08) are protected classes in WebUSB [WEBUSB], so a
LabelManager can only be driven through its printer-class interface, never through its HID or
mass-storage interface; WebHID would be the separate route for HID (not evaluated here).

## Open questions (need a device owner)

1. DUO 96-dot `0x0017`: confirm PID, interface layout and the 1284 MDL string ("LabelWriter DUO
   Tape" per DRV `lwduot.ppd` model name).
2. 4XL: where a 57 mm roll sits relative to head dot 0; DRV gives offset 0 for narrow labels.
3. Twin Turbo: how paper-out is reported per roll with a single status byte; whether `ESC q`
   must be repeated per job or persists.
4. LabelManager PnP / 280 / 420P on macOS and Windows: does the device leave mass-storage mode
   without DYMO software installed, and is the printer-class interface (not only HID) present
   afterwards?
5. LabelManager head widths: DRV (64 / 96 / 128 / 256) vs thermal-label (64 everywhere).
6. LabelWriter Wireless: PID and protocol (classic vs v2).
7. 3xx series: USB class and whether they accept `ESC h` / density commands like the 4xx
   (DRV sends them to all models, so probably yes).
8. Windows: does WebUSB work at all without Zadig for these printers (sources conflict).
