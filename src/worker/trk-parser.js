export function parseTruckManifestText(text) {
  const lines = text
    // NUL padding and the DOS end-of-file marker (0x1A) both show up in shipped MTM1 manifests.
    .replace(/[\u0000\u001a]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const headerLine = lines[0] ?? "";
  const upperHeader = headerLine.toUpperCase();

  // MTM2 manifests open with a format header such as "MTM2 truckName" or "MTM2.1 truckName",
  // followed by the unlabeled truck name. MTM1 manifests have no header at all: they open with
  // the bare "truckName" label, which is the reliable way to tell the two generations apart.
  const isMtm2 = upperHeader.startsWith("MTM2");
  const isMtm1 = !isMtm2 && upperHeader.startsWith("TRUCKNAME");
  if (isMtm2 || isMtm1) {
    lines.shift();
  }

  // Next line is the truck name value (unlabeled).
  const truckName = lines.shift() ?? "";

  const manifest = {
    formatVersion: isMtm1 ? "MTM1" : upperHeader.startsWith("MTM2.1") ? "MTM2.1" : "MTM2",
    truckName,
    truckModelBaseName: "",
    tireModelBaseName: "",
    axleModelName: "",
    shockTextureName: undefined,
    barTextureName: undefined,
    axlebarOffset: undefined,
    superiorAxlebarOffset: undefined,
    driveshaftPos: undefined,
    wheelAnchors: {},
    scrapePoints: [],
    instrumentCluster: undefined,
    waveFiles: [],
    numberOfLights: undefined,
    lights: [],
    unknownFields: {}
  };

  const partialAnchors = new Map();

  for (let i = 0; i < lines.length; i += 1) {
    const label = lines[i];
    const value = lines[i + 1] ?? "";

    // MTM2 stores model stems ("bigfoot"); MTM1 stores full file names ("bigfoot.bin").
    // Both resolve through the same model lookup, so they share the manifest fields.
    if (label === "truckModelBaseName" || label === "truckModelName") {
      manifest.truckModelBaseName = value;
      i += 1;
      continue;
    }
    if (label === "tireModelBaseName" || label === "tireModelName") {
      manifest.tireModelBaseName = value;
      i += 1;
      continue;
    }
    if (label === "axleModelName") {
      manifest.axleModelName = value;
      i += 1;
      continue;
    }
    if (label === "shockTextureName") {
      manifest.shockTextureName = value;
      i += 1;
      continue;
    }
    if (label === "barTextureName") {
      manifest.barTextureName = value;
      i += 1;
      continue;
    }
    if (label === "axlebarOffset") {
      manifest.axlebarOffset = parseVec3(value);
      i += 1;
      continue;
    }
    if (label === "superiorAxlebarOffset") {
      manifest.superiorAxlebarOffset = parseSuperiorAxlebarOffset(value);
      i += 1;
      continue;
    }
    if (label === "driveshaftPos") {
      manifest.driveshaftPos = parseVec3(value);
      i += 1;
      continue;
    }
    if (label.startsWith("Scrape point ")) {
      manifest.scrapePoints.push(parseVec3(value));
      i += 1;
      continue;
    }
    if (label === "Instrument Cluster") {
      manifest.instrumentCluster = value;
      i += 1;
      continue;
    }
    if (label === "Wave File") {
      manifest.waveFiles.push(value);
      i += 1;
      while (i + 1 < lines.length && !isManifestLabel(lines[i + 1])) {
        manifest.waveFiles.push(lines[i + 1]);
        i += 1;
      }
      continue;
    }
    if (label === "Number of Lights") {
      manifest.numberOfLights = parseInt(value, 10) || 0;
      i += 1;
      continue;
    }
    const lightMatch = label.match(/^Light (\d+) /);
    if (lightMatch) {
      const idx = parseInt(lightMatch[1], 10);
      const prop = label.slice(lightMatch[0].length).trim();
      while (manifest.lights.length <= idx) manifest.lights.push(null);
      if (!manifest.lights[idx]) manifest.lights[idx] = { index: idx };
      const light = manifest.lights[idx];
      if (prop.startsWith("body axis pos")) {
        const parts = value.split(",").map((v) => parseFloat(v) || 0);
        light.pos = { x: parts[0] ?? 0, y: parts[1] ?? 0, z: parts[2] ?? 0 };
        light.bitmapRadius = parts[3] ?? 0.25;
      } else if (prop.startsWith("heading")) {
        const parts = value.split(",").map((v) => parseFloat(v) || 0);
        light.heading = parts[0] ?? 0;
        light.pitch = parts[1] ?? 0;
        light.spinSpeed = parts[2] ?? 0;
      } else if (prop.startsWith("cone:")) {
        const parts = value.split(",");
        light.coneLength = parseFloat(parts[0]) || 0;
        light.coneBaseRadius = parseFloat(parts[1]) || 0;
        light.coneRimRadius = parseFloat(parts[2]) || 0;
        light.coneTexture = (parts[3] ?? "").trim();
      } else if (prop.startsWith("source:")) {
        light.sourceBitmap = value.trim();
      } else if (prop.startsWith("ms on")) {
        const [on, off] = value.split(",").map((v) => parseInt(v, 10) || 0);
        light.msOn = on;
        light.msOff = off;
      }
      i += 1;
      continue;
    }

    const axisMatch = label.match(/^(.*)\.(x|y|z)$/i);
    if (axisMatch) {
      const anchorKey = axisMatch[1];
      const axis = axisMatch[2].toLowerCase();
      const current = partialAnchors.get(anchorKey) ?? { x: 0, y: 0, z: 0 };
      current[axis] = parseFloat(value) || 0;
      partialAnchors.set(anchorKey, current);
      i += 1;
      continue;
    }

    manifest.unknownFields[label] = value;
    i += 1;
  }

  for (const [key, vec] of partialAnchors.entries()) {
    manifest.wheelAnchors[key] = vec;
  }

  manifest.lights = manifest.lights.filter(Boolean);

  return manifest;
}

function parseVec3(value) {
  const [x = "0", y = "0", z = "0"] = value.split(",");
  return {
    x: parseFloat(x) || 0,
    y: parseFloat(y) || 0,
    z: parseFloat(z) || 0
  };
}

function parseSuperiorAxlebarOffset(value) {
  const [frontAxleY = "0", rearAxleY = "0", middleY = "0"] = value.split(",");
  return {
    frontAxleY: parseFloat(frontAxleY) || 0,
    rearAxleY: parseFloat(rearAxleY) || 0,
    middleY: parseFloat(middleY) || 0
  };
}

function isManifestLabel(line) {
  return line === "truckModelBaseName"
    || line === "truckModelName"
    || line === "tireModelBaseName"
    || line === "tireModelName"
    || line === "axleModelName"
    || line === "shockTextureName"
    || line === "barTextureName"
    || line === "axlebarOffset"
    || line === "superiorAxlebarOffset"
    || line === "driveshaftPos"
    || line === "Instrument Cluster"
    || line === "Wave File"
    || line === "Number of Lights"
    || line.startsWith("Scrape point ")
    || /^Light \d+ /.test(line)
    || /^(.*)\.(x|y|z)$/i.test(line);
}
