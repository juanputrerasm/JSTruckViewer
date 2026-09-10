/*
  .SMF, the 4x4 Evolution static model format ("C3DModel"), read into the same model shape
  the .BIN decoder produces so the scene needs no separate SMF path.

    "C3DModel"
    fileVersion
    objectCount
    if fileVersion >= 4: lodEnabled,lodSwitchHeight

    repeat objectCount:
        groupName
        if fileVersion >= 2: visible
        objectVersion
        vertexCount,frameCount,faceCount,objectInfo
        ["v1"]                                        Evo 2 bump-material marker
        specular,specularLevel,shininess,transparent,reflective,textureName
        if v1: "bumpTextureName"
        repeat frameCount:
            repeat vertexCount: x,y,z,nx,ny,nz,u,v
        repeat faceCount: i0,i1,i2

  Written as a counted state machine rather than by sniffing where the vertex block ends,
  because a vertex line and a face line are both just comma-separated numbers - the counts
  are the only thing that says which is which.

  Verified against every model in both stock TRUCK.PODs: 246 Evo 1 files (2,004 groups,
  all .RAW textures) and 321 Evo 2 files (3,399 groups, all .TIF and all carrying the "v1"
  bump form), every one consumed exactly to its last face line.

  Fields 0-2 of the material line are lighting scalars. The stock corpus writes a small set
  of combinations - 1/0.25/32, 1/1/64, 1/1/32, 1/0/0, 1.25/0/0 - consistent with specular
  strength, specular level and a Phong exponent, but they are carried through under neutral
  names rather than being asserted.

  LOD lives in a separate file, not in a group flag: TRBLAZ.SMF is the full-detail body and
  TRBLAZ0.SMF the reduced one, whose groups are the same names with an "L" suffix. Every
  stock group is flagged visible, and no file mixes a group with its own "L" partner, so no
  group filtering is needed here - picking the right file is the whole of LOD selection.
*/

const SMF_MAGIC = "C3DModel";
const MAX_OBJECTS = 4096;
const MAX_VERTICES = 1 << 20;
const MAX_FACES = 1 << 20;

/** True when these bytes open with the C3DModel magic line. */
export function isSmfModel(bytes) {
  if (!bytes || bytes.length < SMF_MAGIC.length) return false;
  return new TextDecoder("latin1").decode(bytes.subarray(0, SMF_MAGIC.length)) === SMF_MAGIC;
}

