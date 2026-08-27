import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const storeDirectory = await mkdtemp(join(tmpdir(), 'hoverrace-server-test-'));
const port = 18000 + (process.pid % 10000);
const origin = `http://127.0.0.1:${port}`;
const server = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', 'server/public', 'server/public/index.php'], {
  env: { ...process.env, HOVERRACE_STORE_DIR: storeDirectory },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let serverErrors = '';
server.stderr.on('data', (chunk) => { serverErrors += chunk; });

const json = async (path, options = {}) => {
  const response = await fetch(`${origin}${path}`, {
    ...options,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const payload = await response.json();
  return { response, payload };
};

const post = (path, body) => json(path, { method: 'POST', body: JSON.stringify(body) });
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

try {
  let online = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const { response } = await json('/api/status');
      if (response.ok) { online = true; break; }
    } catch {
      await wait(50);
    }
  }
  assert.equal(online, true, `PHP server did not start: ${serverErrors}`);

  const one = { playerId: 'player-one-0001', player: 'One' };
  const two = { playerId: 'player-two-0002', player: 'Two' };
  const presence = await post('/api/presence', one);
  assert.equal(presence.response.status, 200);
  assert.equal(presence.payload.users[0].name, 'One');

  const customTrack = {
    format: 'HoverRace track',
    starts: [{ team: 0, room: 0, position: [0, 0, 0], orientation: 0 }],
    rooms: [{ floor: 0, ceiling: 1000, vertices: [
      { point: [-1000, -1000], wallLength: 2000 },
      { point: [1000, -1000], wallLength: 2000 },
      { point: [1000, 1000], wallLength: 2000 },
    ], neighbors: [-1, -1, -1] }],
    features: [], actors: [],
  };
  const customRoomResult = await post('/api/rooms', {
    ...one, name: 'Custom Track Test', track: 'imported-test-track', trackData: customTrack,
    craft: 'basic_craft',
  });
  assert.equal(customRoomResult.response.status, 200);
  assert.deepEqual(customRoomResult.payload.session.trackData, customTrack);
  const customRoom = customRoomResult.payload.session.room;
  const customJoin = await post('/api/race/join', {
    ...two, room: customRoom, craft: 'cx_craft',
  });
  assert.equal(customJoin.response.status, 200);
  assert.equal(customJoin.payload.session.track, 'imported-test-track');
  assert.deepEqual(customJoin.payload.session.trackData, customTrack);
  await post('/api/race/leave', { room: customRoom, token: customJoin.payload.session.token });
  await post('/api/race/leave', { room: customRoom, token: customRoomResult.payload.session.token });

  const roomResult = await post('/api/rooms', {
    ...one, name: 'Protocol Test', track: 'ClassicH', craft: 'basic_craft',
  });
  assert.equal(roomResult.response.status, 200);
  const room = roomResult.payload.game.id;
  const host = roomResult.payload.session;
  assert.equal(host.isHost, true);

  const directory = await json('/api/rooms');
  assert.equal(directory.payload.users.some((user) => user.id === one.playerId), false);
  assert.equal(directory.payload.games.some((game) => game.id === room), true);

  const chatResult = await post('/api/chat', { ...one, message: '<b>Hello</b>' });
  assert.equal(chatResult.payload.message.message, 'Hello');
  const chat = await json('/api/chat?since=0');
  assert.equal(chat.payload.room, 'lobby');
  assert.equal(chat.payload.messages.at(-1).message, 'Hello');

  const second = (await post('/api/race/join', {
    ...two, room, track: 'ClassicH', craft: 'cx_craft',
  })).payload.session;
  assert.notEqual(host.startSlot, second.startSlot);
  assert.equal(second.isHost, false);

  const nonHostStart = await post('/api/race/start', { room, token: second.token });
  assert.equal(nonHostStart.response.status, 403);

  const started = await post('/api/race/start', { room, token: host.token });
  assert.equal(started.response.status, 200);
  assert.equal(started.payload.status, 'starting');
  assert.ok(started.payload.startAt > started.payload.serverTime);
  const startedDirectory = await json('/api/rooms');
  assert.equal(startedDirectory.payload.games.some((game) => game.id === room), false);
  assert.equal(startedDirectory.payload.users.some((user) => user.id === two.playerId), false);

  const late = await post('/api/race/join', {
    playerId: 'player-late-0003', player: 'Late', room, track: 'ClassicH', craft: 'basic_craft',
  });
  assert.equal(late.response.status, 409);

  const waitingState = await json(`/api/race/state?room=${room}&token=${host.token}`);
  assert.equal(waitingState.payload.status, 'starting');
  assert.equal(waitingState.payload.startAt, started.payload.startAt);

  await wait(6_100);
  const state = {
    position: [100, 200, 300], velocity: [1, 2, 3], orientation: 100,
    cabinOrientation: 120, room: 0, raceTime: 1234, motorOn: true,
    lap: 2, checkpoint: 1, finished: false,
    actorVisible: [false, true], actorFrames: [null, 2],
    projectiles: [{
      id: 4, kind: 'powerup', position: [100, 200, 900], orientation: 100,
      room: 0, age: 600, exploded: false,
    }],
  };
  await post('/api/race/state', { room, token: host.token, state });
  const privateMessage = await post('/api/chat', {
    room, token: host.token, playerId: one.playerId, message: 'Race only',
  });
  assert.equal(privateMessage.response.status, 200);
  assert.equal(privateMessage.payload.message.room, room);
  const privateChat = await json(`/api/chat?room=${room}&token=${second.token}&playerId=${two.playerId}&since=0`);
  assert.equal(privateChat.payload.room, room);
  assert.equal(privateChat.payload.messages.at(-1).message, 'Race only');
  const spoofedChat = await json(`/api/chat?room=${room}&token=${host.token}&playerId=${two.playerId}&since=0`);
  assert.equal(spoofedChat.response.status, 403);
  const peerState = await post('/api/race/state', {
    room, token: second.token, state: { ...state, position: [400, 500, 600] },
  });
  assert.equal(peerState.response.status, 200);
  assert.equal(peerState.payload.status, 'racing');
  assert.equal(peerState.payload.players.length, 2);
  assert.deepEqual(peerState.payload.players[0].state.actorVisible, [false, true]);
  assert.deepEqual(peerState.payload.players[0].state.actorFrames, [null, 2]);
  assert.equal(peerState.payload.players[0].state.projectiles[0].kind, 'powerup');

  await post('/api/race/leave', { room, token: second.token });
  const returned = await post('/api/presence', two);
  assert.equal(returned.payload.users.some((user) => user.id === two.playerId), true);
  console.log('PHP lobby, general chat, waiting games, host start, synchronized start, and late-join rejection passed');
} finally {
  server.kill('SIGTERM');
  await new Promise((resolve) => {
    if (server.exitCode != null) resolve();
    else server.once('exit', resolve);
    setTimeout(resolve, 1000);
  });
  await rm(storeDirectory, { recursive: true, force: true });
}
