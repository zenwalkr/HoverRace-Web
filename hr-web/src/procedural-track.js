const TRACK_SHAPES = {
  small: { anchors: 10, samplesPerAnchor: 3, radiusX: 45_000, radiusY: 34_000 },
  medium: { anchors: 12, samplesPerAnchor: 4, radiusX: 66_000, radiusY: 48_000 },
  large: { anchors: 16, samplesPerAnchor: 4, radiusX: 98_000, radiusY: 72_000 },
};

const SURFACES = {
  floor: { dllId: 1, classId: 51, resourceId: null, texture: 'metal_plate.png' },
  ceiling: { dllId: 1, classId: 50, resourceId: null, texture: null },
  wall: { dllId: 1, classId: 72, resourceId: null, texture: 'gray_wall.png' },
  checkers: { dllId: 1, classId: 67, resourceId: null, texture: 'checkers.png' },
};

function copySurface(surface) { return { ...surface }; }

function seededRandom(seed) {
  let value = (Math.abs(Math.trunc(Number(seed) || 1)) >>> 0) || 1;
  return () => {
    value ^= value << 13; value ^= value >>> 17; value ^= value << 5; value >>>= 0;
    return value / 0x1_0000_0000;
  };
}

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t; const t3 = t2 * t;
  return [0, 1].map((axis) => 0.5 * ((2 * p1[axis]) + (-p0[axis] + p2[axis]) * t +
    (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * t2 +
    (-p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis]) * t3));
}

function normalize(x, y) {
  const length = Math.hypot(x, y) || 1;
  return [x / length, y / length];
}

function angleFor(vector) {
  return ((Math.trunc(Math.atan2(vector[1], vector[0]) * 4096 / (Math.PI * 2)) % 4096) + 4096) % 4096;
}

function roomFor(leftStart, rightStart, rightEnd, leftEnd, floor, width) {
  const vertices = [leftStart, rightStart, rightEnd, leftEnd].map((point) => ({ point, wallLength: width }));
  const points = vertices.map((vertex) => vertex.point);
  const xs = points.map((point) => point[0]); const ys = points.map((point) => point[1]);
  return {
    vertexCount: 4, floor, ceiling: floor + 5000,
    min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)], vertices,
    floorSurface: copySurface(SURFACES.floor), ceilingSurface: copySurface(SURFACES.ceiling),
    wallSurfaces: Array.from({ length: 4 }, () => copySurface(SURFACES.wall)),
    neighbors: [-1, -1, -1, -1], children: [], visibleRooms: [], visibleFloors: [],
    visibleCeilings: [], audibleRooms: [],
  };
}

function actor(type, classifiedRoom, position, orientation = 0) {
  return { type, classifiedRoom, position, orientation, dllId: 1, classId: 200 };
}