export function decodeSmfModel(bytes, modelName) {
  const lines = new TextDecoder("latin1").decode(bytes).replace(/\r\n?/g, "\n").split("\n");
  let cursor = 0;
  const warnings = [];
  const next = () => (cursor < lines.length ? lines[cursor++].trim() : null);
  const peek = () => (cursor < lines.length ? lines[cursor].trim() : null);

  const model = {
    name: modelName,
    format: "SMF",
    smfVersion: 0,
    lodEnabled: false,
    lodSwitchHeight: 0,
    vertexCount: 0,
    polygonCount: 0,
    vertices: [],
    meshes: [],
    textureNames: [],
    warnings
  };

  if (next() !== SMF_MAGIC) throw new Error(`${modelName}: not a C3DModel`);
  const fileVersion = int(next());
  if (!(fileVersion >= 1 && fileVersion <= 4)) {
    throw new Error(`${modelName}: unsupported .SMF version ${fileVersion}`);
  }
  model.smfVersion = fileVersion;

  const objectCount = int(next());
  if (!(objectCount >= 0 && objectCount <= MAX_OBJECTS)) {
    throw new Error(`${modelName}: implausible object count ${objectCount}`);
  }

  if (fileVersion >= 4) {
    const parts = (next() ?? "").split(",");
    model.lodEnabled = (parts[0] ?? "0").trim() !== "0";
    model.lodSwitchHeight = float(parts[1]);
  }

  const textureNames = new Set();

  for (let o = 0; o < objectCount; o += 1) {
    const groupName = next();
    if (groupName === null) {
      warnings.push(`ran out of lines at group ${o + 1} of ${objectCount}`);
      break;
    }
    const visible = fileVersion >= 2 ? next() !== "0" : true;
    const objectVersion = int(next());

    const counts = (next() ?? "").split(",");
    const vertexCount = int(counts[0]);
    const frameCount = Math.max(1, int(counts[1]));
    const faceCount = int(counts[2]);
    if (!(vertexCount >= 0 && vertexCount <= MAX_VERTICES) || !(faceCount >= 0 && faceCount <= MAX_FACES)) {
      throw new Error(`${modelName}: implausible counts in group "${groupName}" (${vertexCount} verts, ${faceCount} faces)`);
    }

    // The Evo 2 bump form announces itself with a bare "v1" line before the material.
    const bumpForm = peek() === "v1";
    if (bumpForm) next();
    const material = (next() ?? "").split(",");
    const bumpTextureName = bumpForm ? (next() ?? "").replace(/"/g, "").trim() : "";

    /*
      Evo is Y-up and in feet; this viewer's model space is Z-up and also in feet, the same
      space the .BIN decoder emits and the space the TRK's own anchors are read into. So the
      mapping is a straight axis swap: model (x, y, z) = Evo (x, z, y).

      That swap flips handedness, which is exactly what the scene wants: it draws truck
      meshes with THREE.BackSide because .BIN geometry is wound inward, so leaving the SMF
      winding untouched puts these faces on the same side. Normals are negated for the same
      reason - THREE.BackSide compiles FLIP_SIDED, which negates the vertex normal, so a
      normal handed over pointing inward comes out of the shader pointing outward.
    */
    const frameVertices = [];
    for (let f = 0; f < frameCount; f += 1) {
      for (let v = 0; v < vertexCount; v += 1) {
        const line = next();
        if (line === null) throw new Error(`${modelName}: truncated vertex block in "${groupName}"`);
        // Frames after the first are read only to keep the cursor aligned with the face block.
        if (f !== 0) continue;
        const p = line.split(",");
        frameVertices.push({
          x: float(p[0]),
          y: float(p[2]),
          z: float(p[1]),
          nx: -float(p[3]),
          ny: -float(p[5]),
          nz: -float(p[4]),
          // Evo's V runs top-down and the scene uploads its textures with flipY, so V is
          // inverted here exactly as the .BIN path inverts its own.
          u: float(p[6]),
          v: 1 - float(p[7])
        });
      }
    }

    const positions = [];
    const normals = [];
    const uvs = [];
    let emitted = 0;
    for (let f = 0; f < faceCount; f += 1) {
      const line = next();
      if (line === null) throw new Error(`${modelName}: truncated face block in "${groupName}"`);
      const parts = line.split(",");
      const corners = [int(parts[0]), int(parts[1]), int(parts[2])];
      if (corners.some((index) => index < 0 || index >= frameVertices.length)) {
        warnings.push(`"${groupName}" face ${f} indexes outside its ${vertexCount} vertices`);
        continue;
      }
      for (const index of corners) {
        const vertex = frameVertices[index];
        positions.push(vertex.x, vertex.y, vertex.z);
        normals.push(vertex.nx, vertex.ny, vertex.nz);
        uvs.push(vertex.u, vertex.v);
      }
      emitted += 1;
    }

    const textureName = normalizeSmfName(material[5]);
    if (textureName) textureNames.add(textureName);
    // Kept flat across groups: the only consumer is the assembly's bounding-box helper,
    // which is shared with the .BIN path and does not care which group a vertex came from.
    for (const vertex of frameVertices) {
      model.vertices.push({ x: vertex.x, y: vertex.y, z: vertex.z });
    }
    model.vertexCount += frameVertices.length;
    model.polygonCount += emitted;
    if (!visible || emitted === 0) continue;
    model.meshes.push({
      groupName,
      textureName,
      bumpTextureName: normalizeSmfName(bumpTextureName),
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      color: 0xffffff,
      /*
        Only glass and light lenses carry the transparent flag - across both stock archives
        it never appears on a Body group - and the coverage behind it is a real 8-bit plane,
        the texture's .OPA companion or the second sample of its TIFF. So these ask the scene
        to blend rather than to alpha-test the way an MTM colour-keyed mesh does.
      */
      transparent: (material[3] ?? "0").trim() !== "0",
      blend: (material[3] ?? "0").trim() !== "0",
      reflective: (material[4] ?? "0").trim() !== "0",
      solid: false,
      material: null,
      material2: null,
      lighting: {
        specular: float(material[0]),
        specularLevel: float(material[1]),
        shininess: float(material[2])
      },
      objectVersion,
      frameCount
    });
  }

  model.textureNames = [...textureNames];
  return model;
}

function normalizeSmfName(value) {
  const trimmed = (value ?? "").replace(/"/g, "").trim().toUpperCase();
  return trimmed && trimmed !== "NULL" && trimmed !== "NULL.RAW" && trimmed !== "NULL.TIF" ? trimmed : "";
}

function int(value) {
  const parsed = Number.parseInt((value ?? "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function float(value) {
  const parsed = Number.parseFloat((value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}
