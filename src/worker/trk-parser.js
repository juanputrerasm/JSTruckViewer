/*
  Truck and car manifests: MTM1 and MTM2 .TRK, 4x4 Evolution .TRK and CART Precision Racing .CAR.

  Parsing and dialect detection are OpenPhotex's (src/vendor/openphotex). This file reshapes the
  MTM result into the manifest object the viewer's assembly and summary read; the Evo and CPR
  shapes come from evo/evo-trk-parser.js and cpr/car-parser.js.
*/
import { detectTruckManifest, parseMtmTrkLines, truckManifestLines } from "../vendor/openphotex/index.js";
import { parseEvoManifest } from "./evo/evo-trk-parser.js";
import { parseCprCarManifest } from "./cpr/car-parser.js";

export function parseTruckManifestText(text) {
  const lines = truckManifestLines(text);
  const kind = detectTruckManifest(lines);
  if (kind === "evo") return parseEvoManifest(lines);
  if (kind === "cpr-car") return parseCprCarManifest(lines);

  const trk = parseMtmTrkLines(lines);
  return {
    formatVersion: trk.dialect,
    modelExtension: ".BIN",
    truckName: trk.truckName,
    truckModelBaseName: trk.truckModelBaseName ?? "",
    tireModelBaseName: trk.tireModelBaseName ?? "",
    axleModelName: trk.axleModelName ?? "",
    shockTextureName: trk.shockTextureName ?? undefined,
    barTextureName: trk.barTextureName ?? undefined,
    axlebarOffset: trk.axlebarOffset ?? undefined,
    superiorAxlebarOffset: trk.superiorAxlebarOffset ?? undefined,
    driveshaftPos: trk.driveshaftPos ?? undefined,
    wheelAnchors: trk.wheelAnchors,
    scrapePoints: trk.scrapePoints,
    instrumentCluster: trk.instrumentCluster ?? undefined,
    waveFiles: trk.waveFiles,
    numberOfLights: trk.numberOfLights ?? undefined,
    lights: trk.lights.map(viewerLight),
    unknownFields: trk.unknownFields,
  };
}

/* The viewer reads a light's type only from a property labelled exactly "type", and draws a
   flare 0.25 ft across when the "body axis pos" line gives no radius. */
function viewerLight({ propertyLabels, ...light }) {
  if (!propertyLabels.includes("type")) delete light.type;
  if ("bitmapRadius" in light) light.bitmapRadius = light.bitmapRadius ?? 0.25;
  return light;
}
