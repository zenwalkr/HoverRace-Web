// Browser translation of engine/MainCharacter/MainCharacter.cpp.
// HoverRace stores position in millimetres, time in milliseconds, speed in
// millimetres per millisecond, and angles as 4096 units per revolution.
const TIME_SLICE_MS = 5;
const ANGLE_COUNT = 4096;
const PI_ANGLE = 2048;
const TRIG_FRACTION = 16384;
const CHARACTER_MOVEMENT_RADIUS = 1100;
// MainCharacter's receiving collision shape in the original engine.
const CHARACTER_COLLISION_RADIUS = 1300;
const CHARACTER_CONTACT_RADIUS = 1450;
const CHARACTER_HEIGHT = 1500;
const CHECKPOINT_RADIUS = 20000;
const CHECKPOINT_HEIGHT = 6000;
const FUEL_CAPACITY = 3 * 60 * 1000;
const POWERUP_DURATION = 5000;
const LOST_CONTROL_DURATION = 2000;
const MISSILE_SPEED = 21 * 2222 / 1000;
const MISSILE_RADIUS = 300;
const MISSILE_LIFE = 7500;
const MISSILE_STOP_TIME = 1200;
const MISSILE_IGNITION = 175;
const POWERUP_HALF_HEIGHT = 550;

const STEADY_SPEED = [8.7, 11.5, 10.5, 8.7, 8.7, 8.7, 8.7, 8.1]
  .map((value) => value * 2222 / 1000);
const MAX_Z_SPEED = [2900 / 1000, 2900 / 900, 2900 / 1000, 2900 / 1000,
  2900 / 1000, 2900 / 1000, 2900 / 1000, 2900 / 1000];
const ROTATION_SPEED = (PI_ANGLE / 1.4) / 1000;
const FRICTION_ACCELERATION = [1000, 1200, 900, 1000, 1000, 1000, 1000, 700]
  .map((duration) => -STEADY_SPEED[0] / 4 / duration);
const MOTOR_ACCELERATION = [
  STEADY_SPEED[0] / 1000,
  STEADY_SPEED[0] / 1400,
  STEADY_SPEED[2] / 1050,
  STEADY_SPEED[0] / 1000,
  STEADY_SPEED[0] / 1000,
  STEADY_SPEED[0] / 1000,
  STEADY_SPEED[0] / 1000,
  STEADY_SPEED[7] / 750,
];
const Z_ACCELERATION = [1000, 1000, 850, 1000, 1000, 1000, 1000, 1000]
  .map((duration, model) => -MAX_Z_SPEED[model] / duration);
const FUEL_CONSUMPTION = [1, 0.7, 2, 1, 1, 1, 1, 1.1];

const COS = new Int16Array(ANGLE_COUNT);
const SIN = new Int16Array(ANGLE_COUNT);
for (let angle = 0; angle < ANGLE_COUNT; angle += 1) {
  COS[angle] = Math.trunc(Math.cos(angle * Math.PI * 2 / ANGLE_COUNT) * TRIG_FRACTION);
  SIN[angle] = Math.trunc(Math.sin(angle * Math.PI * 2 / ANGLE_COUNT) * TRIG_FRACTION);
}

function normalizeAngle(angle) {
  return ((Math.trunc(angle) % ANGLE_COUNT) + ANGLE_COUNT) % ANGLE_COUNT;
}

function interpolateAngle(previous, current, alpha) {
  const delta = ((current - previous + PI_ANGLE) % ANGLE_COUNT + ANGLE_COUNT) % ANGLE_COUNT - PI_ANGLE;
  const angle = previous + delta * alpha;
  return ((angle % ANGLE_COUNT) + ANGLE_COUNT) % ANGLE_COUNT;
}

function radiansToAngle(radians) {
  return normalizeAngle(Math.trunc(radians * ANGLE_COUNT / (Math.PI * 2)));
}

function pointInPolygon(x, y, vertices) {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i, i += 1) {
    const [xi, yi] = vertices[i].point;
    const [xj, yj] = vertices[j].point;
    const intersects = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / (yj - yi || 1) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function squaredDistanceToSegment(x, y, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((x - ax) * dx + (y - ay) * dy) / lengthSquared));
  const offsetX = x - (ax + dx * amount);
  const offsetY = y - (ay + dy * amount);
  return offsetX * offsetX + offsetY * offsetY;
}

function segmentTouchesPoint(start, end, point, radius) {
  return squaredDistanceToSegment(point[0], point[1], start[0], start[1], end[0], end[1]) <= radius * radius;
}

function circleTouchesPolygon(x, y, radius, section) {
  if (pointInPolygon(x, y, section.vertices)) return true;
  const radiusSquared = radius * radius;
  for (let i = 0; i < section.vertices.length; i += 1) {
    const [ax, ay] = section.vertices[i].point;
    const [bx, by] = section.vertices[(i + 1) % section.vertices.length].point;
    if (squaredDistanceToSegment(x, y, ax, ay, bx, by) <= radiusSquared) return true;
  }
  return false;
}

function sectionCentroid(section) {
  const sum = section.vertices.reduce((value, vertex) => {
    value[0] += vertex.point[0];
    value[1] += vertex.point[1];
    return value;
  }, [0, 0]);
  return [sum[0] / section.vertices.length, sum[1] / section.vertices.length];
}

