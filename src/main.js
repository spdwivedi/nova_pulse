/**
 * @file main.js
 * @description NovaPulse Phase 1 entrypoint.
 *
 * Initializes all engine subsystems, spawns 60 autonomous dual-team agents,
 * wires the game loop, and drives the HUD readout.
 */

import { Viewport }            from './core/viewport.js';
import { EventBus }            from './core/events.js';
import { GameLoop }            from './core/loop.js';
import { World }               from './ecs/world.js';
import {
  TransformComponent,
  KinematicsComponent,
  RenderComponent,
  AgentStateComponent,
}                              from './ecs/components.js';
import {
  MovementSystem,
  BoundarySystem,
  RenderSystem,
  WanderSystem,
}                              from './ecs/systems.js';
import { Vec2 }                from './core/math.js';

// ─────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────

const ENTITY_COUNT  = 60;
const TRAIL_ALPHA   = 0.15;   // motion-blur trail opacity

/** Neon palettes per team */
const PALETTES = {
  blue: {
    colors: ['#00cfff', '#00ffe7', '#5af5ff', '#00b8ff'],
    shapes: ['triangle', 'circle'],
  },
  crimson: {
    colors: ['#ff2d55', '#ff6b8a', '#ff0040', '#ff3f80'],
    shapes: ['triangle', 'diamond'],
  },
};

// ─────────────────────────────────────────────────────────────
//  HUD element references
// ─────────────────────────────────────────────────────────────

const $fps      = document.getElementById('hud-fps');
const $tick     = document.getElementById('hud-tick');
const $entities = document.getElementById('hud-entities');
const $blue     = document.getElementById('hud-blue');
const $crimson  = document.getElementById('hud-crimson');
const $simtime  = document.getElementById('hud-simtime');

// ─────────────────────────────────────────────────────────────
//  Bootstrap
// ─────────────────────────────────────────────────────────────

