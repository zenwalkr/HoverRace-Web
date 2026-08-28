import './styles.css';
import { HoverRaceAudio } from './audio/hoverrace-audio.js';
import { HoverRaceRenderer } from './render/hoverrace-renderer.js';
import { CRAFT_MODEL_BY_ASSET, RaceSimulation } from './game/simulation.js';
import { InputController } from './input/controller.js';
import { RaceNetwork } from './network/race-network.js';
import { PerformanceMonitor } from './performance-monitor.js';
import { TrackRadar } from './radar.js';
import { apiUrl, assetUrl } from './paths.js';
import { generateProceduralTrack } from './procedural-track.js';
import { parseClassicTrack } from './track-import.js';
import { downloadTrack } from './track-export.js';

const $ = (selector) => document.querySelector(selector);
const canvas = $('#game-canvas');
const stage = $('#stage');
const stageUi = $('#stage-ui');
const loading = $('#loading');
const loadingDetail = $('#loading-detail');
const loadingProgress = $('#loading-progress');
const diagnostics = $('#diagnostics');
const uiElements = ['#race-hud', '#speed-hud', '#track-label', '#radar', '#race-countdown', '#touch-controls', '#camera-button', '#chat-button', '#pause-button'];

// The reference screenshots were captured from an iPhone landscape viewport
// whose visible 16:9 game stage is 693.333 CSS pixels wide by 390 CSS pixels
// high. Keep the interface in that logical coordinate space and scale the
// complete layer as one unit so viewport size, browser chrome, and device
// pixel ratio cannot change the relative layout.
const REFERENCE_STAGE_WIDTH = 390 * 16 / 9;

function updateStageUiScale() {
  if (!stage || !stageUi) return;
  const width = stage.clientWidth;
  if (!width) return;
  stageUi.style.setProperty('--stage-scale', String(width / REFERENCE_STAGE_WIDTH));
}

if (stage && stageUi) {
  const stageResizeObserver = new ResizeObserver(updateStageUiScale);
  stageResizeObserver.observe(stage);
  window.addEventListener('resize', updateStageUiScale, { passive: true });
  updateStageUiScale();
}

