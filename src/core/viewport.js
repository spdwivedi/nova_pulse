/**
 * @file viewport.js
 * @description Canvas manager with Retina/Hi-DPI scaling, resize handling,
 *              and coordinate projection for NovaPulse engine.
 *
 * Responsibilities:
 *  - Binds to a `<canvas>` element.
 *  - Applies `devicePixelRatio` scaling so the canvas is crisp on HiDPI screens.
 *  - Listens to `window.resize` and resizes the canvas accordingly.
 *  - Exposes a 2D `CanvasRenderingContext2D` via `.ctx`.
 *  - Provides helpers to convert between CSS-pixel and physical-pixel space.
 */

export class Viewport {
  /**
   * @param {HTMLCanvasElement} canvas  - The target `<canvas>` element.
   * @param {EventBus}          [bus]   - Optional EventBus to emit `viewport:resize`.
   */
  constructor(canvas, bus = null) {
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new TypeError('Viewport: canvas must be an HTMLCanvasElement');
    }

    this._canvas   = canvas;
    this._bus      = bus;
    this._onResize = this._handleResize.bind(this);

    // Get a 2D context with optimized settings
    this._ctx = canvas.getContext('2d', {
      alpha:              true,    // transparent bg — engine clears per frame
      desynchronized:     true,    // low-latency hint (ignored if unsupported)
      willReadFrequently: false,
    });

    // CSS logical pixel dimensions (updated on resize)
    this.width  = 0;
    this.height = 0;

    // Physical pixel dimensions (width × dpr)
    this.physicalWidth  = 0;
    this.physicalHeight = 0;

    // Device pixel ratio cache
    this._dpr = 1;

    // Wire resize listener and do initial sizing
    window.addEventListener('resize', this._onResize);
    this._handleResize();
  }

  // ── Public accessors ──────────────────────────────────────

  /** The 2D rendering context. */
  get ctx() { return this._ctx; }

  /** The underlying canvas element. */
  get canvas() { return this._canvas; }

  /** Current device pixel ratio. */
  get dpr() { return this._dpr; }

  // ── Coordinate projection ─────────────────────────────────

  /**
   * Project a CSS-pixel X coordinate to the canvas logical centre-relative space.
   * Returns the value in logical pixels (already accounts for DPR internally).
   *
   * NOTE: For most world-space logic you work in CSS pixels (0 … width).
   *       This method is provided for screen-to-world projection helpers.
   *
   * @param {number} cssX
   * @param {number} cssY
   * @returns {{ x: number, y: number }}
   */
  project(cssX, cssY) {
    return { x: cssX, y: cssY };
  }

  /**
   * Convert a MouseEvent / PointerEvent position to canvas-local CSS pixels.
   * @param {MouseEvent|PointerEvent} event
   * @returns {{ x: number, y: number }}
   */
  eventToCanvas(event) {
    const rect = this._canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  /** Width / height ratio (CSS pixels). */
  get aspectRatio() {
    return this.height > 0 ? this.width / this.height : 1;
  }

  // ── Sizing ────────────────────────────────────────────────

  /**
   * Handle window resize:
   *  1. Read new CSS pixel dimensions.
   *  2. Update canvas pixel buffer at devicePixelRatio.
   *  3. Scale context transform so all draw calls use CSS-pixel coords.
   *  4. Emit `viewport:resize` on the EventBus if one was provided.
   */
  _handleResize() {
    const dpr = window.devicePixelRatio || 1;
    this._dpr = dpr;

    const cssW = window.innerWidth;
    const cssH = window.innerHeight;

    this.width  = cssW;
    this.height = cssH;
    this.physicalWidth  = Math.round(cssW * dpr);
    this.physicalHeight = Math.round(cssH * dpr);

    // Update the physical pixel buffer
    this._canvas.width  = this.physicalWidth;
    this._canvas.height = this.physicalHeight;

    // Keep CSS display size at 100vw × 100vh (set in CSS, but reinforce here)
    this._canvas.style.width  = `${cssW}px`;
    this._canvas.style.height = `${cssH}px`;

    // Scale the context so all coordinates are in CSS-pixel space
    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Notify subscribers
    if (this._bus) {
      this._bus.emit('viewport:resize', {
        width:          this.width,
        height:         this.height,
        physicalWidth:  this.physicalWidth,
        physicalHeight: this.physicalHeight,
        dpr,
      });
    }
  }

  // ── Clear helpers ─────────────────────────────────────────

  /**
   * Clear the entire canvas with a solid fill.
   * @param {string} [color='#0a0a12']
   */
  clear(color = '#0a0a12') {
    this._ctx.fillStyle = color;
    this._ctx.fillRect(0, 0, this.width, this.height);
  }

  /**
   * Clear the canvas with a semi-transparent fill to create motion blur trails.
   * @param {number} [alpha=0.18] — opacity of the black overlay (lower = longer trails)
   */
  trail(alpha = 0.18) {
    this._ctx.fillStyle = `rgba(10, 10, 18, ${alpha})`;
    this._ctx.fillRect(0, 0, this.width, this.height);
  }

  // ── Teardown ──────────────────────────────────────────────

  /** Detach all event listeners. Call when destroying the viewport. */
  destroy() {
    window.removeEventListener('resize', this._onResize);
  }
}
