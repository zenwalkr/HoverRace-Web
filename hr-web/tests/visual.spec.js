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
  await expect(page.locator('#track-name')).toHaveText('Steeplecha...', { timeout: 30_000 });
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
  await expect(page.locator('#resource-hud')).toBeVisible();
  await expect(page.locator('#fuel-percent')).toHaveText('100%');
  await expect(page.locator('#boost-status')).toHaveText('0 / 4');
  await expect(page.locator('#rocket-status')).toHaveText('READY');
  await page.keyboard.down('KeyW');
  await expect.poll(async () => Number(await page.locator('#speed-value').textContent())).toBeGreaterThan(15);
  await expect.poll(async () => Number((await page.locator('#fuel-percent').textContent()).replace('%', '')),
    { timeout: 5_000 }).toBeLessThan(100);
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
  const lobbyLayout = await page.evaluate(() => {
    const stage = document.querySelector('#stage').getBoundingClientRect();
    const panel = document.querySelector('#chat-panel').getBoundingClientRect();
    const directory = document.querySelector('#chat-directory');
    const sections = [...directory.querySelectorAll('.directory-section')];
    for (const list of [document.querySelector('#chat-users'), document.querySelector('#chat-games')]) {
      for (let index = 0; index < 30; index += 1) {
        const item = document.createElement('li');
        item.textContent = `Test player ${index}`;
        list.append(item);
      }
    }
    return {
      fullStage: [panel.left - stage.left, panel.top - stage.top, panel.width, panel.height],
      stage: [stage.width, stage.height],
      background: getComputedStyle(document.querySelector('#chat-panel')).backgroundColor,
      divider: [getComputedStyle(sections[1]).borderLeftStyle, getComputedStyle(sections[1]).borderLeftWidth],
      listOverflow: [getComputedStyle(document.querySelector('#chat-users')).overflowY, getComputedStyle(document.querySelector('#chat-games')).overflowY],
      listScrolls: [
        document.querySelector('#chat-users').scrollHeight > document.querySelector('#chat-users').clientHeight,
        document.querySelector('#chat-games').scrollHeight > document.querySelector('#chat-games').clientHeight,
      ],
    };
  });
  expect(lobbyLayout.fullStage[0]).toBeCloseTo(0, 0);
  expect(lobbyLayout.fullStage[1]).toBeCloseTo(0, 0);
  expect(lobbyLayout.fullStage[2]).toBeCloseTo(lobbyLayout.stage[0], 0);
  expect(lobbyLayout.fullStage[3]).toBeCloseTo(lobbyLayout.stage[1], 0);
  expect(lobbyLayout.background).toBe('rgb(2, 7, 10)');
  expect(lobbyLayout.divider).toEqual(['solid', expect.any(String)]);
  expect(lobbyLayout.listOverflow).toEqual(['auto', 'auto']);
  expect(lobbyLayout.listScrolls).toEqual([true, true]);
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
  const inRaceChat = await page.locator('#chat-panel').evaluate((panel) => {
    const stage = document.querySelector('#stage').getBoundingClientRect();
    const rect = panel.getBoundingClientRect();
    return { width: rect.width, stageWidth: stage.width, background: getComputedStyle(panel).backgroundColor };
  });
  expect(inRaceChat.width).toBeLessThan(inRaceChat.stageWidth);
  expect(inRaceChat.background).toBe('rgba(2, 7, 10, 0.94)');
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
  await expect(page.locator('#track-name')).toHaveText('Steeplecha...');
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
  await expect(page.locator('#track-name')).toHaveText('Steeplecha...');
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
  await expect(page.locator('#track-preview')).toBeVisible();
  await expect(page.locator('#track-remove')).toBeVisible();
  await expect(page.locator('#track-preview')).toHaveAttribute('data-track', /imported-/);
  await page.locator('#track-remove').click();
  await expect(page.locator('#track-select')).toHaveValue('ClassicH');
  await expect(page.locator('#track-remove')).toBeHidden();
  await expect(page.locator('[data-imported-track]')).toHaveCount(0);
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
  await expect(page.locator('#track-preview')).toHaveAttribute('data-track', /imported-generated-small-2468/);
  await expect(page.locator('#track-preview-name')).toHaveText('PROCEDURAL...');
  const download = page.waitForEvent('download');
  await page.locator('#export-track-json').click();
  expect((await download).suggestedFilename()).toMatch(/procedural-small-circuit-seed-2468\.json/);
  await page.locator('#track-select').selectOption('ClassicH');
  await expect(page.locator('#procedural-controls')).toBeHidden();
  await expect(page.locator('#track-import-status')).toHaveText('');
  await expect(page.locator('#track-remove')).toBeHidden();
  await page.locator('#track-select').selectOption({ label: 'SMALL · 2468' });
  await page.locator('#menu-start').click();
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 30_000 });
  await expect(page.locator('#track-name')).toHaveText('imported-g...');
});

test('generates the deterministic Pipe Dream large track', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => document.documentElement.dataset.menuReady === 'true', null, { timeout: 30_000 });
  await page.locator('#track-select').selectOption('engine:pipe-dream');
  await expect(page.locator('#procedural-controls')).toBeVisible();
  await page.locator('#procedural-seed').fill('24681357');
  await page.locator('#procedural-generate').click();
  await expect(page.locator('[data-imported-track]').last()).toHaveText('PIPE-DREAM · 24681357');
  await expect(page.locator('#track-import-status')).toHaveText('Pipe Dream · Seed 24681357 generated');
  await expect(page.locator('#track-preview-name')).toHaveText('PIPE DREAM...');
  await page.locator('#menu-start').click();
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 30_000 });
  await expect(page.locator('#track-name')).toHaveText('imported-g...');
  await expect(page.locator('#diagnostics')).toContainText('track actors');
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

