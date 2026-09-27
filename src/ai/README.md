# `src/ai/` — Autonomous Agent Intelligence

The `ai` module implements Craig Reynolds' steering behaviors, composite boid behavior trees, and the procedural wave survival director. All vector math uses `Vec2` in-place operations to stay allocation-free in the hot path.

---

## Files

### `steering.js` — Craig Reynolds Autonomous Steering Behaviors

Each behavior takes agent state as input and returns a **steering force vector** to be composited with other behaviors. All computations reuse pre-allocated scratch `Vec2` objects — no `new Vec2()` calls during simulation.

---

#### `seek(agentPos, targetPos, maxSpeed)` → `Vec2`

Steers the agent toward a target position at `maxSpeed`:

$$\vec{F}_{seek} = \text{normalize}(\vec{target} - \vec{pos}) \times v_{max} - \vec{vel}$$

In practice, the velocity subtraction happens at the behavior composition level. The raw seek output is: `normalize(target - pos) × maxSpeed`.

```js
seek(agentPos, targetPos, maxSpeed)
// → Vec2 pointing from agentPos toward targetPos, magnitude = maxSpeed
```

---

#### `flee(agentPos, threatPos, maxSpeed, panicDistance)` → `Vec2`

Exact opposite of seek — steers the agent **away** from the threat. Returns zero vector if the threat is beyond `panicDistance`:

$$\vec{F}_{flee} = \begin{cases} -\text{seek}(\vec{pos}, \vec{threat}, v_{max}) & \text{if } d < \text{panicDist} \\ \vec{0} & \text{otherwise} \end{cases}$$

```js
flee(agentPos, threatPos, maxSpeed, panicDistance)
// → Vec2 away from threatPos (zero if beyond panicDistance)
```

**Used by**: Blue boids when a Crimson hunter enters `perceptionRadius`.

---

#### `wander(velocity, wanderRadius, wanderDistance, wanderAngle)` → `[Vec2, newAngle]`

Simulates organic, non-linear movement by projecting a virtual "wander circle" ahead of the agent and randomly displacing a point on its perimeter:

1. Project `wanderDistance` px ahead of velocity direction
2. Offset a random point on circle of radius `wanderRadius` at that projection
3. Seek that point

The `wanderAngle` is incrementally displaced by ±`jitter` each call and must be stored by the caller for continuity across frames.

```js
const [force, newAngle] = wander(velocity, 25, 80, boidWanderAngle);
boidWanderAngle = newAngle; // persist for next frame
```

---

#### `separation(agent, neighbors, desiredDist)` → `Vec2`

Pushes the agent away from every neighbor closer than `desiredDist`. Force magnitude scales inversely with distance — neighbors infinitely close produce maximum repulsion:

$$\vec{F}_{sep} = \sum_{i}^{|d_i| < \text{desiredDist}} \frac{\vec{pos} - \vec{pos}_i}{d_i^2 + \epsilon}$$

The $d^2$ denominator means close neighbors push exponentially harder than distant ones.

**Neighbor lookup**: Uses `grid.queryRadius(agentPos, separationRadius)` — O(k) candidates from the spatial hash, not O(N) full entity scan.

---

#### `alignment(agent, neighbors)` → `Vec2`

Steers toward the average velocity direction of all perceived neighbors:

$$\vec{F}_{align} = \text{normalize}\!\left(\frac{1}{|N|}\sum_{i} \vec{vel}_i\right) \times v_{max}$$

Returns zero vector if there are no neighbors.

---

#### `cohesion(agent, neighbors)` → `Vec2`

Seeks the centroid of perceived neighbors:

$$\vec{center} = \frac{1}{|N|}\sum_i \vec{pos}_i$$
$$\vec{F}_{coh} = \text{seek}(\vec{pos},\, \vec{center},\, v_{max})$$

Returns zero vector if there are no neighbors.

---

### `behaviors.js` — Composite Behavior Trees

Combines primitive steering forces into behavior profiles for each agent faction.

#### Blue Flocker Behavior (`applyBlueBoidBehavior(entity, world, grid, dt)`)

```
force = cohesion    × 0.8
      + alignment   × 1.0
      + separation  × 1.4    (highest weight — prevents crowding)
      + flee        × 2.8    (dominates if predator is near)
      + wander      × 0.3

force.clampMag(maxForce)
kinematics.applyForce(force)
```

Blue boids are fundamentally **social** — their strongest non-panic drive is separation (avoiding crowding) balanced against cohesion (staying together). Flee completely overrides flocking when a Crimson hunter enters panic range (100 px).

#### Crimson Hunter Behavior (`applyCrimsonHunterBehavior(entity, world, grid, dt)`)

