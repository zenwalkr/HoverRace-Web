import { apiUrl } from '../paths.js';

const PUBLISH_INTERVAL_MS = 100;
const WAIT_INTERVAL_MS = 250;

export class RaceNetwork {
  constructor(onPlayers, onStatus = () => {}, onStart = () => {}) {
    this.onPlayers = onPlayers;
    this.onStatus = onStatus;
    this.onStart = onStart;
    this.session = null;
    this.latestState = null;
    this.publishTimer = null;
    this.waitTimer = null;
    this.publishing = false;
    this.polling = false;
    this.startNotified = false;
    this.clockOffset = 0;
  }

  async createGame({ name, track, trackData = null, craft, playerId, player }) {
    this.stop();
    const response = await fetch(apiUrl('rooms'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ name, track, trackData, craft, playerId, player }),
    });
    if (!response.ok) throw new Error(`Game creation failed: HTTP ${response.status}`);
    const payload = await response.json();
    this.setSession(payload.session);
    return payload;
  }

  async join({ room, playerId, player = 'Player', craft }) {
    this.stop();
    const response = await fetch(apiUrl('race_join'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ room, playerId, player, craft }),
    });
    if (!response.ok) throw new Error(`Game join failed: HTTP ${response.status}`);
    const payload = await response.json();
    this.setSession(payload.session);
    return payload.session;
  }

  async start() {
    if (!this.session) throw new Error('No waiting game selected');
    const response = await fetch(apiUrl('race_start'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ room: this.session.room, token: this.session.token }),
    });
    if (!response.ok) throw new Error(`Game start failed: HTTP ${response.status}`);
    const payload = await response.json();
    this.applyStart(payload);
    return payload;
  }

  beginRace() {
    if (!this.session) return;
    this.clearWaitTimer();
    this.session.status = 'starting';
    this.startNotified = true;
    if (this.publishTimer == null) {
      this.publishTimer = window.setInterval(() => { void this.publish(); }, PUBLISH_INTERVAL_MS);
    }
  }

  update(state) {
    if (!this.session || this.session.status === 'waiting') return;
    this.latestState = {
      position: state.position,
      velocity: state.velocity,
      orientation: state.orientation,
      cabinOrientation: state.cabinOrientation,
      room: state.room,
      raceTime: state.raceTime,
      motorOn: state.motorOn,
      lap: state.lap,
      checkpoint: state.checkpoint,
      finished: state.finished,
      actorVisible: state.actorVisible,
      actorFrames: state.actorFrames,
      projectiles: state.projectiles,
    };
  }

  async leave() {
    const session = this.session;
    this.clearTimers();
    this.session = null;
    this.latestState = null;
    this.onPlayers([]);
    if (!session) return;
    try {
      await fetch(apiUrl('race_leave'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ room: session.room, token: session.token }),
        keepalive: true,
      });
    } catch {
      // The server will expire an abandoned player by heartbeat timeout.
    }
  }

  stop() {
    const session = this.session;
    this.clearTimers();
    this.session = null;
    this.latestState = null;
    this.onPlayers([]);
    if (session) {
      void fetch(apiUrl('race_leave'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ room: session.room, token: session.token }),
        keepalive: true,
      }).catch(() => {});
    }
  }

  setSession(session) {
    this.session = { ...session };
    this.latestState = null;
    this.startNotified = false;
    this.clockOffset = Number(session.serverTime ?? Date.now()) - Date.now();
    this.onStatus(session.isHost ? 'WAITING · HOST' : 'WAITING FOR HOST');
    this.waitTimer = window.setInterval(() => { void this.pollRaceState(); }, WAIT_INTERVAL_MS);
    void this.pollRaceState();
  }

  async pollRaceState() {
    if (!this.session || this.polling) return;
    this.polling = true;
    try {
      const response = await fetch(apiUrl('race_state', {
        room: this.session.room,
        token: this.session.token,
      }), { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      this.clockOffset = Number(payload.serverTime ?? Date.now()) - Date.now();
      this.session.status = payload.status;
      this.session.startAt = payload.startAt;
      this.publishPlayers(payload.players ?? []);
      if ((payload.status === 'starting' || payload.status === 'racing') && payload.startAt != null && !this.startNotified) {
        this.startNotified = true;
        this.onStart({ startAt: Number(payload.startAt), serverTime: Number(payload.serverTime) });
      }
      if (payload.status === 'starting') this.onStatus('STARTING · SYNCHRONIZING');
      else if (payload.status === 'racing') this.onStatus(`ONLINE · ${payload.players?.length ?? 0} RACERS`);
    } catch {
      this.onStatus('RECONNECTING');
    } finally {
      this.polling = false;
    }
  }

  async publish() {
    if (!this.session || !this.latestState || this.publishing) return;
    this.publishing = true;
    try {
      const response = await fetch(apiUrl('race_state'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ room: this.session.room, token: this.session.token, state: this.latestState }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      this.publishPlayers(payload.players ?? []);
      this.onStatus(`ONLINE · ${payload.players?.length ?? 0} RACERS`);
    } catch {
      this.onStatus('RECONNECTING');
    } finally {
      this.publishing = false;
    }
  }

  publishPlayers(players) {
    const peers = players.filter((player) =>
      player.id !== this.session?.playerId && player.track === this.session?.track && player.state);
    this.onPlayers(peers);
  }

  applyStart(payload) {
    if (!this.session) return;
    this.clockOffset = Number(payload.serverTime ?? Date.now()) - Date.now();
    this.session.status = payload.status;
    this.session.startAt = Number(payload.startAt);
    if (!this.startNotified) {
      this.startNotified = true;
      this.onStart({ startAt: this.session.startAt, serverTime: Number(payload.serverTime) });
    }
  }

  clearWaitTimer() {
    if (this.waitTimer != null) window.clearInterval(this.waitTimer);
    this.waitTimer = null;
  }

  clearTimers() {
    this.clearWaitTimer();
    if (this.publishTimer != null) window.clearInterval(this.publishTimer);
    this.publishTimer = null;
    this.publishing = false;
    this.polling = false;
  }
}