test('keeps the authored interface geometry at every 16:9 viewport size', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => document.documentElement.dataset.menuReady === 'true', null, { timeout: 30_000 });
  const selectors = ['#main-menu', '.menu-brand', '.menu-track-preview', '.menu-card', '#track-select', '.craft-options', '.menu-actions'];
  const measure = (selectors) => {
    const stage = document.querySelector('#stage').getBoundingClientRect();
    return Object.fromEntries(selectors.map((selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return [selector, [
        (rect.left - stage.left) / stage.width,
        (rect.top - stage.top) / stage.height,
        rect.width / stage.width,
        rect.height / stage.height,
      ]];
    }));
  };
  const baseline = await page.evaluate(measure, selectors);
  const previewShape = await page.locator('.menu-track-preview').evaluate((preview) => {
    const rect = preview.getBoundingClientRect();
    const title = preview.previousElementSibling.getBoundingClientRect();
    const brand = preview.closest('.menu-brand').getBoundingClientRect();
    return {
      square: rect.width / rect.height,
      belowTitle: rect.top >= title.bottom - 1,
      insideBrand: rect.left >= brand.left - 1 && rect.right <= brand.right + 1,
    };
  });
  expect(previewShape.square).toBeCloseTo(1, 2);
  expect(previewShape.belowTitle).toBe(true);
  expect(previewShape.insideBrand).toBe(true);
  for (const viewport of [{ width: 640, height: 360 }, { width: 844, height: 390 }, { width: 1280, height: 720 }, { width: 1600, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(80);
    const current = await page.evaluate(measure, selectors);
    for (const selector of selectors) {
      for (let index = 0; index < 4; index += 1) {
        expect(current[selector][index]).toBeCloseTo(baseline[selector][index], 3);
      }
    }
  }
});

test('keeps menu actions inside the card and preserves the lobby label', async ({ page }) => {
  test.slow();
  await page.goto('/');
  await page.waitForFunction(() => document.documentElement.dataset.menuReady === 'true', null, { timeout: 30_000 });
  for (const viewport of [{ width: 640, height: 360 }, { width: 844, height: 390 }, { width: 1280, height: 720 }, { width: 1600, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(80);
    const menu = await page.evaluate(() => {
      const card = document.querySelector('.menu-card');
      const actions = document.querySelector('.menu-actions');
      const mainMenu = document.querySelector('#main-menu');
      const cardRect = card.getBoundingClientRect();
      const mainMenuRect = mainMenu.getBoundingClientRect();
      const actionButtons = [...actions.querySelectorAll('button')].map((button) => {
        const rect = button.getBoundingClientRect();
        return { right: rect.right, bottom: rect.bottom, text: button.textContent.trim() };
      });
      return {
        overflow: getComputedStyle(card).overflowY,
        cardScrollHeight: card.scrollHeight,
        cardClientHeight: card.clientHeight,
        cardRight: cardRect.right,
        cardBottom: cardRect.bottom,
        topPadding: cardRect.top - mainMenuRect.top,
        bottomPadding: mainMenuRect.bottom - cardRect.bottom,
        actionButtons,
      };
    });
    expect(menu.overflow).toBe('hidden');
    expect(menu.cardScrollHeight - menu.cardClientHeight).toBeLessThanOrEqual(1);
    expect(Math.abs(menu.topPadding - menu.bottomPadding)).toBeLessThanOrEqual(1);
    for (const button of menu.actionButtons) {
      expect(button.right).toBeLessThanOrEqual(menu.cardRight + 1);
      expect(button.bottom).toBeLessThanOrEqual(menu.cardBottom + 1);
    }
  }

  await page.locator('#menu-internet').click();
  await page.locator('#nickname-input').press('Enter');
  await page.waitForSelector('#chat-panel:not(.hidden)');
  const chat = await page.evaluate(() => {
    const label = document.querySelector('.chat-lobby-label');
    const refresh = document.querySelector('#chat-room-refresh').getBoundingClientRect();
    const create = document.querySelector('#chat-room-create').getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    return {
      labelWidth: labelRect.width,
      labelScrollWidth: label.scrollWidth,
      labelRight: labelRect.right,
      refreshLeft: refresh.left,
      createLeft: create.left,
      hiddenRaceDisplay: getComputedStyle(document.querySelector('#chat-race')).display,
      hiddenStartDisplay: getComputedStyle(document.querySelector('#chat-start')).display,
    };
  });
  expect(chat.labelWidth).toBeGreaterThan(0);
  expect(chat.labelScrollWidth).toBeLessThanOrEqual(chat.labelWidth + 1);
  expect(chat.refreshLeft).toBeGreaterThanOrEqual(chat.labelRight - 1);
  expect(chat.createLeft).toBeGreaterThan(chat.refreshLeft);
  expect(chat.hiddenRaceDisplay).toBe('none');
  expect(chat.hiddenStartDisplay).toBe('none');
});

test('uses the full viewport for the portrait warning', async ({ page }) => {
  test.skip(test.info().project.name !== 'touch-landscape', 'Portrait warning is touch-only');
  await page.goto('/');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#orientation-warning')).toBeVisible();
  const geometry = await page.locator('#orientation-warning').evaluate((warning) => {
    const rect = warning.getBoundingClientRect();
    const text = warning.querySelector('span').getBoundingClientRect();
    return { warning: [rect.x, rect.y, rect.width, rect.height], text: [text.width, text.height] };
  });
  expect(geometry.warning).toEqual([0, 0, 390, 844]);
  expect(geometry.text[0]).toBeGreaterThan(0);
  expect(geometry.text[1]).toBeGreaterThan(20);
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
