# `src/fx/` — Additive Particle FX System

The `fx` module provides a high-throughput, zero-allocation particle engine that renders neon light accumulation effects using Canvas 2D's additive compositing mode. NovaPulse can sustain 900 simultaneous particles at 60 FPS due to the object pool design.

---

## Files

### `particle_pool.js` — 900-Slot Pre-Allocated Additive Particle System

#### Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     ParticlePool (cap = 900)                     │
│                                                                  │
│  _slots: [P0][P1]...[P899]    (all created at startup)          │
│  _cursor: 0                   (ring-buffer write cursor)         │
│                                                                  │
│  emitExplosion()  → calls spawn() for N particles               │
│  emitImpactSparks() → biased directional spawn                  │
│  emitThrusterSparks() → rear-cone exhaust particles             │
│  emitMuzzleFlash() → tight forward-cone burst                   │
│  update(dt)       → decay all active particles                  │
│  render(ctx)      → draw all active particles (additive blend)  │
└──────────────────────────────────────────────────────────────────┘
```

All 900 particle objects are pre-allocated. `spawn()` reactivates the next ring-buffer slot. No `new` calls occur during gameplay — zero GC pressure.

---

#### `Particle` Object Properties

| Property | Type | Description |
|---|---|---|
| `active` | `bool` | True if this slot is live |
| `x`, `y` | `number` | Current world position |
| `vx`, `vy` | `number` | Velocity (px/s) — diminishes with drag |
| `alpha` | `number` | Current opacity (0–1) |
| `decayRate` | `number` | Alpha units per second (typically 0.8–3.5) |
| `size` | `number` | Draw radius (px) |
| `sizeShrink` | `number` | Radius reduction per second |
| `color` | `string` | CSS color (static per particle) |
| `drag` | `number` | Per-frame velocity multiplier (0.92–0.98) |

---

#### `spawn(x, y, vx, vy, opts)` — Internal Pool Activation

```js
const p = this._slots[this._cursor % this._capacity];
this._cursor = (this._cursor + 1) % this._capacity;
p.active  = true;
p.x = x;  p.y = y;
p.vx = vx; p.vy = vy;
p.alpha = opts.alpha ?? 1.0;
p.decayRate = opts.decayRate ?? 1.2;
p.size = opts.size ?? 3;
p.sizeShrink = opts.sizeShrink ?? 0;
p.color = opts.color ?? '#fff';
p.drag = opts.drag ?? 0.95;
```

If the pool is full (cursor wraps), the **oldest** active particle is immediately overwritten — ring-buffer strategy prevents any blocking or allocation.

---

#### Emission Functions

##### `emitExplosion(x, y, count, color)`

Radial burst of `count` particles from a central point. Each particle gets a random angle and speed:

```js
for i in 0..count:
  angle = Math.random() × TAU
  speed = 80 + Math.random() × 200
  spawn(x, y, cos(angle) × speed, sin(angle) × speed, {
    alpha: 0.9 + Math.random() × 0.1,
    decayRate: 1.5 + Math.random() × 1.5,
    size: 2 + Math.random() × 4,
    sizeShrink: 1.5,
    color,
    drag: 0.92
  })
```

**Used for**: Enemy/boss death explosions, Nova Bomb detonation, mine blasts.

##### `emitImpactSparks(x, y, normal, count, color)`

Directional scatter biased along the collision normal. Particles have a forward hemisphere bias to simulate material splash:

```js
// baseAngle = normal direction
// jitter: ±120° random arc within forward hemisphere
for i in 0..count:
  angle = normalAngle + (Math.random() - 0.5) × (2π/3 × 2)
  speed = 60 + Math.random() × 120
  spawn(x, y, cos(angle)×speed, sin(angle)×speed, {
    alpha: 0.8,
    decayRate: 2.0 + Math.random() × 1.5,
    size: 1.5 + Math.random() × 2,
    sizeShrink: 0.8,
    color,
    drag: 0.94
  })
