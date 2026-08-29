# MTM2.1 / TRK 2.1 truck format

## Scope

This document describes the original MTM2 truck manifest and the **MTM2.1** additions supported by JSTruckViewer. TRK is a line-oriented text manifest: it names the truck's body, tires, axle, art, attachment points, lights, sounds, and other assembly data. MTM2.1 extends this contract without converting it to a binary or sectioned format.

The published 2.1 extension adds two visible capabilities:

1. four distinct high-detail wheel models;
2. a second, upper set of axle bars positioned relative to the original bars.

## General syntax

- The first non-empty line begins with the format identifier: `MTM2` or `MTM2.1`.
- The second non-empty line is the unlabeled display name of the truck.
- Remaining data is primarily stored as alternating label and value lines.
- Vector values use comma-separated `x,y,z` components.
- Wheel anchors are stored as individual `.x`, `.y`, and `.z` label/value pairs.
- Label spelling and capitalization are significant to JSTruckViewer's known-field parser.
- NUL bytes, blank lines, and surrounding whitespace are ignored by JSTruckViewer.
- Unknown label/value pairs are retained in `unknownFields` rather than causing the load to fail.

## Classic MTM2 structure read by JSTruckViewer

The parser recognizes the following classic fields:

| Label/pattern | Value | Viewer use |
|---|---|---|
| Header beginning `MTM2` | Format and header text | Identifies a classic manifest |
| Unlabeled second line | String | Truck display name |
| `truckModelBaseName` | Model stem | Resolves the truck body BIN |
| `tireModelBaseName` | Model stem | Resolves wheel BINs |
| `axleModelName` | Model filename | Resolves the axle BIN |
| `shockTextureName` | Texture filename/stem | Shock texture |
| `barTextureName` | Texture filename/stem | Axle-bar/driveshaft texture |
| `axlebarOffset` | `x,y,z` | Original axle-bar midpoint/layout offset |
| `driveshaftPos` | `x,y,z` | Driveshaft positioning hint |
| `faxle.rtire.static_bpos.{x,y,z}` | Number | Front-right wheel anchor |
| `faxle.ltire.static_bpos.{x,y,z}` | Number | Front-left wheel anchor |
| `raxle.rtire.static_bpos.{x,y,z}` | Number | Rear-right wheel anchor |
| `raxle.ltire.static_bpos.{x,y,z}` | Number | Rear-left wheel anchor |
| `Scrape point N ...` | `x,y,z` | Scrape-point marker |
| `Instrument Cluster` | String | Instrument-cluster name, displayed as metadata |
| `Wave File` | One or more lines | Sound references, displayed as metadata |
| `Number of Lights` | Integer | Declared light count |
| `Light N body axis pos...` | `x,y,z,radius` | Light source position and bitmap radius |
| `Light N heading...` | `heading,pitch,spin` | Light orientation/animation |
| `Light N cone:...` | `length,baseRadius,rimRadius,texture` | Cone geometry and texture |
| `Light N source:...` | String | Source bitmap |
| `Light N ms on...` | `onMs,offMs` | Blink timing |

## Differences in MTM2.1

| Capability | Classic `MTM2` | Extended `MTM2.1` |
|---|---|---|
| Header prefix | `MTM2 truckName` | `MTM2.1 truckName` |
| Wheel models | Shared left/right wheel models | Optional FL, FR, RL, and RR high-detail models |
| Typical high-detail suffixes | `16L.BIN`, `16R.BIN` | `16FL.BIN`, `16FR.BIN`, `16RL.BIN`, `16RR.BIN` |
| Second axle-bar set | Not available | `superiorAxlebarOffset` appended near the end |
| Original fields | Required as before | Retained for compatibility |

## Header activation

The published engine contract changes the header from:

```text
MTM2 truckName
```

to:

```text
MTM2.1 truckName
```

The patched engine uses `MTM2.1` to activate enhanced loading. A classic `MTM2` header tells the engine to follow the original wheel and axle-bar path even if enhanced files happen to exist.

JSTruckViewer records the detected header as `MTM2` or `MTM2.1`. Its current assembly is deliberately tolerant: it will use enhanced wheels and `superiorAxlebarOffset` when present even if the header was left as `MTM2`. Authors targeting the game should not depend on this viewer tolerance; use the correct `MTM2.1` header.