function setProgress(value, detail) {
  loadingProgress.style.width = `${Math.round(value * 100)}%`;
  loadingDetail.textContent = detail;
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
  const milliseconds = Math.floor((totalSeconds % 1) * 1000).toString().padStart(3, '0');
  return `${minutes}:${seconds}.${milliseconds}`;
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

function playerIdentity() {
  const key = 'hoverrace-player-id';
  const nameKey = 'hoverrace-player-name';
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = globalThis.crypto?.randomUUID?.() ?? `player-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    sessionStorage.setItem(key, id);
  }
  const savedName = sessionStorage.getItem(nameKey);
  const guestName = `Guest${Math.floor(10_000 + Math.random() * 90_000)}`;
  return { id, name: savedName || guestName, nameKey, confirmed: Boolean(savedName) };
}

function setupNickname(identity) {
  const dialog = $('#nickname-dialog');
  const form = $('#nickname-form');
  const input = $('#nickname-input');
  const error = $('#nickname-error');
  let resolver = null;
  let touched = false;

  input.value = identity.name;
  input.addEventListener('pointerdown', () => {
    if (!touched) {
      input.value = '';
      touched = true;
    }
  });
  input.addEventListener('focus', () => {
    if (!touched) input.select();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = input.value.trim().replace(/\s+/g, ' ');
    if (!name) {
      error.textContent = 'ENTER A NAME OR USE THE GUEST NAME';
      input.focus({ preventScroll: true });
      return;
    }
    identity.name = name.slice(0, 24);
    identity.confirmed = true;
    sessionStorage.setItem(identity.nameKey, identity.name);
    dialog.classList.add('hidden');
    const next = resolver;
    resolver = null;
    next?.(true);
  });

  return () => {
    if (identity.confirmed) return Promise.resolve(true);
    dialog.classList.remove('hidden');
    error.textContent = '';
    input.value = identity.name;
    touched = false;
    input.focus({ preventScroll: true });
    input.select();
    return new Promise((resolve) => { resolver = resolve; });
  };
}

function setupChat(identity, requestNickname) {
  const panel = $('#chat-panel');
  const messages = $('#chat-messages');
  const status = $('#chat-status');
  const title = $('#chat-title');
  const input = $('#chat-input');
  const users = $('#chat-users');
  const games = $('#chat-games');
  const roomRefresh = $('#chat-room-refresh');
  const directory = $('#chat-directory');
  const roomBar = $('#chat-room-bar');
  let lastMessageId = 0;
  let messageRoom = null;
  let open = false;
  let polling = false;
  let selectedGame = null;
  let joinedGame = null;
  let trackProvider = () => 'ClassicH';
  let createGameHandler = null;
  let joinGameHandler = null;
  let leaveGameHandler = null;
  let startGameHandler = null;
  let joiningGame = false;
  let lastUsers = [];
  let lastGames = [];

  const privateRoom = () => joinedGame?.room && joinedGame.status !== 'waiting' ? joinedGame.room : 'lobby';
  const chatParameters = (room) => room === 'lobby' ? {} : {
    room, playerId: identity.id, token: joinedGame?.token,
  };
  const syncRoomView = () => {
    const room = privateRoom();
    if (room !== messageRoom) {
      messages.replaceChildren();
      lastMessageId = 0;
      messageRoom = room;
    }
    const privateChat = room !== 'lobby';
    panel.classList.toggle('private-chat', privateChat);
    title.textContent = privateChat ? `GAME CHAT · ${joinedGame?.name ?? 'RACE'}` : 'GENERAL CHAT';
    roomBar.classList.toggle('hidden', privateChat);
    directory.classList.toggle('hidden', privateChat);
    return room;
  };

  const setOpen = (value) => {
    open = value;
    panel.classList.toggle('hidden', !value);
    document.body.classList.toggle('chat-open', value);
    if (value) {
      syncRoomView();
      input.focus({ preventScroll: true });
      void refreshDirectory();
      void poll();
    } else {
      input.blur();
    }
  };

  const renderDirectory = (payload) => {
    lastUsers = payload.users ?? [];
    lastGames = payload.games ?? [];
    users.replaceChildren();
    for (const user of payload.users ?? []) {
      const item = document.createElement('li');
      item.textContent = user.name;
      users.append(item);
    }
    if (!users.childElementCount) {
      const empty = document.createElement('li');
      empty.className = 'directory-empty';
      empty.textContent = 'No other players online';
      users.append(empty);
    }

    const availableGames = payload.games ?? [];
    if (selectedGame && !availableGames.some((game) => game.id === selectedGame.id)) {
      if (!joinedGame || joinedGame.room !== selectedGame.id) selectedGame = null;
    }
    games.replaceChildren();
    for (const game of availableGames) {
      const item = document.createElement('li');
      item.className = game.id === selectedGame?.id ? 'selected' : '';
      const detail = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = game.name;
      const meta = document.createElement('small');
      meta.textContent = `${game.track} · ${(game.players ?? []).length}/${game.capacity}`;
      detail.append(title, meta);
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.gameId = game.id;
      button.textContent = game.id === joinedGame?.room ? 'JOINED' :
        (joiningGame && game.id === selectedGame?.id ? 'JOINING…' : 'JOIN');
      item.append(detail, button);
      games.append(item);
    }
    if (!games.childElementCount) {
      const empty = document.createElement('li');
      empty.className = 'directory-empty';
      empty.textContent = 'No games waiting';
      games.append(empty);
    }
    updateGameControls();
  };

  const updateGameControls = () => {
    const joinButton = $('#chat-race');
    const startButton = $('#chat-start');
    const canStart = joinedGame != null && joinedGame.isHost && joinedGame.status === 'waiting';
    // Game rows join directly; keep the legacy secondary control hidden.
    joinButton.classList.add('hidden');
    startButton.classList.toggle('hidden', !canStart);
    if (joinedGame) {
      joinButton.classList.add('hidden');
      status.textContent = joinedGame.status === 'waiting' ?
        (joinedGame.isHost ? 'WAITING · HOST' : 'WAITING FOR HOST') : 'STARTING';
    }
  };

  const refreshDirectory = async () => {
    if (privateRoom() !== 'lobby') return;
    try {
      await fetch(apiUrl('presence'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ playerId: identity.id, player: identity.name }),
      });
      const response = await fetch(apiUrl('rooms'), { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      renderDirectory(await response.json());
      status.textContent = 'ONLINE';
      status.classList.add('online');
    } catch {
      status.textContent = 'SERVER OFFLINE';
      status.classList.remove('online');
    }
  };

  const append = (message) => {
    const line = document.createElement('p');
    const player = document.createElement('strong');
    player.textContent = `${message.player}: `;
    line.append(player, document.createTextNode(message.message));
    messages.append(line);
    messages.scrollTop = messages.scrollHeight;
    lastMessageId = Math.max(lastMessageId, Number(message.id) || 0);
  };

  const poll = async () => {
    if (polling || !open) return;
    polling = true;
    try {
      const room = syncRoomView();
      const response = await fetch(apiUrl('chat', { since: lastMessageId, ...chatParameters(room) }), { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      for (const message of payload.messages) append(message);
      status.textContent = 'ONLINE';
      status.classList.add('online');
    } catch {
      status.textContent = 'SERVER OFFLINE';
      status.classList.remove('online');
    } finally {
      polling = false;
    }
  };

  $('#chat-button').addEventListener('click', (event) => {
    event.preventDefault();
    void requestNickname().then((accepted) => { if (accepted) setOpen(true); });
  });
  $('#chat-close').addEventListener('click', (event) => { event.preventDefault(); setOpen(false); });
  $('#chat-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    try {
      const response = await fetch(apiUrl('chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ player: identity.name, playerId: identity.id, message, ...chatParameters(syncRoomView()) }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      append(payload.message);
      status.textContent = 'ONLINE';
      status.classList.add('online');
    } catch {
      status.textContent = 'SEND FAILED';
      status.classList.remove('online');
      input.value = message;
    }
    input.focus({ preventScroll: true });
  });
  roomRefresh.addEventListener('click', (event) => { event.preventDefault(); void refreshDirectory(); });
  $('#chat-room-create').addEventListener('click', async (event) => {
    event.preventDefault();
    const name = window.prompt('Game name', 'HoverRace Game')?.trim();
    if (!name) return;
    try { await createGameHandler?.({ name, track: trackProvider() }); } catch {
      status.textContent = 'CREATE FAILED';
      status.classList.remove('online');
    }
  });
  $('#chat-race').addEventListener('click', (event) => {
    event.preventDefault();
    if (selectedGame && joinGameHandler) {
      void joinGameHandler(selectedGame.id).catch(() => {
        status.textContent = 'JOIN FAILED';
        status.classList.remove('online');
      });
    }
  });
  $('#chat-start').addEventListener('click', (event) => {
    event.preventDefault();
    if (joinedGame && startGameHandler) {
      void startGameHandler(joinedGame.room).catch(() => {
        status.textContent = 'START FAILED';
        status.classList.remove('online');
      });
    }
  });
  games.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-game-id]');
    if (!button || joiningGame) return;
    const nextGame = (lastGames ?? []).find((game) => game.id === button.dataset.gameId);
    if (!nextGame) return;
    selectedGame = nextGame;
    joiningGame = true;
    renderDirectory({ users: lastUsers ?? [], games: lastGames ?? [] });
    void (async () => {
      try {
        if (joinedGame?.room === nextGame.id) {
          await leaveGameHandler?.();
        } else {
          if (joinedGame) await leaveGameHandler?.();
          await joinGameHandler?.(nextGame.id);
        }
      } catch {
        status.textContent = 'JOIN FAILED';
        status.classList.remove('online');
      } finally {
        joiningGame = false;
        if (open) await refreshDirectory();
        updateGameControls();
      }
    })();
  });
  window.setInterval(() => { if (open) void refreshDirectory(); }, 2000);
  window.setInterval(() => { if (open) void poll(); }, 1800);
  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    setGameHandlers: ({ create, join, leave, start }) => {
      createGameHandler = create;
      joinGameHandler = join;
      leaveGameHandler = leave;
      startGameHandler = start;
    },
    setTrackProvider: (provider) => { trackProvider = provider; },
    setGameState: (state) => {
      joinedGame = state;
      selectedGame = state ? { id: state.room, name: state.name ?? 'Joined game' } : null;
      if (open) syncRoomView();
      updateGameControls();
    },
  };
}

async function boot() {
  const urlParams = new URLSearchParams(window.location.search);
  const identity = playerIdentity();
  const renderer = new HoverRaceRenderer(canvas);
  const performanceMonitor = new PerformanceMonitor(
    $('#performance-panel'), renderer, urlParams.get('perf') === '1');
  const radar = new TrackRadar($('#radar-canvas'));
  const input = new InputController(document);
  const audio = new HoverRaceAudio(document);
  const audioPreparation = audio.prepare();
  const requestNickname = setupNickname(identity);
  const chat = setupChat(identity, requestNickname);
  const networkStatus = $('#network-status');
  const network = new RaceNetwork(
    (players) => {
      renderer.setRemotePlayers(players);
      radar.setPlayers(players);
      radar.update(simulation?.state);
      simulation?.setRemotePlayers(players);
      const local = simulation?.state;
      const localProgress = local ? (local.finished ? 100 : local.lap * 3 + local.checkpoint) : 0;
      const ahead = players.filter((player) => {
        const remote = player.state;
        const progress = remote.finished ? 100 : remote.lap * 3 + (remote.checkpoint ?? 0);
        return progress > localProgress ||
          (progress === localProgress && remote.raceTime < (local?.raceTime ?? 0));
      }).length;
      $('#rank-value').textContent = `${ahead + 1} / ${players.length + 1}`;
      document.documentElement.dataset.remotePlayers = String(players.length);
      document.documentElement.dataset.racers = String(players.length + 1);
    },
    (status) => { networkStatus.textContent = status; },
    ({ startAt }) => { launchOnlineRace(startAt); },
  );
  const trackCache = new Map();
  const importedTracks = new Map();
  const generatedTracks = new Map();
  const craftCache = new Map();
  const allowedTracks = ['ClassicH', 'Steeplechase', 'The Alley2', 'The River'];
  const allowedCrafts = ['basic_craft', 'cx_craft', 'bi_craft', 'eon_craft'];
  let selectedTrack = allowedTracks.includes(urlParams.get('track')) ? urlParams.get('track') : 'ClassicH';
  let selectedCraft = allowedCrafts.includes(urlParams.get('craft')) ? urlParams.get('craft') : 'basic_craft';
  let activeTrack = 'ClassicH';
  let activeCraft = 'basic_craft';
  let racing = false;
  let cameraMode = 0;
  let onlineEnabled = urlParams.get('online') === '1';
  let onlineRoom = urlParams.get('room') ?? 'lobby';
  let finishShown = false;
  const countdownMs = urlParams.get('skipCountdown') === '1' ? 0 : 6000;
  chat.setTrackProvider(() => ({ id: selectedTrack, data: importedTracks.get(selectedTrack) ?? null }));

  const trackSelect = $('#track-select');
  const trackImport = $('#track-import');
  const trackFile = $('#track-file');
  const importedTrackOptions = $('#imported-track-options');
  const trackImportStatus = $('#track-import-status');
  const trackRemove = $('#track-remove');
  const trackPreview = $('#track-preview');
  const trackPreviewName = $('#track-preview-name');
  const proceduralControls = $('#procedural-controls');
  const proceduralSeed = $('#procedural-seed');
  const proceduralGenerate = $('#procedural-generate');
  const generatedTrackTools = $('#generated-track-tools');
  let importedTrackNumber = 0;
  let selectedEngine = null;
  let trackStatusKind = '';
  let previewRequest = 0;

  const randomProceduralSeed = () => {
    const values = new Uint32Array(1);
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(values);
    else values[0] = Math.floor(Math.random() * 4_294_967_295) + 1;
    return Math.max(1, values[0] >>> 0);
  };

  const displayTrackName = (name) => {
    const text = String(name ?? '');
    return text.length > 10 ? `${text.slice(0, 10)}...` : text;
  };

  const updateGeneratedTools = () => {
    generatedTrackTools.classList.toggle('hidden', !generatedTracks.has(selectedTrack));
  };

  const updateTrackRemoval = () => {
    const removable = importedTracks.has(selectedTrack) && !allowedTracks.includes(selectedTrack);
    trackRemove.classList.toggle('hidden', !removable);
  };

  const drawTrackPreview = (track) => {
    const context = trackPreview?.getContext('2d');
    if (!context) return;
    const width = trackPreview.width;
    const height = trackPreview.height;
    const rooms = (track?.rooms ?? []).filter((room) => Array.isArray(room?.vertices));
    const points = rooms.flatMap((room) => room.vertices
      .map((vertex) => vertex.point)
      .filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])));
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#020b0e';
    context.fillRect(0, 0, width, height);
    if (!points.length) return;
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, maxY - minY, 1);
    const squareMinX = (minX + maxX - span) / 2;
    const squareMinY = (minY + maxY - span) / 2;
    const padding = 24;
    const project = ([x, y]) => [
      padding + (x - squareMinX) * (width - padding * 2) / span,
      height - padding - (y - squareMinY) * (height - padding * 2) / span,
    ];
    const finishRooms = new Set((track.actors ?? [])
      .filter((actor) => actor?.type === 'finish')
      .map((actor) => actor.classifiedRoom));
    context.lineJoin = 'round';
    context.lineWidth = 2;
    for (const [index, room] of rooms.entries()) {
      const roomPoints = room.vertices.map((vertex) => project(vertex.point));
      if (roomPoints.length < 3) continue;
      context.beginPath();
      context.moveTo(...roomPoints[0]);
      for (const point of roomPoints.slice(1)) context.lineTo(...point);
      context.closePath();
      context.fillStyle = finishRooms.has(index) ? 'rgba(228, 119, 49, 0.72)' : 'rgba(89, 171, 184, 0.3)';
      context.fill();
      context.strokeStyle = finishRooms.has(index) ? '#ffad62' : '#4fe0ef';
      context.stroke();
    }
    context.fillStyle = '#ff9b31';
    context.strokeStyle = '#32170b';
    context.lineWidth = 1.5;
    for (const start of (track.starts ?? [])) {
      const point = project(start.position);
      context.beginPath();
      context.arc(point[0], point[1], 5, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
    context.strokeStyle = '#67e8fa';
    context.lineWidth = 2;
    context.strokeRect(1, 1, width - 2, height - 2);
  };

  const updateTrackPreview = async (trackId = selectedTrack, knownTrack = null) => {
    const request = ++previewRequest;
    let track = knownTrack ?? trackCache.get(trackId) ?? importedTracks.get(trackId) ?? null;
    trackPreviewName.textContent = displayTrackName(track?.title ?? trackId).toUpperCase();
    trackPreview.dataset.track = trackId;
    if (!track && allowedTracks.includes(trackId)) {
      try {
        track = await fetchJson(assetUrl('tracks', `${trackId}.json`));
        trackCache.set(trackId, track);
      } catch {
        track = null;
      }
    }
    if (request !== previewRequest || trackId !== selectedTrack) return;
    drawTrackPreview(track);
  };

  const selectTrack = (trackId) => {
    selectedTrack = trackId;
    if (trackStatusKind === 'generated' && !generatedTracks.has(trackId)) {
      trackImportStatus.textContent = '';
      trackStatusKind = '';
    }
    const generated = generatedTracks.get(trackId);
    selectedEngine = generated?.size ?? null;
    if (generated) {
      proceduralSeed.value = String(generated.seed);
      proceduralControls.classList.remove('hidden');
    } else {
      proceduralControls.classList.add('hidden');
    }
    trackSelect.value = selectedTrack;
    updateGeneratedTools();
    updateTrackRemoval();
    void updateTrackPreview(selectedTrack);
  };

  const addTrackOption = (trackId, label, track, title = label, select = true) => {
    importedTracks.set(trackId, track);
    trackCache.set(trackId, track);
    const option = document.createElement('option');
    option.value = trackId;
    option.dataset.importedTrack = 'true';
    option.textContent = label.slice(0, 48);
    option.title = title;
    importedTrackOptions.append(option);
    importedTrackOptions.hidden = false;
    if (select) selectTrack(trackId);
  };

  const validateImportedTrack = (value) => {
    const track = value?.track && typeof value.track === 'object' ? value.track : value;
    if (!track || !Array.isArray(track.starts) || !track.starts.length ||
        !Array.isArray(track.rooms) || !track.rooms.length) {
      throw new Error('Track JSON must contain at least one start and one room');
    }
    for (const room of track.rooms) {
      if (!Array.isArray(room.vertices) || room.vertices.length < 3 ||
          !Array.isArray(room.neighbors)) throw new Error('Track room geometry is incomplete');
    }
    return {
      ...track,
      features: Array.isArray(track.features) ? track.features : [],
      actors: Array.isArray(track.actors) ? track.actors : [],
    };
  };

  const addImportedTrack = (file, track) => {
    importedTrackNumber += 1;
    const baseName = file.name.replace(/\.(json|trk)$/i, '').trim() || `Imported Track ${importedTrackNumber}`;
    const trackId = `imported-${importedTrackNumber}-${baseName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    addTrackOption(trackId, baseName, track, file.name);
  };

  const generateSelectedProcedural = () => {
    if (!selectedEngine) return;
    const seed = Math.max(1, Math.min(4_294_967_295, Math.trunc(Number(proceduralSeed.value) || 1)));
    proceduralSeed.value = String(seed);
    const track = generateProceduralTrack(selectedEngine, seed);
    const trackId = `imported-generated-${selectedEngine}-${seed}`;
    generatedTracks.set(trackId, track);
    importedTrackOptions.querySelector(`[value="${trackId}"]`)?.remove();
    addTrackOption(trackId, `${selectedEngine.toUpperCase()} · ${seed}`, track, track.title, false);
    selectedTrack = trackId;
    trackSelect.value = `engine:${selectedEngine}`;
    proceduralControls.classList.remove('hidden');
    updateGeneratedTools();
    updateTrackRemoval();
    trackStatusKind = 'generated';
    trackImportStatus.textContent = `${track.title} generated`;
    void updateTrackPreview(trackId, track);
  };
  trackSelect.addEventListener('change', () => {
    const value = trackSelect.value;
    if (value.startsWith('engine:')) {
      selectedEngine = value.slice('engine:'.length);
      proceduralSeed.value = String(randomProceduralSeed());
      proceduralControls.classList.remove('hidden');
      generateSelectedProcedural();
      return;
    }
    selectTrack(value);
  });
  trackRemove.addEventListener('click', (event) => {
    event.preventDefault();
    const trackId = selectedTrack;
    if (!importedTracks.has(trackId) || allowedTracks.includes(trackId)) return;
    importedTracks.delete(trackId);
    generatedTracks.delete(trackId);
    trackCache.delete(trackId);
    [...importedTrackOptions.querySelectorAll('option')]
      .find((option) => option.value === trackId)?.remove();
    selectTrack('ClassicH');
    trackStatusKind = 'removed';
    trackImportStatus.textContent = 'Track removed';
  });
  proceduralGenerate.addEventListener('click', (event) => {
    event.preventDefault();
    generateSelectedProcedural();
  });
  proceduralSeed.addEventListener('change', () => generateSelectedProcedural());
  $('#export-track-json').addEventListener('click', () => {
    const track = generatedTracks.get(selectedTrack);
    if (track) downloadTrack(track, 'json');
  });
  $('#export-track-trk').addEventListener('click', () => {
    const track = generatedTracks.get(selectedTrack);
    if (track) downloadTrack(track, 'trk');
  });

  trackImport.addEventListener('click', (event) => {
    event.preventDefault();
    trackFile.click();
  });
  trackFile.addEventListener('change', async () => {
    const files = [...(trackFile.files ?? [])];
    if (!files.length) return;
    let imported = 0;
    const errors = [];
    for (const file of files) {
      try {
        const isNativeTrack = file.name.toLowerCase().endsWith('.trk');
        const track = isNativeTrack
          ? parseClassicTrack(await file.arrayBuffer(), file.name)
          : validateImportedTrack(JSON.parse(await file.text()));
        addImportedTrack(file, track);
        imported += 1;
      } catch (error) {
        errors.push(`${file.name}: ${error.message}`);
      }
    }
    trackImportStatus.textContent = errors.length
      ? `${imported} imported · ${errors.join(' · ')}`
      : `${imported} track${imported === 1 ? '' : 's'} imported`;
    trackStatusKind = 'imported';
    trackFile.value = '';
  });

  setProgress(0.08, 'Reading original texture catalog…');
  await renderer.loadTextureCatalog();

  setProgress(0.24, 'Decoding ClassicH track sections…');
  const track = await fetchJson(assetUrl('tracks', 'ClassicH.json'));
  trackCache.set('ClassicH', track);
  radar.setTrack(track);
  $('#track-name').textContent = displayTrackName('ClassicH');
  void updateTrackPreview('ClassicH', track);

  setProgress(0.42, `Building ${track.rooms.length} rooms and ${track.features.length} features…`);
  await renderer.buildTrack(track);

  setProgress(0.78, 'Building original Basic hovercraft patch mesh…');
  const craft = await fetchJson(assetUrl('meshes', 'basic_craft.json'));
  craftCache.set('basic_craft', craft);
  await renderer.buildCraft(craft);
  setProgress(0.92, 'Preparing graphics and audio…');
  await Promise.all([renderer.warmup(), audioPreparation]);

  let simulation = new RaceSimulation(track, CRAFT_MODEL_BY_ASSET[selectedCraft]);
  $('#camera-button').addEventListener('click', (event) => {
    event.preventDefault();
    cameraMode = (cameraMode + 1) % 3;
    renderer.setCameraMode(cameraMode);
  });
  const setPaused = (value) => {
    document.body.classList.toggle('paused', value);
    $('#pause-screen').classList.toggle('hidden', !value);
    input.releaseAll();
    if (value) audio.pause();
  };
  $('#pause-button').addEventListener('click', (event) => {
    event.preventDefault();
    setPaused(!document.body.classList.contains('paused'));
  });

  const leaveCurrentGame = () => {
    racing = false;
    setPaused(false);
    void network.leave();
    onlineEnabled = false;
    chat.setGameState(null);
    input.releaseAll();
    $('#race-result').classList.add('hidden');
    networkStatus.classList.add('hidden');
    for (const selector of uiElements) $(selector).classList.add('hidden');
    $('#pause-screen').classList.add('hidden');
    $('#main-menu').classList.remove('hidden');
  };

  for (const button of document.querySelectorAll('[data-menu-craft]')) {
    button.classList.toggle('selected', button.dataset.menuCraft === selectedCraft);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      selectedCraft = button.dataset.menuCraft;
      for (const option of document.querySelectorAll('[data-menu-craft]')) option.classList.toggle('selected', option === button);
    });
  }

  function showRace() {
    $('#main-menu').classList.add('hidden');
    for (const selector of uiElements) $(selector).classList.remove('hidden');
    const info = renderer.diagnostics();
    const currentTrack = trackCache.get(activeTrack);
    diagnostics.value = `${info.webgl} · ${currentTrack.rooms.length} rooms · ${info.floors} floors · ${info.walls} source walls · ${info.trackBatches} track batches · ${info.actorMeshes} track actors · ${info.craftPatches} craft patches`;
  }

  function placeAtStart(session, currentTrack) {
    document.documentElement.dataset.startSlot = String(session.startSlot);
    const start = currentTrack.starts[session.startSlot % currentTrack.starts.length];
    simulation.state.position = [...start.position];
    simulation.state.room = start.room;
    simulation.state.orientation = start.orientation;
    simulation.state.cabinOrientation = start.orientation;
    simulation.snapInterpolation();
  }

  function launchOnlineRace(startAt) {
    if (racing || !simulation || !network.session) return;
    const currentTrack = trackCache.get(activeTrack);
    showRace();
    placeAtStart(network.session, currentTrack);
    simulation.state.countdown = Math.max(0, Number(startAt) - (Date.now() + network.clockOffset));
    simulation.resetClock(performance.now());
    network.beginRace();
    chat.setGameState({ ...network.session, status: 'starting' });
    chat.close();
    racing = true;
    document.documentElement.dataset.ready = 'true';
  }

  const startRace = async ({ session = null, requireOnline = false } = {}) => {
    const menuStatus = $('#menu-status');
    menuStatus.textContent = 'LOADING';
    finishShown = false;
    // Stop the previous frame from continuing to tick while a new race is
    // being assembled. This is especially important after leaving a race
    // during its countdown and immediately starting practice again.
    racing = false;
    $('#race-result').classList.add('hidden');
    input.releaseAll();
    document.body.classList.remove('paused');
    let graphicsChanged = false;

    // A joined session is authoritative. For an imported track, the server
    // returns the track payload so this browser can build it before waiting
    // for the synchronized race countdown.
    if (session?.track && session.track !== selectedTrack) selectedTrack = session.track;
    if (session?.trackData) trackCache.set(session.track, session.trackData);

    if (activeTrack !== selectedTrack) {
      const nextTrack = trackCache.get(selectedTrack) ?? await fetchJson(assetUrl('tracks', `${selectedTrack}.json`));
      trackCache.set(selectedTrack, nextTrack);
      await renderer.buildTrack(nextTrack);
      radar.setTrack(nextTrack);
      simulation = new RaceSimulation(nextTrack, CRAFT_MODEL_BY_ASSET[selectedCraft], { countdownMs });
      activeTrack = selectedTrack;
      graphicsChanged = true;
    } else {
      simulation = new RaceSimulation(trackCache.get(activeTrack), CRAFT_MODEL_BY_ASSET[selectedCraft], { countdownMs });
    }
    if (activeCraft !== selectedCraft) {
      const nextCraft = craftCache.get(selectedCraft) ?? await fetchJson(assetUrl('meshes', `${selectedCraft}.json`));
      craftCache.set(selectedCraft, nextCraft);
      await renderer.buildCraft(nextCraft);
      activeCraft = selectedCraft;
      simulation = new RaceSimulation(trackCache.get(activeTrack), CRAFT_MODEL_BY_ASSET[activeCraft], { countdownMs });
      graphicsChanged = true;
    }
    // A track switch can introduce new materials, but shader compilation must
    // not block the new race from starting. Waiting here leaves the previous
    // countdown on screen while `racing` is false, which looks like a frozen
    // countdown after leaving a race and selecting another map.
    if (graphicsChanged) void renderer.warmup().catch((error) => {
      console.warn('Track shader warm-up failed; shaders will compile on demand.', error);
    });

    $('#track-name').textContent = displayTrackName(selectedTrack);
    const inspectActor = urlParams.get('inspectActor');
    if (inspectActor) {
      const currentTrack = trackCache.get(activeTrack);
      const actor = currentTrack.actors?.find((entry) => entry.type === inspectActor);
      const room = actor ? currentTrack.rooms[actor.classifiedRoom] : null;
      if (actor && room) {
        const centroid = room.vertices.reduce((sum, vertex) =>
          [sum[0] + vertex.point[0], sum[1] + vertex.point[1]], [0, 0])
          .map((component) => component / room.vertices.length);
        const dx = centroid[0] - actor.position[0];
        const dy = centroid[1] - actor.position[1];
        const distance = Math.hypot(dx, dy) || 1;
        simulation.state.position = [
          actor.position[0] + dx / distance * 5000,
          actor.position[1] + dy / distance * 5000,
          room.floor,
        ];
        simulation.state.room = actor.classifiedRoom;
        simulation.state.orientation = ((Math.round(Math.atan2(-dy, -dx) * 4096 / (Math.PI * 2)) % 4096) + 4096) % 4096;
        simulation.state.cabinOrientation = simulation.state.orientation;
        simulation.snapInterpolation();
      }
    }
    const currentTrack = trackCache.get(activeTrack);
    networkStatus.classList.toggle('hidden', !onlineEnabled);
    if (onlineEnabled) {
      if (!session) network.stop();
      networkStatus.textContent = 'CONNECTING';
      try {
        const joined = session ?? await network.join({
          room: onlineRoom, playerId: identity.id, player: identity.name,
          craft: activeCraft,
        });
        placeAtStart(joined, currentTrack);
        chat.setGameState(joined);
        document.documentElement.dataset.ready = 'true';
        return;
      } catch {
        networkStatus.textContent = 'SERVER OFFLINE · LOCAL RACE';
        if (requireOnline) throw new Error('Unable to join the online game');
      }
    }
    showRace();
    simulation.state.countdown = countdownMs;
    simulation.resetClock(performance.now());
    simulation.snapInterpolation();
    racing = true;
    document.documentElement.dataset.ready = 'true';
  };

  chat.setGameHandlers({
    create: async ({ name, track }) => {
      onlineEnabled = true;
      const payload = await network.createGame({
        name, track: track.id, trackData: track.data, craft: selectedCraft,
        playerId: identity.id, player: identity.name,
      });
      onlineRoom = payload.session.room;
      await startRace({ session: payload.session, requireOnline: true });
    },
    join: async (room) => {
      onlineEnabled = true;
      onlineRoom = room;
      const session = await network.join({ room, playerId: identity.id, player: identity.name, craft: selectedCraft });
      await startRace({ session, requireOnline: true });
    },
    leave: async () => {
      await network.leave();
      onlineEnabled = false;
      onlineRoom = 'lobby';
      chat.setGameState(null);
    },
    start: async () => { await network.start(); },
  });

  $('#menu-start').addEventListener('click', (event) => { event.preventDefault(); void startRace(); });
  $('#menu-internet').addEventListener('click', (event) => { event.preventDefault(); void requestNickname().then((accepted) => { if (accepted) chat.open(); }); });
  $('#race-again').addEventListener('click', (event) => { event.preventDefault(); void startRace(); });
  $('#race-menu').addEventListener('click', (event) => { event.preventDefault(); leaveCurrentGame(); });
  $('#leave-button').addEventListener('click', (event) => { event.preventDefault(); leaveCurrentGame(); });

  setProgress(1, 'Ready');
  await new Promise((resolve) => setTimeout(resolve, 180));
  loading.classList.add('hidden');
  document.documentElement.dataset.menuReady = 'true';
  if (urlParams.get('autostart') === '1') {
    await startRace();
  } else {
    $('#main-menu').classList.remove('hidden');
  }

  const frame = (time) => {
    const measuring = performanceMonitor.enabled;
    const frameStart = measuring ? performance.now() : 0;
    const active = racing && !document.body.classList.contains('paused');
    let simulationTime = 0;
    let sceneTime = 0;
    if (active) {
      const simulationStart = measuring ? performance.now() : 0;
      const state = simulation.tick(time, input.state);
      const renderState = simulation.interpolatedState();
      if (measuring) simulationTime = performance.now() - simulationStart;
      const sceneStart = measuring ? performance.now() : 0;
      renderer.update(renderState, time);
      radar.update(renderState);
      audio.update(state, input.state);
      network.update(state);
      $('#speed-value').textContent = Math.round(Math.abs(state.speed) * 3.6);
      $('#fuel-value').style.width = `${Math.round(state.fuel * 100)}%`;
      $('#time-value').textContent = formatTime(state.raceTime);
      $('#lap-value').textContent = `${state.lap} / 3`;
      const countdown = $('#race-countdown');
      countdown.classList.toggle('hidden', state.countdown <= 0);
      $('#countdown-value').textContent = (state.countdown / 1000).toFixed(2);
      if (state.finished && !finishShown) {
        finishShown = true;
        input.releaseAll();
        $('#race-result-time').textContent = formatTime(state.raceTime);
        $('#race-result').classList.remove('hidden');
      }
      document.documentElement.dataset.projectiles = String(state.projectiles.length);
      document.documentElement.dataset.remoteCrafts = String(renderer.remoteCraftCount());
      const fireButton = document.querySelector('[data-action="weapon"]');
      const itemButton = document.querySelector('[data-action="boost"]');
      if (fireButton) fireButton.textContent = state.weapon === 'missile' ? 'MISSILE' : 'USE';
      if (itemButton) {
        const count = state.weapon === 'mine' ? state.mineCount :
          state.weapon === 'powerup' ? state.powerupCount : '';
        itemButton.textContent = 'BOOST';
        itemButton.title = `Boost and gas · ${state.weapon.toUpperCase()}${count === '' ? '' : ` ${count}`}`;
      }
      if (measuring) sceneTime = performance.now() - sceneStart;
    } else if (racing) {
      simulation.resetClock(time);
    } else {
      const sceneStart = measuring ? performance.now() : 0;
      renderer.update(simulation.state, time);
      radar.update(simulation.state);
      if (measuring) sceneTime = performance.now() - sceneStart;
    }
    const renderStart = measuring ? performance.now() : 0;
    renderer.render();
    if (measuring) {
      const renderTime = performance.now() - renderStart;
      performanceMonitor.frame(time, {
        cpu: performance.now() - frameStart,
        simulation: simulationTime,
        scene: sceneTime,
        render: renderTime,
      }, active ? simulation.lastStepCount : 0, active);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

boot().catch((error) => {
  console.error(error);
  loading.classList.add('failed');
  loadingDetail.textContent = `Port failed to start: ${error.message}`;
  diagnostics.value = error.stack ?? error.message;
});
