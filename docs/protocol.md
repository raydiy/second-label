# DYMO LabelWriter DUO: USB protocol reference

Byte-level protocol for both engines of the first-generation **DYMO LabelWriter DUO**
(VID `0x0922`, PID `0x001D`), as used by `src/printer/`. Every statement is tagged with its
evidence level:

- **[device]** measured on a real unit (serial redacted) with `spike/probe.mjs`
- **[TR]** DYMO technical reference manual
- **[DRV]** official DYMO CUPS driver source (`dymo-cups-drivers`)
- **[3P]** third-party open-source documentation
- **[unconfirmed]** inferred, not yet verified on the device

## Sources

| Key | Source |
|---|---|
| TR | *LabelWriter 450 Series Printers Technical Reference Manual*, Sanford L.P., Rev. 10/09, covers the 450 Duo incl. Appendix B "Printing to the LabelWriter Duo Tape Printer". https://download.dymo.com/dymo/technical-data-sheets/LW%20450%20Series%20Technical%20Reference.pdf |
| DRV | `dymo-cups-drivers` 1.4.0.5 (GPL, Sanford L.P.), GitHub mirror https://github.com/matthiasbock/dymo-cups-drivers . Files used: `src/lw/LabelWriterDriver.cpp`, `src/lw/CupsFilterLabelWriter.cpp`, `src/lw/raster2dymolw.cpp`, `src/lw/LabelWriterLanguageMonitor.h`, `src/lm/LabelManagerDriver.cpp`, `src/lm/CupsFilterLabelManager.cpp`, `src/lm/LabelManagerLanguageMonitor.{h,cpp}`, `ppd/lwduol.ppd` (DUO Label), `ppd/lwduot.ppd` (DUO Tape, 96 dot), `ppd/lwduot2.ppd` (DUO Tape 128). Same tree on DragonFly BSD: https://grok.dragonflybsd.org/source/xref/dports/print/dymo-cups-drivers/dymo-cups-drivers-1.4.0.5/src/lw/LabelWriterDriver.cpp |
| 3P-LW | thermal-label, LW raster protocol: https://thermal-label.github.io/labelwriter/protocol/lw-raster |
| 3P-D1 | thermal-label, D1 tape protocol: https://thermal-label.github.io/d1-core/protocol and topology: https://thermal-label.github.io/d1-core/topology |
| 3P-HW | thermal-label, device table (DUO 0x0017 = 96 dot, 0x001D = 128 dot): https://thermal-label.github.io/labelwriter/hardware |
| DS | DYMO LabelWriter label datasheet (Newell Brands 2022), Farnell: https://www.farnell.com/datasheets/3749804.pdf . Cross-check: RS Components DYMO catalogue https://docs.rs-online.com/02d5/0900766b815f1821.pdf |
| CONT | DYMO continuous paper 57 mm x 91 m, item 2191636 / US 30270: https://labelzone.co.uk/collections/labelwriter-labels/products/dymo-2191636-labelwriter-continuous-paper-roll |

No dedicated "LabelWriter DUO" or "LabelManager PnP" technical reference was found. The 450
Series manual's Appendix B is the DYMO-authored tape spec and states it applies to "all
LabelWriter Duo printers". A *LabelWriter 400 Series Technical Reference* exists (listed on
ManualsLib) but no downloadable copy was found; [3P-D1] states the 400 and 450 manuals carry the
same D1 specification.

## Device probe (real output)

`spike/probe.mjs` (Node 26 / Bun 1.3, npm `usb` 3.3.0, which wraps nusb and exposes the WebUSB
API) opens the device, lists descriptors, reads the IEEE 1284 Device ID of each interface,
claims it, sends status requests only, and releases it. No print or feed data.

