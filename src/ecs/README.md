# `src/ecs/` — Entity-Component-System Architecture

NovaPulse uses a bitmask ECS to organize simulation objects. Each "thing" in the world is an **Entity** — a lightweight id + bitmask. **Components** are pure data bags attached to entities. **Systems** process every frame and operate on all entities that have the right component combination.

---

## Files

### `entity.js` — Entity Class & Component Registry

#### Component Registration

When any component class is first used with `entity.add(component)`, the class is registered via `registerComponentType(cls)`. This assigns it a unique power-of-two bit:

```
bit 0  (0b00000001) → TransformComponent
bit 1  (0b00000010) → KinematicsComponent
bit 2  (0b00000100) → RenderComponent
bit 3  (0b00001000) → AgentStateComponent
... and so on for all 11 component classes
```

Registration is global (module-level `Map`) — every entity sharing a class name gets the same bit. Up to 31 unique component classes are supported in a 32-bit integer mask.

#### Entity API

```js
const entity = new Entity(id);

// Add component (sets bit, stores instance)
entity.add(new TransformComponent(x, y));
entity.add(new KinematicsComponent({ maxSpeed: 160 }));

// Remove component (clears bit, deletes storage)
entity.remove(TransformComponent);

// Get component (O(1) Map lookup)
const tf = entity.get(TransformComponent);  // → instance or undefined

// Check presence (bitmask AND)
entity.has(TransformComponent);             // → true/false

// Filter by mask (used internally by World.query)
entity.matchesMask(queryMask);              // → (entity.mask & queryMask) === queryMask

// Destruction flag (set by World.destroyEntity; removed in next flush())
entity.destroyed;
```

---

### `world.js` — ECS World Orchestrator

The `World` manages all entity creation, destruction, system registration, and update orchestration.

#### Entity Lifecycle

```js
const world = new World();

// Create entity (optional builder callback runs immediately)
const entity = world.createEntity((e) => {
  e.add(new TransformComponent(400, 300));
  e.add(new KinematicsComponent({ maxSpeed: 160 }));
  e.add(new RenderComponent({ shape: 'arrowhead', color: '#4af', size: 8 }));
  e.add(new BoidComponent({ flockType: 'blue' }));
});

// Deferred removal (safe to call during fixedUpdate iteration)
world.destroyEntity(entity);    // or world.destroyEntity(entity.id)

// Flush removes all destroyed entities from the Map at the start of each tick
world.flush();

world.entityCount;  // → current live entity count
```

#### Query API

`world.query()` is the system's primary access method. It returns all live, non-destroyed entities matching a component requirement.

**By numeric bitmask** (preferred in production systems):
```js
const moveMask = maskFor([TransformComponent, KinematicsComponent]);
const moving = world.query(moveMask);  // → Entity[]
```

**By component class array** (convenience — used in test suites):
```js
const moving = world.query([TransformComponent, KinematicsComponent]);  // → Entity[]
```

When an array is passed, `query()` automatically resolves each class to its bitmask bit via `registerComponentType` and builds the combined mask internally.

#### System Registration & Orchestration

```js
world.addSystem(new MovementSystem(viewport));
world.addSystem(new BoidSystem(grid, viewport));
world.addSystem(new CollisionSystem(grid, bus));
world.addSystem(new CombatSystem(projectilePool, particlePool, soundSynth, bus));
world.addSystem(new PlayerInputSystem(viewport, bus));
world.addSystem(new RenderSystem(viewport));

// Called by GameLoop each physics step
world.fixedUpdate(dt);    // calls system.fixedUpdate(dt, world) in order

// Called each render frame
world.render(ctx, alpha); // calls system.render(ctx, world, alpha) in order
```

Systems must implement at least one of:
- `fixedUpdate(dt, world)` — physics/logic tick
- `render(ctx, world, alpha)` — draw step

---

### `components.js` — All Component Schemas

#### `TransformComponent(x=0, y=0, rotation=0, scale=1)`

| Property | Type | Description |
|---|---|---|
| `position` | `Vec2` | Current world-space position |
| `prevPosition` | `Vec2` | Position snapshot from previous tick (for alpha interpolation in render) |
| `rotation` | `number` | Angle in radians |
| `scale` | `number` | Uniform scale factor |

