/**
 * @file behaviors.js
 * @description Swarm flocking and predator-prey combat state machine.
 *
 * Behaviors:
 *  - BLUE_SWARM (Prey/Flockers):
 *      * Separation: 1.5
 *      * Alignment:  1.0
 *      * Cohesion:   1.0
 *      * Flee from predators: 3.0
 *
 *  - CRIMSON_SWARM (Hunters/Predators):
 *      * Wander:     0.4
 *      * Separation: 2.0
 *      * Aggressive Seek nearest blue prey: 2.2
 */

import { Vec2 } from '../core/math.js';
import { seek, flee, wander, separation, alignment, cohesion } from './steering.js';

// Pre-allocated scratch vectors for behavior weighting
const _fSep    = new Vec2();
const _fAli    = new Vec2();
const _fCoh    = new Vec2();
const _fFlee   = new Vec2();
const _fSeek   = new Vec2();
const _fWander = new Vec2();
const _steerAccum = new Vec2();

export const SWARM_CONFIG = {
  blue: {
    separationWeight: 1.5,
    alignmentWeight:  1.0,
    cohesionWeight:   1.0,
    fleeWeight:       3.0,
    panicDistance:    130,
    wanderWeight:     0.1,
  },
  crimson: {
    wanderWeight:     0.4,
    separationWeight: 2.0,
    seekWeight:       2.2,
    chaseDistance:    350,
  },
};

/**
 * Compute combined steering force for a Blue prey/flocker.
 *
 * @param {Vec2} position
 * @param {Vec2} velocity
 * @param {Array<{ position: Vec2, velocity: Vec2 }>} flockmates - Local blue agents
 * @param {Array<{ position: Vec2 }>} predators - Nearby crimson agents
 * @param {number} separationDist
 * @param {number} maxSpeed
 * @param {number} maxForce
 * @param {Vec2} [out]
 * @returns {Vec2}
 */
export function computeBlueFlockSteering(
  position,
  velocity,
  flockmates,
  predators,
  separationDist,
  maxSpeed,
  maxForce,
  out = new Vec2()
) {
  out.reset();
  const cfg = SWARM_CONFIG.blue;

  // 1. Separation from flockmates
  if (flockmates.length > 0) {
    separation(position, flockmates, separationDist, _fSep);
    _fSep.multScalar(cfg.separationWeight * maxSpeed);
    out.add(_fSep);

    // 2. Alignment
    alignment(velocity, flockmates, maxSpeed, _fAli);
    _fAli.multScalar(cfg.alignmentWeight);
    out.add(_fAli);

    // 3. Cohesion
    cohesion(position, flockmates, maxSpeed, _fCoh);
    _fCoh.multScalar(cfg.cohesionWeight);
    out.add(_fCoh);
  }

  // 4. Flee from nearest predator
  if (predators && predators.length > 0) {
    let nearestPred = null;
    let minDistSq = Infinity;
    const panicSq = cfg.panicDistance * cfg.panicDistance;

    for (let i = 0; i < predators.length; i++) {
      const pred = predators[i];
      const dSq = position.distSq(pred.position);
      if (dSq < minDistSq) {
        minDistSq = dSq;
        nearestPred = pred.position;
      }
    }

    if (nearestPred && minDistSq < panicSq) {
      flee(position, nearestPred, maxSpeed, cfg.panicDistance, _fFlee);
      _fFlee.multScalar(cfg.fleeWeight);
      out.add(_fFlee);
    }
  }

  // Desired velocity to steering force: steer = desired - velocity
  if (out.magSq() > 0.0001) {
    out.sub(velocity).clampMag(maxForce);
  }

  return out;
}

/**
 * Compute combined steering force for a Crimson predator/hunter.
 *
 * @param {Vec2} position
 * @param {Vec2} velocity
 * @param {Array<{ position: Vec2 }>} otherHunters - Fellow crimson agents
 * @param {Array<{ position: Vec2 }>} preyList - Nearby blue agents
 * @param {number} wanderAngle
 * @param {number} separationDist
 * @param {number} maxSpeed
 * @param {number} maxForce
 * @param {Vec2} [out]
 * @returns {Vec2}
 */
export function computeCrimsonHunterSteering(
  position,
  velocity,
  otherHunters,
  preyList,
  wanderAngle,
  separationDist,
  maxSpeed,
  maxForce,
  out = new Vec2()
) {
  out.reset();
  const cfg = SWARM_CONFIG.crimson;

  // 1. Separation from other hunters
  if (otherHunters.length > 0) {
    separation(position, otherHunters, separationDist, _fSep);
    _fSep.multScalar(cfg.separationWeight * maxSpeed);
    out.add(_fSep);
  }

  // 2. Seek nearest prey
  let targetedPrey = null;
  let minDistSq = Infinity;
  const chaseSq = cfg.chaseDistance * cfg.chaseDistance;

  if (preyList && preyList.length > 0) {
    for (let i = 0; i < preyList.length; i++) {
      const p = preyList[i];
      const dSq = position.distSq(p.position);
      if (dSq < minDistSq) {
        minDistSq = dSq;
        targetedPrey = p.position;
      }
    }
  }

  if (targetedPrey && minDistSq < chaseSq) {
    seek(position, targetedPrey, maxSpeed, _fSeek);
    _fSeek.multScalar(cfg.seekWeight);
    out.add(_fSeek);
  } else {
    // Wander if no prey nearby
    wander(velocity, 35, 60, wanderAngle, _fWander);
    _fWander.multScalar(cfg.wanderWeight);
    out.add(_fWander);
  }

  // Desired velocity to steering force: steer = desired - velocity
  if (out.magSq() > 0.0001) {
    out.sub(velocity).clampMag(maxForce);
  }

  return out;
}