```
== Device
{ productName: 'DYMO LabelWriter DUO', manufacturerName: 'DYMO', serialNumber: 'XXXXXXXXXXXXXX',
  vendorId: '0x0922', productId: '0x001d', deviceVersion: '0.5.3', usbVersion: '2.0', deviceClass: 0 }

== Configuration 1, 2 interface(s)

-- Interface 0 alt 0: class 7 sub 1 proto 2
   endpoints: IN 0x81 bulk packetSize 16, OUT 0x01 bulk packetSize 16
   IEEE 1284 Device ID: MFG:DYMO;CMD: ;MDL:LabelWriter DUO Label;CLASS:PRINTER;
                        DESCRIPTION:DYMO LabelWriter DUO Label;SERN:XXXXXXXXXXXXXX;

-- Interface 1 alt 0: class 7 sub 1 proto 2
   endpoints: IN 0x82 bulk packetSize 64, OUT 0x02 bulk packetSize 64
   IEEE 1284 Device ID: MFG:DYMO;CMD: ;MDL:LabelWriter DUO Tape 128;CLASS:PRINTER;
                        DESCRIPTION:DYMO LabelWriter DUO Tape 128;SERN:XXXXXXXXXXXXXX;

== Interface 0 (LABEL)
   ESC V  -> [8] 39 33 31 30 35 76 30 4e   ascii "93105v0N"
   ESC @  -> (no reply, no paper motion)
   ESC A  -> [1] 03   = ready + top of form
== Interface 1 (TAPE)
   ESC A  -> [1] c0   = cassette present (0x40) + bit 7 (0x80, "ignore" per TR)
```

Findings:

1. **Interface 0 = label engine, interface 1 = tape engine** [device]. Evidence: the 1284 Device
   IDs ("LabelWriter DUO Label" / "LabelWriter DUO Tape 128"), and the status bytes match the
   LabelWriter (`0x03`) and D1 (`0x40` cassette bit) semantics respectively. This matches [3P-D1].
2. **This unit has the 128-dot tape head** [device]. The MDL string is exactly the model name of
   `ppd/lwduot2.ppd` [DRV]. PID 0x001D = "LabelWriter Duo (128-dot)" per [3P-HW]; the 96-dot
   variant is PID 0x0017.
3. The label endpoint uses **16-byte packets**, the tape endpoint 64-byte packets [device].
   `transferIn` must request at least the packet size to avoid babble errors; the driver requests
   exactly `packetSize`.
4. The tape engine answers ESC A with **one byte**, not the eight the TR describes [device].
5. **Claiming works on macOS** without any kernel driver detach [device]. Note: nusb, like Chromium,
   rejects the interface-recipient `GET_DEVICE_ID` control request until the interface is claimed
   (first run returned `controlTransferIn error: invalid state`); claim first, then query.
6. Incident during probing: the first probe run also sent `ESC V` to interface 1 before the
   1284-based detection was fixed. The tape engine replied with the same "93105v0N" string and
   kept answering ESC A normally. No media moved. ESC V is not part of the documented D1 set,
   and [3P-D1] warns that unknown opcodes can upset the D1 parser, so the driver never sends it
   to the tape side.

USB topology, both engines on one device, claimed independently:

| | Label engine | Tape engine |
|---|---|---|
| Interface | 0 | 1 |
| Bulk OUT / IN | `0x01` / `0x81` | `0x02` / `0x82` |
| wMaxPacketSize | 16 | 64 |
| 1284 MDL | LabelWriter DUO Label | LabelWriter DUO Tape 128 |
| Head | 672 dots, 300 dpi, 56.90 mm [TR p. 7] | 128 dots, 180 dpi, 18.06 mm [TR App. B, device] |
| Vendor PPD | `lwduol.ppd` | `lwduot2.ppd` |
| Protocol | LabelWriter ESC set | D1 subset (ESC A..E + SYN) |

The DUO is a composite USB device that "will enumerate twice, as two different printers" [TR p. 14].
The TR's PID table lists only the 450 family (0x0020..0x0023); 0x001D is the earlier DUO.

## Label engine (interface 0)

All commands go to bulk OUT; replies come on bulk IN. Parameters are binary bytes. Hex in
parentheses. Page numbers refer to [TR].

### Commands

