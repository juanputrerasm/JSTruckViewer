import { joinPath, normalizeArchiveName, replaceExtension } from "../shared/path-utils.js";
import { extractPodEntry, findArtEntry, findAllTruckManifests, findEntryByNormalizedName, findFirstTruckManifest, findModelCandidatesByPrefix, indexPodFile } from "./pod-format.js";
import { parseTruckManifestText } from "./trk-parser.js";
import { decodeBinModel } from "./bin-decoder.js";
import { decodeRawTexture } from "./texture-decoder.js";
import { readFile, readTextFile } from "../shared/opfs.js";

self.addEventListener("message", async (event) => {
  const { id, type, payload } = event.data;
  try {
    let result;
    switch (type) {
      case "indexPod":
        result = await indexPodFile(payload.opfsPodPath);
        break;
      case "listTruckManifests":
        result = findAllTruckManifests(payload.podIndex);
        break;
      case "extractPrimaryTruckManifest":
        result = await extractPrimaryTruckManifest(payload.sessionId, payload.opfsPodPath, payload.podIndex);
        break;
      case "extractTruckManifestByName":
        result = await extractTruckManifestByName(payload.sessionId, payload.opfsPodPath, payload.podIndex, payload.normalizedName);
        break;
      case "parseTruckManifest":
        result = parseTruckManifestText(await readTextFile(payload.opfsTrkPath));
        break;
      case "assembleTruck":
        result = await assembleTruck(payload);
        break;
      default:
        throw new Error(`Unknown worker request: ${type}`);
    }
    self.postMessage({ id, ok: true, payload: result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message ?? String(error) });
  }
});

async function extractPrimaryTruckManifest(sessionId, opfsPodPath, podIndex) {
  const entry = findFirstTruckManifest(podIndex);
  if (!entry) {
    throw new Error("No TRUCK/*.TRK manifest was found in the POD.");
  }
  const outputPath = joinPath("sessions", sessionId, "extracted", entry.normalizedName);
  await extractPodEntry(opfsPodPath, entry, outputPath);
  return { opfsTrkPath: outputPath, entry };
}

async function extractTruckManifestByName(sessionId, opfsPodPath, podIndex, normalizedName) {
  const entry = podIndex.entries.find((e) => e.normalizedName === normalizedName);
  if (!entry) {
    throw new Error(`TRK entry not found in POD: ${normalizedName}`);
  }
  const outputPath = joinPath("sessions", sessionId, "extracted", entry.normalizedName);
  await extractPodEntry(opfsPodPath, entry, outputPath);
  return { opfsTrkPath: outputPath, entry };
}

async function assembleTruck({ sessionId, opfsPodPath, podIndex, manifest, manifestPath }) {
  const warnings = [];
  const extractedFiles = [];

  if (manifestPath) {
    extractedFiles.push(manifestPath);
  }

  const bodyEntry = resolveSingleModelEntry(podIndex, manifest.truckModelBaseName, "body", warnings);
  const axleEntry = resolveSingleModelEntry(podIndex, manifest.axleModelName, "axle", warnings);
  const wheelPlan = resolveWheelEntries(podIndex, manifest.tireModelBaseName, warnings);

  const body = await decodeExtractedModel(bodyEntry, "body", sessionId, opfsPodPath, extractedFiles);
  const axle = await decodeExtractedModel(axleEntry, "axle", sessionId, opfsPodPath, extractedFiles);

  const wheels = [];
  const wheelKeys = [
    "faxle.rtire.static_bpos",
    "faxle.ltire.static_bpos",
    "raxle.rtire.static_bpos",
    "raxle.ltire.static_bpos"
  ];
  for (const wheelKey of wheelKeys) {
    const entry = wheelPlan.mapping[wheelKey] ?? null;
    const wheelModel = await decodeExtractedModel(entry, wheelKey, sessionId, opfsPodPath, extractedFiles);
    wheels.push({
      key: wheelKey,
      position: manifest.wheelAnchors[wheelKey] ?? { x: 0, y: 0, z: 0 },
      model: wheelModel
    });
  }

  const textureNames = new Set();
  for (const model of [body, axle, ...wheels.map((wheel) => wheel.model)].filter(Boolean)) {
    for (const name of model.textureNames ?? []) {
      if (name) {
        textureNames.add(name);
      }
    }
  }
  for (const extra of [manifest.shockTextureName, manifest.barTextureName]) {
    if (extra) {
      textureNames.add(normalizeArchiveName(extra));
    }
  }

  const textures = [];
  for (const name of textureNames) {
    const rawEntry = findArtEntry(podIndex, name, ".RAW");
    if (!rawEntry) {
      warnings.push(`Texture ${name} was referenced but not found in ART.`);
      continue;
    }
    const actEntry = findArtEntry(podIndex, name, ".ACT");
    const rawPath = joinPath("sessions", sessionId, "extracted", rawEntry.normalizedName);
    await extractPodEntry(opfsPodPath, rawEntry, rawPath);
    extractedFiles.push(rawPath);
    const rawBytes = new Uint8Array(await (await readFile(rawPath)).arrayBuffer());
    let actBytes = null;
    if (actEntry) {
      const actPath = joinPath("sessions", sessionId, "extracted", actEntry.normalizedName);
      await extractPodEntry(opfsPodPath, actEntry, actPath);
      extractedFiles.push(actPath);
      actBytes = new Uint8Array(await (await readFile(actPath)).arrayBuffer());
    }
    try {
      textures.push(decodeRawTexture(rawBytes, actBytes, replaceExtension(name, ".RAW")));
    } catch (error) {
      warnings.push(error.message);
    }
  }

  const barOff = manifest.axlebarOffset ?? { x: 0, y: 0, z: 0 };
  const fR = manifest.wheelAnchors["faxle.rtire.static_bpos"] ?? { x: 0, y: 0, z: 0 };
  const fL = manifest.wheelAnchors["faxle.ltire.static_bpos"] ?? { x: 0, y: 0, z: 0 };
  const rR = manifest.wheelAnchors["raxle.rtire.static_bpos"] ?? { x: 0, y: 0, z: 0 };
  const rL = manifest.wheelAnchors["raxle.ltire.static_bpos"] ?? { x: 0, y: 0, z: 0 };
  const frontAxleZ = (fR.z + fL.z) / 2;
  const rearAxleZ = (rR.z + rL.z) / 2;
  const axlePositions = [
    { x: 0, y: barOff.y, z: frontAxleZ + barOff.z },
    { x: 0, y: barOff.y, z: rearAxleZ + barOff.z }
  ];

  return {
    body,
    axle,
    axlePositions,
    wheels,
    scrapePoints: manifest.scrapePoints ?? [],
    textures,
    warnings,
    extractedFiles: [...new Set(extractedFiles)]
  };
}

