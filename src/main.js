/**
 * @file main.js
 * @description NovaPulse Phase 2 entrypoint.
 *
 * Changes from Phase 1:
 *  - 150 physics-enabled entities (mix of circle + box colliders, varying mass)
 *  - CollisionSystem integrated with SpatialHashGrid broadphase
 *  - Hotkeys: [Space] pause/resume, [B] debug wireframe, [R] reset
 *  - Extended HUD with physics diagnostics
 *  - window.__NOVAPULSE__ updated to v2.0 debug API
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
  ColliderComponent,
  RigidBodyComponent,
}                              from './ecs/components.js';
import {
  MovementSystem,
  BoundarySystem,
  CollisionSystem,
  RenderSystem,
  WanderSystem,
}                              from './ecs/systems.js';
import { CircleCollider, BoxCollider } from './physics/colliders.js';

// ─────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────

const ENTITY_COUNT = 150;
const TRAIL_ALPHA  = 0.18;
const CELL_SIZE    = 52;

/** Neon palettes per team */
const PALETTES = {
  blue: {
    colors: ['#00cfff', '#00ffe7', '#5af5ff', '#00b8ff', '#40e0ff'],
    shapes: ['triangle', 'circle'],
  },
  crimson: {
    colors: ['#ff2d55', '#ff6b8a', '#ff0040', '#ff3f80', '#ff7040'],
    shapes: ['triangle', 'diamond'],
  },
};

// ─────────────────────────────────────────────────────────────
//  HUD references
// ─────────────────────────────────────────────────────────────

const $fps        = document.getElementById('hud-fps');
const $tick       = document.getElementById('hud-tick');
const $entities   = document.getElementById('hud-entities');
const $blue       = document.getElementById('hud-blue');
const $crimson    = document.getElementById('hud-crimson');
const $simtime    = document.getElementById('hud-simtime');
const $gridCells  = document.getElementById('hud-grid-cells');
const $bpPairs    = document.getElementById('hud-bp-pairs');
const $npHits     = document.getElementById('hud-np-hits');
const $solveMs    = document.getElementById('hud-solve-ms');
const $pruned     = document.getElementById('hud-pruned');
const $pauseBadge = document.getElementById('pause-badge');

// ─────────────────────────────────────────────────────────────
//  Bootstrap
// ─────────────────────────────────────────────────────────────

// Hold top-level references for reset
let _loop, _world, _viewport, _bus;
let _collisionSystem, _renderSystem, _boundarySystem;
let _blueCount = 0, _crimsonCount = 0;
let _isPaused  = false;
let _debugMode = false;

