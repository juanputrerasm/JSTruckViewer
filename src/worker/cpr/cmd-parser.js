const POSITION_SCALE = 1 / 256;
const NORMAL_SCALE = 1 / 65536;
const UV_SCALE = 0xff0000;

export function decodeCprCmdModel(text, modelName) {
  const lines = String(text ?? "")
    .replace(/[\u0000\u001a]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const cursor = new LineCursor(lines, modelName);

  cursor.expect("name");
  const name = cursor.read("model name");
  cursor.expect("lowDetailName");
  const lowDetailName = cursor.read("low-detail model name");
  cursor.expect("lowDetailCenterZ");
  const lowDetailCenterZ = cursor.readNumber("low-detail center Z");
  cursor.expect("material");
  const textureName = cursor.read("material name");

  const model = {
    name: modelName,
    displayName: name,
    format: "CPR_CMD",
    lowDetailName,
    lowDetailCenterZ,
    vertexCount: 0,
    polygonCount: 0,
    vertices: [],
    textureNames: textureName ? [textureName] : [],
    meshes: [],
    parts: [],
    warnings: []
  };

  while (!cursor.done()) {
    cursor.expect("partName");
    const partName = cursor.read("part name");
    cursor.expect("vertexCount");
    const vertexCount = cursor.readCount("vertex count");
    cursor.expect("faceCount");
    const faceCount = cursor.readCount("face count");
    cursor.expect("center");
    const center = cursor.readVec3("part center");
    cursor.expect("angle");
    const angle = cursor.readVec3("part angle");
    cursor.expect("vertexList");
    const localVertices = cursor.readVec3List(vertexCount, "vertex");
    cursor.expect("normalList");
    const localNormals = cursor.readVec3List(vertexCount, "normal");
    cursor.expect("faceList");

    const vertices = localVertices.map((vertex) => ({
      x: (vertex.x + center.x) * POSITION_SCALE,
      y: (vertex.z + center.z + lowDetailCenterZ) * POSITION_SCALE,
      z: (vertex.y + center.y) * POSITION_SCALE
    }));
    const normals = localNormals.map((normal) => normalize({
      x: normal.x * NORMAL_SCALE,
      y: normal.z * NORMAL_SCALE,
      z: normal.y * NORMAL_SCALE
    }));
    const positions = [];
    const outputNormals = [];
    const uvs = [];

    for (let face = 0; face < faceCount; face += 1) {
      const [type, cornerCount] = cursor.readTuple(2, `face ${face + 1} header`);
      cursor.readTuple(4, `face ${face + 1} plane`);
      if (cornerCount < 3 || cornerCount > 256) {
        throw cursor.error(`Invalid corner count ${cornerCount} in part ${partName}`);
      }
      const corners = [];
      for (let corner = 0; corner < cornerCount; corner += 1) {
        const [vertexIndex, u, v] = cursor.readTuple(3, `face ${face + 1} corner`);
        if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= vertexCount) {
          throw cursor.error(`Invalid vertex index ${vertexIndex} in part ${partName}`);
        }
        corners.push({ vertexIndex, u, v });
      }
      for (const triangle of chooseTriangles(vertices, corners)) {
        for (const cornerIndex of triangle) {
          const corner = corners[cornerIndex];
          const vertex = vertices[corner.vertexIndex];
          const normal = normals[corner.vertexIndex];
          positions.push(vertex.x, vertex.y, vertex.z);
          outputNormals.push(normal.x, normal.y, normal.z);
          uvs.push(corner.u / UV_SCALE, 1 - corner.v / UV_SCALE);
        }
      }
      if (type !== 0x29 && !model.warnings.includes(`Unsupported CMD face type ${type}.`)) {
        model.warnings.push(`Unsupported CMD face type ${type}.`);
      }
    }

    if (angle.x || angle.y || angle.z) {
      model.warnings.push(`Part ${partName} has a non-zero angle; its rotation convention is not yet known.`);
    }
    model.vertexCount += vertexCount;
    model.polygonCount += faceCount;
    model.vertices.push(...vertices);
    model.parts.push({ name: partName, center, angle, vertexCount, faceCount });
    model.meshes.push({
      name: partName,
      textureName,
      positions: new Float32Array(positions),
      normals: new Float32Array(outputNormals),
      uvs: new Float32Array(uvs),
      color: 0x9b9b9b,
      transparent: false,
      solid: false
    });
  }

  classifyWingPackages(model);
  return model;
}

