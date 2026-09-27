/**
 * @file loop.js
 * @description High-precision requestAnimationFrame game loop with hardware telemetry for NovaPulse.
 *
 * Features:
 *  - Delta-time clamping (max 0.1 s) to prevent spiral-of-death on tab restore.
 *  - Fixed-timestep physics accumulator running at 60 Hz (16.666 ms steps).
 *  - Sub-frame alpha for render interpolation between physics states.
 *  - Rolling average FPS, physics tick time, render rasterization time, and frame delta.
 *  - Memory heap size telemetry detection (in supported browser environments).
 *  - Clean start / stop / pause / resume API.
 */

const FIXED_STEP     = 1 / 60;          // seconds — 60 Hz physics
const MAX_DELTA      = 0.1;             // seconds — clamp on tab restore
const SAMPLE_SZ      = 60;              // rolling window size

export class GameLoop {
  /**
   * @param {object} callbacks
   * @param {function(number): void}         callbacks.fixedUpdate - Called each fixed tick; receives fixedDt (s).
   * @param {function(number, number): void} callbacks.update      - Called each frame; receives dt (s), alpha [0-1].
   * @param {function(number): void}         callbacks.render      - Called each frame; receives alpha [0-1].
   */
  constructor({ fixedUpdate, update, render }) {
    this._fixedUpdate = fixedUpdate ?? (() => {});
    this._update      = update      ?? (() => {});
    this._render      = render      ?? (() => {});

    // State
    this._running      = false;
    this._paused       = false;
    this._rafId        = null;

    // Timing
    this._lastTime     = 0;      // ms
    this._accumulator  = 0;      // s

    // Metrics — circular buffers for rolling averages
    this._fpsSamples     = new Float32Array(SAMPLE_SZ);
    this._physicsSamples = new Float32Array(SAMPLE_SZ);
    this._renderSamples  = new Float32Array(SAMPLE_SZ);
    this._frameSamples   = new Float32Array(SAMPLE_SZ);
    this._sampleHead     = 0;

    // Public metrics (read-only, updated each frame)
    this.fps           = 0;
    this.tickMs        = 0;      // alias for physicsTimeMs for backward compat
    this.physicsTimeMs = 0;
    this.renderTimeMs  = 0;
    this.frameTimeMs   = 0;
    this.memoryUsedMb  = 0;
    this.frameCount    = 0;
    this.simTime       = 0;      // total simulated seconds

    // Bind RAF callback once to avoid per-frame allocation
    this._rafCallback  = this._tick.bind(this);
  }

  // ── Public API ────────────────────────────────────────────

  /** Start the loop (idempotent). */
  start() {
    if (this._running) return;
    this._running     = true;
    this._paused      = false;
    this._lastTime    = performance.now();
    this._accumulator = 0;
    this._rafId       = requestAnimationFrame(this._rafCallback);
  }

  /** Stop the loop permanently. */
  stop() {
    this._running = false;
    this._paused  = false;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  /** Pause the loop (retains timing state). */
  pause() {
    if (!this._running || this._paused) return;
    this._paused = true;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  /** Resume after pause. */
  resume() {
    if (!this._running || !this._paused) return;
    this._paused   = false;
    this._lastTime = performance.now();
    this._rafId    = requestAnimationFrame(this._rafCallback);
  }

  /** Is the loop currently running (not paused)? */
  get isActive() {
    return this._running && !this._paused;
  }

  // ── Internal tick ─────────────────────────────────────────

  /**
   * Core RAF callback — orchestrates fixed-step accumulation, render, and profiling.
   * @param {number} now - High-resolution timestamp (ms) from RAF.
   */
  _tick(now) {
    if (!this._running || this._paused) return;

    // ── Delta-time computation + clamp ─────────────────────
    let dtMs = now - this._lastTime;
    this._lastTime = now;

    // Clamp: if tab was hidden, dtMs can be huge — prevent spiral-of-death
    if (dtMs > MAX_DELTA * 1000) dtMs = MAX_DELTA * 1000;
    const dt = dtMs / 1000;

    // ── Fixed-timestep accumulator (Physics & Collision) ───
    this._accumulator += dt;
    const physicsStart = performance.now();

    while (this._accumulator >= FIXED_STEP) {
      this._fixedUpdate(FIXED_STEP);
      this._accumulator -= FIXED_STEP;
      this.simTime      += FIXED_STEP;
    }

    const physicsEnd = performance.now();
    const instantPhysics = physicsEnd - physicsStart;

    // ── Sub-frame alpha (interpolation blend factor) ───────
    const alpha = this._accumulator / FIXED_STEP;

    // ── Frame update (Game logic / HUD preparation) ────────
    this._update(dt, alpha);

    // ── Render pass (Canvas GPU draw calls) ────────────────
    const renderStart = performance.now();
    this._render(alpha);
    const renderEnd = performance.now();
    const instantRender = renderEnd - renderStart;

    // ── Telemetry & Metrics ────────────────────────────────
    this.frameCount++;
    const instantFps = dtMs > 0 ? 1000 / dtMs : 0;

    const idx = this._sampleHead % SAMPLE_SZ;
    this._fpsSamples[idx]     = instantFps;
    this._physicsSamples[idx] = instantPhysics;
    this._renderSamples[idx]  = instantRender;
    this._frameSamples[idx]   = dtMs;
    this._sampleHead++;

    // Compute rolling averages
    this.fps           = this._rollingAvg(this._fpsSamples);
    this.physicsTimeMs = this._rollingAvg(this._physicsSamples);
    this.tickMs        = this.physicsTimeMs;
    this.renderTimeMs  = this._rollingAvg(this._renderSamples);
    this.frameTimeMs   = this._rollingAvg(this._frameSamples);

    // Memory heap estimation if available in browser
    if (typeof performance !== 'undefined' && performance.memory?.usedJSHeapSize) {
      this.memoryUsedMb = Math.round((performance.memory.usedJSHeapSize / (1024 * 1024)) * 10) / 10;
    }

    // ── Schedule next frame ────────────────────────────────
    this._rafId = requestAnimationFrame(this._rafCallback);
  }

  // ── Helpers ───────────────────────────────────────────────

  /**
   * Compute average of a circular Float32Array.
   * @param {Float32Array} arr
   * @returns {number}
   */
  _rollingAvg(arr) {
    let sum = 0;
    const len = Math.min(this.frameCount, SAMPLE_SZ);
    if (len === 0) return 0;
    for (let i = 0; i < len; i++) sum += arr[i];
    return sum / len;
  }
}