`prevPosition` is copied from `position` at the start of each `fixedUpdate` tick, enabling render interpolation: `renderPos = lerp(prevPosition, position, alpha)`.

#### `KinematicsComponent({ maxSpeed, maxForce, drag })`

| Property | Type | Description |
|---|---|---|
| `velocity` | `Vec2` | Current velocity (px/s) |
| `acceleration` | `Vec2` | Accumulated force this tick (reset each step) |
| `maxSpeed` | `number` | Velocity magnitude clamp |
| `maxForce` | `number` | Acceleration magnitude clamp |
| `drag` | `number` | Per-frame velocity multiplier (0–1, 1 = no drag) |
| `applyForce(v)` | method | Adds to acceleration (in-place, no allocation) |
| `integrate(dt)` | method | `velocity += accel × dt`, `velocity *= drag`, clamp `maxSpeed`, reset accel |

#### `RenderComponent({ shape, size, color, glow, opacity })`

| Property | Type | Values |
|---|---|---|
| `shape` | `string` | `'circle'`, `'arrowhead'`, `'spiked_diamond'`, `'flagship'`, `'dreadnought'` |
| `size` | `number` | Base draw size in pixels |
| `color` | `string` | CSS color string |
| `glow` | `number` | `ctx.shadowBlur` radius (0 = no glow) |
| `glowColor` | `string` | Shadow color |
| `opacity` | `number` | `ctx.globalAlpha` (0–1) |

#### `AgentStateComponent({ team, state })`

| Property | Values | Description |
|---|---|---|
| `team` | `'blue'`, `'crimson'`, `'player'`, `'hazard'` | Combat allegiance |
| `state` | `'idle'`, `'flocking'`, `'chasing'`, `'fleeing'`, `'dead'` | Behavioral state flag |

#### `BoidComponent({ flockType, perceptionRadius, separationRadius, maxForce, maxSpeed })`

| Property | Default | Description |
|---|---|---|
| `flockType` | `'blue'` | `'blue'` (flocker) or `'crimson'` (hunter) |
| `perceptionRadius` | 85 | Neighbor detection radius (px) |
| `separationRadius` | 28 | Minimum separation distance (px) |
| `maxForce` | 0.28 | Maximum per-frame steering force |
| `maxSpeed` | 160 | Velocity magnitude clamp |

#### `PlayerControllerComponent({ thrustForce, turnRate, damping, isManualControlled })`

| Property | Type | Description |
|---|---|---|
| `thrustForce` | `number` | Force magnitude for WASD thrusters |
| `turnRate` | `number` | Rotation interpolation speed toward cursor (rad/s) |
| `damping` | `number` | Additional drag in manual mode |
| `isManualControlled` | `bool` | True when `[M]` mode is active |
| `cursor` | `Vec2` | Mouse position in world space (updated by PlayerInputSystem) |
| `thrusting` | `{ up, down, left, right }` | Active thruster state from keyboard |
| `isFiring` | `bool` | True while `Space` or `LClick` held |

#### `CombatStateComponent({ health, maxHealth, energy, maxEnergy })`

| Property | Type | Description |
|---|---|---|
| `health` | `number` | Current HP |
| `maxHealth` | `number` | Maximum HP |
| `energy` | `number` | Energy reserve (for shields/specials) |
| `takeDamage(dmg)` | method | `health -= dmg`, returns `true` if killed (`health <= 0`) |
| `heal(amt)` | method | `health = min(health + amt, maxHealth)` |
| `isAlive` | getter | `health > 0` |

#### `WeaponComponent({ fireRate, projectileSpeed, damage, spread, heatPerShot, maxHeat, coolingRate, color })`

| Property | Type | Description |
|---|---|---|
| `fireRate` | `number` | Shots per second |
| `cooldown` | `number` | Seconds until next shot is allowed |
| `heat` | `number` | Current heat (0–maxHeat) |
| `isOverheated` | `bool` | True when heat ≥ maxHeat; clears when heat ≤ maxHeat × 0.25 |
| `update(dt)` | method | Decrements cooldown, applies cooling: `heat -= coolingRate × dt` |
| `canFire()` | method | Returns `!isOverheated && cooldown <= 0` |
| `onFire()` | method | Resets cooldown, adds heatPerShot |

