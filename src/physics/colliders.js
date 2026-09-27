/**
 * @file colliders.js
 * @description Collider primitive shapes and their AABB computation utilities.
 *
 * Colliders are data-only objects attached via ColliderComponent.
 * They describe the shape in local space; `getAABB(transform)` projects
 * them into world space for broadphase insertion.
 *
 * Supported shapes:
 *  - CircleCollider  — radius + local offset
 *  - BoxCollider     — half-extents (halfWidth, halfHeight) + local offset
 */

import { makeAABB } from './spatial_hash.js';

// ─────────────────────────────────────────────────────────────
//  CircleCollider
// ─────────────────────────────────────────────────────────────

export class CircleCollider {
  /**
   * @param {object} [opts]
   * @param {number} [opts.radius=8]   - Circle radius in local px
   * @param {number} [opts.offsetX=0]  - Local-space X offset from transform origin
   * @param {number} [opts.offsetY=0]  - Local-space Y offset
   */
  constructor({ radius = 8, offsetX = 0, offsetY = 0 } = {}) {
    this.type    = 'circle';
    this.radius  = radius;
    this.offsetX = offsetX;
    this.offsetY = offsetY;
  }

  /**
   * Compute world-space AABB given a TransformComponent.
   * Ignores rotation (circle is rotation-invariant).
   * @param {{ position: { x: number, y: number }, scale: number }} transform
   * @returns {{ minX: number, minY: number, maxX: number, maxY: number }}
   */
  getAABB(transform) {
    const r  = this.radius * transform.scale;
    const wx = transform.position.x + this.offsetX * transform.scale;
    const wy = transform.position.y + this.offsetY * transform.scale;
    return makeAABB(wx - r, wy - r, wx + r, wy + r);
  }

  /**
   * World-space centre of this collider.
   * @param {{ position: { x: number, y: number }, scale: number }} transform
   * @returns {{ x: number, y: number }}
   */
  worldCenter(transform) {
    return {
      x: transform.position.x + this.offsetX * transform.scale,
      y: transform.position.y + this.offsetY * transform.scale,
    };
  }

  /**
   * World-space radius (accounts for scale).
   * @param {{ scale: number }} transform
   * @returns {number}
   */
  worldRadius(transform) {
    return this.radius * transform.scale;
  }
}

// ─────────────────────────────────────────────────────────────
//  BoxCollider  (axis-aligned)
// ─────────────────────────────────────────────────────────────

export class BoxCollider {
  /**
   * @param {object} [opts]
   * @param {number} [opts.halfWidth=8]
   * @param {number} [opts.halfHeight=8]
   * @param {number} [opts.offsetX=0]
   * @param {number} [opts.offsetY=0]
   */
  constructor({ halfWidth = 8, halfHeight = 8, offsetX = 0, offsetY = 0 } = {}) {
    this.type       = 'box';
    this.halfWidth  = halfWidth;
    this.halfHeight = halfHeight;
    this.offsetX    = offsetX;
    this.offsetY    = offsetY;
  }

  /**
   * Compute world-space AABB.
   * NOTE: This is always axis-aligned (rotation not applied to box extents).
   * For rotated boxes a full OBB would be needed — out of scope for Phase 2.
   * @param {{ position: { x: number, y: number }, scale: number }} transform
   * @returns {{ minX: number, minY: number, maxX: number, maxY: number }}
   */
  getAABB(transform) {
    const s  = transform.scale;
    const hw = this.halfWidth  * s;
    const hh = this.halfHeight * s;
    const cx = transform.position.x + this.offsetX * s;
    const cy = transform.position.y + this.offsetY * s;
    return makeAABB(cx - hw, cy - hh, cx + hw, cy + hh);
  }

  /**
   * World-space centre.
   * @param {{ position: { x: number, y: number }, scale: number }} transform
   * @returns {{ x: number, y: number }}
   */
  worldCenter(transform) {
    return {
      x: transform.position.x + this.offsetX * transform.scale,
      y: transform.position.y + this.offsetY * transform.scale,
    };
  }

  /**
   * World-space half-extents.
   * @param {{ scale: number }} transform
   * @returns {{ hw: number, hh: number }}
   */
  worldExtents(transform) {
    const s = transform.scale;
    return { hw: this.halfWidth * s, hh: this.halfHeight * s };
  }
}
