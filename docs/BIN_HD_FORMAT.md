# HD BIN / Extended BIN format

## Scope

This document describes the original MTM2 BIN command-stream model and the Community Patch 3 extensions commonly called **BIN 2.1**, **Extended BIN**, or **HD BIN**. The extension preserves the classic command stream and adds opcodes 62 through 66; it does not introduce a separate file signature or replace classic records.

The focus is the compatibility contract required by JSPod and JSTruckViewer. It is not an exhaustive catalog of every historical MRGL primitive used by all Terminal Reality games.

> [!IMPORTANT]
> The normal-map channel rules here follow the later clarification supplied by the engine author: RGB stores X/Y/Z, alpha is never read, roughness does not exist in the engine, and specular is a per-material number. This supersedes older draft text that assigned another meaning to normal-map alpha.

## Byte and stream conventions

- Integers are 32-bit little-endian values.
- Real-valued material parameters use signed 16.16 fixed point: `real = stored / 65536`.
- Fixed-width strings must be NUL-terminated and should be zero-filled after the terminator.
- BIN is an interleaved command stream, not a set of texture, material, and facet sections.
- State records affect compatible facets that follow them until another state record changes the value.
- Opcode `0` terminates the stream.
- A malformed or unknown record makes the engine truncate the model at that point; a reader must not guess an unknown stride.

## Original BIN model

Classic MTM2 BIN files express appearance mainly through facet opcodes. A texture-selection record changes the active texture, and later textured facets use it. Different facet opcodes encode fixed combinations such as lit, transparent, sorted, or textured behavior.

Typical stream shape:

```text
MRGL_MAGNIFY       optional scale state
MRGL_VLIST         vertex data
MRGL_TEXTURE       selects a texture
classic facets     use the active texture and their opcode-defined behavior
MRGL_TEXTURE       selects another texture
classic facets
MRGL_EOL           opcode 0
```

### Classic texture record: `MRGL_TEXTURE` (13)

The classic record is 24 bytes:

| Offset | Size | Type | Field |
|---:|---:|---|---|
| `0x00` | 4 | `int32_le` | Type = 13 |
| `0x04` | 4 | `int32_le` | Texture slot |
| `0x08` | 16 | `char[16]` | Texture name, at most 15 bytes plus NUL |

This 15-character limit is the reason for opcode 62. The classic record must never be widened in place because every older model walker depends on its 24-byte stride.

### Classic mapped facet shape

A classic mapped facet has this common shape:

| Offset | Size | Field |
|---:|---:|---|
| `0x00` | 4 | Facet opcode |
| `0x04` | 4 | Corner count `n` |
| `0x08` | 16 | Stored normal/face fields (`a`, `b`, `c`, `d`) |
| `0x18` | `12 * n` | Per corner: vertex index, U, V |

Total size is `24 + 12 * n` bytes. Appearance is determined by the classic facet opcode; a current Extended BIN material does not change a classic facet.

## What BIN 2.1 changes

| Capability | Classic BIN | BIN 2.1 / Extended BIN |
|---|---|---|
| Texture record name | `char[16]` | Optional `char[64]` record |
| Appearance model | Fixed facet-opcode combinations | Composable material flags and parameters |
| Material facet | None | Opcode 64 consumes current material state |
| Long keyframe names | Classic fixed record | New fixed 4,376-byte opcode 65 record |
| Normal-map strength | None | Optional opcode 66 state |
| Diffuse files | Primarily RAW/ACT | PNG, TGA, then RAW fallback |
| Normal maps | None | `<stem>_N.PNG`, then `<stem>_N.TGA` convention |
| File signature | Existing BIN stream | Unchanged; presence of new opcodes identifies extended content |

## New opcode table

