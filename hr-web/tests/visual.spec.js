import fs from 'node:fs';

import { expect, test } from '@playwright/test';

test('renders original ClassicH geometry and craft assets', async ({ page }) => {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/?autostart=1&skipCountdown=1');
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 30_000 });
  await expect(page.locator('#game-canvas')).toBeVisible();
  await expect(page.locator('#radar')).toBeVisible();
  await expect(page.locator('#pause-button')).toBeVisible();
  await expect(page.locator('#diagnostics')).toContainText('floors');
  await expect(page.locator('#diagnostics')).toContainText('source walls');
  await expect(page.locator('#diagnostics')).toContainText('track batches');
  await expect(page.locator('#diagnostics')).toContainText('craft patches');
  const contextAttributes = await page.locator('#game-canvas').evaluate((canvas) =>
    canvas.getContext('webgl2').getContextAttributes());
  expect(contextAttributes.alpha).toBe(false);
  expect(contextAttributes.premultipliedAlpha).toBe(false);
  const trackBatches = Number((await page.locator('#diagnostics').textContent())
    .match(/(\d+) track batches/)?.[1]);
  expect(trackBatches).toBeLessThan(100);
  await page.screenshot({ path: `test-results/${test.info().project.name}-classic-h.png` });
  expect(errors).toEqual([]);
});

test('reports live frame pacing and WebGL submission telemetry', async ({ page }) => {
  await page.goto('/?autostart=1&skipCountdown=1&perf=1');
  await page.waitForFunction(() => document.documentElement.dataset.perfFps != null, null,
    { timeout: 30_000 });
  await expect(page.locator('#performance-panel')).toBeVisible();
  await expect(page.locator('#performance-panel')).toContainText('FPS');
  await expect(page.locator('#performance-panel')).toContainText('P95');
  await expect(page.locator('#performance-panel')).toContainText('DRAW');
  await expect(page.locator('#performance-panel')).toContainText('OPAQUE');
  expect(Number(await page.locator('html').getAttribute('data-perf-draw-calls'))).toBeLessThanOrEqual(30);
  expect(await page.locator('html').getAttribute('data-perf-webgl-alpha')).toBe('false');
});

test('suppresses selection and browser callouts', async ({ page }) => {
  await page.goto('/?autostart=1&skipCountdown=1');
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 30_000 });
  const behavior = await page.evaluate(() => {
    const style = getComputedStyle(document.querySelector('.touch-button'));
    return {
      userSelect: style.userSelect,
      webkitUserSelect: style.webkitUserSelect,
      webkitTouchCallout: style.webkitTouchCallout,
      touchAction: style.touchAction,
    };
  });
  expect(behavior.userSelect).toBe('none');
  expect(behavior.touchAction).toBe('none');
});

test('shows the native six-second pre-race countdown and locks controls', async ({ page }) => {
  await page.goto('/?autostart=1');
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 30_000 });
  await expect(page.locator('#race-countdown')).toBeVisible();
  await expect(page.locator('#race-countdown')).toContainText('STARTING IN');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(250);
  await expect(page.locator('#speed-value')).toHaveText('0');
  await expect(page.locator('#time-value')).toHaveText('0:00.000');
  await page.keyboard.up('KeyW');
  await page.screenshot({ path: `test-results/${test.info().project.name}-countdown.png` });
});

test('resets the practice countdown after leaving and starting another race', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => document.documentElement.dataset.menuReady === 'true', null, { timeout: 30_000 });
  await page.locator('#menu-start').click();
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 30_000 });
  await expect(page.locator('#race-countdown')).toBeVisible();
  await page.locator('#pause-button').click();
  await expect(page.locator('#pause-screen')).toBeVisible();
  await page.locator('#leave-button').click();
  await expect(page.locator('#main-menu')).toBeVisible();
  await page.locator('#track-select').selectOption('Steeplechase');
  await page.locator('#menu-start').click();
  await expect(page.locator('#track-name')).toHaveText('Steeplechase', { timeout: 30_000 });
  await expect(page.locator('#race-countdown')).toBeVisible();
  await page.locator('#race-countdown').waitFor({ state: 'hidden', timeout: 30_000 });
  await page.keyboard.down('KeyW');
  await expect.poll(async () => Number(await page.locator('#speed-value').textContent()), { timeout: 5_000 }).toBeGreaterThan(15);
  await page.keyboard.up('KeyW');
});

test('renders the original motor-on craft frames while driving', async ({ page }) => {
  await page.goto('/?autostart=1&skipCountdown=1');
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-audio-backend', 'web-audio');
  await page.keyboard.down('KeyW');
  await expect.poll(async () => Number(await page.locator('#speed-value').textContent())).toBeGreaterThan(15);
  await page.screenshot({ path: `test-results/${test.info().project.name}-basic-motor-on.png` });
  await page.keyboard.up('KeyW');
});