```

**Used for**: Projectile impacts on shields, mine proximity flash.

##### `emitThrusterSparks(x, y, rotation)`

Rear-cone thruster exhaust trail. Particles emit backward relative to heading:

```js
exhaustAngle = rotation + Math.PI  // opposite heading
for i in 0..6:
  angle = exhaustAngle + (Math.random() - 0.5) × 0.6  // ±17° cone
  speed = 50 + Math.random() × 80
  spawn(x, y, cos(angle)×speed, sin(angle)×speed, {
    alpha: 0.4 + Math.random() × 0.4,
    decayRate: 3.0 + Math.random() × 2.0,
    size: 1 + Math.random() × 2,
    sizeShrink: 1.2,
    color: Math.random() < 0.5 ? '#8cf' : '#f80',  // blue or orange flame
    drag: 0.90
  })
```

**Used for**: Flagship thruster exhaust in manual flight.

##### `emitMuzzleFlash(x, y, rotation, color)`

Tight forward-cone burst for weapon discharge:

```js
for i in 0..4:
  angle = rotation + (Math.random() - 0.5) × 0.3  // ±8.6° tight cone
  speed = 100 + Math.random() × 60
  spawn(x, y, cos(angle)×speed, sin(angle)×speed, {
    alpha: 1.0,
    decayRate: 4.0 + Math.random() × 3.0,   // very short-lived flash
    size: 1.5 + Math.random() × 1.5,
    sizeShrink: 2.5,
    color,
    drag: 0.88
  })
```

**Used for**: Player cannon muzzle, hunter spore emission.

---

#### `update(dt)` — Particle Decay

```js
update(dt) {
  for (let i = 0; i < this._capacity; i++) {
    const p = this._slots[i];
    if (!p.active) continue;
    p.x  += p.vx * dt;
    p.y  += p.vy * dt;
    p.vx *= p.drag;
    p.vy *= p.drag;
    p.alpha -= p.decayRate * dt;
    p.size  -= p.sizeShrink * dt;
    if (p.alpha <= 0 || p.size <= 0.1) p.active = false;
  }
}
```

---

#### `render(ctx)` — Additive Compositing

The critical rendering property: `ctx.globalCompositeOperation = 'lighter'` activates **additive blending** for every particle. In additive mode, overlapping particles accumulate brightness rather than alpha-blending over each other. This produces physically accurate neon light bloom without any post-processing pass or WebGL.

```js
render(ctx) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';  // additive blend

  for (let i = 0; i < this._capacity; i++) {
    const p = this._slots[i];
    if (!p.active) continue;
    ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.1, p.size), 0, TAU);
    ctx.fill();
  }

  ctx.restore();   // restores globalCompositeOperation to 'source-over'
}
```

**Why additive blend produces bloom**: In `'lighter'` mode, pixel values are added channel-by-channel clamped to 255. A cluster of dim cyan particles (`rgba(0, 100, 150, 0.1)`) accumulate until the central pixels saturate to white-blue — exactly mimicking neon light diffusion through atmosphere. This is how modern games fake volumetric lighting on 2D sprites.

---

## Nova Bomb (`triggerNovaBomb` in `main.js`)

The Nova Bomb is the largest single emission event — **420 particles** from the flagship's position in a single tick:

```js
// Three simultaneous emission passes for color variety
particlePool.emitExplosion(x, y, 140, '#4af');   // cyan inner ring
particlePool.emitExplosion(x, y, 140, '#88f');   // violet mid ring
particlePool.emitExplosion(x, y, 140, '#fff');   // white hot core
```

At 420 particles simultaneously active in additive mode, the combined bloom appears as a pure-white spherical shockwave that fades through blue to dark over ~0.8 seconds. The 900-slot pool absorbs this burst without any allocation — if other particles were already active, up to 420 of the oldest are overwritten by the ring cursor.

---

## Memory Verification

To verify zero GC allocation during particle emission:

```js
// Browser console — watch heap during Nova Bombs
const before = performance.memory.usedJSHeapSize;
for (let i = 0; i < 20; i++) window.__NOVAPULSE__.triggerNovaBomb();
requestAnimationFrame(() => {
  const delta = performance.memory.usedJSHeapSize - before;
  console.log('Heap delta:', delta, 'bytes');
  // Expected: < 50,000 bytes (< 50 KB) across 8,400 particle activations
});
```
