/**
 * @file loop.js
 * @description High-precision requestAnimationFrame game loop for NovaPulse.
 *
 * Features:
 *  - Delta-time clamping (max 0.1 s) to prevent spiral-of-death on tab-switch.
 *  - Fixed-timestep physics accumulator running at 60 Hz (16.666 ms steps).
 *  - Sub-frame alpha for render interpolation between physics states.
 *  - Rolling average FPS and tick-time (last N samples).
 *  - Clean start / stop / pause / resume API.
 */

const FIXED_STEP     = 1 / 60;          // seconds — 60 Hz physics
const FIXED_STEP_MS  = FIXED_STEP * 1000;
const MAX_DELTA      = 0.1;             // seconds — clamp on tab restore
const FPS_SAMPLE_SZ  = 60;             // rolling window size

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

    // Metrics — rolling arrays for average
    this._fpsSamples   = new Float32Array(FPS_SAMPLE_SZ);
    this._tickSamples  = new Float32Array(FPS_SAMPLE_SZ);
    this._sampleHead   = 0;

    // Public metrics (read-only, updated each frame)
    this.fps           = 0;
    this.tickMs        = 0;
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
    this._lastTime = performance.now(); // reset to avoid burst
    this._rafId    = requestAnimationFrame(this._rafCallback);
  }

  /** Is the loop currently running (not paused)? */
  get isActive() {
    return this._running && !this._paused;
  }

  // ── Internal tick ─────────────────────────────────────────

  /**
   * Core RAF callback — orchestrates fixed-step accumulation and rendering.
   * @param {number} now - High-resolution timestamp (ms) from RAF.
   */
  _tick(now) {
    if (!this._running || this._paused) return;

    // ── Delta-time computation + clamp ─────────────────────
    let dtMs    = now - this._lastTime;
    this._lastTime = now;

    // Clamp: if tab was hidden, dtMs can be huge — prevent spiral
    if (dtMs > MAX_DELTA * 1000) dtMs = MAX_DELTA * 1000;

    const dt = dtMs / 1000; // convert to seconds

    // ── Fixed-timestep accumulator ─────────────────────────
    this._accumulator += dt;

    const tickStart = performance.now();

    while (this._accumulator >= FIXED_STEP) {
      this._fixedUpdate(FIXED_STEP);
      this._accumulator -= FIXED_STEP;
      this.simTime      += FIXED_STEP;
    }

    const tickEnd = performance.now();

    // ── Sub-frame alpha (interpolation blend factor) ───────
    // alpha = how far we are into the current physics step [0, 1)
    const alpha = this._accumulator / FIXED_STEP;

    // ── Frame update + render ──────────────────────────────
    this._update(dt, alpha);
    this._render(alpha);

    // ── Metrics ────────────────────────────────────────────
    this.frameCount++;
    const instantFps  = dtMs > 0 ? 1000 / dtMs : 0;
    const instantTick = tickEnd - tickStart;

    const idx = this._sampleHead % FPS_SAMPLE_SZ;
    this._fpsSamples[idx]  = instantFps;
    this._tickSamples[idx] = instantTick;
    this._sampleHead++;

    // Compute rolling average
    this.fps    = this._rollingAvg(this._fpsSamples);
    this.tickMs = this._rollingAvg(this._tickSamples);

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
    const len = Math.min(this.frameCount, FPS_SAMPLE_SZ);
    if (len === 0) return 0;
    for (let i = 0; i < len; i++) sum += arr[i];
    return sum / len;
  }
}
