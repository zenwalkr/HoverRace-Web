import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { PHYSICS_CONSTANTS, RaceSimulation } from '../src/game/simulation.js';

function testTrack(size = 100_000) {
  return {
    starts: [{ room: 0, position: [0, 0, 0], orientation: 0 }],
    features: [],
    rooms: [{
      floor: 0,
      ceiling: 4000,
      vertices: [
        { point: [-size, -size] }, { point: [size, -size] },
        { point: [size, size] }, { point: [-size, size] },
      ],
      neighbors: [-1, -1, -1, -1],
      children: [],
    }],
  };
}

function steppedPortalTrack() {
  return {
    starts: [{ room: 0, position: [-10, 0, 1002], orientation: 0 }],
    features: [],
    rooms: [
      {
        floor: 0,
        ceiling: 4000,
        vertices: [{ point: [-10000, -10000] }, { point: [0, -10000] },
          { point: [0, 10000] }, { point: [-10000, 10000] }],
        neighbors: [-1, 1, -1, -1],
        children: [],
      },
      {
        floor: 1000,
        ceiling: 5000,
        vertices: [{ point: [0, -10000] }, { point: [10000, -10000] },
          { point: [10000, 10000] }, { point: [0, 10000] }],
        neighbors: [-1, -1, -1, 0],
        children: [],
      },
    ],
  };
}

test('uses the original 5 ms Basic craft acceleration trajectory', () => {
  const simulation = new RaceSimulation(testTrack(), 0);
  for (let index = 0; index < 200; index += 1) simulation.step(5, { throttle: true });

  assert.equal(PHYSICS_CONSTANTS.timeSliceMs, 5);
  assert.deepEqual(simulation.state.position, [10584, 0, 0]);
  assert.ok(Math.abs(simulation.state.velocity[0] - 18.12431520935981) < 1e-12);
  assert.equal(simulation.state.velocity[1], 0);
  assert.ok(Math.abs(simulation.state.fuel - 0.9944444444444445) < 1e-12);
});

test('holds controls and race timing during the native pre-race countdown', () => {
  const simulation = new RaceSimulation(testTrack(), 0, { countdownMs: 10 });
  simulation.step(5, { throttle: true });
  assert.equal(simulation.state.countdown, 5);
  assert.equal(simulation.state.motorOn, false);
  assert.equal(simulation.state.raceTime, 0);
  simulation.step(5, { throttle: true });
  assert.equal(simulation.state.countdown, 0);
  assert.equal(simulation.state.raceTime, 0);
  simulation.step(5, { throttle: true });
  assert.equal(simulation.state.motorOn, true);
  assert.equal(simulation.state.raceTime, 0.005);
});

test('lands across a different-height room portal instead of sticking at the edge', () => {
  const simulation = new RaceSimulation(steppedPortalTrack(), 0);
  simulation.state.velocity = [10, 0, -1];
  simulation.step(5, {});

  assert.equal(simulation.state.room, 1);
  assert.equal(simulation.state.position[2], 1000);
  assert.equal(simulation.state.velocity[2], 0);
  assert.equal(simulation.state.onFloor, true);

  simulation.step(5, { throttle: true });
  assert.ok(simulation.state.position[0] > 0);
});

test('lands on the lower side when the collision radius touches a higher ledge', () => {
  const track = steppedPortalTrack();
  track.rooms[0].floor = 1000;
  track.rooms[1].floor = 2000;
  const simulation = new RaceSimulation(track, 0);
  simulation.state.position = [-1200, 0, 1002];
  simulation.state.room = 0;
  simulation.state.velocity = [10, 0, -1];
  simulation.step(5, {});

  assert.equal(simulation.state.room, 0);
  assert.equal(simulation.state.position[2], 1000);
  assert.equal(simulation.state.velocity[2], 0);
  assert.equal(simulation.state.onFloor, true);
});

test('can jump over a raised floor edge instead of freezing at its wall', () => {
  const simulation = new RaceSimulation(steppedPortalTrack(), 0);
  simulation.state.position = [-1000, 0, 0];
  simulation.state.room = 0;
  simulation.state.velocity = [10, 0, 3.19];

  for (let index = 0; index < 200; index += 1) simulation.step(5, { throttle: true });

  assert.equal(simulation.state.room, 1);
  assert.ok(simulation.state.position[0] > 0);
  assert.ok(simulation.state.collisionCount < 10);
});

test('clears the first raised Steeplechase platform with a jump', () => {
  const track = JSON.parse(fs.readFileSync(
    new URL('../public/assets/tracks/Steeplechase.json', import.meta.url)));
  const simulation = new RaceSimulation(track, 0);
  for (let time = 0; time <= 5000; time += 5) {
    simulation.tick(time, { throttle: true, jump: time === 2300 });
  }

  assert.equal(simulation.state.room, 7);
  assert.ok(simulation.state.position[1] > 158_000);
  assert.equal(simulation.state.collisionCount, 0);
});

