import * as THREE from "three";

/*
  Truck lights as MTM2 draws them: a flare sprite at the lamp and, for the lamps that have
  one, a translucent beam cone thrown along the lamp's heading and pitch.

  Every light in the TRK carries a type. Across the 163 lights of the 20 stock trucks in
  TRUCK2.POD the types sort cleanly by where they sit and what they draw:

    0  headlights       front, pitched 10 degrees down, 75 ft HEADLITE/LITEFUZZ beam
    1  brake and tail   rear, toed out 15 degrees, BRLT*.RAW shaped like each tail lamp
    3  roof light bar   four HEADLITE lamps fanned across the cab roof, 40 ft beams
    4  special          Monster Patrol's spinning red and blue beacons, Snakebite's blinkers
    5  reverse          rear, BRLTRV.RAW, white

  Type 2 never occurs; anything outside the five is shown with the special group.

  The flare bitmaps are glows on black, drawn additively so the black adds nothing. Each is
  faded by how squarely the lamp faces the camera, so a brake light goes dark from the front
  and a spinning beacon flashes as it sweeps past - the stock data aims every lamp, and a
  lamp seen from behind should not glow.
*/

export const LIGHT_GROUPS = ["headlights", "lightBar", "brake", "reverse", "special"];

const GROUP_BY_TYPE = { 0: "headlights", 1: "brake", 3: "lightBar", 4: "special", 5: "reverse" };

export function lightGroupOf(type) {
  return GROUP_BY_TYPE[type] ?? "special";
}

const BEAM_INTENSITY = 0.14;
const BEAM_RADIAL_SEGMENTS = 24;
// The fuzz texture repeats once per this many feet of beam, and twice around it.
const BEAM_TEXTURE_FEET = 12;
const BEAM_TEXTURE_AROUND = 2;

const BEAM_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying float vFacing;
  void main() {
    vUv = uv;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vec3 viewNormal = normalize(normalMatrix * normal);
    vFacing = abs(dot(viewNormal, normalize(-viewPosition.xyz)));
    gl_Position = projectionMatrix * viewPosition;
  }
`;

// uv.y runs 0 at the lamp to 1 at the rim. The beam fades out along its length, and the
// facing term softens the silhouette so the cone reads as a shaft of light, not a solid.
const BEAM_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D map;
  uniform vec2 repeat;
  uniform float intensity;
  varying vec2 vUv;
  varying float vFacing;
  void main() {
    vec3 fuzz = texture2D(map, vUv * repeat).rgb;
    float along = pow(1.0 - vUv.y, 2.2);
    float edge = pow(vFacing, 1.5);
    gl_FragColor = vec4(fuzz * intensity * along * edge, 1.0);
    #include <colorspace_fragment>
  }
`;

export class TruckLightRig {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = "truck_lights";
    this.lamps = [];
    this.textures = [];
    this.groupVisible = Object.fromEntries(LIGHT_GROUPS.map((key) => [key, true]));
    this.beamsVisible = true;
    this.smoothTextures = true;
    this.toCamera = new THREE.Vector3();
    this.direction = new THREE.Vector3();
  }

  /*
    lights: the worker's light records, truck space in feet.
    lightTextures: decoded flare and fuzz bitmaps found in the archive.
    place: maps a truck-space position to scene space.
  */
  build(lights, lightTextures, place) {
    this.clear();
    const bitmaps = new Map((lightTextures ?? []).map((texture) => [textureKey(texture.name), texture]));
    const flareCache = new Map();
    const fuzzCache = new Map();
    const flareFor = (name, type) => {
      const key = textureKey(name) || `__type${type}`;
      if (!flareCache.has(key)) {
        const bitmap = bitmaps.get(textureKey(name));
        flareCache.set(key, this.track(bitmap ? bitmapTexture(bitmap, this.smoothTextures) : fallbackFlare(type)));
      }
      return flareCache.get(key);
    };
    const fuzzFor = (name) => {
      const key = textureKey(name);
      if (!fuzzCache.has(key)) {
        const bitmap = bitmaps.get(key);
        const texture = bitmap ? bitmapTexture(bitmap, true) : fallbackFuzz(key);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        fuzzCache.set(key, this.track(texture));
      }
      return fuzzCache.get(key);
    };

    for (const light of lights ?? []) {
      const position = place(light.pos);
      const lamp = {
        light,
        groupKey: lightGroupOf(light.type),
        position: new THREE.Vector3(position.x, position.y, position.z),
        flare: null,
        beam: null
      };

      lamp.flare = new THREE.Sprite(new THREE.SpriteMaterial({
        map: flareFor(light.sourceBitmap, light.type),
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        toneMapped: false
      }));
      lamp.flare.scale.setScalar(light.radius * 2);
      lamp.flare.renderOrder = 2;
      this.group.add(lamp.flare);

      if (light.coneLength > 0) {
        lamp.beam = new THREE.Mesh(
          beamGeometry(light.coneLength, light.coneBaseRadius, light.coneRimRadius),
          new THREE.ShaderMaterial({
            uniforms: {
              map: { value: fuzzFor(light.coneTexture) },
              repeat: { value: new THREE.Vector2(BEAM_TEXTURE_AROUND, Math.max(1, light.coneLength / BEAM_TEXTURE_FEET)) },
              intensity: { value: BEAM_INTENSITY }
            },
            vertexShader: BEAM_VERTEX_SHADER,
            fragmentShader: BEAM_FRAGMENT_SHADER,
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide
          })
        );
        lamp.beam.position.copy(lamp.position);
        lamp.beam.renderOrder = 1;
        this.group.add(lamp.beam);
      }
      this.lamps.push(lamp);
    }
  }

  clear() {
    for (const lamp of this.lamps) {
      lamp.flare.material.dispose();
      if (lamp.beam) {
        lamp.beam.geometry.dispose();
        lamp.beam.material.dispose();
      }
    }
    for (const texture of this.textures) texture.dispose();
    this.lamps = [];
    this.textures = [];
    this.group.clear();
  }

  // Which light types a truck actually has, so the UI can grey out the rest.
  presentGroups() {
    return new Set(this.lamps.map((lamp) => lamp.groupKey));
  }

  setGroupVisible(groupKey, visible) {
    this.groupVisible[groupKey] = !!visible;
  }

  setBeamsVisible(visible) {
    this.beamsVisible = !!visible;
  }

  setTextureSmoothing(smooth) {
    this.smoothTextures = !!smooth;
    for (const lamp of this.lamps) {
      const map = lamp.flare.material.map;
      if (map?.userData.fromBitmap) applyFiltering(map, this.smoothTextures);
    }
  }

  // Called every frame: spins, blinks and fades each lamp for the current camera.
  update(camera, timeMs) {
    const seconds = timeMs / 1000;
    for (const lamp of this.lamps) {
      const { light } = lamp;
      const lit = this.groupVisible[lamp.groupKey] && blinkOn(light, timeMs);
      lamp.flare.visible = lit;
      if (lamp.beam) lamp.beam.visible = lit && this.beamsVisible;
      if (!lit) continue;

      lampDirection(light.heading + light.spinSpeed * seconds, light.pitch, this.direction);
      this.toCamera.subVectors(camera.position, lamp.position);
      const distance = this.toCamera.length();
      this.toCamera.divideScalar(distance || 1);

      const facing = this.direction.dot(this.toCamera);
      lamp.flare.material.opacity = smoothstep(-0.2, 0.35, facing);
      // Pull the sprite a little toward the camera so the lens it sits on does not cut it in half.
      lamp.flare.position.copy(lamp.position).addScaledVector(this.toCamera, Math.min(light.radius * 0.6, distance * 0.5));

      if (lamp.beam) {
        lamp.beam.quaternion.setFromUnitVectors(BEAM_AXIS, this.direction);
      }
    }
  }

  track(texture) {
    this.textures.push(texture);
    return texture;
  }
}