| Command | Bytes | Meaning | Source |
|---|---|---|---|
| ESC @ | `1B 40` | Reset all parameters (dot tab, line tab, bytes per line...) to defaults, set top-of-form true. Acts immediately, discards buffered data. | TR p. 17, [device] no motion |
| ESC * | `1B 2A` | Restore default settings. | TR p. 17 |
| ESC A | `1B 41` | Status, 1 byte reply (below). | TR p. 17, [device] |
| ESC V | `1B 56` | Model + firmware ASCII. TR says 10 chars; this unit returns 8: `93105v0N`. | TR p. 18, [device] |
| ESC B n | `1B 42 n` | Dot tab: skip n bytes (8n dots) from the left of the head, 0..83. | TR p. 15 |
| ESC D n | `1B 44 n` | Bytes per line that follow each SYN/ETB, 1..84, default 84. Dot tab + bytes per line must stay <= 84; not validated by the printer. | TR p. 8, 15 |
| ESC L n1 n2 | `1B 4C hi lo` | Label length in dot lines, big endian, default 3058. Any value 0x8000..0xFFFF = continuous paper. | TR p. 9, 16 |
| ESC E | `1B 45` | Form feed: advance to top of form (sense hole), then past the tear bar. Next label reverse-feeds. | TR p. 10, 16 |
| ESC G | `1B 47` | Short form feed: next label into print position, no tear position, no reverse feed. Use between labels; ESC E after the last. | TR p. 10, 16 |
| ESC f 1 n | `1B 66 01 n` | Skip n lines (0..255) inline with the data. | TR p. 10, 17 |
| ESC h | `1B 68` | Text mode 300 x 300 dpi (default). | TR p. 18 |
| ESC i | `1B 69` | Barcode/graphics mode 300 x 600 dpi (half step per line). | TR p. 18 |
| ESC c / d / e / g | `1B 63` / `64` / `65` / `67` | Density: strobe 75 % / 87.5 % / 100 % (default) / 112.5 %. | TR p. 19 |
| SYN data | `16` + n bytes | One raster line, n = current bytes per line. MSB of the first byte = leftmost dot (after dot tab). Embedded 0x1B/0x16 bytes are pixels. | TR p. 8, 18 |
| ETB data | `17` + RLE | One compressed line: each byte = bit 7 colour (1 black), bits 0..6 run length - 1; runs must sum to 8 x bytes per line. | TR p. 21 |
| ESC Q n1 n2 | `1B 51 hi lo` | Line tab. Not in the 450 TR command list; DRV sends `ESC Q 0 0` at job start. Not used by us (0 is the default). | DRV, [unconfirmed] |

Resync: after a desync the printer may still be inside a raster line. Send at least 85 ESC bytes
[TR p. 9]. DRV sends 156 (`GetResetCommand`); we send 156 too, an even count keeps `ESC ESC` pairs
aligned so the next real command starts on its own ESC.

### Status byte (ESC A)

| Bit | Mask | Meaning [TR p. 17] | Name in DRV `LabelWriterLanguageMonitor.h` |
|---|---|---|---|
| 0 | 0x01 | Ready (always 1) | |
| 1 | 0x02 | Top of form | TOF_BIT |
| 3 | 0x08 | not used | ROLL_CHANGED_BIT (Twin Turbo) |
| 5 | 0x20 | No paper | PAPER_OUT_BIT |
| 6 | 0x40 | Paper jam | PAPER_FEED_BIT |
| 7 | 0x80 | Error (also set on paper out) | ERROR_BIT |

Idle and loaded: `0x03` [TR, device].

### Head geometry and placement

672 dots at 300 dpi across a 57 mm head, 63 mm paper path [TR p. 7]. Every DUO Label page size in
`lwduol.ppd` has `cupsInteger0 0` (no x offset; only the 4XL/5XL PPDs use offsets), and DRV sends
raster byte 0 to dot 0. So **the label edge sits at head dot 0** and labels are not centred
[DRV, unconfirmed on the device until the first print]. Labels wider than 56.90 mm (e.g. 99019,
30256 at 59 mm) lose the part beyond dot 671.

### Job structure we send

Mirrors DRV `CLabelWriterDriver400` (selected for "DYMO LabelWriter DUO Label" in `raster2dymolw.cpp`):

