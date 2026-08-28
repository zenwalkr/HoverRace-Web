const TRACK_SHAPES = {
  small: { anchors: 10, samplesPerAnchor: 3, radiusX: 45_000, radiusY: 34_000 },
  medium: { anchors: 12, samplesPerAnchor: 4, radiusX: 66_000, radiusY: 48_000 },
  large: { anchors: 16, samplesPerAnchor: 4, radiusX: 98_000, radiusY: 72_000 },
};

const SURFACES = {
  floor: { dllId: 1, classId: 51, resourceId: null, texture: 'metal_plate.png' },
  fuel: { dllId: 1, classId: 65, resourceId: 1065, texture: 'fuel_zone.png' },
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
  if (size === 'pipe-dream') return generatePipeDreamTrack(seed);
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

const PIPE_GRID_SIZE = 10;

function pipeKey(x, y) { return `${x},${y}`; }

function findPipeCycle(nextRandom) {
  // Start with a seed-sized perimeter, then grow randomized two-cell pipe
  // bends into unused squares. Replacing an edge A-B with A-C-D-B preserves
  // one continuous loop and gives every occupied square exactly two exits.
  const left = Math.floor(nextRandom() * 2);
  const right = PIPE_GRID_SIZE - 1 - Math.floor(nextRandom() * 2);
  const top = Math.floor(nextRandom() * 2);
  const bottom = PIPE_GRID_SIZE - 1 - Math.floor(nextRandom() * 2);
  const path = [];
  for (let x = left; x <= right; x += 1) path.push([x, top]);
  for (let y = top + 1; y <= bottom; y += 1) path.push([right, y]);
  for (let x = right - 1; x >= left; x -= 1) path.push([x, bottom]);
  for (let y = bottom - 1; y > top; y -= 1) path.push([left, y]);

  const targetLength = 64 + Math.floor(nextRandom() * 7) * 2;
  while (path.length < targetLength) {
    const occupied = new Set(path.map(([x, y]) => pipeKey(x, y)));
    const candidates = [];
    for (let index = 0; index < path.length; index += 1) {
      const first = path[index];
      const second = path[(index + 1) % path.length];
      const dx = second[0] - first[0];
      const dy = second[1] - first[1];
      for (const [sideX, sideY] of [[-dy, dx], [dy, -dx]]) {
        const bend = [first[0] + sideX, first[1] + sideY];
        const parallel = [second[0] + sideX, second[1] + sideY];
        const inGrid = (point) => point[0] >= 0 && point[0] < PIPE_GRID_SIZE &&
          point[1] >= 0 && point[1] < PIPE_GRID_SIZE;
        if (inGrid(bend) && inGrid(parallel) && !occupied.has(pipeKey(...bend)) &&
          !occupied.has(pipeKey(...parallel))) {
          candidates.push({ index, bend, parallel });
        }
      }
    }
    if (!candidates.length) break;
    const selected = candidates[Math.floor(nextRandom() * candidates.length)];
    path.splice(selected.index + 1, 0, selected.bend, selected.parallel);
  }

  // The construction normally reaches its target. This deterministic
  // rotation/mirror adds another eight orientations without changing the
  // generated topology.
  const rotation = Math.floor(nextRandom() * 4);
  const mirror = nextRandom() < 0.5;
  return path.map(([x, y]) => {
    let transformedX = mirror ? PIPE_GRID_SIZE - 1 - x : x;
    let transformedY = y;
    for (let turn = 0; turn < rotation; turn += 1) {
      [transformedX, transformedY] = [PIPE_GRID_SIZE - 1 - transformedY, transformedX];
    }
    return [transformedX, transformedY];
  });
}

function pipeDirectionName(dx, dy) {
  if (dx === 1) return 'E';
  if (dx === -1) return 'W';
  if (dy === 1) return 'S';
  return 'N';
}

function pipeCellDetails(path) {
  return path.map(([x, y], index) => {
    const previous = path[(index - 1 + path.length) % path.length];
    const next = path[(index + 1) % path.length];
    const first = [previous[0] - x, previous[1] - y];
    const second = [next[0] - x, next[1] - y];
    const straight = first[0] === -second[0] && first[1] === -second[1];
    const travel = [x - previous[0], y - previous[1]];
    const exit = [next[0] - x, next[1] - y];
    const cross = travel[0] * exit[1] - travel[1] * exit[0];
    return {
      x, y,
      piece: straight ? 'straight' : cross > 0 ? 'curve-left' : 'curve-right',
      connections: [pipeDirectionName(...first), pipeDirectionName(...second)].sort(),
    };
  });
}

export function generatePipeDreamTrack(seed = 1) {
  const numericSeed = (Math.abs(Math.trunc(Number(seed) || 1)) >>> 0) || 1;
  const nextRandom = seededRandom(numericSeed);
  const pipePath = findPipeCycle(nextRandom);
  const pipeCells = pipeCellDetails(pipePath);
  const spacing = 29_000;
  const tilePoints = pipePath.map(([x, y]) => [
    (x - (PIPE_GRID_SIZE - 1) / 2) * spacing + Math.trunc((nextRandom() - 0.5) * 4800),
    ((PIPE_GRID_SIZE - 1) / 2 - y) * spacing + Math.trunc((nextRandom() - 0.5) * 4800),
  ]);
  const samplesPerTile = 1;
  const sampleCount = tilePoints.length * samplesPerTile;
  const centerline = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const tileIndex = Math.floor(index / samplesPerTile);
    const segmentT = (index % samplesPerTile) / samplesPerTile;
    const point = (offset) => tilePoints[(tileIndex + offset + tilePoints.length) % tilePoints.length];
    centerline.push(catmullRom(point(-1), point(0), point(1), point(2), segmentT));
  }
  const tangents = centerline.map((_, index) => normalize(
    centerline[(index + 1) % sampleCount][0] - centerline[(index - 1 + sampleCount) % sampleCount][0],
    centerline[(index + 1) % sampleCount][1] - centerline[(index - 1 + sampleCount) % sampleCount][1]));
  const widths = centerline.map(() => 12_500 + Math.trunc(nextRandom() * 3200));
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
    rooms.push(roomFor(leftStart, rightStart, rightEnd, leftEnd, 0, widths[index]));
  }
  for (let index = 0; index < sampleCount; index += 1) {
    const next = (index + 1) % sampleCount;
    rooms[index].neighbors[2] = next;
    rooms[next].neighbors[0] = index;
  }

  const positionAt = (index, lateral = 0, forward = 0, zOffset = 0) => {
    const point = centerline[index]; const tangent = tangents[index];
    const normal = [-tangent[1], tangent[0]];
    return [point[0] + normal[0] * lateral + tangent[0] * forward,
      point[1] + normal[1] * lateral + tangent[1] * forward, rooms[index].floor + zOffset];
  };
  const starts = Array.from({ length: 10 }, (_, index) => ({
    team: index + 1, room: 0,
    position: positionAt(1, (index - 4.5) * 900, -1500), orientation: angleFor(tangents[1]),
  }));
  const firstCheckpoint = Math.floor(sampleCount / 3);
  const secondCheckpoint = Math.floor(sampleCount * 2 / 3);
  const finishRoom = sampleCount - 1;
  const fuelRooms = [...new Set([0.19, 0.51, 0.82].map((progress) =>
    Math.floor(sampleCount * progress)))];
  for (const roomIndex of fuelRooms) {
    rooms[roomIndex].floorSurface = copySurface(SURFACES.fuel);
    rooms[roomIndex].wallSurfaces = Array.from({ length: 4 }, () => copySurface(SURFACES.fuel));
  }
  const rocketRooms = [...new Set([0.28, 0.64, 0.9].map((progress) => Math.floor(sampleCount * progress)))];
  const actors = [
    actor('checkpoint1', firstCheckpoint, positionAt(firstCheckpoint), angleFor(tangents[firstCheckpoint])),
    actor('checkpoint2', secondCheckpoint, positionAt(secondCheckpoint), angleFor(tangents[secondCheckpoint])),
    actor('finish', finishRoom, positionAt(finishRoom), angleFor(tangents[finishRoom])),
    ...rocketRooms.map((roomIndex) => ({
      ...actor('powerup', roomIndex, positionAt(roomIndex, 0, 0, 1300), angleFor(tangents[roomIndex])),
      pickup: 'rocket',
    })),
    ...fuelRooms.map((roomIndex) => actor('fuel', roomIndex, positionAt(roomIndex), angleFor(tangents[roomIndex]))),
  ];
  rooms[firstCheckpoint].floorSurface = copySurface(SURFACES.checkers);
  rooms[secondCheckpoint].floorSurface = copySurface(SURFACES.checkers);
  rooms[finishRoom].floorSurface = copySurface(SURFACES.checkers);
  rooms[finishRoom].wallSurfaces = Array.from({ length: 4 }, () => copySurface(SURFACES.checkers));
  return {
    format: 'HoverRace procedural track', source: `Pipe Dream large seed ${numericSeed}`,
    title: `Pipe Dream · Seed ${numericSeed}`, seed: numericSeed, size: 'large', generator: 'pipe-dream',
    pipeGridSize: PIPE_GRID_SIZE,
    pipeLayout: { gridSize: PIPE_GRID_SIZE, cells: pipeCells },
    fuelRooms, rocketRooms, starts, rooms, features: [], actors,
  };
}