const BEAM_AXIS = new THREE.Vector3(0, 0, 1);

/*
  Heading 0 is straight ahead (+z in the TRK), heading grows toward +x, and pitch lifts the
  lamp up. Truck +z is scene -z, the same flip the viewer applies to every truck position.
*/
function lampDirection(heading, pitch, target) {
  const cosPitch = Math.cos(pitch);
  return target.set(Math.sin(heading) * cosPitch, Math.sin(pitch), -Math.cos(heading) * cosPitch).normalize();
}

function blinkOn(light, timeMs) {
  const period = (light.msOn ?? 0) + (light.msOff ?? 0);
  if (!(light.msOn > 0) || period <= 0) return true;
  return timeMs % period < light.msOn;
}

// An open cone from the lamp (base radius) to the rim, laid along +z starting at the origin.
function beamGeometry(length, baseRadius, rimRadius) {
  const geometry = new THREE.CylinderGeometry(
    Math.max(rimRadius, 0.01),
    Math.max(baseRadius, 0.01),
    length,
    BEAM_RADIAL_SEGMENTS,
    1,
    true
  );
  geometry.translate(0, length / 2, 0);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

function bitmapTexture(bitmap, smooth) {
  const texture = new THREE.DataTexture(new Uint8Array(bitmap.rgba), bitmap.width, bitmap.height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = true;
  texture.userData.fromBitmap = true;
  applyFiltering(texture, smooth);
  return texture;
}

function applyFiltering(texture, smooth) {
  texture.magFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter;
  texture.minFilter = smooth ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter;
  texture.generateMipmaps = smooth;
  texture.needsUpdate = true;
}

// A soft round glow, for a lamp whose source bitmap is not in the archive.
function fallbackFlare(type) {
  const size = 64;
  const tint = lightGroupOf(type) === "brake" ? [1, 0.25, 0.3] : [1, 1, 1];
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const r = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
      const glow = Math.max(0, 1 - r) ** 2;
      const core = r < 0.25 ? 1 : 0;
      const out = (y * size + x) * 4;
      for (let c = 0; c < 3; c += 1) data[out + c] = Math.round(255 * Math.min(1, glow * tint[c] + core * glow));
      data[out + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  applyFiltering(texture, true);
  return texture;
}

/*
  Stand-in for LITEFUZZ, REDFUZZ and BLUEFUZZ, which the stock game keeps in STARTUP.POD
  rather than beside the trucks. The originals are 256x256 speckle in one hue - grey, pure
  red, pure blue - at about 30 to 80 percent brightness; this is the same, seeded so every
  load looks alike.
*/
function fallbackFuzz(key) {
  const size = 64;
  const tint = key.startsWith("RED") ? [1, 0, 0] : key.startsWith("BLUE") ? [0, 0, 1] : [1, 1, 1];
  const data = new Uint8Array(size * size * 4);
  let seed = 0x2f6b1d;
  for (let i = 0; i < size * size; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const value = 0.3 + 0.5 * (seed / 0xffffffff);
    for (let c = 0; c < 3; c += 1) data[i * 4 + c] = Math.round(255 * value * tint[c]);
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  applyFiltering(texture, true);
  return texture;
}

function textureKey(name) {
  const upper = String(name ?? "").replace(/\\/g, "/").trim().toUpperCase();
  const title = upper.includes("/") ? upper.slice(upper.lastIndexOf("/") + 1) : upper;
  return title.replace(/\.[^.]+$/, "");
}

function smoothstep(edge0, edge1, value) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
