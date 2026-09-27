/**
 * @file narrowphase.js
 * @description Accurate collision detection returning collision manifolds.
 *
 * All tests are stateless pure functions returning a Manifold:
 *  {
 *    hasCollision:  boolean,
 *    normal:        { x, y },   // points from B → A (collision response direction for A)
 *    penetration:   number,     // overlap depth in pixels
 *    contactPoint:  { x, y },   // approximate world-space contact point
 *  }
 *
 * Supported tests:
 *  - circleVsCircle(cA, tfA, cB, tfB)
 *  - aabbVsAabb(bA, tfA, bB, tfB)
 *  - circleVsAabb(circle, tfC, box, tfB)
 *
 * Design: All arithmetic uses plain numbers — no Vec2 allocation in hot paths.
 */

// ─────────────────────────────────────────────────────────────
//  Manifold factory (reused per-call, not shared across frames)
// ─────────────────────────────────────────────────────────────

/**
 * @typedef {object} Manifold
 * @property {boolean}           hasCollision
 * @property {{ x: number, y: number }} normal
 * @property {number}            penetration
 * @property {{ x: number, y: number }} contactPoint
 */

function noCollision() {
  return { hasCollision: false, normal: { x: 0, y: 1 }, penetration: 0, contactPoint: { x: 0, y: 0 } };
}

// ─────────────────────────────────────────────────────────────
//  Circle vs Circle
// ─────────────────────────────────────────────────────────────

/**
 * Test two circle colliders.
 * @param {import('./colliders.js').CircleCollider} cA
 * @param {object} tfA - TransformComponent for A
 * @param {import('./colliders.js').CircleCollider} cB
 * @param {object} tfB - TransformComponent for B
 * @returns {Manifold}
 */
export function circleVsCircle(cA, tfA, cB, tfB) {
  const axWorld = tfA.position.x + cA.offsetX * tfA.scale;
  const ayWorld = tfA.position.y + cA.offsetY * tfA.scale;
  const bxWorld = tfB.position.x + cB.offsetX * tfB.scale;
  const byWorld = tfB.position.y + cB.offsetY * tfB.scale;

  const rA = cA.radius * tfA.scale;
  const rB = cB.radius * tfB.scale;
  const sumR = rA + rB;

  // Displacement vector B → A
  const dx = axWorld - bxWorld;
  const dy = ayWorld - byWorld;
  const distSq = dx * dx + dy * dy;

  if (distSq >= sumR * sumR) return noCollision();

  const dist = Math.sqrt(distSq);
  const penetration = sumR - dist;

  // Normal pointing from B → A (unit vector)
  let nx, ny;
  if (dist < 1e-8) {
    // Circles are exactly coincident — pick arbitrary separation axis
    nx = 1; ny = 0;
  } else {
    nx = dx / dist;
    ny = dy / dist;
  }

  // Contact point: midpoint between surfaces
  const cpx = bxWorld + nx * rB;
  const cpy = byWorld + ny * rB;

  return {
    hasCollision: true,
    normal:       { x: nx, y: ny },
    penetration,
    contactPoint: { x: cpx, y: cpy },
  };
}

// ─────────────────────────────────────────────────────────────
//  AABB vs AABB
// ─────────────────────────────────────────────────────────────

/**
 * Test two axis-aligned box colliders.
 * Uses separating axis theorem (SAT) — only two axes for AABB.
 * @param {import('./colliders.js').BoxCollider} bA
 * @param {object} tfA
 * @param {import('./colliders.js').BoxCollider} bB
 * @param {object} tfB
 * @returns {Manifold}
 */