test('retains native integer-angle steering and deterministic state', () => {
  const first = new RaceSimulation(testTrack(), 0);
  const second = new RaceSimulation(testTrack(), 0);
  for (let index = 0; index < 100; index += 1) {
    first.step(5, { left: true });
    second.step(5, { left: true });
  }
  assert.equal(first.state.orientation, 700);
  assert.deepEqual(first.state, second.state);
});

test('interpolates render transforms without changing deterministic physics state', () => {
  const simulation = new RaceSimulation(testTrack(), 0);
  simulation.state.position = [0, 20, 40];
  simulation.state.orientation = 4090;
  simulation.state.cabinOrientation = 4090;
  simulation.snapInterpolation();
  simulation.state.position = [10, 40, 80];
  simulation.state.orientation = 6;
  simulation.state.cabinOrientation = 6;
  simulation.accumulatorMs = PHYSICS_CONSTANTS.timeSliceMs / 2;

  const rendered = simulation.interpolatedState();
  assert.deepEqual(rendered.position, [5, 30, 60]);
  assert.equal(rendered.orientation, 0);
  assert.equal(rendered.cabinOrientation, 0);
  assert.deepEqual(simulation.state.position, [10, 40, 80]);
  assert.equal(simulation.state.orientation, 6);
});

test('produces evenly spaced render motion across 60 Hz fixed-step frames', () => {
  const simulation = new RaceSimulation(testTrack(), 0);
  simulation.step = (durationMs) => { simulation.state.position[0] += durationMs; };
  simulation.tick(0, {});
  const rendered = [16.666667, 33.333334, 50.000001].map((time) => {
    simulation.tick(time, {});
    return simulation.interpolatedState().position[0];
  });
  const firstDistance = rendered[1] - rendered[0];
  const secondDistance = rendered[2] - rendered[1];
  assert.ok(Math.abs(firstDistance - secondDistance) < 0.00001);
});

test('reflects the normal velocity while preserving wall-tangent momentum', () => {
  const simulation = new RaceSimulation(testTrack(5000), 0);
  simulation.state.velocity = [10, 3, 0];
  for (let index = 0; index < 100; index += 1) simulation.step(5, {});

  assert.ok(simulation.state.collisionCount > 0);
  assert.ok(simulation.state.velocity[0] < 0);
  assert.ok(simulation.state.velocity[1] > 0);
  assert.ok(simulation.state.position[0] < 5000 - PHYSICS_CONSTANTS.movementRadius);
});

test('releases a craft that is moving away from a sharp ClassicH corner', () => {
  const classic = JSON.parse(fs.readFileSync(
    new URL('../public/assets/tracks/ClassicH.json', import.meta.url)));
  const simulation = new RaceSimulation(classic, 0);
  simulation.state.position = [407024, 112358, 0];
  simulation.state.room = 3;
  simulation.state.velocity = [-9.1, -8.45, 0];

  const startingPosition = [...simulation.state.position];
  simulation.step(5, {});

  assert.notDeepEqual(simulation.state.position, startingPosition);
  assert.equal(simulation.state.collisionCount, 0);
});

test('jumps only from floor contact and applies native vertical impulse', () => {
  const simulation = new RaceSimulation(testTrack(), 0);
  simulation.step(5, {});
  simulation.tick(0, { jump: false });
  simulation.tick(5, { jump: true });

  assert.equal(simulation.state.onFloor, false);
  assert.ok(simulation.state.position[2] > 0);
  assert.ok(simulation.state.velocity[2] > PHYSICS_CONSTANTS.maxZSpeed[0]);
});

test('crosses the real ClassicH start portals while grounded', () => {
  const classic = JSON.parse(fs.readFileSync(
    new URL('../public/assets/tracks/ClassicH.json', import.meta.url)));
  const simulation = new RaceSimulation(classic, 0);
  for (let index = 0; index < 200; index += 1) simulation.step(5, { throttle: true });

  assert.equal(simulation.state.room, 1);
  assert.equal(simulation.state.collisionCount, 0);
  assert.ok(simulation.state.position[1] > 75_000);
});

