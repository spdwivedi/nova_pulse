# `src/environment/` — Dynamic Arena Hazards & Environmental Physics

The `environment` module implements NovaPulse's procedural environmental hazards — rotating laser fences, a gravitational singularity, proximity mines — and the `ArenaManager` that coordinates them into each wave's physical environment. All hazard physics are computed analytically on the CPU, integrated into the ECS `fixedUpdate` pipeline.

---

## Files

### `arena.js`

Contains four classes: `PulsingLaserGate`, `QuantumBlackHole`, `KineticMine`, and `ArenaManager`.

---

## `PulsingLaserGate`

A rotating dual-arm laser fence defined by a center point and an angular velocity. Each arm extends outward from the center at `halfLength` px. The fence sweeps the arena floor as a rigid rotating line segment.

### Construction

```js
new PulsingLaserGate({
  centerX: 640,
  centerY: 360,
  length: 260,          // total fence length (arm A + arm B)
  angularSpeed: 0.75,   // radians/second (positive = counter-clockwise)
  damage: 130,          // HP/second on contact (scaled by dt × 4 in update)
  color: '#f00'
})
```

### Geometry

```
Endpoint A = (cx + cos(angle) × halfLen,  cy + sin(angle) × halfLen)
Endpoint B = (cx - cos(angle) × halfLen,  cy - sin(angle) × halfLen)
```

`getEndpoints()` returns `[{x, y}, {x, y}]` for the current `_angle` state.

### Hit Detection — `checkIntersection(px, py, entityRadius)`

Tests whether an entity at `(px, py)` with radius `entityRadius` overlaps the laser beam segment (half-segment between the two endpoints):

```
1. Compute segment direction: d = B - A
2. Project entity onto segment: t = dot(P - A, d) / dot(d, d)
3. Clamp projection: t = clamp(t, 0, 1)
4. Nearest point: N = A + t × d
5. Distance: dist = |P - N|
6. Hit if: dist < (entityRadius + laserThickness)
   where laserThickness = 3.5 px
```

The $t \in [0, 1]$ clamp correctly handles entities beyond the endpoints of the fence arm — they are not hit unless within `entityRadius + 3.5` of the arm's tip.

### `update(dt)`

```js
this._angle += this.angularSpeed * dt;
this._angle = wrapAngle(this._angle);  // keeps in [-π, +π]
```

### `render(ctx)`

```
1. Outer glow beam: wide stroke, color with low alpha
2. Inner bright core: narrow stroke, high alpha
3. Two pylon nodes at endpoints: small circles with glow
```

---

## `QuantumBlackHole`

A central gravitational singularity that exerts inverse-square attraction on all entities within its `gravityRadius`. Entities entering the `eventHorizon` take continuous crushing damage.

### Construction

```js
new QuantumBlackHole({
  centerX: 960,
  centerY: 540,
  mass: 195000,         // G × M product (gravitational strength constant)
  eventHorizon: 34,     // damage zone radius (px)
  gravityRadius: 420    // outer influence radius (px)
})
```

### Gravitational Force — `getGravitationalForce(entityPos, entityMass, outVec)`

Writes the gravitational force vector directly into `outVec` (in-place, no allocation):

```
r_vec = center - entityPos      (vector from entity toward singularity)
dist = max(|r_vec|, eventHorizon × 0.7)   (clamp — prevents infinite force at singularity)

F_magnitude = (G×M × entityMass) / dist²
F_direction = normalize(r_vec)
outVec = F_direction × F_magnitude
```

The distance clamp `max(dist, eventHorizon × 0.7)` prevents the gravitational force from exceeding a safe maximum at very close range, which would cause numerical instability in the velocity integrator.

For entities at `dist = eventHorizon × 0.7 = 23.8 px`:
$$F_{max} = \frac{195000 \times 1.0}{23.8^2} \approx 344 \text{ px/s}^2$$

This exceeds the flagship's thruster force (360 px/s² at center, scaled), making escape from the inner zone genuinely difficult.

### `update(dt, entities, particlePool, soundSynth)`

For each live entity:
1. If `dist < gravityRadius`: call `getGravitationalForce(pos, mass, scratch)`, apply via `kinematics.applyForce(scratch)`
2. If `dist < eventHorizon`: apply `80 × dt` crushing damage via `combat.takeDamage()`
3. If killed in event horizon: emit small explosion

### `render(ctx)`

Multi-layer visual rendering:
1. **Outer gravitational distortion ripples**: Concentric circles at `gravityRadius × 0.3`, `0.5`, `0.7` — faint dashed stroke lines that pulse via `Date.now() / 800`
2. **Accretion disk**: 4 arcs rotating at different speeds, violet-to-magenta gradient
3. **Intermediate aura**: Dense violet circle at `eventHorizon × 2.5` with high glow
4. **Event horizon core**: Solid black circle at `eventHorizon` radius — a true light-capturing void

---

## `KineticMine`

A floating explosive proximity mine that drifts slowly and detonates on approach.

### Construction

```js
new KineticMine({
  x: 500,
  y: 300,
  triggerRadius: 50,    // arming proximity (px)
  blastRadius: 95,      // damage zone at detonation (px)
  damage: 85            // HP at blast center
})
```

Initial drift velocity: `vx = (Math.random() - 0.5) × 8`, `vy = (Math.random() - 0.5) × 8` (±4 px/s).