export function generateProceduralTrack(size = 'medium', seed = 1) {
  const normalizedSize = TRACK_SHAPES[size] ? size : 'medium';
  const shape = TRACK_SHAPES[normalizedSize];
  const numericSeed = (Math.abs(Math.trunc(Number(seed) || 1)) >>> 0) || 1;
  const nextRandom = seededRandom(numericSeed);
  const anchorCount = shape.anchors;
  const anchors = Array.from({ length: anchorCount }, (_, index) => {
    const angle = index * Math.PI * 2 / anchorCount;
    // Bounded radial noise keeps the shape organic while preserving a safe,
    // non-self-intersecting loop for every seed.
    const radialNoise = 0.88 + nextRandom() * 0.24;
    const harmonic = Math.sin(angle * 3 + numericSeed * 0.00001) * 0.07;
    return [Math.cos(angle) * shape.radiusX * (radialNoise + harmonic),
      Math.sin(angle) * shape.radiusY * (radialNoise + harmonic)];
  });
  const sampleCount = anchorCount * shape.samplesPerAnchor;
  const centerline = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const anchorIndex = Math.floor(index / shape.samplesPerAnchor);
    const segmentT = (index % shape.samplesPerAnchor) / shape.samplesPerAnchor;
    const point = (offset) => anchors[(anchorIndex + offset + anchorCount) % anchorCount];
    centerline.push(catmullRom(point(-1), point(0), point(1), point(2), segmentT));
  }
  const tangents = centerline.map((_, index) => normalize(
    centerline[(index + 1) % sampleCount][0] - centerline[(index - 1 + sampleCount) % sampleCount][0],
    centerline[(index + 1) % sampleCount][1] - centerline[(index - 1 + sampleCount) % sampleCount][1]));
  const widths = centerline.map(() => 10_000 + Math.trunc(nextRandom() * 2200));
  const rooms = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const next = (index + 1) % sampleCount;
    const tangent = tangents[index]; const nextTangent = tangents[next];
    const normal = [-tangent[1], tangent[0]]; const nextNormal = [-nextTangent[1], nextTangent[0]];
    const halfWidth = widths[index] / 2; const nextHalfWidth = widths[next] / 2;
    const leftStart = [centerline[index][0] - normal[0] * halfWidth, centerline[index][1] - normal[1] * halfWidth];
    const rightStart = [centerline[index][0] + normal[0] * halfWidth, centerline[index][1] + normal[1] * halfWidth];
    const rightEnd = [centerline[next][0] + nextNormal[0] * nextHalfWidth, centerline[next][1] + nextNormal[1] * nextHalfWidth];
    const leftEnd = [centerline[next][0] - nextNormal[0] * nextHalfWidth, centerline[next][1] - nextNormal[1] * nextHalfWidth];
    const floor = index % 13 === 5 ? 1000 : index % 17 === 9 ? -1000 : 0;
    rooms.push(roomFor(leftStart, rightStart, rightEnd, leftEnd, floor, widths[index]));
  }
  for (let index = 0; index < sampleCount; index += 1) {
    const next = (index + 1) % sampleCount;
    rooms[index].neighbors[2] = next;
    rooms[next].neighbors[0] = index;
  }

  const positionAt = (index, lateral = 0, forward = 0, zOffset = 0) => {
    const point = centerline[index]; const tangent = tangents[index];
    const normal = [-tangent[1], tangent[0]]; const room = rooms[index];
    return [point[0] + normal[0] * lateral + tangent[0] * forward,
      point[1] + normal[1] * lateral + tangent[1] * forward, room.floor + zOffset];
  };
  const starts = Array.from({ length: 10 }, (_, index) => ({
    team: index + 1, room: 0,
    position: positionAt(1, (index - 4.5) * 850, -1200, 0), orientation: angleFor(tangents[1]),
  }));
  const firstCheckpoint = Math.floor(sampleCount / 3);
  const secondCheckpoint = Math.floor(sampleCount * 2 / 3);
  const finishRoom = sampleCount - 1;
  const actors = [actor('checkpoint1', firstCheckpoint, positionAt(firstCheckpoint, 0, 0, 0), angleFor(tangents[firstCheckpoint])),
    actor('checkpoint2', secondCheckpoint, positionAt(secondCheckpoint, 0, 0, 0), angleFor(tangents[secondCheckpoint])),
    actor('finish', finishRoom, positionAt(finishRoom, 0, 0, 0), angleFor(tangents[finishRoom]))];
  for (let index = 4; index < sampleCount - 1; index += normalizedSize === 'large' ? 5 : 4) {
    const type = nextRandom() > 0.78 ? 'mine' : 'powerup';
    actors.push(actor(type, index, positionAt(index, (nextRandom() - 0.5) * 2600, 0, 1300), Math.trunc(nextRandom() * 4096)));
  }
  rooms[firstCheckpoint].floorSurface = copySurface(SURFACES.checkers);
  rooms[secondCheckpoint].floorSurface = copySurface(SURFACES.checkers);
  rooms[finishRoom].floorSurface = copySurface(SURFACES.checkers);
  rooms[finishRoom].wallSurfaces = Array.from({ length: 4 }, () => copySurface(SURFACES.checkers));
  return {
    format: 'HoverRace procedural track', source: `Procedural ${normalizedSize} seed ${numericSeed}`,
    title: `Procedural ${normalizedSize} circuit · Seed ${numericSeed}`, seed: numericSeed, size: normalizedSize,
    starts, rooms, features: [], actors,
  };
}
