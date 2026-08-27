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
