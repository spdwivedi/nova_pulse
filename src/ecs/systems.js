/**
 * @file systems.js
 * @description ECS systems for NovaPulse (Phase 1, 2, 3, & 4).
 *
 * Systems:
 *  1. MovementSystem       — integrates kinematics (velocity + acceleration + drag)
 *  2. BoundarySystem       — wraps or bounces entities at viewport edges
 *  3. CollisionSystem      — spatial hash broadphase + narrow-phase + impulse resolution
 *  4. BoidSystem           — Craig Reynolds autonomous flocking & predator-prey dynamics
 *  5. PlayerInputSystem    — manual flight controller, weapon trigger, & mouse targeting
 *  6. CombatSystem         — projectile collision detection, damage application, death FX
 *  7. RenderSystem         — canvas drawing with additive particle FX, laser bolts, & sprites
 *  8. WanderSystem         — stochastic autonomous roam behaviour
 */

import {
  TransformComponent,
  KinematicsComponent,
  RenderComponent,
  AgentStateComponent,
  ColliderComponent,
  RigidBodyComponent,
  BoidComponent,
  PlayerControllerComponent,
  CombatStateComponent,
  WeaponComponent,
  AudioSourceComponent,
} from './components.js';
import { Vec2, lerp, wrapAngle, clamp } from '../core/math.js';
import { SpatialHashGrid }       from '../physics/spatial_hash.js';
import { testCollision }         from '../physics/narrowphase.js';
import { CollisionResolver }     from '../physics/resolver.js';
import { computeBlueFlockSteering, computeCrimsonHunterSteering } from '../ai/behaviors.js';
import { firePlayerCannon, fireHunterSpore, fireBossTurrets } from '../combat/weapons.js';

// ─────────────────────────────────────────────────────────────
//  MovementSystem
// ─────────────────────────────────────────────────────────────

/**
 * Integrates acceleration → velocity → position each fixed physics tick.
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

      // 6. Integrate position (v is px/s, multiply by dt)
      tf.position.x += kin.velocity.x * dt;
      tf.position.y += kin.velocity.y * dt;

      // 7. Update heading from velocity unless player is in manual control
      const playerCtrl = entity.get(PlayerControllerComponent);
      const isManual = playerCtrl && playerCtrl.isManualControlled;

      if (!isManual) {
        const speedSq = kin.velocity.magSq();
        if (speedSq > 0.5) {
          const targetHeading = kin.velocity.heading();
          tf.rotation = wrapAngle(
            tf.rotation + wrapAngle(targetHeading - tf.rotation) * 0.25
          );
        }
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
//  CollisionSystem  (Phase 2, 3, & 4)
// ─────────────────────────────────────────────────────────────

/**
 * Broadphase (SpatialHashGrid) + Narrowphase + Impulse Resolution.
 */
export class CollisionSystem {
  /**
   * @param {object} [opts]
   * @param {import('../core/events.js').EventBus} [opts.bus]
   * @param {number}  [opts.cellSize=48]
   * @param {number}  [opts.velocityThreshold=55]
   */
  constructor({ bus = null, cellSize = 48, velocityThreshold = 55 } = {}) {
    this._bus               = bus;
    this._grid              = new SpatialHashGrid({ cellSize });
    this._resolver          = new CollisionResolver();
    this._velocityThreshold = velocityThreshold;

    // Diagnostics
    this.lastBroadphasePairs = 0;
    this.lastNarrowphaseHits = 0;
    this.lastSolveMsec       = 0;
    this.lastGridOccupancy   = 0;
  }

  get componentTypes() {
    return [TransformComponent, ColliderComponent];
  }

