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

  const axlePairs = [
    {
      key: "axle_0",
      leftAnchor: manifest.wheelAnchors["faxle.ltire.static_bpos"] ?? { x: 0, y: 0, z: 0 },
      rightAnchor: manifest.wheelAnchors["faxle.rtire.static_bpos"] ?? { x: 0, y: 0, z: 0 },
      leftWheel: wheels.find((wheel) => wheel.key === "faxle.ltire.static_bpos")?.model ?? null,
      rightWheel: wheels.find((wheel) => wheel.key === "faxle.rtire.static_bpos")?.model ?? null
    },
    {
      key: "axle_1",
      leftAnchor: manifest.wheelAnchors["raxle.ltire.static_bpos"] ?? { x: 0, y: 0, z: 0 },
      rightAnchor: manifest.wheelAnchors["raxle.rtire.static_bpos"] ?? { x: 0, y: 0, z: 0 },
      leftWheel: wheels.find((wheel) => wheel.key === "raxle.ltire.static_bpos")?.model ?? null,
      rightWheel: wheels.find((wheel) => wheel.key === "raxle.rtire.static_bpos")?.model ?? null
    }
  ];
  const axlePlacements = axlePairs.map((pair) => buildAxlePlacement(axle, pair));
  const frontAxleCenter = buildPreviewAxleCenter(axlePairs[0].leftAnchor, axlePairs[0].rightAnchor);
  const rearAxleCenter = buildPreviewAxleCenter(axlePairs[1].leftAnchor, axlePairs[1].rightAnchor);
  const shocks = buildShockDescriptors(frontAxleCenter, rearAxleCenter);
  const axleBars = buildAxleBarDescriptors(frontAxleCenter, rearAxleCenter, manifest.axlebarOffset);
  const driveshaft = buildDriveshaftDescriptor(frontAxleCenter, rearAxleCenter, manifest.driveshaftPos);

  const lights = (manifest.lights ?? [])
    .filter((l) => l?.pos)
    .map((l) => ({ pos: l.pos, radius: Math.max(l.bitmapRadius ?? 0.15, 0.1), index: l.index }));

  return {
    body,
    axles: axlePlacements,
    axleBars,
    shocks,
    driveshaft,
    barTextureName: manifest.barTextureName ?? "",
    shockTextureName: manifest.shockTextureName ?? "",
    wheels,
    scrapePoints: manifest.scrapePoints ?? [],
    lights,
    textures,
    warnings,
    extractedFiles: [...new Set(extractedFiles)]
  };
}

const PREVIEW_UNIT_SCALE = 1 / 256;
const SHOCK_OFFSET_X = 542 * PREVIEW_UNIT_SCALE;
const SHOCK_OFFSET_Y = 85 * PREVIEW_UNIT_SCALE;
const SHOCK_OFFSET_Z = 0 * PREVIEW_UNIT_SCALE;
const AXLE_BAR_OFFSET_X = 535 * PREVIEW_UNIT_SCALE;
const AXLE_BAR_OFFSET_Y = -80 * PREVIEW_UNIT_SCALE;
const AXLE_BAR_OFFSET_Z = -83 * PREVIEW_UNIT_SCALE;
const AXLE_BAR_MIDDLE_Y_BIAS = 45 * PREVIEW_UNIT_SCALE;

function buildShockDescriptors(frontAxleCenter, rearAxleCenter) {
  return [
    {
      key: "shock_fl",
      base: { x: frontAxleCenter.x - SHOCK_OFFSET_X, y: 0, z: frontAxleCenter.z + SHOCK_OFFSET_Z },
      top: { x: frontAxleCenter.x - SHOCK_OFFSET_X, y: frontAxleCenter.y + SHOCK_OFFSET_Y, z: frontAxleCenter.z + SHOCK_OFFSET_Z }
    },
    {
      key: "shock_fr",
      base: { x: frontAxleCenter.x + SHOCK_OFFSET_X, y: 0, z: frontAxleCenter.z + SHOCK_OFFSET_Z },
      top: { x: frontAxleCenter.x + SHOCK_OFFSET_X, y: frontAxleCenter.y + SHOCK_OFFSET_Y, z: frontAxleCenter.z + SHOCK_OFFSET_Z }
    },
    {
      key: "shock_rl",
      base: { x: rearAxleCenter.x - SHOCK_OFFSET_X, y: 0, z: rearAxleCenter.z - SHOCK_OFFSET_Z },
      top: { x: rearAxleCenter.x - SHOCK_OFFSET_X, y: rearAxleCenter.y + SHOCK_OFFSET_Y, z: rearAxleCenter.z - SHOCK_OFFSET_Z }
    },
    {
      key: "shock_rr",
      base: { x: rearAxleCenter.x + SHOCK_OFFSET_X, y: 0, z: rearAxleCenter.z - SHOCK_OFFSET_Z },
      top: { x: rearAxleCenter.x + SHOCK_OFFSET_X, y: rearAxleCenter.y + SHOCK_OFFSET_Y, z: rearAxleCenter.z - SHOCK_OFFSET_Z }
    }
  ];
}

