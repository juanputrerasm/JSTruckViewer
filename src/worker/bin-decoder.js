/*
  .BIN models for the truck viewer.

  Parsing is OpenPhotex's (src/vendor/openphotex): parseBin walks the MRGL record stream the way
  the engine strides it and returns the model as the file states it, raw vertex words and faces
  with the texture, colour and material in force when each was read. This file keeps the
  viewer's own half: scaling to its model units, batching faces into meshes, triangulating and
  shading them.

  Truck model space is (raw >> 1) * 512 / magnify: feet, Z up, the space the TRK anchors are
  read into. A face's repeated corners and a model's repeated faces are dropped here, as they
  always have been, before triangulation and normal smoothing.
*/
import { MRGL, MRGLMAT, MRGLMAT2, parseBin } from "../vendor/openphotex/index.js";

const UV_SCALE = 0xff0000;
const TRANSPARENT_FACE_TYPES = new Set([0x11, 0x33]);
const MRGLMAT_BLEND = MRGLMAT.BLEND;
const MRGLMAT_ALPHATEST = MRGLMAT.ALPHATEST;
const MRGLMAT_TEXSOLID = MRGLMAT.TEXSOLID;

/*
  An ANIMATED_BIN names its frame models and carries no geometry (all 53 stock ones): after the
  frame count and magnify word come a zero vertex count and MRGL_EOL. This viewer has always run
  that empty payload through the geometry path too, so the model keeps the same empty fields.
*/
const EMPTY_PAYLOAD = { vertexListValid: true, vertices: new Int32Array(0), faces: [], materials: [], materials2: [], magnifyRecords: [], warnings: [], stopReason: null };