## Four independent wheel models

For tire base name `GRNT`, an MTM2.1 POD can contain:

| Suffix | Position |
|---|---|
| `GRNT16FL.BIN` | Front left |
| `GRNT16FR.BIN` | Front right |
| `GRNT16RL.BIN` | Rear left |
| `GRNT16RR.BIN` | Rear right |

Only the high-detail `16` tier needs four position-specific variants. The published patch does not require `10FL`, `10FR`, `08FL`, and similar lower-detail position variants.

For compatibility with the original game, ship the normal legacy wheel family as well, including the expected left/right models such as `16L.BIN`, `16R.BIN`, and their lower-detail variants. JSTruckViewer falls back position-by-position to the best legacy left/right wheel when the enhanced set is incomplete and reports a warning.

## Second axle-bar set

Append the label and value after the classic light data:

```text
superiorAxlebarOffset
200,200,400
```

The three values are relative vertical offsets:

| Position | Meaning |
|---:|---|
| 1 | Front axle connection Y |
| 2 | Rear axle connection Y |
| 3 | Body/midpoint connection Y |

The upper set reuses the original axle bar's X and Z placement. Only the three Y positions are extended. The historical authoring example recommends integers and uses `200,200,400` as a starting point.

JSTruckViewer parses numeric values with `parseFloat`, so decimals are accepted for previewing even though the published engine authoring instructions recommend integers. The viewer applies these values relative to its reconstruction of the classic axle-bar layout.

If `superiorAxlebarOffset` is absent, no upper bar set is created.

## Minimal annotated example

```text
MTM2.1 truckName
Example Truck
truckModelBaseName
EXAMPLE
tireModelBaseName
GRNT
axleModelName
GreyAxl.bin
shockTextureName
Black.raw
barTextureName
Silver.raw
axlebarOffset
1.551250,-2.670000,0.203281
driveshaftPos
0.000000,-2.050000,1.303281
faxle.rtire.static_bpos.x
4.700000
faxle.rtire.static_bpos.y
-3.200000
faxle.rtire.static_bpos.z
6.700000
faxle.ltire.static_bpos.x
-4.700000
faxle.ltire.static_bpos.y
-3.200000
faxle.ltire.static_bpos.z
6.700000
raxle.rtire.static_bpos.x
4.700000
raxle.rtire.static_bpos.y
-3.200000
raxle.rtire.static_bpos.z
-6.120000
raxle.ltire.static_bpos.x
-4.700000
raxle.ltire.static_bpos.y
-3.200000
raxle.ltire.static_bpos.z
-6.120000
Number of Lights
0
superiorAxlebarOffset
200,200,400
```

A real TRK normally contains scrape points, sound references, and possibly light records between the anchor data and the final 2.1 field.

## JSTruckViewer behavior and limitations

- The viewer parses and displays the truck name, models, wheel anchors, scrape points, sounds, and light metadata.
- It assembles the body, position-specific wheels, axles, two axle-bar sets, shocks, driveshaft, light helpers, and scrape-point helpers.
- Unknown fields remain available in the parsed manifest but do not affect rendering.
- The viewer does not simulate vehicle physics, damage, sound, dashboard behavior, or the game's LOD switching.
- Shock and bar geometry is reconstructed for visualization; it is not a byte-for-byte implementation of the game simulation.
- The parser is permissive about ordering, but game-targeted authors should follow the published layout and place `superiorAxlebarOffset` after the light block.

## Compatibility checklist

- Use `MTM2.1 truckName` in the first line.
- Retain every classic model, texture, anchor, scrape, sound, and light field needed by the truck.
- Ship `16FL`, `16FR`, `16RL`, and `16RR` wheel BINs using the `tireModelBaseName` prefix.
- Also ship the legacy left/right wheel family if the POD should work in original MTM2.
- Append `superiorAxlebarOffset` and three comma-separated integer Y offsets.
- Verify the truck in both the patched game and JSTruckViewer.

## Upstream references

- [MTM2 Beta Patch 0.41/0.42 truck-authoring instructions](https://www.mtm2.com/forum/phpBB3/viewtopic.php?p=56927)
- The distributed `Beta0.42.zip` `EXAMPLE.TRK`, used to verify field ordering and the `200,200,400` example
