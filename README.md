# ⚡ NovaPulse

### High-Performance 2D Autonomous Swarm & Combat Simulation Engine

![Zero Runtime Dependencies](https://img.shields.io/badge/dependencies-zero-brightgreen?style=flat-square)
![Native ES6 Modules](https://img.shields.io/badge/modules-native%20ES6-blue?style=flat-square)
![Unit Tests](https://img.shields.io/badge/tests-160%2F160%20passing-success?style=flat-square)
![60 FPS Canvas](https://img.shields.io/badge/canvas-60%20FPS%20hardware%20accelerated-cyan?style=flat-square)
![SPD Analysis Engine](https://img.shields.io/badge/monitored%20by-SPD%20Analysis%20Engine-purple?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-orange?style=flat-square)

---

## Overview

**NovaPulse** is a high-density autonomous swarm simulator and real-time combat flight engine built entirely from scratch — no libraries, no frameworks, no dependencies. Engineered in pure **ES6 modules** and the **Canvas 2D API**, it pushes hardware to its limits with thousands of simultaneously active agents, a physics-accurate collision system, procedural weapon synthesis, and a GPU-benchmarking particle engine.

The project was conceived as both a showcase of classical computer science algorithms (flocking, spatial hashing, ECS architectures) and a practical hardware stress-test tool. NovaPulse renders at a consistent **60 FPS** target on modern hardware even at 1,500+ agents, thanks to zero-allocation vector math, Spatial Hash Grid $O(N)$ broadphase, and object-pool-backed projectile and particle systems.

> **Development Verification — SPD Analysis Engine**
>
> NovaPulse was engineered, monitored, and micro-versioned across all five development phases using the **[SPD Analysis Engine](https://github.com/spdwivedi/spd_analysis_engine)** — a live telemetry and code-change analysis platform. Every algorithmic decision, performance regression, and system integration milestone was tracked and verified in real time by the SPD Analysis Engine, which provided cross-phase behavioral consistency checks, commit-level diffs, and profiling correlation reports.

---

## Core Architecture Highlights

### 🔷 Spatial Hash Grid — $O(N)$ Broadphase Collision Pruning

Rather than the naïve $O(N^2)$ pairwise agent check, NovaPulse partitions world-space into a fixed-size grid of hash buckets:

$$\text{hash}(c_x, c_y) = \bigl((c_x \times 73856093) \oplus (c_y \times 19349663)\bigr) \;\&\; \text{mask}$$

Each frame, every entity's AABB is inserted into all overlapping cells. Collision queries retrieve only entities sharing cells, reducing average checks by **97%+** at 1,000+ entities. The grid is allocation-conscious — bucket Sets are cleared in-place each frame using a dirty-index tracker.

### 🔷 Bitmask ECS — Cache-Friendly Entity Queries

Every component class is assigned a unique power-of-two bitmask bit at registration time. Entities are filtered via bitwise AND on integer masks — no string lookups, no dynamic property scanning:

```js
// Query only entities with Transform + Combat components
const targets = world.query([TransformComponent, CombatStateComponent]);
```

System `fixedUpdate` receives exactly the entities it declared interest in — zero wasted iteration.

### 🔷 In-Place Vector Math — Zero GC Pressure

All `Vec2` operations mutate in place. No intermediate objects are created during physics ticks:

```js
vel.add(force).clampMag(maxSpeed);      // No heap allocation
steer.sub(vel).clampMag(maxForce);      // Chain in-place
```

The GC never runs during the hot path. Frame consistency is guaranteed even at extreme entity counts.

### 🔷 Dual-Mode Control System

- **Autonomous Mode**: Craig Reynolds flocking algorithm — separation, alignment, cohesion with predator flee response and Crimson hunter pursuit AI.
- **Manual Pilot Mode `[M]`**: Inertial thrust flight with mouse-cursor heading, WASD directional thrusters, drag-damped momentum, and plasma cannon trigger.

### 🔷 Procedural WebAudio Synthesizer

Sound effects are generated entirely in-browser using oscillators, envelope shapers, and bandpass noise. No audio files are loaded. The synthesizer auto-unlocks on first user gesture and degrades silently in headless environments.

### 🔷 Additive GPU Particle Bloom Engine

The particle system uses `ctx.globalCompositeOperation = 'lighter'` (additive blending) on every particle, producing physically-correct light accumulation that simulates neon bloom without any post-processing shader or WebGL. Up to **900 simultaneous particles** are pooled and reused without garbage collection.

---

## Project Structure

```
nova_pulse/
├── index.html                   # Dark retro-cyber HUD interface
├── server.js                    # Zero-dependency native Node HTTP server
├── package.json                 # type: "module", start/test scripts
├── README.md                    # This file
│
├── src/
│   ├── main.js                  # Bootstrap entrypoint, game loop wiring
│   ├── core/
│   │   ├── loop.js              # Fixed-step 60 Hz GameLoop + profiling metrics
│   │   ├── viewport.js          # High-DPI canvas scaler + resize handler
│   │   ├── math.js              # Vec2 in-place math, scalar helpers
│   │   └── events.js            # Typed pub/sub EventBus
│   ├── physics/
│   │   ├── spatial_hash.js      # 2D Spatial Hash Grid broadphase
│   │   ├── narrowphase.js       # SAT circle & AABB collision detection
│   │   ├── resolver.js          # Impulse-momentum collision response
│   │   └── colliders.js         # CircleCollider & AABBCollider primitives
│   ├── ecs/
│   │   ├── entity.js            # Entity class + bitmask component registry
│   │   ├── world.js             # ECS World orchestrator
│   │   ├── components.js        # All component schemas
│   │   └── systems.js           # Movement, Boid, Collision, Combat, Render
│   ├── ai/
│   │   ├── steering.js          # Craig Reynolds behaviors
│   │   ├── behaviors.js         # Blue flocker / Crimson hunter composites
│   │   └── wave_director.js     # Procedural 4-wave survival director
│   ├── combat/
│   │   ├── projectile_pool.js   # 450-slot zero-allocation projectile pool
│   │   └── weapons.js           # Plasma cannons, spore emitters, boss turrets
│   ├── fx/
│   │   └── particle_pool.js     # 900-slot additive particle system
│   ├── audio/
│   │   └── sound_synth.js       # Procedural WebAudio synthesizer
│   └── environment/
│       └── arena.js             # Gravity well, laser gates, kinetic mines
│
├── tests/
│   └── engine.test.js           # 160 tests across 22 suites (pure Node ESM)
│
└── notes/
    ├── 01_CONTROLS_AND_FLIGHT.md
    ├── 02_BENCHMARK_PROFILER.md
    └── 03_PHASE_ROADMAP.md
```

---

## Quickstart

### Prerequisites
- **Node.js** 18+ (for `node server.js` and `node tests/engine.test.js`)
- Any modern browser (Chrome 90+, Firefox 88+, Edge 90+, Safari 15.4+)

### Launch Simulation

```bash
# Clone or navigate to project root
cd nova_pulse

# Start the local static server (native Node, zero-install)
npm start
# → Server running at http://localhost:3000
```

**Alternative (Python fallback):**
```bash
python -m http.server 3000
# → Serving at http://localhost:3000
```

Open [http://localhost:3000](http://localhost:3000) in your browser. The simulation boots immediately with Wave 1 — The Gathering.

### Run Unit Test Suite

```bash
npm test
# → node tests/engine.test.js
# → 160 passed / 160 total
# → All tests passed! ✓
```

---

## Interactive Controls

| Key / Input | Action |
|---|---|
| `WASD` / `Arrow Keys` | Directional Thrusters — Inertial flight in Manual mode |
| `Mouse Cursor` | Aim Heading & Target Reticle |
| `Left Click` / `Space` | Fire Dual Plasma Cannons |
| `M` | Toggle Manual Pilot ↔ Autonomous Swarm |
| `+` / `=` | Spawn +100 Swarm Units (up to 2,500+) |
| `-` / `_` | Despawn −100 Swarm Units (minimum 50) |
| `G` | Benchmark GPU: Toggle Canvas Glow Blur (`ctx.shadowBlur`) |
| `K` | Detonate Nova Bomb — 400-particle radial shockwave burst |
| `B` | Toggle Spatial Grid & Collider Wireframes (debug view) |
| `X` | Toggle WebAudio Sound Effects (mute/unmute) |
| `P` | Pause / Resume Simulation |
| `R` / `Enter` | Reset Simulation / Redeploy Mission |

---

## Wave Progression

| Wave | Name | Blue Boids | Crimson Hunters | Hazards | Threat |
|---|---|---|---|---|---|
| 1 | The Gathering | 150 | 10 | — | 1.0× |
| 2 | Predator Surge | 250 | 25 | 2 Laser Gates | 1.5× |
| 3 | Gravity Storm | 350 | 35 | Black Hole + 6 Mines | 2.0× |
| 4 | Dreadnought Incursion | 500 | 45 | BH + 2 Gates + 8 Mines + **Boss** | 3.0× |

### Crimson Dreadnought
The Phase 4 boss spawns at the top of the arena with **1,500 HP** and fires 5-way radial spore cannon salvos. Defeating it triggers the victory sequence: 64-particle shockwave, +5,000 score, and the Mission Accomplished modal.

---

## HUD Reference

### Mission Wave Director Panel
- **WAVE**: Current wave number and title.
- **TIMER / TIME ALIVE**: Countdown to next wave or total survival time.
- **SURVIVAL SCORE**: Accumulates passively (+20 pts/s × threat multiplier) and on kills (+150 pts per enemy × threat multiplier, +5,000 pts for boss).

### Flagship Systems Panel
- **SHIELD / HULL**: Flagship HP as percentage. Drops to zero triggers Game Over.
- **CAPACITOR**: Energy reserve (currently display-tracked).
- **CANNON HEAT**: Weapon heat gauge. Reaches 100% → Overheat Lock until cooled below 25%.

### Hardware Telemetry Profiler Panel
- **FPS**: Instantaneous frames per second.
- **CPU PHYSICS TICK**: Time in ms spent on ECS fixedUpdate (spatial hash, collision, combat).
- **GPU RASTER TIME**: Time in ms spent on Canvas 2D rendering (draw calls, compositing).
- **FRAME DELTA**: Total wall-clock time between frames.
- **ENTITIES / POOL**: Live entity count + active projectile/particle counts.
- **CANVAS GLOW [G]**: Current GPU shadow-blur benchmark mode status.

---

## Test Suite (22 Suites, 160 Tests)

| Suite | Subject |
|---|---|
| 1 | Vec2 — Arithmetic (add, sub, scale, div) |
| 2 | Vec2 — Magnitude & Normalization |
| 3 | Vec2 — Angle & Rotation |
| 4 | Vec2 — Distance & Utilities |
| 5 | Scalar Helpers — lerp, clamp, mapRange, wrapAngle |
| 6 | EventBus — on / off / once / emit / clear |
| 7 | Entity — bitmask component attachment |
| 8 | Components — default values |
| 9 | ECS World — entity lifecycle, query, flush |
| 10 | SpatialHashGrid — insert, query, candidate pairs |
| 11 | Narrowphase — Circle vs Circle |
| 12 | Narrowphase — AABB vs AABB |
| 13 | Narrowphase — Circle vs AABB |
| 14 | CollisionResolver — impulse momentum |
| 15 | ColliderComponent & RigidBodyComponent |
| 16 | Steering Behaviors — seek, flee, wander, separation, alignment, cohesion |
| 17 | Swarm Behaviors — blue flocking & crimson hunter AI |
| 18 | ProjectilePool, ParticlePool, CombatSystem |
| 19 | Phase 4 Components & SoundSynth |
| 20 | QuantumBlackHole — inverse-square gravity & clamping |
| 21 | PulsingLaserGate — segment intersection math |
| 22 | KineticMine, ArenaManager, WaveDirector, High-Density Scaling |

---

## Development Phases

| Phase | Milestone |
|---|---|
| **Phase 1** | Project manifest, High-DPI viewport, fixed-step GameLoop, in-place Vec2 math, ECS entity/world/component foundation |
| **Phase 2** | Spatial Hash Grid broadphase, SAT narrowphase, impulse resolver, ColliderComponent, CollisionSystem |
| **Phase 3** | Craig Reynolds flocking AI (separation, alignment, cohesion, flee/seek), Crimson hunter behavior tree, PlayerInputSystem |
| **Phase 4** | Zero-allocation ProjectilePool & ParticlePool, dual plasma cannons, additive particle FX, procedural WebAudio synthesizer, native Node server |
| **Phase 5** | Dynamic Arena Hazards (QuantumBlackHole, PulsingLaserGate, KineticMine), WaveDirector, Crimson Dreadnought boss, hardware telemetry profiler, mission modal system |

All phases engineered and telemetry-verified by the **[SPD Analysis Engine](https://github.com/spdwivedi/spd_analysis_engine)**.

---

## License

MIT © NovaPulse Contributors