test('decodes and enforces checkpoint 1, checkpoint 2, then finish', () => {
  const track = testTrack(200_000);
  track.actors = [
    { type: 'checkpoint1', classifiedRoom: 0, position: [0, 0, 0] },
    { type: 'checkpoint2', classifiedRoom: 0, position: [50_000, 0, 0] },
    { type: 'finish', classifiedRoom: 0, position: [100_000, 0, 0] },
  ];
  const simulation = new RaceSimulation(track, 0);

  simulation.state.position = [100_000, 0, 0];
  simulation.updateActorContacts();
  assert.equal(simulation.state.completedLaps, 0);

  for (let lap = 1; lap <= 3; lap += 1) {
    for (const x of [0, 50_000, 100_000]) {
      simulation.state.position = [x, 0, 0];
      simulation.state.raceTime += 10;
      simulation.updateActorContacts();
    }
    assert.equal(simulation.state.completedLaps, lap);
  }
  assert.equal(simulation.state.lap, 3);
  assert.equal(simulation.state.finished, true);
});

test('extracts native actor factory records from ClassicH', () => {
  const classic = JSON.parse(fs.readFileSync(
    new URL('../public/assets/tracks/ClassicH.json', import.meta.url)));
  assert.deepEqual(classic.actors.map((actor) => actor.type),
    ['checkpoint1', 'checkpoint2', 'powerup', 'finish', 'fuel']);
  assert.ok(classic.levelRecordEnd > classic.geometryRecordEnd);
});

test('reflects from and collapses native bumper-gate actor frames', () => {
  const track = testTrack();
  track.actors = [{ type: 'bumperGate', classifiedRoom: 0, position: [0, 0, 0] }];
  const simulation = new RaceSimulation(track, 0);
  simulation.state.position = [-3900, 0, 0];
  simulation.state.velocity = [10, 0, 0];
  simulation.step(5, {});

  assert.ok(simulation.state.velocity[0] < 0);
  assert.equal(simulation.state.collisionCount, 1);
  for (let index = 0; index < 300; index += 1) simulation.step(5, {});
  assert.equal(simulation.state.actorFrames[0], 0);
});

test('applies native fuel-source and speed-doubler contact effects', () => {
  const track = testTrack();
  track.actors = [
    { type: 'fuel', classifiedRoom: 0, position: [0, 0, 0] },
    { type: 'speedDoubler', classifiedRoom: 0, position: [0, 0, 0] },
  ];
  const simulation = new RaceSimulation(track, 0);
  simulation.fuelLevel = 90_000;
  simulation.step(5, {});

  assert.equal(simulation.fuelLevel, 90_100);
  assert.ok(Math.abs(simulation.state.velocity[0] - 4 * PHYSICS_CONSTANTS.steadySpeed[0]) < 0.01);
});

test('keeps a buried power-up can above the floor for pickup', () => {
  const track = testTrack();
  track.actors = [{ type: 'powerup', classifiedRoom: 0, position: [0, 0, -900] }];
  const simulation = new RaceSimulation(track, 0);
  simulation.state.position = [0, 0, 0];
  simulation.state.room = 0;
  simulation.step(5, {});

  assert.equal(simulation.state.actorVisible[0], false);
  assert.equal(simulation.state.powerupCount, 1);
});

test('collects a power-up while crossing from a neighboring room portal', () => {
  const track = steppedPortalTrack();
  track.actors = [{ type: 'powerup', classifiedRoom: 1, position: [0, 0, 1550] }];
  const simulation = new RaceSimulation(track, 0);
  simulation.state.position = [-100, 0, 0];
  simulation.state.room = 0;
  simulation.updateActorContacts();

  assert.equal(simulation.state.actorVisible[0], false);
  assert.equal(simulation.state.powerupCount, 1);
});

test('collects original cans and mines with native inventory limits and effects', () => {
  const track = testTrack();
  track.actors = [
    { type: 'powerup', classifiedRoom: 0, position: [0, 0, 550] },
    { type: 'mine', classifiedRoom: 0, position: [0, 0, 0] },
  ];
  const simulation = new RaceSimulation(track, 0);
  simulation.step(5, {});

  assert.equal(simulation.state.powerupCount, 1);
  assert.equal(simulation.state.mineCount, 1);
  assert.deepEqual(simulation.state.actorVisible, [false, false]);
  assert.ok(simulation.state.outOfControl > 1900);
  assert.ok(simulation.state.velocity[2] > PHYSICS_CONSTANTS.maxZSpeed[0]);
});

test('cycles and activates a collected powerup for the native duration', () => {
  const simulation = new RaceSimulation(testTrack(), 0);
  simulation.state.powerupCount = 1;
  simulation.changeWeapon();
  assert.equal(simulation.state.weapon, 'powerup');
  assert.equal(simulation.fireWeapon(), true);
  assert.equal(simulation.state.powerup, 5000);
  assert.equal(simulation.state.powerupCount, 0);
  assert.equal(simulation.state.weapon, 'missile');
  assert.equal(simulation.state.projectiles[0].kind, 'powerup');
  for (let index = 0; index < 1002; index += 1) simulation.step(5, {});
  assert.equal(simulation.state.powerupCount, 1);
  assert.equal(simulation.state.projectiles.length, 0);
});

