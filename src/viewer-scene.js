import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export class ViewerScene {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 10000);
    this.camera.position.set(0, 18, 34);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setSize(container.clientWidth || 640, container.clientHeight || 480);
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 2, 0);

    this.rootGroup = new THREE.Group();
    this.scene.add(this.rootGroup);

    this.scrapeGroup = new THREE.Group();
    this.scene.add(this.scrapeGroup);

    this.lightsGroup = new THREE.Group();
    this.scene.add(this.lightsGroup);

    this.axleBarsGroup = new THREE.Group();
    this.scene.add(this.axleBarsGroup);

    this.shocksGroup = new THREE.Group();
    this.scene.add(this.shocksGroup);

    this.driveshaftGroup = new THREE.Group();
    this.scene.add(this.driveshaftGroup);

    this.groundGrid = null;
    this.partGroups = new Map();
    this.currentAssembly = null;
    this.gravityEnabled = false;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    this.renderFrame = this.renderFrame.bind(this);
    this.renderFrame();
  }

  clear() {
    this.rootGroup.clear();
    this.scrapeGroup.clear();
    this.lightsGroup.clear();
    this.axleBarsGroup.clear();
    this.shocksGroup.clear();
    this.driveshaftGroup.clear();
    this.partGroups.clear();
    if (this.groundGrid) {
      this.scene.remove(this.groundGrid);
      this.groundGrid = null;
    }
  }

  setAssembly(assembly) {
    this.currentAssembly = assembly;
    this.renderAssembly();
  }

  renderAssembly() {
    this.clear();
    const assembly = this.currentAssembly;
    if (!assembly) {
      return;
    }
    const textureMap = new Map();
    for (const texture of assembly.textures ?? []) {
      const dataTexture = createDataTexture(texture);
      textureMap.set(normalizeTextureKey(texture.name), dataTexture);
    }
    const gravityOffset = this.gravityEnabled ? { x: 0, y: -1, z: 0 } : { x: 0, y: 0, z: 0 };

    const addPart = (partKey, model, position = { x: 0, y: 0, z: 0 }) => {
      if (!model) {
        return;
      }
      const group = new THREE.Group();
      group.name = partKey;
      const placement = transformTruckVector(position);
      group.position.set(placement.x, placement.y, placement.z);
      for (const meshData of model.meshes ?? []) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(transformVertexBuffer(meshData.positions), 3));
        geometry.setAttribute("normal", new THREE.Float32BufferAttribute(transformVertexBuffer(meshData.normals), 3));
        if (meshData.uvs?.length) {
          geometry.setAttribute("uv", new THREE.Float32BufferAttribute(meshData.uvs, 2));
        }
        const diffuseMap = textureMap.get(normalizeTextureKey(meshData.textureName)) ?? null;
        const material = new THREE.MeshBasicMaterial({
          color: diffuseMap ? 0xffffff : (meshData.color ?? 0x9b9b9b),
          map: diffuseMap,
          wireframe: false,
          side: THREE.DoubleSide,
          transparent: !!meshData.transparent,
          alphaTest: meshData.transparent ? 0.5 : 0
        });
        const mesh = new THREE.Mesh(geometry, material);
        group.add(mesh);
      }
      this.rootGroup.add(group);
      this.partGroups.set(partKey, group);
    };

    addPart("body", assembly.body, offsetTruckVector({ x: 0, y: 0, z: 0 }, gravityOffset));
    for (const axle of assembly.axles ?? []) {
      addPart(axle.key, axle.model, offsetTruckVector(axle.position, gravityOffset));
    }
    for (const wheel of assembly.wheels ?? []) {
      addPart(wheel.key, wheel.model, wheel.position);
    }
    this.addCylinderSegments(this.axleBarsGroup, offsetTruckSegments(assembly.axleBars ?? [], gravityOffset), {
      color: 0xb6b6b6,
      radius: 0.16,
      textureMap,
      textureName: assembly.barTextureName ?? ""
    });
    this.addCylinderSegments(this.shocksGroup, offsetTruckSegments(assembly.shocks ?? [], gravityOffset), {
      color: 0xb7b7b7,
      radius: 0.12,
      textureMap,
      textureName: assembly.shockTextureName ?? ""
    }, "base", "top");
    this.addDriveshaft(offsetTruckDriveshaft(assembly.driveshaft, gravityOffset), textureMap);

    for (const point of assembly.scrapePoints ?? []) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xc0663b })
      );
      const placement = transformTruckVector(offsetTruckVector(point, gravityOffset));
      marker.position.set(placement.x, placement.y, placement.z);
      this.scrapeGroup.add(marker);
    }

    for (const light of assembly.lights ?? []) {
      const radius = Math.min(light.radius ?? 0.15, 0.25);
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xffffaa })
      );
      const placement = transformTruckVector(offsetTruckVector(light.pos, gravityOffset));
      marker.position.set(placement.x, placement.y, placement.z);
      this.lightsGroup.add(marker);
    }

    this.fitToContent();

    const truckBox = this.contentBounds();
    if (!truckBox.isEmpty()) {
      this.groundGrid = new THREE.GridHelper(120, 30, 0x4f6485, 0x2d3442);
      this.groundGrid.material.transparent = true;
      this.groundGrid.material.opacity = 0.5;
      this.groundGrid.position.y = truckBox.min.y;
      this.scene.add(this.groundGrid);
    }
  }

  setTexturesEnabled(enabled) {
    this.traverseRenderableParts((node) => {
      if (node.isMesh && node.material) {
        if (!node.material.userData.originalMap) {
          node.material.userData.originalMap = node.material.map;
        }
        node.material.map = enabled ? node.material.userData.originalMap : null;
        node.material.needsUpdate = true;
      }
    });
  }

  setWireframeEnabled(enabled) {
    this.traverseRenderableParts((node) => {
      if (node.isMesh && node.material) {
        node.material.wireframe = enabled;
        node.material.needsUpdate = true;
      }
    });
  }

  setWheelsVisible(visible) {
    for (const [key, group] of this.partGroups) {
      if (key.includes("tire")) {
        group.visible = visible;
      }
    }
  }

  setAxleVisible(visible) {
    for (const [key, group] of this.partGroups) {
      if (key === "axle_0" || key === "axle_1") {
        group.visible = visible;
      }
    }
  }

  setAxleBarsVisible(visible) {
    this.axleBarsGroup.visible = visible;
  }

  setShocksVisible(visible) {
    this.shocksGroup.visible = visible;
  }

  setDriveshaftVisible(visible) {
    this.driveshaftGroup.visible = visible;
  }

  setGravityEnabled(enabled) {
    this.gravityEnabled = enabled;
    if (this.currentAssembly) {
      this.renderAssembly();
    }
  }

  setScrapePointsVisible(visible) {
    this.scrapeGroup.visible = visible;
  }

  setLightsVisible(visible) {
    this.lightsGroup.visible = visible;
  }

  resetCamera() {
    this.fitToContent();
  }

  resize() {
    const width = Math.max(this.container.clientWidth, 320);
    const height = Math.max(this.container.clientHeight, 320);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  fitToContent() {
    const box = this.contentBounds();
    if (box.isEmpty()) {
      this.camera.position.set(0, 18, 34);
      this.controls.target.set(0, 2, 0);
      this.controls.update();
      return;
    }
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const radius = Math.max(size.x, size.y, size.z, 1);
    this.controls.target.copy(center);
    this.camera.position.set(center.x + radius * 1.2, center.y + radius * 0.85, center.z + radius * 1.6);
    this.camera.near = Math.max(0.1, radius / 100);
    this.camera.far = Math.max(500, radius * 20);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  renderFrame() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.renderFrame);
  }

  traverseRenderableParts(visitor) {
    for (const group of [this.rootGroup, this.axleBarsGroup, this.shocksGroup, this.driveshaftGroup]) {
      group.traverse(visitor);
    }
  }

  contentBounds() {
    const box = new THREE.Box3();
    for (const group of [this.rootGroup, this.axleBarsGroup, this.shocksGroup, this.driveshaftGroup]) {
      box.union(new THREE.Box3().setFromObject(group));
    }
    return box;
  }

  addCylinderSegments(group, segments, { color, radius, textureMap, textureName, useTexture = true }, startKey = "start", endKey = "end") {
    const diffuseMap = useTexture ? (textureMap.get(normalizeTextureKey(textureName)) ?? null) : null;
    for (const segment of segments) {
      const start = transformTruckVector(segment[startKey] ?? { x: 0, y: 0, z: 0 });
      const end = transformTruckVector(segment[endKey] ?? { x: 0, y: 0, z: 0 });
      const mesh = buildCylinderBetween(start, end, radius, diffuseMap, color);
      if (mesh) {
        mesh.name = segment.key ?? "";
        group.add(mesh);
      }
    }
  }

  addDriveshaft(driveshaft, textureMap) {
    if (!driveshaft) {
      return;
    }
    const diffuseMap = textureMap.get(normalizeTextureKey(driveshaft.textureName)) ?? null;
    const hub = transformTruckVector(driveshaft.hub ?? { x: 0, y: 0, z: 0 });
    const front = transformTruckVector(driveshaft.front ?? { x: 0, y: 0, z: 0 });
    const rear = transformTruckVector(driveshaft.rear ?? { x: 0, y: 0, z: 0 });
    for (const [name, start, end] of [
      ["driveshaft_front", hub, front],
      ["driveshaft_rear", hub, rear]
    ]) {
      const mesh = buildCylinderBetween(start, end, 0.14, diffuseMap, 0xcfcfcf);
      if (mesh) {
        mesh.name = name;
        this.driveshaftGroup.add(mesh);
      }
    }
  }
}

