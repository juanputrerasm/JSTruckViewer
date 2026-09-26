const WHEEL_KEYS_IN_FILE_ORDER = [
  "faxle.ltire.static_bpos",
  "faxle.rtire.static_bpos",
  "raxle.ltire.static_bpos",
  "raxle.rtire.static_bpos"
];

export function isCprCarManifest(lines) {
  return (lines[0] === "truckName" || lines[0] === "gtruckName")
    && lines.some((line) => line === "Helmet name" || line === "paceCarFlag");
}

export function parseCprCarManifest(lines) {
  let index = 0;
  const firstLabel = lines[index++] ?? "";
  if (firstLabel !== "truckName" && firstLabel !== "gtruckName") {
    throw new Error(`Unsupported CPR CAR header: ${firstLabel || "<empty>"}`);
  }

  const manifest = {
    formatVersion: "CPR",
    modelExtension: ".BIN",
    truckName: lines[index++] ?? "",
    truckModelBaseName: "",
    tireModelBaseName: "",
    tireModelNames: [],
    wheelModelNames: {},
    helmetModelName: "",
    helmetPosition: undefined,
    paceCarFlag: 0,
    paceCarTireRadius: undefined,
    axleModelName: "",
    wheelAnchors: {},
    scrapePoints: [],
    instrumentCluster: undefined,
    waveFiles: [],
    numberOfLights: 0,
    lights: [],
    unknownFields: {}
  };

  const partialAnchors = new Map();
  while (index < lines.length) {
    const label = lines[index++];
    if (label === "truckModelName") {
      manifest.truckModelBaseName = lines[index++] ?? "";
      continue;
    }
    if (label === "tireModelName") {
      manifest.tireModelNames = lines.slice(index, index + 4);
      index += manifest.tireModelNames.length;
      manifest.tireModelBaseName = manifest.tireModelNames[0] ?? "";
      for (let i = 0; i < manifest.tireModelNames.length; i += 1) {
        manifest.wheelModelNames[WHEEL_KEYS_IN_FILE_ORDER[i]] = manifest.tireModelNames[i];
      }
      continue;
    }
    if (label.startsWith("Scrape point ")) {
      manifest.scrapePoints.push(parseVec3(lines[index++]));
      continue;
    }
    if (label === "Instrument Cluster") {
      manifest.instrumentCluster = lines[index++] ?? "";
      continue;
    }
    if (label === "Wave File") {
      while (index < lines.length && !isCarLabel(lines[index])) {
        manifest.waveFiles.push(lines[index++]);
      }
      continue;
    }
    if (label === "Helmet name") {
      manifest.helmetModelName = lines[index++] ?? "";
      continue;
    }
    if (label === "Helmet pos") {
      manifest.helmetPosition = parseVec3(lines[index++]);
      continue;
    }
    if (label === "paceCarFlag") {
      manifest.paceCarFlag = parseInt(lines[index++] ?? "0", 10) || 0;
      continue;
    }
    if (label === "paceCarTireRadius") {
      manifest.paceCarTireRadius = parseFloat(lines[index++] ?? "0") || 0;
      continue;
    }

    const axisMatch = label.match(/^(.*)\.(x|y|z)$/i);
    if (axisMatch) {
      const anchorKey = axisMatch[1];
      const axis = axisMatch[2].toLowerCase();
      const current = partialAnchors.get(anchorKey) ?? { x: 0, y: 0, z: 0 };
      current[axis] = parseFloat(lines[index++] ?? "0") || 0;
      partialAnchors.set(anchorKey, current);
      continue;
    }

    manifest.unknownFields[label] = lines[index++] ?? "";
  }

  for (const [key, value] of partialAnchors) {
    manifest.wheelAnchors[key] = value;
  }
  return manifest;
}

function isCarLabel(line) {
  return line === "truckModelName"
    || line === "tireModelName"
    || line === "Instrument Cluster"
    || line === "Wave File"
    || line === "Helmet name"
    || line === "Helmet pos"
    || line === "paceCarFlag"
    || line === "paceCarTireRadius"
    || line.startsWith("Scrape point ")
    || /^(.*)\.(x|y|z)$/i.test(line);
}

function parseVec3(value = "") {
  const [x = "0", y = "0", z = "0"] = value.split(",");
  return {
    x: parseFloat(x) || 0,
    y: parseFloat(y) || 0,
    z: parseFloat(z) || 0
  };
}