export function aabbVsAabb(bA, tfA, bB, tfB) {
  const sA = tfA.scale, sB = tfB.scale;
  const hwA = bA.halfWidth  * sA,  hhA = bA.halfHeight * sA;
  const hwB = bB.halfWidth  * sB,  hhB = bB.halfHeight * sB;

  const axC = tfA.position.x + bA.offsetX * sA;
  const ayC = tfA.position.y + bA.offsetY * sA;
  const bxC = tfB.position.x + bB.offsetX * sB;
  const byC = tfB.position.y + bB.offsetY * sB;

  const dx = axC - bxC;
  const dy = ayC - byC;

  const overlapX = (hwA + hwB) - Math.abs(dx);
  if (overlapX <= 0) return noCollision();

  const overlapY = (hhA + hhB) - Math.abs(dy);
  if (overlapY <= 0) return noCollision();

  // Minimum penetration axis
  let nx, ny, penetration;
  if (overlapX < overlapY) {
    penetration = overlapX;
    nx = dx < 0 ? -1 : 1;
    ny = 0;
  } else {
    penetration = overlapY;
    nx = 0;
    ny = dy < 0 ? -1 : 1;
  }

  // Contact point: midpoint of overlap region
  const cpx = (axC + bxC) * 0.5;
  const cpy = (ayC + byC) * 0.5;

  return {
    hasCollision: true,
    normal:       { x: nx, y: ny },
    penetration,
    contactPoint: { x: cpx, y: cpy },
  };
}

// ─────────────────────────────────────────────────────────────
//  Circle vs AABB  (clamped closest-point projection)
// ─────────────────────────────────────────────────────────────

/**
 * Test a circle against an axis-aligned box.
 * Normal points from box → circle (response direction for the circle).
 *
 * @param {import('./colliders.js').CircleCollider} circle
 * @param {object} tfC  - TransformComponent for the circle entity
 * @param {import('./colliders.js').BoxCollider} box
 * @param {object} tfB  - TransformComponent for the box entity
 * @returns {Manifold}
 */
export function circleVsAabb(circle, tfC, box, tfB) {
  const r    = circle.radius * tfC.scale;
  const cxW  = tfC.position.x + circle.offsetX * tfC.scale;
  const cyW  = tfC.position.y + circle.offsetY * tfC.scale;

  const sB   = tfB.scale;
  const bxC  = tfB.position.x + box.offsetX * sB;
  const byC  = tfB.position.y + box.offsetY * sB;
  const hw   = box.halfWidth  * sB;
  const hh   = box.halfHeight * sB;

  // Closest point on box to circle centre
  const closestX = Math.max(bxC - hw, Math.min(cxW, bxC + hw));
  const closestY = Math.max(byC - hh, Math.min(cyW, byC + hh));

  const dx = cxW - closestX;
  const dy = cyW - closestY;
  const distSq = dx * dx + dy * dy;

  if (distSq >= r * r) return noCollision();

  const dist = Math.sqrt(distSq);
  const penetration = r - dist;

  let nx, ny;
  if (dist < 1e-8) {
    // Circle centre exactly on box edge — push up
    nx = 0; ny = -1;
  } else {
    nx = dx / dist;
    ny = dy / dist;
  }

  return {
    hasCollision: true,
    normal:       { x: nx, y: ny },
    penetration,
    contactPoint: { x: closestX, y: closestY },
  };
}

// ─────────────────────────────────────────────────────────────
//  Dispatch helper
// ─────────────────────────────────────────────────────────────

/**
 * Auto-dispatch narrow-phase test based on collider types.
 * Handles all cross-combinations, normalising results so
 * the normal always points from B→A (response direction for A).
 *
 * @param {object} colliderA
 * @param {object} tfA
 * @param {object} colliderB
 * @param {object} tfB
 * @returns {Manifold}
 */
export function testCollision(colliderA, tfA, colliderB, tfB) {
  const tA = colliderA.type;
  const tB = colliderB.type;

  if (tA === 'circle' && tB === 'circle') {
    return circleVsCircle(colliderA, tfA, colliderB, tfB);
  }
  if (tA === 'box' && tB === 'box') {
    return aabbVsAabb(colliderA, tfA, colliderB, tfB);
  }
  if (tA === 'circle' && tB === 'box') {
    return circleVsAabb(colliderA, tfA, colliderB, tfB);
  }
  if (tA === 'box' && tB === 'circle') {
    // Swap, then flip normal so it still points B→A
    const m = circleVsAabb(colliderB, tfB, colliderA, tfA);
    if (m.hasCollision) {
      m.normal.x = -m.normal.x;
      m.normal.y = -m.normal.y;
    }
    return m;
  }
  return noCollision();
}
