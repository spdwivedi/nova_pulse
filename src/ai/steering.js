/**
 * @file steering.js
 * @description Craig Reynolds autonomous agent steering behaviors.
 *
 * Implements allocation-conscious, in-place vector arithmetic:
 *  - seek(agentPos, targetPos, maxSpeed, out)
 *  - flee(agentPos, threatPos, maxSpeed, panicDistance, out)
 *  - wander(agentVelocity, wanderRadius, wanderDistance, wanderAngle, out)
 *  - separation(agentPos, neighbors, desiredDist, out)
 *  - alignment(agentVelocity, neighbors, maxSpeed, out)
 *  - cohesion(agentPos, neighbors, maxSpeed, out)
 *
 * To minimize garbage collection in hot simulation loops, callers can pass
 * an `out` Vec2 vector into each function. Reusable module-level scratch
 * vectors are employed for intermediate computations.
 */

import { Vec2 } from '../core/math.js';

// Pre-allocated scratch vectors for internal computations
const _v1 = new Vec2();
const _v2 = new Vec2();
const _diff = new Vec2();

/**
 * Craig Reynolds Seek behavior.
 * Computes desired velocity pointing from agentPos to targetPos at maxSpeed.
 *
 * @param {Vec2} agentPos
 * @param {Vec2} targetPos
 * @param {number} maxSpeed
 * @param {Vec2} [out]
 * @returns {Vec2}
 */
export function seek(agentPos, targetPos, maxSpeed, out = new Vec2()) {
  out.copyFrom(targetPos).sub(agentPos);
  const dSq = out.magSq();
  if (dSq > 0.0001) {
    out.normalize().multScalar(maxSpeed);
  } else {
    out.reset();
  }
  return out;
}

/**
 * Craig Reynolds Flee behavior.
 * Computes desired velocity pointing away from threatPos at maxSpeed.
 * If panicDistance > 0, returns zero vector if threat is further than panicDistance.
 *
 * @param {Vec2} agentPos
 * @param {Vec2} threatPos
 * @param {number} maxSpeed
 * @param {number} [panicDistance=0] - 0 means always flee regardless of distance
 * @param {Vec2} [out]
 * @returns {Vec2}
 */
export function flee(agentPos, threatPos, maxSpeed, panicDistance = 0, out = new Vec2()) {
  out.copyFrom(agentPos).sub(threatPos);
  const dSq = out.magSq();

  if (panicDistance > 0 && dSq > panicDistance * panicDistance) {
    return out.reset();
  }

  if (dSq > 0.0001) {
    out.normalize().multScalar(maxSpeed);
  } else {
    // If exactly coincident, pick random flee direction
    out.set(Math.random() - 0.5, Math.random() - 0.5).normalize().multScalar(maxSpeed);
  }
  return out;
}

/**
 * Craig Reynolds Wander behavior.
 * Projects a circle ahead of the agent and returns a vector towards a point on that circle.
 *
 * @param {Vec2} agentVelocity
 * @param {number} wanderRadius
 * @param {number} wanderDistance
 * @param {number} wanderAngle - Angle in radians on the circle
 * @param {Vec2} [out]
 * @returns {Vec2}
 */
export function wander(agentVelocity, wanderRadius, wanderDistance, wanderAngle, out = new Vec2()) {
  // Center of circle ahead of agent along current velocity heading
  if (agentVelocity.magSq() > 0.0001) {
    _v1.copyFrom(agentVelocity).normalize().multScalar(wanderDistance);
  } else {
    _v1.set(wanderDistance, 0);
  }

  // Displacement vector on circle
  _v2.set(Math.cos(wanderAngle) * wanderRadius, Math.sin(wanderAngle) * wanderRadius);

  // Desired steering is center + displacement
  out.copyFrom(_v1).add(_v2);
  return out;
}

/**
 * Separation behavior.
 * Steers away from nearby flockmates, inversely proportional to distance.
 *
 * @param {Vec2} agentPos
 * @param {Array<{ position: Vec2 }>} neighbors - Array of objects with .position
 * @param {number} desiredDist
 * @param {Vec2} [out]
 * @returns {Vec2}
 */
export function separation(agentPos, neighbors, desiredDist, out = new Vec2()) {
  out.reset();
  let count = 0;
  const dDistSq = desiredDist * desiredDist;

  for (let i = 0; i < neighbors.length; i++) {
    const otherPos = neighbors[i].position;
    const dSq = agentPos.distSq(otherPos);

    if (dSq > 0.0001 && dSq < dDistSq) {
      const d = Math.sqrt(dSq);
      _diff.copyFrom(agentPos).sub(otherPos).normalize().div(d); // weight by 1/d
      out.add(_diff);
      count++;
    }
  }

  if (count > 0) {
    out.div(count);
    if (out.magSq() > 0.0001) {
      out.normalize();
    }
  }
  return out;
}

/**
 * Alignment behavior.
 * Steers to match the average velocity of local flockmates.
 *
 * @param {Vec2} agentVelocity
 * @param {Array<{ velocity: Vec2 }>} neighbors - Array of objects with .velocity
 * @param {number} maxSpeed
 * @param {Vec2} [out]
 * @returns {Vec2}
 */
export function alignment(agentVelocity, neighbors, maxSpeed, out = new Vec2()) {
  out.reset();
  let count = 0;

  for (let i = 0; i < neighbors.length; i++) {
    const otherVel = neighbors[i].velocity;
    if (otherVel) {
      out.add(otherVel);
      count++;
    }
  }

  if (count > 0) {
    out.div(count);
    if (out.magSq() > 0.0001) {
      out.normalize().multScalar(maxSpeed);
    }
  }
  return out;
}

/**
 * Cohesion behavior.
 * Steers toward the center of mass (centroid) of local flockmates.
 *
 * @param {Vec2} agentPos
 * @param {Array<{ position: Vec2 }>} neighbors - Array of objects with .position
 * @param {number} maxSpeed
 * @param {Vec2} [out]
 * @returns {Vec2}
 */
export function cohesion(agentPos, neighbors, maxSpeed, out = new Vec2()) {
  out.reset();
  let count = 0;

  for (let i = 0; i < neighbors.length; i++) {
    const otherPos = neighbors[i].position;
    if (otherPos) {
      out.add(otherPos);
      count++;
    }
  }

  if (count > 0) {
    out.div(count);
    // Steer towards centroid
    return seek(agentPos, out, maxSpeed, out);
  }
  return out;
}
