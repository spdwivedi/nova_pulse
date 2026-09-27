/**
 * @file systems.js
 * @description ECS systems for NovaPulse (Phase 1 & 2).
 *
 * Systems:
 *  1. MovementSystem    — integrates kinematics (velocity + acceleration + drag)
 *  2. BoundarySystem    — wraps or bounces entities at viewport edges
 *  3. CollisionSystem   — spatial hash broadphase + narrow-phase + impulse resolution
 *  4. RenderSystem      — canvas drawing with glow, interpolation, optional debug wireframes
 *  5. WanderSystem      — stochastic autonomous roam behaviour
 */

import {
  TransformComponent,
  KinematicsComponent,
  RenderComponent,
  AgentStateComponent,
  ColliderComponent,
  RigidBodyComponent,
} from './components.js';
import { Vec2, lerp, wrapAngle } from '../core/math.js';
import { SpatialHashGrid }       from '../physics/spatial_hash.js';
import { testCollision }         from '../physics/narrowphase.js';
import { CollisionResolver }     from '../physics/resolver.js';

// ─────────────────────────────────────────────────────────────
//  MovementSystem
// ─────────────────────────────────────────────────────────────

/**
 * Integrates acceleration → velocity → position each fixed physics tick.
 *
 * Pipeline per entity:
 *  1. Snapshot previous transform (for interpolation).
 *  2. Clamp acceleration to maxForce.
 *  3. Add acceleration to velocity.
 *  4. Apply drag.
 *  5. Clamp velocity to maxSpeed.
 *  6. Integrate position.
 *  7. Update rotation to match velocity heading (if moving).
 *  8. Reset acceleration accumulator.
 */
export class MovementSystem {
  get componentTypes() {
    return [TransformComponent, KinematicsComponent];
  }