  fixedUpdate(entities, _dt, world) {
    const t0 = performance.now();
    const grid = this._grid;
    grid.clear();

    // 1. Insert all collidable entities
    for (const entity of entities) {
      const tf  = entity.get(TransformComponent);
      const col = entity.get(ColliderComponent);
      const aabb = col.shape.getAABB(tf);
      grid.insert(entity.id, aabb);
    }

    this.lastGridOccupancy = grid.occupiedBuckets;

    // 2. Candidate pairs from shared cells
    const pairs = grid.getCandidatePairs();
    this.lastBroadphasePairs = pairs.length;

    let hits = 0;

    // 3. Narrowphase + resolution
    for (const [idA, idB] of pairs) {
      const entityA = world.getEntity(idA);
      const entityB = world.getEntity(idB);
      if (!entityA || !entityB) continue;

      const colA = entityA.get(ColliderComponent);
      const colB = entityB.get(ColliderComponent);
      if (!colA || !colB) continue;

      // Filter layer mask
      if (!(colA.layer & colB.mask) || !(colB.layer & colA.mask)) continue;

      const tfA = entityA.get(TransformComponent);
      const tfB = entityB.get(TransformComponent);

      const manifold = testCollision(colA.shape, tfA, colB.shape, tfB);
      if (!manifold.hasCollision) continue;

      hits++;

      // Emit events
      this._emitCollisionEvents(entityA, entityB, colA, colB, manifold);

      // Physics response
      if (!colA.isTrigger && !colB.isTrigger) {
        this._resolver.resolve(
          entityA, entityB, manifold,
          e => e.get(TransformComponent),
          e => e.get(KinematicsComponent),
          e => e.get(RigidBodyComponent),
        );

        // Flash timer on impact
        const kinA = entityA.get(KinematicsComponent);
        const kinB = entityB.get(KinematicsComponent);
        const impactSpeed = this._relativeSpeed(kinA, kinB);
        if (impactSpeed > this._velocityThreshold) {
          if (colA) colA.flashTimer = Math.min(0.14, impactSpeed / 700);
          if (colB) colB.flashTimer = Math.min(0.14, impactSpeed / 700);
        }
      }
    }

    // 4. Decay flash timers
    for (const entity of entities) {
      const col = entity.get(ColliderComponent);
      if (col.flashTimer > 0) col.flashTimer -= _dt;
    }

    this.lastNarrowphaseHits = hits;
    this.lastSolveMsec = performance.now() - t0;
  }

  _emitCollisionEvents(entityA, entityB, colA, colB, manifold) {
    if (!this._bus) return;
    const isNew = !colA.activeContacts.has(entityB.id);
    if (isNew) {
      colA.activeContacts.add(entityB.id);
      colB.activeContacts.add(entityA.id);
      this._bus.emit('collision:enter', { idA: entityA.id, idB: entityB.id, manifold, entityA, entityB });
    } else {
      this._bus.emit('collision:stay', { idA: entityA.id, idB: entityB.id, manifold, entityA, entityB });
    }
  }

  _relativeSpeed(kinA, kinB) {
    const dvx = (kinA?.velocity.x ?? 0) - (kinB?.velocity.x ?? 0);
    const dvy = (kinA?.velocity.y ?? 0) - (kinB?.velocity.y ?? 0);
    return Math.sqrt(dvx * dvx + dvy * dvy);
  }

  get grid() { return this._grid; }
}

// ─────────────────────────────────────────────────────────────
//  BoidSystem  (Phase 3 & 4)
// ─────────────────────────────────────────────────────────────

/**
 * Autonomous Craig Reynolds boid flocking and predator-prey dynamics.
 */
export class BoidSystem {
  /**
   * @param {object} [opts]
   * @param {number} [opts.gridCellSize=64]
   */
  constructor({ gridCellSize = 64 } = {}) {
    this._grid = new SpatialHashGrid({ cellSize: gridCellSize });
    this._steerForce = new Vec2();
  }

  get componentTypes() {
    return [TransformComponent, KinematicsComponent, BoidComponent];
  }

  fixedUpdate(entities, dt, world) {
    const grid = this._grid;
    grid.clear();

    // 1. Insert boid positions into spatial grid
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      const tf = e.get(TransformComponent);
      grid.insert(e.id, {
        minX: tf.position.x - 4,
        minY: tf.position.y - 4,
        maxX: tf.position.x + 4,
        maxY: tf.position.y + 4,
      });
    }

    // 2. Compute steering for each autonomous boid
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];

      const playerCtrl = entity.get(PlayerControllerComponent);
      if (playerCtrl && playerCtrl.isManualControlled) {
        continue;
      }

      const tf   = entity.get(TransformComponent);
      const kin  = entity.get(KinematicsComponent);
      const boid = entity.get(BoidComponent);

      const neighborIds = grid.queryRadius(tf.position, boid.perceptionRadius);
      const flockmates  = [];
      const enemies     = [];

      for (const id of neighborIds) {
        if (id === entity.id) continue;
        const other = world.getEntity(id);
        if (!other || other.destroyed) continue;

        const otherTf   = other.get(TransformComponent);
        const otherKin  = other.get(KinematicsComponent);
        const otherBoid = other.get(BoidComponent);
        if (!otherTf) continue;

        const neighborData = {
          position: otherTf.position,
          velocity: otherKin ? otherKin.velocity : null,
          flockType: otherBoid ? otherBoid.flockType : 'neutral',
        };

        if (otherBoid && otherBoid.flockType === boid.flockType) {
          flockmates.push(neighborData);
        } else if (otherBoid) {
          enemies.push(neighborData);
        }
      }

      if (boid.flockType === 'blue') {
        computeBlueFlockSteering(
          tf.position,
          kin.velocity,
          flockmates,
          enemies,
          boid.separationRadius,
          boid.maxSpeed,
          boid.maxForce,
          this._steerForce
        );
      } else if (boid.flockType === 'crimson') {
        boid.wanderAngle += (Math.random() - 0.5) * 0.45;
        computeCrimsonHunterSteering(
          tf.position,
          kin.velocity,
          flockmates,
          enemies,
          boid.wanderAngle,
          boid.separationRadius,
          boid.maxSpeed,
          boid.maxForce,
          this._steerForce
        );
      }

      kin.applyForce(this._steerForce);
    }
  }

  get grid() { return this._grid; }
}

