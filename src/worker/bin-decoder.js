import { BinaryReader } from "./binary-reader.js";

const SIGNATURE_LWO = 0x4d524f46;
const SIGNATURE_ANIMATED_BIN = 0x00000020;
const BLOCK_MRGL_MAGNIFY = 0x00000014;
const MAX_CORNERS_PER_FACE = 256;
const UV_SCALE = 0xff0000;

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
    meshes: []
  };
  if (!bytes?.length || bytes.length < 4) {
    return model;
  }

  const reader = new BinaryReader(bytes);
  const firstType = reader.readInt32();
  if (firstType === SIGNATURE_LWO) {
    model.format = "LWO";
    return model;
  }
  if (firstType === BLOCK_MRGL_MAGNIFY) {
    model.format = "BIN";
    if (reader.remaining() < 4) {
      return model;
    }
    const power = reader.readInt32();
    if (power > 0) {
      model.magnifyPower = power;
    }
    decodeBinPayload(reader, model, 8, true);
    return buildMeshes(model);
  }
  if (firstType !== SIGNATURE_ANIMATED_BIN) {
    model.format = `0x${(firstType >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
    return model;
  }
  model.format = "ANIMATED_BIN";
  decodeBinPayload(reader, model, 12, false);
  return buildMeshes(model);
}

function decodeBinPayload(reader, model, headerBytesBeforeVertexCount, applyMagnifyAtDecode) {
  reader.skip(headerBytesBeforeVertexCount);
  const vertexCount = reader.readInt32();
  if (vertexCount < 0 || vertexCount > 200000) {
    return;
  }
  const rawVertices = [];
  let rawBaseZ = 0;
  let rawMinX = Number.MAX_SAFE_INTEGER;
  let rawMaxX = Number.MIN_SAFE_INTEGER;
  let rawMinY = Number.MAX_SAFE_INTEGER;
  let rawMaxY = Number.MIN_SAFE_INTEGER;
  let rawMinZ = Number.MAX_SAFE_INTEGER;
  let rawMaxZ = Number.MIN_SAFE_INTEGER;
  for (let i = 0; i < vertexCount; i += 1) {
    const x = reader.readInt32() >> 1;
    const z = reader.readInt32() >> 1;
    const y = reader.readInt32() >> 1;
    rawVertices.push({ x, y, z });
    rawMinX = Math.min(rawMinX, x);
    rawMaxX = Math.max(rawMaxX, x);
    rawMinY = Math.min(rawMinY, y);
    rawMaxY = Math.max(rawMaxY, y);
    rawMinZ = Math.min(rawMinZ, z);
    rawMaxZ = Math.max(rawMaxZ, z);
    if (z < rawBaseZ) {
      rawBaseZ = z;
    }
  }
  const rawBaseZWithOffset = rawBaseZ - 31;
  model.rawVertexBounds = {
    vertexCount: rawVertices.length,
    baseZ: rawBaseZWithOffset,
    minX: rawMinX,
    maxX: rawMaxX,
    minY: rawMinY,
    maxY: rawMaxY,
    minZ: rawMinZ,
    maxZ: rawMaxZ
  };

  const scale = applyMagnifyAtDecode ? (512 / model.magnifyPower) : 1.0;
  model.vertices = rawVertices.map((vertex) => ({
    x: vertex.x * scale,
    y: vertex.y * scale,
    z: vertex.z * scale
  }));
  model.baseZ = rawBaseZWithOffset * scale;

  const polygons = [];
  const textureNames = new Set();
  let currentTexture = "";
  let meshVerts = model.vertices.length;

  blocks:
  while (reader.remaining() >= 4) {
    const token = reader.readInt32();
    switch (token) {
      case 0x00000000:
        break blocks;
      case 0x00000002: {
        if (reader.remaining() < 8) break blocks;
        reader.skip(4);
        const nv = reader.readInt32();
        const strip = nv * 12;
        const tail80 = 20 * 4;
        if (nv >= 0 && nv <= MAX_CORNERS_PER_FACE && reader.remaining() >= strip + tail80) {
          reader.skip(strip);
          reader.skip(tail80);
        } else if (reader.remaining() >= 34 * 4) {
          reader.skip(34 * 4);
        } else {
          break blocks;
        }
        break;
      }
      case 0x00000003: {
        if (reader.remaining() < 8) break blocks;
        reader.skip(8);
        if (meshVerts < 1 || reader.remaining() < meshVerts * 12) break blocks;
        reader.skip(meshVerts * 12);
        break;
      }
      case 0x00000004: {
        if (reader.remaining() < 8) break blocks;
        reader.skip(4);
        const n = reader.readInt32();
        const need = n * 8;
        if (n < 0 || n > 4096 || reader.remaining() < need) break blocks;
        reader.skip(need);
        break;
      }
      case 0x0000000d:
        if (reader.remaining() < 20) break blocks;
        reader.skip(4);
        currentTexture = upper(reader.readFixedAscii(16));
        break;
      case 0x0000001d: {
        if (reader.remaining() < 24) break blocks;
        reader.skip(4);
        const num = reader.readInt32();
        reader.skip(16);
        if (num < 0 || num > 1024) break blocks;
        const tail32 = num * 32;
        const tail8 = num * 8;
        if (reader.remaining() >= tail32) {
          for (let i = 0; i < num; i += 1) {
            const frame = upper(reader.readFixedAscii(32));
            if (i === 0) {
              currentTexture = frame;
            }
          }
        } else if (reader.remaining() >= tail8) {
          reader.skip(tail8);
        } else {
          break blocks;
        }
        break;
      }
      case 0x0000000a:
        if (reader.remaining() < 4) break blocks;
        reader.skip(4);
        currentTexture = "";
        break;
      case 0x0000000c:
        if (reader.remaining() < 24) break blocks;
        reader.skip(24);
        break;
      case 0x00000012:
        if (reader.remaining() < 4) break blocks;
        reader.skip(4);
        break;
      case BLOCK_MRGL_MAGNIFY:
        if (reader.remaining() < 4) break blocks;
        model.magnifyPower = reader.readInt32();
        break;
      case 0x00000016:
        if (reader.remaining() < 12) break blocks;
        reader.skip(12);
        break;
      case 0x00000017:
        if (reader.remaining() < 8) break blocks;
        reader.skip(8);
        break;
      case 0x0000001f: {
        if (reader.remaining() < 8) break blocks;
        reader.skip(4);
        const n = reader.readInt32();
        const need = n * 4;
        if (n < 0 || n > 200000 || reader.remaining() < need) break blocks;
        reader.skip(need);
        break;
      }
      case 0x00000011:
      case 0x00000018:
      case 0x00000022:
      case 0x00000029:
      case 0x00000033:
      case 0x00000034:
      case 0x0000000e: {
        const polygon = readMappedFace(reader, token, currentTexture, meshVerts);
        if (polygon) {
          polygons.push(polygon);
          if (polygon.textureName) textureNames.add(polygon.textureName);
        }
        break;
      }
      case 0x00000005:
      case 0x00000019:
      case 0x00000006:
      case 0x0000000f: {
        const polygon = readUnmappedFace(reader, token, currentTexture, meshVerts);
        if (polygon) {
          polygons.push(polygon);
          if (polygon.textureName) textureNames.add(polygon.textureName);
        }
        break;
      }
      default:
        break blocks;
    }
  }

  model.polygons = polygons;
  model.textureNames = [...textureNames];
  model.vertexCount = model.vertices.length;
  model.polygonCount = model.polygons.length;
}

function buildMeshes(model) {
  const grouped = new Map();
  for (const polygon of model.polygons ?? []) {
    const key = polygon.textureName || "__flat__";
    if (!grouped.has(key)) {
      grouped.set(key, { positions: [], normals: [], uvs: [], textureName: polygon.textureName || "" });
    }
    const bucket = grouped.get(key);
    triangulatePolygon(model.vertices, polygon, bucket);
  }
  model.meshes = [...grouped.values()].map((bucket) => ({
    textureName: bucket.textureName,
    positions: new Float32Array(bucket.positions),
    normals: new Float32Array(bucket.normals),
    uvs: new Float32Array(bucket.uvs),
    color: representativeColor(bucket.textureName)
  }));
  return model;
}

function triangulatePolygon(vertices, polygon, bucket) {
  const { vertexIndices, textureU, textureV } = polygon;
  if (!vertexIndices || vertexIndices.length < 3) {
    return;
  }
  for (let i = 1; i < vertexIndices.length - 1; i += 1) {
    const indices = [0, i, i + 1];
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

function readMappedFace(reader, type, textureName, meshVertexCount) {
  if (meshVertexCount < 1) return null;
  const n = reader.readInt32();
  const need = 16 + n * 12;
  if (n < 3 || n > MAX_CORNERS_PER_FACE || reader.remaining() < need) return null;
  reader.skip(16);
  const vertexIndices = [];
  const textureU = [];
  const textureV = [];
  for (let i = 0; i < n; i += 1) {
    vertexIndices.push(reader.readInt32());
    textureU.push(reader.readInt32());
    textureV.push(reader.readInt32());
  }
  if (!indicesValid(vertexIndices, meshVertexCount)) {
    if (!indicesValidOneBased(vertexIndices, meshVertexCount)) {
      return null;
    }
    for (let i = 0; i < vertexIndices.length; i += 1) {
      vertexIndices[i] -= 1;
    }
  }
  return { type, textureName, vertexIndices, textureU, textureV };
}

function readUnmappedFace(reader, type, textureName, meshVertexCount) {
  if (meshVertexCount < 1) return null;
  const n = reader.readInt32();
  const need = 16 + n * 4;
  if (n < 3 || n > MAX_CORNERS_PER_FACE || reader.remaining() < need) return null;
  reader.skip(16);
  const vertexIndices = [];
  for (let i = 0; i < n; i += 1) {
    vertexIndices.push(reader.readInt32());
  }
  if (!indicesValid(vertexIndices, meshVertexCount)) {
    if (!indicesValidOneBased(vertexIndices, meshVertexCount)) {
      return null;
    }
    for (let i = 0; i < vertexIndices.length; i += 1) {
      vertexIndices[i] -= 1;
    }
  }
  return { type, textureName, vertexIndices, textureU: new Array(n).fill(0), textureV: new Array(n).fill(0) };
}

function indicesValid(indices, meshVertexCount) {
  return indices.every((index) => index >= 0 && index < meshVertexCount);
}

function indicesValidOneBased(indices, meshVertexCount) {
  return indices.every((index) => index - 1 >= 0 && index - 1 < meshVertexCount);
}

function upper(value) {
  return (value ?? "").trim().toUpperCase();
}

function representativeColor(textureName) {
  const seed = [...(textureName || "__flat__")].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const hue = seed % 360;
  return hslToHex(hue / 360, 0.22, 0.64);
}

function hslToHex(h, s, l) {
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r;
  let g;
  let b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}
