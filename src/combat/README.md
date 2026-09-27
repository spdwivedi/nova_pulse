# `src/combat/` — Projectile Weapons & Object Pool

The `combat` module manages all projectile state and weapon-firing logic. Every projectile in NovaPulse is pre-allocated in a fixed-capacity ring pool — no garbage collection occurs during combat, even at 450 simultaneous active projectiles.

---

## Files

### `projectile_pool.js` — Zero-Allocation Projectile Pool

#### Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                      ProjectilePool (cap = 450)                  │
│                                                                  │
│  _slots: [P0][P1][P2]...[P449]    (all created at startup)      │
│  _cursor: 0                        (ring-buffer next-spawn ptr)  │
│                                                                  │
│  spawn() → activates _slots[_cursor], advances cursor           │
│  update(dt) → advances all active slots, recycles expired        │
│  recycle(p) → p.active = false (slot available for reuse)        │
└──────────────────────────────────────────────────────────────────┘
```

All 450 `Projectile` objects are instantiated in the constructor. `spawn()` does not call `new` — it reactivates an existing slot by setting `p.active = true` and writing new position/velocity/config values. This guarantees zero heap allocation in the combat hot path.

When the pool is full (all 450 slots active), the cursor wraps and overwrites the **oldest** slot — a ring-buffer overwrite strategy that prevents blocking while maintaining continuous fire.

#### `Projectile` Object Properties

| Property | Type | Description |
|---|---|---|
| `active` | `bool` | True if this slot is currently live |
| `x`, `y` | `number` | World-space position |
| `vx`, `vy` | `number` | Velocity components (px/s) |
| `ttl` | `number` | Time-to-live (seconds remaining) |
| `maxTtl` | `number` | Original TTL for visual fade calculation |
| `damage` | `number` | HP dealt on hit |
| `team` | `string` | `'player'` / `'crimson'` / `'boss'` |
| `color` | `string` | CSS color for glow rendering |
| `glowRadius` | `number` | `ctx.shadowBlur` radius for this bolt |
| `size` | `number` | Draw radius (px) |

#### API

```js
const pool = new ProjectilePool(450);

// Spawn a new projectile
pool.spawn(x, y, vx, vy, {
  ttl: 1.5,
  damage: 28,
  team: 'player',
  color: '#4af',
  glowRadius: 8,
  size: 3
});

// Update all active projectiles (call each fixedUpdate tick)
pool.update(dt);

// Iterate all active projectiles (CombatSystem hit detection)
pool.forEachActive((projectile) => {
  // test against agents...
});

// Manually recycle (called by CombatSystem on hit)
pool.recycle(projectile);

pool.activeCount;   // → number of live projectiles
pool.capacity;      // → 450
```

#### `update(dt)` Implementation

```js
update(dt) {
  for (let i = 0; i < this._capacity; i++) {
    const p = this._slots[i];
    if (!p.active) continue;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.ttl -= dt;
    if (p.ttl <= 0) p.active = false;   // recycle — no deallocation
  }
}
```

Zero branches on inactive slots beyond the early `continue`. The entire pool is processed in a tight numeric loop.

---

### `weapons.js` — Weapon Firing Functions

All three weapon functions are **pure functions** with no internal state — they accept the relevant entities and pools as arguments and call `pool.spawn()`.

---

#### `firePlayerCannon(transform, weapon, cursorPos, projectilePool, particlePool, soundSynth)`

Fires **two simultaneous plasma bolts** from the flagship's wingtips:

```
For each bolt (left wing / right wing):
  1. Compute wing offset: ±2.5px perpendicular to heading
  2. Compute bolt velocity: (cos(heading), sin(heading)) × 520 px/s
  3. projectilePool.spawn(wingX, wingY, bvx, bvy, {
       ttl: 1.5, damage: 28, team: 'player', color: '#4af', glowRadius: 8, size: 3
     })
  4. particlePool.emitMuzzleFlash(wingX, wingY, heading, '#4af')
5. soundSynth.playLaser(820, 0.08)
```

**Weapon stats** (from `WeaponComponent` on flagship):
- Fire rate: 7.5 Hz → 0.133s cooldown per salvo
- Heat per salvo: 7.5 units
- Cooling rate: 38 units/second

---

#### `fireHunterSpore(transform, weapon, targetPos, projectilePool, particlePool, soundSynth)`

Fires a single crimson spore aimed toward the nearest prey:

```
1. Compute heading toward targetPos
2. Add spread jitter: heading ± random(spread) radians
3. projectilePool.spawn(x, y, vx, vy, {
     ttl: 2.0, damage: 15, team: 'crimson', color: '#f44', glowRadius: 5, size: 2.5
   })
4. particlePool.emitMuzzleFlash(x, y, heading, '#f44')
5. soundSynth.playLaser(640, 0.05)
```

Fire probability check in `CombatSystem`: `Math.random() < 0.015` per tick (~0.9 Hz on average).

---

#### `fireBossTurrets(transform, weapon, targetPos, projectilePool, particlePool, soundSynth)`

Fires a **5-way spread salvo** from each of 3 turret hardpoints on the Dreadnought:

```
turretOffsets = [
  { dx: 0,   dy: 0   },   // central spine cannon
  { dx: -22, dy: -8  },   // port turret
  { dx:  22, dy: -8  },   // starboard turret
]

For each turret:
  baseAngle = heading toward targetPos
  For each spread bolt (5 bolts, angles -30° to +30°):
    angle = baseAngle + spreadOffset
    projectilePool.spawn(turretX, turretY, cos(angle)×290, sin(angle)×290, {
      ttl: 3.2, damage: 25, team: 'boss', color: '#f0a', glowRadius: 10, size: 3.5
    })
  particlePool.emitExplosion(turretX, turretY, 5, '#f0a')

soundSynth.playImpact(0.7)
```

Total bolts per salvo: **15 bolts** (5 spread × 3 turrets).
Boss fire rate: 0.8 Hz → 0.8 salvo/s × 15 bolts = **12 bolts/second sustained**.

---

## Integration with CombatSystem

`CombatSystem.fixedUpdate(dt, world)`:

1. Update all weapon cooldowns: `weapon.update(dt)` for each entity with `WeaponComponent`
2. Update projectile pool: `projectilePool.update(dt)`
3. Update particle pool: `particlePool.update(dt)`
4. For each Crimson boid: if `Math.random() < 0.015 && weapon.canFire()` → `fireHunterSpore(...)`
5. For each Boss: if `weapon.canFire()` → `fireBossTurrets(...)`
6. If player in Manual mode and `isFiring && weapon.canFire()` → `firePlayerCannon(...)`
7. Hit detection: `projectilePool.forEachActive(p => grid.queryRadius({x:p.x, y:p.y}, 12) → test each candidate entity)`
8. On hit: `pool.recycle(p)`, `particlePool.emitImpactSparks(...)`, `entity.get(CombatStateComponent).takeDamage(p.damage)`, `kinematics.applyForce(knockback)`
9. If killed: `world.destroyEntity(entity)`, `bus.emit('entity:destroyed', { entity, isBoss })`
