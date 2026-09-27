/**
 * @file events.js
 * @description Lightweight pub/sub EventBus for NovaPulse engine.
 *
 * Features:
 *  - `on(event, handler)`    — subscribe persistently
 *  - `once(event, handler)`  — subscribe for a single emission
 *  - `off(event, handler)`   — unsubscribe a specific handler
 *  - `emit(event, ...args)`  — publish event with optional payload
 *  - `clear(event?)`         — remove all listeners for one or all events
 *  - No external dependencies; zero allocations on emit for stable listeners.
 */

export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();

    /** @type {Map<Function, Function>} — maps once-wrapped → original */
    this._onceMap = new Map();
  }

  // ── Subscribe ─────────────────────────────────────────────

  /**
   * Register a persistent handler for `event`.
   * @param {string}   event
   * @param {Function} handler
   * @returns {this}
   */
  on(event, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError(`EventBus.on: handler must be a function, got ${typeof handler}`);
    }
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(handler);
    return this;
  }

  /**
   * Register a one-shot handler that auto-unsubscribes after first emission.
   * @param {string}   event
   * @param {Function} handler
   * @returns {this}
   */
  once(event, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError(`EventBus.once: handler must be a function, got ${typeof handler}`);
    }
    const wrapper = (...args) => {
      handler(...args);
      this.off(event, handler);
    };
    // Store mapping so `off(event, originalHandler)` still works
    this._onceMap.set(handler, wrapper);
    return this.on(event, wrapper);
  }

  // ── Unsubscribe ───────────────────────────────────────────

  /**
   * Remove a specific handler from `event`.
   * Works for both `on` and `once` registered handlers.
   * @param {string}   event
   * @param {Function} handler
   * @returns {this}
   */
  off(event, handler) {
    const set = this._listeners.get(event);
    if (!set) return this;

    // Check if this was a `once` handler (stored via wrapper)
    const wrapper = this._onceMap.get(handler);
    if (wrapper) {
      set.delete(wrapper);
      this._onceMap.delete(handler);
    } else {
      set.delete(handler);
    }

    if (set.size === 0) {
      this._listeners.delete(event);
    }
    return this;
  }

  // ── Emit ─────────────────────────────────────────────────

  /**
   * Emit `event`, calling all registered handlers with `...args`.
   * Iterates over a snapshot so handlers may safely `off` during emit.
   * @param {string} event
   * @param {...*}   args
   * @returns {this}
   */
  emit(event, ...args) {
    const set = this._listeners.get(event);
    if (!set || set.size === 0) return this;

    // Snapshot to allow mid-iteration removal
    for (const handler of [...set]) {
      handler(...args);
    }
    return this;
  }

  // ── Utilities ─────────────────────────────────────────────

  /**
   * Remove all listeners for a specific event, or all events if omitted.
   * @param {string} [event]
   * @returns {this}
   */
  clear(event) {
    if (event !== undefined) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
      this._onceMap.clear();
    }
    return this;
  }

  /**
   * Number of listeners registered for `event`.
   * @param {string} event
   * @returns {number}
   */
  listenerCount(event) {
    return this._listeners.get(event)?.size ?? 0;
  }

  /**
   * All currently registered event names.
   * @returns {string[]}
   */
  eventNames() {
    return [...this._listeners.keys()];
  }
}