// ─────────────────────────────────────────────────────────────
//  PlayerInputSystem  (Phase 3 & 4)
// ─────────────────────────────────────────────────────────────

/**
 * Handles keyboard flight controls, continuous weapon trigger (Mouse/Space),
 * and audio effects.
 */
export class PlayerInputSystem {
  /**
   * @param {object} [opts]
   * @param {import('../core/viewport.js').Viewport} [opts.viewport]
   * @param {import('../core/events.js').EventBus} [opts.bus]
   * @param {import('../fx/particle_pool.js').ParticlePool} [opts.particlePool]
   * @param {import('../audio/sound_synth.js').SoundSynth} [opts.soundSynth]
   */
  constructor({ viewport = null, bus = null, particlePool = null, soundSynth = null } = {}) {
    this.viewport     = viewport;
    this.bus          = bus;
    this.particlePool = particlePool;
    this.soundSynth   = soundSynth;

    this.keys = {
      forward:  false,
      backward: false,
      left:     false,
      right:    false,
      fire:     false,
    };

    this.isPointerDown = false;
    this.mouseCanvasPos = new Vec2(0, 0);
    this._thrust = new Vec2();

    this._onKeyDown     = this._handleKeyDown.bind(this);
    this._onKeyUp       = this._handleKeyUp.bind(this);
    this._onMouseMove   = this._handleMouseMove.bind(this);
    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onPointerUp   = this._handlePointerUp.bind(this);

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown',     this._onKeyDown);
      window.addEventListener('keyup',       this._onKeyUp);
      window.addEventListener('mousemove',   this._onMouseMove);
      window.addEventListener('pointerdown', this._onPointerDown);
      window.addEventListener('pointerup',   this._onPointerUp);
    }
  }

  get componentTypes() {
    return [TransformComponent, KinematicsComponent, PlayerControllerComponent];
  }

  _handleKeyDown(e) {
    if (e.target !== document.body && e.target !== document.documentElement) return;

    if (e.code === 'KeyW' || e.code === 'ArrowUp')    this.keys.forward  = true;
    if (e.code === 'KeyS' || e.code === 'ArrowDown')  this.keys.backward = true;
    if (e.code === 'KeyA' || e.code === 'ArrowLeft')  this.keys.left     = true;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') this.keys.right    = true;

    if (e.code === 'Space') {
      this.keys.fire = true;
    }

    if (e.code === 'KeyM') {
      this.toggleMode();
    }

    if (e.code === 'KeyX') {
      if (this.soundSynth) {
        const isMuted = this.soundSynth.toggleMute();
        if (this.bus) this.bus.emit('sound:muteToggle', isMuted);
      }
    }
  }

  _handleKeyUp(e) {
    if (e.code === 'KeyW' || e.code === 'ArrowUp')    this.keys.forward  = false;
    if (e.code === 'KeyS' || e.code === 'ArrowDown')  this.keys.backward = false;
    if (e.code === 'KeyA' || e.code === 'ArrowLeft')  this.keys.left     = false;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') this.keys.right    = false;
    if (e.code === 'Space')                           this.keys.fire     = false;
  }

  _handleMouseMove(e) {
    if (this.viewport) {
      const p = this.viewport.eventToCanvas(e);
      this.mouseCanvasPos.set(p.x, p.y);
    } else {
      this.mouseCanvasPos.set(e.clientX, e.clientY);
    }
  }

  _handlePointerDown(e) {
    if (e.button === 0) {
      this.isPointerDown = true;
    }
  }

  _handlePointerUp(e) {
    if (e.button === 0) {
      this.isPointerDown = false;
    }
  }

  toggleMode() {
    if (this.bus) {
      this.bus.emit('player:modeToggle');
    }
  }

  fixedUpdate(entities, dt) {
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      const ctrl = entity.get(PlayerControllerComponent);
      const tf   = entity.get(TransformComponent);
      const kin  = entity.get(KinematicsComponent);

      ctrl.cursorPosition.copyFrom(this.mouseCanvasPos);
      ctrl.thrustForward  = this.keys.forward;
      ctrl.thrustBackward = this.keys.backward;
      ctrl.strafeLeft     = this.keys.left;
      ctrl.strafeRight    = this.keys.right;

      // Continuous firing trigger in manual mode
      ctrl.firingPrimary = (this.isPointerDown || this.keys.fire) && ctrl.isManualControlled;

      if (!ctrl.isManualControlled) {
        ctrl.thrusterActive = Math.max(0, ctrl.thrusterActive - dt * 2.5);
        if (this.soundSynth) this.soundSynth.playThruster(false);
        continue;
      }

      // 1. Aim heading towards mouse cursor
      const dx = ctrl.cursorPosition.x - tf.position.x;
      const dy = ctrl.cursorPosition.y - tf.position.y;
      if (dx * dx + dy * dy > 4) {
        const targetRot = Math.atan2(dy, dx);
        const diff = wrapAngle(targetRot - tf.rotation);
        tf.rotation = wrapAngle(tf.rotation + diff * Math.min(1, ctrl.turnRate * dt));
      }

      // 2. Directional thruster integration
      this._thrust.reset();
      const fwdX = Math.cos(tf.rotation);
      const fwdY = Math.sin(tf.rotation);
      const rightX = -fwdY;
      const rightY = fwdX;

      let isThrusting = false;
      if (ctrl.thrustForward) {
        this._thrust.x += fwdX * ctrl.thrustForce;
        this._thrust.y += fwdY * ctrl.thrustForce;
        isThrusting = true;
      }
      if (ctrl.thrustBackward) {
        this._thrust.x -= fwdX * ctrl.thrustForce * 0.55;
        this._thrust.y -= fwdY * ctrl.thrustForce * 0.55;
        isThrusting = true;
      }
      if (ctrl.strafeLeft) {
        this._thrust.x -= rightX * ctrl.thrustForce * 0.7;
        this._thrust.y -= rightY * ctrl.thrustForce * 0.7;
        isThrusting = true;
      }
      if (ctrl.strafeRight) {
        this._thrust.x += rightX * ctrl.thrustForce * 0.7;
        this._thrust.y += rightY * ctrl.thrustForce * 0.7;
        isThrusting = true;
      }

      if (isThrusting) {
        ctrl.thrusterActive = Math.min(1, ctrl.thrusterActive + dt * 6);
        kin.applyForce(this._thrust);

        // Emit physical thruster sparks
        if (this.particlePool && Math.random() < 0.75) {
          const rearOffset = 12 * tf.scale;
          const rx = tf.position.x - fwdX * rearOffset;
          const ry = tf.position.y - fwdY * rearOffset;
          this.particlePool.emitThrusterSparks(rx, ry, tf.rotation);
        }
      } else {
        ctrl.thrusterActive = Math.max(0, ctrl.thrusterActive - dt * 3.5);
      }

      // Thruster continuous audio modulation
      if (this.soundSynth) {
        this.soundSynth.playThruster(isThrusting, ctrl.thrusterActive);
      }
    }
  }

  destroy() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown',     this._onKeyDown);
      window.removeEventListener('keyup',       this._onKeyUp);
      window.removeEventListener('mousemove',   this._onMouseMove);
      window.removeEventListener('pointerdown', this._onPointerDown);
      window.removeEventListener('pointerup',   this._onPointerUp);
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  CombatSystem  (Phase 4)
// ─────────────────────────────────────────────────────────────

