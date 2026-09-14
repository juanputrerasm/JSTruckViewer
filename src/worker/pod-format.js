import { archiveTitle, basenameWithoutExtension, joinPath, normalizeArchiveName } from "../shared/path-utils.js";
import { readFile, writeBytesToFile } from "../shared/opfs.js";

const POD1_HEADER_SIZE = 84;
const ENTRY_NAME_SIZE = 32;
const COMMENT_SIZE = 80;
const ENTRY_SIZE = 40;
const MAX_NAME_LENGTH = ENTRY_NAME_SIZE - 1;   // 31; the NUL takes the last byte
const MAX_REASONABLE_ITEMS = 8192;

/*
  POD2, the container 4x4 Evolution 1 and 2 ship their trucks in.

    0x00  4     "POD2"
    0x04  4     archive CRC-32/MPEG-2 over 0x08..EOF
    0x08  80    NUL-terminated comment, which is the archive's display name
    0x58  4     directory entry count
    0x5c  4     audit-trail record count
    0x60  n*20  directory records
    ...         variable-length NUL-terminated name table, then the payloads

  Each 20-byte record is five little-endian uint32: name-table offset, payload length,
  absolute payload offset, Unix timestamp, payload CRC-32/MPEG-2.

  Unlike POD1 this is a real indexed format with a signature, so it is detected outright
  rather than by trying a layout and seeing whether the offsets come out plausible. The
  CRCs are read but not verified: refusing a truck because one byte of a .WAV it will never
  play went bad is worse than drawing the truck.

  The audit trail is a block of fixed-size records appended after the payloads. It is not
  read here - nothing the viewer draws lives in it, and skipping it is what lets a 144 MB
  4x4 Evo 2 TRUCK.POD index in one pass.
*/
const POD2_SIGNATURE = "POD2";
const POD2_COMMENT_OFFSET = 0x08;
const POD2_COUNT_OFFSET = 0x58;
const POD2_TABLE_OFFSET = 0x60;
const POD2_ENTRY_SIZE = 20;

export async function indexPodFile(opfsPodPath) {
  const file = await readFile(opfsPodPath);
  if (file.size < 4) {
    throw new Error(`File too small to be a POD archive: ${opfsPodPath}`);
  }
  const signature = new TextDecoder("latin1").decode(new Uint8Array(await file.slice(0, 4).arrayBuffer()));
  if (signature === POD2_SIGNATURE) {
    return readPod2(file, opfsPodPath);
  }
  if (file.size < POD1_HEADER_SIZE) {
    throw new Error(`File too small to be a POD archive: ${opfsPodPath}`);
  }
  const headerBuffer = await file.slice(0, POD1_HEADER_SIZE).arrayBuffer();
  const headerView = new DataView(headerBuffer);
  const itemCount = headerView.getInt32(0, true);
  if (itemCount < 1 || itemCount > MAX_REASONABLE_ITEMS) {
    throw new Error(`Suspicious POD item count: ${itemCount}`);
  }
  const decoder = new TextDecoder("latin1");
  const comment = decodeNullTerminated(decoder, new Uint8Array(headerBuffer, 4, COMMENT_SIZE));
  const entries = await tryReadDirectory(file, itemCount, decoder);
  if (!entries) throw new Error("POD1 directory does not validate as 40-byte entries.");
  return { format: "POD1", comment, entries };
}

async function readPod2(file, opfsPodPath) {
  if (file.size < POD2_TABLE_OFFSET) {
    throw new Error(`File too small to be a POD2 archive: ${opfsPodPath}`);
  }
  const headBuffer = await file.slice(0, POD2_TABLE_OFFSET).arrayBuffer();
  const headView = new DataView(headBuffer);
  const decoder = new TextDecoder("latin1");
  const comment = decodeNullTerminated(decoder, new Uint8Array(headBuffer, POD2_COMMENT_OFFSET, COMMENT_SIZE));
  const itemCount = headView.getUint32(POD2_COUNT_OFFSET, true);
  if (itemCount < 1 || itemCount > MAX_REASONABLE_ITEMS) {
    throw new Error(`Suspicious POD2 item count: ${itemCount}`);
  }

  const nameTableOffset = POD2_TABLE_OFFSET + itemCount * POD2_ENTRY_SIZE;
  if (nameTableOffset > file.size) {
    throw new Error("POD2 directory exceeds the file.");
  }
  const tableView = new DataView(await file.slice(POD2_TABLE_OFFSET, nameTableOffset).arrayBuffer());

  // The name table runs from the end of the directory to the first payload. Bounding it by
  // the first payload rather than by EOF keeps a corrupt path offset from walking into
  // megabytes of texture data looking for a NUL.
  let firstPayload = file.size;
  for (let i = 0; i < itemCount; i += 1) {
    const offset = tableView.getUint32(i * POD2_ENTRY_SIZE + 8, true);
    if (offset >= nameTableOffset && offset < firstPayload) {
      firstPayload = offset;
    }
  }
  const nameTable = new Uint8Array(await file.slice(nameTableOffset, firstPayload).arrayBuffer());

  const entries = [];
  for (let i = 0; i < itemCount; i += 1) {
    const record = i * POD2_ENTRY_SIZE;
    const pathOffset = tableView.getUint32(record, true);
    const length = tableView.getUint32(record + 4, true);
    const dataOffset = tableView.getUint32(record + 8, true);
    const timestamp = tableView.getUint32(record + 12, true);
    if (pathOffset >= nameTable.length) {
      throw new Error(`POD2 entry ${i} names a path outside the name table.`);
    }
    if (dataOffset > file.size || length > file.size - dataOffset) {
      throw new Error(`POD2 entry ${i} payload lies outside the file.`);
    }
    let end = pathOffset;
    while (end < nameTable.length && nameTable[end] !== 0) {
      end += 1;
    }
    if (end >= nameTable.length) {
      throw new Error(`POD2 entry ${i} has an unterminated path.`);
    }
    const name = decoder.decode(nameTable.subarray(pathOffset, end)).trim();
    if (!name) {
      throw new Error(`POD2 entry ${i} has an empty path.`);
    }
    entries.push({
      name,
      normalizedName: normalizeArchiveName(name),
      title: archiveTitle(name),
      length,
      offset: dataOffset,
      timestamp
    });
  }
  return { format: "POD2", comment, entries };
}

