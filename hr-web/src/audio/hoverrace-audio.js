import { assetUrl } from '../paths.js';

const SOUND_ROOT = assetUrl('sounds');
const SOUND_FILES = {
  motor: 'engine.wav',
  friction: 'engine2.wav',
  missile: 'missile.wav',
  bump: 'bounce.wav',
  jump: 'jump.wav',
  fire: 'firemissile.wav',
  lap: 'complete_lap.wav',
  finish: 'finish.wav',
  pickup: 'pickup.wav',
  spin: 'spin.wav',
  missileBounce: 'missilebounce.wav',
};
const LOOP_NAMES = ['motor', 'friction', 'missile'];

function soundUrl(name) {
  return `${SOUND_ROOT}/${SOUND_FILES[name]}`;
}

function mediaElement(name, loop = false) {
  const element = new Audio(soundUrl(name));
  element.preload = 'auto';
  element.loop = loop;
  element.playsInline = true;
  return element;
}

class HtmlAudioBackend {
  constructor() {
    this.kind = 'html-audio';
    this.loops = Object.fromEntries(LOOP_NAMES.map((name) => [name, mediaElement(name, true)]));
    this.loopState = new Map();
  }

  async prepare() {
    // Setting preload above is the only reliable cross-browser preload contract.
  }

  async unlock() {
    const attempts = Object.values(this.loops).map(async (element) => {
      element.muted = true;
      try {
        await element.play();
        element.pause();
        element.currentTime = 0;
        return true;
      } catch {
        return false;
      } finally {
        element.muted = false;
      }
    });
    return (await Promise.all(attempts)).every(Boolean);
  }

  setLoop(name, enabled, volume, playbackRate = 1) {
    const element = this.loops[name];
    const previous = this.loopState.get(name);
    if (!previous || Math.abs(previous.volume - volume) >= 0.01) element.volume = volume;
    if (!previous || Math.abs(previous.playbackRate - playbackRate) >= 0.02) {
      element.playbackRate = playbackRate;
    }
    if (enabled && element.paused) void element.play().catch(() => {});
    if (!enabled && !element.paused) element.pause();
    this.loopState.set(name, { enabled, volume, playbackRate });
  }

  playSample(name, volume) {
    const sample = mediaElement(name);
    sample.volume = volume;
    void sample.play().catch(() => {});
  }

  pause() {
    for (const element of Object.values(this.loops)) element.pause();
    this.loopState.clear();
  }
}

class WebAudioBackend {
  constructor(AudioContextClass) {
    this.kind = 'web-audio';
    this.context = new AudioContextClass({ latencyHint: 'interactive' });
    this.buffers = new Map();
    this.loops = new Map();
  }

  async prepare() {
    const entries = await Promise.all(Object.entries(SOUND_FILES).map(async ([name, file]) => {
      const response = await fetch(`${SOUND_ROOT}/${file}`);
      if (!response.ok) throw new Error(`Could not load sound ${file}: HTTP ${response.status}`);
      const data = await response.arrayBuffer();
      return [name, await this.context.decodeAudioData(data)];
    }));
    this.buffers = new Map(entries);
  }

  async unlock() {
    if (this.context.state === 'suspended') await this.context.resume();
    return this.context.state === 'running';
  }

  setLoop(name, enabled, volume, playbackRate = 1) {
    let loop = this.loops.get(name);
    if (!enabled) {
      if (loop) this.stopLoop(name, loop);
      return;
    }

    if (!loop) {
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      source.buffer = this.buffers.get(name);
      source.loop = true;
      source.connect(gain).connect(this.context.destination);
      source.start();
      loop = { source, gain, volume: -1, playbackRate: -1 };
      this.loops.set(name, loop);
    }

    const now = this.context.currentTime;
    if (Math.abs(loop.volume - volume) >= 0.01) {
      loop.gain.gain.setTargetAtTime(volume, now, 0.015);
      loop.volume = volume;
    }
    if (Math.abs(loop.playbackRate - playbackRate) >= 0.02) {
      loop.source.playbackRate.setTargetAtTime(playbackRate, now, 0.015);
      loop.playbackRate = playbackRate;
    }
  }

