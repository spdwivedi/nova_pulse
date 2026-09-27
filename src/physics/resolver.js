/**
 * @file resolver.js
 * @description Impulse-based collision response and positional correction.
 *
 * Two-step resolution (standard game-physics approach):
 *  1. Positional Correction — linear projection to prevent objects sinking
 *     into each other over frames due to floating-point drift.
 *  2. Impulse Resolution — applies normal and tangential (friction) impulses
 *     computed from relative velocity, mass ratios, and coefficient of
 *     restitution (bounciness).
 *
 * All arithmetic avoids Vec2 allocation; uses raw number operations.
 *
 * References:
 *  - Randy Gaul, "Impulse Engine" (public domain)
 *  - Erin Catto, GDC 2006 — Iterative Dynamics
 */

// Positional correction constants
const CORRECTION_PERCENT = 0.4;   // how much penetration to correct per step [0–1]
const CORRECTION_SLOP    = 0.5;   // penetration tolerance (px) before correction triggers

// ─────────────────────────────────────────────────────────────
//  CollisionResolver
// ─────────────────────────────────────────────────────────────

export class CollisionResolver {

  /**
   * Resolve collision between two ECS entities.
   *
   * @param {object} entityA
   * @param {object} entityB
   * @param {import('./narrowphase.js').Manifold} manifold
   * @param {Function} getTransform  - (entity) => TransformComponent
   * @param {Function} getKinematics - (entity) => KinematicsComponent | undefined
   * @param {Function} getRigidBody  - (entity) => RigidBodyComponent | undefined
   */
  resolve(entityA, entityB, manifold, getTransform, getKinematics, getRigidBody) {
    if (!manifold.hasCollision) return;

    const rbA = getRigidBody(entityA);
    const rbB = getRigidBody(entityB);

    // Both static — no physics response
    const isStaticA = rbA?.isStatic ?? false;
    const isStaticB = rbB?.isStatic ?? false;
    if (isStaticA && isStaticB) return;

    const tfA  = getTransform(entityA);
    const tfB  = getTransform(entityB);
    const kinA = getKinematics(entityA);
    const kinB = getKinematics(entityB);

    const invMassA = isStaticA ? 0 : (rbA?.invMass ?? 1);
    const invMassB = isStaticB ? 0 : (rbB?.invMass ?? 1);
    const invMassSum = invMassA + invMassB;
    if (invMassSum === 0) return;

    const nx = manifold.normal.x;
    const ny = manifold.normal.y;

    // ── 1. Positional correction (linear projection) ────────
    this._correctPositions(tfA, tfB, manifold.penetration, nx, ny, invMassA, invMassB, invMassSum, isStaticA, isStaticB);

    // ── 2. Impulse resolution ────────────────────────────────
    if (kinA || kinB) {
      this._applyImpulse(kinA, kinB, rbA, rbB, nx, ny, invMassA, invMassB, invMassSum, isStaticA, isStaticB);
    }
  }

  // ── Positional correction ─────────────────────────────────

  /**
   * Linearly project positions apart to remove penetration.
   * @private
   */
  _correctPositions(tfA, tfB, penetration, nx, ny, invMassA, invMassB, invMassSum, isStaticA, isStaticB) {
    const depth = Math.max(penetration - CORRECTION_SLOP, 0);
    const mag   = (depth / invMassSum) * CORRECTION_PERCENT;

    const cx = nx * mag;
    const cy = ny * mag;

    if (!isStaticA) {
      tfA.position.x += cx * invMassA;
      tfA.position.y += cy * invMassA;
    }
    if (!isStaticB) {
      tfB.position.x -= cx * invMassB;
      tfB.position.y -= cy * invMassB;
    }
  }

  // ── Impulse resolution ────────────────────────────────────

  /**
   * Compute and apply normal + tangential impulses.
   * @private
   */
  _applyImpulse(kinA, kinB, rbA, rbB, nx, ny, invMassA, invMassB, invMassSum, isStaticA, isStaticB) {
    // Relative velocity at contact
    const vAx = kinA ? kinA.velocity.x : 0;
    const vAy = kinA ? kinA.velocity.y : 0;
    const vBx = kinB ? kinB.velocity.x : 0;
    const vBy = kinB ? kinB.velocity.y : 0;

    const rvx = vAx - vBx;
    const rvy = vAy - vBy;

    // Relative velocity along normal
    const velAlongNormal = rvx * nx + rvy * ny;

    // Objects are separating — no impulse needed
    if (velAlongNormal > 0) return;

    // Coefficient of restitution (bounciness) — min of the two bodies
    const eA = rbA?.restitution ?? 0.4;
    const eB = rbB?.restitution ?? 0.4;
    const e  = Math.min(eA, eB);

    // Normal impulse scalar
    const j = -(1 + e) * velAlongNormal / invMassSum;

    // ── Apply normal impulse ────────────────────────────────
    const jx = j * nx;
    const jy = j * ny;

    if (kinA && !isStaticA) {
      kinA.velocity.x += jx * invMassA;
      kinA.velocity.y += jy * invMassA;
    }
    if (kinB && !isStaticB) {
      kinB.velocity.x -= jx * invMassB;
      kinB.velocity.y -= jy * invMassB;
    }

    // ── Friction (tangential impulse) ──────────────────────
    // Tangent vector (perpendicular to normal)
    const tx = rvx - (rvx * nx + rvy * ny) * nx;
    const ty = rvy - (rvx * nx + rvy * ny) * ny;
    const tMag = Math.sqrt(tx * tx + ty * ty);
    if (tMag < 1e-8) return;

    const tnx = tx / tMag;
    const tny = ty / tMag;

    // Relative velocity along tangent
    const velAlongTangent = rvx * tnx + rvy * tny;

    // Friction impulse scalar (Coulomb's law approximation)
    const muA = rbA?.friction ?? 0.3;
    const muB = rbB?.friction ?? 0.3;
    const mu  = Math.sqrt(muA * muA + muB * muB); // combined friction coeff

    const jt = -velAlongTangent / invMassSum;
    // Clamp: static friction if |jt| < mu*|j|, else kinetic
    const jtClamped = Math.abs(jt) < j * mu ? jt : -j * mu * Math.sign(jt);

    const ftx = jtClamped * tnx;
    const fty = jtClamped * tny;

    if (kinA && !isStaticA) {
      kinA.velocity.x += ftx * invMassA;
      kinA.velocity.y += fty * invMassA;
    }
    if (kinB && !isStaticB) {
      kinB.velocity.x -= ftx * invMassB;
      kinB.velocity.y -= fty * invMassB;
    }
  }
}