function init() {

  // ── 1. Core subsystems ────────────────────────────────────
  const bus      = new EventBus();
  const canvas   = document.getElementById('sim-canvas');
  const viewport = new Viewport(canvas, bus);
  const world    = new World();

  // ── 2. Systems (order matters: physics before render) ─────
  const boundarySystem = new BoundarySystem({ mode: 'wrap', margin: 24, viewport });
  const wanderSystem   = new WanderSystem({ changeInterval: 1.2, forceScale: 90 });
  const movementSystem = new MovementSystem();
  const renderSystem   = new RenderSystem();

  world
    .addSystem(wanderSystem)
    .addSystem(movementSystem)
    .addSystem(boundarySystem)
    .addSystem(renderSystem);

  // ── 3. Entity spawning ────────────────────────────────────
  const teams    = ['blue', 'crimson'];
  let blueCount  = 0;
  let crimsonCount = 0;

  for (let i = 0; i < ENTITY_COUNT; i++) {
    const team    = teams[i % 2];
    const palette = PALETTES[team];
    const color   = palette.colors[Math.floor(Math.random() * palette.colors.length)];
    const shape   = palette.shapes[Math.floor(Math.random() * palette.shapes.length)];

    // Random position across viewport
    const x = Math.random() * viewport.width;
    const y = Math.random() * viewport.height;

    // Random initial speed
    const speed    = 40 + Math.random() * 110;  // px/s
    const heading  = Math.random() * Math.PI * 2;
    const vx       = Math.cos(heading) * speed;
    const vy       = Math.sin(heading) * speed;

    world.createEntity(entity => {
      entity
        .add(new TransformComponent(x, y, heading))
        .add(new KinematicsComponent({
          maxSpeed: 50 + Math.random() * 130,
          maxForce: 160 + Math.random() * 80,
          drag:     0.96 + Math.random() * 0.03,
        }))
        .add(new RenderComponent({
          shape,
          size:  5 + Math.random() * 5,
          color,
          glow:  team === 'blue' ? 14 : 10,
        }))
        .add(new AgentStateComponent({
          mode:         'roam',
          energy:       60 + Math.random() * 40,
          team,
        }));

      // Set initial velocity
      const kin = entity.get(KinematicsComponent);
      kin.velocity.set(vx, vy);
    });

    if (team === 'blue') blueCount++;
    else crimsonCount++;
  }

  // ── 4. HUD update (runs each render frame) ────────────────
  let hudFrameSkip = 0;

  function updateHUD(loop) {
    // Only refresh DOM every 4 frames (~15 Hz) to avoid layout thrash
    if (++hudFrameSkip % 4 !== 0) return;
    $fps.textContent      = loop.fps.toFixed(1);
    $tick.textContent     = loop.tickMs.toFixed(2);
    $entities.textContent = world.entityCount;
    $blue.textContent     = blueCount;
    $crimson.textContent  = crimsonCount;
    $simtime.textContent  = formatSimTime(loop.simTime);
  }

  // ── 5. Game loop callbacks ────────────────────────────────
  const loop = new GameLoop({

    fixedUpdate(dt) {
      world.fixedUpdate(dt);
    },

    update(dt, alpha) {
      updateHUD(loop);
    },

    render(alpha) {
      // Motion-trail background
      viewport.trail(TRAIL_ALPHA);

      // ECS render pass
      world.render(viewport.ctx, alpha);
    },
  });

  // ── 6. Viewport resize — update boundary viewport ref ─────
  bus.on('viewport:resize', () => {
    boundarySystem.viewport = viewport;
  });

  // ── 7. Start ──────────────────────────────────────────────
  loop.start();

  // ── 8. Debug interface ────────────────────────────────────
  window.__NOVAPULSE__ = {
    version:  '1.0.0',
    phase:    1,
    loop,
    viewport,
    world,
    bus,
    /** Pause / resume the simulation */
    toggle:   () => loop.isActive ? loop.pause() : loop.resume(),
    /** Spawn additional agents at a given team */
    spawn(team = 'blue', count = 1) {
      const palette = PALETTES[team] ?? PALETTES.blue;
      for (let i = 0; i < count; i++) {
        world.createEntity(entity => {
          const color   = palette.colors[Math.floor(Math.random() * palette.colors.length)];
          const shape   = palette.shapes[Math.floor(Math.random() * palette.shapes.length)];
          const heading = Math.random() * Math.PI * 2;
          entity
            .add(new TransformComponent(
              Math.random() * viewport.width,
              Math.random() * viewport.height,
              heading
            ))
            .add(new KinematicsComponent({ maxSpeed: 80 + Math.random() * 120 }))
            .add(new RenderComponent({ shape, color, size: 5 + Math.random() * 5, glow: 14 }))
            .add(new AgentStateComponent({ mode: 'roam', team }));
          const kin = entity.get(KinematicsComponent);
          kin.velocity.set(Math.cos(heading) * 60, Math.sin(heading) * 60);
        });
        if (team === 'blue') blueCount++;
        else crimsonCount++;
      }
    },
    /** Expose debug snapshot */
    debug: () => ({ ...world.debug(), fps: loop.fps, simTime: loop.simTime }),
  };

  console.info(
    '%c⚡ NovaPulse v1.0 Phase 1 initialized',
    'color:#00ffe7;font-weight:bold;font-size:13px;',
    `\n  Entities: ${ENTITY_COUNT}`,
    `\n  Blue: ${blueCount} | Crimson: ${crimsonCount}`,
    '\n  Debug → window.__NOVAPULSE__'
  );
}

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Format simulation time (seconds) as MM:SS.mmm
 * @param {number} t - seconds
 * @returns {string}
 */
function formatSimTime(t) {
  const m  = Math.floor(t / 60);
  const s  = Math.floor(t % 60);
  const ms = Math.floor((t % 1) * 1000);
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
}

// ─────────────────────────────────────────────────────────────
//  Run
// ─────────────────────────────────────────────────────────────

// Use DOMContentLoaded guard in case this module is loaded early
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
