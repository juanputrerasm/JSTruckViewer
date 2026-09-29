/*
  4x4 Evolution truck manifests (TRK v6 and v7) for the truck viewer.

  Parsing is OpenPhotex's (parseEvoTrkLines returns the manifest as written). This adapter only
  reshapes it into the manifest object the viewer's assembly and summary read, alongside the
  MTM1/MTM2 and CPR manifests trk-parser.js produces.
*/
import { isEvoTrkLines, parseEvoTrkLines } from "../../vendor/openphotex/index.js";

const FORMAT_VERSIONS = { 1: "EVO1", 2: "EVO2" };

/** True when these lines are an Evo manifest rather than an MTM1/MTM2 one. */
export function isEvoManifest(lines) {
  return isEvoTrkLines(lines);
}

export function parseEvoManifest(lines) {
  const trk = parseEvoTrkLines(lines, "TRK");
  const specs = {};
  for (const [label, value] of Object.entries(trk.specs)) {
    // Counted lists have always been read with parseFloat(v) || 0.
    specs[label] = label.endsWith("[]") && Array.isArray(value) ? value.map((v) => v || 0) : value;
  }
  return {
    formatVersion: FORMAT_VERSIONS[trk.game],
    trkVersion: trk.version,
    modelExtension: ".SMF",
    truckName: trk.truckName,
    truckModelBaseName: trk.truckModelBaseName ?? "",
    tireModelBaseName: trk.tireModelBaseName ?? "",
    axleModelName: trk.axleModelName ?? "",
    shockTextureName: trk.shockTextureName ?? undefined,
    barTextureName: trk.barTextureName ?? undefined,
    axlebarOffset: trk.axlebarOffset ?? undefined,
    superiorAxlebarOffset: undefined,
    driveshaftPos: trk.driveshaftPos ?? undefined,
    wheelAnchors: trk.wheelAnchors,
    scrapePoints: trk.scrapePoints,
    instrumentCluster: trk.instrumentCluster ?? undefined,
    waveFiles: trk.waveFiles,
    numberOfLights: trk.numberOfLights ?? undefined,
    lights: trk.lights,
    // Every stock paint scheme names "NULL" for its decal, so only the swatch is reported.
    colors: trk.colors.map((color) => ({
      ...color,
      red: Math.round(color.red),
      green: Math.round(color.green),
      blue: Math.round(color.blue),
    })),
    stockParts: trk.stockParts,
    specs,
    signature: trk.signature,
    unknownFields: {},
  };
}
