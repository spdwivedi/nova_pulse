/**
 * @file projectile_pool.js
 * @description Pre-allocated object pool for projectile weapons.
 *
 * Eliminates garbage collection pauses during high-frequency combat.
 * Capacity: 400 projectiles.
 * When the pool is exhausted, it reuses the oldest active projectile.
 */

export class Projectile {
  constructor(index) {
    this.index   = index;
    this.x       = 0;
    this.y       = 0;
    this.vx      = 0;
    this.vy      = 0;
    this.radius  = 3;
    this.damage  = 15;
    this.team    = 'blue';
    this.ttl     = 0;
    this.maxTtl  = 1;
    this.active  = false;
    this.color   = '#00ffe7';
  }

  reset() {
    this.active = false;
    this.ttl    = 0;
    this.vx     = 0;
    this.vy     = 0;
  }
}

export class ProjectilePool {
  /**
   * @param {number} [capacity=400]
   */
  constructor(capacity = 400) {
    this.maxCapacity   = capacity;
    this.pool          = new Array(capacity);
    this._nextSearch   = 0;
    this.totalSpawned  = 0;

    for (let i = 0; i < capacity; i++) {
      this.pool[i] = new Projectile(i);
    }
  }

  /**
   * Spawn a projectile from the pool.
   * If all 400 are active, reuses the oldest active slot.
   *
   * @param {number} x
   * @param {number} y
   * @param {number} vx
   * @param {number} vy
   * @param {'blue'|'crimson'} [team='blue']
   * @param {number} [damage=15]
   * @param {number} [ttl=1.5]
   * @param {string} [color='#00ffe7']
   * @param {number} [radius=3]
   * @returns {Projectile}
   */
  spawn(x, y, vx, vy, team = 'blue', damage = 15, ttl = 1.5, color = '#00ffe7', radius = 3) {
    let chosen = null;

    // 1. Search for an inactive projectile
    for (let i = 0; i < this.maxCapacity; i++) {
      const idx = (this._nextSearch + i) % this.maxCapacity;
      if (!this.pool[idx].active) {
        chosen = this.pool[idx];
        this._nextSearch = (idx + 1) % this.maxCapacity;
        break;
      }
    }

    // 2. Pool exhausted: recycle the oldest (lowest remaining ttl)
    if (!chosen) {
      let minTtl = Infinity;
      let oldestIdx = 0;
      for (let i = 0; i < this.maxCapacity; i++) {
        if (this.pool[i].ttl < minTtl) {
          minTtl = this.pool[i].ttl;
          oldestIdx = i;
        }
      }
      chosen = this.pool[oldestIdx];
      this._nextSearch = (oldestIdx + 1) % this.maxCapacity;
    }

    // 3. Initialize projectile fields
    chosen.x      = x;
    chosen.y      = y;
    chosen.vx     = vx;
    chosen.vy     = vy;
    chosen.team   = team;
    chosen.damage = damage;
    chosen.ttl    = ttl;
    chosen.maxTtl = ttl;
    chosen.color  = color;
    chosen.radius = radius;
    chosen.active = true;

    this.totalSpawned++;
    return chosen;
  }

  /**
   * Advance simulation time for all active projectiles.
   * @param {number} dt - delta time in seconds
   */
  update(dt) {
    for (let i = 0; i < this.maxCapacity; i++) {
      const p = this.pool[i];
      if (!p.active) continue;

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.ttl -= dt;

      if (p.ttl <= 0) {
        p.active = false;
      }
    }
  }

  /**
   * Deactivate a projectile by index or reference.
   * @param {number|Projectile} indexOrProj
   */
  recycle(indexOrProj) {
    const p = typeof indexOrProj === 'number' ? this.pool[indexOrProj] : indexOrProj;
    if (p) p.active = false;
  }

  /**
   * Return an array of all currently active projectiles.
   * @returns {Projectile[]}
   */
  getActive() {
    const list = [];
    for (let i = 0; i < this.maxCapacity; i++) {
      if (this.pool[i].active) list.push(this.pool[i]);
    }
    return list;
  }

  /**
   * Zero-allocation iteration through active projectiles.
   * @param {function(Projectile): void} fn
   */
  forEachActive(fn) {
    for (let i = 0; i < this.maxCapacity; i++) {
      if (this.pool[i].active) fn(this.pool[i]);
    }
  }

  /**
   * Number of active projectiles.
   */
  get activeCount() {
    let count = 0;
    for (let i = 0; i < this.maxCapacity; i++) {
      if (this.pool[i].active) count++;
    }
    return count;
  }

  /**
   * Reset all projectiles to inactive.
   */
  clear() {
    for (let i = 0; i < this.maxCapacity; i++) {
      this.pool[i].reset();
    }
    this._nextSearch = 0;
  }
}
