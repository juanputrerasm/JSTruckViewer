/*
  CART Precision Racing .CMD high-detail car models, for the truck viewer.

  Parsing is OpenPhotex's (parseCprCmd returns the file's own fixed-point numbers; see its
  docs/TRUCKS.md). This adapter builds the viewer's model: scaled to feet, in the .BIN
  decoder's X lateral, Y forward, Z up convention (CMD itself is X lateral, Y up, Z forward),
  normals normalized, V inverted to cancel the texture upload's flipY, faces triangulated with
  cmdFaceTriangles, and the road-course and speedway wing packages tagged so the UI can show one.
*/
import {
  CMD_NORMAL_SCALE, CMD_POSITION_SCALE, CMD_UV_SCALE, cmdFaceTriangles, cmdWingPackages, parseCprCmd,
} from "../../vendor/openphotex/index.js";

/** Decode a CART Precision Racing high-detail .CMD vehicle model. */
export function decodeCprCmdModel(text, modelName) {
  const cmd = parseCprCmd(text, modelName);
  const { lowDetailCenterZ, textureName } = cmd;
  const model = {
    name: modelName,
    displayName: cmd.displayName,
    format: "CPR_CMD",
    lowDetailName: cmd.lowDetailName,
    lowDetailCenterZ,
    vertexCount: 0,
    polygonCount: 0,
    vertices: [],
    textureNames: textureName ? [textureName] : [],
    meshes: [],
    parts: [],
    warnings: cmd.warnings,
  };

  for (const part of cmd.parts) {
    const { center } = part;
    const vertices = [];
    const normals = [];
    for (let i = 0; i < part.vertexCount; i++) {
      const [x, y, z] = part.vertices.subarray(i * 3, i * 3 + 3);
      vertices.push({
        x: (x + center.x) * CMD_POSITION_SCALE,
        y: (z + center.z + lowDetailCenterZ) * CMD_POSITION_SCALE,
        z: (y + center.y) * CMD_POSITION_SCALE,
      });
      const [nx, ny, nz] = part.normals.subarray(i * 3, i * 3 + 3);
      normals.push(normalize({ x: nx * CMD_NORMAL_SCALE, y: nz * CMD_NORMAL_SCALE, z: ny * CMD_NORMAL_SCALE }));
    }
    const positions = [];
    const outputNormals = [];
    const uvs = [];
    for (const face of part.faces) {
      const points = face.corners.map((corner) => vertices[corner.vertexIndex]);
      for (const triangle of cmdFaceTriangles(points)) {
        for (const cornerIndex of triangle) {
          const corner = face.corners[cornerIndex];
          const vertex = vertices[corner.vertexIndex];
          const normal = normals[corner.vertexIndex];
          positions.push(vertex.x, vertex.y, vertex.z);
          outputNormals.push(normal.x, normal.y, normal.z);
          uvs.push(corner.u / CMD_UV_SCALE, 1 - corner.v / CMD_UV_SCALE);
        }
      }
    }
    model.vertexCount += part.vertexCount;
    model.polygonCount += part.faceCount;
    model.vertices.push(...vertices);
    model.parts.push({ name: part.name, center: part.center, angle: part.angle, vertexCount: part.vertexCount, faceCount: part.faceCount });
    model.meshes.push({
      name: part.name,
      textureName,
      positions: new Float32Array(positions),
      normals: new Float32Array(outputNormals),
      uvs: new Float32Array(uvs),
      color: 0x9b9b9b,
      transparent: false,
      solid: false,
    });
  }

  // A standalone viewer has no race setup to pick an aero package from, so both are tagged
  // and the road-course one is shown first.
  const packages = cmdWingPackages(model.parts.map((part) => part.name));
  if (packages) {
    const roadCourse = new Set(packages.roadCourse);
    const speedway = new Set(packages.speedway);
    model.wingConfiguration = "road-course";
    model.wingPackages = ["road-course", "speedway"];
    model.alternateWingParts = [...speedway];
    for (const item of [...model.meshes, ...model.parts]) {
      if (roadCourse.has(item.name)) item.wingPackage = "road-course";
      if (speedway.has(item.name)) item.wingPackage = "speedway";
    }
  }
  return model;
}

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}