### States

```
idle → armed → detonated
```

- **idle**: No entity within `triggerRadius`. Mine drifts with initial velocity.
- **armed**: Entity entered `triggerRadius`. Fuse timer starts: `_fuseTimer = 0.45s`.
- **detonated**: `_fuseTimer` expired. Blast executes, mine is removed.

### `checkTrigger(px, py)` → `boolean`

```js
return Math.hypot(px - this.x, py - this.y) < this.triggerRadius;
```

Returns `true` if the entity is within trigger range. `ArenaManager.update()` calls this for all live entities each tick.

### `detonate(particlePool, soundSynth, entities)`

Executes the blast:

```
1. For each entity within blastRadius:
     dist = |entity.pos - mine.pos|
     falloff = max(0.2, 1 - dist / blastRadius)
     combat.takeDamage(damage × falloff)
     knockbackImpulse = 120 × falloff  (radial outward)
     kinematics.applyForce(direction × knockbackImpulse)

2. particlePool.emitExplosion(this.x, this.y, 80, '#ff8800')
3. soundSynth.playExplosion(0.85)
4. this.active = false
```

The `falloff = max(0.2, 1 - dist/blastRadius)` formula ensures:
- At blast center (dist = 0): `falloff = 1.0` → full 85 HP
- At blast edge (dist = blastRadius): `falloff = 0.2` → 17 HP minimum
- Outside blast radius: not hit

### `update(dt)`

```js
if (this._armed) {
  this._fuseTimer -= dt;
  if (this._fuseTimer <= 0) return 'detonate';
} else {
  this.x += this.vx * dt;
  this.y += this.vy * dt;
  // slow friction drag
  this.vx *= 0.998;
  this.vy *= 0.998;
}
```

Returns `'detonate'` signal to `ArenaManager` when fuse expires.

### `render(ctx)`

```
1. Spiky hex body: 6 outer spike tips + 6 inner body points (star polygon)
2. Color: dim grey when idle (#888), bright orange (#f84) when armed
3. Glow: 0 when idle, 20 px orange glow pulse when armed
4. Blinking LED beacon: small circle that oscillates alpha at 8 Hz when armed
```

---

## `ArenaManager`

Coordinates all hazard instances for the current wave. The ArenaManager receives the full entity list each `fixedUpdate` tick and dispatches to each hazard's physics/trigger logic.

### Construction

```js
const arena = new ArenaManager({ width: 1920, height: 1080 });
```

### Hazard Lifecycle

```js
arena.clearHazards();                // remove all hazards (between waves)
arena.addLaserGate(gate);            // register a PulsingLaserGate instance
arena.setBlackHole(blackHole);       // replace/clear the QuantumBlackHole
arena.addMine(mine);                 // register a KineticMine instance
arena.setDimensions(width, height);  // called on viewport:resize
```

### `update(dt, entities, particlePool, soundSynth, world)`

Called each `fixedUpdate` tick from `main.js` after `world.fixedUpdate`:

```
1. Arena boundary check: for each entity beyond boundary radius → apply pushback force
2. Black hole update: getGravitationalForce for all entities in range, apply damage
3. Laser gate updates: rotate each gate, check intersection with all entities
4. Mine updates:
     a. Each mine.update(dt)
     b. If any entity within mine.triggerRadius → mine.arm()
     c. If mine returns 'detonate' → mine.detonate(particlePool, soundSynth, entities)
                                   → arena.mines.splice (remove detonated mines)
```

### `render(ctx)`

```
1. Arena boundary perimeter ring: pulsing white circle at max radius, with warning glow
2. Black hole render (if set)
3. All laser gates render
4. All active mines render
```

---

## Wave Hazard Configuration

Hazards are configured in `main.js` within `handleSpawnWave(config)`:

```js
function handleSpawnWave(config) {
  _arenaManager.clearHazards();

  if (config.hazards.blackHole) {
    _arenaManager.setBlackHole(new QuantumBlackHole({
      centerX: W/2, centerY: H/2,
      mass: 195000, eventHorizon: 34, gravityRadius: Math.min(W, H) * 0.46
    }));
  }

  for (let i = 0; i < config.hazards.gates; i++) {
    _arenaManager.addLaserGate(new PulsingLaserGate({
      centerX: W/4 + (i % 2) * W/2,
      centerY: H/2 + (i % 2 === 0 ? -80 : 80),
      length: 260,
      angularSpeed: i % 2 === 0 ? 0.75 : -0.75,   // counter-rotate
      damage: 130
    }));
  }

  for (let i = 0; i < config.hazards.mines; i++) {
    const angle = (TAU / config.hazards.mines) * i;
    const r = Math.min(W, H) * 0.28;
    _arenaManager.addMine(new KineticMine({
      x: W/2 + cos(angle) * r,
      y: H/2 + sin(angle) * r,
      triggerRadius: 50, blastRadius: 95, damage: 85
    }));
  }
}
```

**Wave 3** (Gravity Storm): 6 mines arranged in a hexagonal ring around the central black hole — navigation requires weaving between mine trigger zones while resisting gravitational pull.

**Wave 4** (Dreadnought Incursion): 8 mines + 2 counter-rotating laser gates + black hole + Crimson Dreadnought boss simultaneously active, creating the maximum environmental hazard density.