/**
 * Handles weapon firing, projectile movement, damage application,
 * particle explosions, and audio triggers.
 */
export class CombatSystem {
  /**
   * @param {object} [opts]
   * @param {import('../combat/projectile_pool.js').ProjectilePool} opts.projectilePool
   * @param {import('../fx/particle_pool.js').ParticlePool} opts.particlePool
   * @param {import('../audio/sound_synth.js').SoundSynth} [opts.soundSynth]
   * @param {import('../core/events.js').EventBus} [opts.bus]
   */
  constructor({ projectilePool, particlePool, soundSynth = null, bus = null } = {}) {
    this.projectilePool   = projectilePool;
    this.particlePool     = particlePool;
    this.soundSynth       = soundSynth;
    this.bus              = bus;

    this.enemiesDestroyed = 0;
  }

  get componentTypes() {
    return [TransformComponent, CombatStateComponent];
  }

  fixedUpdate(entities, dt, world) {
    if (!this.projectilePool) return;

    // 1. Advance projectile physics & lifetime
    this.projectilePool.update(dt);

    // 2. Advance particle decay
    if (this.particlePool) {
      this.particlePool.update(dt);
    }

    // 3. Process entities with WeaponComponent (Player + Hunters)
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      const weapon = entity.get(WeaponComponent);
      if (!weapon) continue;

      weapon.update(dt);

      const tf = entity.get(TransformComponent);
      const playerCtrl = entity.get(PlayerControllerComponent);

      // Player Weapon
      if (playerCtrl) {
        if (playerCtrl.firingPrimary) {
          firePlayerCannon(
            tf,
            weapon,
            playerCtrl.cursorPosition,
            this.projectilePool,
            this.particlePool,
            this.soundSynth
          );
        }
      } else {
        // Boss Dreadnought vs Standard Hunter
        const rc = entity.get(RenderComponent);
        if (entity.isBoss || rc?.shape === 'dreadnought') {
          if (weapon.cooldown <= 0) {
            const playerEntity = world.query([PlayerControllerComponent, TransformComponent])[0];
            const pTf = playerEntity?.get(TransformComponent);
            fireBossTurrets(
              tf,
              weapon,
              pTf ? pTf.position : null,
              this.projectilePool,
              this.particlePool,
              this.soundSynth
            );
          }
        } else {
          // Standard Hunter / Crimson Drone Spore Emitter
          const boid = entity.get(BoidComponent);
          if (boid && boid.flockType === 'crimson') {
            if (Math.random() < 0.015 && weapon.cooldown <= 0) {
              fireHunterSpore(
                tf,
                weapon,
                null,
                this.projectilePool,
                this.particlePool,
                this.soundSynth
              );
            }
          }
        }
      }
    }