test('opens the PHP-backed Internet Meeting Room directory', async ({ page }) => {
  test.slow();
  await page.goto('/');
  await page.waitForFunction(() => document.documentElement.dataset.menuReady === 'true', null, { timeout: 30_000 });
  await page.locator('#menu-internet').click();
  await expect(page.locator('#nickname-dialog')).toBeVisible();
  const nicknameInput = page.locator('#nickname-input');
  await expect(nicknameInput).toHaveValue(/^Guest\d{5}$/);
  await nicknameInput.click();
  await expect(nicknameInput).toHaveValue('');
  await nicknameInput.fill('RacerOne');
  await nicknameInput.press('Enter');
  await expect(page.locator('#chat-panel')).toBeVisible();
  await expect(page.locator('#chat-status')).toHaveText('ONLINE');
  await expect(page.locator('#chat-users')).toBeVisible();
  await expect(page.locator('#chat-games')).toBeVisible();
  const chatInput = page.locator('#chat-input');
  await chatInput.pressSequentially('asdwe normal letters space bar');
  await expect(chatInput).toHaveValue('asdwe normal letters space bar');
  await page.screenshot({ path: `test-results/${test.info().project.name}-internet-room.png` });
});

test('returns keyboard driving after closing in-race chat', async ({ page }) => {
  await page.goto('/?autostart=1&skipCountdown=1');
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 30_000 });
  await page.locator('#chat-button').click();
  await expect(page.locator('#nickname-dialog')).toBeVisible();
  await page.locator('#nickname-input').press('Enter');
  await expect(page.locator('#chat-panel')).toBeVisible();
  await page.locator('#chat-input').pressSequentially('asdwe');
  await page.locator('#chat-close').click();
  await expect(page.locator('#chat-panel')).toBeHidden();
  await page.keyboard.down('KeyW');
  await expect.poll(async () => Number(await page.locator('#speed-value').textContent())).toBeGreaterThan(15);
  await page.keyboard.up('KeyW');
});

test('renders decoded permanent bumper-gate actor meshes', async ({ page }) => {
  await page.goto('/?autostart=1&skipCountdown=1&track=Steeplechase&inspectActor=bumperGate');
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 30_000 });
  await expect(page.locator('#track-name')).toHaveText('Steeplechase');
  await expect(page.locator('#diagnostics')).toContainText('6 track actors');
  await page.screenshot({ path: `test-results/${test.info().project.name}-bumper-gates.png` });
});

test('shows the 16:9 touch menu and switches original source assets', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => document.documentElement.dataset.menuReady === 'true', null, { timeout: 30_000 });
  await expect(page.locator('#main-menu')).toBeVisible();
  await page.locator('#track-select').selectOption('Steeplechase');
  await page.locator('[data-menu-craft="cx_craft"]').click();
  await expect(page.locator('#track-select')).toHaveValue('Steeplechase');
  await page.screenshot({ path: `test-results/${test.info().project.name}-main-menu.png` });
  await page.locator('#menu-start').click();
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 30_000 });
  await expect(page.locator('#track-name')).toHaveText('Steeplechase');
  await expect(page.locator('#diagnostics')).toContainText('craft patches');
  if (test.info().project.name === 'touch-landscape') {
    await expect(page.locator('.radial-controls')).toBeVisible();
    await expect(page.locator('[data-action="throttle"]')).toHaveText('GAS');
    await expect(page.locator('[data-action="weapon"]')).toHaveText('MISSILE');
    await expect(page.locator('[data-action="brake"]')).toHaveText('BACK');
    await expect(page.locator('[data-action="boost"]')).toHaveText('BOOST');
    await expect(page.locator('[data-action="boost"]')).toHaveAttribute('data-actions', 'boost throttle');
  }
  await page.screenshot({ path: `test-results/${test.info().project.name}-steeplechase-cx.png` });
});

test('imports a track JSON and exposes it beside the built-in tracks', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => document.documentElement.dataset.menuReady === 'true', null, { timeout: 30_000 });
  const trackJson = fs.readFileSync(new URL('../public/assets/tracks/ClassicH.json', import.meta.url));
  await page.locator('#track-file').setInputFiles({
    name: 'Imported Practice.json',
    mimeType: 'application/json',
    buffer: trackJson,
  });
  const imported = page.locator('[data-imported-track]');
  await expect(imported).toHaveCount(1);
  await expect(imported).toHaveText('Imported Practice');
  await page.locator('#track-select').selectOption({ label: 'Imported Practice' });
  await expect(page.locator('#track-select')).toHaveValue(/imported-/);
  await expect(page.locator('#track-import-status')).toHaveText('1 track imported');
});

test('generates a seeded procedural track and exports JSON', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => document.documentElement.dataset.menuReady === 'true', null, { timeout: 30_000 });
  await page.locator('#track-select').selectOption('engine:small');
  await expect(page.locator('#procedural-controls')).toBeVisible();
  await page.locator('#procedural-seed').fill('2468');
  await page.locator('#procedural-generate').click();
  const generated = page.locator('[data-imported-track]').last();
  await expect(generated).toHaveText('SMALL · 2468');
  await expect(page.locator('#generated-track-tools')).toBeVisible();
  await expect(page.locator('#track-import-status')).toHaveText('Procedural small circuit · Seed 2468 generated');
  const download = page.waitForEvent('download');
  await page.locator('#export-track-json').click();
  expect((await download).suggestedFilename()).toMatch(/procedural-small-circuit-seed-2468\.json/);
  await page.locator('#menu-start').click();
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 30_000 });
  await expect(page.locator('#track-name')).toHaveText('imported-generated-small-2468');
});