#### `ColliderComponent({ shape, layer, mask, isTrigger })`

| Property | Type | Description |
|---|---|---|
| `shape` | `CircleCollider \| AABBCollider` | Geometry primitive |
| `layer` | `number` | Collision layer bitmask |
| `mask` | `number` | Layers this collider interacts with |
| `isTrigger` | `bool` | No impulse if true (overlap events only) |
| `flashTimer` | `number` | Visual hit-flash countdown (set to 0.15 on collision) |

#### `RigidBodyComponent({ mass, restitution, friction, isStatic })`

| Property | Type | Description |
|---|---|---|
| `mass` | `number` | Kg — used in impulse calculation |
| `invMass` | `number` | Precomputed `1/mass` (0 for static bodies) |
| `restitution` | `number` | Bounciness (0 = plastic, 1 = elastic) |
| `friction` | `number` | Tangential friction coefficient |
| `isStatic` | `bool` | If true, invMass = 0, never moves |

#### `AudioSourceComponent`

Sound request queue. Each frame, `PlayerInputSystem` or `CombatSystem` calls `enqueue(name, params)`. The audio system reads and clears it at end of tick.

```js
audioSrc.enqueue('laser', { freq: 820, duration: 0.08 });
audioSrc.enqueue('explosion', { volume: 0.9 });
const queue = audioSrc.flush(); // → [{name, params}] + clears
```

---

### `systems.js` — System Implementations

#### `MovementSystem`
Runs on entities with `[TransformComponent, KinematicsComponent]`.
- Copies `position → prevPosition`
- Calls `kinematics.integrate(dt)`: applies force → velocity, applies drag, clamps `maxSpeed`, resets force
- Updates `transform.position` by `velocity × dt`

#### `BoundarySystem`
Runs on entities with `[TransformComponent]`.
- Default mode: **wrap** — teleports entity from one edge to the opposite (torus topology)
- Player mode: **clamp** — clamps flagship within viewport with elastic bounce

#### `CollisionSystem`
- Rebuilds `SpatialHashGrid` from current entity AABBs
- Generates candidate pairs via `grid.getCandidatePairs()`
- Narrowphase per pair
- Impulse resolution via `CollisionResolver` for non-trigger pairs
- `collision:enter` event emission for all hits

#### `BoidSystem`
- Queries boids via Spatial Hash `queryRadius(perception)` for neighbors
- Blue boids: cohesion + alignment + separation + flee (if crimson in panic range)
- Crimson hunters: seek nearest blue/player + separation + alignment + wander
- Steering forces applied via `kinematics.applyForce(force)`

#### `PlayerInputSystem`
- Keyboard state tracking (`keydown` / `keyup`) for WASD + special keys
- Mouse/pointer tracking (world-space cursor position)
- In Manual mode: compute thrust direction, apply `thrustForce` impulse, rotate toward cursor at `turnRate`
- Cannon firing: check `weapon.canFire()`, call `firePlayerCannon()`, enqueue audio, emit particles
- Mode toggle `[M]`, Mute toggle `[X]`, Pause `[P]`

#### `CombatSystem`
- Updates all `WeaponComponent` cooldowns and heat
- Updates `ProjectilePool` (moves projectiles, recycles expired)
- Updates `ParticlePool` (decays particles)
- Enemy weapon firing (crimson probabilistic, boss turret salvo)
- Projectile vs. agent hit detection using spatial hash query
- On hit: apply damage (`takeDamage`), impact sparks, knockback impulse, `entity:destroyed` on kill

#### `RenderSystem`
- Sets `enableGlow` flag to gate `ctx.shadowBlur` globally
- Per entity: reads `TransformComponent` (interpolated position) and `RenderComponent`
- Dispatches to shape renderer:
  - `'circle'` — simple `ctx.arc`
  - `'arrowhead'` — 3-point triangle oriented by `rotation`
  - `'spiked_diamond'` — 6-point polygonal boid shape
  - `'flagship'` — multi-path fighter silhouette
  - `'dreadnought'` — boss warship with fins, command core, thruster vents
- Renders active projectiles (colored glow trails)
- Delegates particle rendering to `ParticlePool.render(ctx)` with `globalCompositeOperation = 'lighter'`
