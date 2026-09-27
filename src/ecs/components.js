/**
 * @file components.js
 * @description Core ECS components for NovaPulse (Phase 1 & 2).
 *
 * Components are plain data containers — no methods beyond a simple reset().
 * All numeric fields use typed-array-friendly primitives for future
 * struct-of-arrays migration.
 *
 * Components:
 *  Phase 1:
 *  - TransformComponent   — position, rotation, scale
 *  - KinematicsComponent  — velocity, acceleration, speed limits, drag
 *  - RenderComponent      — visual representation descriptor
 *  - AgentStateComponent  — autonomous agent FSM state and metadata
 *  Phase 2:
 *  - ColliderComponent    — shape type, isTrigger, collision layer/mask
 *  - RigidBodyComponent   — mass, restitution, friction, isStatic flag
 */

import { Vec2 } from '../core/math.js';

// ─────────────────────────────────────────────────────────────
//  TransformComponent
// ─────────────────────────────────────────────────────────────

/**
 * Stores the spatial transform of an entity.
 * Position is a Vec2 object (mutated in-place by MovementSystem).
 */
export class TransformComponent {
  /**
   * @param {number} [x=0]
   * @param {number} [y=0]
   * @param {number} [rotation=0]  - Radians
   * @param {number} [scale=1]
   */
  constructor(x = 0, y = 0, rotation = 0, scale = 1) {
    /** @type {Vec2} World position */
    this.position = new Vec2(x, y);

    /** Previous position — used for render interpolation */
    this.prevPosition = new Vec2(x, y);

    /** Current heading angle in radians */
    this.rotation = rotation;

    /** Previous rotation — for interpolated render */
    this.prevRotation = rotation;

    /** Uniform scale factor */
    this.scale = scale;
  }

  /** Snapshot current state into prev* fields before each physics step. */
  snapshot() {
    this.prevPosition.copyFrom(this.position);
    this.prevRotation = this.rotation;
  }
}

// ─────────────────────────────────────────────────────────────
//  KinematicsComponent
// ─────────────────────────────────────────────────────────────

/**
 * Stores velocity, acceleration, and motion constraints.
 * MovementSystem reads/writes these each fixed tick.
 */
export class KinematicsComponent {
  /**
   * @param {object} [opts]
   * @param {number} [opts.maxSpeed=150]  - Pixels per second
   * @param {number} [opts.maxForce=200]  - Max steering force applied per tick
   * @param {number} [opts.drag=0.98]     - Velocity damping factor [0–1]
   */
  constructor({ maxSpeed = 150, maxForce = 200, drag = 0.98 } = {}) {
    /** @type {Vec2} Current velocity (px/s) */
    this.velocity     = Vec2.zero();

    /** @type {Vec2} Accumulated steering force this tick */
    this.acceleration = Vec2.zero();

    /** Maximum speed magnitude (px/s) */
    this.maxSpeed = maxSpeed;

    /** Maximum steering force per tick */
    this.maxForce = maxForce;

    /**
     * Drag multiplier applied to velocity each fixed tick.
     * 1.0 = no drag, 0.0 = instant stop.
     */
    this.drag = drag;
  }

  /** Apply a force vector to acceleration (accumulates until MovementSystem clears). */
  applyForce(force) {
    this.acceleration.add(force);
  }
}

// ─────────────────────────────────────────────────────────────
//  RenderComponent
// ─────────────────────────────────────────────────────────────

/**
 * Visual descriptor for the RenderSystem.
 * Keeps rendering data separate from transform / physics.
 *
 * @typedef {'triangle' | 'circle' | 'diamond'} ShapeType
 */
export class RenderComponent {
  /**
   * @param {object} [opts]
   * @param {ShapeType} [opts.shape='triangle']
   * @param {number}    [opts.size=8]           - Radius / half-extent in CSS px
   * @param {string}    [opts.color='#00ffe7']  - CSS color string
   * @param {number}    [opts.glow=12]          - Shadow blur radius (0 = no glow)
   * @param {boolean}   [opts.visible=true]
   */
  constructor({
    shape   = 'triangle',
    size    = 8,
    color   = '#00ffe7',
    glow    = 12,
    visible = true,
  } = {}) {
    /** @type {ShapeType} */
    this.shape   = shape;
    this.size    = size;
    this.color   = color;
    this.glow    = glow;
    this.visible = visible;

    /**
     * Per-entity alpha multiplier [0–1].
     * Can be animated for spawn/death effects.
     */
    this.alpha = 1.0;
  }
}

