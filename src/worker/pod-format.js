import { archiveTitle, basenameWithoutExtension, joinPath, normalizeArchiveName } from "../shared/path-utils.js";
import { readFile, writeBytesToFile } from "../shared/opfs.js";

const ENTRY_NAME_SIZE = 32;
const COMMENT_SIZE = 80;
const ENTRY_SIZE = 40;
const MAX_REASONABLE_ITEMS = 8192;

export async function indexPodFile(opfsPodPath) {
  const file = await readFile(opfsPodPath);
  if (file.size < 84) {
    throw new Error(`File too small to be a POD archive: ${opfsPodPath}`);
  }
  const headerBuffer = await file.slice(0, 84).arrayBuffer();
  const headerView = new DataView(headerBuffer);
  const itemCount = headerView.getInt32(0, true);
  if (itemCount < 1 || itemCount > MAX_REASONABLE_ITEMS) {
    throw new Error(`Suspicious POD item count: ${itemCount}`);
  }
  const tableBytes = itemCount * ENTRY_SIZE;
  if (84 + tableBytes > file.size) {
    throw new Error("POD item table exceeds file size");
  }
  const decoder = new TextDecoder("latin1");
  const comment = decodeNullTerminated(decoder, new Uint8Array(headerBuffer, 4, COMMENT_SIZE));
  const tableBuffer = await file.slice(84, 84 + tableBytes).arrayBuffer();
  const tableView = new DataView(tableBuffer);
  const tableBytesView = new Uint8Array(tableBuffer);
  const entries = [];
  for (let i = 0; i < itemCount; i += 1) {
    const offset = i * ENTRY_SIZE;
    const rawName = tableBytesView.subarray(offset, offset + ENTRY_NAME_SIZE);
    const name = decodeNullTerminated(decoder, rawName);
    const length = tableView.getUint32(offset + ENTRY_NAME_SIZE, true);
    const dataOffset = tableView.getUint32(offset + ENTRY_NAME_SIZE + 4, true);
    if (dataOffset + length > file.size) {
      throw new Error(`POD entry exceeds file size: ${name}`);
    }
    entries.push({
      name,
      normalizedName: normalizeArchiveName(name),
      title: archiveTitle(name),
      length,
      offset: dataOffset
    });
  }
  return { comment, entries };
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

export function findModelCandidatesByPrefix(podIndex, prefix) {
  const base = basenameWithoutExtension(prefix).toUpperCase();
  return podIndex.entries.filter(
    (entry) => entry.normalizedName.startsWith("MODELS/") && entry.title.startsWith(base) && entry.title.endsWith(".BIN")
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
  return decoder.decode(bytes.subarray(0, end)).trim();
}