// A POD1 directory record is 40 bytes: char name[32], int32 size, int32 offset. That is
// the only layout there is, so a table that does not validate as one is a refused archive.
async function tryReadDirectory(file, itemCount, decoder) {
  const tableBytes = itemCount * ENTRY_SIZE;
  if (POD1_HEADER_SIZE + tableBytes > file.size) return null;
  const tableBuffer = await file.slice(POD1_HEADER_SIZE, POD1_HEADER_SIZE + tableBytes).arrayBuffer();
  const tableView = new DataView(tableBuffer);
  const tableBytesView = new Uint8Array(tableBuffer);
  const entries = [];
  for (let i = 0; i < itemCount; i += 1) {
    const offset = i * ENTRY_SIZE;
    const { name, paletteName, pathTerminated } = decodePod1NameField(decoder, tableBytesView, offset, ENTRY_NAME_SIZE);
    // Signed, as the engine reads them: a negative size or pointer is a rejected volume,
    // not a 2 GB one.
    const length = tableView.getInt32(offset + ENTRY_NAME_SIZE, true);
    const dataOffset = tableView.getInt32(offset + ENTRY_NAME_SIZE + 4, true);
    if (!pathTerminated || !name || !isPlausibleArchivePath(name)
      || length < 0 || dataOffset < 0
      || dataOffset > file.size || length > file.size - dataOffset) {
      return null;
    }
    entries.push({
      name,
      normalizedName: normalizeArchiveName(name),
      title: archiveTitle(name),
      length,
      offset: dataOffset,
      paletteName
    });
  }
  return entries;
}

export async function extractPodEntry(opfsPodPath, entry, outputPath) {
  const file = await readFile(opfsPodPath);
  const data = await file.slice(entry.offset, entry.offset + entry.length).arrayBuffer();
  const bytes = new Uint8Array(data);
  await writeBytesToFile(outputPath, bytes);
  return outputPath;
}

export function findFirstTruckManifest(podIndex) {
  return podIndex.entries.find((entry) => entry.normalizedName.startsWith("TRUCK/") && entry.normalizedName.endsWith(".TRK")) ?? null;
}

export function findAllTruckManifests(podIndex) {
  return podIndex.entries.filter((entry) => entry.normalizedName.startsWith("TRUCK/") && entry.normalizedName.endsWith(".TRK"));
}

export function findEntryByNormalizedName(podIndex, normalizedName) {
  const upper = normalizeArchiveName(normalizedName);
  return podIndex.entries.find((entry) => entry.normalizedName === upper) ?? null;
}

export function findEntryByTitle(podIndex, title) {
  const upper = archiveTitle(title);
  return podIndex.entries.find((entry) => entry.title === upper) ?? null;
}

export function findModelCandidatesByPrefix(podIndex, prefix, extension = ".BIN") {
  const base = basenameWithoutExtension(prefix).toUpperCase();
  const suffix = extension.toUpperCase();
  return podIndex.entries.filter(
    (entry) => entry.normalizedName.startsWith("MODELS/") && entry.title.startsWith(base) && entry.title.endsWith(suffix)
  );
}

export function findArtEntry(podIndex, textureName, extension) {
  const upperTitle = archiveTitle(textureName);
  const title = upperTitle.includes(".") ? upperTitle.replace(/\.[^.]+$/, extension) : `${upperTitle}${extension}`;
  return findEntryByNormalizedName(podIndex, joinPath("ART", title)) ?? findEntryByTitle(podIndex, title);
}

function decodeNullTerminated(decoder, bytes) {
  let end = 0;
  while (end < bytes.length && bytes[end] !== 0) {
    end += 1;
  }
  return trimPodString(decoder.decode(bytes.subarray(0, end)));
}

function decodePod1NameField(decoder, bytes, offset, width) {
  const limit = Math.min(offset + width, bytes.length);
  let pathEnd = offset;
  while (pathEnd < limit && bytes[pathEnd] !== 0) pathEnd += 1;
  const pathTerminated = pathEnd < limit;
  const name = trimPodString(decoder.decode(bytes.subarray(offset, pathEnd)));
  let paletteName = null;
  if (name.toUpperCase().endsWith(".RAW") && pathEnd < limit - 1) {
    const paletteStart = pathEnd + 1;
    let paletteEnd = paletteStart;
    while (paletteEnd < limit && bytes[paletteEnd] !== 0) paletteEnd += 1;
    const candidate = trimPodString(decoder.decode(bytes.subarray(paletteStart, paletteEnd)));
    if (paletteEnd < limit && candidate.toUpperCase().endsWith(".ACT")) {
      paletteName = candidate;
    }
  }
  return { name, paletteName, pathTerminated };
}

function trimPodString(value) {
  return value.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, "");
}

function isPlausibleArchivePath(name) {
  return !/[\0-\x1f]/.test(name) && !name.includes(":") && name.length <= MAX_NAME_LENGTH;
}