// ─────────────────────────────────────────────────────────────
//  AgentStateComponent
// ─────────────────────────────────────────────────────────────

/**
 * Finite-state machine data for autonomous swarm agents.
 *
 * @typedef {'idle' | 'roam' | 'seek'} AgentMode
 * @typedef {'blue' | 'crimson'}       AgentTeam
 */
export class AgentStateComponent {
  /**
   * @param {object} [opts]
   * @param {AgentMode} [opts.mode='roam']
   * @param {number}    [opts.energy=100]
   * @param {AgentTeam} [opts.team='blue']
   */
  constructor({ mode = 'roam', energy = 100, team = 'blue' } = {}) {
    /** @type {AgentMode} Current behaviour mode */
    this.mode = mode;

    /** Energy level [0–100] — drives behaviour transitions */
    this.energy = energy;

    /** @type {AgentTeam} Faction / team identifier */
    this.team = team;

    /**
     * Time (seconds) remaining in current wandering direction.
     * Reset when the agent picks a new roam heading.
     */
    this.wanderTimer = 0;

    /**
     * Target seek position (only relevant in 'seek' mode).
     * @type {Vec2 | null}
     */
    this.seekTarget = null;
  }
}

// ─────────────────────────────────────────────────────────────
//  ColliderComponent  (Phase 2)
// ─────────────────────────────────────────────────────────────

/**
 * Attaches a physics collider shape to an entity.
 * The actual shape object (CircleCollider or BoxCollider) is stored
 * in `.shape` and carries its own geometry.
 *
 * Collision filtering uses a layer / mask bitmask pattern:
 *   entity A collides with entity B  if  (A.layer & B.mask) && (B.layer & A.mask)
 *
 * @typedef {'circle' | 'box'} ColliderType
 */
export class ColliderComponent {
  /**
   * @param {object} [opts]
   * @param {import('../physics/colliders.js').CircleCollider |
   *          import('../physics/colliders.js').BoxCollider} opts.shape - Collider primitive instance
   * @param {boolean} [opts.isTrigger=false] - If true, detects overlap but skips physics response
   * @param {number}  [opts.layer=0x01]      - This entity's collision layer bit(s)
   * @param {number}  [opts.mask=0xFF]       - Layers this entity collides against
   */
  constructor({ shape, isTrigger = false, layer = 0x01, mask = 0xFF } = {}) {
    if (!shape) throw new Error('ColliderComponent requires a shape (CircleCollider or BoxCollider)');

    /** @type {import('../physics/colliders.js').CircleCollider | import('../physics/colliders.js').BoxCollider} */
    this.shape     = shape;
    this.isTrigger = isTrigger;

    /** Collision layer bitmask for this entity */
    this.layer = layer;

    /** Bitmask of layers this entity tests against */
    this.mask = mask;

    /**
     * Set of entity IDs currently overlapping this entity.
     * Used to distinguish collision:enter from collision:stay.
     * @type {Set<number>}
     */
    this.activeContacts = new Set();

    /**
     * Visual flash timer (seconds). Set on high-energy collision;
     * decays to 0 over time for glow-burst rendering.
     */
    this.flashTimer = 0;
  }
}

// ─────────────────────────────────────────────────────────────
//  RigidBodyComponent  (Phase 2)
// ─────────────────────────────────────────────────────────────

/**
 * Physics rigid-body properties used by the CollisionResolver.
 * Entities without this component can still have colliders (trigger-only).
 */
export class RigidBodyComponent {
  /**
   * @param {object} [opts]
   * @param {number}  [opts.mass=1]          - Mass in arbitrary units (0 = infinite / static)
   * @param {number}  [opts.restitution=0.45] - Bounciness coefficient [0=inelastic, 1=perfectly elastic]
   * @param {number}  [opts.friction=0.25]   - Coulomb friction coefficient [0=frictionless]
   * @param {boolean} [opts.isStatic=false]  - Static bodies are immovable (invMass = 0)
   */
  constructor({ mass = 1, restitution = 0.45, friction = 0.25, isStatic = false } = {}) {
    this.isStatic    = isStatic;
    this.mass        = isStatic ? Infinity : mass;
    this.invMass     = isStatic ? 0 : (mass > 0 ? 1 / mass : 0);
    this.restitution = restitution;
    this.friction    = friction;
  }
}