function edgeInwardNormal(section, edgeIndex) {
  const [ax, ay] = section.vertices[edgeIndex].point;
  const [bx, by] = section.vertices[(edgeIndex + 1) % section.vertices.length].point;
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy) || 1;
  let nx = -dy / length;
  let ny = dx / length;
  const [cx, cy] = sectionCentroid(section);
  if ((cx - (ax + bx) / 2) * nx + (cy - (ay + by) / 2) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  return [nx, ny];
}

function nearestEdge(section, x, y) {
  let answer = 0;
  let nearest = Infinity;
  for (let i = 0; i < section.vertices.length; i += 1) {
    const [ax, ay] = section.vertices[i].point;
    const [bx, by] = section.vertices[(i + 1) % section.vertices.length].point;
    const distance = squaredDistanceToSegment(x, y, ax, ay, bx, by);
    if (distance < nearest) {
      nearest = distance;
      answer = i;
    }
  }
  return answer;
}

function stateCrossesDown(previous, next, level) {
  return previous >= level && next <= level;
}

function stateCrossesUp(previous, next, level) {
  return previous <= level && next >= level;
}

function pickupCollisionZ(track, actor) {
  const floor = track.rooms?.[actor.classifiedRoom]?.floor;
  if (!Number.isFinite(floor)) return actor.position[2];
  if (actor.type === 'powerup') return Math.max(actor.position[2], floor + POWERUP_HALF_HEIGHT);
  if (actor.type === 'fuel') return Math.max(actor.position[2], floor);
  return actor.position[2];
}

export const CRAFT_MODEL_BY_ASSET = Object.freeze({
  basic_craft: 0,
  cx_craft: 1,
  bi_craft: 2,
  eon_craft: 3,
});

export class RaceSimulation {
  constructor(track, model = 0, { countdownMs = 0 } = {}) {
    this.track = track;
    this.model = Math.max(0, Math.min(7, model));
    const start = track.starts[0] ?? { room: 0, position: [0, 0, 0], orientation: 0 };
    this.state = {
      position: [...start.position],
      orientation: normalizeAngle(start.orientation),
      cabinOrientation: normalizeAngle(start.orientation),
      room: start.room,
      velocity: [0, 0, 0],
      speed: 0,
      directionalSpeed: 0,
      motorOn: false,
      fuel: 1,
      onFloor: false,
      lap: 1,
      completedLaps: 0,
      lastLapTime: 0,
      checkpoint: 0,
      finished: false,
      raceTime: 0,
      countdown: Math.max(0, countdownMs),
      collisionCount: 0,
      actorFrames: [],
      actorVisible: (track.actors ?? []).map(() => true),
      projectiles: [],
      weapon: 'missile',
      mineCount: 0,
      powerupCount: 0,
      powerup: 0,
      outOfControl: 0,
      pickups: 0,
      weaponFires: 0,
      missileBounces: 0,
    };
    this.fuelLevel = FUEL_CAPACITY;
    this.accumulatorMs = 0;
    this.lastTime = null;
    this.lastStepCount = 0;
    this.previousRenderPosition = [...this.state.position];
    this.previousRenderOrientation = this.state.orientation;
    this.previousRenderCabinOrientation = this.state.cabinOrientation;
    this.renderPosition = [...this.state.position];
    this.interpolated = { ...this.state, position: this.renderPosition };
    this.jumpWasPressed = false;
    this.weaponWasPressed = false;
    this.changeItemWasPressed = false;
    this.boostWasPressed = false;
    this.missileCooldown = 0;
    this.nextProjectileId = 1;
    this.remotePlayers = [];
    this.remoteHits = new Set();
    this.liveRemoteHazards = new Set();
    this.remoteProjectilePositions = new Map();
    this.remoteProjectileSegments = new Map();
    this.translation = [0, 0, 0];
    this.moveCandidate = [0, 0, 0];
    this.projectileCandidate = [0, 0, 0];
    this.checkpoint1 = false;
    this.checkpoint2 = false;
    this.lastLapCompletion = 0;
    this.bumperStates = new Map();
    for (const [index, actor] of (track.actors ?? []).entries()) {
      if (actor.type === 'bumperGate') {
        this.bumperStates.set(index, { timeSinceCollision: 1_000_000, frame: 9 });
        this.state.actorFrames[index] = 9;
      }
    }
  }

  resetClock(time) {
    this.lastTime = time;
  }

  snapInterpolation() {
    this.previousRenderPosition[0] = this.state.position[0];
    this.previousRenderPosition[1] = this.state.position[1];
    this.previousRenderPosition[2] = this.state.position[2];
    this.previousRenderOrientation = this.state.orientation;
    this.previousRenderCabinOrientation = this.state.cabinOrientation;
    this.accumulatorMs = 0;
  }

  captureRenderTransform() {
    this.previousRenderPosition[0] = this.state.position[0];
    this.previousRenderPosition[1] = this.state.position[1];
    this.previousRenderPosition[2] = this.state.position[2];
    this.previousRenderOrientation = this.state.orientation;
    this.previousRenderCabinOrientation = this.state.cabinOrientation;
  }

  interpolatedState() {
    const alpha = Math.max(0, Math.min(1, this.accumulatorMs / TIME_SLICE_MS));
    const state = this.state;
    const render = this.interpolated;
    Object.assign(render, state);
    render.position = this.renderPosition;
    for (let axis = 0; axis < 3; axis += 1) {
      this.renderPosition[axis] = this.previousRenderPosition[axis] +
        (state.position[axis] - this.previousRenderPosition[axis]) * alpha;
    }
    render.orientation = interpolateAngle(this.previousRenderOrientation, state.orientation, alpha);
    render.cabinOrientation = interpolateAngle(
      this.previousRenderCabinOrientation, state.cabinOrientation, alpha);
    return render;
  }