// CPR stores both its large road/street-course wings and its lower speedway/oval wings in
// the same CMD. The game selects one package from the race setup; drawing both produces the
// coincident spoilers and depth flicker seen when a CMD is treated as an ordinary part list.
// A standalone viewer has no track/setup context, so tag both packages and let the UI select
// one. Only classify an alternate when its unsuffixed counterpart exists, preserving custom
// CMDs that contain only the numbered name.
function classifyWingPackages(model) {
  const partNames = new Set(model.parts.map((part) => part.name));
  const pairs = [
    ["LFWING", "LFWING1"],
    ["RFWING", "RFWING1"],
    ["RWING", "RWING1"]
  ].filter(([primary, alternate]) => partNames.has(primary) && partNames.has(alternate));
  if (!pairs.length) return;

  const roadCourseParts = new Set(pairs.map(([primary]) => primary));
  const speedwayParts = new Set(pairs.map(([, alternate]) => alternate));
  if (partNames.has("SPDFIN")) speedwayParts.add("SPDFIN");

  model.wingConfiguration = "road-course";
  model.wingPackages = ["road-course", "speedway"];
  model.alternateWingParts = [...speedwayParts];
  for (const mesh of model.meshes) {
    if (roadCourseParts.has(mesh.name)) mesh.wingPackage = "road-course";
    if (speedwayParts.has(mesh.name)) mesh.wingPackage = "speedway";
  }
  for (const part of model.parts) {
    if (roadCourseParts.has(part.name)) part.wingPackage = "road-course";
    if (speedwayParts.has(part.name)) part.wingPackage = "speedway";
  }
}

function chooseTriangles(vertices, corners) {
  if (corners.length === 3) return [[0, 1, 2]];
  if (corners.length !== 4) {
    return Array.from({ length: corners.length - 2 }, (_, i) => [0, i + 1, i + 2]);
  }
  const optionA = [[0, 1, 2], [0, 2, 3]];
  const optionB = [[0, 1, 3], [1, 2, 3]];
  return scoreSplit(vertices, corners, optionA) >= scoreSplit(vertices, corners, optionB) ? optionA : optionB;
}

function scoreSplit(vertices, corners, triangles) {
  const faceNormals = [];
  let area = 0;
  for (const triangle of triangles) {
    const a = vertices[corners[triangle[0]].vertexIndex];
    const b = vertices[corners[triangle[1]].vertexIndex];
    const c = vertices[corners[triangle[2]].vertexIndex];
    const cross = crossProduct(a, b, c);
    const length = Math.hypot(cross.x, cross.y, cross.z);
    if (!Number.isFinite(length) || length < 1e-8) return -Infinity;
    faceNormals.push({ x: cross.x / length, y: cross.y / length, z: cross.z / length });
    area += length;
  }
  const dot = faceNormals[0].x * faceNormals[1].x
    + faceNormals[0].y * faceNormals[1].y
    + faceNormals[0].z * faceNormals[1].z;
  return dot * 100000 + area;
}

function crossProduct(a, b, c) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const acz = c.z - a.z;
  return {
    x: aby * acz - abz * acy,
    y: abz * acx - abx * acz,
    z: abx * acy - aby * acx
  };
}

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

class LineCursor {
  constructor(lines, modelName) {
    this.lines = lines;
    this.modelName = modelName;
    this.index = 0;
  }

  done() {
    return this.index >= this.lines.length;
  }

  read(label) {
    if (this.done()) throw this.error(`Missing ${label}`);
    return this.lines[this.index++];
  }

  expect(label) {
    const actual = this.read(label);
    if (actual !== label) throw this.error(`Expected ${label}, found ${actual}`);
  }

  readNumber(label) {
    const value = Number(this.read(label));
    if (!Number.isFinite(value)) throw this.error(`Invalid ${label}`);
    return value;
  }

  readCount(label) {
    const value = this.readNumber(label);
    if (!Number.isInteger(value) || value < 0 || value > 200000) throw this.error(`Invalid ${label}: ${value}`);
    return value;
  }

  readTuple(length, label) {
    const values = this.read(label).split(",").map(Number);
    if (values.length !== length || values.some((value) => !Number.isFinite(value))) {
      throw this.error(`Invalid ${label}`);
    }
    return values;
  }

  readVec3(label) {
    const [x, y, z] = this.readTuple(3, label);
    return { x, y, z };
  }

  readVec3List(count, label) {
    return Array.from({ length: count }, (_, index) => this.readVec3(`${label} ${index + 1}`));
  }

  error(message) {
    return new Error(`${this.modelName}: ${message} near line ${this.index + 1}`);
  }
}
