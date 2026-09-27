/**
 * @file systems.js
 * @description Core ECS systems for NovaPulse Phase 1.
 *
 * Systems:
 *  1. MovementSystem   — integrates kinematics (velocity + acceleration + drag)
 *  2. BoundarySystem   — wraps or bounces entities at viewport edges
 *  3. RenderSystem     — draws agents to canvas with glow, rotation, interpolation
 */

import {
  TransformComponent,
  KinematicsComponent,
  RenderComponent,
  AgentStateComponent,
} from './components.js';
import { Vec2, lerp, wrapAngle } from '../core/math.js';

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
   * @param {number}                         dt       - Fixed step (s)
   */
  fixedUpdate(entities, dt) {
    for (const entity of entities) {
      const tf  = entity.get(TransformComponent);
      const kin = entity.get(KinematicsComponent);

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
   * @param {BoundaryMode} [opts.mode='wrap']   - Boundary behaviour
   * @param {number}       [opts.margin=20]      - Margin inside which wrapping triggers (px)
   * @param {object}       [opts.viewport]       - Reference to Viewport instance
   */
  constructor({ mode = 'wrap', margin = 20, viewport } = {}) {
    this.mode     = mode;
    this.margin   = margin;
    this.viewport = viewport ?? null;
  }

  get componentTypes() {
    return [TransformComponent, KinematicsComponent];
  }

  /**
   * @param {import('./entity.js').Entity[]} entities
   * @param {number}                         _dt
   */
  fixedUpdate(entities, _dt) {
    const vp = this.viewport;
    if (!vp) return;

    const W = vp.width;
    const H = vp.height;
    const m = this.margin;

    for (const entity of entities) {
      const tf  = entity.get(TransformComponent);
      const kin = entity.get(KinematicsComponent);
      const pos = tf.position;

      if (this.mode === 'wrap') {
        // Wrap — teleport to opposite edge (with margin buffer)
        if (pos.x < -m)   pos.x = W + m;
        if (pos.x > W + m) pos.x = -m;
        if (pos.y < -m)   pos.y = H + m;
        if (pos.y > H + m) pos.y = -m;
      } else {
        // Bounce — reflect velocity component at edges
        let reflected = false;
        if (pos.x <= m && kin.velocity.x < 0) {
          pos.x = m;
          kin.velocity.x *= -1;
          reflected = true;
        } else if (pos.x >= W - m && kin.velocity.x > 0) {
          pos.x = W - m;
          kin.velocity.x *= -1;
          reflected = true;
        }
        if (pos.y <= m && kin.velocity.y < 0) {
          pos.y = m;
          kin.velocity.y *= -1;
          reflected = true;
        } else if (pos.y >= H - m && kin.velocity.y > 0) {
          pos.y = H - m;
          kin.velocity.y *= -1;
          reflected = true;
        }
        void reflected; // may be used for sound / events in future phases
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  RenderSystem
// ─────────────────────────────────────────────────────────────

/**
 * Draws each entity to the canvas using:
 *  - Render-interpolated position between prevPosition and current position.
 *  - Interpolated rotation.
 *  - Shape-specific path drawing (triangle, circle, diamond).
 *  - Canvas shadow glow effect.
 *  - Per-entity alpha.
 */
export class RenderSystem {
  get componentTypes() {
    return [TransformComponent, RenderComponent];
  }

  /**
   * @param {import('./entity.js').Entity[]} entities
   * @param {CanvasRenderingContext2D}        ctx
   * @param {number}                          alpha  - Sub-frame interpolation factor
   */
  render(entities, ctx, alpha) {
    for (const entity of entities) {
      const tf  = entity.get(TransformComponent);
      const rc  = entity.get(RenderComponent);

      if (!rc.visible || rc.alpha <= 0) continue;

      // ── Interpolated transform ──────────────────────────
      const x   = lerp(tf.prevPosition.x, tf.position.x, alpha);
      const y   = lerp(tf.prevPosition.y, tf.position.y, alpha);
      const rot = lerp(tf.prevRotation,   tf.rotation,   alpha);
      const sz  = rc.size * tf.scale;

      // ── Context save / transform ────────────────────────
      ctx.save();
      ctx.globalAlpha = rc.alpha;
      ctx.translate(x, y);
      ctx.rotate(rot);

      // ── Glow ─────────────────────────────────────────────
      if (rc.glow > 0) {
        ctx.shadowBlur  = rc.glow;
        ctx.shadowColor = rc.color;
      } else {
        ctx.shadowBlur  = 0;
      }

      ctx.fillStyle   = rc.color;
      ctx.strokeStyle = rc.color;
      ctx.lineWidth   = 1;

      // ── Shape drawing ────────────────────────────────────
      ctx.beginPath();
      switch (rc.shape) {
        case 'triangle':
          this._drawTriangle(ctx, sz);
          break;
        case 'circle':
          this._drawCircle(ctx, sz);
          break;
        case 'diamond':
          this._drawDiamond(ctx, sz);
          break;
        default:
          this._drawTriangle(ctx, sz);
      }
      ctx.closePath();
      ctx.fill();

      // Outer stroke for definition
      ctx.shadowBlur = 0;
      ctx.globalAlpha = rc.alpha * 0.5;
      ctx.stroke();

      ctx.restore();
    }
  }

  // ── Shape helpers ─────────────────────────────────────────

  /**
   * Draw a forward-pointing triangle (nose at right / +x direction).
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} sz - Half-size
   */
  _drawTriangle(ctx, sz) {
    ctx.moveTo( sz * 1.4,  0);        // nose
    ctx.lineTo(-sz * 0.9,  sz * 0.8); // left wing
    ctx.lineTo(-sz * 0.9, -sz * 0.8); // right wing
  }

  /**
   * Draw a filled circle.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} sz
   */
  _drawCircle(ctx, sz) {
    ctx.arc(0, 0, sz, 0, Math.PI * 2);
  }

  /**
   * Draw a diamond (rotated square).
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} sz
   */
  _drawDiamond(ctx, sz) {
    ctx.moveTo( sz * 1.2,  0);
    ctx.lineTo( 0,         sz);
    ctx.lineTo(-sz * 1.2,  0);
    ctx.lineTo( 0,        -sz);
  }
}

// ─────────────────────────────────────────────────────────────
//  WanderSystem  (autonomous roam behaviour)
// ─────────────────────────────────────────────────────────────

/** Reusable scratch vector — avoids per-frame allocation. */
const _steer = new Vec2();

/**
 * Simple wander behaviour: agents with mode='roam' periodically change
 * heading by applying a random steering force.
 *
 * Each agent holds a wanderTimer; when it expires a new random heading
 * is chosen and the timer is reset.
 */
export class WanderSystem {
  /**
   * @param {object} [opts]
   * @param {number} [opts.changeInterval=1.0] - Seconds between heading updates
   * @param {number} [opts.forceScale=80]      - Magnitude of steering push
   */
  constructor({ changeInterval = 1.0, forceScale = 80 } = {}) {
    this.changeInterval = changeInterval;
    this.forceScale     = forceScale;
  }

  get componentTypes() {
    return [KinematicsComponent, AgentStateComponent];
  }

  /**
   * @param {import('./entity.js').Entity[]} entities
   * @param {number}                         dt
   */
  fixedUpdate(entities, dt) {
    for (const entity of entities) {
      const kin   = entity.get(KinematicsComponent);
      const state = entity.get(AgentStateComponent);

      if (state.mode !== 'roam') continue;

      state.wanderTimer -= dt;
      if (state.wanderTimer <= 0) {
        // Pick a new random heading and push a steering force
        const angle  = Math.random() * Math.PI * 2;
        _steer.set(Math.cos(angle), Math.sin(angle)).multScalar(this.forceScale);
        kin.applyForce(_steer);
        state.wanderTimer = this.changeInterval * (0.5 + Math.random());
      }
    }
  }
}
