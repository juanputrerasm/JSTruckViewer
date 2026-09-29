/*
  POD archives, as the truck viewer uses them.

  Parsing is OpenPhotex's (src/vendor/openphotex, the canonical Terminal Reality format
  library): this file reads only the directory out of the OPFS file, hands it over, and keeps
  the viewer's truck lookups on top. Do not add POD format knowledge here; change OpenPhotex and
  re-vendor it.

  A 144 MB 4x4 Evo 2 TRUCK.POD still indexes in one pass: only the directory is read, never the
  payloads or the audit trail after them.
*/
import { parsePod, podDirectoryEnd, findPodEntry, findPodEntryByTitle } from "../vendor/openphotex/index.js";
import { archiveTitle, basenameWithoutExtension, joinPath } from "../shared/path-utils.js";
import { readFile, writeBytesToFile } from "../shared/opfs.js";

// The spellings the viewer has always reported.
const FORMAT_NAMES = { pod1: "POD1", pod2: "POD2", epd: "EPD" };

export async function indexPodFile(opfsPodPath) {
  const file = await readFile(opfsPodPath);
  let prefix = new Uint8Array(0);
  for (;;) {
    const need = podDirectoryEnd(prefix, file.size);
    if (need <= prefix.length) break;
    prefix = new Uint8Array(await file.slice(0, need).arrayBuffer());
  }
  const pod = parsePod(prefix, { byteLength: file.size });
  return { ...pod, format: FORMAT_NAMES[pod.format] };
}

export async function extractPodEntry(opfsPodPath, entry, outputPath) {
  const file = await readFile(opfsPodPath);
  const data = await file.slice(entry.offset, entry.offset + entry.length).arrayBuffer();
  const bytes = new Uint8Array(data);
  await writeBytesToFile(outputPath, bytes);
  return outputPath;
}

export function findFirstTruckManifest(podIndex) {
  return findAllTruckManifests(podIndex)[0] ?? null;
}

export function findAllTruckManifests(podIndex) {
  return podIndex.entries.filter((entry) => (
    entry.normalizedName.startsWith("TRUCK/") && entry.normalizedName.endsWith(".TRK")
  ) || (
    entry.normalizedName.startsWith("VEHICLE/") && entry.normalizedName.endsWith(".CAR")
  ));
}

export function findEntryByNormalizedName(podIndex, normalizedName) {
  return findPodEntry(podIndex, normalizedName);
}

export function findEntryByTitle(podIndex, title) {
  return findPodEntryByTitle(podIndex, title);
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