    // 4. Projectile-to-agent collision resolution
    this.projectilePool.forEachActive(p => {
      for (let i = 0; i < entities.length; i++) {
        const entity = entities[i];
        if (entity.destroyed) continue;

        const boid = entity.get(BoidComponent);
        const entityTeam = boid ? boid.flockType : (entity.get(AgentStateComponent)?.team || 'blue');

        // Opposing team check only
        if (entityTeam === p.team) continue;

        const tf = entity.get(TransformComponent);
        if (!tf) continue;

        const col = entity.get(ColliderComponent);
        const radius = col ? col.shape.radius * tf.scale : 8 * tf.scale;
        const hitDist = radius + p.radius;

        const dx = p.x - tf.position.x;
        const dy = p.y - tf.position.y;
        const distSq = dx * dx + dy * dy;

        if (distSq <= hitDist * hitDist) {
          // Direct impact hit!
          const combat = entity.get(CombatStateComponent);
          const kin = entity.get(KinematicsComponent);
          const rc = entity.get(RenderComponent);

          // Impact sparks & audio
          if (this.particlePool) {
            const hitNormal = {
              x: dx / (Math.sqrt(distSq) || 1),
              y: dy / (Math.sqrt(distSq) || 1),
            };
            this.particlePool.emitImpactSparks(p.x, p.y, hitNormal, 10, p.color);
          }

          if (this.soundSynth) {
            this.soundSynth.playImpact(0.08);
          }

          // Kinetic knockback impulse
          if (kin) {
            const impulseMag = 40;
            const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 1;
            kin.velocity.x += (p.vx / spd) * impulseMag;
            kin.velocity.y += (p.vy / spd) * impulseMag;
          }

          // Hit visual flash
          if (col) col.flashTimer = 0.16;

          // Recycle projectile immediately
          p.active = false;

          // Apply damage & check destruction
          if (combat) {
            const isKilled = combat.takeDamage(p.damage);
            if (isKilled) {
              this.enemiesDestroyed++;
              const isBoss = entity.isBoss || (combat.maxHealth >= 800) || (rc?.shape === 'dreadnought');

              // Radial blast explosion FX
              if (this.particlePool) {
                this.particlePool.emitExplosion(
                  tf.position.x,
                  tf.position.y,
                  isBoss ? 64 : (entityTeam === 'crimson' ? 36 : 24),
                  rc ? rc.color : (entityTeam === 'crimson' ? '#ff2d55' : '#00ffe7')
                );
              }

              if (this.soundSynth) {
                this.soundSynth.playExplosion(isBoss ? 0.75 : 0.48);
              }

              if (this.bus) {
                this.bus.emit('entity:destroyed', { entity, killerTeam: p.team, isBoss });
              }

              world.destroyEntity(entity);
            }
          }

          break; // Projectile spent
        }
      }
    });
  }
}

