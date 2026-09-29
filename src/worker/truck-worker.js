import { joinPath, normalizeArchiveName, replaceExtension } from "../shared/path-utils.js";
import { extractPodEntry, findArtEntry, findAllTruckManifests, findEntryByNormalizedName, findFirstTruckManifest, findModelCandidatesByPrefix, indexPodFile } from "./pod-format.js";
import { parseTruckManifestText } from "./trk-parser.js";
import { decodeBinModel } from "./bin-decoder.js";
import { decodeSmfModel, isSmfModel } from "./evo/smf-parser.js";
import { decodeCprCmdModel } from "./cpr/cmd-parser.js";
import { decodeEvoTexture } from "./evo/evo-texture.js";
import { decodeRawTexture } from "./texture-decoder.js";
import { decodeTrueColorTexture } from "./image-decoder.js";
import { readFile, readTextFile } from "../shared/opfs.js";
import { bundledPalette, paletteCandidates } from "../vendor/openphotex/index.js";

const WHEEL_KEYS = [
  "faxle.rtire.static_bpos",
  "faxle.ltire.static_bpos",
  "raxle.rtire.static_bpos",
  "raxle.ltire.static_bpos"
];

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
        result = await extractPrimaryTruckManifest(payload.sessionId, payload.opfsPodPath, payload.podIndex, payload.extractionScope);
        break;
      case "extractTruckManifestByName":
        result = await extractTruckManifestByName(payload.sessionId, payload.opfsPodPath, payload.podIndex, payload.normalizedName, payload.extractionScope);
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

async function extractPrimaryTruckManifest(sessionId, opfsPodPath, podIndex, extractionScope = "") {
  const entry = findFirstTruckManifest(podIndex);
  if (!entry) {
    throw new Error("No TRUCK/*.TRK or VEHICLE/*.CAR manifest was found in the POD.");
  }
  const outputPath = extractedPath(sessionId, extractionScope, entry.normalizedName);
  await extractPodEntry(opfsPodPath, entry, outputPath);
  return { opfsTrkPath: outputPath, entry };
}

async function extractTruckManifestByName(sessionId, opfsPodPath, podIndex, normalizedName, extractionScope = "") {
  const entry = podIndex.entries.find((e) => e.normalizedName === normalizedName);
  if (!entry) {
    throw new Error(`Vehicle manifest not found in POD: ${normalizedName}`);
  }
  const outputPath = extractedPath(sessionId, extractionScope, entry.normalizedName);
  await extractPodEntry(opfsPodPath, entry, outputPath);
  return { opfsTrkPath: outputPath, entry };
}