function createDataTexture(texture) {
  const data = new Uint8Array(texture.rgba);
  const dataTexture = new THREE.DataTexture(data, texture.width, texture.height, THREE.RGBAFormat);
  dataTexture.colorSpace = THREE.SRGBColorSpace;
  dataTexture.flipY = true;
  dataTexture.needsUpdate = true;
  return dataTexture;
}

function buildCylinderBetween(start, end, radius, diffuseMap, color) {
  const from = new THREE.Vector3(start.x, start.y, start.z);
  const to = new THREE.Vector3(end.x, end.y, end.z);
  const delta = new THREE.Vector3().subVectors(to, from);
  const length = delta.length();
  if (!Number.isFinite(length) || length < 1e-4) {
    return null;
  }
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 12, 1, false);
  const material = new THREE.MeshBasicMaterial({
    color: diffuseMap ? 0xffffff : color,
    map: diffuseMap ?? null,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geometry, material);
  const midpoint = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
  mesh.position.copy(midpoint);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  return mesh;
}

function offsetTruckVector(vector, offset) {
  return {
    x: (vector?.x ?? 0) + (offset?.x ?? 0),
    y: (vector?.y ?? 0) + (offset?.y ?? 0),
    z: (vector?.z ?? 0) + (offset?.z ?? 0)
  };
}

