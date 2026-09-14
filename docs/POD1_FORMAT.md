# POD1 format

## Scope

This document describes the Terminal Reality POD1 archive layout as MTM2 reads it, and the layout recognized by the JavaScript readers in JSPod and JSTruckViewer.

POD1 has exactly one directory layout. A directory table that does not validate as 40-byte records is a malformed archive and is refused.

## Byte conventions

- Integer fields are 32-bit little-endian and **signed**. There is no magic number, no version field and no checksum.
- Names and comments use ISO-8859-1 and are NUL-terminated inside fixed-width fields.
- Leading and trailing code points from `U+0000` through `U+0020` are removed after decoding.
- Bytes after a terminator are not guaranteed to be zero and must not participate in entry lookup.
- Entry offsets are absolute file offsets.
- The path separator is a backslash. The pod is flat beyond that one directory level.
- The engine uppercases every name at mount, so lowercase resolves. Write uppercase anyway: that is what every shipped pod contains, and it keeps round trips byte-identical.

## Layout

### Header

| Offset | Size | Type | Field |
|---:|---:|---|---|
| `0x00` | 4 | `int32_le` | Number of directory entries |
| `0x04` | 80 | `char[80]` | Archive comment, NUL-terminated and NUL-padded |
| `0x54` | | | Start of the directory table |

### Directory entry

Each entry is 40 bytes, and `sizeof(entry) == 40` on the x64 build too: the 64-bit port did not change the container, because `int` is still 32-bit.

| Relative offset | Size | Type | Field |
|---:|---:|---|---|
| `0x00` | 32 | `char[32]` | Name field: path, NUL, optional palette record, remainder |
| `0x20` | 4 | `int32_le` | File length in bytes |
| `0x24` | 4 | `int32_le` | Absolute data offset from the start of the file |

Directory entry `i` begins at `84 + i * 40`, so the longest name is **31 characters** plus its terminator. The payload follows the directory, and files are stored as ordinary byte ranges addressed by each entry's offset and length.

### Hidden palette record

Some early Terminal Reality packers stored a second NUL-terminated string after the path on `.RAW` entries. It is the bare `.ACT` filename used to author that texture:

```text
ART\BASHP.RAW NUL BIONSHIP.ACT NUL remainder
```

MTM1, Terminal Velocity, Fury3 and Hellbender write it; MTM2 and CPR leave the remainder zeroed. Readers use only the first string for lookup. The second string is accepted as palette metadata only when the entry path ends in `.RAW` and the candidate ends in `.ACT`; all other trailing bytes are opaque producer data. Palette names resolve by entry filename rather than full path.

Note the budget: the path, its terminator, the palette name and *its* terminator all have to fit the same 32 bytes.

## Rules the engine enforces

These mirror `CPod::validatePodFile`. Violating any of them refuses the whole volume, not just the one entry.

- `n` must be sane: not negative, not absurd, and `84 + 40 * n` must fit inside the file.
- `size >= 0`, `ptr >= 0`, and `ptr + size <= file length`.
- The name field must hold a NUL inside its 32 bytes.
- No magic header. If a source game's pod format starts with a signature, as later Terminal Reality formats do, it must not be carried over: MTM2 would read those four bytes as `n`, get an absurd count and reject the file.

## Detection used by the JavaScript readers

POD1 has no magic value, so the layout is confirmed by validating it:

1. Exclude known EPD (`dtxe`) and POD2 (`POD2`) signatures where applicable.
2. Read the POD1 item count and 80-byte comment.
3. Reject counts outside `1..8192`.
4. Read the 40-byte directory.
5. Accept it only if every entry is NUL-terminated inside its field, decodes to a plausible non-empty path of at most 31 characters, and has a non-negative size and offset naming a range inside the archive.
6. Reject the archive if the directory does not validate.

## Writer and compatibility rules

- Emit the 40-byte directory record.
- Refuse a name longer than 31 bytes, naming the entry and its length. **Never truncate.** A truncated name packs without error and then simply never resolves in game, which is far harder to diagnose than a refusal.
- Count the entire stored path, including prefixes such as `ART\` or `MODELS\`, the extension and the NUL terminator, plus any embedded palette record.
- Never widen a structure that is a direct on-disk overlay. The POD directory entry is exactly such a structure: the engine reads it straight into `fileEntryStruct`.
- Preserve an original fixed-width comment or name field byte for byte when rebuilding; this retains palette records and producer data after the terminator.
- For a new field, NUL-terminate the name and zero-fill the remainder. Do not invent palette records.
- Use overflow-safe validation for `offset + length`; the preferred test is `offset <= fileSize && length <= fileSize - offset`.
- Do not infer this format from EPD. EPD has its own `dtxe` signature, header and 80-byte directory records.

## Naming policy that sits on top of the container

From `CPOD_LONG_NAMES.md`. These are authoring guidance, not container rules, and they are the reason 31 characters is not the number to design against:

- Keep the **stem** to 18 characters. The engine derives sibling names from it (`ART\<stem>.ACT`, `ART\<stem>_N.PNG`, `ART\<stem>_MASK.PNG`, `ART\<stem>_DTL.PNG`, 17 `DATA\<stem>.*` files, `FOG\<stem>.MAP`), and every derived name must still fit 31 characters. `ART\` plus an 18-character stem plus `_MASK` plus `.PNG` is exactly 31. An overrunning derived name fails silently.
- `UI\<stem7>S.BMP` and `UI\<stem7>L.BMP` truncate the stem to 7 characters, so two track stems sharing their first 7 characters silently share UI bitmaps.
- `.ACT` / `.TTY` / `.MAP` derivations split on the first dot, so a stem must not contain a dot.

## Verification checklist

- A POD1 archive reports `POD1` and every entry opens correctly.
- The last entry ends at or before the physical end of the archive.
- Truncated tables, unterminated names, control characters, negative sizes, out-of-range payloads and any directory whose record stride is not 40 bytes are rejected.
- A legacy 1998 pod round-trips byte-identical. This is the regression guard that matters most.

## Upstream references

- [POD1 format hand-over](https://www.mtm2.com/~mtmg/misc/POD1_FORMAT_HANDOVER.md), 2026-09-09. The container layout, checked against `engine\pod.h` / `engine\pod.cpp`, with a reference writer and an engine-equivalent validator.
- [C-Pod long-name contract](https://www.mtm2.com/~mtmg/misc/CPOD_LONG_NAMES.md). Naming policy, the 18-character stem, and HD art in `ART\`.
- [Terminal Reality POD archive family specification](https://github.com/juanputrerasm/JPod/blob/main/docs/POD_FORMAT.md). Verified POD1 rules, evidence and palette metadata.