  stopLoop(name, loop) {
    this.loops.delete(name);
    loop.source.onended = () => {
      loop.source.disconnect();
      loop.gain.disconnect();
    };
    loop.source.stop();
  }

  playSample(name, volume) {
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = this.buffers.get(name);
    gain.gain.value = volume;
    source.connect(gain).connect(this.context.destination);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    source.start();
  }

  pause() {
    for (const [name, loop] of this.loops) this.stopLoop(name, loop);
  }
}

function preferredBackend() {
  const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (AudioContextClass) {
    try {
      return new WebAudioBackend(AudioContextClass);
    } catch (error) {
      console.warn('Web Audio initialization failed; using HTML audio fallback.', error);
    }
  }
  return new HtmlAudioBackend();
}

export class HoverRaceAudio {
  constructor(root = document) {
    this.backend = preferredBackend();
    this.preparePromise = null;
    this.unlocked = false;
    this.lastCollisionCount = 0;
    this.lastOnFloor = false;
    this.lastWeaponFires = 0;
    this.lastCompletedLaps = 0;
    this.lastPickups = 0;
    this.lastMissileBounces = 0;
    this.wasOutOfControl = false;
    this.publishBackend();

    const unlock = () => { void this.unlock(); };
    root.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
  }

  prepare() {
    if (!this.preparePromise) this.preparePromise = this.prepareBackend();
    return this.preparePromise;
  }

  async prepareBackend() {
    try {
      await this.backend.prepare();
    } catch (error) {
      console.warn('Web Audio preparation failed; using HTML audio fallback.', error);
      this.backend = new HtmlAudioBackend();
      await this.backend.prepare();
      this.publishBackend();
    }
  }

  publishBackend() {
    document.documentElement.dataset.audioBackend = this.backend.kind;
  }

  async unlock() {
    if (this.unlocked) return;
    // Call resume/play immediately in the input event stack for iOS Safari.
    const backendAtGesture = this.backend;
    const immediateUnlock = backendAtGesture.unlock();
    await this.prepare();
    this.unlocked = backendAtGesture === this.backend
      ? await immediateUnlock
      : await this.backend.unlock();
  }

  update(state) {
    if (!this.unlocked) return;

    const relativeSpeed = Math.abs(state.speed) / 19.3314;
    this.backend.setLoop('motor', state.motorOn, 0.42);
    this.backend.setLoop(
      'friction',
      relativeSpeed > 0.02,
      Math.min(0.62, Math.max(0, relativeSpeed * 0.48)),
      Math.min(2, Math.max(0.5, 1.5 * relativeSpeed)),
    );
    this.backend.setLoop(
      'missile',
      state.projectiles.some((projectile) => projectile.kind === 'missile' && !projectile.exploded),
      0.36,
    );

    if (state.collisionCount > this.lastCollisionCount) this.backend.playSample('bump', 0.72);
    if (this.lastOnFloor && !state.onFloor && state.velocity[2] > 0) {
      this.backend.playSample('jump', 0.72);
    }
    if (state.weaponFires > this.lastWeaponFires) this.backend.playSample('fire', 0.55);
    if (state.pickups > this.lastPickups) this.backend.playSample('pickup', 0.7);
    if (state.outOfControl > 0 && !this.wasOutOfControl) this.backend.playSample('spin', 0.7);
    if (state.missileBounces > this.lastMissileBounces) {
      this.backend.playSample('missileBounce', 0.62);
    }
    if (state.completedLaps > this.lastCompletedLaps) {
      this.backend.playSample(state.finished ? 'finish' : 'lap', 0.78);
    }
    this.lastCollisionCount = state.collisionCount;
    this.lastOnFloor = state.onFloor;
    this.lastWeaponFires = state.weaponFires;
    this.lastCompletedLaps = state.completedLaps;
    this.lastPickups = state.pickups;
    this.lastMissileBounces = state.missileBounces;
    this.wasOutOfControl = state.outOfControl > 0;
  }

  pause() {
    this.backend.pause();
  }
}