function offsetTruckSegments(segments, offset) {
  return segments.map((segment) => ({
    ...segment,
    start: segment.start ? offsetTruckVector(segment.start, offset) : segment.start,
    end: segment.end ? offsetTruckVector(segment.end, offset) : segment.end,
    base: segment.base ? offsetTruckVector(segment.base, offset) : segment.base,
    top: segment.top ? offsetTruckVector(segment.top, offset) : segment.top
  }));
}

function offsetTruckDriveshaft(driveshaft, offset) {
  if (!driveshaft) {
    return driveshaft;
  }
  return {
    ...driveshaft,
    hub: offsetTruckVector(driveshaft.hub, offset),
    front: offsetTruckVector(driveshaft.front, offset),
    rear: offsetTruckVector(driveshaft.rear, offset)
  };
}

function normalizeTextureKey(name) {
  const upper = String(name ?? "").replace(/\\/g, "/").trim().toUpperCase();
  const title = upper.includes("/") ? upper.slice(upper.lastIndexOf("/") + 1) : upper;
  return title.endsWith(".RAW") ? title.slice(0, -4) : title;
}

function transformVertexBuffer(values) {
  const output = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 3) {
    output[i] = values[i];
    output[i + 1] = values[i + 2];
    output[i + 2] = -values[i + 1];
  }
  return output;
}

// TRK coordinate system: x=lateral, y=vertical (up=positive), z=longitudinal (front=positive).
// Three.js: x=lateral, y=up, z=depth (front=negative). Map: (x, y, -z).
function transformTruckVector(vector) {
  return {
    x: vector.x ?? 0,
    y: vector.y ?? 0,
    z: -(vector.z ?? 0)
  };
}