test('activates the direct boost action while its combined throttle is held', () => {
  const simulation = new RaceSimulation(testTrack(), 0);
  simulation.state.powerupCount = 1;

  simulation.tick(0, { boost: true, throttle: true });
  assert.equal(simulation.state.powerup, 5000);
  assert.equal(simulation.state.powerupCount, 0);

  simulation.tick(5, { boost: true, throttle: true });
  assert.equal(simulation.state.motorOn, true);
  assert.ok(simulation.state.velocity[0] > 0);
});

test('launches, animates, and expires the original missile lifecycle', () => {
  const simulation = new RaceSimulation(testTrack(500_000), 0);
  assert.equal(simulation.fireWeapon(), true);
  assert.equal(simulation.state.projectiles.length, 1);
  simulation.step(5, {});
  assert.equal(simulation.state.projectiles[0].position[0], 233);
  for (let index = 1; index < 1500; index += 1) simulation.step(5, {});
  assert.equal(simulation.state.projectiles[0].exploded, true);
  for (let index = 0; index < 240; index += 1) simulation.step(5, {});
  assert.equal(simulation.state.projectiles.length, 0);
});

test('drops and recollects a mine using the native 0.6 mm/ms freefall', () => {
  const simulation = new RaceSimulation(testTrack(), 0);
  simulation.state.mineCount = 1;
  simulation.changeWeapon();
  assert.equal(simulation.state.weapon, 'mine');
  simulation.fireWeapon();
  assert.equal(simulation.state.projectiles[0].position[2], 800);
  simulation.step(5, {});
  assert.equal(simulation.state.projectiles[0].position[2], 797);
  for (let index = 0; index < 266; index += 1) simulation.step(5, {});
  assert.equal(simulation.state.mineCount, 1);
  assert.equal(simulation.state.projectiles.length, 0);
});

test('allows an armed missile to hit its own craft', () => {
  const simulation = new RaceSimulation(testTrack(), 0);
  simulation.state.projectiles = [{
    id: 1, kind: 'missile', room: 0, position: [-100, 0, 1100],
    orientation: 0, age: 200, active: true, exploded: false,
  }];

  simulation.updateProjectiles(5);

  assert.equal(simulation.state.outOfControl, 2000);
  assert.equal(simulation.state.projectiles[0].exploded, true);
});

test('applies peer craft momentum and remote missile hit effects', () => {
  const simulation = new RaceSimulation(testTrack(), 0);
  simulation.state.velocity = [10, 0, 0];
  simulation.setRemotePlayers([{
    id: 'peer',
    state: {
      room: 0,
      position: [2000, 0, 0],
      velocity: [0, 0, 0],
      projectiles: [{
        id: 7, kind: 'missile', room: 0, position: [0, 0, 1100],
        orientation: 0, age: 200,
      }],
    },
  }]);
  simulation.updateRemoteContacts();

  assert.equal(simulation.state.velocity[0], 0);
  assert.equal(simulation.state.collisionCount, 1);
  assert.equal(simulation.state.outOfControl, 2000);
});

test('detects a remote missile crossing the craft between network snapshots', () => {
  const simulation = new RaceSimulation(testTrack(), 0);
  const remoteState = (position, age) => ({
    room: 0,
    position: [0, 0, 0],
    velocity: [0, 0, 0],
    projectiles: [{
      id: 8, kind: 'missile', room: 0, position, orientation: 0, age,
    }],
  });

  simulation.setRemotePlayers([{ id: 'peer', state: remoteState([-5000, 0, 1100], 200) }]);
  simulation.setRemotePlayers([{ id: 'peer', state: remoteState([5000, 0, 1100], 300) }]);
  simulation.updateRemoteContacts();

  assert.equal(simulation.state.outOfControl, 2000);
});

test('merges remote permanent-actor pickups and bumper collapse state', () => {
  const track = testTrack();
  track.actors = [
    { type: 'powerup', classifiedRoom: 0, position: [8000, 0, 0] },
    { type: 'bumperGate', classifiedRoom: 0, position: [9000, 0, 0] },
  ];
  const simulation = new RaceSimulation(track, 0);
  simulation.setRemotePlayers([{
    id: 'peer',
    state: {
      actorVisible: [false, true],
      actorFrames: [null, 2],
    },
  }]);

  assert.equal(simulation.state.actorVisible[0], false);
  assert.equal(simulation.state.actorFrames[1], 2);
  simulation.updateBumperGates(5);
  assert.ok(simulation.state.actorFrames[1] <= 2);
});