function resolveSingleModelEntry(podIndex, requestedName, label, warnings) {
  if (!requestedName) {
    warnings.push(`Manifest did not define a ${label} model name.`);
    return null;
  }
  const normalized = normalizeArchiveName(requestedName);
  const fullPath = normalized.startsWith("MODELS/") ? normalized : joinPath("MODELS", normalized);
  const exact = findEntryByNormalizedName(podIndex, fullPath) ?? findEntryByNormalizedName(podIndex, replaceExtension(fullPath, ".BIN"));
  if (exact) {
    return exact;
  }
  const candidates = findModelCandidatesByPrefix(podIndex, requestedName);
  if (candidates.length === 1) {
    warnings.push(`Resolved ${label} model ${requestedName} by prefix to ${candidates[0].name}.`);
    return candidates[0];
  }
  if (candidates.length > 1) {
    warnings.push(`Multiple candidates matched ${label} model ${requestedName}; using ${candidates[0].name}.`);
    return candidates[0];
  }
  warnings.push(`Could not resolve ${label} model ${requestedName}.`);
  return null;
}

function resolveWheelEntries(podIndex, prefix, warnings) {
  const mapping = {};
  if (!prefix) {
    warnings.push("Manifest did not define tireModelBaseName.");
    return { mapping };
  }
  const candidates = findModelCandidatesByPrefix(podIndex, prefix);
  if (!candidates.length) {
    warnings.push(`Could not resolve any tire models for prefix ${prefix}.`);
    return { mapping };
  }

  // Sort by numeric suffix descending so the highest-poly (largest number) model is first.
  const byNumber = (entry) => {
    const m = entry.title.match(/(\d+)[LR]\.BIN$/i);
    return m ? parseInt(m[1], 10) : 0;
  };
  const left = candidates.filter((e) => e.title.endsWith("L.BIN")).sort((a, b) => byNumber(b) - byNumber(a));
  const right = candidates.filter((e) => e.title.endsWith("R.BIN")).sort((a, b) => byNumber(b) - byNumber(a));

  const bestLeft = left[0] ?? null;
  const bestRight = right[0] ?? null;

  // Use the highest-resolution model for all four wheel positions.
  mapping["faxle.rtire.static_bpos"] = bestRight;
  mapping["faxle.ltire.static_bpos"] = bestLeft;
  mapping["raxle.rtire.static_bpos"] = bestRight;
  mapping["raxle.ltire.static_bpos"] = bestLeft;

  if (candidates.length > 2) {
    warnings.push(
      `Resolved tire prefix ${prefix} to ${candidates.length} models; using ${bestRight?.title ?? "?"}/${bestLeft?.title ?? "?"} (highest resolution).`
    );
  }

  return { mapping, candidates };
}

async function decodeExtractedModel(entry, label, sessionId, opfsPodPath, extractedFiles) {
  if (!entry) {
    return null;
  }
  const outputPath = joinPath("sessions", sessionId, "extracted", entry.normalizedName);
  await extractPodEntry(opfsPodPath, entry, outputPath);
  extractedFiles.push(outputPath);
  const bytes = new Uint8Array(await (await readFile(outputPath)).arrayBuffer());
  const model = decodeBinModel(bytes, entry.title);
  model.partKey = label;
  return model;
}
