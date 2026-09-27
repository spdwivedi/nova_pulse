# NovaPulse — Controls & Flight Dynamics Manual

> **Manual Version**: 5.0 · Phase 5 Final  
> **Engine**: NovaPulse v5.0 · Canvas 2D · Pure ES6

---

## Table of Contents

1. [The Two Flight Modes](#1-the-two-flight-modes)
2. [Manual Pilot — Inertial Flight System](#2-manual-pilot--inertial-flight-system)
3. [Weapon Systems — Plasma Cannons & Heat Management](#3-weapon-systems--plasma-cannons--heat-management)
4. [Autonomous Swarm Mode — Craig Reynolds Flocking](#4-autonomous-swarm-mode--craig-reynolds-flocking)
5. [Enemy Intelligence — Crimson Hunter Behavior Tree](#5-enemy-intelligence--crimson-hunter-behavior-tree)
6. [Arena Hazards — Survival Navigation Guide](#6-arena-hazards--survival-navigation-guide)
7. [Mission Scoring & Wave Progression](#7-mission-scoring--wave-progression)
8. [Full Controls Reference](#8-full-controls-reference)

---

## 1. The Two Flight Modes

The Flagship can operate in two distinct modes, toggled with `[M]`:

### AUTO SWARM SIMULATION `[default]`
The flagship behaves as the swarm leader. Its motion is governed by the Craig Reynolds flocking algorithm — it moves with the blue swarm, maintaining cohesion, alignment with neighboring boids, and separation to avoid crowding. In this mode, the flagship does **not** fire weapons automatically. This mode is ideal for observing swarm dynamics, configuring hazard behavior, and running stress benchmarks.

### MANUAL PILOT ACTIVE `[M to toggle]`
You take direct inertial control of the flagship. The HUD badge turns **amber** and pulses. A crosshair cursor follows your mouse — the flagship's nose rotates toward it at a configurable turn rate. WASD thrusters apply directional impulse forces. Motion preserves momentum with drag-based deceleration.

In Manual mode, **left click** or **Space** fires the dual plasma cannons.

---

## 2. Manual Pilot — Inertial Flight System

### Thruster Physics

The flagship uses an **inertial flight model** — applying a thruster simply adds a force vector to the current velocity; it does not instantly set the velocity. This simulates realistic space-flight momentum.

| Thruster | Force Multiplier | Effect |
|---|---|---|
| `W` / `↑` (Forward) | 1.0× `thrustForce` | Accelerates in heading direction |
| `S` / `↓` (Reverse) | 0.55× `thrustForce` | Decelerate / reverse thrust |
| `A` / `←` (Strafe Left) | 0.7× `thrustForce` | Lateral translation left |
| `D` / `→` (Strafe Right) | 0.7× `thrustForce` | Lateral translation right |

**Flagship thruster stats (Phase 5 baseline):**
- `thrustForce`: 360 px/s²
- `maxSpeed`: 260 px/s
- `drag`: 0.975 (per-frame velocity multiplier — slight drag, retains 97.5% velocity/frame)
- `turnRate`: 9.5 rad/s (rotation interpolation rate toward cursor)

### Heading System

The flagship's rotation continuously interpolates toward the mouse cursor using:
```
angleDiff = wrapAngle(targetAngle - currentAngle)
rotation += angleDiff × min(1, turnRate × dt)
```

This produces smooth angular tracking that never snaps or overshoots. At high turn rates (`9.5 rad/s`) the flagship faces the cursor almost instantly; at low speeds it gracefully sweeps around.

### Drag & Velocity Decay

When no thruster is active, drag applies multiplicatively each frame:
```
velocity *= drag   (= 0.975 per frame at 60 Hz)
```
At 60 FPS, this yields a half-life of approximately **1.1 seconds** — meaning from max speed (260 px/s), you'll coast to 130 px/s in about a second of unpowered flight.

---

## 3. Weapon Systems — Plasma Cannons & Heat Management

### Dual Plasma Cannons

The flagship fires **two simultaneous plasma bolts** per trigger pull — one from each wingtip at a ±2.5° toe-out spread. Bolts travel at **520 px/s** and expire after 1.5 seconds (780 px effective range).

- **Fire Rate**: 7.5 shots/second (0.133s cooldown per salvo)
- **Damage per bolt**: 28 HP
- **Heat per salvo**: 7.5 units (scale: 0–100)
- **Cooling rate**: 38 units/second (passive, always cooling when not firing)

### Heat Management & Overheat Lock

The cannon system tracks cumulative heat. Continuous fire at 7.5 Hz builds heat faster than cooling dissipates it:

```
Net heat rate = (7.5 × 7.5) - 38 = 18.25 units/second of sustained fire
Time to overheat = 100 / 18.25 ≈ 5.5 seconds of continuous fire
```

When heat reaches **100**, the `OVERHEATED!` state triggers:
- The heat bar turns crimson.
- Firing is **locked out** until heat drops below **25** (25% threshold).
- At 38 units/second cooling, recovery from full overheat takes **≈ 1.97 seconds**.

**Tactical tip**: Fire in burst patterns of 2–3 seconds, then let cooling run for 0.5s to sustain indefinite output without overheat lockout.

### Crimson Hunter Spore Emitters

Crimson hunters fire radial spore projectiles:
- **Fire rate**: 0.9 Hz (probabilistic 1.5% chance per frame to attempt)
- **Speed**: 260 px/s
- **Damage**: 15 HP per spore
- **TTL**: 2.0 seconds (520 px effective range)

### Crimson Dreadnought Boss Turrets (Wave 4)

The boss fires **5-way spread turret salvos** from multiple hardpoints simultaneously:
- **Fire rate**: 0.8 Hz
- **Projectile speed**: 290 px/s
- **Damage per bolt**: 25 HP
- **TTL**: 3.2 seconds (928 px range)
- Salvos are aimed toward the player's last known position.

---

## 4. Autonomous Swarm Mode — Craig Reynolds Flocking

When not piloting manually, blue boids execute the full Craig Reynolds flocking model:

### Separation
Each boid applies a repulsion force away from every neighbor within `separationRadius` (28 px). Magnitude scales inversely with distance — closer neighbors push harder:

$$\vec{F}_{sep} = \sum_i \frac{\vec{pos} - \vec{pos}_i}{|\vec{pos} - \vec{pos}_i|}$$

### Alignment
Boids steer toward the **average velocity direction** of neighbors within `perceptionRadius` (75–95 px), encouraging coordinated group direction:

$$\vec{F}_{align} = \text{normalize}\!\left(\sum_i \vec{vel}_i\right) \times \text{maxSpeed} - \vec{vel}$$

### Cohesion
Boids seek the **centroid** of their local flock — the center of mass of nearby neighbors:

$$\vec{F}_{coh} = \text{seek}\!\left(\frac{1}{N}\sum_i \vec{pos}_i\right)$$

### Predator Panic (Flee Behavior)
When a Crimson hunter enters a blue boid's `panicDistance` (100 px), the boid's flee response overrides normal flocking. The flee vector points directly away from the nearest threat at full `maxSpeed`:

$$\vec{F}_{flee} = \text{normalize}(\vec{pos} - \vec{threat}) \times \text{maxSpeed} - \vec{vel}$$

### Wander Noise
A small angular displacement applied to a virtual "wander circle" gives boids organic, non-linear cruising behavior between stimulus events.

### Performance: Spatial Hash Neighbor Queries
All neighbor lookups for the flocking algorithm use the Spatial Hash Grid — entities in the same cell are the only candidates. This reduces per-boid neighbor checks from $O(N)$ to near $O(k)$ where $k$ is the local density, enabling **500+ boids at 60 FPS** on mid-range hardware.

---

## 5. Enemy Intelligence — Crimson Hunter Behavior Tree

Crimson hunters execute a layered behavior tree each tick:

```
Priority Order:
  1. Flee if being shot at (combat state: low HP < 15%)
  2. Seek nearest blue boid or flagship in perception range (160px)
  3. Pack cohesion / alignment with other Crimson hunters
  4. Wander if no prey detected
```

Crimson hunters have a higher `maxSpeed` (195 px/s) than blue boids (160 px/s), meaning they can always catch a lone boid. Their `separationRadius` is wider (42 px vs 28 px) — they space out to avoid clustering while encircling prey.

**Pack pursuit**: When multiple hunters detect the same target, their alignment behavior synchronizes pursuit direction — creating pincer patterns that cut off retreat angles.

**Collision scatter**: On contact with a blue boid, hunters apply an impulse in the direction of impact, scattering prey into additional threats.

---

## 6. Arena Hazards — Survival Navigation Guide

### Quantum Black Hole (Wave 3 & 4)

The central singularity exerts inverse-square gravitational attraction on all entities within its `gravityRadius` (≈ 46% of arena short-axis):

$$\vec{F}_{grav} = \frac{G \cdot M \cdot m}{r^2} \cdot \hat{r}$$

Where $G \cdot M = 195{,}000$ and $m = 1.0$ for all entities. Distance is clamped to $\max(r, \text{eventHorizon} \times 0.7)$ to prevent infinite force spikes at the singularity.

**Event horizon**: Entities within 34 px of center take **80 HP/second** of continuous crushing damage.

**Survival strategy**:
- In Manual mode, apply rearward thrust to counteract pull. At 100+ px distance, thruster force (360 px/s²) exceeds gravitational acceleration.
- In Auto mode, blue boids are swept into the well gradually — they begin orbiting and spiraling inward over 20–40 seconds without counter-thrust.
- The black hole does **not** affect projectiles differently from boids — plasma bolts also arc toward the singularity.

### Pulsing Laser Gates (Wave 2, 3, & 4)

Rotating dual-arm laser fences sweep the arena floor. Each gate is a line segment of length 200–320 px rotating about a fixed center point.

**Rotation speeds**:
- Wave 2 gates: ±0.75 rad/s (about 43°/s)
- Wave 3 gate: 0.65 rad/s
- Wave 4 gates: ±0.75 rad/s (counter-rotating pair)

**Hit detection**: Uses perpendicular point-to-segment distance with projection clamped to $[0, 1]$. Any entity within `entityRadius + 3.5 px` (laser beam thickness) of the nearest segment point is hit.

**Damage**: `130 HP × dt × 4` per frame of contact — roughly **520 HP/second** of contact damage. This one-shots most boids within a single frame.

**Survival strategy**:
- In Manual mode, watch the rotation direction and time your crossing during the gap between sweeps.
- Blue boids do not have laser-awareness — the Boid system does not factor environmental obstacles. They will fly directly into rotating gates. This is expected — the hazard exists to thin the swarm.
- The counter-rotating pair in Wave 4 creates overlapping kill zones with a very narrow safe corridor near the screen corners.

### Kinetic Mines (Wave 3 & 4)

Mines float slowly with random initial drift velocity (±4 px/s). They **arm** when any entity enters their `triggerRadius` (50 px), then detonate after a 0.45-second fuse delay.

**Blast profile**:
- `blastRadius`: 95 px
- `damage`: 85 HP at center, scaling by `max(0.2, 1 - dist/blastRadius)` — 17 HP minimum at perimeter
- Radial knockback impulse: `120 × falloff` px/s

**Survival strategy**:
- The fuse delay (0.45s) gives a narrow window to exit blast radius before detonation.
- Mines drift slowly — track their movement and maintain a 100 px clearance buffer.
- In Wave 4 with 8 mines, the safe corridors between blast zones become narrow. Prioritize mine awareness over combat targeting when near multiple mines.
- Plasma bolts do **not** trigger mines (no collision layer overlap). Only living entities arm mines.

---

## 7. Mission Scoring & Wave Progression

### Score Calculation

**Passive score** (accrues while wave is active):
```
score += round(dt × 20 × threatMultiplier)
```
At Wave 4 (threat 3.0×): **60 points/second** passively.

**Kill score**:
- Standard enemy kill: `round(150 × threatMultiplier)`
  - Wave 1: 150 pts | Wave 2: 225 pts | Wave 3: 300 pts | Wave 4: 450 pts
- Boss Dreadnought kill: **5,000 pts** flat

### Wave Transitions

| State | Condition | Duration |
|---|---|---|
| `intermission` | Wave just ended or game started | 4.0 seconds |
| `active` | Wave in progress | Per-wave (35 / 45 / 55 / 90 s) |
| `victory` | Wave 4 boss defeated OR all waves cleared | Terminal |
| `game_over` | Flagship HP ≤ 0 | Terminal |

Wave 4 is **time-unlimited** in the sense that the timer alone does not end it — you must defeat the Crimson Dreadnought to achieve victory. If the timer expires without a boss kill, the wave continues until the boss is destroyed.

### Mission End Modal

On victory or defeat, a full-screen modal displays:
- Final survival score
- Total enemies destroyed
- Peak swarm unit count
- Average FPS
- Total time alive (MM:SS)

Press `[Enter]` or click **REDEPLOY MISSION** to instantly reset and restart.

---

## 8. Full Controls Reference

| Key / Input | Mode | Action |
|---|---|---|
| `W` / `↑` | Manual | Forward thruster (100% force) |
| `S` / `↓` | Manual | Reverse thruster (55% force) |
| `A` / `←` | Manual | Strafe left (70% force) |
| `D` / `→` | Manual | Strafe right (70% force) |
| `Mouse` | Manual | Aim heading — flagship rotates toward cursor |
| `Left Click` | Manual | Fire dual plasma cannons |
| `Space` | Manual | Fire dual plasma cannons (alternative) |
| `M` | Both | Toggle Manual Pilot ↔ Auto Swarm |
| `X` | Both | Toggle WebAudio sound effects (mute) |
| `G` | Both | Toggle GPU Canvas Glow (`ctx.shadowBlur` benchmark) |
| `+` / `=` | Both | Spawn +100 blue swarm units |
| `-` / `_` | Both | Despawn −100 blue swarm units |
| `K` | Both | Detonate Nova Bomb (400-particle shockwave) |
| `B` | Both | Toggle wireframe debug view |
| `P` | Both | Pause / Resume simulation |
| `R` | Both | Hard reset simulation |
| `Enter` | Game Over/Victory | Redeploy mission (restart) |