```
prey = nearest blue boid OR flagship within perceptionRadius

if prey found:
  force = seek(prey)    × 1.6   (primary drive)
        + alignment     × 0.6   (pack coherence)
        + separation    × 1.2   (don't cluster)
        + wander        × 0.1   (minimal noise)
else:
  force = wander × 1.0          (patrol behavior)

force.clampMag(maxForce)
kinematics.applyForce(force)
```

Crimson hunters have **higher maxSpeed (195 px/s)** than blue boids (160 px/s). This means a lone blue boid fleeing a single hunter will be caught within 3–5 seconds of sustained pursuit. The pack separation ensures hunters spread out to cut off escape vectors.

---

### `wave_director.js` — Procedural Wave Survival Coordinator

The `WaveDirector` is the top-level game state machine. It coordinates wave timing, spawning signals, scoring, and terminal conditions (victory / game over).

#### Wave Configuration (`WAVE_CONFIGS`)

```js
export const WAVE_CONFIGS = [
  {
    wave: 1, title: 'The Gathering', duration: 35,
    blueCount: 150, crimsonCount: 10,
    hazards: { gates: 0, blackHole: false, mines: 0 },
    threatMultiplier: 1.0
  },
  {
    wave: 2, title: 'Predator Surge', duration: 45,
    blueCount: 250, crimsonCount: 25,
    hazards: { gates: 2, blackHole: false, mines: 0 },
    threatMultiplier: 1.5
  },
  {
    wave: 3, title: 'Gravity Storm', duration: 55,
    blueCount: 350, crimsonCount: 35,
    hazards: { gates: 0, blackHole: true, mines: 6 },
    threatMultiplier: 2.0
  },
  {
    wave: 4, title: 'Dreadnought Incursion', duration: 90,
    blueCount: 500, crimsonCount: 45,
    hazards: { gates: 2, blackHole: true, mines: 8, boss: true },
    threatMultiplier: 3.0
  }
];
```

#### State Machine

```
                 ┌─────────────────────────────┐
                 │         intermission         │
                 │  (4.0s countdown, then call  │
                 │   onSpawnWave(nextConfig))   │
                 └──────────────┬──────────────┘
                                │ timer expires
                 ┌──────────────▼──────────────┐
                 │           active             │
                 │  (wave timer counting down,  │
                 │   passive score accruing)    │
                 └──────────────┬──────────────┘
         ┌────────────────────┬─┴─────────────────────────┐
         │  wave timer done   │  boss killed (wave 4)     │  flagship HP=0
   ┌─────▼──────┐      ┌──────▼──────┐             ┌──────▼──────┐
   │intermission│      │   victory   │             │  game_over  │
   │(next wave) │      │  (terminal) │             │  (terminal) │
   └────────────┘      └─────────────┘             └─────────────┘
```

#### API

```js
const wd = new WaveDirector({
  bus,
  onSpawnWave: (config) => handleSpawnWave(config)
});

wd.update(dt);               // call each fixedUpdate tick
wd.onEnemyKilled(isBoss);    // call when CombatSystem emits 'entity:destroyed'
wd.triggerVictory();         // call from main.js on boss death
wd.triggerGameOver();        // call from main.js on flagship destruction

wd.waveNumber;               // current wave (1-indexed)
wd.state;                    // 'intermission' | 'active' | 'victory' | 'game_over'
wd.survivalScore;            // accumulated score
wd.peakSwarmCount;           // highest entity count reached
wd.timeAlive;                // total seconds elapsed since wave 1 started
wd.enemiesDestroyed;         // kill counter
wd.threatMultiplier;         // current wave's threat multiplier (scoring scale)
```

#### Score Accrual

**Passive score** (while wave is `active`):
```
score += round(dt × 20 × threatMultiplier)
```

**Enemy kill score**:
```
score += round(150 × threatMultiplier)   // standard enemy
score += 5000                             // boss Dreadnought
```

#### Events Emitted

| Event | When | Payload |
|---|---|---|
| `wave:started` | On `active` state entry | `{ wave, config }` |
| `wave:intermission` | On intermission entry | `{ nextWave, config }` |
| `wave:victory` | On victory | `{ score, timeAlive, destroyed }` |
| `wave:gameOver` | On game over | `{ score, timeAlive, destroyed }` |

---

## Performance Notes

All neighbor lookups in `steering.js` and `behaviors.js` go through `SpatialHashGrid.queryRadius()` — never a brute-force full-entity-list scan. At 500 boids with a perception radius of 85 px in a 1920×1080 world:

$$\text{avg candidates} \approx 500 \times \frac{\pi \times 85^2}{1920 \times 1080} \approx 5.5 \text{ boids}$$

Each boid therefore runs steering computation against ~5–6 neighbors rather than 499. This keeps the full BoidSystem `fixedUpdate` at under **2.0 ms** for 500 agents.