function buildAxleBarDescriptors(frontAxleCenter, rearAxleCenter, barOffset = null) {
  const middleRight = {
    x: barOffset?.x ?? 0,
    y: (barOffset?.y ?? 0) + AXLE_BAR_MIDDLE_Y_BIAS,
    z: barOffset?.z ?? 0
  };
  const middleLeft = { x: -middleRight.x, y: middleRight.y, z: middleRight.z };
  const frontRight = {
    x: frontAxleCenter.x + AXLE_BAR_OFFSET_X,
    y: frontAxleCenter.y + AXLE_BAR_OFFSET_Y,
    z: frontAxleCenter.z + AXLE_BAR_OFFSET_Z
  };
  const frontLeft = {
    x: frontRight.x - 2 * AXLE_BAR_OFFSET_X,
    y: frontRight.y,
    z: frontRight.z
  };
  const rearRight = {
    x: rearAxleCenter.x + AXLE_BAR_OFFSET_X,
    y: rearAxleCenter.y + AXLE_BAR_OFFSET_Y,
    z: rearAxleCenter.z - AXLE_BAR_OFFSET_Z
  };
  const rearLeft = {
    x: rearRight.x - 2 * AXLE_BAR_OFFSET_X,
    y: rearRight.y,
    z: rearRight.z
  };
  return [
    { key: "axle_bar_left_front", start: middleLeft, end: frontLeft },
    { key: "axle_bar_left_rear", start: middleLeft, end: rearLeft },
    { key: "axle_bar_right_front", start: middleRight, end: frontRight },
    { key: "axle_bar_right_rear", start: middleRight, end: rearRight }
  ];
}

function buildDriveshaftDescriptor(frontAxleCenter, rearAxleCenter, driveshaftPos = null) {
  const hub = {
    x: 0,
    y: driveshaftPos?.y ?? 0,
    z: driveshaftPos?.z ?? 0
  };
  return {
    key: "driveshaft",
    hub,
    front: frontAxleCenter,
    rear: rearAxleCenter
  };
}

function buildPreviewAxleCenter(leftAnchor, rightAnchor) {
  const mid = midpoint(leftAnchor, rightAnchor);
  return {
    x: mid.x,
    y: mid.y + 1,
    z: mid.z
  };
}

function buildAxlePlacement(axleModel, pair) {
  const position = buildPreviewAxleCenter(pair.leftAnchor, pair.rightAnchor);
  if (!axleModel) {
    return { key: pair.key, model: null, position };
  }
  const axleBounds = getModelBounds(axleModel);
  return {
    key: pair.key,
    position,
    model: transformModel(axleModel, {
      translate: {
        x: -(axleBounds?.center.x ?? 0),
        y: -(axleBounds?.center.y ?? 0),
        z: -(axleBounds?.center.z ?? 0)
      },
      scale: { x: 1, y: 1, z: 1 }
    })
  };
}

function midpoint(a, b) {
  return {
    x: ((a?.x ?? 0) + (b?.x ?? 0)) / 2,
    y: ((a?.y ?? 0) + (b?.y ?? 0)) / 2,
    z: ((a?.z ?? 0) + (b?.z ?? 0)) / 2
  };
}

function getModelBounds(model) {
  if (!model?.vertices?.length) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const vertex of model.vertices) {
    minX = Math.min(minX, vertex.x);
    minY = Math.min(minY, vertex.y);
    minZ = Math.min(minZ, vertex.z);
    maxX = Math.max(maxX, vertex.x);
    maxY = Math.max(maxY, vertex.y);
    maxZ = Math.max(maxZ, vertex.z);
  }
  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
    center: {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      z: (minZ + maxZ) / 2
    },
    span: {
      x: maxX - minX,
      y: maxY - minY,
      z: maxZ - minZ
    }
  };
}

function transformModel(model, { translate = { x: 0, y: 0, z: 0 }, scale = { x: 1, y: 1, z: 1 } }) {
  if (!model) {
    return null;
  }
  return {
    ...model,
    vertices: (model.vertices ?? []).map((vertex) => ({
      x: (vertex.x + translate.x) * scale.x,
      y: (vertex.y + translate.y) * scale.y,
      z: (vertex.z + translate.z) * scale.z
    })),
    meshes: (model.meshes ?? []).map((mesh) => ({
      ...mesh,
      positions: transformMeshPositions(mesh.positions, translate, scale)
    }))
  };
}

function transformMeshPositions(positions, translate, scale) {
  if (!positions?.length) {
    return positions;
  }
  const output = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    output[i] = (positions[i] + translate.x) * scale.x;
    output[i + 1] = (positions[i + 1] + translate.y) * scale.y;
    output[i + 2] = (positions[i + 2] + translate.z) * scale.z;
  }
  return output;
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
