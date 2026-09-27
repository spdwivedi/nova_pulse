# NovaPulse — Source Architecture Overview

> **Engine Version**: v5.0 · Phase 5 Final

---

## Pipeline Flow

NovaPulse processes every simulation frame in the following deterministic pipeline:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         requestAnimationFrame                        │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │    core/loop.js (GameLoop)   │
                    │    Fixed-step 60 Hz physics  │
                    │    + variable render frame   │
                    └──────────────┬───────────────┘
                                   │
              ┌────────────────────▼────────────────────┐
              │            Physics Step (dt = 1/60)      │
              │                                          │
              │   ecs/systems.js → PlayerInputSystem     │
              │        (read input, apply thrust)        │
              │                                          │
              │   ecs/systems.js → BoidSystem           │
              │        (flocking AI via ai/steering.js) │
              │                                          │
              │   ecs/systems.js → MovementSystem       │
              │        (integrate velocity + position)  │
              │                                          │
              │   ecs/systems.js → BoundarySystem       │
              │        (wrap/clamp world edges)         │
              │                                          │
              │   physics/ → CollisionSystem            │
              │     spatial_hash.js (broadphase)        │
              │     narrowphase.js (circle/AABB tests)  │
              │     resolver.js (impulse response)      │
              │                                          │
              │   ecs/systems.js → CombatSystem         │
              │     combat/projectile_pool.js (update)  │
              │     combat/weapons.js (fire logic)      │
              │     fx/particle_pool.js (update)        │
              │                                          │
              │   environment/arena.js (ArenaManager)   │
              │     (gravity, lasers, mines)            │
              │                                          │
              │   ai/wave_director.js (WaveDirector)   │
              │     (timers, scoring, wave transitions) │
              └────────────────────┬────────────────────┘
                                   │
              ┌────────────────────▼────────────────────┐
              │             Render Step (alpha)          │
              │                                          │
              │   core/viewport.js → trail()           │
              │        (semi-transparent frame wipe)    │
              │                                          │
              │   environment/arena.js → render()      │
              │        (boundary, hazards)              │
              │                                          │
              │   ecs/systems.js → RenderSystem         │
              │        (entities, projectiles,          │
              │         particles via fx/)              │
              └─────────────────────────────────────────┘
```

---

## Module Dependency Graph

```
main.js
  ├── core/viewport.js
  ├── core/events.js
  ├── core/loop.js
  ├── ecs/world.js
  │     └── ecs/entity.js
  ├── ecs/components.js
  ├── ecs/systems.js
  │     ├── ai/steering.js
  │     ├── ai/behaviors.js
  │     ├── combat/weapons.js
  │     └── physics/* (via CollisionSystem)
  ├── physics/colliders.js
  ├── combat/projectile_pool.js
  ├── fx/particle_pool.js
  ├── audio/sound_synth.js
  ├── environment/arena.js
  │     └── core/math.js
  │     └── ecs/components.js
  └── ai/wave_director.js
```

---

## Submodule Documentation

| Module | README | Responsibility |
|---|---|---|
| `core/` | [→ core/README.md](core/README.md) | Loop, viewport, math, event bus |
| `physics/` | [→ physics/README.md](physics/README.md) | Spatial hash, narrowphase, resolver, colliders |
| `ecs/` | [→ ecs/README.md](ecs/README.md) | Entity, world, components, systems |
| `ai/` | [→ ai/README.md](ai/README.md) | Steering behaviors, wave director |
| `combat/` | [→ combat/README.md](combat/README.md) | Projectile pool, weapon functions |
| `fx/` | [→ fx/README.md](fx/README.md) | Particle pool, additive compositing |
| `audio/` | [→ audio/README.md](audio/README.md) | Procedural WebAudio synthesizer |
| `environment/` | [→ environment/README.md](environment/README.md) | Arena hazards, arena manager |

---

## Design Principles

1. **Zero external runtime dependencies** — no npm packages at runtime. Node builtins only.
2. **Zero allocation in hot paths** — all Vec2 ops mutate in place; pools reuse slots.
3. **Deterministic ECS ordering** — systems run in registration order, every frame, every tick.
4. **Event-driven decoupling** — systems communicate via typed EventBus events, not direct references.
5. **Browser-first, server-testable** — all engine logic runs in both browser and Node.js. Only rendering and audio are browser-only (both degrade silently in Node).
