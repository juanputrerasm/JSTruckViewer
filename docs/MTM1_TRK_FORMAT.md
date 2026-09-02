# MTM1 truck format

## Scope

This document describes the Monster Truck Madness 1 truck manifest as read by JSTruckViewer,
and how it differs from the MTM2 manifest described in [MTM2.1 / TRK 2.1](TRK_2_1_FORMAT.md).

MTM1 TRK is the same line-oriented text format as MTM2 TRK, but far smaller. It names a body
model, one tire model, the four wheel anchors, the scrape points, and some metadata. Everything
MTM2 added to the manifest is absent.

Reference data for this document comes from `TRUCK.POD` of the retail MTM1 release, which
contains twelve manifests: `BEARFOOT`, `BIGFOOT`, `BOOGEY`, `CRUSHER`, `GRAVE`, `MONSTER`,
`OVERKILL`, `POWERBIG`, `RAMPAGE`, `SAMSON`, `SNAKEBIT` and `WILDFOOT`.

## Identifying an MTM1 manifest

An MTM2 manifest opens with a format header whose first token is `MTM2` or `MTM2.1`, and the
truck's display name follows on the next line, unlabeled:

```text
MTM2 truckName
Bigfoot
truckModelBaseName
bigfoot
```

An MTM1 manifest has no header. It opens directly with the bare `truckName` label:

```text
truckName
Bigfoot
truckModelName
bigfoot.bin
```

So the first non-empty line is the discriminator. `MTM2...` means MTM2 or MTM2.1;
`truckName` means MTM1. JSTruckViewer reports the result as `formatVersion`, one of
`MTM1`, `MTM2` or `MTM2.1`.

## Fields

| Label/pattern | Value | Viewer use |
|---|---|---|
| `truckName` | String on the next line | Truck display name |
| `truckModelName` | Model file name, for example `bigfoot.bin` | Resolves the truck body BIN |
| `tireModelName` | Model file name, for example `wheel13.bin` | Resolves the single tire BIN |
| `faxle.rtire.static_bpos.{x,y,z}` | Number | Front-right wheel anchor |
| `faxle.ltire.static_bpos.{x,y,z}` | Number | Front-left wheel anchor |
| `raxle.rtire.static_bpos.{x,y,z}` | Number | Rear-right wheel anchor |
| `raxle.ltire.static_bpos.{x,y,z}` | Number | Rear-left wheel anchor |
| `Scrape point N (body axis) x,y,z` | `x,y,z` | Scrape-point marker, twelve per truck |
| `Instrument Cluster` | String | Instrument-cluster name, displayed as metadata |
| `Wave File` | One or more following lines | Sound references, displayed as metadata |

Wheel anchors, scrape points, the instrument cluster and the wave-file list use exactly the
same syntax and the same coordinate system as MTM2, so no conversion is applied to them.

A retail MTM1 TRK ends with a DOS end-of-file byte (`0x1A`) on its own line. The parser strips
it alongside NUL padding.

## What MTM1 does not have

| Capability | MTM1 | MTM2 |
|---|---|---|
| Format header | None, file starts at `truckName` | `MTM2` or `MTM2.1` |
| Model naming | Full file name (`bigfoot.bin`) | Stem (`bigfoot`) |
| Tire models | One model reused on all four corners | Separate left/right models, optionally four in 2.1 |
| Axle model | None | `axleModelName` |
| Axle bars | None | `barTextureName`, `axlebarOffset`, plus `superiorAxlebarOffset` in 2.1 |
| Shocks | None | `shockTextureName` |
| Driveshaft | None | `driveshaftPos` |
| Lights | None | `Number of Lights` and `Light N ...` blocks |

JSTruckViewer skips those parts for an MTM1 truck rather than reporting them as missing, and
greys out the matching viewer toggles.

## Models

MTM1 model records are the classic `MRGL_MAGNIFY` BIN records JSTruckViewer already decodes for
MTM2: opcode `0x14`, magnify power `65536`, 16-byte texture names (opcode `0x0D`), and mapped
faces. Nothing in the MTM1 model set uses an opcode the viewer does not already handle.

The single tire model carries the same hub texture on both sidewalls, so the four wheels are
placed from one model with no left/right mirroring. In `TRUCK.POD` every tire is 36 vertices
and 34 quads: eight quads per sidewall using the tire's own texture, and eighteen tread quads
using the shared `GEOFAC2.RAW`.

## Texture palettes

MTM1 textures are 256-colour `RAW` bitmaps, 64x64 or 256x256, exactly like MTM2's legacy
textures. The difference is which palette applies.

MTM2 archives normally ship a same-name `.ACT` palette next to every texture. MTM1 did not:
it shipped one shared palette, `ART\METALCR2.ACT` in `STARTUP.POD`, and used it for every
texture that has no same-name `.ACT` of its own. In the retail `TRUCK.POD` exactly one texture
has its own palette, `ART\GEOFAC2.ACT` for the shared tire tread; the other 215 use METALCR2.

JSTruckViewer resolves a `RAW` texture's palette in this order, for MTM1 and MTM2 alike:

1. `ART\<texture>.ACT` from the archive;
2. `ART\METALCR2.ACT` from the archive;
3. an equivalent of METALCR2.

Step 3 matters because the palette lives in `STARTUP.POD` while the trucks live in `TRUCK.POD`.
Opening `TRUCK.POD` on its own would otherwise leave every texture unpalettable. The bundled
copy in `src/shared/metalcr2-palette.js` is a byte-exact copy of the retail 768-byte file.

Because MTM2 archives satisfy step 1 for practically every texture, adding steps 2 and 3 does
not change how an MTM2 truck renders.

## Related documents

- [MTM2.1 / TRK 2.1](TRK_2_1_FORMAT.md)
- [BIN HD / Extended BIN](BIN_HD_FORMAT.md)
- [POD1-64 / Extended POD1](POD1_64_FORMAT.md)
