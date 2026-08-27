import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assetUrl } from '../paths.js';

const WORLD_SCALE = 0.001;
const WALL_ANIMATION = new Map([
  [54, { texture: 'right_arrow_red.png', speed: 200, length: 4 }],
  [55, { texture: 'left_arrow_red.png', speed: -200, length: 4 }],
  [56, { texture: 'right_arrow_green.png', speed: 200, length: 4 }],
  [57, { texture: 'left_arrow_green.png', speed: -200, length: 4 }],
  [70, { texture: 'neon_on.png', speed: 50, length: 20 }],
  [71, { texture: 'neon_on.png', speed: -50, length: 20 }],
]);
const WALL_STRETCH_HEIGHT = new Map([
  [52, 4], [53, 4], [54, 4], [55, 4], [56, 4], [57, 4],
  [72, 4], [73, 6],
]);
const CONTEXT_ATTRIBUTES = {
  alpha: false,
  antialias: true,
  depth: true,
  stencil: false,
  failIfMajorPerformanceCaveat: false,
  powerPreference: 'high-performance',
  premultipliedAlpha: false,
  preserveDrawingBuffer: false,
};

function createOpaqueRenderer(canvas) {
  // Three r179 always requests an alpha-capable context when it creates the
  // context itself. An explicitly opaque context lets Safari/ANGLE present the
  // Metal surface without blending it through the page compositor.
  const context = canvas.getContext('webgl2', CONTEXT_ATTRIBUTES);
  if (!context) throw new Error('WebGL2 is not available');
  const renderer = new THREE.WebGLRenderer({
    canvas,
    context,
    alpha: false,
    antialias: true,
    powerPreference: 'high-performance',
    premultipliedAlpha: false,
  });
  return { renderer, contextAttributes: context.getContextAttributes() };
}

function setWorldPoint(target, [x, y, z = 0]) {
  return target.set(x * WORLD_SCALE, z * WORLD_SCALE, -y * WORLD_SCALE);
}

function worldPoint([x, y, z = 0]) {
  return new THREE.Vector3(x * WORLD_SCALE, z * WORLD_SCALE, -y * WORLD_SCALE);
}

function triangulate(points) {
  const contour = points.map(([x, y]) => new THREE.Vector2(x * WORLD_SCALE, -y * WORLD_SCALE));
  return { contour, triangles: THREE.ShapeUtils.triangulateShape(contour, []) };
}