```
1B x156                     resync
1B 68                       ESC h text mode
1B 65                       ESC e density (c / e / g for light / normal / dark)
per copy:
  1B 4C hi lo               ESC L label length in dots (FF FF for continuous)
  per raster line:
    blank  -> 1B 66 01 n    ESC f 1 n, runs > 255 split
    inked  -> 1B 42 t       ESC B dot tab = leading zero bytes (DRV sends it on every line)
              1B 44 n       ESC D only when n changes (trailing zero bytes trimmed)
              16 <n bytes>  SYN
  trailing blank lines are not sent
  1B 47  between copies,  1B 45  after the last copy
```

Differences to DRV: we omit `ESC Q 0 0` (undocumented, default value), we do not use ETB
compression (optional, USB bandwidth is ample), and we follow the TR recommendation of ESC G
between copies and ESC E after the last. DRV ends every page with ESC G and the document with
ESC E. If the first print shows an extra blank label, switch to the DRV pattern.

## Tape engine (interface 1)

D1 command subset [TR Appendix B, 3P-D1]. Only these opcodes exist; anything else must not be sent.

| Command | Bytes | Meaning | Source |
|---|---|---|---|
| ESC A | `1B 41` | Status. TR: 8 bytes, only byte 0 used. **This unit: 1 byte.** | TR p. 25, [device] |
| ESC B n | `1B 42 n` | Dot tab in bytes from the left print edge, 0..15 on the 128-dot head, clamped at print time. | TR p. 23 |
| ESC C n | `1B 43 n` | Tape type (heat profile), 0..12, table below. | TR p. 24, DRV `SendTapeColor` |
| ESC D n | `1B 44 n` | Bytes per line, 0..16; dot tab + bytes per line > 16 is reduced to 16. **n = 0: each bare SYN feeds one blank line.** | TR p. 23 |
| ESC E | `1B 45` | Cut the tape. "Must be sent at the end of every label." | TR p. 25 |
| SYN data | `16` + n bytes | One raster line. ETB compression is **not** supported. | TR p. 24 |

Tape types for ESC C [TR p. 24]: 0 black on white or clear, 1 black on blue, 2 black on red,
3 black on silver, 4 black on yellow, 5 black on gold, 6 black on green, 7 black on fluorescent
green, 8 black on fluorescent red, 9 white on clear, 10 white on black, 11 blue on white or clear,
12 red on white or clear. The printer detects the cassette but not its type; the host declares it
[3P-D1].

### Status byte (ESC A)

The TR table is garbled in the PDF text layer (7 labels for 8 bits). Bit positions below are from
DRV `LabelManagerLanguageMonitor.h`, consistent with [3P-D1] and the measured `0xC0`:

| Bit | Mask | DRV name | TR / 3P-D1 meaning |
|---|---|---|---|
| 0..1 | 0x03 | CASSETTE_SIZE bits | Used only for the 96-dot "DUO Tape" (00 = 6 mm, 01 = 9/12 mm, 10 = 19 mm, 11 = 24 mm). For "DUO Tape 128" DRV checks presence only, so the **tape width cannot be read from the device**. |
| 2 | 0x04 | GENERAL_ERROR | GE, motor stalled / tape jammed |
| 3 | 0x08 | HEAD_OVERHEAT | ignore |
| 4 | 0x10 | SLOT_STATUS | CJ, cutter jammed |
| 5 | 0x20 | BUSY | ignore |
| 6 | 0x40 | CASSETTE_PRESENT | cassette inserted |
| 7 | 0x80 | AUTO_CUTTER / NO_POWER | ignore |

Idle with cassette: `0xC0` [device]. Whether a cassette is physically inserted right now was not
checked by eye; the bit says yes.

### Head geometry and tape width

128 dots at 180 dpi = 18.06 mm [TR App. B: "128-dot, 180-dpi print head"; device MDL]. Supported
tapes: 6, 9, 12, 19, 24 mm [TR p. 7 and App. B]. Printable band per tape from `lwduot2.ppd`
`*ImageableArea` (urx - llx, at 180 dpi) [DRV]; [3P-D1] gives slightly smaller values
(32/48/64/96/128) for the same tiers:

