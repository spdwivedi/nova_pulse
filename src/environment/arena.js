/**
 * @file arena.js
 * @description Dynamic arena boundaries and environmental hazards for NovaPulse Phase 5.
 *
 * Hazards:
 *  1. PulsingLaserGate    — Rotating dual-node laser fences that vaporize unshielded boids.
 *  2. QuantumBlackHole    — Central gravity well exerting inverse-square gravitational pull (F = G * M / r²).
 *  3. KineticMine         — Proximity-triggered explosive mines with radial shrapnel detonation.
 *  4. ArenaManager        — Coordinates shrinking perimeter warning pulses and hazard lifecycle.
 */

import { Vec2 } from '../core/math.js';
import { CombatStateComponent, KinematicsComponent, TransformComponent, RenderComponent } from '../ecs/components.js';

// ─────────────────────────────────────────────────────────────
//  PulsingLaserGate
// ─────────────────────────────────────────────────────────────

export class PulsingLaserGate {
  /**
   * @param {object} opts
   * @param {number} opts.centerX
   * @param {number} opts.centerY
   * @param {number} [opts.length=200]
   * @param {number} [opts.angularSpeed=0.6]
   * @param {number} [opts.damage=120]
   * @param {string} [opts.color='#ff0055']
   */
  constructor({
    centerX,
    centerY,
    length       = 200,
    angularSpeed = 0.6,
    damage       = 120,
    color        = '#ff0055',
  }) {
    this.centerX      = centerX;
    this.centerY      = centerY;
    this.length       = length;
    this.angle        = Math.random() * Math.PI * 2;
    this.angularSpeed = angularSpeed;
    this.damage       = damage;
    this.color        = color;
    this.active       = true;
    this.thickness    = 3.5;
    this.pulsePhase   = 0;
  }

  update(dt) {
    this.angle += this.angularSpeed * dt;
    this.pulsePhase += dt * 5;
  }

  /**
   * Get the two endpoints of the laser fence.
   * @returns {{ ax: number, ay: number, bx: number, by: number }}
   */
  getEndpoints() {
    const halfLen = this.length * 0.5;
    const cosA = Math.cos(this.angle);
    const sinA = Math.sin(this.angle);

    return {
      ax: this.centerX - cosA * halfLen,
      ay: this.centerY - sinA * halfLen,
      bx: this.centerX + cosA * halfLen,
      by: this.centerY + sinA * halfLen,
    };
  }

