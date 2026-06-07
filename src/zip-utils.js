import { unzipSync } from "https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js";

export async function extractPodEntriesFromZipBytes(bytes, sourceLabel = "archive.zip") {
  const entries = unzipSync(bytes);
  const pods = [];
  for (const [entryName, entryBytes] of Object.entries(entries)) {
    if (isPodArchiveEntry(entryName)) {
      pods.push({
        podBytes: toUint8Array(entryBytes),
        podEntryName: entryName
      });
    }
  }
  if (pods.length > 0) {
    return pods;
  }
  throw new Error(`No .POD files were found in ${sourceLabel}.`);
}

function isPodArchiveEntry(name) {
  const normalized = String(name ?? "").replace(/\\/g, "/").trim();
  if (!normalized || normalized.endsWith("/")) {
    return false;
  }
  return normalized.toUpperCase().endsWith(".POD");
}

function toUint8Array(value) {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}