export function decodeBinModel(bytes, modelName) {
  const model = {
    name: modelName,
    format: "UNKNOWN",
    magnifyPower: 65536,
    baseZ: 0,
    vertexCount: 0,
    polygonCount: 0,
    rawVertexBounds: null,
    textureNames: [],
    meshes: [],
    warnings: []
  };
  if (!bytes?.length || bytes.length < 4) {
    return model;
  }
  const bin = parseBin(bytes);
  if (bin.kind === "lwo") {
    model.format = "LWO";
    return model;
  }
  if (bin.kind === "mrgl") {
    model.format = "BIN";
    if (bin.magnify === null) {
      return model;
    }
    if (bin.magnify > 0) {
      model.magnifyPower = bin.magnify;
    }
    applyPayload(bin, model, 512 / model.magnifyPower);
    return buildMeshes(model);
  }
  if (bin.kind !== "animated") {
    model.format = `0x${(bin.signature >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
    return model;
  }
  model.format = "ANIMATED_BIN";
  applyPayload(EMPTY_PAYLOAD, model, 1.0);
  return buildMeshes(model);
}

function applyPayload(bin, model, scale) {
  if (!bin.vertexListValid) {
    return;
  }
  const words = bin.vertices;
  const rawVertices = [];
  let rawBaseZ = 0;
  let rawMinX = Number.MAX_SAFE_INTEGER, rawMaxX = Number.MIN_SAFE_INTEGER;
  let rawMinY = Number.MAX_SAFE_INTEGER, rawMaxY = Number.MIN_SAFE_INTEGER;
  let rawMinZ = Number.MAX_SAFE_INTEGER, rawMaxZ = Number.MIN_SAFE_INTEGER;
  for (let i = 0; i < words.length; i += 3) {
    // The engine drops each word's low bit; the words are (x, z, y) with z up.
    const x = words[i] >> 1;
    const z = words[i + 1] >> 1;
    const y = words[i + 2] >> 1;
    rawVertices.push({ x, y, z });
    if (x < rawMinX) rawMinX = x; if (x > rawMaxX) rawMaxX = x;
    if (y < rawMinY) rawMinY = y; if (y > rawMaxY) rawMaxY = y;
    if (z < rawMinZ) rawMinZ = z; if (z > rawMaxZ) rawMaxZ = z;
    if (z < rawBaseZ) rawBaseZ = z;
  }
  // The engine's base height: the lowest z, never above 0, less 31.
  const rawBaseZWithOffset = rawBaseZ - 31;
  model.rawVertexBounds = { vertexCount: rawVertices.length, baseZ: rawBaseZWithOffset, minX: rawMinX, maxX: rawMaxX, minY: rawMinY, maxY: rawMaxY, minZ: rawMinZ, maxZ: rawMaxZ };
  model.vertices = rawVertices.map((vertex) => ({
    x: vertex.x * scale,
    y: vertex.y * scale,
    z: vertex.z * scale
  }));
  model.baseZ = rawBaseZWithOffset * scale;
  const materials = bin.materials.map((material) => ({ ...material, tint: [...material.tint] }));
  // normalStrength is only meaningful when the record says it carries a normal map.
  const materials2 = bin.materials2.map(({ flags2, normalStrength, reserved }) => ({
    flags2, normalStrength: flags2 & MRGLMAT2.NORMALMAP ? normalStrength : 1, reserved: [...reserved],
  }));
  const polygons = [];
  const textureNames = new Set();
  for (const face of bin.faces) {
    const polygon = truckPolygon(face, materials, materials2);
    if (polygon) {
      polygons.push(polygon);
      if (polygon.textureName) textureNames.add(polygon.textureName);
    } else if (face.opcode === MRGL.MATFACET) {
      model.warnings.push(`Invalid MRGL_MATFACET at byte ${face.offset + 24 + face.vertexIndices.length * 12}`);
    }
  }
  model.warnings.push(...bin.warnings);
  for (const material2 of bin.materials2) {
    if (material2.reserved.some((value) => value !== 0)) model.warnings.push("MRGL_MATERIAL2 has non-zero reserved fields");
  }
  if (bin.stopReason && /^unknown record type/.test(bin.stopReason)) {
    model.warnings.push(`Unsupported BIN opcode: ${bin.stopReason}; model truncated`);
  }
  if (bin.magnifyRecords.length) model.magnifyPower = bin.magnifyRecords[bin.magnifyRecords.length - 1];

  model.polygons = dedupePolygons(polygons);
  model.textureNames = [...textureNames];
  model.vertexCount = model.vertices.length;
  model.polygonCount = model.polygons.length;
}

/* The viewer's polygon: repeated corners removed, and the legacy face-type flags spelled out. */
function truckPolygon(face, materials, materials2) {
  const cleaned = dedupeFaceCorners(face.vertexIndices, face.u, face.v);
  if (cleaned.vertexIndices.length < 3) return null;
  const polygon = {
    type: face.opcode,
    textureName: upper(face.textureName),
    vertexIndices: cleaned.vertexIndices,
    textureU: cleaned.textureU,
    textureV: cleaned.textureV,
    solid: face.opcode === 0x00000019,
    solidColor: face.solidColor,
    transparent: face.opcode === 0x00000011 || face.opcode === 0x00000033,
    storedNormalX: face.storedNormal[0],
    storedNormalY: face.storedNormal[1],
    storedNormalZ: face.storedNormal[2],
    faceMagic: face.magic
  };
  if (face.mapped) {
    polygon.material = face.material === null ? null : materials[face.material];
    polygon.material2 = face.material2 === null ? null : materials2[face.material2];
  }
  return polygon;
}

function buildMeshes(model) {
  const grouped = new Map();
  for (const polygon of model.polygons ?? []) {
    const flags = polygon.material?.flags ?? 0;
    // Some MTM2 models fake tinted glass by mapping every corner of a transparent face to
    // one texel junction. Direct3D 5 bilinearly mixed the black colour key with the nearby
    // opaque texels, turning their relative coverage into fractional alpha.
    const legacyFilterBlend = !polygon.material && polygon.transparent && hasCollapsedUvs(polygon);
    const materialTransparent = polygon.material
      ? !!(flags & (MRGLMAT_BLEND | MRGLMAT_ALPHATEST | MRGLMAT_TEXSOLID))
      : polygon.transparent;
    const key = [
      polygon.textureName || "__flat__",
      materialTransparent ? "cutout" : "opaque",
      polygon.solid ? `solid:${polygon.solidColor >>> 0}` : "textured",
      polygon.material ? `material:${polygon.material.id}` : "legacy",
      legacyFilterBlend ? "filtered-blend" : "cutout",
      polygon.material2?.normalStrength ?? 1
    ].join("|");
    if (!grouped.has(key)) {
      grouped.set(key, {
        positions: [],
        normals: [],
        uvs: [],
        textureName: polygon.textureName || "",
        transparent: !!materialTransparent,
        solid: !!polygon.solid,
        solidColor: polygon.solidColor ?? 0,
        material: polygon.material ?? null,
        material2: polygon.material2 ?? null,
        legacyFilterBlend
      });
    }
    const bucket = grouped.get(key);
    triangulatePolygon(model.vertices, polygon, bucket);
  }
  smoothBucketNormals([...grouped.values()]);
  model.meshes = [...grouped.values()].map((bucket) => ({
    textureName: bucket.textureName,
    positions: new Float32Array(bucket.positions),
    normals: new Float32Array(bucket.normals),
    uvs: new Float32Array(bucket.uvs),
    color: bucket.solid ? (bucket.solidColor >>> 0) : representativeColor(bucket.textureName),
    transparent: bucket.transparent,
    solid: bucket.solid,
    material: bucket.material,
    material2: bucket.material2,
    legacyFilterBlend: bucket.legacyFilterBlend
  }));
  return model;
}

function hasCollapsedUvs(polygon) {
  const firstU = polygon.textureU?.[0];
  const firstV = polygon.textureV?.[0];
  return firstU !== undefined && firstV !== undefined
    && polygon.textureU.every((value) => value === firstU)
    && polygon.textureV.every((value) => value === firstV);
}

function triangulatePolygon(vertices, polygon, bucket) {
  const { vertexIndices, textureU, textureV } = polygon;
  if (!vertexIndices || vertexIndices.length < 3) {
    return;
  }
  const triangleSets = chooseTriangles(vertices, vertexIndices);
  for (const indices of triangleSets) {
    const p0 = vertices[vertexIndices[indices[0]]];
    const p1 = vertices[vertexIndices[indices[1]]];
    const p2 = vertices[vertexIndices[indices[2]]];
    if (!p0 || !p1 || !p2) {
      continue;
    }
    const normal = computeNormal(p0, p1, p2);
    for (const idx of indices) {
      const vertex = vertices[vertexIndices[idx]];
      bucket.positions.push(vertex.x, vertex.y, vertex.z);
      bucket.normals.push(normal.x, normal.y, normal.z);
      bucket.uvs.push((textureU[idx] ?? 0) / UV_SCALE, 1 - (textureV[idx] ?? 0) / UV_SCALE);
    }
  }
}

/*
  BIN stores no vertex normals, only one per face, so lighting the triangles with their face
  normals shades every polygon flat and the low-poly bodies come out faceted.

  Each corner instead gets the area-weighted average of the faces that meet at its position,
  across every bucket of the model so a texture seam does not show as a shading seam. Faces
  bent further than the crease angle from the corner's own face are left out, which keeps the
  hard edges a truck actually has - bumper corners, wheel-well lips, the cab against the bed.
  The same test drops a two-sided face's back copy, whose normal points the other way.
*/
const SMOOTHING_CREASE_DEGREES = 60;

function smoothBucketNormals(buckets) {
  const cosCrease = Math.cos((SMOOTHING_CREASE_DEGREES * Math.PI) / 180);
  const facesAtPosition = new Map();
  const faceNormals = buckets.map((bucket) => {
    const positions = bucket.positions;
    const normals = [];
    for (let i = 0; i + 8 < positions.length; i += 9) {
      const normal = weightedFaceNormal(positions, i);
      normals.push(normal);
      for (let corner = 0; corner < 3; corner += 1) {
        const key = positionKey(positions, i + corner * 3);
        let faces = facesAtPosition.get(key);
        if (!faces) facesAtPosition.set(key, (faces = []));
        faces.push(normal);
      }
    }
    return normals;
  });

  buckets.forEach((bucket, bucketIndex) => {
    faceNormals[bucketIndex].forEach((own, face) => {
      if (!own.length) return;
      for (let corner = 0; corner < 3; corner += 1) {
        const offset = face * 9 + corner * 3;
        let x = 0;
        let y = 0;
        let z = 0;
        for (const other of facesAtPosition.get(positionKey(bucket.positions, offset))) {
          if (!other.length) continue;
          const cos = (own.x * other.x + own.y * other.y + own.z * other.z) / (own.length * other.length);
          if (cos >= cosCrease) {
            x += other.x;
            y += other.y;
            z += other.z;
          }
        }
        const length = Math.hypot(x, y, z);
        if (length > 0) {
          bucket.normals[offset] = x / length;
          bucket.normals[offset + 1] = y / length;
          bucket.normals[offset + 2] = z / length;
        }
      }
    });
  });
}

// The unnormalised cross product: its length is twice the triangle's area, which is the weight.
function weightedFaceNormal(positions, i) {
  const abx = positions[i + 3] - positions[i];
  const aby = positions[i + 4] - positions[i + 1];
  const abz = positions[i + 5] - positions[i + 2];
  const acx = positions[i + 6] - positions[i];
  const acy = positions[i + 7] - positions[i + 1];
  const acz = positions[i + 8] - positions[i + 2];
  const x = aby * acz - abz * acy;
  const y = abz * acx - abx * acz;
  const z = abx * acy - aby * acx;
  return { x, y, z, length: Math.hypot(x, y, z) };
}

function positionKey(positions, i) {
  return `${Math.round(positions[i] * 1000)},${Math.round(positions[i + 1] * 1000)},${Math.round(positions[i + 2] * 1000)}`;
}

function chooseTriangles(vertices, vertexIndices) {
  if (vertexIndices.length === 3) {
    return [[0, 1, 2]];
  }
  if (vertexIndices.length === 4) {
    const optionA = [[0, 1, 2], [0, 2, 3]];
    const optionB = [[0, 1, 3], [1, 2, 3]];
    return scoreTriangleSplit(vertices, vertexIndices, optionA) >= scoreTriangleSplit(vertices, vertexIndices, optionB)
      ? optionA
      : optionB;
  }
  const fan = [];
  for (let i = 1; i < vertexIndices.length - 1; i += 1) {
    fan.push([0, i, i + 1]);
  }
  return fan;
}

function scoreTriangleSplit(vertices, vertexIndices, triangles) {
  const normals = [];
  let areaScore = 0;
  for (const tri of triangles) {
    const a = vertices[vertexIndices[tri[0]]];
    const b = vertices[vertexIndices[tri[1]]];
    const c = vertices[vertexIndices[tri[2]]];
    if (!a || !b || !c) return -Infinity;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const acx = c.x - a.x;
    const acy = c.y - a.y;
    const acz = c.z - a.z;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const len = Math.hypot(nx, ny, nz);
    if (!Number.isFinite(len) || len < 1e-6) return -Infinity;
    normals.push([nx / len, ny / len, nz / len]);
    areaScore += len;
  }
  const dot = normals.length === 2
    ? (normals[0][0] * normals[1][0] + normals[0][1] * normals[1][1] + normals[0][2] * normals[1][2])
    : 1;
  return dot * 100000 + areaScore;
}

function computeNormal(a, b, c) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const acz = c.z - a.z;
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  const length = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / length, y: ny / length, z: nz / length };
}

function dedupeFaceCorners(vertexIndices, textureU, textureV) {
  const nextVertexIndices = [];
  const nextTextureU = [];
  const nextTextureV = [];
  for (let i = 0; i < vertexIndices.length; i += 1) {
    if (nextVertexIndices.includes(vertexIndices[i])) {
      continue;
    }
    nextVertexIndices.push(vertexIndices[i]);
    nextTextureU.push(textureU[i] ?? 0);
    nextTextureV.push(textureV[i] ?? 0);
  }
  return { vertexIndices: nextVertexIndices, textureU: nextTextureU, textureV: nextTextureV };
}

function dedupePolygons(polygons) {
  const seen = new Set();
  const output = [];
  for (const polygon of polygons ?? []) {
    const key = polygonSignature(polygon);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(polygon);
  }
  return output;
}

function polygonSignature(polygon) {
  const corners = polygon.vertexIndices.map((vertexIndex, i) => ({
    vertexIndex,
    u: polygon.textureU[i] ?? 0,
    v: polygon.textureV[i] ?? 0
  }));
  corners.sort((a, b) => (
    a.vertexIndex - b.vertexIndex ||
    a.u - b.u ||
    a.v - b.v
  ));
  return JSON.stringify({
    type: polygon.type ?? 0,
    textureName: polygon.textureName ?? "",
    solid: !!polygon.solid,
    solidColor: polygon.solidColor ?? 0,
    transparent: !!polygon.transparent,
    materialId: polygon.material?.id ?? null,
    material2Flags: polygon.material2?.flags2 ?? null,
    normalStrength: polygon.material2?.normalStrength ?? null,
    corners
  });
}

function upper(value) {
  return (value ?? "").trim().toUpperCase();
}

function representativeColor(textureName) {
  void textureName;
  return 0x8f8f8f;
}