  /**
   * Test intersection between laser segment and a circular entity.
   * Uses point-to-segment perpendicular distance.
   *
   * @param {number} px
   * @param {number} py
   * @param {number} radius
   * @returns {boolean}
   */
  checkIntersection(px, py, radius) {
    const { ax, ay, bx, by } = this.getEndpoints();
    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;

    const segLenSq = abx * abx + aby * aby;
    if (segLenSq === 0) {
      const dSq = (px - ax) * (px - ax) + (py - ay) * (py - ay);
      return dSq <= (radius + this.thickness) * (radius + this.thickness);
    }

    // Normalized projection parameter t clamped to [0, 1]
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / segLenSq));
    const closestX = ax + t * abx;
    const closestY = ay + t * aby;

    const dx = px - closestX;
    const dy = py - closestY;
    const distSq = dx * dx + dy * dy;
    const threshold = radius + this.thickness;

    return distSq <= threshold * threshold;
  }

  render(ctx) {
    const { ax, ay, bx, by } = this.getEndpoints();
    const flicker = 0.85 + Math.sin(this.pulsePhase) * 0.15;

    ctx.save();
    ctx.shadowBlur  = 16 * flicker;
    ctx.shadowColor = this.color;
    ctx.strokeStyle = this.color;
    ctx.lineWidth   = this.thickness * flicker;
    ctx.lineCap     = 'round';

    // Outer laser beam
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();

    // Inner bright white beam core
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = this.thickness * 0.45;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();

    // Pylon node emitters
    this._drawPylon(ctx, ax, ay);
    this._drawPylon(ctx, bx, by);

    ctx.restore();
  }

  _drawPylon(ctx, x, y) {
    ctx.fillStyle = '#0a0a14';
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ─────────────────────────────────────────────────────────────
//  QuantumBlackHole
// ─────────────────────────────────────────────────────────────

export class QuantumBlackHole {
  /**
   * @param {object} opts
   * @param {number} opts.centerX
   * @param {number} opts.centerY
   * @param {number} [opts.mass=180000]
   * @param {number} [opts.eventHorizon=30]
   * @param {number} [opts.gravityRadius=420]
   */
  constructor({
    centerX,
    centerY,
    mass          = 180000,
    eventHorizon  = 30,
    gravityRadius = 420,
  }) {
    this.centerX       = centerX;
    this.centerY       = centerY;
    this.mass          = mass;
    this.eventHorizon  = eventHorizon;
    this.gravityRadius = gravityRadius;
    this.spinAngle     = 0;
    this.pulseTimer    = 0;
  }

  update(dt) {
    this.spinAngle += dt * 1.8;
    this.pulseTimer += dt * 3;
  }

  /**
   * Compute inverse-square gravitational force vector on an entity.
   * Clamped to avoid singularity division by zero.
   *
   * @param {Vec2} position
   * @param {number} [entityMass=1]
   * @param {Vec2} [out]
   * @returns {Vec2} Force vector pointing towards black hole
   */
  getGravitationalForce(position, entityMass = 1, out = new Vec2()) {
    const dx = this.centerX - position.x;
    const dy = this.centerY - position.y;
    const distSq = dx * dx + dy * dy;
    const dist = Math.sqrt(distSq);

    if (dist < 0.001 || dist > this.gravityRadius) {
      return out.reset();
    }

    // Clamp effective distance to avoid infinite force at center
    const clampedDist = Math.max(dist, this.eventHorizon * 0.7);
    const forceMag = (this.mass * entityMass) / (clampedDist * clampedDist);

    out.set(dx / dist, dy / dist).multScalar(forceMag);
    return out;
  }

  render(ctx) {
    const cx = this.centerX;
    const cy = this.centerY;
    const eh = this.eventHorizon;

    ctx.save();

    // 1. Outer gravitational distortion ripples
    const pulse = 1 + Math.sin(this.pulseTimer) * 0.06;
    ctx.strokeStyle = 'rgba(0, 255, 231, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, this.gravityRadius * 0.7 * pulse, 0, Math.PI * 2);
    ctx.stroke();

    // 2. Swirling accretion disk
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.spinAngle);
    ctx.shadowBlur = 24;
    ctx.shadowColor = '#00ffe7';
    ctx.strokeStyle = '#00ffe7';
    ctx.lineWidth = 2.5;

    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2;
      ctx.beginPath();
      ctx.arc(0, 0, eh * (1.6 + i * 0.15), angle, angle + Math.PI * 0.4);
      ctx.stroke();
    }
    ctx.restore();

    // 3. Violet intermediate aura
    ctx.shadowBlur = 18;
    ctx.shadowColor = '#a855f7';
    ctx.fillStyle = '#a855f7';
    ctx.beginPath();
    ctx.arc(cx, cy, eh * 1.15, 0, Math.PI * 2);
    ctx.fill();

    // 4. Central pitch-black event horizon void
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#020206';
    ctx.beginPath();
    ctx.arc(cx, cy, eh, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

// ─────────────────────────────────────────────────────────────
//  KineticMine
// ─────────────────────────────────────────────────────────────

export class KineticMine {
  /**
   * @param {object} opts
   * @param {number} opts.x
   * @param {number} opts.y
   * @param {number} [opts.triggerRadius=48]
   * @param {number} [opts.blastRadius=95]
   * @param {number} [opts.damage=85]
   */
  constructor({
    x,
    y,
    triggerRadius = 48,
    blastRadius   = 95,
    damage        = 85,
  }) {
    this.x             = x;
    this.y             = y;
    this.vx            = (Math.random() - 0.5) * 8;
    this.vy            = (Math.random() - 0.5) * 8;
    this.triggerRadius = triggerRadius;
    this.blastRadius   = blastRadius;
    this.damage        = damage;
    this.active        = true;
    this.isArmed       = false;
    this.fuseTimer     = 0.45; // brief armed delay before detonation
    this.detonated     = false;
    this.blinkTimer    = 0;
    this.radius        = 7;
  }

  update(dt) {
    if (!this.active) return;

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.blinkTimer += dt * (this.isArmed ? 14 : 4);

    if (this.isArmed) {
      this.fuseTimer -= dt;
      if (this.fuseTimer <= 0) {
        this.detonated = true;
      }
    }
  }

  checkTrigger(px, py) {
    if (!this.active || this.isArmed) return false;
    const dx = px - this.x;
    const dy = py - this.y;
    if (dx * dx + dy * dy <= this.triggerRadius * this.triggerRadius) {
      this.isArmed = true;
      return true;
    }
    return false;
  }

  detonate(particlePool = null, soundSynth = null, nearbyEntities = []) {
    this.active = false;

    // Visual explosion
    if (particlePool) {
      particlePool.emitExplosion(this.x, this.y, 36, '#ffc400');
    }

    // Audio boom
    if (soundSynth) {
      soundSynth.playExplosion(0.5);
    }

    // Blast damage & knockback to entities within blast radius
    for (let i = 0; i < nearbyEntities.length; i++) {
      const e = nearbyEntities[i];
      if (e.destroyed) continue;

      const tf = e.get(TransformComponent);
      if (!tf) continue;

      const dx = tf.position.x - this.x;
      const dy = tf.position.y - this.y;
      const distSq = dx * dx + dy * dy;
      const blastSq = this.blastRadius * this.blastRadius;

      if (distSq <= blastSq) {
        const dist = Math.sqrt(distSq) || 1;
        const falloff = 1 - dist / this.blastRadius;
        const actualDamage = this.damage * Math.max(0.2, falloff);

        const combat = e.get(CombatStateComponent);
        if (combat) combat.takeDamage(actualDamage);

        const kin = e.get(KinematicsComponent);
        if (kin) {
          const impulse = 120 * falloff;
          kin.velocity.x += (dx / dist) * impulse;
          kin.velocity.y += (dy / dist) * impulse;
        }
      }
    }
  }

  render(ctx) {
    if (!this.active) return;

    ctx.save();
    ctx.translate(this.x, this.y);

    const isBlinkOn = Math.sin(this.blinkTimer) > 0;
    const glowColor = this.isArmed ? '#ff0033' : '#ffc400';

    ctx.shadowBlur = this.isArmed ? 14 : 6;
    ctx.shadowColor = glowColor;

    // Spiked outer mine shell
    ctx.strokeStyle = '#64748b';
    ctx.fillStyle   = '#1e293b';
    ctx.lineWidth   = 1.5;

    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      const r = i % 2 === 0 ? this.radius * 1.3 : this.radius * 0.8;
      const px = Math.cos(angle) * r;
      const py = Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Central pulsing beacon LED
    if (isBlinkOn) {
      ctx.fillStyle = glowColor;
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

// ─────────────────────────────────────────────────────────────
//  ArenaManager
// ─────────────────────────────────────────────────────────────

export class ArenaManager {
  /**
   * @param {object} opts
   * @param {number} opts.width
   * @param {number} opts.height
   */
  constructor({ width, height }) {
    this.width               = width;
    this.height              = height;
    this.currentRadius       = Math.min(width, height) * 0.58;
    this.targetRadius        = this.currentRadius;
    this.minRadius           = Math.min(width, height) * 0.32;
    this.shrinkSpeed         = 0;
    this.warningPulse        = 0;

    /** @type {PulsingLaserGate[]} */
    this.laserGates          = [];
    /** @type {QuantumBlackHole|null} */
    this.blackHole           = null;
    /** @type {KineticMine[]} */
    this.mines               = [];

    this._tempForce = new Vec2();
  }

  setDimensions(w, h) {
    this.width = w;
    this.height = h;
  }

  clearHazards() {
    this.laserGates.length = 0;
    this.blackHole         = null;
    this.mines.length      = 0;
  }

  addLaserGate(gate) {
    this.laserGates.push(gate);
  }

  setBlackHole(blackHole) {
    this.blackHole = blackHole;
  }

  addMine(mine) {
    this.mines.push(mine);
  }

  update(dt, entities, particlePool = null, soundSynth = null, world = null) {
    this.warningPulse += dt * 3;

    // Shrinking boundary calculation
    if (this.currentRadius > this.targetRadius) {
      this.currentRadius = Math.max(this.targetRadius, this.currentRadius - this.shrinkSpeed * dt);
    }

    // 1. Update Laser Gates & test collisions
    for (let i = 0; i < this.laserGates.length; i++) {
      const gate = this.laserGates[i];
      gate.update(dt);

      for (let j = 0; j < entities.length; j++) {
        const e = entities[j];
        if (e.destroyed) continue;

        const tf = e.get(TransformComponent);
        if (!tf) continue;

        if (gate.checkIntersection(tf.position.x, tf.position.y, 6 * tf.scale)) {
          const combat = e.get(CombatStateComponent);
          if (combat) {
            const killed = combat.takeDamage(gate.damage * dt * 4);
            if (particlePool && Math.random() < 0.4) {
              particlePool.emitImpactSparks(tf.position.x, tf.position.y, null, 6, gate.color);
            }
            if (killed && world) {
              if (particlePool) particlePool.emitExplosion(tf.position.x, tf.position.y, 20, gate.color);
              if (soundSynth) soundSynth.playExplosion(0.35);
              world.destroyEntity(e);
            }
          }
        }
      }
    }

    // 2. Update Black Hole & apply gravitational pull
    if (this.blackHole) {
      this.blackHole.update(dt);

      for (let j = 0; j < entities.length; j++) {
        const e = entities[j];
        if (e.destroyed) continue;

        const tf = e.get(TransformComponent);
        const kin = e.get(KinematicsComponent);
        if (!tf || !kin) continue;

        this.blackHole.getGravitationalForce(tf.position, 1.0, this._tempForce);
        if (this._tempForce.magSq() > 0.001) {
          kin.velocity.x += this._tempForce.x * dt;
          kin.velocity.y += this._tempForce.y * dt;
        }

        // Event horizon damage
        const dx = tf.position.x - this.blackHole.centerX;
        const dy = tf.position.y - this.blackHole.centerY;
        if (dx * dx + dy * dy <= this.blackHole.eventHorizon * this.blackHole.eventHorizon) {
          const combat = e.get(CombatStateComponent);
          if (combat) {
            const killed = combat.takeDamage(80 * dt);
            if (killed && world) {
              if (particlePool) particlePool.emitExplosion(tf.position.x, tf.position.y, 16, '#00ffe7');
              world.destroyEntity(e);
            }
          }
        }
      }
    }

    // 3. Update Kinetic Mines
    for (let i = 0; i < this.mines.length; i++) {
      const mine = this.mines[i];
      if (!mine.active) continue;

      mine.update(dt);

      for (let j = 0; j < entities.length; j++) {
        const e = entities[j];
        if (e.destroyed) continue;
        const tf = e.get(TransformComponent);
        if (tf && mine.checkTrigger(tf.position.x, tf.position.y)) {
          if (soundSynth) soundSynth.playImpact(0.05);
          break;
        }
      }

      if (mine.detonated) {
        mine.detonate(particlePool, soundSynth, entities);
      }
    }
  }

  render(ctx) {
    const cx = this.width * 0.5;
    const cy = this.height * 0.5;

    // 1. Render perimeter boundary
    const pulseAlpha = 0.25 + Math.sin(this.warningPulse) * 0.15;
    ctx.save();
    ctx.strokeStyle = `rgba(0, 255, 231, ${pulseAlpha})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 12]);
    ctx.beginPath();
    ctx.arc(cx, cy, this.currentRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // 2. Render Black Hole
    if (this.blackHole) {
      this.blackHole.render(ctx);
    }

    // 3. Render Laser Gates
    for (let i = 0; i < this.laserGates.length; i++) {
      this.laserGates[i].render(ctx);
    }

    // 4. Render Mines
    for (let i = 0; i < this.mines.length; i++) {
      this.mines[i].render(ctx);
    }
  }
}
