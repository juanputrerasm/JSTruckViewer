# POD1-64 / Extended POD1 format

## Scope and status

This document describes the original Terminal Reality POD1 archive layout and the Community Patch 3 long-name extension referred to here as **POD1-64** or **Extended POD1**. It also records the layout currently recognized by JSPod and JSTruckViewer.

POD1-64 is not EPD and is not a 64-bit archive format. The number 64 describes the widened 64-byte directory-name field. The engine design retains the POD1 family and selects the extended directory only when a path exceeds the classic POD1 name budget.

> [!IMPORTANT]
> The published engine notes say that production extended archives use a **version-tagged header**, but the referenced companion `CPOD_LONG_NAMES.md` contract is not publicly available. The two JavaScript readers currently implement the confirmed widened-directory layout with the classic 84-byte POD1 header and validate it structurally. Treat the header-tag portion below as unresolved until an updated C-Pod archive or the companion contract is available.

## Byte conventions

- Integer fields are little-endian.
- Names and comments are fixed-width byte arrays containing an 8-bit string.
- A string must be NUL-terminated inside its field; unused bytes should be zero.
- Entry offsets are absolute file offsets.
- There is no POD2 or EPD signature in the classic POD1 header.

## Format comparison

| Property | Classic POD1 | POD1-64 / Extended POD1 |
|---|---:|---:|
| Header currently read by these projects | 84 bytes | 84 bytes |
| Item count | Signed 32-bit integer | Signed 32-bit integer |
| Comment | 80 bytes | 80 bytes |
| Directory name field | 32 bytes | 64 bytes |
| Maximum NUL-terminated name | 31 bytes | 63 bytes |
| Directory record size | 40 bytes | 72 bytes |
| Length field | Unsigned 32-bit integer | Unsigned 32-bit integer |
| Data-offset field | Unsigned 32-bit integer | Unsigned 32-bit integer |
| Compatibility | Original engines and tools | Updated engine and tools only |

The only confirmed directory-record change is `name[32]` becoming `name[64]`. The length and data-offset fields retain their meaning and follow the name immediately.

## Classic POD1 layout

### Header

| Offset | Size | Type | Field |
|---:|---:|---|---|
| `0x00` | 4 | `int32_le` | Number of directory entries |
| `0x04` | 80 | `char[80]` | Archive comment |
| `0x54` | — | — | Start of the directory table |

### Directory entry

Each classic entry is 40 bytes:

| Relative offset | Size | Type | Field |
|---:|---:|---|---|
| `0x00` | 32 | `char[32]` | Archive path/name |
| `0x20` | 4 | `uint32_le` | File length in bytes |
| `0x24` | 4 | `uint32_le` | Absolute data offset |

Directory entry `i` begins at `84 + i * 40`.

## POD1-64 directory layout

With the header interpretation currently implemented by JSPod and JSTruckViewer, the directory still starts at byte 84. Each extended entry is 72 bytes:

| Relative offset | Size | Type | Field | Difference from POD1 |
|---:|---:|---|---|---|
| `0x00` | 64 | `char[64]` | Archive path/name | Widened from 32 bytes |
| `0x40` | 4 | `uint32_le` | File length in bytes | Moved because the name is wider |
| `0x44` | 4 | `uint32_le` | Absolute data offset | Moved because the name is wider |

Directory entry `i` begins at `84 + i * 72` under this interpretation.

The archive payload is not otherwise transformed. Files remain stored as ordinary byte ranges addressed by each entry's offset and length.

## Detection used by the JavaScript readers

POD1 has no classic magic value, so both projects use validated layout detection:

1. Exclude known EPD (`dtxe`) and POD2 (`POD2`) signatures where applicable.
2. Read the POD1 item count and 80-byte comment.
3. Attempt the classic 40-byte directory first.
4. Accept it only if every entry has a plausible non-empty path and its byte range is inside the archive.
5. If classic validation fails, attempt the 72-byte POD1-64 directory with the same checks.
6. Reject the archive if neither complete directory validates.

Classic is attempted first to preserve existing POD1 behavior and avoid identifying an ordinary archive as extended unnecessarily.

## Writer and compatibility rules

- Emit classic POD1 when every complete archive path fits in 31 bytes, unless the authoritative version-tag contract requires otherwise.
- Emit POD1-64 only when a path requires the wider field. Gratuitous use prevents older engines and utilities from opening an otherwise compatible archive.
- Count the entire stored path, including prefixes such as `ART\` or `MODELS\`, the extension, and the NUL terminator.
- NUL-terminate every name and zero-fill the remainder of its field.
- Use overflow-safe validation for `offset + length`; the preferred test is `offset <= fileSize && length <= fileSize - offset`.
- Do not infer this format from EPD. EPD has its own `dtxe` signature, header, and 80-byte directory records.

## Version-tag interoperability gap

The upstream engine notes describe the production extension as “64-byte names, version-tagged header.” They do not publish the tag bytes, tag offset, or any resulting directory offset in the currently available Markdown files. Consequently:

- these projects can read the untagged 84-byte-header/72-byte-entry interpretation;
- they do not yet make a claim about every C-Pod-produced tagged archive;
- a known-good extended archive should be retained as a fixture before implementing a writer;
- if its directory does not begin at byte 84, detection must be updated from the observed contract rather than guessed.

## Verification checklist

- A classic POD1 still reports `POD1` and every entry opens correctly.
- An extended archive contains at least one path longer than 31 bytes.
- Both projects report `Extended POD1` and preserve the complete path.
- The last entry ends at or before the physical end of the archive.
- Truncated tables, unterminated names, control characters, and out-of-range payloads are rejected.
- The same archive is tested in the updated MTM2 engine and the current C-Pod release.

## Upstream references

- [MTM2 Engine Content Limits](https://www.mtm2.com/~mtmg/misc/ENGINE_LIMITS.md) — extended-directory design and name budgets
- The engine notes refer to `CPOD_LONG_NAMES.md`; it was not available at the published `/~mtmg/misc/` location when this document was written.