test('keeps a 16:9 game stage and accepts held pointer controls', async ({ page }) => {
  await page.goto('/?autostart=1&skipCountdown=1');
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 30_000 });
  const ratio = await page.locator('#stage').evaluate((stage) => {
    const bounds = stage.getBoundingClientRect();
    return bounds.width / bounds.height;
  });
  expect(ratio).toBeCloseTo(16 / 9, 2);
  const viewportFit = await page.locator('#stage').evaluate((stage) => {
    const bounds = stage.getBoundingClientRect();
    const viewport = window.visualViewport;
    return {
      top: bounds.top,
      left: bounds.left,
      bottom: bounds.bottom,
      right: bounds.right,
      visibleWidth: viewport?.width ?? window.innerWidth,
      visibleHeight: viewport?.height ?? window.innerHeight,
    };
  });
  expect(viewportFit.top).toBeGreaterThanOrEqual(-1);
  expect(viewportFit.left).toBeGreaterThanOrEqual(-1);
  expect(viewportFit.bottom).toBeLessThanOrEqual(viewportFit.visibleHeight + 1);
  expect(viewportFit.right).toBeLessThanOrEqual(viewportFit.visibleWidth + 1);

  const throttle = page.locator('[data-action="throttle"]');
  const bounds = await throttle.boundingBox();
  if (bounds == null) {
    expect(test.info().project.name).toBe('desktop-chromium');
    return;
  }
  const client = await page.context().newCDPSession(page);
  const touchPoint = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, id: 31 };
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint] });
  await expect(throttle).toHaveClass(/pressed/);
  await expect.poll(async () => Number(await page.locator('#speed-value').textContent())).toBeGreaterThan(10);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(throttle).not.toHaveClass(/pressed/);
});

test('renders collectible can and original animated missile meshes', async ({ page }) => {
  await page.goto('/?autostart=1&skipCountdown=1&inspectActor=powerup');
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 30_000 });
  await page.screenshot({ path: `test-results/${test.info().project.name}-powerup-can.png` });
  await page.locator('#camera-button').click();
  await page.keyboard.down('KeyF');
  await page.waitForTimeout(80);
  await page.keyboard.up('KeyF');
  await page.waitForFunction(() => Number(document.documentElement.dataset.projectiles) > 0);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `test-results/${test.info().project.name}-missile-flight.png` });
});

test('synchronizes two PHP-backed racers and renders the remote craft', async ({ page, context }) => {
  test.slow();
  await page.goto('/');
  await page.waitForFunction(() => document.documentElement.dataset.menuReady === 'true', null, { timeout: 30_000 });
  const game = await page.evaluate(async () => {
    const response = await fetch('/api.php?route=rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        name: 'Visual Test Game', track: 'ClassicH', craft: 'basic_craft',
        playerId: 'visual-host-0001', player: 'Host',
      }),
    });
    return response.json();
  });
  const second = await context.newPage();
  await Promise.all([
    page.goto(`/?autostart=1&online=1&room=${game.game.id}&craft=basic_craft`),
    second.goto(`/?autostart=1&online=1&room=${game.game.id}&craft=cx_craft`),
  ]);
  await Promise.all([
    page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 30_000 }),
    second.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 30_000 }),
  ]);
  await page.evaluate(async ({ token, room }) => {
    await fetch('/api.php?route=race_start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ room, token }),
    });
  }, { token: game.session.token, room: game.session.room });
  await Promise.all([
    page.waitForFunction(() => Number(document.documentElement.dataset.remotePlayers) >= 1, null, { timeout: 30_000 }),
    second.waitForFunction(() => Number(document.documentElement.dataset.remotePlayers) >= 1, null, { timeout: 30_000 }),
  ]);
  await page.locator('#chat-button').click();
  await page.locator('#nickname-input').press('Enter');
  await expect(page.locator('#chat-title')).toContainText('GAME CHAT');
  await expect(page.locator('#chat-directory')).toBeHidden();
  await page.locator('#chat-close').click();
  const [firstSlot, secondSlot] = await Promise.all([
    page.evaluate(() => document.documentElement.dataset.startSlot),
    second.evaluate(() => document.documentElement.dataset.startSlot),
  ]);
  expect(firstSlot).not.toBe(secondSlot);
  await expect(page.locator('#network-status')).toContainText('2 RACERS');
  await page.waitForFunction(() => Number(document.documentElement.dataset.remoteCrafts) >= 1, null, { timeout: 30_000 });
  await second.keyboard.down('KeyW');
  await second.waitForTimeout(500);
  await page.waitForTimeout(300);
  await page.locator('#camera-button').click();
  await page.locator('#camera-button').click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `test-results/${test.info().project.name}-php-multiplayer.png` });
  await second.keyboard.up('KeyW');
  await second.close();
});