async function assembleTruck({ sessionId, opfsPodPath, podIndex, manifest, manifestPath, extractionScope = "" }) {
  const warnings = [];
  const extractedFiles = [];

  if (manifestPath) {
    extractedFiles.push(manifestPath);
  }

  // MTM1 trucks are body plus four tires. They carry no axle model, axle bars, shocks,
  // driveshaft or lights, so those parts are skipped instead of being reported as missing.
  //
  // 4x4 Evolution goes further: its bodies model their own suspension as ordinary geometry,
  // and every stock manifest names "NULL.BIN" for the axle and "NULL.RAW" for the bars. So an
  // Evo truck is body plus four tires plus lights, with the same parts skipped as MTM1 but
  // the light markers kept.
  const isMtm1 = manifest.formatVersion === "MTM1";
  const isEvo = manifest.formatVersion === "EVO1" || manifest.formatVersion === "EVO2";
  const isCpr = manifest.formatVersion === "CPR";
  const hasChassisHardware = !isMtm1 && !isEvo && !isCpr;
  const modelExtension = manifest.modelExtension ?? ".BIN";

  const bodyExtension = isCpr ? modelExtensionFromName(manifest.truckModelBaseName, ".BIN") : modelExtension;
  const bodyEntry = resolveSingleModelEntry(podIndex, manifest.truckModelBaseName, "body", warnings, bodyExtension);
  const axleEntry = hasChassisHardware ? resolveSingleModelEntry(podIndex, manifest.axleModelName, "axle", warnings, modelExtension) : null;
  const wheelPlan = isCpr
    ? resolveCprWheelEntries(podIndex, manifest.wheelModelNames, warnings)
    : isMtm1
    ? resolveMtm1WheelEntries(podIndex, manifest.tireModelBaseName, warnings)
    : resolveWheelEntries(podIndex, manifest.tireModelBaseName, warnings, modelExtension);

  const body = await decodeExtractedModel(bodyEntry, "body", sessionId, opfsPodPath, extractionScope, extractedFiles);
  const axle = await decodeExtractedModel(axleEntry, "axle", sessionId, opfsPodPath, extractionScope, extractedFiles);
  const helmetEntry = isCpr
    ? resolveSingleModelEntry(podIndex, manifest.helmetModelName, "helmet", warnings, ".BIN")
    : null;
  const helmet = await decodeExtractedModel(helmetEntry, "helmet", sessionId, opfsPodPath, extractionScope, extractedFiles);

  const wheels = [];
  for (const wheelKey of WHEEL_KEYS) {
    const entry = wheelPlan.mapping[wheelKey] ?? null;
    const wheelModel = await decodeExtractedModel(entry, wheelKey, sessionId, opfsPodPath, extractionScope, extractedFiles);
    wheels.push({
      key: wheelKey,
      position: manifest.wheelAnchors[wheelKey] ?? { x: 0, y: 0, z: 0 },
      model: wheelModel
    });
  }

  const models = [body, axle, helmet, ...wheels.map((wheel) => wheel.model)].filter(Boolean);
  const textureNames = new Set();
  for (const model of models) {
    for (const name of model.textureNames ?? []) {
      if (name) {
        textureNames.add(name);
      }
    }
  }
  for (const extra of hasChassisHardware ? [manifest.shockTextureName, manifest.barTextureName] : []) {
    if (extra) {
      textureNames.add(normalizeArchiveName(extra));
    }
  }

  // The game picks the bundled METALCR2: CPR ships its own. Evo keeps MTM1's, as before.
  const origin = isCpr ? "CPR" : isMtm1 ? "MTM1" : "MTM2";
  const paletteContext = { podIndex, origin, sessionId, opfsPodPath, extractionScope, extractedFiles, cache: new Map() };

  if (isEvo) {
    const textures = await loadEvoTextures(textureNames, models, paletteContext, warnings);
    return finishAssembly({
      body,
      wheels,
      textures,
      manifest,
      warnings,
      extractedFiles,
      models,
      axles: [],
      axleBars: [],
      shocks: [],
      driveshaft: null,
      barTextureName: "",
      shockTextureName: "",
      lights: describeLights(manifest),
      lightTextures: await loadLightTextures(manifest, paletteContext, warnings)
    });
  }

  const textures = [];
  for (const name of textureNames) {
    const pngEntry = findArtEntry(podIndex, name, ".PNG");
    const tgaEntry = findArtEntry(podIndex, name, ".TGA");
    const rawEntry = findArtEntry(podIndex, name, ".RAW");
    const sourceEntry = pngEntry ?? tgaEntry ?? rawEntry;
    if (!sourceEntry) {
      warnings.push(`Texture ${name} was referenced but not found in ART.`);
      continue;
    }
    try {
      const decoded = await decodeArtEntry(sourceEntry, name, paletteContext, warnings);
      const normalStem = `${textureStem(name)}_N`;
      const normalEntry = findArtEntry(podIndex, normalStem, ".PNG") ?? findArtEntry(podIndex, normalStem, ".TGA");
      if (normalEntry) {
        const normalPath = extractedPath(sessionId, extractionScope, normalEntry.normalizedName);
        await extractPodEntry(opfsPodPath, normalEntry, normalPath);
        extractedFiles.push(normalPath);
        const normalBytes = new Uint8Array(await (await readFile(normalPath)).arrayBuffer());
        decoded.normal = await decodeTrueColorTexture(normalBytes, normalEntry.title, normalEntry.title.endsWith(".TGA") ? "TGA" : "PNG");
        const warning = hdDimensionWarning(normalEntry.title, decoded.normal);
        if (warning) warnings.push(warning);
      }
      textures.push(decoded);
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
  const frontAxleCenter = midpoint(axlePairs[0].leftAnchor, axlePairs[0].rightAnchor);
  const rearAxleCenter = midpoint(axlePairs[1].leftAnchor, axlePairs[1].rightAnchor);

  return finishAssembly({
    body,
    wheels,
    attachments: helmet ? [{ key: "helmet", model: helmet, position: manifest.helmetPosition ?? { x: 0, y: 0, z: 0 } }] : [],
    textures,
    manifest,
    warnings,
    extractedFiles,
    models,
    axles: isMtm1 || isCpr ? [] : axlePairs.map((pair) => buildAxlePlacement(axle, pair)),
    axleBars: isMtm1 || isCpr || suppressesAxleBars(manifest.axlebarOffset) ? [] : buildAxleBarDescriptors(
      frontAxleCenter,
      rearAxleCenter,
      manifest.axlebarOffset,
      manifest.superiorAxlebarOffset
    ),
    shocks: isMtm1 || isCpr ? [] : buildShockDescriptors(frontAxleCenter, rearAxleCenter),
    driveshaft: isMtm1 || isCpr || suppressesDriveshaft(manifest.driveshaftPos)
      ? null
      : buildDriveshaftDescriptor(frontAxleCenter, rearAxleCenter, manifest.driveshaftPos),
    barTextureName: isMtm1 || isCpr ? "" : (manifest.barTextureName ?? ""),
    shockTextureName: isMtm1 || isCpr ? "" : (manifest.shockTextureName ?? ""),
    lights: isMtm1 || isCpr ? [] : describeLights(manifest),
    lightTextures: isMtm1 || isCpr ? [] : await loadLightTextures(manifest, paletteContext, warnings)
  });
}

// Reads one ART entry (a paletted .RAW, or an HD .PNG/.TGA) into RGBA.
async function decodeArtEntry(sourceEntry, name, paletteContext, warnings) {
  const { sessionId, opfsPodPath, extractionScope, extractedFiles } = paletteContext;
  const sourcePath = extractedPath(sessionId, extractionScope, sourceEntry.normalizedName);
  await extractPodEntry(opfsPodPath, sourceEntry, sourcePath);
  extractedFiles.push(sourcePath);
  const sourceBytes = new Uint8Array(await (await readFile(sourcePath)).arrayBuffer());
  if (sourceEntry.title.endsWith(".RAW")) {
    const actBytes = await resolvePaletteBytes(name, paletteContext);
    return decodeRawTexture(sourceBytes, actBytes, replaceExtension(name, ".RAW"));
  }
  const decoded = await decodeTrueColorTexture(sourceBytes, sourceEntry.title, sourceEntry.title.endsWith(".TGA") ? "TGA" : "PNG");
  decoded.name = name;
  const warning = hdDimensionWarning(sourceEntry.title, decoded);
  if (warning) warnings.push(warning);
  return decoded;
}

/*
  The bitmaps a light draws with: its source flare (HEADLITE.RAW, BRLTFORD.RAW, ...) and its
  beam texture (LITEFUZZ.RAW, REDFUZZ.RAW, BLUEFUZZ.RAW).

  The flares ship beside the trucks in TRUCK2.POD, but the stock game keeps the three fuzz
  textures in STARTUP.POD, so a truck archive on its own normally lacks them. A missing one
  is not worth a warning: the scene falls back to a generated noise of the same tint.
*/
async function loadLightTextures(manifest, paletteContext, warnings) {
  const names = new Set();
  for (const light of manifest.lights ?? []) {
    if (light?.sourceBitmap) names.add(normalizeArchiveName(light.sourceBitmap));
    if (light?.coneTexture && light.coneLength > 0) names.add(normalizeArchiveName(light.coneTexture));
  }
  const textures = [];
  for (const name of names) {
    const entry = findArtEntry(paletteContext.podIndex, name, ".PNG")
      ?? findArtEntry(paletteContext.podIndex, name, ".TGA")
      ?? findArtEntry(paletteContext.podIndex, name, ".RAW");
    if (!entry) continue;
    try {
      textures.push(await decodeArtEntry(entry, name, paletteContext, warnings));
    } catch (error) {
      warnings.push(`Light bitmap ${name}: ${error.message}`);
    }
  }
  return textures;
}

// Both assembly paths end the same way: fold each model's own parse warnings into the
// assembly's list and hand the scene one shape.
function finishAssembly({
  body, wheels, textures, manifest, warnings, extractedFiles, models,
  axles, axleBars, shocks, driveshaft, barTextureName, shockTextureName, lights, lightTextures = [], attachments = []
}) {
  for (const model of models) {
    warnings.push(...(model.warnings ?? []).map((warning) => `${model.name}: ${warning}`));
  }
  return {
    body,
    attachments,
    axles,
    axleBars,
    shocks,
    driveshaft,
    barTextureName,
    shockTextureName,
    wheels,
    scrapePoints: manifest.scrapePoints ?? [],
    lights,
    lightTextures,
    textures,
    warnings,
    extractedFiles: [...new Set(extractedFiles)]
  };
}

/*
  How a small-tire truck says "no axle bars" and "no driveshaft".

  MTM2's axle bars and driveshaft are monster-truck hardware, and a car body has nowhere to
  hang them. There is no flag for turning them off, so the community idiom is to put the
  mount somewhere the geometry cannot be seen: the Dodge Viper GTS-R ships an axlebarOffset of
  "-2.000000,999.000000,0.000000" with an all-zero driveshaftPos.

  Taken literally that draws a pair of 999-foot columns, which is what this viewer used to do.
  The thresholds come from the stock corpus: across all 20 trucks in TRUCK2.POD the axle-bar
  mount sits 2.156 to 3.250 ft from the body and not one of them has a zero driveshaft, so
  anything past 50 ft - further than a truck is long - is a sentinel rather than a position.
*/
const AXLE_BAR_SENTINEL_DISTANCE = 50;

function suppressesAxleBars(offset) {
  if (!offset) return false;
  return Math.abs(offset.x ?? 0) >= AXLE_BAR_SENTINEL_DISTANCE
    || Math.abs(offset.y ?? 0) >= AXLE_BAR_SENTINEL_DISTANCE
    || Math.abs(offset.z ?? 0) >= AXLE_BAR_SENTINEL_DISTANCE;
}

function suppressesDriveshaft(position) {
  return !!position && !(position.x ?? 0) && !(position.y ?? 0) && !(position.z ?? 0);
}

/*
  One record per light, in truck space and feet, as the TRK states it:

    type     0 headlight, 1 brake/tail, 3 roof light bar, 4 special (beacon, blinker),
             5 reverse. Type 2 does not occur in the stock MTM2 trucks.
    heading  radians about the vertical, 0 = straight ahead (+z), pi = straight back
    pitch    radians, positive aims up
    spin     heading change in rad/s - the Monster Patrol beacons turn once a second
    cone     beam length and its radius at the lamp and at the far end; length 0 = no beam
    source   the flare sprite drawn at the lamp, radius = bitmap radius
    msOn/Off blink period; 0,0 = steady
*/
function describeLights(manifest) {
  return (manifest.lights ?? [])
    .filter((light) => light?.pos)
    .map((light) => ({
      index: light.index,
      type: light.type ?? 0,
      pos: light.pos,
      radius: Math.max(light.bitmapRadius ?? 0.25, 0.05),
      heading: light.heading ?? 0,
      pitch: light.pitch ?? 0,
      spinSpeed: light.spinSpeed ?? 0,
      coneLength: light.coneLength ?? 0,
      coneBaseRadius: light.coneBaseRadius ?? 0,
      coneRimRadius: light.coneRimRadius ?? 0,
      coneTexture: light.coneTexture ? normalizeArchiveName(light.coneTexture) : "",
      sourceBitmap: light.sourceBitmap ? normalizeArchiveName(light.sourceBitmap) : "",
      msOn: light.msOn ?? 0,
      msOff: light.msOff ?? 0
    }));
}

/*
  Evo texture resolution. Each .SMF group names its diffuse map outright ("TRBLAZ.RAW",
  "TrailBlazer.TIF"), and the Evo 2 groups additionally name a bump map, so nothing here has
  to guess at a "_N" companion the way the HD MTM2 path does.

  A .RAW needs its same-stem .ACT and, when one exists, its same-stem .OPA. Both are looked
  up per texture: Evo has no archive-wide palette, so a missing .ACT is a hard failure for
  that one texture rather than a reason to fall back to someone else's colours.
*/
async function loadEvoTextures(textureNames, models, context, warnings) {
  const bumpByDiffuse = new Map();
  for (const model of models) {
    for (const mesh of model.meshes ?? []) {
      if (mesh.textureName && mesh.bumpTextureName) {
        bumpByDiffuse.set(mesh.textureName, mesh.bumpTextureName);
      }
    }
  }

  const textures = [];
  for (const name of textureNames) {
    try {
      const decoded = await decodeEvoArtEntry(name, context);
      const bumpName = bumpByDiffuse.get(name);
      if (bumpName) {
        try {
          decoded.normal = await decodeEvoArtEntry(bumpName, context);
        } catch (error) {
          warnings.push(error.message);
        }
      }
      textures.push(decoded);
    } catch (error) {
      warnings.push(error.message);
    }
  }
  return textures;
}

async function decodeEvoArtEntry(textureName, context) {
  const entry = findArtEntryByTitle(context.podIndex, textureName);
  if (!entry) {
    throw new Error(`Texture ${textureName} was referenced but not found in ART.`);
  }
  const sourceBytes = await readArchivedBytes(entry, context);
  const isRaw = entry.title.endsWith(".RAW");
  const actBytes = isRaw ? await readCompanionBytes(textureName, ".ACT", context) : null;
  const opaBytes = isRaw ? await readCompanionBytes(textureName, ".OPA", context) : null;
  const decoded = decodeEvoTexture(sourceBytes, actBytes, opaBytes, textureName);
  decoded.name = textureName;
  return decoded;
}

async function readCompanionBytes(textureName, extension, context) {
  const entry = findArtEntry(context.podIndex, textureName, extension);
  return entry ? readArchivedBytes(entry, context) : null;
}

async function readArchivedBytes(entry, context) {
  const { sessionId, opfsPodPath, extractionScope, extractedFiles, cache } = context;
  if (cache.has(entry.normalizedName)) {
    return cache.get(entry.normalizedName);
  }
  const path = extractedPath(sessionId, extractionScope, entry.normalizedName);
  await extractPodEntry(opfsPodPath, entry, path);
  extractedFiles.push(path);
  const bytes = new Uint8Array(await (await readFile(path)).arrayBuffer());
  cache.set(entry.normalizedName, bytes);
  return bytes;
}

// Evo models name their textures with the extension already attached, so the lookup keeps it
// rather than substituting one the way the MTM path has to.
function findArtEntryByTitle(podIndex, textureName) {
  const title = normalizeArchiveName(textureName).split("/").pop() ?? "";
  return findEntryByNormalizedName(podIndex, joinPath("ART", title)) ?? findEntryByTitle(podIndex, title);
}

function textureStem(name) {
  const title = normalizeArchiveName(name).split("/").pop() ?? "";
  return title.replace(/\.[^.]+$/, "");
}

function hdDimensionWarning(name, texture) {
  const valid = texture.width === texture.height
    && texture.width >= 32 && texture.width <= 1024
    && (texture.width & (texture.width - 1)) === 0;
  return valid ? null : `${name} is ${texture.width}×${texture.height}; the engine will resample it to a square power-of-two size in 32..1024`;
}

const PREVIEW_UNIT_SCALE = 1 / 256;
const SHOCK_OFFSET_X = 542 * PREVIEW_UNIT_SCALE;
const SHOCK_OFFSET_Y = 85 * PREVIEW_UNIT_SCALE;
const SHOCK_PAIR_Z_OFFSET = 70 * PREVIEW_UNIT_SCALE;
const AXLE_BAR_OFFSET_X = 535 * PREVIEW_UNIT_SCALE;
const AXLE_BAR_OFFSET_Y = -80 * PREVIEW_UNIT_SCALE;
const AXLE_BAR_OFFSET_Z = -83 * PREVIEW_UNIT_SCALE;
const AXLE_BAR_MIDDLE_Y_BIAS = 45 * PREVIEW_UNIT_SCALE;

function buildShockDescriptors(frontAxleCenter, rearAxleCenter) {
  const buildWheelShockPair = (prefix, axleCenter, side) => {
    const shockX = axleCenter.x + side * SHOCK_OFFSET_X;
    return [
      {
        key: `${prefix}_inner`,
        base: { x: shockX, y: 0, z: axleCenter.z - SHOCK_PAIR_Z_OFFSET },
        top: { x: shockX, y: axleCenter.y + SHOCK_OFFSET_Y, z: axleCenter.z - SHOCK_PAIR_Z_OFFSET },
        baseAttachment: "body",
        topAttachment: "axle"
      },
      {
        key: `${prefix}_outer`,
        base: { x: shockX, y: 0, z: axleCenter.z + SHOCK_PAIR_Z_OFFSET },
        top: { x: shockX, y: axleCenter.y + SHOCK_OFFSET_Y, z: axleCenter.z + SHOCK_PAIR_Z_OFFSET },
        baseAttachment: "body",
        topAttachment: "axle"
      }
    ];
  };
  return [
    ...buildWheelShockPair("shock_fl", frontAxleCenter, -1),
    ...buildWheelShockPair("shock_fr", frontAxleCenter, 1),
    ...buildWheelShockPair("shock_rl", rearAxleCenter, -1),
    ...buildWheelShockPair("shock_rr", rearAxleCenter, 1)
  ];
}

function buildAxleBarDescriptors(frontAxleCenter, rearAxleCenter, barOffset = null, superiorBarOffset = null) {
  return [
    ...buildAxleBarSet("lower", frontAxleCenter, rearAxleCenter, barOffset, { optional: false }),
    ...buildSuperiorAxleBarSet(frontAxleCenter, rearAxleCenter, barOffset, superiorBarOffset)
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
    rear: rearAxleCenter,
    hubAttachment: "body",
    frontAttachment: "axle",
    rearAttachment: "axle"
  };
}

function buildAxlePlacement(axleModel, pair) {
  const position = midpoint(pair.leftAnchor, pair.rightAnchor);
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

function resolveSingleModelEntry(podIndex, requestedName, label, warnings, extension = ".BIN") {
  if (!requestedName) {
    warnings.push(`Manifest did not define a ${label} model name.`);
    return null;
  }
  const normalized = normalizeArchiveName(requestedName);
  const fullPath = normalized.startsWith("MODELS/") ? normalized : joinPath("MODELS", normalized);
  const exact = findEntryByNormalizedName(podIndex, fullPath) ?? findEntryByNormalizedName(podIndex, replaceExtension(fullPath, extension));
  if (exact) {
    return exact;
  }
  const stem = textureStem(requestedName);
  /*
    The numbered-suffix search is an MTM convention, where a higher number is a HIGHER detail
    model. Evo reads the opposite way - TRBLAZ.SMF is the full body and TRBLAZ0.SMF the
    reduced one - so running it on an .SMF archive would pick the low-detail model whenever
    the exact name missed. The exact name is present for every stock Evo truck, so the
    fallback is simply not offered there.
  */
  if (extension === ".BIN") {
    const appendedLods = findNumberedLodEntries(podIndex, stem);
    if (appendedLods.length) {
      warnings.push(`Resolved ${label} model ${requestedName} to full-stem LOD ${appendedLods[0].name}.`);
      return appendedLods[0];
    }
    if (stem.length > 7) {
      const legacyLods = findNumberedLodEntries(podIndex, stem.slice(0, 7));
      if (legacyLods.length) {
        warnings.push(`Resolved ${label} model ${requestedName} through the legacy offset-7 LOD name ${legacyLods[0].name}.`);
        return legacyLods[0];
      }
    }
  }
  const candidates = findModelCandidatesByPrefix(podIndex, requestedName, extension);
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

function findNumberedLodEntries(podIndex, stem) {
  const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`^${escaped}(\\d+)\\.BIN$`, "i");
  return podIndex.entries
    .map((entry) => ({ entry, match: entry.normalizedName.startsWith("MODELS/") ? entry.title.match(matcher) : null }))
    .filter(({ match }) => match)
    .sort((a, b) => Number(b.match[1]) - Number(a.match[1]))
    .map(({ entry }) => entry);
}

// MTM1 names one tire model outright ("wheel13.bin") and reuses it on all four corners.
// Its sidewalls carry the same hub texture on both faces, so no left/right mirroring is needed.
function resolveMtm1WheelEntries(podIndex, tireModelName, warnings) {
  const mapping = {};
  if (!tireModelName) {
    warnings.push("Manifest did not define tireModelName.");
    return { mapping };
  }
  const entry = resolveSingleModelEntry(podIndex, tireModelName, "tire", warnings);
  if (!entry) {
    return { mapping };
  }
  for (const wheelKey of WHEEL_KEYS) {
    mapping[wheelKey] = entry;
  }
  return { mapping, candidates: [entry] };
}

function resolveCprWheelEntries(podIndex, wheelModelNames = {}, warnings) {
  const mapping = {};
  for (const wheelKey of WHEEL_KEYS) {
    const requestedName = wheelModelNames[wheelKey];
    mapping[wheelKey] = resolveSingleModelEntry(podIndex, requestedName, `wheel ${wheelKey}`, warnings, ".BIN");
  }
  return { mapping, candidates: Object.values(mapping).filter(Boolean) };
}

function resolveWheelEntries(podIndex, prefix, warnings, extension = ".BIN") {
  const mapping = {};
  if (!prefix) {
    warnings.push("Manifest did not define tireModelBaseName.");
    return { mapping };
  }
  const prefixMatches = findModelCandidatesByPrefix(podIndex, prefix, extension);
  if (!prefixMatches.length) {
    warnings.push(`Could not resolve any tire models for prefix ${prefix}.`);
    return { mapping };
  }

  /*
    A bare prefix search also catches a longer, unrelated family: "CLASS3TIRE" matches
    CLASS3TIREB16L as readily as CLASS3TIRE16L, and both score 16 on the detail-tier sort, so
    which one a truck got came down to POD directory order. Candidates that are exactly the
    prefix plus a detail tier and a side - the shape every stock tire set in MTM2, MTM2.1 and
    both Evo games uses - are preferred, and the loose set is kept only as a fallback for an
    archive that names its tires some other way.
  */
  const strictPattern = new RegExp(`^${escapeForRegExp(prefix.toUpperCase())}\\d+[FR]?[LR]\\${extension}$`, "i");
  const strictMatches = prefixMatches.filter((entry) => strictPattern.test(entry.title));
  const candidates = strictMatches.length ? strictMatches : prefixMatches;

  // Sort by numeric suffix descending so the highest-poly (largest number) model is first.
  // Evo names its tire detail tiers the same way MTM2 does - BLZRTR08L/12L/16L - so the one
  // rule covers both once the extension is substituted.
  const byNumber = (entry) => {
    const m = entry.title.match(new RegExp(`(\\d+)[LR]\\${extension}$`, "i"));
    return m ? parseInt(m[1], 10) : 0;
  };
  const left = candidates.filter((e) => e.title.endsWith(`L${extension}`)).sort((a, b) => byNumber(b) - byNumber(a));
  const right = candidates.filter((e) => e.title.endsWith(`R${extension}`)).sort((a, b) => byNumber(b) - byNumber(a));

  const bestLeft = left[0] ?? null;
  const bestRight = right[0] ?? null;
  // MTM2 2.1 can provide four distinct high-detail wheel models: 16FL/16FR/16RL/16RR.
  const enhancedFrontLeft = pickWheelCandidate(candidates, `16FL${extension}`);
  const enhancedFrontRight = pickWheelCandidate(candidates, `16FR${extension}`);
  const enhancedRearLeft = pickWheelCandidate(candidates, `16RL${extension}`);
  const enhancedRearRight = pickWheelCandidate(candidates, `16RR${extension}`);

  if (enhancedFrontLeft || enhancedFrontRight || enhancedRearLeft || enhancedRearRight) {
    mapping["faxle.rtire.static_bpos"] = enhancedFrontRight ?? bestRight;
    mapping["faxle.ltire.static_bpos"] = enhancedFrontLeft ?? bestLeft;
    mapping["raxle.rtire.static_bpos"] = enhancedRearRight ?? bestRight;
    mapping["raxle.ltire.static_bpos"] = enhancedRearLeft ?? bestLeft;
    if (!enhancedFrontLeft || !enhancedFrontRight || !enhancedRearLeft || !enhancedRearRight) {
      warnings.push(`MTM2 2.1 tire set for ${prefix} is incomplete, falling back to legacy left/right wheel models where needed.`);
    }
    return { mapping, candidates, enhanced: true };
  }

  // Use the highest-resolution model for all four wheel positions.
  mapping["faxle.rtire.static_bpos"] = bestRight;
  mapping["faxle.ltire.static_bpos"] = bestLeft;
  mapping["raxle.rtire.static_bpos"] = bestRight;
  mapping["raxle.ltire.static_bpos"] = bestLeft;

  return { mapping, candidates };
}

function buildAxleBarSet(prefix, frontAxleCenter, rearAxleCenter, barOffset = null, { optional = false } = {}) {
  if (optional && !barOffset) {
    return [];
  }
  const resolvedOffset = barOffset ?? { x: 0, y: 0, z: 0 };
  const middleRight = {
    x: resolvedOffset.x ?? 0,
    y: (resolvedOffset.y ?? 0) + AXLE_BAR_MIDDLE_Y_BIAS,
    z: resolvedOffset.z ?? 0
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
    { key: `${prefix}_axle_bar_left_front`, start: middleLeft, end: frontLeft, startAttachment: "body", endAttachment: "axle" },
    { key: `${prefix}_axle_bar_left_rear`, start: middleLeft, end: rearLeft, startAttachment: "body", endAttachment: "axle" },
    { key: `${prefix}_axle_bar_right_front`, start: middleRight, end: frontRight, startAttachment: "body", endAttachment: "axle" },
    { key: `${prefix}_axle_bar_right_rear`, start: middleRight, end: rearRight, startAttachment: "body", endAttachment: "axle" }
  ];
}

function buildSuperiorAxleBarSet(frontAxleCenter, rearAxleCenter, baseBarOffset = null, superiorBarOffset = null) {
  if (!superiorBarOffset) {
    return [];
  }
  // MTM2 2.1 stores the second axle-bar heights relative to the legacy axle-bar layout:
  // front connection Y, rear connection Y, and midpoint Y. X/Z still follow the base axle-bar.
  const resolvedBaseOffset = baseBarOffset ?? { x: 0, y: 0, z: 0 };
  const middleRight = {
    x: resolvedBaseOffset.x ?? 0,
    y: (resolvedBaseOffset.y ?? 0) + AXLE_BAR_MIDDLE_Y_BIAS + (superiorBarOffset.middleY ?? 0) * PREVIEW_UNIT_SCALE,
    z: resolvedBaseOffset.z ?? 0
  };
  const middleLeft = { x: -middleRight.x, y: middleRight.y, z: middleRight.z };
  const frontRight = {
    x: frontAxleCenter.x + AXLE_BAR_OFFSET_X,
    y: frontAxleCenter.y + AXLE_BAR_OFFSET_Y + (superiorBarOffset.frontAxleY ?? 0) * PREVIEW_UNIT_SCALE,
    z: frontAxleCenter.z + AXLE_BAR_OFFSET_Z
  };
  const frontLeft = {
    x: frontRight.x - 2 * AXLE_BAR_OFFSET_X,
    y: frontRight.y,
    z: frontRight.z
  };
  const rearRight = {
    x: rearAxleCenter.x + AXLE_BAR_OFFSET_X,
    y: rearAxleCenter.y + AXLE_BAR_OFFSET_Y + (superiorBarOffset.rearAxleY ?? 0) * PREVIEW_UNIT_SCALE,
    z: rearAxleCenter.z - AXLE_BAR_OFFSET_Z
  };
  const rearLeft = {
    x: rearRight.x - 2 * AXLE_BAR_OFFSET_X,
    y: rearRight.y,
    z: rearRight.z
  };
  return [
    { key: "upper_axle_bar_left_front", start: middleLeft, end: frontLeft, startAttachment: "body", endAttachment: "axle" },
    { key: "upper_axle_bar_left_rear", start: middleLeft, end: rearLeft, startAttachment: "body", endAttachment: "axle" },
    { key: "upper_axle_bar_right_front", start: middleRight, end: frontRight, startAttachment: "body", endAttachment: "axle" },
    { key: "upper_axle_bar_right_rear", start: middleRight, end: rearRight, startAttachment: "body", endAttachment: "axle" }
  ];
}

function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pickWheelCandidate(candidates, suffix) {
  const upperSuffix = suffix.toUpperCase();
  return candidates.find((entry) => entry.title.toUpperCase().endsWith(upperSuffix)) ?? null;
}

/*
  Palette resolution for paletted RAW textures. The ranking is OpenPhotex's paletteCandidates:
  a same-name .ACT beside the texture, then the palette the POD1 entry names, then the
  archive's own METALCR2.ACT, then the bundled METALCR2 for this game (CPR's differs from
  MTM1's and MTM2's), so a TRUCK.POD renders without STARTUP.POD. MTM2 archives normally ship
  a same-name palette per texture and stop at the first.
*/
async function resolvePaletteBytes(textureName, context) {
  const { podIndex, origin, sessionId, opfsPodPath, extractionScope, extractedFiles, cache } = context;
  const rawEntry = findArtEntry(podIndex, textureName, ".RAW");
  for (const candidate of paletteCandidates(podIndex, { name: textureName, entry: rawEntry }, { origin, kind: "model" })) {
    if (candidate.bundled) return bundledPalette(candidate.bundled);
    const entry = candidate.entry;
    if (!entry) continue;
    if (!cache.has(entry.normalizedName)) {
      const actPath = extractedPath(sessionId, extractionScope, entry.normalizedName);
      await extractPodEntry(opfsPodPath, entry, actPath);
      extractedFiles.push(actPath);
      cache.set(entry.normalizedName, new Uint8Array(await (await readFile(actPath)).arrayBuffer()));
    }
    const bytes = cache.get(entry.normalizedName);
    if (bytes.length >= 768) return bytes;
  }
  return null;
}

async function decodeExtractedModel(entry, label, sessionId, opfsPodPath, extractionScope, extractedFiles) {
  if (!entry) {
    return null;
  }
  const outputPath = extractedPath(sessionId, extractionScope, entry.normalizedName);
  await extractPodEntry(opfsPodPath, entry, outputPath);
  extractedFiles.push(outputPath);
  const bytes = new Uint8Array(await (await readFile(outputPath)).arrayBuffer());
  // SMF and BIN are chosen by content; CPR's textual CMD is identified by its extension.
  const model = entry.title.endsWith(".CMD")
    ? decodeCprCmdModel(new TextDecoder("windows-1252").decode(bytes), entry.title)
    : isSmfModel(bytes)
      ? decodeSmfModel(bytes, entry.title)
      : decodeBinModel(bytes, entry.title);
  model.partKey = label;
  return model;
}

function modelExtensionFromName(name, fallback) {
  const match = String(name ?? "").match(/(\.[^.\\/]+)$/);
  return match ? match[1].toUpperCase() : fallback;
}

function extractedPath(sessionId, extractionScope, normalizedName) {
  return joinPath("sessions", sessionId, "extracted", extractionScope, normalizedName);
}
