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

    this.partGroups = new Map();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    this.renderFrame = this.renderFrame.bind(this);
    this.renderFrame();
  }

  clear() {
    this.rootGroup.clear();
    this.scrapeGroup.clear();
    this.partGroups.clear();
  }

  setAssembly(assembly) {
    this.clear();
    const textureMap = new Map();
    for (const texture of assembly.textures ?? []) {
      const dataTexture = createDataTexture(texture);
      textureMap.set(normalizeTextureKey(texture.name), dataTexture);
    }

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
          color: diffuseMap ? 0xffffff : 0x9b9b9b,
          map: diffuseMap,
          wireframe: false,
          side: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(geometry, material);
        group.add(mesh);
      }
      this.rootGroup.add(group);
      this.partGroups.set(partKey, group);
    };

    addPart("body", assembly.body);
    for (let i = 0; i < (assembly.axlePositions ?? []).length; i++) {
      addPart(`axle_${i}`, assembly.axle, assembly.axlePositions[i]);
    }
    for (const wheel of assembly.wheels ?? []) {
      addPart(wheel.key, wheel.model, wheel.position);
    }

    for (const point of assembly.scrapePoints ?? []) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xc0663b })
      );
      const placement = transformTruckVector(point);
      marker.position.set(placement.x, placement.y, placement.z);
      this.scrapeGroup.add(marker);
    }

    this.fitToContent();
  }

  setTexturesEnabled(enabled) {
    this.rootGroup.traverse((node) => {
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
    this.rootGroup.traverse((node) => {
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
      if (key.startsWith("axle")) {
        group.visible = visible;
      }
    }
  }

  setScrapePointsVisible(visible) {
    this.scrapeGroup.visible = visible;
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
    const box = new THREE.Box3().setFromObject(this.rootGroup);
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
}

function createDataTexture(texture) {
  const data = new Uint8Array(texture.rgba);
  const dataTexture = new THREE.DataTexture(data, texture.width, texture.height, THREE.RGBAFormat);
  dataTexture.colorSpace = THREE.SRGBColorSpace;
  dataTexture.flipY = true;
  dataTexture.needsUpdate = true;
  return dataTexture;
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