| Opcode | Name | Total size | Purpose |
|---:|---|---:|---|
| 62 | `MRGL_TEXTURE64` | 72 bytes | Select a texture using a 64-byte name field |
| 63 | `MRGL_MATERIAL` | 48 bytes | Select primary material state |
| 64 | `MRGL_MATFACET` | `24 + 12 * n` | Mapped facet using current texture and material |
| 65 | `MRGL_KEYFRAME64` | 4,376 bytes | Fixed-stride long-name keyframe record |
| 66 | `MRGL_MATERIAL2` | 32 bytes | Select secondary material state, currently normal strength |
| 67 | Unassigned | — | Deliberately free; do not recreate the reverted normal-map opcode |

## Opcode 62: `MRGL_TEXTURE64`

| Offset | Size | Type | Field |
|---:|---:|---|---|
| `0x00` | 4 | `int32_le` | Type = 62 |
| `0x04` | 4 | `int32_le` | Texture slot |
| `0x08` | 64 | `char[64]` | NUL-terminated texture name |

The `type` and `slot` fields intentionally match the classic record offsets.

Compatibility rule: emit opcode 62 only when the stored name exceeds the classic 15-character budget. Continue emitting opcode 13 for short names so those models remain readable by older engines and BinEdit versions.

## Opcodes 63 and 64: materials and material facets

`MRGL_MATERIAL` is a state change. `MRGL_MATFACET` has the same byte layout as a classic mapped facet but consumes both the active texture and active material.

Only opcode 64 consumes material state. A classic textured facet after a material record continues to use its classic opcode behavior. A material facet encountered before a material record safely degrades to a plain lit textured facet in the engine, but writers should not rely on that fallback.

### `MRGL_MATERIAL` layout

| Offset | Size | Field | Encoding |
|---:|---:|---|---|
| `0x00` | 4 | Type = 63 | Integer |
| `0x04` | 4 | `flags` | Bitfield |
| `0x08` | 4 | `reflectivity` | 16.16 |
| `0x0C` | 4 | `fresnelBias` | 16.16 |
| `0x10` | 4 | `fresnelStrength` | 16.16 |
| `0x14` | 4 | `baseAlpha` | 16.16 |
| `0x18` | 4 | `specPower` | 16.16 |
| `0x1C` | 4 | `emissive` | 16.16 |
| `0x20` | 4 | `tintR` | 16.16; 1.0 means unchanged |
| `0x24` | 4 | `tintG` | 16.16; 1.0 means unchanged |
| `0x28` | 4 | `tintB` | 16.16; 1.0 means unchanged |
| `0x2C` | 4 | `foliage` | Packed alpha reference and translucency |

The 48-byte stride is fixed and must never be extended. New properties require a new opcode.

### Material flags

| Name | Value | Meaning |
|---|---:|---|
| `LIT` | `0x0001` | Receives scene lighting |
| `GOURAUD` | `0x0002` | Smooth shading; gate for specular and reflection |
| `BLEND` | `0x0004` | Alpha blending |
| `ALPHATEST` | `0x0008` | Alpha cutout |
| `ADDITIVE` | `0x0010` | Additive blending |
| `REFLECT` | `0x0020` | Environment reflection |
| `FRESNEL` | `0x0040` | View angle affects alpha and reflection |
| `TWOSIDED` | `0x0080` | Disable back-face culling |
| `NOZWRITE` | `0x0100` | Disable depth writes |
| `EMISSIVE` | `0x0200` | Enable self-illumination term |
| `TINT` | `0x0400` | Multiply texture RGB by tint fields |
| `ALPHAREF` | `0x0800` | Use the packed material alpha reference |
| `TRANSLUCENT` | `0x1000` | Allow back-lighting through the surface |
| `TEXSOLID` | `0x2000` | Draw blended surface plus an alpha-tested solid depth-writing pass |

The packed `foliage` value is:

```text
bits  0..15   alphaRef      meaningful with ALPHAREF
bits 16..31   translucency  0..65535, meaningful with TRANSLUCENT
```

Unknown flag bits must be preserved during round trips. Reconstructing `flags` only from names known to a tool can silently remove newer behavior such as `TEXSOLID`.

## Opcode 65: `MRGL_KEYFRAME64`

