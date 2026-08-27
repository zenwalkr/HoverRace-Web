import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const storeDirectory = await mkdtemp(join(tmpdir(), 'hoverrace-production-test-'));
const port = 28000 + (process.pid % 10000);
const origin = `http://127.0.0.1:${port}`;
const server = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', 'dist'], {
  env: { ...process.env, HOVERRACE_STORE_DIR: storeDirectory },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let serverErrors = '';
server.stderr.on('data', (chunk) => { serverErrors += chunk; });

const get = async (path) => {
  const response = await fetch(`${origin}${path}`, { headers: { Accept: 'application/json' } });
  const payload = await response.text();
  return { response, payload };
};

const post = async (path, body) => {
  const response = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.text();
  return { response, payload };
};

try {
  let online = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const { response } = await get('/api.php?route=status');
      if (response.ok) {
        online = true;
        break;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  assert.equal(online, true, `Production PHP server did not start: ${serverErrors}`);

  const status = await get('/api.php?route=status');
  assert.equal(status.response.status, 200);
  assert.equal(JSON.parse(status.payload).service, 'HoverRace PHP backend');

  const created = await post('/api.php?route=rooms', {
    name: 'Production Test', track: 'ClassicH', craft: 'basic_craft',
    playerId: 'production-player-0001', player: 'Production Player',
  });
  assert.equal(created.response.status, 200);
  const createdPayload = JSON.parse(created.payload);
  assert.equal(createdPayload.game.name, 'Production Test');
  assert.equal(createdPayload.session.isHost, true);

  const rooms = await get('/api.php?route=rooms');
  assert.equal(rooms.response.status, 200);
  const directory = JSON.parse(rooms.payload);
  assert.equal(directory.games[0].id, createdPayload.game.id);
  assert.equal(directory.users.some((user) => user.id === 'production-player-0001'), false);

  const page = await fetch(`${origin}/`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /\.\/assets\/index-[^"']+\.js/);

  const assetMatch = html.match(/(?:src|href)="(\.\/assets\/[^"']+)"/);
  assert.ok(assetMatch, 'Production index did not reference a relative asset');
  const asset = await fetch(`${origin}/${assetMatch[1].replace(/^\.\//, '')}`);
  assert.equal(asset.status, 200);
  console.log('Direct api.php endpoint and relative production asset package passed');
} finally {
  server.kill('SIGTERM');
  await new Promise((resolve) => {
    if (server.exitCode != null) resolve();
    else server.once('exit', resolve);
    setTimeout(resolve, 1000);
  });
  await rm(storeDirectory, { recursive: true, force: true });
}
