# `src/core/` — Engine Core Subsystems

The `core` module provides the fundamental building blocks that all other engine subsystems depend on: the main loop, canvas viewport management, vector mathematics, and the event bus. Everything in `core` is environment-agnostic — it runs identically in both browser and Node.js.

---

## Files

### `loop.js` — Fixed-Step GameLoop with Profiling Telemetry

The `GameLoop` class implements a **semi-fixed-step** update scheme:

```
requestAnimationFrame → accumulate delta → tick physics at 1/60s fixed steps → render
```

**Why fixed-step?** Physics simulation (collision, velocity integration) produces different results at different time steps due to floating-point accumulation and integration instability. Fixing the physics timestep at `1/60s` guarantees deterministic simulation regardless of render frame rate.

**Why semi-fixed?** The render frame is called once per animation frame at the actual system framerate. A `alpha` interpolation factor (sub-frame offset / FIXED_DT) is passed to `render(alpha)` so entities can interpolate between their previous and current physics position for smooth rendering even at framerates exceeding 60 Hz.

#### Fixed-Step Loop Algorithm

```js
const FIXED_DT = 1 / 60;
let accumulator = 0;
let lastTime = 0;

function tick(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000, 0.1); // cap at 100ms
  lastTime = timestamp;
  accumulator += dt;

  // Fixed physics steps
  while (accumulator >= FIXED_DT) {
    const t0 = performance.now();
    fixedUpdate(FIXED_DT);
    physicsTimeMs = rollingAvg(performance.now() - t0);
    accumulator -= FIXED_DT;
  }

  // Variable render step
  const alpha = accumulator / FIXED_DT;
  const r0 = performance.now();
  render(alpha);
  renderTimeMs = rollingAvg(performance.now() - r0);
  frameTimeMs = rollingAvg(dt * 1000);
}
```

#### Phase 5 Profiling Metrics

Added in Phase 5 — all use 60-frame rolling circular buffer averages:

| Property | Type | Description |
|---|---|---|
| `loop.fps` | `number` | Rolling 60-frame average frames per second |
| `loop.tickMs` | `number` | Last raw physics tick duration (ms) |
| `loop.physicsTimeMs` | `number` | Rolling 60-frame average physics tick (ms) |
| `loop.renderTimeMs` | `number` | Rolling 60-frame average render call (ms) |
| `loop.frameTimeMs` | `number` | Rolling 60-frame average inter-frame interval (ms) |

#### Lifecycle API

```js
const loop = new GameLoop({ fixedUpdate, update, render });
loop.start();    // begins requestAnimationFrame loop
loop.pause();    // stops accumulating, freezes simulation
loop.resume();   // restarts from current state
loop.stop();     // terminates loop (cleanup before re-init)
```

---

### `viewport.js` — High-DPI Canvas Scaler

Manages the `<canvas>` element's physical vs. logical resolution and handles responsive resizing.

#### High-DPI Scaling

Modern displays have a `devicePixelRatio` greater than 1 (2× on Retina, 3× on mobile). Without compensation, Canvas renders at 1× and is upscaled blurry.

```js
canvas.width  = logicalWidth  * devicePixelRatio;
canvas.height = logicalHeight * devicePixelRatio;
canvas.style.width  = logicalWidth  + 'px';
canvas.style.height = logicalHeight + 'px';
ctx.scale(devicePixelRatio, devicePixelRatio);
```

This keeps all draw coordinates in logical pixel space (matching CSS), while the underlying pixel buffer is at native resolution.

#### Viewport API

| Property / Method | Description |
|---|---|
| `viewport.width` | Logical canvas width in CSS pixels |
| `viewport.height` | Logical canvas height in CSS pixels |
| `viewport.ctx` | `CanvasRenderingContext2D` |
| `viewport.trail(alpha)` | Fills canvas with semi-transparent black (`rgba(0,0,0,alpha)`) — creates motion trail |

`trail(alpha)` is called at the start of every render frame. The semi-transparent fill darkens the previous frame without erasing it, producing the neon motion blur trail effect.

#### Resize Handling

A `ResizeObserver` watches the canvas element. When the container size changes, the canvas dimensions are updated and `viewport:resize` is emitted on the `EventBus`. Systems (BoundarySystem, RenderSystem, ArenaManager) listen for this event to update their cached viewport dimensions.

