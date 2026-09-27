# NovaPulse — Hardware Benchmark & Profiler Guide

> **Profiler Version**: 5.0 · Phase 5 Telemetry Suite  
> **Tracked by**: [SPD Analysis Engine](https://github.com/spdwivedi/spd_analysis_engine)

---

## Overview

NovaPulse ships a built-in, real-time **Hardware Telemetry Profiler** visible in the HUD. This guide explains how to use NovaPulse as a rigorous PC hardware benchmark covering:

- **CPU** — Physics simulation throughput and Spatial Hash Grid efficiency
- **GPU** — Canvas 2D raster compositing and `ctx.shadowBlur` overhead
- **Memory** — Object pool GC stability under extreme entity density
- **Frame Timing** — End-to-end frame budget analysis at configurable loads

All metrics are measured using the native browser **Performance API** (`performance.now()`) with sub-millisecond precision. No external profiling tool is required.

---

## Table of Contents

1. [HUD Telemetry Panels](#1-hud-telemetry-panels)
2. [CPU Benchmark — Spatial Hash Stress Test](#2-cpu-benchmark--spatial-hash-stress-test)
3. [GPU Benchmark — Canvas 2D Glow Compositing](#3-gpu-benchmark--canvas-2d-glow-compositing)
4. [Memory Stability — Object Pool GC Proof](#4-memory-stability--object-pool-gc-proof)
5. [Frame Budget Analysis](#5-frame-budget-analysis)
6. [Reference Scores & Baseline Hardware](#6-reference-scores--baseline-hardware)
7. [Advanced Debug Console API](#7-advanced-debug-console-api)

---

## 1. HUD Telemetry Panels

The live profiler HUD (top-left, **⬡ Hardware Telemetry Profiler** panel) displays six real-time metrics updated every 2 frames (~33ms):

| HUD Label | Source Property | Units | Description |
|---|---|---|---|
| **FPS** | `loop.fps` | frames/sec | Rolling 60-sample average frame rate |
| **CPU PHYSICS TICK** | `loop.physicsTimeMs` | ms | Time spent in ECS `fixedUpdate` (spatial hash, collision, combat, AI) |
| **GPU RASTER TIME** | `loop.renderTimeMs` | ms | Time spent in Canvas 2D render (`world.render`, particle/projectile draw) |
| **FRAME DELTA** | `loop.frameTimeMs` | ms | Wall-clock time between two `requestAnimationFrame` callbacks |
| **ENTITIES / POOL** | `world.entityCount` | count | Live entity count + `[active projectiles : active particles]` |
| **CANVAS GLOW [G]** | `renderSystem.enableGlow` | mode | GPU glow benchmark status |

### Interpretation Notes

- **CPU PHYSICS TICK** is measured with `t0 = performance.now()` immediately before and after `_world.fixedUpdate()`. It includes Spatial Hash rebuild, narrowphase collision, impulse resolution, and boid AI steering computation.
- **GPU RASTER TIME** is measured around `_world.render()` — all `ctx.beginPath`, `ctx.arc`, `ctx.fill`, `ctx.stroke`, and `ctx.shadowBlur` draw calls.
- At 60 FPS, the total frame budget is **16.67 ms**. If `CPU + GPU > 16.67 ms`, the simulation will drop below 60 FPS.
- The `frameTimeMs` measurement captures the **actual** inter-frame interval, including any browser throttling, OS scheduling jitter, or GPU pipeline stalls.

---

## 2. CPU Benchmark — Spatial Hash Stress Test

### Theory

NovaPulse uses a 2D Spatial Hash Grid to prune collision detection from $O(N^2)$ to approximately $O(N \cdot k)$, where $k$ is the average number of entities per spatial cell. The cell size is fixed at **56 px** (configurable at construction time).

For a uniform distribution of $N$ entities in a world of width $W$ and height $H$:

$$k \approx N \cdot \frac{(2 \cdot \text{cellSize})^2}{W \cdot H}$$

At 1,000 entities in a 1920×1080 world with 56 px cells:

$$k \approx 1000 \cdot \frac{12544}{2{,}073{,}600} \approx 6 \; \text{candidates per entity}$$

This yields ~6,000 narrowphase checks instead of 499,500 — a **99.4% reduction**.

### Running the CPU Stress Test

1. Launch NovaPulse at `http://localhost:3000`
2. Note the baseline **CPU PHYSICS TICK** at the initial ~200–500 entity count
3. Press `[+]` repeatedly to add 100 entities per press
4. Record **CPU PHYSICS TICK** at each density milestone:

| Entity Count | Expected CPU Tick (modern mid-range) |
|---|---|
| 200 | < 1.0 ms |
| 500 | < 2.0 ms |
| 1,000 | < 3.5 ms |
| 1,500 | < 5.5 ms |
| 2,000 | < 8.0 ms |
| 2,500 | < 12.0 ms |

5. If CPU TICK exceeds **13+ ms** at 2,500 entities, the system's single-core JavaScript throughput is the bottleneck.

### What to Look For

- **Sub-linear scaling** from 200 → 2,500 entities confirms the Spatial Hash is working efficiently. You should **not** see quadratic growth.
- A sudden jump at a specific count (e.g., 1,500 → 1,600 entities) can indicate spatial cell congestion — too many entities in one area overwhelm local buckets. This is an emergent property of non-uniform distribution (tight flocking clusters).
- The `occupiedBuckets` count is exposed via the debug API: `__NOVAPULSE__.arenaManager` or by reading `_collisionSystem.grid.occupiedBuckets.length`.

### Debug Console Commands

```js
// Read current spatial hash state from the browser console
const g = __NOVAPULSE__.stats();
console.log('Entities:', g.entities, '| Physics ms:', g.physicsMs.toFixed(3));

// Spawn entities in bulk for stepped load testing
for (let i = 0; i < 10; i++) __NOVAPULSE__.spawnBlue(100);
```

---

## 3. GPU Benchmark — Canvas 2D Glow Compositing

### Theory

`ctx.shadowBlur` is the single most GPU-intensive Canvas 2D operation. It triggers a software or hardware blur pass over every draw call where `shadowBlur > 0`. The cost is proportional to:

1. The **number of draw calls** with nonzero shadowBlur
2. The **shadowBlur radius** value
3. The **screen area** of blurred primitives

In NovaPulse, every entity, projectile, and particle sets `shadowBlur` individually — meaning the GPU must blur each circle, polygon, and particle separately rather than doing a single-pass post-process. This is an **intentional benchmark design** — it models the worst-case Canvas 2D compositing overhead.

### Running the GPU Benchmark

**Glow ON (default):** All entities render with full `ctx.shadowBlur` — boid glow (10–15 px), flagship glow (22 px), particles (additive compositing `'lighter'`), projectiles (8 px glow), boss glow (28 px).

**Glow OFF `[G]`:** `_renderSystem.enableGlow = false` gates all `ctx.shadowBlur` assignments to `0`. All shapes render as flat-colored geometry. Additive compositing for particles is also disabled.

#### Benchmark Protocol

1. Set entity count to a fixed level (e.g., 1,000 with `[+]`).
2. Record **GPU RASTER TIME** and **FPS** with `[GLOW: HIGH]`.
3. Press `[G]` to disable glow. Record **GPU RASTER TIME** and **FPS** with `[GLOW: OFF]`.
4. The delta between the two readings is the **pure `ctx.shadowBlur` compositor cost**.

#### Expected Results (1,000 entities)

| Mode | GPU Raster Time | FPS |
|---|---|---|
| Glow ON | 6–14 ms | 60 FPS (budget: 16.67 ms) |
| Glow OFF | 1–3 ms | 60 FPS (headroom increases) |
| **Glow overhead** | **5–11 ms** | — |

#### What the Numbers Mean

- **< 8 ms GPU ON**: GPU has dedicated hardware acceleration for Canvas 2D compositing (typical of NVIDIA/AMD discrete GPUs).
- **8–14 ms GPU ON**: Canvas 2D is software-composited via CPU (typical of integrated Intel/AMD iGPUs).
- **> 14 ms GPU ON**: The `shadowBlur` pass is the frame budget bottleneck. At 2,000 entities with glow, the simulation will drop below 60 FPS.

#### Nova Bomb GPU Spike Test

Press `[K]` to detonate a **Nova Bomb** — an instant burst of 400+ additive particles with high glow radii. Watch the **GPU RASTER TIME** spike for 1–3 frames, then return to baseline as particles decay. The magnitude and duration of this spike characterizes the GPU's burst compositing throughput.

---

## 4. Memory Stability — Object Pool GC Proof

### Design Philosophy

In a naïve JavaScript simulation, spawning projectiles and particles via `new Particle()` / `new Projectile()` would generate thousands of objects per second, pressuring the V8 garbage collector. GC pauses manifest as frame-time spikes (`frameTimeMs` suddenly jumping 5–50 ms).

NovaPulse eliminates this with pre-allocated object pools:

| Pool | Capacity | Slot Size |
|---|---|---|
| `ProjectilePool` | 450 slots | Fixed `Projectile` object |
| `ParticlePool` | 900 slots | Fixed `Particle` object |

**Write-once allocation**: All 450/900 objects are created at startup. `spawn()` activates an existing slot; `recycle()` deactivates it. No `new` keyword is called during the simulation hot path.

### Verifying Zero GC Spikes

#### Method 1: Chrome DevTools Performance Tab

1. Open `http://localhost:3000`, let the simulation run for 30 seconds
2. Open Chrome DevTools → **Performance** tab → **Record**
3. Press `[K]` repeatedly (Nova Bomb) to saturate the particle pool
4. Stop recording
5. In the flame chart, look for **Major GC** or **Minor GC** markers in the timeline
6. **Expected result**: Zero major GC events during projectile/particle activity. The frame times should remain flat even during Nova Bomb detonations.

#### Method 2: HUD Active Count Monitoring

Watch the `ENTITIES / POOL` HUD row:
- `[P: X]` — active projectiles (max 450)
- `[FX: Y]` — active particles (max 900)

Fire continuously while watching these numbers. They should cycle between 0 and their caps without ever exceeding the cap. When the pool is exhausted, the **oldest slot** is recycled (ring-buffer overwrite) — no allocation occurs.

#### Method 3: Console Heap Measurement

```js
// Take baseline heap snapshot
const before = performance.memory?.usedJSHeapSize;

// Detonate 10 Nova Bombs rapidly
for (let i = 0; i < 10; i++) __NOVAPULSE__.triggerNovaBomb();

// Wait one animation frame
requestAnimationFrame(() => {
  const after = performance.memory?.usedJSHeapSize;
  console.log('Heap delta (bytes):', after - before);
  // Expected: < 100,000 bytes (< 100 KB) — pool reuse
});
```

**Expected heap delta**: Less than 100 KB across 10 Nova Bombs (4,000 particle activations). A non-pooled system would allocate ~1.2 MB+ for the same operation.

---

## 5. Frame Budget Analysis

### The 16.67 ms Frame Budget

At a 60 FPS target, the browser must complete all work per frame within:

$$\text{budget} = \frac{1000 \text{ ms}}{60} = 16.\overline{6} \text{ ms/frame}$$

This budget is split between:

| Component | Typical Cost (1,000 entities, Glow ON) |
|---|---|
| CPU Physics (ECS fixedUpdate) | 2–5 ms |
| GPU Raster (Canvas render) | 5–10 ms |
| Browser overhead (input, layout, compositing) | 1–2 ms |
| **Total** | **8–17 ms** |

### Fixed-Step vs. Variable Render

NovaPulse uses a **fixed-step physics loop at 60 Hz** decoupled from the render loop. The `GameLoop` runs:

```
requestAnimationFrame(timestamp) {
  const dt = (timestamp - lastTime) / 1000;  // variable render dt
  // Accumulate into fixed physics steps
  while (accumulator >= FIXED_DT) {
    fixedUpdate(1/60);
    accumulator -= FIXED_DT;
  }
  const alpha = accumulator / FIXED_DT;  // interpolation factor
  render(alpha);
}
```

This means **physics always runs at exactly 60 Hz** regardless of render rate. If a frame takes 20 ms (50 FPS render), physics still ticks once at 16.67 ms and the remaining 3.33 ms accumulates into the next tick — ensuring simulation accuracy is not degraded by GPU-side slowdowns.

### Detecting Bottlenecks

| Symptom | Root Cause | Fix |
|---|---|---|
| High CPU Tick, low GPU Raster | AI/physics overloaded | Reduce entity count with `[-]` |
| High GPU Raster, low CPU Tick | Canvas compositing overloaded | Press `[G]` to disable glow |
| Both high, frame drops | Total budget exceeded | Use wireframe `[B]` mode for CPU-only profiling |
| Occasional spikes in frameMs | GC pause or browser interrupt | Run for longer; single spikes are OS/browser, not engine |

---

## 6. Reference Scores & Baseline Hardware

### Sustained 60 FPS Entity Capacity (approximate)

| Hardware Class | Glow ON | Glow OFF |
|---|---|---|
| High-end gaming desktop (RTX 4070+ / Ryzen 9) | 2,500+ entities | 2,500+ entities |
| Mid-range gaming laptop (RTX 3060 / i7-12th Gen) | 1,500 entities | 2,500+ entities |
| Integrated GPU laptop (Intel Iris Xe / Ryzen 680M) | 600–800 entities | 1,500–2,000 entities |
| Budget / older hardware | 300–500 entities | 800–1,200 entities |
| Mobile (Android Chrome, iOS Safari) | 200–400 entities | 400–800 entities |

### Benchmark Score Calculation

Use this formula to compute a **NovaPulse Score** for hardware comparison:

```
Score = maxEntities_60fps_glowON × 10 + maxEntities_60fps_glowOFF × 5
```

**Example (mid-range laptop):**
```
Score = 1500 × 10 + 2500 × 5 = 15,000 + 12,500 = 27,500 NP-points
```

---

## 7. Advanced Debug Console API

Open the browser console (`F12`) to access `window.__NOVAPULSE__`:

```js
// Full system stats snapshot
__NOVAPULSE__.stats();
// → { fps, physicsMs, renderMs, frameMs, wave, score,
//     entities, projectiles, particles, destroyed, isMuted, glow, isManual }

// Stress test: add entities in bulk
__NOVAPULSE__.spawnBlue(500);     // Spawn 500 blue boids instantly
__NOVAPULSE__.spawnCrimson(10);   // Spawn 10 crimson hunters

// Remove entities
__NOVAPULSE__.despawnSwarm(200);  // Remove up to 200 blue boids

// GPU toggle
__NOVAPULSE__.toggleGlow();       // Returns new glow state (true/false)

// Nova Bomb detonation
__NOVAPULSE__.triggerNovaBomb();

// Pause and measure
__NOVAPULSE__.togglePause();
// ... wait for GC, then unpause and measure frame times
__NOVAPULSE__.togglePause();

// Direct loop profiling access
const loop = __NOVAPULSE__.loop;
console.log('Physics:', loop.physicsTimeMs.toFixed(3), 'ms');
console.log('Render:', loop.renderTimeMs.toFixed(3), 'ms');
console.log('Frame delta:', loop.frameTimeMs.toFixed(3), 'ms');
console.log('FPS:', loop.fps.toFixed(1));

// Wave director state
const wd = __NOVAPULSE__.waveDirector;
console.log('Wave:', wd.waveNumber, 'State:', wd.state);
console.log('Score:', wd.survivalScore, 'Peak entities:', wd.peakSwarmCount);

// Arena hazard state
const arena = __NOVAPULSE__.arenaManager;
console.log('Laser gates:', arena.laserGates.length);
console.log('Black hole:', arena.blackHole ? 'active' : 'inactive');
console.log('Mines:', arena.mines.filter(m => m.active).length, 'active');
```

### Automated Benchmark Script

Paste this into the console to run an automated stepped load test:

```js
(async function benchmarkSweep() {
  const results = [];
  const steps = [100, 200, 500, 1000, 1500, 2000, 2500];
  
  for (const target of steps) {
    // Clear and respawn to target count
    __NOVAPULSE__.despawnSwarm(2500);
    await new Promise(r => setTimeout(r, 500));
    __NOVAPULSE__.spawnBlue(target);
    
    // Wait for frame times to stabilize
    await new Promise(r => setTimeout(r, 2000));
    
    const loop = __NOVAPULSE__.loop;
    results.push({
      entities: target,
      fps: loop.fps.toFixed(1),
      physicsMs: loop.physicsTimeMs.toFixed(2),
      renderMs: loop.renderTimeMs.toFixed(2),
      frameMs: loop.frameTimeMs.toFixed(2),
    });
    console.log(`N=${target}: FPS=${loop.fps.toFixed(1)}, CPU=${loop.physicsTimeMs.toFixed(2)}ms, GPU=${loop.renderTimeMs.toFixed(2)}ms`);
  }
  
  console.table(results);
  console.log('Benchmark complete.');
})();
```
