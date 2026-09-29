/*
  CART Precision Racing car manifests (VEHICLE\<car>.CAR) for the truck viewer.

  Parsing is OpenPhotex's (parseCprCarLines); this adapter reshapes the result into the
  manifest object the viewer's assembly reads, alongside the TRK dialects.
*/
import { isCprCarLines, parseCprCarLines } from "../../vendor/openphotex/index.js";

export function isCprCarManifest(lines) {
  return isCprCarLines(lines);
}

export function parseCprCarManifest(lines) {
  const car = parseCprCarLines(lines);
  return {
    formatVersion: "CPR",
    modelExtension: ".BIN",
    truckName: car.truckName,
    truckModelBaseName: car.truckModelName ?? "",
    tireModelBaseName: car.tireModelNames[0] ?? "",
    tireModelNames: car.tireModelNames,
    wheelModelNames: car.wheelModelNames,
    helmetModelName: car.helmetModelName ?? "",
    helmetPosition: car.helmetPosition ?? undefined,
    paceCarFlag: car.paceCarFlag ?? 0,
    paceCarTireRadius: car.paceCarTireRadius ?? undefined,
    axleModelName: "",
    wheelAnchors: car.wheelAnchors,
    scrapePoints: car.scrapePoints,
    instrumentCluster: car.instrumentCluster ?? undefined,
    waveFiles: car.waveFiles,
    numberOfLights: 0,
    lights: [],
    unknownFields: car.unknownFields,
  };
}