function init() {

  // ── 1. Core subsystems ────────────────────────────────────
  _bus      = new EventBus();
  const canvas = document.getElementById('sim-canvas');
  _viewport = new Viewport(canvas, _bus);
  _world    = new World();

  // ── 2. Systems ────────────────────────────────────────────
  _boundarySystem  = new BoundarySystem({ mode: 'bounce', margin: 18, viewport: _viewport });
  const wanderSystem = new WanderSystem({ changeInterval: 1.4, forceScale: 95 });
  const movementSystem = new MovementSystem();
  _collisionSystem = new CollisionSystem({
    bus:      _bus,
    cellSize: CELL_SIZE,
    velocityThreshold: 55,
  });
  _renderSystem = new RenderSystem({
    debugWireframe: _debugMode,
    grid:     _collisionSystem.grid,
    viewport: _viewport,
  });

  _world
    .addSystem(wanderSystem)
    .addSystem(movementSystem)
    .addSystem(_boundarySystem)
    .addSystem(_collisionSystem)
    .addSystem(_renderSystem);

  // ── 3. Spawn 150 physics entities ─────────────────────────
  _blueCount    = 0;
  _crimsonCount = 0;
  spawnEntities(ENTITY_COUNT);

  // ── 4. Collision event listeners ─────────────────────────
  _bus.on('collision:enter', ({ idA, idB }) => {
    // Future: sound / particle bursts can hook here
    void idA; void idB;
  });

  // ── 5. HUD ────────────────────────────────────────────────
  let _hudSkip = 0;

  function updateHUD() {
    if (++_hudSkip % 4 !== 0) return;
    const totalEntities = _world.entityCount;
    const narrow = _collisionSystem.lastNarrowphaseHits;
    const broad  = _collisionSystem.lastBroadphasePairs;
    // Pruned = (N*(N-1)/2) - broadphase pairs tested
    const N       = totalEntities;
    const naivePairs = N * (N - 1) / 2;
    const pruned  = Math.max(0, naivePairs - broad);

    $fps.textContent       = _loop.fps.toFixed(1);
    $tick.textContent      = _loop.tickMs.toFixed(2);
    $entities.textContent  = totalEntities;
    $blue.textContent      = _blueCount;
    $crimson.textContent   = _crimsonCount;
    $simtime.textContent   = formatSimTime(_loop.simTime);
    $gridCells.textContent = _collisionSystem.lastGridOccupancy;
    $bpPairs.textContent   = broad;
    $npHits.textContent    = narrow;
    $solveMs.textContent   = _collisionSystem.lastSolveMsec.toFixed(2);
    $pruned.textContent    = pruned.toLocaleString();
  }

  // ── 6. Game loop ──────────────────────────────────────────
  _loop = new GameLoop({
    fixedUpdate(dt) {
      _world.fixedUpdate(dt);
    },
    update(_dt, _alpha) {
      updateHUD();
    },
    render(alpha) {
      _viewport.trail(TRAIL_ALPHA);
      _world.render(_viewport.ctx, alpha);
    },
  });

  // ── 7. Resize handling ────────────────────────────────────
  _bus.on('viewport:resize', () => {
    _boundarySystem.viewport = _viewport;
    _renderSystem.viewport   = _viewport;
  });

  // ── 8. Start ──────────────────────────────────────────────
  _loop.start();
  _isPaused = false;

  console.info(
    '%c⚡ NovaPulse v2.0 Phase 2 initialized',
    'color:#00ffe7;font-weight:bold;font-size:13px;',
    `\n  Entities: ${ENTITY_COUNT}`,
    `\n  Cell size: ${CELL_SIZE}px`,
    `\n  Blue: ${_blueCount} | Crimson: ${_crimsonCount}`,
    '\n  [Space] pause · [B] wireframe · [R] reset',
    '\n  Debug → window.__NOVAPULSE__'
  );
}

// ─────────────────────────────────────────────────────────────
//  Entity spawning
// ─────────────────────────────────────────────────────────────

function spawnEntities(count) {
  const teams = ['blue', 'crimson'];

  for (let i = 0; i < count; i++) {
    const team    = teams[i % 2];
    const palette = PALETTES[team];
    const color   = palette.colors[Math.floor(Math.random() * palette.colors.length)];
    const shape   = palette.shapes[Math.floor(Math.random() * palette.shapes.length)];

    const x       = 40 + Math.random() * (_viewport.width  - 80);
    const y       = 40 + Math.random() * (_viewport.height - 80);
    const speed   = 35 + Math.random() * 95;
    const heading = Math.random() * Math.PI * 2;
    const vx      = Math.cos(heading) * speed;
    const vy      = Math.sin(heading) * speed;

    // Vary entity type for visual diversity
    const typeRoll  = Math.random();
    const isBoxBody = typeRoll < 0.25;   // 25% boxes
    const mass      = 0.5 + Math.random() * 3.5;
    const visualSz  = 5 + Math.random() * 7;

    // Collider geometry
    let colliderShape;
    if (isBoxBody) {
      const hw = visualSz * 0.9;
      const hh = visualSz * 0.65;
      colliderShape = new BoxCollider({ halfWidth: hw, halfHeight: hh });
    } else {
      colliderShape = new CircleCollider({ radius: visualSz * 1.05 });
    }

    _world.createEntity(entity => {
      entity
        .add(new TransformComponent(x, y, heading))
        .add(new KinematicsComponent({
          maxSpeed: 45 + Math.random() * 125,
          maxForce: 140 + Math.random() * 90,
          drag:     0.97 + Math.random() * 0.02,
        }))
        .add(new RenderComponent({
          shape:   isBoxBody ? 'diamond' : shape,
          size:    visualSz,
          color,
          glow:    team === 'blue' ? 13 : 10,
        }))
        .add(new AgentStateComponent({
          mode:   'roam',
          energy: 60 + Math.random() * 40,
          team,
        }))
        .add(new ColliderComponent({ shape: colliderShape }))
        .add(new RigidBodyComponent({
          mass,
          restitution: 0.35 + Math.random() * 0.4,
          friction:    0.15 + Math.random() * 0.25,
        }));

      const kin = entity.get(KinematicsComponent);
      kin.velocity.set(vx, vy);
    });

    if (team === 'blue') _blueCount++;
    else _crimsonCount++;
  }
}

