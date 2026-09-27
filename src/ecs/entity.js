/**
 * @file entity.js
 * @description Numeric-ID entity with bitmask component filtering
 *              and fluent component attachment for the NovaPulse ECS.
 *
 * Design:
 *  - Each entity has a unique integer `id`.
 *  - Components are stored in a plain Map keyed by component class.
 *  - A bitmask tracks which component types are attached, enabling
 *    O(1) archetype queries in the World.
 *  - Component type bits are assigned lazily via `Entity.registerType()`.
 */

// ── Component type registry ───────────────────────────────────
// Maps a component class → its bit position in the mask.
const _typeRegistry = new Map();
let   _nextBit      = 0;

/**
 * Register a component class and return its bitmask bit.
 * Each unique class gets one bit (up to 32 distinct component types with
 * a 32-bit integer; extend to BigInt if more are needed).
 *
 * @param {Function} ComponentClass
 * @returns {number} - power-of-two bitmask for this type
 */
export function registerComponentType(ComponentClass) {
  if (_typeRegistry.has(ComponentClass)) {
    return _typeRegistry.get(ComponentClass);
  }
  if (_nextBit >= 31) {
    throw new RangeError('ECS: exceeded 31 component type slots (extend to BigInt for more).');
  }
  const bit = 1 << _nextBit++;
  _typeRegistry.set(ComponentClass, bit);
  return bit;
}

/**
 * Look up the bitmask for a previously registered component class.
 * @param {Function} ComponentClass
 * @returns {number}
 */
export function getComponentBit(ComponentClass) {
  const bit = _typeRegistry.get(ComponentClass);
  if (bit === undefined) {
    throw new RangeError(`ECS: component type "${ComponentClass.name}" was never registered.`);
  }
  return bit;
}

// ── Entity ID counter ─────────────────────────────────────────
let _nextId = 1;

// ── Entity class ──────────────────────────────────────────────

export class Entity {
  constructor() {
    /** Unique numeric identifier. */
    this.id = _nextId++;

    /** Bitfield representing attached component types. */
    this.mask = 0;

    /** @type {Map<Function, object>} */
    this._components = new Map();

    /** Whether this entity is queued for destruction. */
    this.destroyed = false;
  }

  // ── Component attachment ─────────────────────────────────

  /**
   * Attach a component instance to this entity.
   * The component's class must have been registered via `registerComponentType`.
   * Returns `this` for fluent chaining.
   *
   * @param {object} component - Instance of a component class
   * @returns {this}
   */
  add(component) {
    const cls = component.constructor;
    const bit = registerComponentType(cls); // lazy-register if needed
    this._components.set(cls, component);
    this.mask |= bit;
    return this;
  }

  /**
   * Remove a component by class.
   * @param {Function} ComponentClass
   * @returns {this}
   */
  remove(ComponentClass) {
    if (!this._components.has(ComponentClass)) return this;
    const bit = getComponentBit(ComponentClass);
    this._components.delete(ComponentClass);
    this.mask &= ~bit;
    return this;
  }

  /**
   * Retrieve a component instance by class.
   * Returns `undefined` if not attached.
   * @template T
   * @param {new (...args: any[]) => T} ComponentClass
   * @returns {T | undefined}
   */
  get(ComponentClass) {
    return this._components.get(ComponentClass);
  }

  /**
   * Test whether this entity has a component.
   * @param {Function} ComponentClass
   * @returns {boolean}
   */
  has(ComponentClass) {
    return this._components.has(ComponentClass);
  }

  /**
   * Test whether this entity matches a precomputed bitmask.
   * Used by World queries for fast archetype filtering.
   * @param {number} mask
   * @returns {boolean}
   */
  matchesMask(mask) {
    return (this.mask & mask) === mask;
  }

  /** Mark entity for destruction (World.flush() will remove it). */
  destroy() {
    this.destroyed = true;
  }

  toString() {
    return `Entity(id=${this.id}, mask=0b${this.mask.toString(2)})`;
  }
}
