const ACTIONS = ['left', 'right', 'throttle', 'brake', 'jump', 'weapon', 'changeItem', 'boost'];

export class InputController {
  constructor(root = document) {
    this.state = Object.fromEntries(ACTIONS.map((action) => [action, false]));
    this.pointerActions = new Map();
    this.lastThrottleTapAt = 0;
    this.jumpPulseTimer = null;
    this.jumpPulseActive = false;
    this.bindKeyboard();
    this.bindTouch(root);
    this.disableBrowserGestures(root);
  }

  bindKeyboard() {
    const keys = new Map([
      ['ArrowLeft', 'left'], ['KeyA', 'left'],
      ['ArrowRight', 'right'], ['KeyD', 'right'],
      ['ArrowUp', 'throttle'], ['KeyW', 'throttle'],
      ['ArrowDown', 'brake'], ['KeyS', 'brake'],
      ['Space', 'jump'],
      ['KeyF', 'weapon'],
      ['KeyE', 'changeItem'], ['Tab', 'changeItem'],
      ['KeyB', 'boost'],
    ]);
    const setKey = (event, pressed) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ||
          target?.isContentEditable) return;
      const action = keys.get(event.code);
      if (!action) return;
      event.preventDefault();
      this.state[action] = pressed;
    };
    window.addEventListener('keydown', (event) => setKey(event, true), { passive: false });
    window.addEventListener('keyup', (event) => setKey(event, false), { passive: false });
    window.addEventListener('blur', () => this.releaseAll());
  }

  bindTouch(root) {
    for (const button of root.querySelectorAll('[data-action]')) {
      const action = button.dataset.action;
      const actions = (button.dataset.actions ?? action).split(/[\s,]+/).filter(Boolean);
      const press = (event) => {
        event.preventDefault();
        button.setPointerCapture?.(event.pointerId);
        this.pointerActions.set(event.pointerId, actions);
        for (const pressedAction of actions) this.state[pressedAction] = true;
        // A quick second tap on the gas button requests one jump while the
        // normal throttle action remains held for this pointer.
        if (action === 'throttle') {
          const now = performance.now();
          if (now - this.lastThrottleTapAt <= 320) {
            this.jumpPulseActive = true;
            this.state.jump = true;
            clearTimeout(this.jumpPulseTimer);
            this.jumpPulseTimer = setTimeout(() => {
              this.jumpPulseActive = false;
              this.state.jump = [...this.pointerActions.values()]
                .some((activeActions) => activeActions.includes('jump'));
            }, 90);
            this.lastThrottleTapAt = 0;
          } else {
            this.lastThrottleTapAt = now;
          }
        }
        button.classList.add('pressed');
      };
      const release = (event) => {
        event.preventDefault();
        const releasedActions = this.pointerActions.get(event.pointerId) ?? actions;
        this.pointerActions.delete(event.pointerId);
        for (const releasedAction of releasedActions) {
          this.state[releasedAction] = [...this.pointerActions.values()]
            .some((activeActions) => activeActions.includes(releasedAction));
        }
        button.classList.remove('pressed');
      };
      button.addEventListener('pointerdown', press, { passive: false });
      button.addEventListener('pointerup', release, { passive: false });
      button.addEventListener('pointercancel', release, { passive: false });
      button.addEventListener('lostpointercapture', release, { passive: false });
    }
  }

  disableBrowserGestures(root) {
    for (const eventName of ['contextmenu', 'selectstart', 'dragstart']) {
      root.addEventListener(eventName, (event) => event.preventDefault(), { passive: false });
    }
    // CSS touch-action:none and overscroll-behavior:none already suppress
    // panning. A document-wide non-passive touchmove listener makes iOS Safari
    // synchronize every thumb movement with the main thread and can disturb
    // requestAnimationFrame pacing while driving.
    root.addEventListener('gesturestart', (event) => event.preventDefault(), { passive: false });
  }

  releaseAll() {
    for (const action of ACTIONS) this.state[action] = false;
    this.pointerActions.clear();
    clearTimeout(this.jumpPulseTimer);
    this.jumpPulseActive = false;
    this.lastThrottleTapAt = 0;
    for (const button of document.querySelectorAll('[data-action].pressed')) button.classList.remove('pressed');
  }
}