export class HoverRaceRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const { renderer, contextAttributes } = createOpaqueRenderer(canvas);
    this.renderer = renderer;
    this.contextAttributes = contextAttributes;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020407);
    this.scene.fog = new THREE.FogExp2(0x020407, 0.012);

    this.camera = new THREE.PerspectiveCamera(76, 16 / 9, 0.04, 900);
    this.camera.up.set(0, 1, 0);
    this.cameraMode = 0;

    this.trackGroup = new THREE.Group();
    this.craftGroup = new THREE.Group();
    this.projectileGroup = new THREE.Group();
    this.remoteGroup = new THREE.Group();
    this.scene.add(this.trackGroup, this.craftGroup, this.projectileGroup, this.remoteGroup);

    this.textureCatalog = new Map();
    this.textures = new Map();
    this.materials = new Map();
    this.meshCache = new Map();
    this.actorVisuals = [];
    this.projectileTemplates = new Map();
    this.projectileVisuals = new Map();
    this.remoteTemplates = new Map();
    this.remoteVisuals = new Map();
    this.remoteSnapshot = [];
    this.remoteProjectiles = [];
    this.surfaceAnimations = [];
    this.trackOwnedMaterials = [];
    this.trackStats = { floors: 0, walls: 0, sourceMeshes: 0, batches: 0 };
    this.warmedTextures = new WeakSet();
    this.rendererIdentity = null;
    this.fallbackMaterial = new THREE.MeshBasicMaterial({ color: 0x34383d, side: THREE.DoubleSide, fog: true });
    this.clock = new THREE.Clock();
    this.lastSize = { width: 0, height: 0 };
    this.resizeCount = 0;
    this.pendingSize = { width: 1, height: 1 };
    this.positionVector = new THREE.Vector3();
    this.headingVector = new THREE.Vector3();
    this.cameraTarget = new THREE.Vector3();
    this.remoteTarget = new THREE.Vector3();
    this.projectileLiveIds = new Set();
    this.observeCanvasSize();
  }

  observeCanvasSize() {
    const recordSize = (width, height) => {
      this.pendingSize.width = Math.max(1, Math.round(width));
      this.pendingSize.height = Math.max(1, Math.round(height));
    };
    recordSize(this.canvas.clientWidth, this.canvas.clientHeight);
    if (globalThis.ResizeObserver) {
      this.resizeObserver = new ResizeObserver((entries) => {
        const bounds = entries.at(-1)?.contentRect;
        if (bounds) recordSize(bounds.width, bounds.height);
      });
      this.resizeObserver.observe(this.canvas);
    } else {
      window.addEventListener('resize', () => {
        const bounds = this.canvas.getBoundingClientRect();
        recordSize(bounds.width, bounds.height);
      }, { passive: true });
    }
  }

  async loadTextureCatalog() {
    const response = await fetch(assetUrl('textures', 'catalog.json'));
    if (!response.ok) throw new Error(`Texture catalog failed: ${response.status}`);
    const entries = await response.json();
    for (const entry of entries) this.textureCatalog.set(entry.output, entry);
  }

  async texture(name) {
    if (!name) return null;
    if (this.textures.has(name)) return this.textures.get(name);
    const promise = new THREE.TextureLoader().loadAsync(assetUrl('textures', name)).then((texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      return texture;
    });
    this.textures.set(name, promise);
    return promise;
  }

  async material(name, transparent = false) {
    if (!name) return this.fallbackMaterial;
    const key = `${name}:${transparent}`;
    if (this.materials.has(key)) return this.materials.get(key);
    // Track sections are built concurrently. Cache the pending material, not
    // just its finished value, so all walls using one texture truly share one
    // WebGL material and can be submitted as one batch.
    const promise = this.texture(name).then((map) => new THREE.MeshBasicMaterial({
      map,
      side: THREE.DoubleSide,
      transparent,
      alphaTest: transparent ? 0.03 : 0,
      fog: true,
    }));
    this.materials.set(key, promise);
    return promise;
  }

  textureSize(name) {
    const entry = this.textureCatalog.get(name);
    return entry ? [entry.width, entry.height] : [1, 1];
  }

  async buildTrack(track) {
    this.track = track;
    this.trackGroup.traverse((object) => object.geometry?.dispose());
    for (const material of this.trackOwnedMaterials) material.dispose();
    this.trackOwnedMaterials = [];
    this.trackGroup.clear();
    this.surfaceAnimations = [];
    const roomMeshes = await Promise.all(track.rooms.map((section, index) => this.buildSection(section, false, index)));
    const featureMeshes = await Promise.all(track.features.map((section, index) => this.buildSection(section, true, index)));
    for (const group of [...roomMeshes, ...featureMeshes]) this.trackGroup.add(group);
    this.trackStats = this.sourceTrackStats();
    this.batchStaticTrackGeometry();
    this.batchAnimatedWalls();
    this.pruneEmptyGroups(this.trackGroup);
    this.trackStats.batches = this.trackMeshCount();
    this.actorVisuals = (await Promise.all((track.actors ?? []).map((actor, index) =>
      this.buildActor(actor, index)))).filter(Boolean);
    for (const visual of this.actorVisuals) this.trackGroup.add(visual.group);
    await this.buildGameplayAssets();
  }

  sourceTrackStats() {
    let floors = 0;
    let walls = 0;
    let sourceMeshes = 0;
    this.trackGroup.traverse((object) => {
      if (!object.isMesh) return;
      sourceMeshes += 1;
      if (object.name === 'floor') floors += 1;
      if (object.name === 'wall') walls += 1;
    });
    return { floors, walls, sourceMeshes, batches: sourceMeshes };
  }

  trackMeshCount() {
    let count = 0;
    this.trackGroup.traverse((object) => { if (object.isMesh) count += 1; });
    return count;
  }

  pruneEmptyGroups(group) {
    for (const child of [...group.children]) {
      if (!child.isGroup) continue;
      this.pruneEmptyGroups(child);
      if (!child.children.length) group.remove(child);
    }
  }

  mergeMeshBatch(meshes, material, name) {
    if (!meshes.length) return null;
    const geometries = meshes.map((mesh) => {
      mesh.updateWorldMatrix(true, false);
      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(mesh.matrixWorld);
      return geometry;
    });
    const geometry = mergeGeometries(geometries, false);
    for (const clone of geometries) clone.dispose();
    if (!geometry) return null;
    geometry.computeBoundingSphere();
    for (const mesh of meshes) {
      mesh.parent?.remove(mesh);
      mesh.geometry.dispose();
    }
    const batch = new THREE.Mesh(geometry, material);
    batch.name = name;
    batch.frustumCulled = false;
    batch.matrixAutoUpdate = false;
    batch.updateMatrix();
    this.trackGroup.add(batch);
    return batch;
  }

  batchStaticTrackGeometry() {
    const animated = new Set(this.surfaceAnimations.flatMap(({ off, on }) => [off, on]));
    const byMaterial = new Map();
    this.trackGroup.traverse((object) => {
      if (!object.isMesh || animated.has(object)) return;
      const key = object.material.uuid;
      if (!byMaterial.has(key)) byMaterial.set(key, { material: object.material, meshes: [] });
      byMaterial.get(key).meshes.push(object);
    });
    for (const { material, meshes } of byMaterial.values()) {
      if (meshes.length > 1) this.mergeMeshBatch(meshes, material, 'static-track-batch');
    }
  }

  batchAnimatedWalls() {
    const groups = new Map();
    for (const animation of this.surfaceAnimations) {
      const key = [animation.speed, animation.length,
        animation.off.material.uuid, animation.on.material.uuid].join(':');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(animation);
    }

    const animations = [];
    for (const records of groups.values()) {
      const { speed, length } = records[0];
      const off = this.mergeMeshBatch(records.map((record) => record.off),
        records[0].off.material, 'animated-wall-off-batch');
      if (off) off.renderOrder = 0;

      // The base texture remains drawn in one batch. Only the currently lit
      // phase is overlaid, cutting hundreds of per-tile WebGL submissions down
      // to two submissions per animated surface style.
      const onMaterial = records[0].on.material.clone();
      onMaterial.polygonOffset = true;
      onMaterial.polygonOffsetFactor = -1;
      onMaterial.polygonOffsetUnits = -1;
      this.trackOwnedMaterials.push(onMaterial);
      const phases = Array.from({ length }, (_, phase) => {
        const meshes = records.filter((record) =>
          ((record.tile % length) + length) % length === phase).map((record) => record.on);
        const batch = this.mergeMeshBatch(meshes, onMaterial, `animated-wall-on-phase-${phase}`);
        if (batch) {
          batch.visible = false;
          batch.renderOrder = 1;
        }
        return batch;
      });
      animations.push({ speed, length, phases, activePhase: -1 });
    }
    this.surfaceAnimations = animations;
  }

  async buildGameplayAssets() {
    if (this.projectileTemplates.size > 0) return;
    for (const name of ['missile', 'mine', 'can']) {
      const meshData = await this.mesh(name);
      const sequences = await Promise.all(meshData.sequences.map((sequence, sequenceIndex) =>
        Promise.all(sequence.frames.map((frame, frameIndex) =>
          this.buildMeshFrame(frame, `${name}-sequence-${sequenceIndex}-frame-${frameIndex}`)))));
      const template = new THREE.Group();
      for (const sequence of sequences) for (const frame of sequence) template.add(frame);
      this.projectileTemplates.set(name, { template, sequences });
    }
  }

  async mesh(name) {
    if (!this.meshCache.has(name)) {
      this.meshCache.set(name, fetch(assetUrl('meshes', `${name}.json`)).then((response) => {
        if (!response.ok) throw new Error(`Actor mesh failed: ${name} (${response.status})`);
        return response.json();
      }));
    }
    return this.meshCache.get(name);
  }

  async buildActor(actor, index) {
    const meshName = { powerup: 'can', mine: 'mine', bumperGate: 'inflating_column' }[actor.type];
    if (!meshName) return null;
    const meshData = await this.mesh(meshName);
    const frames = await Promise.all(meshData.sequences[0].frames.map((frame, frameIndex) =>
      this.buildMeshFrame(frame, `actor-${index}-frame-${frameIndex}`)));
    const group = new THREE.Group();
    group.name = `actor-${actor.type}-${index}`;
    group.position.copy(worldPoint(actor.position));
    group.rotation.y = actor.orientation * Math.PI * 2 / 4096;
    for (const frame of frames) {
      frame.visible = false;
      group.add(frame);
    }
    const initialFrame = actor.type === 'bumperGate' ? frames.length - 1 : 0;
    frames[initialFrame].visible = true;
    return { actor, actorIndex: index, group, frames, activeFrame: initialFrame };
  }

  async buildSection(section, isFeature, index) {
    const group = new THREE.Group();
    group.name = `${isFeature ? 'feature' : 'room'}-${index}`;
    const points = section.vertices.map((vertex) => vertex.point);

    if (section.floorSurface.texture) {
      group.add(await this.buildHorizontal(points, section.floor, section.floorSurface, false));
    }
    if (section.ceilingSurface.texture && section.ceiling > section.floor) {
      group.add(await this.buildHorizontal(points, section.ceiling, section.ceilingSurface, true));
    }

    for (let i = 0; i < points.length; i += 1) {
      const next = (i + 1) % points.length;
      const textureName = section.wallSurfaces[i]?.texture;
      if (!textureName) continue;
      const neighbor = !isFeature ? section.neighbors[i] : -1;
      if (neighbor == null || neighbor < 0) {
        group.add(await this.buildWall(points[i], points[next], section.floor, section.ceiling, section.wallSurfaces[i]));
        continue;
      }

      const neighborSection = this.track.rooms[neighbor];
      if (!neighborSection) continue;
      if (section.floor < neighborSection.floor) {
        group.add(await this.buildWall(points[i], points[next], section.floor, neighborSection.floor, section.wallSurfaces[i]));
      }
      if (section.ceiling > neighborSection.ceiling) {
        group.add(await this.buildWall(points[i], points[next], neighborSection.ceiling, section.ceiling, section.wallSurfaces[i]));
      }
    }
    return group;
  }

  async buildHorizontal(points, level, surface, ceiling) {
    const textureName = surface.texture;
    const { contour, triangles } = triangulate(points);
    const [textureWidth, textureHeight] = this.textureSize(textureName);
    const positions = [];
    const uvs = [];
    for (const triangle of triangles) {
      const order = ceiling ? [...triangle].reverse() : triangle;
      for (const vertexIndex of order) {
        const point = contour[vertexIndex];
        positions.push(point.x, level * WORLD_SCALE, point.y);
        uvs.push(point.x / textureWidth, -point.y / textureHeight);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, await this.material(textureName));
    mesh.name = ceiling ? 'ceiling' : 'floor';
    return mesh;
  }

  wallTextureSize(surface, height) {
    const maxHeight = WALL_STRETCH_HEIGHT.get(surface.classId);
    if (!maxHeight) return this.textureSize(surface.texture);
    const tileSize = height / Math.ceil(height / maxHeight);
    return [tileSize, tileSize];
  }

  async buildWall(start, end, floor, ceiling, surface) {
    const animation = WALL_ANIMATION.get(surface.classId);
    if (!animation) return this.buildWallMesh(start, end, floor, ceiling, surface.texture, surface);

    const group = new THREE.Group();
    group.name = 'animated-wall';
    const totalLength = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const height = Math.max(0.001, (ceiling - floor) * WORLD_SCALE);
    const [tileWidth] = this.wallTextureSize(surface, height);
    const tileLength = Math.max(1, tileWidth / WORLD_SCALE);
    const count = Math.max(1, Math.ceil(totalLength / tileLength));
    for (let tile = 0; tile < count; tile += 1) {
      const from = tile * tileLength / totalLength;
      const to = Math.min(1, (tile + 1) * tileLength / totalLength);
      const a = [start[0] + (end[0] - start[0]) * from, start[1] + (end[1] - start[1]) * from];
      const b = [start[0] + (end[0] - start[0]) * to, start[1] + (end[1] - start[1]) * to];
      const off = await this.buildWallMesh(a, b, floor, ceiling, surface.texture, surface);
      const on = await this.buildWallMesh(a, b, floor, ceiling, animation.texture, surface);
      on.visible = false;
      group.add(off, on);
      this.surfaceAnimations.push({ off, on, tile, ...animation });
    }
    return group;
  }

  async buildWallMesh(start, end, floor, ceiling, textureName, surface) {
    const a = worldPoint([start[0], start[1], floor]);
    const b = worldPoint([end[0], end[1], floor]);
    const c = worldPoint([end[0], end[1], ceiling]);
    const d = worldPoint([start[0], start[1], ceiling]);
    const length = a.distanceTo(b);
    const height = Math.max(0.001, (ceiling - floor) * WORLD_SCALE);
    const [textureWidth, textureHeight] = this.wallTextureSize(surface, height);
    const positions = [
      ...a, ...b, ...c,
      ...a, ...c, ...d,
    ];
    const u = length / textureWidth;
    const v = height / textureHeight;
    const wallV = v;
    const startU = 0;
    const endU = u;
    const uvs = [startU, 0, endU, 0, endU, wallV, startU, 0, endU, wallV, startU, wallV];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, await this.material(textureName));
    mesh.name = 'wall';
    return mesh;
  }

  async buildCraft(meshData) {
    this.meshData = meshData;
    this.craftGroup.clear();
    this.craftFrames = await Promise.all(meshData.sequences.map(async (sequence, sequenceIndex) =>
      Promise.all(sequence.frames.map((frame, frameIndex) =>
        this.buildMeshFrame(frame, `craft-sequence-${sequenceIndex}-frame-${frameIndex}`)))));
    for (const sequence of this.craftFrames) {
      for (const frame of sequence) this.craftGroup.add(frame);
    }
    this.activeCraftFrame = null;
    this.setCraftFrame(0, 0);
  }

  async buildMeshFrame(frame, name) {
    const group = new THREE.Group();
    group.name = name;
    group.visible = false;
    const meshes = await Promise.all(frame.patches.map(async (patch, patchIndex) => {
      const positions = [];
      const uvs = [];
      for (let v = 0; v < patch.vRes - 1; v += 1) {
        for (let u = 0; u < patch.uRes - 1; u += 1) {
          const i0 = v * patch.uRes + u;
          const i1 = i0 + 1;
          const i2 = i0 + patch.uRes + 1;
          const i3 = i0 + patch.uRes;
          for (const index of [i0, i1, i2, i0, i2, i3]) {
            const [x, y, z] = patch.vertices[index];
            positions.push(x * WORLD_SCALE, z * WORLD_SCALE, -y * WORLD_SCALE);
            const col = index % patch.uRes;
            const row = Math.floor(index / patch.uRes);
            uvs.push(col / Math.max(1, patch.uRes - 1), 1 - row / Math.max(1, patch.vRes - 1));
          }
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, await this.material(patch.texture));
      mesh.name = `craft-patch-${patchIndex}`;
      return mesh;
    }));
    for (const mesh of meshes) group.add(mesh);
    return group;
  }

  setCraftFrame(sequenceIndex, frameIndex) {
    const sequence = this.craftFrames?.[sequenceIndex] ?? this.craftFrames?.[0];
    const frame = sequence?.[frameIndex % sequence.length];
    if (!frame || frame === this.activeCraftFrame) return;
    if (this.activeCraftFrame) this.activeCraftFrame.visible = false;
    frame.visible = true;
    this.activeCraftFrame = frame;
  }

  setCameraMode(mode) {
    this.cameraMode = ((mode % 3) + 3) % 3;
  }

  update(state, frameTime) {
    for (const animation of this.surfaceAnimations) {
      // buildTrack() temporarily stores raw animated-wall records here while
      // the replacement map is being assembled. They do not have finalized
      // phase meshes yet; skip them so a map switch cannot kill the frame loop.
      if (!animation.phases) continue;
      const start = Math.trunc((frameTime + 40000) / animation.speed);
      const phase = ((start % animation.length) + animation.length) % animation.length;
      if (phase === animation.activePhase) continue;
      const previous = animation.phases[animation.activePhase];
      const next = animation.phases[phase];
      if (previous) previous.visible = false;
      if (next) next.visible = true;
      animation.activePhase = phase;
    }
    this.setCraftFrame(state.motorOn ? 1 : 0, Math.floor(frameTime / 80));
    for (const visual of this.actorVisuals) {
      visual.group.visible = state.actorVisible?.[visual.actorIndex] !== false;
      let frame = visual.activeFrame;
      if (visual.actor.type === 'mine') frame = (Math.floor(frameTime) >> 9) & 1;
      if (visual.actor.type === 'bumperGate') frame = state.actorFrames?.[visual.actorIndex] ?? frame;
      if (frame !== visual.activeFrame && visual.frames[frame]) {
        visual.frames[visual.activeFrame].visible = false;
        visual.frames[frame].visible = true;
        visual.activeFrame = frame;
      }
      if (visual.actor.type === 'powerup') {
        visual.group.rotation.y = (visual.actor.orientation + frameTime) * Math.PI * 2 / 4096;
      }
    }
    this.updateProjectiles(state.projectiles ?? [], this.remoteProjectiles);
    this.updateRemoteVisuals(frameTime);
    const position = setWorldPoint(this.positionVector, state.position);
    const angle = (state.cabinOrientation ?? state.orientation) * Math.PI * 2 / 4096;
    this.craftGroup.position.copy(position);
    this.craftGroup.rotation.y = angle;
    this.craftGroup.position.y += Math.sin(frameTime * 0.004) * 0.025;

    const heading = this.headingVector.set(Math.cos(angle), 0, -Math.sin(angle));
    if (this.cameraMode === 1) {
      this.camera.position.copy(position).addScaledVector(heading, -0.24);
      this.camera.position.y += 1.08;
      this.cameraTarget.copy(position).addScaledVector(heading, 16);
      this.cameraTarget.y += 0.9;
      this.camera.lookAt(this.cameraTarget);
    } else if (this.cameraMode === 2) {
      this.camera.position.copy(position);
      this.camera.position.y += 20;
      this.camera.position.z += 0.01;
      this.camera.lookAt(position);
    } else {
      // Observer.cpp places the chase camera at the native offset each frame;
      // frame-rate-dependent interpolation drifts badly on slower phones.
      this.camera.position.copy(position).addScaledVector(heading, -3.4);
      this.camera.position.y += 1.7;
      this.cameraTarget.copy(position).addScaledVector(heading, 1.6);
      this.cameraTarget.y += 0.72;
      this.camera.lookAt(this.cameraTarget);
    }
  }

  createProjectileVisual(projectile) {
    const source = this.projectileTemplates.get(projectile.kind === 'powerup' ? 'can' : projectile.kind);
    if (!source) return null;
    const group = source.template.clone(true);
    group.name = `projectile-${projectile.kind}-${projectile.id}`;
    for (const frame of group.children) frame.visible = false;
    const sequenceLengths = source.sequences.map((sequence) => sequence.length);
    this.projectileGroup.add(group);
    const visual = { group, sequenceLengths, active: null };
    this.projectileVisuals.set(projectile.id, visual);
    return visual;
  }

  updateProjectiles(localProjectiles, remoteProjectiles) {
    const live = this.projectileLiveIds;
    live.clear();
    for (const projectile of localProjectiles) live.add(projectile.id);
    for (const projectile of remoteProjectiles) live.add(projectile.id);
    for (const [id, visual] of this.projectileVisuals) {
      if (live.has(id)) continue;
      this.projectileGroup.remove(visual.group);
      this.projectileVisuals.delete(id);
    }
    for (const projectile of localProjectiles) this.updateProjectileVisual(projectile);
    for (const projectile of remoteProjectiles) this.updateProjectileVisual(projectile);
  }

  updateProjectileVisual(projectile) {
    const visual = this.projectileVisuals.get(projectile.id) ?? this.createProjectileVisual(projectile);
    if (!visual) return;
    setWorldPoint(visual.group.position, projectile.position);
    visual.group.rotation.y = projectile.orientation * Math.PI * 2 / 4096;
    let sequence = 0;
    let frame = 0;
    if (projectile.kind === 'mine') {
      frame = (Math.floor(projectile.age) >> 9) & 1;
    } else if (projectile.kind === 'powerup') {
      visual.group.rotation.y = projectile.orientation * Math.PI * 2 / 4096;
    } else if (projectile.exploded || projectile.age >= 7500) {
      sequence = 2;
      frame = Math.min(visual.sequenceLengths[2] - 1,
        Math.floor(visual.sequenceLengths[2] * (projectile.age - 7500) / 1200));
    } else if (projectile.age < 525) {
      frame = Math.min(visual.sequenceLengths[0] - 1,
        Math.floor(visual.sequenceLengths[0] * projectile.age / 525));
    } else {
      sequence = 1;
      frame = (Math.floor(projectile.age / 256)) % visual.sequenceLengths[1];
    }
    let flatIndex = frame;
    for (let index = 0; index < sequence; index += 1) {
      flatIndex += visual.sequenceLengths[index];
    }
    const next = visual.group.children[flatIndex];
    if (next && next !== visual.active) {
      if (visual.active) visual.active.visible = false;
      next.visible = true;
      visual.active = next;
    }
  }

  async remoteTemplate(craft) {
    if (!this.remoteTemplates.has(craft)) {
      this.remoteTemplates.set(craft, (async () => {
        const meshData = await this.mesh(craft);
        const sequences = await Promise.all(meshData.sequences.map((sequence, sequenceIndex) =>
          Promise.all(sequence.frames.map((frame, frameIndex) =>
            this.buildMeshFrame(frame, `remote-${craft}-${sequenceIndex}-${frameIndex}`)))));
        const template = new THREE.Group();
        for (const sequence of sequences) for (const frame of sequence) template.add(frame);
        return { template, lengths: sequences.map((sequence) => sequence.length) };
      })());
    }
    return this.remoteTemplates.get(craft);
  }

  setRemotePlayers(players) {
    this.remoteSnapshot = players;
    this.remoteProjectiles = players.flatMap((player) => (player.state?.projectiles ?? []).map((projectile) => ({
      ...projectile,
      id: `${player.id}:${projectile.id}`,
    })));
    const live = new Set(players.map((player) => player.id));
    for (const [id, visual] of this.remoteVisuals) {
      if (live.has(id)) continue;
      this.remoteGroup.remove(visual.group);
      this.remoteVisuals.delete(id);
    }
    for (const player of players) {
      const existing = this.remoteVisuals.get(player.id);
      if (existing) {
        existing.state = player.state;
        continue;
      }
      void this.remoteTemplate(player.craft).then(({ template, lengths }) => {
        if (!this.remoteSnapshot.some((entry) => entry.id === player.id) || this.remoteVisuals.has(player.id)) return;
        const group = template.clone(true);
        for (const frame of group.children) frame.visible = false;
        group.name = `remote-player-${player.id}`;
        setWorldPoint(group.position, player.state.position);
        this.remoteGroup.add(group);
        this.remoteVisuals.set(player.id, { group, lengths, state: player.state, active: null });
      }).catch(() => {});
    }
  }

  updateRemoteVisuals(frameTime) {
    for (const visual of this.remoteVisuals.values()) {
      const target = setWorldPoint(this.remoteTarget, visual.state.position);
      target.y += Math.sin(frameTime * 0.004) * 0.025;
      visual.group.position.lerp(target, 0.28);
      const angle = (visual.state.cabinOrientation ?? visual.state.orientation) * Math.PI * 2 / 4096;
      visual.group.rotation.y = angle;
      const sequence = visual.state.motorOn && visual.lengths[1] ? 1 : 0;
      const frame = Math.floor(frameTime / 80) % visual.lengths[sequence];
      let flatIndex = frame;
      for (let index = 0; index < sequence; index += 1) flatIndex += visual.lengths[index];
      const next = visual.group.children[flatIndex];
      if (next && next !== visual.active) {
        if (visual.active) visual.active.visible = false;
        next.visible = true;
        visual.active = next;
      }
    }
  }

  resize() {
    const { width, height } = this.pendingSize;
    if (width === this.lastSize.width && height === this.lastSize.height) return;
    this.lastSize = { width, height };
    this.resizeCount += 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  async warmup() {
    const textures = await Promise.all(this.textures.values());
    for (const texture of textures) {
      if (this.warmedTextures.has(texture)) continue;
      this.renderer.initTexture(texture);
      this.warmedTextures.add(texture);
    }
    await this.renderer.compileAsync(this.scene, this.camera);
  }

  render() {
    this.resize();
    this.renderer.render(this.scene, this.camera);
  }

  remoteCraftCount() {
    return this.remoteVisuals.size;
  }

  performanceStats() {
    const gl = this.renderer.getContext();
    if (this.rendererIdentity == null) {
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      this.rendererIdentity = String(gl.getParameter(
        debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)).replace(/\s+/g, ' ').trim();
    }
    return {
      renderer: this.rendererIdentity,
      webgl: this.renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1',
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      bufferWidth: this.canvas.width,
      bufferHeight: this.canvas.height,
      pixelRatio: this.renderer.getPixelRatio(),
      alpha: Boolean(this.contextAttributes?.alpha),
      resizeCount: this.resizeCount,
    };
  }

  diagnostics() {
    return {
      webgl: this.renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1',
      floors: this.trackStats.floors,
      walls: this.trackStats.walls,
      sourceMeshes: this.trackStats.sourceMeshes,
      trackBatches: this.trackStats.batches,
      craftPatches: this.activeCraftFrame?.children.length ?? 0,
      actorMeshes: this.actorVisuals.length,
      textures: this.textures.size,
    };
  }
}