| Tape | Band (PPD) | Dots | 3P-D1 dots | Dot tab if centred (3P-D1) |
|---|---|---|---|---|
| 6 mm | 5.08 mm | 36 | 32 | 6 |
| 9 mm | 7.06 mm | 50 | 48 | 5 |
| 12 mm | 9.03 mm | 64 | 64 | 4 |
| 19 mm | 14.11 mm | 100 | 96 | 2 |
| 24 mm | 18.06 mm | 128 | 128 | 0 |

The tape is **centred on the head**: DRV `GetShiftValue` returns `(128 - lineBits) / 2 + offset`,
and [3P-D1]'s dot tab table centres every width on the 128-dot Duo head. DRV adds small empirical
offsets for "DUO Tape 128" (+2 dots for 12 mm, -4 for 19 mm). They apply to its own byte-padded,
truncated raster lines, which reduces to roughly -1.5..+1.8 dots relative to true centre for
6..19 mm. For 24 mm, DRV's truncation of the 170-dot page to 128 dots would actually print the
left 128 dots (an apparent DRV bug, since its own PPD imageable area is dots 21..149). We centre
exactly and keep a per-width correction table (`TAPE_CENTER_CORRECTION_DOTS` in `raster.ts`, all
0) to be filled from the test print.

### Feed geometry

From DRV `CupsFilterLabelManager.cpp`, "DYMO LabelWriter DUO Tape 128": `MaxPrintableWidth 128`,
`NormalLeader 75`, `MinLeader 61`, `AlignedLeader 43`, `MinPageLines 133`, `SupportAutoCut true`.

