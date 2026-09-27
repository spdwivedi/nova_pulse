/**
 * @file math.js
 * @description Fast 2D Vector operations with in-place mutations (GC-friendly)
 *              and scalar utility helpers for NovaPulse engine.
 *
 * Design notes:
 *  - All vector methods mutate `this` unless prefixed with `clone` or
 *    explicitly stated otherwise, avoiding heap allocation in hot paths.
 *  - Static factory methods are provided for one-off convenience.
 */

// ─────────────────────────────────────────────────────────────
//  Vec2 — 2D Vector
// ─────────────────────────────────────────────────────────────

export class Vec2 {
  /**
   * @param {number} x
   * @param {number} y
   */
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  // ── Static factories ──────────────────────────────────────

  /** Zero vector. */
  static zero() { return new Vec2(0, 0); }

  /** Unit vector from angle (radians). */
  static fromAngle(angle) {
    return new Vec2(Math.cos(angle), Math.sin(angle));
  }

  /** Random unit vector. */
  static random() {
    return Vec2.fromAngle(Math.random() * Math.PI * 2);
  }

  /** Random vector scaled to given magnitude. */
  static randomScaled(mag) {
    return Vec2.random().multScalar(mag);
  }

  // ── In-place mutation operations ──────────────────────────

  /**
   * Add another Vec2 in-place.
   * @param {Vec2} v
   * @returns {this}
   */
  add(v) {
    this.x += v.x;
    this.y += v.y;
    return this;
  }

  /**
   * Subtract another Vec2 in-place.
   * @param {Vec2} v
   * @returns {this}
   */
  sub(v) {
    this.x -= v.x;
    this.y -= v.y;
    return this;
  }

  /**
   * Multiply each component by scalar in-place.
   * @param {number} scalar
   * @returns {this}
   */
  multScalar(scalar) {
    this.x *= scalar;
    this.y *= scalar;
    return this;
  }

  /**
   * Multiply component-wise by another Vec2 in-place.
   * @param {Vec2} v
   * @returns {this}
   */
  mult(v) {
    this.x *= v.x;
    this.y *= v.y;
    return this;
  }

  /**
   * Divide each component by scalar in-place.
   * Safely no-ops on zero divisor.
   * @param {number} scalar
   * @returns {this}
   */
  div(scalar) {
    if (scalar !== 0) {
      this.x /= scalar;
      this.y /= scalar;
    }
    return this;
  }

  // ── Magnitude ─────────────────────────────────────────────

  /** Squared magnitude (avoids sqrt). */
  magSq() {
    return this.x * this.x + this.y * this.y;
  }

  /** Euclidean magnitude. */
  mag() {
    return Math.sqrt(this.magSq());
  }

  /**
   * Normalize to unit length in-place.
   * No-ops on zero vector.
   * @returns {this}
   */
  normalize() {
    const m = this.mag();
    if (m > 0) this.div(m);
    return this;
  }

  // ── Angle / rotation ─────────────────────────────────────

  /** Returns heading angle in radians (-π … π). */
  heading() {
    return Math.atan2(this.y, this.x);
  }

  /**
   * Rotate by angle (radians) in-place.
   * @param {number} angle
   * @returns {this}
   */
  rotate(angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const nx = this.x * cos - this.y * sin;
    const ny = this.x * sin + this.y * cos;
    this.x = nx;
    this.y = ny;
    return this;
  }

  // ── Distance ─────────────────────────────────────────────

  /**
   * Euclidean distance to another Vec2.
   * @param {Vec2} v
   * @returns {number}
   */
  dist(v) {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Squared distance (avoids sqrt — use for comparisons).
   * @param {Vec2} v
   * @returns {number}
   */
  distSq(v) {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    return dx * dx + dy * dy;
  }

  // ── Clamping ─────────────────────────────────────────────

  /**
   * Clamp magnitude to [0, max] in-place.
   * @param {number} max
   * @returns {this}
   */
  clampMag(max) {
    const mSq = this.magSq();
    if (mSq > max * max) {
      this.normalize().multScalar(max);
    }
    return this;
  }

  /**
   * Set magnitude exactly (rescales vector) in-place.
   * @param {number} len
   * @returns {this}
   */
  setMag(len) {
    return this.normalize().multScalar(len);
  }

  // ── Dot product ───────────────────────────────────────────

  /**
   * Dot product with another Vec2.
   * @param {Vec2} v
   * @returns {number}
   */
  dot(v) {
    return this.x * v.x + this.y * v.y;
  }

  // ── Copy / clone ─────────────────────────────────────────

  /**
   * Copy values from another Vec2 in-place.
   * @param {Vec2} v
   * @returns {this}
   */
  copyFrom(v) {
    this.x = v.x;
    this.y = v.y;
    return this;
  }

  /**
   * Set x, y directly.
   * @param {number} x
   * @param {number} y
   * @returns {this}
   */
  set(x, y) {
    this.x = x;
    this.y = y;
    return this;
  }

  /** Zero out this vector in-place. */
  reset() {
    this.x = 0;
    this.y = 0;
    return this;
  }

  /** Allocates a new Vec2 with the same components. */
  clone() {
    return new Vec2(this.x, this.y);
  }

  // ── Lerp ─────────────────────────────────────────────────

  /**
   * Linear interpolate towards target Vec2 in-place.
   * @param {Vec2} target
   * @param {number} t - [0, 1]
   * @returns {this}
   */
  lerp(target, t) {
    this.x += (target.x - this.x) * t;
    this.y += (target.y - this.y) * t;
    return this;
  }

  // ── Debug ─────────────────────────────────────────────────

  toString() {
    return `Vec2(${this.x.toFixed(3)}, ${this.y.toFixed(3)})`;
  }
}

// ─────────────────────────────────────────────────────────────
//  Scalar helpers
// ─────────────────────────────────────────────────────────────

/**
 * Linear interpolation between a and b.
 * @param {number} a
 * @param {number} b
 * @param {number} t - [0, 1]
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Clamp value to [min, max].
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/**
 * Map a value from one range to another.
 * @param {number} value   - Input value
 * @param {number} inMin   - Input range min
 * @param {number} inMax   - Input range max
 * @param {number} outMin  - Output range min
 * @param {number} outMax  - Output range max
 * @returns {number}
 */
export function mapRange(value, inMin, inMax, outMin, outMax) {
  const t = (value - inMin) / (inMax - inMin);
  return outMin + t * (outMax - outMin);
}

/**
 * Convert degrees to radians.
 * @param {number} deg
 * @returns {number}
 */
export function toRad(deg) {
  return deg * (Math.PI / 180);
}

/**
 * Convert radians to degrees.
 * @param {number} rad
 * @returns {number}
 */
export function toDeg(rad) {
  return rad * (180 / Math.PI);
}

/**
 * Wrap angle into [-π, π).
 * @param {number} angle - Radians
 * @returns {number}
 */
export function wrapAngle(angle) {
  const TAU = Math.PI * 2;
  angle = angle % TAU;
  if (angle > Math.PI)  angle -= TAU;
  if (angle < -Math.PI) angle += TAU;
  return angle;
}