// ─────────────────────────────────────────────────────────────
//  RenderSystem  (Phase 4 — with Additive Particles & Lasers)
// ─────────────────────────────────────────────────────────────

const _DEBUG_GRID_STYLE   = 'rgba(0, 255, 231, 0.08)';
const _DEBUG_COLLIDER_OK  = 'rgba(0, 255, 100, 0.55)';
const _DEBUG_COLLIDER_HIT = 'rgba(255, 50, 50, 0.90)';
const _CROSSHAIR_AMBER    = 'rgba(255, 196, 0, 0.85)';

export class RenderSystem {
  /**
   * @param {object} [opts]
   * @param {boolean} [opts.debugWireframe=false]
   * @param {import('../physics/spatial_hash.js').SpatialHashGrid|null} [opts.grid]
   * @param {import('../core/viewport.js').Viewport|null} [opts.viewport]
   * @param {import('../combat/projectile_pool.js').ProjectilePool|null} [opts.projectilePool]
   * @param {import('../fx/particle_pool.js').ParticlePool|null} [opts.particlePool]
   */
  constructor({
    debugWireframe = false,
    enableGlow     = true,
    grid           = null,
    viewport       = null,
    projectilePool = null,
    particlePool   = null,
  } = {}) {
    this.debugWireframe = debugWireframe;
    this.enableGlow     = enableGlow;
    this.grid           = grid;
    this.viewport       = viewport;
    this.projectilePool = projectilePool;
    this.particlePool   = particlePool;

    this._crosshairSpin = 0;
  }

  get componentTypes() {
    return [TransformComponent, RenderComponent];
  }

  render(entities, ctx, alpha) {
    // 1. Optional spatial grid debug overlay
    if (this.debugWireframe && this.grid && this.viewport) {
      this._drawGrid(ctx);
    }

    let activeManualPlayer = null;

    // 2. Render all entities
    for (const entity of entities) {
      const tf = entity.get(TransformComponent);
      const rc = entity.get(RenderComponent);

      if (!rc.visible || rc.alpha <= 0) continue;

      const playerCtrl = entity.get(PlayerControllerComponent);
      if (playerCtrl?.isManualControlled) {
        activeManualPlayer = { tf, ctrl: playerCtrl };
      }

      // Interpolated transform
      const x   = lerp(tf.prevPosition.x, tf.position.x, alpha);
      const y   = lerp(tf.prevPosition.y, tf.position.y, alpha);
      const rot = lerp(tf.prevRotation,   tf.rotation,   alpha);
      const sz  = rc.size * tf.scale;

      // Collision flash
      const col        = entity.get(ColliderComponent);
      const isFlashing = col && col.flashTimer > 0;
      const flashT     = isFlashing ? Math.min(1, col.flashTimer / 0.12) : 0;

      ctx.save();
      ctx.globalAlpha = rc.alpha;
      ctx.translate(x, y);
      ctx.rotate(rot);

      // Dual-engine thruster flames for flagship
      if (rc.shape === 'flagship') {
        const thrusterPower = playerCtrl ? playerCtrl.thrusterActive : 0.4;
        this._drawThrusterFlames(ctx, sz, thrusterPower);
      }

      // Glow — amplified during collision flash (honors enableGlow)
      const glowRadius = this.enableGlow ? (isFlashing ? rc.glow + flashT * 22 : rc.glow) : 0;
      if (glowRadius > 0) {
        ctx.shadowBlur  = glowRadius;
        ctx.shadowColor = isFlashing ? '#ffffff' : rc.color;
      } else {
        ctx.shadowBlur = 0;
      }

      // Color lerp
      ctx.fillStyle   = isFlashing ? this._lerpColor(rc.color, '#ffffff', flashT * 0.7) : rc.color;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth   = 1.2;

      ctx.beginPath();
      switch (rc.shape) {
        case 'arrowhead':
          this._drawArrowhead(ctx, sz);
          break;
        case 'spiked_diamond':
          this._drawSpikedDiamond(ctx, sz);
          break;
        case 'flagship':
          this._drawFlagship(ctx, sz);
          break;
        case 'dreadnought':
          this._drawDreadnought(ctx, sz);
          break;
        case 'diamond':
          this._drawDiamond(ctx, sz);
          break;
        case 'circle':
          this._drawCircle(ctx, sz);
          break;
        case 'triangle':
        default:
          this._drawTriangle(ctx, sz);
          break;
      }
      ctx.closePath();
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.globalAlpha = rc.alpha * 0.6;
      ctx.stroke();

      ctx.restore();

      // Debug: collider wireframe overlay
      if (this.debugWireframe && col) {
        this._drawColliderWireframe(ctx, entity, tf, col, isFlashing, x, y, alpha);
      }
    }

    // 3. Render active projectiles
    if (this.projectilePool) {
      this._drawProjectiles(ctx);
    }

    // 4. Render additive particle FX
    if (this.particlePool) {
      this._drawParticles(ctx);
    }

    // 5. Render interactive targeting crosshair
    if (activeManualPlayer && this.viewport) {
      this._crosshairSpin += 0.025;
      this._drawCrosshair(ctx, activeManualPlayer.ctrl.cursorPosition, activeManualPlayer.tf.position);
    }
  }