- **61 lines (8.61 mm) between print head and cutter.** After a cut the tape end sits at the
  cutter, so the first 61 lines of the next label are already past the head and cannot be printed.
  DRV: `StartPage` skips `NormalLeader - MinLeader` = 14 lines on the first label ("already at
  cutter position"), `EndDoc` skips `MinLeader` then cuts.
- Default blank margin each end: 75 lines (10.58 mm).
- Minimum body 133 lines, so the shortest DRV label is 75 + 133 + 75 = 283 lines (39.93 mm).

### Job structure we send

```
00 x16                     "clean" bytes (DRV StartDoc), ignored by the parser
1B 43 t                    ESC C tape type
per copy (label length L lines cut to cut, = design width, min 283):
  for lines 61 .. L-1 of the design:
    blank  -> collected, emitted as 1B 44 00 + one 16 per line
    inked  -> 1B 42 t (when changed), 1B 44 n (when changed), 16 <n bytes>
  1B 44 00 + (pending blanks + 61) x 16     bring the label end to the cutter
  1B 45                                     cut
```

If the design has ink within its first 61 lines, the whole design is pushed back by the missing
amount (the label gets longer). Labels shorter than 283 lines are padded at the end. Because the
editor's tape printable area starts at 10.58 mm, the normal case reproduces DRV exactly: 14 blank
lines, the content, 75 trailing blank lines, cut.

## Orientation

Both DUO PPDs declare `*LandscapeOrientation: Minus90` [DRV]: landscape designs are rotated 90
degrees clockwise onto the portrait raster. CUPS raster row 0 (page top) is sent first; column 0 is
the MSB of the first byte, i.e. head dot 0. [3P-D1] agrees for tape ("landscape source bitmaps
must be rotated 90 degrees clockwise"). Mapping used in `rasterize()`, design pixel (x, y) with
H = design height in dots:

```
head row (feed order) = x
head dot              = offset + (H - 1 - y)      offset = 0 (label) or centring (tape)
```

So the design's left edge prints first and the design's bottom edge lies on the low dot numbers.
**[unconfirmed]** until the first print: the test pattern is asymmetric to check it.

## Media

`src/printer/media.ts`. Label sizes from [DS] (DYMO lists W x H with W across the feed);
non-printable margins from `lwduol.ppd` `*ImageableArea` [DRV], converted into the editor's
landscape design orientation:

- design left (leading edge) = page height - ury
- design right (trailing edge) = lly
- design bottom = llx (absolute distance from head dot 0)
- design top = width - min(urx, 56.90 mm head)

| id | Size (across x along) | SKU | Notes |
|---|---|---|---|
| lw-99010 | 28 x 89 | 99010 / S0722370 | standard address |
| lw-99012 | 36 x 89 | 99012 / S0722400 | large address |
| lw-11352 | 25 x 54 | 11352 / S0722520 | return address |
| lw-11354 | 57 x 32 | 11354 / S0722540 | DS lists 32 x 57; PPD page 162 x 90 pt puts 57 mm across |
| lw-11355 | 19 x 51 | 11355 / S0722550 | multi-purpose |
| lw-11356 | 41 x 89 | 11356 / S0722560 | name badge |
| lw-99014 | 54 x 101 | 99014 / S0722430 | shipping / name badge |
| lw-99015 | 54 x 70 | 99015 / S0722440 | large multi-purpose |
| lw-99017 | 12 x 50 | 99017 / S0722460 | suspension file (EU file label) |
| lw-99018 | 38 x 190 | 99018 / S0722470 | small lever arch |
| lw-99019 | 59 x 190 | 99019 / S0722480 | wider than the head |
| lw-s0929100 | 51 x 89 | S0929100 / 30374 | appointment / badge card, PPD "30374 Appointment Card" |
| lw-30256 | 59 x 102 | 30256 | US shipping, size from PPD page only |
| lw-continuous-57 | 57 x continuous | 2191636 / 30270 | [CONT]; margins from PPD "Continuous, Wide" (a 154 pt = 54.3 mm page, so the band is conservative) |
| d1-6mm .. d1-24mm | 6/9/12/19/24 x continuous | D1 | 180 dpi, band from `lwduot2.ppd`, centred, 10.58 mm end margins |

Not included: US 30327 file folder (no metric datasheet entry, the PPD page includes the liner,
real label width unconfirmed); 11353 (PPD defines it as a 2-up 25 x 25 page while DS lists a
single 13 x 25 label).

For continuous media `printable.widthMm` is 0 and `printable.xMm` is the leading and trailing
margin (agreed with the editor).

## Test print proposal

`bun spike/testprint.ts` builds both jobs with the real builders, writes
`spike/testprint-label-99010.bin` (40,661 bytes) and `spike/testprint-tape-12mm.bin`
(2,223 bytes), and prints a summary. Sending requires `--send label|tape --confirm`.

Pattern on both: 3-dot outline of the printable area, a big square at the design's top-left,
a small square at the bottom-left, ticks every 10 mm along the bottom. It shows rotation, head
offset (complete, centred outline) and scale in one print.

Label job (one 99010 label):

```
1B x156
1B 68  1B 65  1B 4C 04 1B           text mode, normal density, length 1051 dots (89 mm)
1B 66 01 45                          skip 69 lines (5.84 mm leading margin)
1B 42 02  1B 44 26  16 3F FF ... F8  first outline line: dot tab 2 bytes, 38 bytes of data
1B 42 02  16 3F FF ...               further lines ...
... 1B 45                            form feed after the last inked line
```

Tape job (12 mm, 50 mm cut to cut = 354 lines):

```
00 x16  1B 43 00                     clean, tape type 0
1B 44 00  16 x14                     lines 61..74 blank (10.58 mm margin)
1B 42 04  1B 44 09  16 7F FF FF FF FF FF FF FF 80   first outline line
16 7F ...                            further lines ...
1B 44 00  16 x136                    75 trailing blank + 61 to the cutter
1B 45                                cut
```

## Open risks

1. **Orientation and label x position** come from the vendor PPD and driver, not from a print yet.
2. **ESC E vs ESC G + ESC E** at job end (TR vs DRV); watch for an extra blank label.
3. **Tape centring** may be off by a few dots per width (DRV uses small corrections); tune
   `TAPE_CENTER_CORRECTION_DOTS`.
4. **Tape width is not reported** by the 128-dot engine, so the user must pick the right D1 media;
   a wrong choice prints off-centre or onto the cassette edge but cannot be detected.
5. **Status timeout**: WebUSB `transferIn` has no timeout; the driver races it against 2 s, but a
   late reply could then be read by the next status call.
6. **Long jobs**: the label firmware has no documented host flow control besides USB NAK. DRV's
   language monitor waits for top-of-form between pages; we stream all copies at once.
7. **ESC Q** (line tab) and ETB compression are not used; both are optional.