---

### `math.js` — In-Place Vector Mathematics

The `Vec2` class is the cornerstone of all physics and AI calculations. Every method that could produce a new vector instead **mutates the instance** and returns `this` for chaining. This eliminates garbage collection pressure in the hot path.

#### In-Place Operations (return `this`)

```js
v.add(other)          // v += other
v.sub(other)          // v -= other
v.multScalar(s)       // v *= s
v.div(s)              // v /= s (no-op if s === 0)
v.normalize()         // v /= |v| (no-op if |v| === 0)
v.clampMag(max)       // if |v| > max, v = v / |v| * max
v.rotate(theta)       // rotate by angle theta in-place
v.set(x, y)           // assign both components
v.copyFrom(other)     // copy from another Vec2
v.reset()             // v = (0, 0)
v.lerp(other, t)      // v = lerp(v, other, t) in-place
```

#### Measurement Operations (return number/scalar)

```js
v.mag()               // Euclidean length √(x²+y²)
v.magSq()             // x²+y² (avoids sqrt — use for comparisons)
v.dist(other)         // distance to other Vec2
v.distSq(other)       // squared distance (faster for threshold checks)
v.heading()           // Math.atan2(y, x) — angle in radians
v.dot(other)          // scalar dot product
```

#### Construction Utilities

```js
new Vec2()            // (0, 0)
new Vec2(x, y)        // explicit components
v.clone()             // returns a new independent Vec2 copy
Vec2.fromAngle(theta) // returns new Vec2(cos(θ), sin(θ))
```

#### Scalar Helpers

```js
lerp(a, b, t)         // linear interpolation: a + (b - a) * t
clamp(v, lo, hi)      // clamp v into [lo, hi]
mapRange(v, in_lo, in_hi, out_lo, out_hi)  // linear remap
wrapAngle(theta)      // wrap angle into [-π, +π]
```

#### GC-Conscious Usage Pattern

The canonical pattern for steering computations (used throughout `ai/steering.js`):

```js
// Pre-allocated scratch vectors — created once, reused every frame
const _steer = new Vec2();
const _diff  = new Vec2();

function seek(agentPos, targetPos, maxSpeed) {
  _diff.copyFrom(targetPos).sub(agentPos).normalize().multScalar(maxSpeed);
  return _diff; // caller must NOT store this reference long-term
}
```

---

### `events.js` — Typed Pub/Sub EventBus

Provides loosely-coupled, synchronous event dispatch between engine subsystems. Systems never hold direct references to each other — they communicate exclusively via events.

#### API

```js
const bus = new EventBus();

// Persistent subscription
const handler = (data) => console.log(data);
bus.on('entity:destroyed', handler);

// One-shot subscription (auto-removed after first fire)
bus.once('wave:victory', () => showModal());

// Remove specific handler
bus.off('entity:destroyed', handler);

// Emit event to all listeners
bus.emit('collision:enter', { entityA, entityB });

// Remove all listeners for one event
bus.clear('entity:destroyed');

// Remove all listeners for all events
bus.clear();

// Introspection
bus.listenerCount('entity:destroyed');  // → number
bus.eventNames();                       // → string[]
```

#### Events Used in NovaPulse

| Event | Emitter | Payload | Subscribers |
|---|---|---|---|
| `collision:enter` | CollisionSystem | `{ entityA, entityB }` | main.js (scatter handling) |
| `entity:destroyed` | CombatSystem | `{ entity, killerTeam, isBoss }` | main.js (count update, waveDirector) |
| `player:modeToggle` | PlayerInputSystem | — | main.js (mode switch) |
| `sound:muteToggle` | PlayerInputSystem | `isMuted` | main.js (HUD update) |
| `wave:started` | WaveDirector | `{ wave, config }` | (debug logging) |
| `wave:intermission` | WaveDirector | `{ nextWave, config }` | (debug logging) |
| `wave:victory` | WaveDirector | `{ score, timeAlive }` | main.js (show modal) |
| `wave:gameOver` | WaveDirector | `{ score, timeAlive }` | main.js (show modal) |
| `viewport:resize` | Viewport | — | BoundarySystem, RenderSystem, ArenaManager |
