import assert from 'node:assert/strict';
import test from 'node:test';

import { generateProceduralTrack } from '../src/procedural-track.js';
import { encodeClassicTrack } from '../src/track-export.js';
import { parseClassicTrack } from '../src/track-import.js';

test('procedural sizes are deterministic, connected, and exportable', async () => {
  const expectedRoomCounts = { small: 30, medium: 48, large: 64 };
  for (const [size, roomCount] of Object.entries(expectedRoomCounts)) {
    const first = generateProceduralTrack(size, 123456789);
    const second = generateProceduralTrack(size, 123456789);
    assert.deepEqual(first, second);
    assert.equal(first.rooms.length, roomCount);
    assert.equal(first.starts.length, 10);
    const actorTypes = new Set(first.actors.map((entry) => entry.type));
    assert.equal(actorTypes.has('checkpoint1'), true);
    assert.equal(actorTypes.has('checkpoint2'), true);
    assert.equal(actorTypes.has('finish'), true);
    assert.equal(actorTypes.has('powerup'), true);

    const visited = new Set([0]);
    const pending = [0];
    while (pending.length) {
      const room = first.rooms[pending.pop()];
      for (const neighbor of room.neighbors) {
        if (neighbor >= 0 && !visited.has(neighbor)) { visited.add(neighbor); pending.push(neighbor); }
      }
    }
    assert.equal(visited.size, first.rooms.length);
    const parsed = parseClassicTrack(await (await encodeClassicTrack(first)).arrayBuffer(), `${size}.trk`);
    assert.equal(parsed.rooms.length, first.rooms.length);
    assert.equal(parsed.actors.length, first.actors.length);
  }
});

test('Pipe Dream is a deterministic 10x10 pipe loop with strategic pickups', async () => {
  const first = generateProceduralTrack('pipe-dream', 24681357);
  const second = generateProceduralTrack('pipe-dream', 24681357);
  assert.deepEqual(first, second);
  assert.equal(first.generator, 'pipe-dream');
  assert.equal(first.size, 'large');
  assert.equal(first.pipeGridSize, 10);
  assert.ok(first.pipeLayout.cells.length >= 64 && first.pipeLayout.cells.length <= 76);
  assert.equal(new Set(first.pipeLayout.cells.map((cell) => `${cell.x},${cell.y}`)).size, first.pipeLayout.cells.length);
  assert.ok(first.pipeLayout.cells.every((cell) => cell.x >= 0 && cell.x < 10 && cell.y >= 0 && cell.y < 10));
  assert.ok(first.pipeLayout.cells.every((cell) => cell.connections.length === 2));
  assert.ok(first.pipeLayout.cells.every((cell, index, cells) => {
    const next = cells[(index + 1) % cells.length];
    return Math.abs(cell.x - next.x) + Math.abs(cell.y - next.y) === 1;
  }));
  assert.notDeepEqual(first.pipeLayout.cells, generateProceduralTrack('pipe-dream', 24681358).pipeLayout.cells);
  assert.ok(first.pipeLayout.cells.every((cell) => ['straight', 'curve-left', 'curve-right'].includes(cell.piece)));
  assert.ok(first.pipeLayout.cells.some((cell) => cell.piece === 'straight'));
  assert.ok(first.pipeLayout.cells.some((cell) => cell.piece.startsWith('curve')));
  assert.equal(first.rocketRooms.length, 3);
  assert.equal(first.pitRooms.length, 3);
  assert.equal(first.actors.filter((entry) => entry.pickup === 'rocket').length, 3);
  assert.equal(first.actors.filter((entry) => entry.type === 'fuel').length, 3);
  assert.equal(first.rooms.length, first.pipeLayout.cells.length);
  const parsed = parseClassicTrack(await (await encodeClassicTrack(first)).arrayBuffer(), 'pipe-dream.trk');
  assert.equal(parsed.rooms.length, first.rooms.length);
  assert.equal(parsed.actors.filter((entry) => entry.type === 'powerup').length, 3);
  assert.equal(parsed.actors.filter((entry) => entry.type === 'fuel').length, 3);
});