This is a fixed 4,376-byte name-bearing record with long model-file storage. JSPod and JSTruckViewer recognize the exact stride so subsequent commands remain aligned; they do not currently expose or animate its complete contents.

Do not confuse this record with a model-sequence control BIN whose initial type is `0x20`. A control BIN contains frame references rather than normal model geometry.

## Opcode 66: `MRGL_MATERIAL2`

| Offset | Size | Field | Meaning |
|---:|---:|---|---|
| `0x00` | 4 | Type = 66 | Record opcode |
| `0x04` | 4 | `flags2` | `NORMALMAP = 0x0001` |
| `0x08` | 4 | `normalStrength` | Signed 16.16; 1.0 is authored strength, 0 is flat |
| `0x0C` | 20 | `reserved[5]` | Must be zero |

This is also persistent state for following material facets. The record is optional: absence behaves as normal strength 1.0. Writers should emit it only when they need an explicit strength or future secondary state.

## Command ordering and material identity

Valid records are freely interleaved:

```text
MAGNIFY → VLIST → TEXTURE → facets → MATERIAL → MATERIAL2 → MATFACETs
        → TEXTURE → facets → MATERIAL → MATFACETs → EOL
```

Writers should emit one `MRGL_MATERIAL` record per distinct material value and group its facets beneath it. The engine's static-instancing path groups by material identity, not merely by equal field values; repeatedly emitting byte-identical material records fragments batches.

Material state is reset at the start of each model. No trailing “clear material” record is required.

## HD diffuse texture resolution

The recorded texture string is treated as a stem plus an extension hint. For `BODY.RAW`, `BODY.PNG`, `BODY.TGA`, or `BODY`, the updated engine and these viewers resolve the same stem in this order:

1. `ART/BODY.PNG`
2. `ART/BODY.TGA`
3. `ART/BODY.RAW`

HD diffuse images should be square power-of-two textures from 32 through 1024 pixels.

- PNG/TGA alpha is real alpha; pure black has no special meaning.
- Legacy RAW transparency is a pure-black RGB color key on face types that use transparency.
- A texture having an alpha channel does not by itself make every facet transparent. Face opcode or material state controls that decision.
- Recording `.RAW` remains the safest compatibility spelling for old engines even when a same-stem PNG/TGA is shipped.

## Normal-map convention

For selected diffuse stem `BODY`, probe:

1. `ART/BODY_N.PNG`
2. `ART/BODY_N.TGA`

Nothing in BIN names the companion map. Opcode 67 was briefly assigned to such a record and then reverted; it remains free. Opcode 66 carries strength only.

Channel decoding follows the engine author's later clarification:

| Channel | Meaning |
|---|---|
| R | Tangent X — tilt across the texture |
| G | Bitangent Y — tilt down the texture |
| B | Surface Z, stored directly |
| A | Unused; never sampled |

Every sampled RGB component is decoded as `component * 2 - 1`. Export **DirectX / green-down**, not OpenGL / green-up. The engine does not reconstruct Z, use DXT5nm packing, read roughness, or read a texture-driven specular value. Specular behavior comes from the material, including `specPower`.

## Reader safety rules

- Bounds-check an entire fixed record before reading any field.
- For variable facets, validate `n` before calculating `24 + 12 * n`.
- Preserve raw flags, unknown bits, and reserved words for diagnostics.
- Stop with an opcode and byte-offset warning on an unsupported record; never guess its size.
- Keep solid-color, texture, material, and material2 state independent.
- Group rendered geometry by texture, facet behavior, material identity, and normal strength.

## Upstream references

- [Monvert handover](https://www.mtm2.com/~mtmg/misc/MONVERT_HANDOVER.md)
- [MTM2 Engine Content Limits](https://www.mtm2.com/~mtmg/misc/ENGINE_LIMITS.md)
- [Authoring HD art](https://www.mtm2.com/~mtmg/misc/AUTHORING_HD_ART.md)
- [glTF extras specification](https://www.mtm2.com/~mtmg/misc/GLTF_EXTRAS_SPEC.md)
