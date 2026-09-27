/**
 * @file particle_pool.js
 * @description Pre-allocated 800-slot particle engine with hardware-accelerated additive blending.
 *
 * Supports zero-allocation emitter bursts:
 *  - emitMuzzleFlash
 *  - emitImpactSparks
 *  - emitExplosion
 *  - emitThrusterSparks
 */

export class Particle {
  constructor(index) {
    this.index      = index;
    this.x          = 0;
    this.y          = 0;
    this.vx         = 0;
    this.vy         = 0;
    this.size       = 2;
    this.startSize  = 2;
    this.color      = '#00ffe7';
    this.alpha      = 1;
    this.maxAlpha   = 1;
    this.life       = 0;
    this.maxLife    = 0.5;
    this.damping    = 0.95;
    this.active     = false;
    this.shape      = 'circle'; // 'circle' | 'spark' | 'ring'
  }

  reset() {
    this.active = false;
    this.life   = 0;
    this.vx     = 0;
    this.vy     = 0;
  }
}

export class ParticlePool {
  /**
   * @param {number} [capacity=800]
   */
  constructor(capacity = 800) {
    this.maxCapacity = capacity;
    this.pool        = new Array(capacity);
    this._nextSearch = 0;

    for (let i = 0; i < capacity; i++) {
      this.pool[i] = new Particle(i);
    }
  }

  /**
   * Spawn a single particle from the pool.
   *
   * @param {number} x
   * @param {number} y
   * @param {number} vx
   * @param {number} vy
   * @param {number} size
   * @param {string} color
   * @param {number} [maxLife=0.4]
   * @param {number} [maxAlpha=1.0]
   * @param {number} [damping=0.96]
   * @param {'circle'|'spark'|'ring'} [shape='circle']
   * @returns {Particle}
   */
  spawn(x, y, vx, vy, size, color, maxLife = 0.4, maxAlpha = 1.0, damping = 0.96, shape = 'circle') {
    let p = null;

    // Search for an inactive particle
    for (let i = 0; i < this.maxCapacity; i++) {
      const idx = (this._nextSearch + i) % this.maxCapacity;
      if (!this.pool[idx].active) {
        p = this.pool[idx];
        this._nextSearch = (idx + 1) % this.maxCapacity;
        break;
      }
    }

    // Pool exhausted: recycle oldest
    if (!p) {
      let maxRatio = -1;
      let oldestIdx = 0;
      for (let i = 0; i < this.maxCapacity; i++) {
        const ratio = this.pool[i].life / (this.pool[i].maxLife || 1);
        if (ratio > maxRatio) {
          maxRatio = ratio;
          oldestIdx = i;
        }
      }
      p = this.pool[oldestIdx];
      this._nextSearch = (oldestIdx + 1) % this.maxCapacity;
    }

    p.x         = x;
    p.y         = y;
    p.vx        = vx;
    p.vy        = vy;
    p.size      = size;
    p.startSize = size;
    p.color     = color;
    p.alpha     = maxAlpha;
    p.maxAlpha  = maxAlpha;
    p.life      = 0;
    p.maxLife   = maxLife;
    p.damping   = damping;
    p.shape     = shape;
    p.active    = true;

    return p;
  }

  /**
   * Update particle positions, alpha, and size decay.
   * @param {number} dt
   */
  update(dt) {
    for (let i = 0; i < this.maxCapacity; i++) {
      const p = this.pool[i];
      if (!p.active) continue;

      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        continue;
      }

      // Physics update
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= p.damping;
      p.vy *= p.damping;

      const progress = p.life / p.maxLife; // 0 to 1

      // Alpha fadeout
      p.alpha = p.maxAlpha * (1 - progress);

      // Expansion for ring, decay for sparks
      if (p.shape === 'ring') {
        p.size = p.startSize + progress * 32;
      } else {
        p.size = p.startSize * (1 - progress * 0.7);
      }
    }
  }

  // ── Preset Emitters ───────────────────────────────────────

  /**
   * Muzzle flash burst at gun barrel tip.
   */
  emitMuzzleFlash(x, y, angle, color = '#00ffe7') {
    for (let i = 0; i < 5; i++) {
      const spread = (Math.random() - 0.5) * 0.8;
      const speed = 60 + Math.random() * 90;
      const vx = Math.cos(angle + spread) * speed;
      const vy = Math.sin(angle + spread) * speed;
      this.spawn(x, y, vx, vy, 2.5 + Math.random() * 2, color, 0.12 + Math.random() * 0.08, 0.9, 0.88, 'spark');
    }
  }

  /**
   * High-speed directional sparks on projectile or shield impact.
   */
  emitImpactSparks(x, y, normal = null, count = 10, color = '#00ffe7') {
    const baseAngle = normal ? Math.atan2(normal.y, normal.x) : Math.random() * Math.PI * 2;

    for (let i = 0; i < count; i++) {
      const spread = (Math.random() - 0.5) * Math.PI;
      const speed = 80 + Math.random() * 220;
      const angle = baseAngle + spread;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;

      this.spawn(x, y, vx, vy, 2 + Math.random() * 2.5, color, 0.2 + Math.random() * 0.25, 1.0, 0.92, 'spark');
    }
  }

  /**
   * Massive radial blast ring + neon shrapnel on entity death.
   */
  emitExplosion(x, y, count = 28, baseColor = '#ff2d55') {
    // 1. Expanding shockwave ring
    this.spawn(x, y, 0, 0, 4, baseColor, 0.35, 0.85, 1.0, 'ring');

    // 2. High-speed radiant debris
    const colors = [baseColor, '#ffffff', '#ffee00'];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
      const speed = 70 + Math.random() * 280;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      const col = colors[i % colors.length];

      this.spawn(
        x, y, vx, vy,
        3 + Math.random() * 3.5,
        col,
        0.35 + Math.random() * 0.45,
        1.0,
        0.91,
        'spark'
      );
    }
  }

  /**
   * Thruster exhaust sparks emitted behind ship engines.
   */
  emitThrusterSparks(x, y, angle, color = '#00ffe7') {
    const reverseAngle = angle + Math.PI + (Math.random() - 0.5) * 0.5;
    const speed = 40 + Math.random() * 90;
    const vx = Math.cos(reverseAngle) * speed;
    const vy = Math.sin(reverseAngle) * speed;

    this.spawn(x, y, vx, vy, 2 + Math.random() * 2, color, 0.16 + Math.random() * 0.12, 0.85, 0.94, 'circle');
  }

  /**
   * Total active particles.
   */
  get activeCount() {
    let count = 0;
    for (let i = 0; i < this.maxCapacity; i++) {
      if (this.pool[i].active) count++;
    }
    return count;
  }

  clear() {
    for (let i = 0; i < this.maxCapacity; i++) {
      this.pool[i].reset();
    }
    this._nextSearch = 0;
  }
}