  /**
   * @param {import('./entity.js').Entity[]} entities
   * @param {number}                         dt - Fixed step (s)
   */
  fixedUpdate(entities, dt) {
    for (const entity of entities) {
      const tf  = entity.get(TransformComponent);
      const kin = entity.get(KinematicsComponent);

      // Skip static rigid bodies
      const rb = entity.get(RigidBodyComponent);
      if (rb?.isStatic) continue;

      // 1. Snapshot for render interpolation
      tf.snapshot();

      // 2. Clamp accumulated force
      kin.acceleration.clampMag(kin.maxForce);

      // 3. Integrate velocity
      kin.velocity.add(kin.acceleration);

      // 4. Apply drag (exponential decay)
      kin.velocity.multScalar(kin.drag);

      // 5. Clamp speed
      kin.velocity.clampMag(kin.maxSpeed);

      // 6. Integrate position  (v is px/s, multiply by dt)
      tf.position.x += kin.velocity.x * dt;
      tf.position.y += kin.velocity.y * dt;

      // 7. Update heading from velocity (only if moving meaningfully)
      const speedSq = kin.velocity.magSq();
      if (speedSq > 0.5) {
        const targetHeading = kin.velocity.heading();
        tf.rotation = wrapAngle(
          tf.rotation + wrapAngle(targetHeading - tf.rotation) * 0.25
        );
      }

      // 8. Reset acceleration
      kin.acceleration.reset();
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  BoundarySystem
// ─────────────────────────────────────────────────────────────

/** @typedef {'wrap' | 'bounce'} BoundaryMode */

/**
 * Keeps entities within viewport bounds.
 * Supports 'wrap' (teleport across edges) and 'bounce' (reflect velocity).
 */
export class BoundarySystem {
  /**
   * @param {object} [opts]
   * @param {BoundaryMode} [opts.mode='wrap']
   * @param {number}       [opts.margin=20]
   * @param {object}       [opts.viewport]
   */
  constructor({ mode = 'wrap', margin = 20, viewport } = {}) {
    this.mode     = mode;
    this.margin   = margin;
    this.viewport = viewport ?? null;
  }

  get componentTypes() {
    return [TransformComponent, KinematicsComponent];
  }

  fixedUpdate(entities, _dt) {
    const vp = this.viewport;
    if (!vp) return;

    const W = vp.width;
    const H = vp.height;
    const m = this.margin;

    for (const entity of entities) {
      const rb = entity.get(RigidBodyComponent);
      if (rb?.isStatic) continue;

      const tf  = entity.get(TransformComponent);
      const kin = entity.get(KinematicsComponent);
      const pos = tf.position;

      if (this.mode === 'wrap') {
        if (pos.x < -m)    pos.x = W + m;
        if (pos.x > W + m) pos.x = -m;
        if (pos.y < -m)    pos.y = H + m;
        if (pos.y > H + m) pos.y = -m;
      } else {
        if (pos.x <= m && kin.velocity.x < 0) {
          pos.x = m;
          kin.velocity.x *= -1;
        } else if (pos.x >= W - m && kin.velocity.x > 0) {
          pos.x = W - m;
          kin.velocity.x *= -1;
        }
        if (pos.y <= m && kin.velocity.y < 0) {
          pos.y = m;
          kin.velocity.y *= -1;
        } else if (pos.y >= H - m && kin.velocity.y > 0) {
          pos.y = H - m;
          kin.velocity.y *= -1;
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  CollisionSystem  (Phase 2)
// ─────────────────────────────────────────────────────────────

/**
 * Broadphase (SpatialHashGrid) + Narrowphase + Impulse Resolution.
 *
 * Each fixedUpdate:
 *  1. Rebuild spatial hash with every collidable entity's AABB.
 *  2. Retrieve candidate pairs from shared cells.
 *  3. Run narrow-phase manifold test for each pair.
 *  4. Emit 'collision:enter' / 'collision:stay' on the EventBus.
 *  5. Apply physics response via CollisionResolver.
 *  6. Decay collision flash timers on ColliderComponents.
 */
export class CollisionSystem {
  /**
   * @param {object} [opts]
   * @param {import('../core/events.js').EventBus} [opts.bus]       - Optional EventBus for events
   * @param {number}  [opts.cellSize=48]                            - Spatial hash cell size
   * @param {number}  [opts.velocityThreshold=60]                   - Min impact speed for flash
   */
  constructor({ bus = null, cellSize = 48, velocityThreshold = 60 } = {}) {
    this._bus               = bus;
    this._grid              = new SpatialHashGrid({ cellSize });
    this._resolver          = new CollisionResolver();
    this._velocityThreshold = velocityThreshold;

    // Diagnostics (read by HUD)
    this.lastBroadphasePairs   = 0;
    this.lastNarrowphaseHits   = 0;
    this.lastSolveMsec         = 0;
    this.lastGridOccupancy     = 0;
  }

  get componentTypes() {
    return [TransformComponent, ColliderComponent];
  }

  /**
   * @param {import('./entity.js').Entity[]} entities
   * @param {number}                         _dt
   * @param {import('./world.js').World}      world
   */
  fixedUpdate(entities, _dt, world) {
    const t0 = performance.now();
    const grid = this._grid;
    grid.clear();

    // 1. Insert all entities into spatial hash
    for (const entity of entities) {
      const tf  = entity.get(TransformComponent);
      const col = entity.get(ColliderComponent);
      const aabb = col.shape.getAABB(tf);
      grid.insert(entity.id, aabb);
    }

    this.lastGridOccupancy = grid.occupiedBuckets;

    // 2. Get candidate pairs
    const pairs = grid.getCandidatePairs();
    this.lastBroadphasePairs = pairs.length;

    let hits = 0;

    // 3. Narrow-phase + resolution
    for (const [idA, idB] of pairs) {
      const entityA = world.getEntity(idA);
      const entityB = world.getEntity(idB);
      if (!entityA || !entityB) continue;

      const colA = entityA.get(ColliderComponent);
      const colB = entityB.get(ColliderComponent);
      if (!colA || !colB) continue;

      // Collision layer filter
      if (!(colA.layer & colB.mask) || !(colB.layer & colA.mask)) continue;

      const tfA = entityA.get(TransformComponent);
      const tfB = entityB.get(TransformComponent);

      const manifold = testCollision(colA.shape, tfA, colB.shape, tfB);
      if (!manifold.hasCollision) continue;

      hits++;

      // 4. Emit events
      this._emitCollisionEvents(entityA, entityB, colA, colB, manifold);

      // 5. Physics response
      if (!colA.isTrigger && !colB.isTrigger) {
        this._resolver.resolve(
          entityA, entityB, manifold,
          e => e.get(TransformComponent),
          e => e.get(KinematicsComponent),
          e => e.get(RigidBodyComponent),
        );

        // Trigger flash on high-velocity collision
        const kinA = entityA.get(KinematicsComponent);
        const kinB = entityB.get(KinematicsComponent);
        const impactSpeed = this._relativeSpeed(kinA, kinB);
        if (impactSpeed > this._velocityThreshold) {
          if (colA) colA.flashTimer = Math.min(0.12, impactSpeed / 800);
          if (colB) colB.flashTimer = Math.min(0.12, impactSpeed / 800);
        }
      }
    }

    // 6. Decay flash timers
    for (const entity of entities) {
      const col = entity.get(ColliderComponent);
      if (col.flashTimer > 0) col.flashTimer -= _dt;
    }

    this.lastNarrowphaseHits = hits;
    this.lastSolveMsec = performance.now() - t0;
  }

  // ── Helpers ───────────────────────────────────────────────

  _emitCollisionEvents(entityA, entityB, colA, colB, manifold) {
    if (!this._bus) return;
    const isNew = !colA.activeContacts.has(entityB.id);
    if (isNew) {
      colA.activeContacts.add(entityB.id);
      colB.activeContacts.add(entityA.id);
      this._bus.emit('collision:enter', { idA: entityA.id, idB: entityB.id, manifold });
    } else {
      this._bus.emit('collision:stay', { idA: entityA.id, idB: entityB.id, manifold });
    }
  }

  /**
   * Relative speed between two kinematic components.
   * @param {KinematicsComponent|undefined} kinA
   * @param {KinematicsComponent|undefined} kinB
   * @returns {number}
   */
  _relativeSpeed(kinA, kinB) {
    const dvx = (kinA?.velocity.x ?? 0) - (kinB?.velocity.x ?? 0);
    const dvy = (kinA?.velocity.y ?? 0) - (kinB?.velocity.y ?? 0);
    return Math.sqrt(dvx * dvx + dvy * dvy);
  }

  /** Expose the grid for debug rendering. */
  get grid() { return this._grid; }
}

// ─────────────────────────────────────────────────────────────
//  RenderSystem  (Phase 2 — with debug wireframe mode)
// ─────────────────────────────────────────────────────────────

const _FLASH_COLOR_BLUE    = '#ffffff';
const _FLASH_COLOR_CRIMSON = '#ffee00';
const _DEBUG_GRID_STYLE    = 'rgba(0, 255, 231, 0.08)';
const _DEBUG_COLLIDER_OK   = 'rgba(0, 255, 100, 0.55)';
const _DEBUG_COLLIDER_HIT  = 'rgba(255, 50, 50, 0.90)';
const _DEBUG_NORMAL_COLOR  = 'rgba(255, 220, 0, 0.85)';

export class RenderSystem {
  /**
   * @param {object} [opts]
   * @param {boolean} [opts.debugWireframe=false] - Show collider/grid overlays
   * @param {import('../physics/spatial_hash.js').SpatialHashGrid|null} [opts.grid]
   * @param {import('../core/viewport.js').Viewport|null} [opts.viewport]
   */
  constructor({ debugWireframe = false, grid = null, viewport = null } = {}) {
    this.debugWireframe = debugWireframe;
    this.grid      = grid;
    this.viewport  = viewport;
  }

  get componentTypes() {
    return [TransformComponent, RenderComponent];
  }

  render(entities, ctx, alpha) {
    // Optional spatial grid debug overlay (drawn behind entities)
    if (this.debugWireframe && this.grid && this.viewport) {
      this._drawGrid(ctx);
    }

    for (const entity of entities) {
      const tf  = entity.get(TransformComponent);
      const rc  = entity.get(RenderComponent);

      if (!rc.visible || rc.alpha <= 0) continue;

      // Interpolated transform
      const x   = lerp(tf.prevPosition.x, tf.position.x, alpha);
      const y   = lerp(tf.prevPosition.y, tf.position.y, alpha);
      const rot = lerp(tf.prevRotation,   tf.rotation,   alpha);
      const sz  = rc.size * tf.scale;

      // Collision flash override
      const col        = entity.get(ColliderComponent);
      const isFlashing = col && col.flashTimer > 0;
      const flashT     = isFlashing ? Math.min(1, col.flashTimer / 0.12) : 0;

      ctx.save();
      ctx.globalAlpha = rc.alpha;
      ctx.translate(x, y);
      ctx.rotate(rot);

      // Glow — amplified during flash
      const glowRadius = isFlashing ? rc.glow + flashT * 20 : rc.glow;
      if (glowRadius > 0) {
        ctx.shadowBlur  = glowRadius;
        ctx.shadowColor = isFlashing ? '#ffffff' : rc.color;
      } else {
        ctx.shadowBlur = 0;
      }

      // Color — lerp towards white on flash
      ctx.fillStyle   = isFlashing ? this._lerpColor(rc.color, '#ffffff', flashT * 0.7) : rc.color;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth   = 1;

      ctx.beginPath();
      switch (rc.shape) {
        case 'triangle': this._drawTriangle(ctx, sz); break;
        case 'circle':   this._drawCircle(ctx, sz);   break;
        case 'diamond':  this._drawDiamond(ctx, sz);  break;
        default:         this._drawTriangle(ctx, sz);
      }
      ctx.closePath();
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.globalAlpha = rc.alpha * 0.5;
      ctx.stroke();

      ctx.restore();

      // Debug: collider wireframe overlay (drawn in world space, not rotated)
      if (this.debugWireframe && col) {
        this._drawColliderWireframe(ctx, entity, tf, col, isFlashing, x, y, alpha);
      }
    }
  }

  // ── Debug: spatial grid lines ─────────────────────────────

  _drawGrid(ctx) {
    if (!this.viewport) return;
    const cs = this.grid.cellSize;
    const W  = this.viewport.width;
    const H  = this.viewport.height;

    ctx.save();
    ctx.strokeStyle = _DEBUG_GRID_STYLE;
    ctx.lineWidth   = 0.5;
    ctx.beginPath();

    for (let x = 0; x < W; x += cs) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    for (let y = 0; y < H; y += cs) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ── Debug: collider wireframes ────────────────────────────

  _drawColliderWireframe(ctx, entity, tf, col, isFlashing, ix, iy, _alpha) {
    const shape = col.shape;
    const s     = tf.scale;
    const color = isFlashing ? _DEBUG_COLLIDER_HIT : _DEBUG_COLLIDER_OK;

    ctx.save();
    ctx.globalAlpha  = 0.85;
    ctx.strokeStyle  = color;
    ctx.shadowColor  = color;
    ctx.shadowBlur   = isFlashing ? 8 : 3;
    ctx.lineWidth    = 1;

    if (shape.type === 'circle') {
      const r  = shape.radius * s;
      const cx = tf.position.x + shape.offsetX * s;
      const cy = tf.position.y + shape.offsetY * s;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();

      // Center cross
      ctx.beginPath();
      ctx.moveTo(cx - 3, cy); ctx.lineTo(cx + 3, cy);
      ctx.moveTo(cx, cy - 3); ctx.lineTo(cx, cy + 3);
      ctx.stroke();

    } else if (shape.type === 'box') {
      const hw = shape.halfWidth  * s;
      const hh = shape.halfHeight * s;
      const cx = tf.position.x + shape.offsetX * s;
      const cy = tf.position.y + shape.offsetY * s;
      ctx.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2);
    }

    ctx.restore();
  }

  // ── Shape helpers ─────────────────────────────────────────

  _drawTriangle(ctx, sz) {
    ctx.moveTo( sz * 1.4,  0);
    ctx.lineTo(-sz * 0.9,  sz * 0.8);
    ctx.lineTo(-sz * 0.9, -sz * 0.8);
  }

  _drawCircle(ctx, sz) {
    ctx.arc(0, 0, sz, 0, Math.PI * 2);
  }

  _drawDiamond(ctx, sz) {
    ctx.moveTo( sz * 1.2,  0);
    ctx.lineTo( 0,         sz);
    ctx.lineTo(-sz * 1.2,  0);
    ctx.lineTo( 0,        -sz);
  }

  // ── Color blend helper ────────────────────────────────────

  /**
   * Very fast hex-color lerp for flash effects.
   * Only handles full 6-digit #rrggbb strings.
   * @param {string} a
   * @param {string} b
   * @param {number} t [0,1]
   * @returns {string}
   */
  _lerpColor(a, b, t) {
    const ah = parseInt(a.slice(1), 16);
    const bh = parseInt(b.slice(1), 16);
    const ar = (ah >> 16) & 0xFF, ag = (ah >> 8) & 0xFF, ab = ah & 0xFF;
    const br = (bh >> 16) & 0xFF, bg = (bh >> 8) & 0xFF, bb = bh & 0xFF;
    const r  = Math.round(ar + (br - ar) * t);
    const g  = Math.round(ag + (bg - ag) * t);
    const bl = Math.round(ab + (bb - ab) * t);
    return `#${(r << 16 | g << 8 | bl).toString(16).padStart(6, '0')}`;
  }
}

// ─────────────────────────────────────────────────────────────
//  WanderSystem
// ─────────────────────────────────────────────────────────────

/** Reusable scratch vector — avoids per-frame allocation. */
const _steer = new Vec2();

/**
 * Simple wander behaviour: agents with mode='roam' periodically change
 * heading by applying a random steering force.
 */
export class WanderSystem {
  /**
   * @param {object} [opts]
   * @param {number} [opts.changeInterval=1.0]
   * @param {number} [opts.forceScale=80]
   */
  constructor({ changeInterval = 1.0, forceScale = 80 } = {}) {
    this.changeInterval = changeInterval;
    this.forceScale     = forceScale;
  }

  get componentTypes() {
    return [KinematicsComponent, AgentStateComponent];
  }

  fixedUpdate(entities, dt) {
    for (const entity of entities) {
      const kin   = entity.get(KinematicsComponent);
      const state = entity.get(AgentStateComponent);

      if (state.mode !== 'roam') continue;

      // Skip static bodies
      const rb = entity.get(RigidBodyComponent);
      if (rb?.isStatic) continue;

      state.wanderTimer -= dt;
      if (state.wanderTimer <= 0) {
        const angle = Math.random() * Math.PI * 2;
        _steer.set(Math.cos(angle), Math.sin(angle)).multScalar(this.forceScale);
        kin.applyForce(_steer);
        state.wanderTimer = this.changeInterval * (0.5 + Math.random());
      }
    }
  }
}