  tick(time, input) {
    if (this.lastTime == null) this.lastTime = time;
    const deltaMs = Math.min(100, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    this.accumulatorMs += deltaMs;
    this.lastStepCount = 0;

    const controlsEnabled = this.state.countdown <= 0;
    if (controlsEnabled && input.jump && !this.jumpWasPressed && this.state.onFloor) {
      this.state.velocity[2] = 1.1 * MAX_Z_SPEED[this.model];
      this.state.onFloor = false;
    }
    this.jumpWasPressed = Boolean(input.jump);

    if (controlsEnabled && input.changeItem && !this.changeItemWasPressed) this.changeWeapon();
    this.changeItemWasPressed = Boolean(input.changeItem);
    if (controlsEnabled && input.boost && !this.boostWasPressed) this.activatePowerup();
    this.boostWasPressed = controlsEnabled && Boolean(input.boost);
    if (controlsEnabled && input.weapon && !this.weaponWasPressed) this.fireWeapon();
    this.weaponWasPressed = Boolean(input.weapon);

    while (this.accumulatorMs >= TIME_SLICE_MS) {
      this.captureRenderTransform();
      this.step(TIME_SLICE_MS, controlsEnabled ? input : {});
      this.accumulatorMs -= TIME_SLICE_MS;
      this.lastStepCount += 1;
    }
    return this.state;
  }

  step(durationMs, input) {
    const state = this.state;
    const countdownBefore = state.countdown;
    if (countdownBefore > 0) {
      state.countdown = Math.max(0, countdownBefore - durationMs);
      input = {};
    }
    const velocity = state.velocity;
    const absoluteSpeed = Math.hypot(velocity[0], velocity[1]);

    if (input.brake) {
      if (absoluteSpeed > STEADY_SPEED[this.model] / 20) {
        state.cabinOrientation = normalizeAngle(
          radiansToAngle(Math.atan2(velocity[1], velocity[0])) + PI_ANGLE);
      }
    } else {
      state.cabinOrientation = state.orientation;
    }

    if (state.outOfControl > 0) {
      state.orientation = normalizeAngle(state.orientation +
        Math.trunc(durationMs * 8 * ROTATION_SPEED));
      state.cabinOrientation = state.orientation;
    } else if (absoluteSpeed <= -durationMs * FRICTION_ACCELERATION[this.model]) {
      velocity[0] = 0;
      velocity[1] = 0;
    } else if (absoluteSpeed > 0) {
      let amplifier = 1;
      if (absoluteSpeed < STEADY_SPEED[this.model] / 3) amplifier = 0.4;
      else if (absoluteSpeed > STEADY_SPEED[this.model] && absoluteSpeed < 2.5 * STEADY_SPEED[this.model]) {
        amplifier = Math.min(1.7, 1.1 + 2.5 * (absoluteSpeed / STEADY_SPEED[0] - 1));
      }
      const constantPart = durationMs * amplifier * FRICTION_ACCELERATION[this.model] / absoluteSpeed;
      velocity[0] += constantPart * velocity[0];
      velocity[1] += constantPart * velocity[1];
    }

    velocity[2] += durationMs * Z_ACCELERATION[this.model];
    velocity[2] = Math.max(-MAX_Z_SPEED[this.model], velocity[2]);

    if (state.outOfControl <= 0 && Boolean(input.right) !== Boolean(input.left)) {
      let rotation = (input.right ? -1 : 1) * durationMs * ROTATION_SPEED;
      if (input.slowRotation) rotation /= 4;
      state.orientation = normalizeAngle(state.orientation + Math.trunc(rotation));
      if (!input.brake) state.cabinOrientation = state.orientation;
    }

    state.motorOn = Boolean(input.throttle && this.fuelLevel > 0);
    if (state.motorOn) {
      const angle = state.cabinOrientation;
      const directionalSpeed = (velocity[0] * COS[angle] + velocity[1] * SIN[angle]) / TRIG_FRACTION;
      const maxSpeedFactor = state.powerup > 0 ? 1.9 : 1.3;
      if (directionalSpeed < maxSpeedFactor * STEADY_SPEED[this.model]) {
        let accelerationFactor = 1 - directionalSpeed /
          (maxSpeedFactor * 1.25 * STEADY_SPEED[this.model]);
        accelerationFactor = Math.max(0, Math.min(0.8, accelerationFactor));
        accelerationFactor *= state.powerup > 0 ? 3.2 : 1.8;
        velocity[0] += durationMs * accelerationFactor * MOTOR_ACCELERATION[this.model] * COS[angle] / TRIG_FRACTION;
        velocity[1] += durationMs * accelerationFactor * MOTOR_ACCELERATION[this.model] * SIN[angle] / TRIG_FRACTION;
      }
      this.fuelLevel -= durationMs * FUEL_CONSUMPTION[this.model];
    }

    const translation = this.translation;
    translation[0] = Math.trunc(velocity[0] * durationMs);
    translation[1] = Math.trunc(velocity[1] * durationMs);
    translation[2] = Math.trunc(velocity[2] * durationMs);
    if (translation[2] === 0) translation[2] = -1;
    this.move(translation);
    this.updateBumperGates(durationMs);
    this.updateActorContacts(durationMs);
    this.updateProjectiles(durationMs);
    this.updateRemoteContacts();

    state.powerup = Math.max(0,
      state.powerup - durationMs * FUEL_CONSUMPTION[this.model]);
    state.outOfControl = Math.max(0, state.outOfControl - durationMs);
    this.missileCooldown = Math.max(0, this.missileCooldown - durationMs);

    const finalSpeed = Math.hypot(velocity[0], velocity[1]);
    state.speed = finalSpeed;
    state.directionalSpeed = (velocity[0] * COS[state.cabinOrientation] +
      velocity[1] * SIN[state.cabinOrientation]) / TRIG_FRACTION;
    state.fuel = Math.max(0, this.fuelLevel / FUEL_CAPACITY);
    state.raceTime += Math.max(0, durationMs - countdownBefore) / 1000;
  }

  move(translation) {
    const state = this.state;
    const current = state.position;
    const candidate = this.moveCandidate;
    candidate[0] = current[0] + translation[0];
    candidate[1] = current[1] + translation[1];
    candidate[2] = current[2] + translation[2];
    const nextRoom = this.findRoom(candidate[0], candidate[1], state.room);

    if (nextRoom < 0) {
      this.collideWithNearestRoomWall(state.room, candidate[0], candidate[1]);
      return;
    }

    const currentRoom = this.track.rooms[state.room];
    const nextRoomData = this.track.rooms[nextRoom];
    const crossedRoomPortal = currentRoom?.neighbors?.includes(nextRoom);
    const descending = state.velocity[2] <= 0;
    const landedOnCurrentFloor = !crossedRoomPortal && descending &&
      current[2] >= currentRoom.floor && candidate[2] < currentRoom.floor;
    if (landedOnCurrentFloor) {
      candidate[2] = currentRoom.floor;
      state.velocity[2] = 0;
    }
    // Resolve a downward crossing at the portal before the portal wall test.
    // Otherwise a floor-height mismatch is reported as a vertical wall and
    // the craft reflects at the edge forever instead of landing.
    if (crossedRoomPortal && descending && current[2] >= nextRoomData.floor &&
        candidate[2] < nextRoomData.floor) {
      candidate[2] = nextRoomData.floor;
      state.velocity[2] = 0;
    }

    const wall = this.blockingWall(nextRoom, candidate[0], candidate[1], candidate[2], state.velocity);
    const feature = this.blockingFeature(nextRoom, candidate, current);
    if (wall != null || feature != null) {
      if (wall != null) {
        const wallRoom = this.track.rooms[nextRoom];
        const wallNeighbor = this.track.rooms[wallRoom.neighbors[wall]];
        const isFloorTransition = wallNeighbor && wallNeighbor.floor !== wallRoom.floor;
        // A ledge blocks horizontal travel, but it must not freeze vertical
        // motion. Preserve the craft at the edge while it falls to the
        // current floor or rises high enough to clear the step and jump over
        // it. Without this, landing at a raised platform can pin the craft
        // forever with a non-zero vertical velocity.
        if (isFloorTransition && state.velocity[2] !== 0) {
          const supportRoom = this.track.rooms[state.room];
          current[2] = Math.max(supportRoom.floor,
            Math.min(candidate[2], supportRoom.ceiling - CHARACTER_HEIGHT));
          state.onFloor = current[2] <= supportRoom.floor;
          if (state.onFloor) state.velocity[2] = 0;
          return;
        }
      }
      if (wall != null) this.reflectFromEdge(this.track.rooms[nextRoom], wall, false);
      else this.reflectFromEdge(feature.section, feature.edge, true);
      state.collisionCount += 1;
      return;
    }

    const room = this.track.rooms[nextRoom];
    state.onFloor = false;
    if (candidate[2] <= room.floor) {
      candidate[2] = room.floor;
      state.velocity[2] = 0;
      state.onFloor = true;
    }
    if (candidate[2] + CHARACTER_HEIGHT > room.ceiling) {
      candidate[2] = room.ceiling - CHARACTER_HEIGHT;
      state.velocity[2] = Math.min(0, state.velocity[2]);
    }

    current[0] = candidate[0];
    current[1] = candidate[1];
    current[2] = candidate[2];
    state.room = nextRoom;
  }

  updateActorContacts(durationMs = TIME_SLICE_MS) {
    const state = this.state;
    const currentRoom = this.track.rooms?.[state.room];
    for (const [index, actor] of (this.track.actors ?? []).entries()) {
      const actorRoomIsReachable = actor.classifiedRoom === state.room ||
        currentRoom?.neighbors?.includes(actor.classifiedRoom);
      if (!actorRoomIsReachable || state.actorVisible[index] === false) continue;
      const dx = state.position[0] - actor.position[0];
      const dy = state.position[1] - actor.position[1];
      let radius = CHECKPOINT_RADIUS;
      let height = CHECKPOINT_HEIGHT;
      if (actor.type === 'powerup') { radius = 550; height = 1100; }
      else if (actor.type === 'mine') { radius = 400; height = 140; }
      else if (actor.type === 'fuel') { radius = 20000; height = 3000; }
      else if (actor.type === 'speedDoubler') { radius = 20000; height = 2000; }
      else if (!actor.type?.startsWith('checkpoint') && actor.type !== 'finish') continue;
      if (dx * dx + dy * dy > (radius + CHARACTER_CONTACT_RADIUS) ** 2) continue;
      const actorZ = pickupCollisionZ(this.track, actor);
      const actorBottom = actor.type === 'powerup' ? actorZ - height / 2 : actorZ;
      const actorTop = actorBottom + height;
      if (Math.max(state.position[2], actorBottom) >=
          Math.min(state.position[2] + CHARACTER_HEIGHT, actorTop)) continue;

      if (actor.type === 'fuel') {
        this.fuelLevel = Math.min(FUEL_CAPACITY, this.fuelLevel + durationMs * 20);
      } else if (actor.type === 'speedDoubler') {
        const boost = 4 * STEADY_SPEED[0];
        state.velocity[0] = boost * COS[state.cabinOrientation] / TRIG_FRACTION;
        state.velocity[1] = boost * SIN[state.cabinOrientation] / TRIG_FRACTION;
      } else if (actor.type === 'powerup') {
        if (state.powerup <= 0 && state.powerupCount < 4) {
          state.powerupCount += 1;
          state.pickups += 1;
          state.actorVisible[index] = false;
        }
      } else if (actor.type === 'mine') {
        if (state.mineCount < 2) {
          state.mineCount += 1;
          state.pickups += 1;
          state.actorVisible[index] = false;
        }
        state.outOfControl = LOST_CONTROL_DURATION;
        state.velocity[2] = 1.1 * MAX_Z_SPEED[0];
      } else if (state.finished) {
        continue;
      } else if (actor.type === 'checkpoint1' && !this.checkpoint1 && !this.checkpoint2) {
        this.checkpoint1 = true;
        state.checkpoint = 1;
      } else if (actor.type === 'checkpoint2' && this.checkpoint1 && !this.checkpoint2) {
        this.checkpoint2 = true;
        state.checkpoint = 2;
      } else if (actor.type === 'finish' && this.checkpoint2) {
        this.checkpoint1 = false;
        this.checkpoint2 = false;
        state.checkpoint = 0;
        state.completedLaps += 1;
        state.lastLapTime = state.raceTime - this.lastLapCompletion;
        this.lastLapCompletion = state.raceTime;
        if (state.completedLaps >= 3) {
          state.lap = 3;
          state.finished = true;
        } else {
          state.lap = state.completedLaps + 1;
        }
      }
    }
  }

  changeWeapon() {
    const order = ['missile', 'mine', 'powerup'];
    const current = order.indexOf(this.state.weapon);
    for (let offset = 1; offset <= order.length; offset += 1) {
      const weapon = order[(current + offset) % order.length];
      if (weapon === 'missile' || (weapon === 'mine' && this.state.mineCount > 0) ||
          (weapon === 'powerup' && this.state.powerupCount > 0)) {
        this.state.weapon = weapon;
        return;
      }
    }
  }

  fireWeapon() {
    const state = this.state;
    if (state.weapon === 'powerup') {
      return this.activatePowerup();
    }
    if (state.weapon === 'mine') {
      if (state.mineCount <= 0) return false;
      state.mineCount -= 1;
      state.projectiles.push({
        id: this.nextProjectileId++, kind: 'mine',
        position: [state.position[0], state.position[1], state.position[2] + 800],
        orientation: state.orientation, room: state.room, age: 0, velocityZ: 0,
        active: true, exploded: false,
      });
      state.weaponFires += 1;
      if (state.mineCount === 0) state.weapon = 'missile';
      return true;
    }
    if (this.missileCooldown > 0) return false;
    const angle = state.cabinOrientation;
    state.projectiles.push({
      id: this.nextProjectileId++, kind: 'missile',
      position: [state.position[0], state.position[1], state.position[2] + 1100],
      orientation: angle, room: state.room, age: 0, active: true, exploded: false,
    });
    state.weaponFires += 1;
    this.missileCooldown = 10000;
    return true;
  }

  activatePowerup() {
    const state = this.state;
    if (state.powerupCount <= 0 || state.powerup > 0) return false;
    state.powerupCount -= 1;
    state.powerup = POWERUP_DURATION;
    state.projectiles.push({
      id: this.nextProjectileId++, kind: 'powerup',
      position: [state.position[0], state.position[1], state.position[2] + 1200],
      orientation: state.orientation, room: state.room, age: 0,
      active: true, exploded: false,
    });
    state.weaponFires += 1;
    if (state.weapon === 'powerup' && state.powerupCount === 0) state.weapon = 'missile';
    return true;
  }

  setRemotePlayers(players) {
    const nextProjectilePositions = new Map();
    const projectileSegments = new Map();
    for (const player of players) {
      for (const projectile of player.state?.projectiles ?? []) {
        const key = `${player.id}:${projectile.id}`;
        const position = [...projectile.position];
        const previous = this.remoteProjectilePositions.get(key);
        if (previous && projectile.age >= previous.age) {
          projectileSegments.set(key, { from: previous.position, to: position });
        }
        nextProjectilePositions.set(key, { age: projectile.age, position });
      }
    }
    this.remoteProjectilePositions = nextProjectilePositions;
    this.remoteProjectileSegments = projectileSegments;
    this.remotePlayers = players;
    for (const player of players) {
      const remote = player.state;
      if (!remote) continue;

      for (const [index, visible] of (remote.actorVisible ?? []).entries()) {
        if (visible === false && index < this.state.actorVisible.length) {
          this.state.actorVisible[index] = false;
        }
      }

      for (const [index, frameValue] of (remote.actorFrames ?? []).entries()) {
        const bumper = this.bumperStates.get(index);
        if (!bumper || !Number.isFinite(frameValue)) continue;
        const frame = Math.max(0, Math.min(9, Math.trunc(frameValue)));
        if (frame >= bumper.frame) continue;
        bumper.frame = frame;
        bumper.timeSinceCollision = 1500 - 1500 * frame / 9;
        this.state.actorFrames[index] = frame;
      }
    }
  }

  updateProjectiles(durationMs) {
    if (this.state.projectiles.length === 0) return;
    const state = this.state;
    for (const projectile of this.state.projectiles) {
      projectile.age += durationMs;
      if (projectile.kind === 'mine') {
        if (!projectile.onFloor) {
          projectile.position[2] -= Math.trunc(durationMs * 0.6);
          const room = this.track.rooms[projectile.room];
          if (projectile.position[2] <= room.floor) {
            projectile.position[2] = room.floor;
            projectile.onFloor = true;
          }
        }
        if (projectile.onFloor && projectile.age > 500 &&
            projectile.room === this.state.room && this.projectileTouchesPlayer(projectile, 400, 140, true)) {
          this.state.outOfControl = LOST_CONTROL_DURATION;
          this.state.velocity[2] = 1.1 * MAX_Z_SPEED[0];
          if (this.state.mineCount < 2) {
            this.state.mineCount += 1;
            this.state.pickups += 1;
          }
          projectile.active = false;
        }
        continue;
      }

      if (projectile.kind === 'powerup') {
        projectile.orientation = normalizeAngle(projectile.orientation + durationMs);
        if (this.state.powerup <= 0 && projectile.age > 500 &&
            projectile.room === this.state.room && this.projectileTouchesPlayer(projectile, 550, 550)) {
          if (this.state.powerupCount < 4) {
            this.state.powerupCount += 1;
            this.state.pickups += 1;
            projectile.active = false;
          }
        }
        continue;
      }

      if (projectile.age >= MISSILE_LIFE) {
        projectile.exploded = true;
        projectile.active = projectile.age < MISSILE_LIFE + MISSILE_STOP_TIME;
        continue;
      }
      const previousPosition = [...projectile.position];
      const angle = projectile.orientation;
      const candidate = this.projectileCandidate;
      candidate[0] = projectile.position[0] +
        Math.trunc(MISSILE_SPEED * durationMs * COS[angle] / TRIG_FRACTION);
      candidate[1] = projectile.position[1] +
        Math.trunc(MISSILE_SPEED * durationMs * SIN[angle] / TRIG_FRACTION);
      candidate[2] = projectile.position[2];
      const nextRoom = this.findRoom(candidate[0], candidate[1], projectile.room);
      if (nextRoom < 0 || this.blockingMissileWall(nextRoom, candidate)) {
        const room = this.track.rooms[projectile.room];
        const edge = nearestEdge(room, candidate[0], candidate[1]);
        const [nx, ny] = edgeInwardNormal(room, edge);
        const vx = COS[angle] / TRIG_FRACTION;
        const vy = SIN[angle] / TRIG_FRACTION;
        const dot = vx * nx + vy * ny;
        projectile.orientation = radiansToAngle(Math.atan2(vy - 2 * dot * ny, vx - 2 * dot * nx));
        this.state.missileBounces += 1;
      } else {
        projectile.position[0] = candidate[0];
        projectile.position[1] = candidate[1];
        projectile.position[2] = candidate[2];
        projectile.room = nextRoom;
      }

      if (projectile.age >= MISSILE_IGNITION) {
        if (projectile.room === state.room &&
            this.segmentTouchesPlayer(previousPosition, projectile.position, state.position,
              MISSILE_RADIUS + CHARACTER_COLLISION_RADIUS, MISSILE_RADIUS)) {
          state.outOfControl = LOST_CONTROL_DURATION;
          projectile.age = MISSILE_LIFE;
          projectile.exploded = true;
          continue;
        }
        for (const [index, actor] of (this.track.actors ?? []).entries()) {
          if (this.state.actorVisible[index] === false || actor.classifiedRoom !== projectile.room) continue;
          if (actor.type !== 'mine' && actor.type !== 'bumperGate') continue;
          const dx = projectile.position[0] - actor.position[0];
          const dy = projectile.position[1] - actor.position[1];
          if (dx * dx + dy * dy <= (MISSILE_RADIUS + 2500) ** 2) {
            projectile.age = MISSILE_LIFE;
            projectile.exploded = true;
            break;
          }
        }
        for (const player of this.remotePlayers) {
          if (!player.state || player.state.room !== projectile.room) continue;
          if (this.segmentTouchesPlayer(previousPosition, projectile.position, player.state.position,
              MISSILE_RADIUS + CHARACTER_COLLISION_RADIUS, MISSILE_RADIUS)) {
            projectile.age = MISSILE_LIFE;
            projectile.exploded = true;
            break;
          }
        }
      }
    }
    let liveCount = 0;
    for (const projectile of this.state.projectiles) {
      if (projectile.active) this.state.projectiles[liveCount++] = projectile;
    }
    this.state.projectiles.length = liveCount;
  }

  blockingMissileWall(roomIndex, position) {
    const room = this.track.rooms[roomIndex];
    if (position[2] - MISSILE_RADIUS < room.floor ||
        position[2] + MISSILE_RADIUS > room.ceiling) return true;
    return this.blockingWall(roomIndex, position[0], position[1], position[2]) != null;
  }

  projectileTouchesPlayer(projectile, radius, height, bottomAnchored = false) {
    const dx = this.state.position[0] - projectile.position[0];
    const dy = this.state.position[1] - projectile.position[1];
    if (dx * dx + dy * dy > (radius + CHARACTER_CONTACT_RADIUS) ** 2) return false;
    const bottom = bottomAnchored ? projectile.position[2] : projectile.position[2] - height;
    const top = bottomAnchored ? projectile.position[2] + height : projectile.position[2] + height;
    return Math.max(this.state.position[2], bottom) <
      Math.min(this.state.position[2] + CHARACTER_HEIGHT, top);
  }

  segmentTouchesPlayer(start, end, characterPosition, radius, halfHeight, zOffset = 0) {
    if (!segmentTouchesPoint(start, end, characterPosition, radius)) return false;
    const pointBottom = Math.min(start[2], end[2]) + zOffset - halfHeight;
    const pointTop = Math.max(start[2], end[2]) + zOffset + halfHeight;
    return Math.max(characterPosition[2], pointBottom) <
      Math.min(characterPosition[2] + CHARACTER_HEIGHT, pointTop);
  }

  shapeTouchesPoint(characterPosition, point, radius, halfHeight, zOffset = 0) {
    const dx = characterPosition[0] - point[0];
    const dy = characterPosition[1] - point[1];
    if (dx * dx + dy * dy > radius ** 2) return false;
    const pointZ = point[2] + zOffset;
    return Math.max(characterPosition[2], pointZ - halfHeight) <
      Math.min(characterPosition[2] + CHARACTER_HEIGHT, pointZ + halfHeight);
  }

  updateRemoteContacts() {
    if (this.remotePlayers.length === 0) {
      this.remoteHits.clear();
      return;
    }
    const state = this.state;
    const liveHazards = this.liveRemoteHazards;
    liveHazards.clear();
    for (const player of this.remotePlayers) {
      const remote = player.state;
      if (!remote || remote.room !== state.room) continue;
      const dx = state.position[0] - remote.position[0];
      const dy = state.position[1] - remote.position[1];
      const distance = Math.hypot(dx, dy);
      if (distance > 0 && distance < CHARACTER_CONTACT_RADIUS * 2 &&
          Math.max(state.position[2], remote.position[2]) <
            Math.min(state.position[2] + CHARACTER_HEIGHT, remote.position[2] + CHARACTER_HEIGHT)) {
        const nx = dx / distance;
        const ny = dy / distance;
        const relativeNormal = (state.velocity[0] - remote.velocity[0]) * nx +
          (state.velocity[1] - remote.velocity[1]) * ny;
        if (relativeNormal < 0) {
          state.velocity[0] -= relativeNormal * nx;
          state.velocity[1] -= relativeNormal * ny;
          state.collisionCount += 1;
        }
      }

      for (const projectile of remote.projectiles ?? []) {
        const key = `${player.id}:${projectile.id}`;
        liveHazards.add(key);
        if (this.remoteHits.has(key) || projectile.room !== state.room) continue;
        let hit = false;
        if (projectile.kind === 'missile' && projectile.age >= MISSILE_IGNITION &&
            projectile.age < MISSILE_LIFE + MISSILE_STOP_TIME) {
          const segment = this.remoteProjectileSegments.get(key);
          hit = this.segmentTouchesPlayer(segment?.from ?? projectile.position,
            segment?.to ?? projectile.position, state.position,
            MISSILE_RADIUS + CHARACTER_COLLISION_RADIUS, MISSILE_RADIUS);
        } else if (projectile.kind === 'mine' && projectile.age > 500) {
          hit = this.shapeTouchesPoint(state.position, projectile.position,
            400 + CHARACTER_CONTACT_RADIUS, 70, 70);
        }
        if (hit) {
          this.remoteHits.add(key);
          state.outOfControl = LOST_CONTROL_DURATION;
          if (projectile.kind === 'mine') state.velocity[2] = 1.1 * MAX_Z_SPEED[0];
        }
      }
    }
    this.remoteProjectileSegments.clear();
    for (const key of this.remoteHits) if (!liveHazards.has(key)) this.remoteHits.delete(key);
  }

  updateBumperGates(durationMs) {
    for (const [index, bumper] of this.bumperStates) {
      const actor = this.track.actors[index];
      bumper.timeSinceCollision += durationMs;
      if (bumper.timeSinceCollision < 1500) {
        bumper.frame = Math.trunc((1500 - bumper.timeSinceCollision) * 9 / 1500);
      } else if (bumper.timeSinceCollision < 9000) {
        bumper.frame = 0;
      } else if (bumper.timeSinceCollision < 13000) {
        bumper.frame = Math.trunc((bumper.timeSinceCollision - 9000) * 9 / 4000);
      } else {
        bumper.frame = 9;
      }
      this.state.actorFrames[index] = bumper.frame;

      if (actor.classifiedRoom !== this.state.room) continue;
      const radius = 200 + bumper.frame * (2500 - 200) / 9;
      const height = 1500 + bumper.frame * (3000 - 1500) / 9;
      const dx = this.state.position[0] - actor.position[0];
      const dy = this.state.position[1] - actor.position[1];
      const distance = Math.hypot(dx, dy);
      if (distance >= radius + CHARACTER_CONTACT_RADIUS || distance === 0) continue;
      if (Math.max(this.state.position[2], actor.position[2] + 2) >=
          Math.min(this.state.position[2] + CHARACTER_HEIGHT, actor.position[2] + height)) continue;

      const nx = dx / distance;
      const ny = dy / distance;
      const normalSpeed = this.state.velocity[0] * nx + this.state.velocity[1] * ny;
      if (normalSpeed < 0) {
        this.state.velocity[0] -= 2 * normalSpeed * nx;
        this.state.velocity[1] -= 2 * normalSpeed * ny;
        this.state.collisionCount += 1;
        bumper.timeSinceCollision = bumper.frame >= 9 ? 0 : 1500 - 1500 * bumper.frame / 9;
      }
    }
  }

  blockingWall(roomIndex, x, y, z, movement = null) {
    const room = this.track.rooms[roomIndex];
    for (let edge = 0; edge < room.vertices.length; edge += 1) {
      const [ax, ay] = room.vertices[edge].point;
      const [bx, by] = room.vertices[(edge + 1) % room.vertices.length].point;
      if (squaredDistanceToSegment(x, y, ax, ay, bx, by) >
          CHARACTER_MOVEMENT_RADIUS ** 2) continue;
      const neighborIndex = room.neighbors[edge];
      if (neighborIndex == null || neighborIndex < 0) {
        // The craft can remain within its movement radius after a collision.
        // Do not reject a candidate that is moving away from (or tangent to)
        // the wall, otherwise a sharp corner can pin it indefinitely.
        if (movement) {
          const [nx, ny] = edgeInwardNormal(room, edge);
          if (movement[0] * nx + movement[1] * ny >= 0) continue;
        }
        return edge;
      }
      const neighbor = this.track.rooms[neighborIndex];
      const floorTransition = neighbor.floor !== room.floor;
      const movementX = x - this.state.position[0];
      const movementY = y - this.state.position[1];
      const [inwardX, inwardY] = edgeInwardNormal(room, edge);
      const movingAwayFromEdge = movementX * inwardX + movementY * inwardY >= 0;
      // A craft can land on the current floor while its movement radius is
      // touching a higher neighboring floor. That neighboring ledge must not
      // turn the landing into a wall collision while the center remains in
      // the current room.
      if (floorTransition && roomIndex === this.state.room &&
          this.state.velocity[2] <= 0 && movingAwayFromEdge) {
        if (z + CHARACTER_HEIGHT > neighbor.ceiling) return edge;
        continue;
      }
      // When moving down through a portal, the neighboring room's floor is
      // allowed to differ. The landing/ledge transition is resolved in move().
      if (floorTransition && neighborIndex === this.state.room &&
          this.state.velocity[2] <= 0 && this.state.position[2] >= room.floor) {
        if (z + CHARACTER_HEIGHT > neighbor.ceiling) return edge;
        continue;
      }
      // Native movement always injects a -1 mm vertical translation while
      // grounded, then permits the collision report to step that 1 mm back
      // onto the floor.  Keep that tolerance at portals as well.
      if (z + 2 < neighbor.floor || z + CHARACTER_HEIGHT > neighbor.ceiling) return edge;
    }
    return null;
  }

  blockingFeature(roomIndex, candidate, current) {
    const room = this.track.rooms[roomIndex];
    for (const featureIndex of room.children ?? []) {
      const section = this.track.features[featureIndex];
      if (!section || !circleTouchesPolygon(candidate[0], candidate[1], CHARACTER_MOVEMENT_RADIUS, section)) continue;
      const candidateBottom = candidate[2];
      const candidateTop = candidateBottom + CHARACTER_HEIGHT;
      if (Math.max(candidateBottom, section.floor) >= Math.min(candidateTop, section.ceiling)) continue;

      if (stateCrossesDown(current[2], candidateBottom, section.ceiling)) {
        candidate[2] = section.ceiling;
        this.state.velocity[2] = 0;
        this.state.onFloor = true;
        continue;
      }
      if (stateCrossesUp(current[2] + CHARACTER_HEIGHT, candidateTop, section.floor)) {
        candidate[2] = section.floor - CHARACTER_HEIGHT;
        this.state.velocity[2] = 0;
        continue;
      }
      return { section, edge: nearestEdge(section, candidate[0], candidate[1]) };
    }
    return null;
  }

  collideWithNearestRoomWall(roomIndex, x, y) {
    const room = this.track.rooms[roomIndex];
    if (!room) return;
    this.reflectFromEdge(room, nearestEdge(room, x, y), false);
    this.state.collisionCount += 1;
  }

  reflectFromEdge(section, edge, feature) {
    let [nx, ny] = edgeInwardNormal(section, edge);
    if (feature) {
      nx = -nx;
      ny = -ny;
    }
    const velocity = this.state.velocity;
    const normalSpeed = velocity[0] * nx + velocity[1] * ny;
    if (normalSpeed < 0) {
      velocity[0] -= 2 * normalSpeed * nx;
      velocity[1] -= 2 * normalSpeed * ny;
    }
  }

  findRoom(x, y, currentRoom) {
    const current = this.track.rooms[currentRoom];
    if (current && pointInPolygon(x, y, current.vertices)) return currentRoom;
    if (current) {
      for (const neighbor of current.neighbors) {
        if (neighbor >= 0 && pointInPolygon(x, y, this.track.rooms[neighbor].vertices)) return neighbor;
      }
    }
    for (let index = 0; index < this.track.rooms.length; index += 1) {
      if (pointInPolygon(x, y, this.track.rooms[index].vertices)) return index;
    }
    return -1;
  }
}

export const PHYSICS_CONSTANTS = Object.freeze({
  timeSliceMs: TIME_SLICE_MS,
  movementRadius: CHARACTER_MOVEMENT_RADIUS,
  contactRadius: CHARACTER_CONTACT_RADIUS,
  characterHeight: CHARACTER_HEIGHT,
  steadySpeed: STEADY_SPEED,
  maxZSpeed: MAX_Z_SPEED,
  rotationSpeed: ROTATION_SPEED,
});
