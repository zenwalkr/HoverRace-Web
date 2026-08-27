function percentile(values, amount) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * amount) - 1)];
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export class PerformanceMonitor {
  constructor(output, renderer, enabled = false) {
    this.output = output;
    this.renderer = renderer;
    this.enabled = enabled;
    this.lastTime = null;
    this.reportTime = null;
    this.frameTimes = [];
    this.cpuTimes = [];
    this.simulationTimes = [];
    this.sceneTimes = [];
    this.renderTimes = [];
    this.physicsSteps = [];
    if (enabled) output.classList.remove('hidden');
  }

  frame(time, timings, physicsSteps, active) {
    if (!this.enabled) return;
    if (!active) {
      this.lastTime = time;
      this.reportTime = time;
      this.frameTimes.length = 0;
      this.cpuTimes.length = 0;
      this.simulationTimes.length = 0;
      this.sceneTimes.length = 0;
      this.renderTimes.length = 0;
      this.physicsSteps.length = 0;
      return;
    }
    if (this.lastTime != null) this.frameTimes.push(time - this.lastTime);
    this.lastTime = time;
    this.cpuTimes.push(timings.cpu);
    this.simulationTimes.push(timings.simulation);
    this.sceneTimes.push(timings.scene);
    this.renderTimes.push(timings.render);
    this.physicsSteps.push(physicsSteps);
    if (this.reportTime == null) this.reportTime = time;
    if (time - this.reportTime < 1000 || this.frameTimes.length < 2) return;
    this.report(time);
  }

  report(time) {
    const total = this.frameTimes.reduce((sum, value) => sum + value, 0);
    const fps = total > 0 ? this.frameTimes.length * 1000 / total : 0;
    const median = percentile(this.frameTimes, 0.5);
    const targetFrame = 1000 / 60;
    const longFrames = this.frameTimes.filter((value) => value > targetFrame * 1.5).length;
    const missedFrames = this.frameTimes.reduce((sum, value) =>
      sum + Math.max(0, Math.round(value / targetFrame) - 1), 0);
    const graphics = this.renderer.performanceStats();
    const result = {
      fps,
      medianMs: median,
      cadenceHz: median > 0 ? 1000 / median : 0,
      p95Ms: percentile(this.frameTimes, 0.95),
      maxMs: Math.max(...this.frameTimes),
      longFrames,
      missedFrames,
      cpuMs: average(this.cpuTimes),
      cpuP95Ms: percentile(this.cpuTimes, 0.95),
      simulationMs: average(this.simulationTimes),
      sceneMs: average(this.sceneTimes),
      renderMs: average(this.renderTimes),
      physicsSteps: average(this.physicsSteps),
      ...graphics,
    };
    const powerWarning = result.cadenceHz >= 27 && result.cadenceHz <= 34
      ? ' · CHECK iOS LOW POWER MODE' : '';
    this.output.textContent = [
      `FPS ${result.fps.toFixed(1)} · RAF ${result.cadenceHz.toFixed(1)}Hz${powerWarning} · P95 ${result.p95Ms.toFixed(1)}ms · MAX ${result.maxMs.toFixed(1)}ms · LONG ${result.longFrames} · MISSED ${result.missedFrames}`,
      `CPU ${result.cpuMs.toFixed(1)}ms · CPU95 ${result.cpuP95Ms.toFixed(1)}ms · SIM ${result.simulationMs.toFixed(1)} · SCENE ${result.sceneMs.toFixed(1)} · GL ${result.renderMs.toFixed(1)}`,
      `PHYS ${result.physicsSteps.toFixed(1)} · DRAW ${result.drawCalls} · TRI ${result.triangles}`,
      `${result.renderer} · ${result.webgl} · ${result.alpha ? 'ALPHA' : 'OPAQUE'} · RESIZE ${result.resizeCount} · ${result.bufferWidth}×${result.bufferHeight} @${result.pixelRatio.toFixed(2)}x`,
    ].join('\n');
    globalThis.__hoverRacePerf = result;
    document.documentElement.dataset.perfFps = result.fps.toFixed(1);
    document.documentElement.dataset.perfCadenceHz = result.cadenceHz.toFixed(1);
    document.documentElement.dataset.perfDrawCalls = String(result.drawCalls);
    document.documentElement.dataset.perfLongFrames = String(result.longFrames);
    document.documentElement.dataset.perfWebglAlpha = String(result.alpha);
    document.documentElement.dataset.perfResizeCount = String(result.resizeCount);
    this.reportTime = time;
    this.frameTimes.length = 0;
    this.cpuTimes.length = 0;
    this.simulationTimes.length = 0;
    this.sceneTimes.length = 0;
    this.renderTimes.length = 0;
    this.physicsSteps.length = 0;
  }
}