  // ── Projectile Drawing ────────────────────────────────────

  _drawProjectiles(ctx) {
    const useGlow = this.enableGlow;
    this.projectilePool.forEachActive(p => {
      ctx.save();
      if (useGlow) {
        ctx.shadowBlur  = 12;
        ctx.shadowColor = p.color;
      }
      ctx.fillStyle   = p.color;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = 1;

      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 1;
      const nx = p.vx / speed;
      const ny = p.vy / speed;
      const len = Math.max(7, p.radius * 3.2);

      // Trailing laser core line
      ctx.beginPath();
      ctx.moveTo(p.x + nx * p.radius, p.y + ny * p.radius);
      ctx.lineTo(p.x - nx * len, p.y - ny * len);
      ctx.stroke();

      // Front head bead
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    });
  }

  // ── Additive Particle FX Drawing ──────────────────────────

  _drawParticles(ctx) {
    ctx.save();
    // Hardware-accelerated additive neon blooms!
    ctx.globalCompositeOperation = 'lighter';

    const pool    = this.particlePool.pool;
    const len     = this.particlePool.maxCapacity;
    const useGlow = this.enableGlow;

    for (let i = 0; i < len; i++) {
      const pt = pool[i];
      if (!pt.active || pt.alpha <= 0) continue;

      ctx.globalAlpha = pt.alpha;
      ctx.fillStyle   = pt.color;
      if (useGlow) {
        ctx.shadowColor = pt.color;
        ctx.shadowBlur  = 8;
      }

      if (pt.shape === 'ring') {
        ctx.strokeStyle = pt.color;
        ctx.lineWidth   = 2.2;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, Math.max(0.1, pt.size), 0, Math.PI * 2);
        ctx.stroke();
      } else if (pt.shape === 'spark') {
        const speed = Math.sqrt(pt.vx * pt.vx + pt.vy * pt.vy) || 1;
        const tailLen = Math.min(18, speed * 0.08);
        ctx.strokeStyle = pt.color;
        ctx.lineWidth   = pt.size * 0.85;
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y);
        ctx.lineTo(pt.x - (pt.vx / speed) * tailLen, pt.y - (pt.vy / speed) * tailLen);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, Math.max(0.1, pt.size), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Always reset to standard composite mode
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  // ── Ship Sprite Path Builders ─────────────────────────────

  _drawArrowhead(ctx, sz) {
    ctx.moveTo(sz * 1.5,  0);
    ctx.lineTo(-sz * 0.85, sz * 0.75);
    ctx.lineTo(-sz * 0.35, 0);
    ctx.lineTo(-sz * 0.85, -sz * 0.75);
  }

  _drawSpikedDiamond(ctx, sz) {
    ctx.moveTo(sz * 1.7,  0);
    ctx.lineTo(sz * 0.2,  sz * 0.5);
    ctx.lineTo(-sz * 0.2, sz * 1.25);
    ctx.lineTo(-sz * 0.5, sz * 0.35);
    ctx.lineTo(-sz * 1.3, 0);
    ctx.lineTo(-sz * 0.5, -sz * 0.35);
    ctx.lineTo(-sz * 0.2, -sz * 1.25);
    ctx.lineTo(sz * 0.2,  -sz * 0.5);
  }

  _drawFlagship(ctx, sz) {
    ctx.moveTo(sz * 1.9,  0);
    ctx.lineTo(sz * 0.9,  sz * 0.4);
    ctx.lineTo(-sz * 0.1, sz * 1.4);
    ctx.lineTo(-sz * 0.6, sz * 1.15);
    ctx.lineTo(-sz * 0.5, sz * 0.5);
    ctx.lineTo(-sz * 1.2, sz * 0.5);
    ctx.lineTo(-sz * 1.2, sz * 0.2);
    ctx.lineTo(-sz * 0.8, 0);
    ctx.lineTo(-sz * 1.2, -sz * 0.2);
    ctx.lineTo(-sz * 1.2, -sz * 0.5);
    ctx.lineTo(-sz * 0.5, -sz * 0.5);
    ctx.lineTo(-sz * 0.6, -sz * 1.15);
    ctx.lineTo(-sz * 0.1, -sz * 1.4);
    ctx.lineTo(sz * 0.9,  -sz * 0.4);
  }

  _drawDreadnought(ctx, sz) {
    ctx.moveTo(sz * 2.2, 0);
    ctx.lineTo(sz * 1.2, sz * 0.7);
    ctx.lineTo(sz * 0.4, sz * 0.5);
    ctx.lineTo(0, sz * 1.6);
    ctx.lineTo(-sz * 0.8, sz * 1.3);
    ctx.lineTo(-sz * 0.7, sz * 0.6);
    ctx.lineTo(-sz * 1.5, sz * 0.6);
    ctx.lineTo(-sz * 1.5, sz * 0.2);
    ctx.lineTo(-sz * 1.1, 0);
    ctx.lineTo(-sz * 1.5, -sz * 0.2);
    ctx.lineTo(-sz * 1.5, -sz * 0.6);
    ctx.lineTo(-sz * 0.7, -sz * 0.6);
    ctx.lineTo(-sz * 0.8, -sz * 1.3);
    ctx.lineTo(0, -sz * 1.6);
    ctx.lineTo(sz * 0.4, -sz * 0.5);
    ctx.lineTo(sz * 1.2, -sz * 0.7);
  }

  _drawThrusterFlames(ctx, sz, power) {
    if (power <= 0.05) return;

    const flicker = 0.8 + Math.random() * 0.4;
    const flameLen = sz * (1.2 + power * 1.8) * flicker;

    ctx.save();
    ctx.shadowBlur = 15;
    ctx.shadowColor = '#00ffe7';
    ctx.fillStyle = '#00ffe7';

    // Right flame
    ctx.beginPath();
    ctx.moveTo(-sz * 1.2, sz * 0.48);
    ctx.lineTo(-sz * 1.2 - flameLen, sz * 0.35);
    ctx.lineTo(-sz * 1.2, sz * 0.22);
    ctx.closePath();
    ctx.fill();

    // Left flame
    ctx.beginPath();
    ctx.moveTo(-sz * 1.2, -0.22);
    ctx.lineTo(-sz * 1.2 - flameLen, -sz * 0.35);
    ctx.lineTo(-sz * 1.2, -0.48);
    ctx.closePath();
    ctx.fill();

    // Inner white core
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(-sz * 1.2, sz * 0.42);
    ctx.lineTo(-sz * 1.2 - flameLen * 0.5, sz * 0.35);
    ctx.lineTo(-sz * 1.2, sz * 0.28);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(-sz * 1.2, -0.28);
    ctx.lineTo(-sz * 1.2 - flameLen * 0.5, -sz * 0.35);
    ctx.lineTo(-sz * 1.2, -0.42);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  _drawCrosshair(ctx, cursor, shipPos) {
    const cx = cursor.x;
    const cy = cursor.y;

    ctx.save();
    ctx.strokeStyle = _CROSSHAIR_AMBER;
    ctx.fillStyle   = _CROSSHAIR_AMBER;
    ctx.lineWidth   = 1.5;
    ctx.shadowBlur  = 10;
    ctx.shadowColor = _CROSSHAIR_AMBER;

    // Line from ship to crosshair
    ctx.save();
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = 'rgba(255, 196, 0, 0.25)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(shipPos.x, shipPos.y);
    ctx.lineTo(cx, cy);
    ctx.stroke();
    ctx.restore();

    // Rotating outer reticle
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this._crosshairSpin);

    const r = 16;
    const arcLen = Math.PI / 4;
    for (let i = 0; i < 4; i++) {
      const startAngle = i * (Math.PI / 2) - arcLen / 2;
      ctx.beginPath();
      ctx.arc(0, 0, r, startAngle, startAngle + arcLen);
      ctx.stroke();
    }

    const tStart = 19;
    const tEnd   = 24;
    for (let i = 0; i < 4; i++) {
      const angle = i * (Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * tStart, Math.sin(angle) * tStart);
      ctx.lineTo(Math.cos(angle) * tEnd,   Math.sin(angle) * tEnd);
      ctx.stroke();
    }
    ctx.restore();

    // Center pip
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

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

const _steer = new Vec2();

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

      const rb = entity.get(RigidBodyComponent);
      if (rb?.isStatic) continue;

      if (entity.has(BoidComponent)) continue;

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