// ─────────────────────────────────────────────────────────────
//  Hotkeys
// ─────────────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  // Ignore when focused on an input
  if (e.target !== document.body && e.target !== document.documentElement) return;

  switch (e.code) {
    // ── Space: pause / resume ─────────────────────────────
    case 'Space': {
      e.preventDefault();
      if (_isPaused) {
        _loop.resume();
        _isPaused = false;
        $pauseBadge.classList.remove('visible');
      } else {
        _loop.pause();
        _isPaused = true;
        $pauseBadge.classList.add('visible');
      }
      break;
    }

    // ── B: toggle debug wireframes ────────────────────────
    case 'KeyB': {
      _debugMode = !_debugMode;
      _renderSystem.debugWireframe = _debugMode;
      console.info(`[NovaPulse] Debug wireframe: ${_debugMode ? 'ON' : 'OFF'}`);
      break;
    }

    // ── R: reset simulation ───────────────────────────────
    case 'KeyR': {
      _loop.stop();
      _world = new World(); // discard all entities
      _blueCount    = 0;
      _crimsonCount = 0;
      init();
      break;
    }
  }
});

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

function formatSimTime(t) {
  const m  = Math.floor(t / 60);
  const s  = Math.floor(t % 60);
  const ms = Math.floor((t % 1) * 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

// ─────────────────────────────────────────────────────────────
//  Debug API
// ─────────────────────────────────────────────────────────────

// Set up debug interface after init (re-assigned on reset)
function attachDebugAPI() {
  window.__NOVAPULSE__ = {
    version:  '2.0.0',
    phase:    2,
    get loop()             { return _loop; },
    get viewport()         { return _viewport; },
    get world()            { return _world; },
    get bus()              { return _bus; },
    get collisionSystem()  { return _collisionSystem; },
    toggle:   () => _isPaused
                      ? (_loop.resume(), _isPaused = false, $pauseBadge.classList.remove('visible'))
                      : (_loop.pause(),  _isPaused = true,  $pauseBadge.classList.add('visible')),
    wireframe: (on) => {
      _debugMode = on ?? !_debugMode;
      _renderSystem.debugWireframe = _debugMode;
    },
    spawn(team = 'blue', count = 5) {
      spawnEntities(count);
    },
    physics: () => _collisionSystem ? {
      broadphasePairs: _collisionSystem.lastBroadphasePairs,
      narrowHits:      _collisionSystem.lastNarrowphaseHits,
      solveMsec:       _collisionSystem.lastSolveMsec,
      gridOccupancy:   _collisionSystem.lastGridOccupancy,
      gridStats:       _collisionSystem.grid.stats(),
    } : null,
    debug: () => ({
      ...(_world?.debug()),
      fps:       _loop?.fps,
      simTime:   _loop?.simTime,
      blueCount: _blueCount,
      crimsonCount: _crimsonCount,
    }),
  };
}

// ─────────────────────────────────────────────────────────────
//  Run
// ─────────────────────────────────────────────────────────────

function bootstrap() {
  init();
  attachDebugAPI();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
