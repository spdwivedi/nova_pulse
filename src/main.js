/**
 * @file main.js
 * @description NovaPulse Phase 3 entrypoint.
 *
 * Features:
 *  - 200+ Blue flocking agents with Craig Reynolds flocking algorithms
 *  - 15 Crimson predator hunters with prey pursuit and scatter strikes
 *  - 1 Flagship fighter with dual-mode flight controller:
 *      * [AUTO SWARM SIMULATION] (Flagship wanders autonomously with swarm)
 *      * [MANUAL PILOT ACTIVE] (Player takes full manual flight with WASD/mouse aim)
 *  - Interactive targeting crosshair & thruster flame particles
 *  - Real-time flight telemetry, scatter counter, and spatial hash diagnostics
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
  BoidComponent,
  PlayerControllerComponent,
  CombatStateComponent,
}                              from './ecs/components.js';
import {
  MovementSystem,
  BoundarySystem,
  CollisionSystem,
  BoidSystem,
  PlayerInputSystem,
  RenderSystem,
  WanderSystem,
}                              from './ecs/systems.js';
import { CircleCollider, BoxCollider } from './physics/colliders.js';

// ─────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────

const BLUE_BOID_COUNT    = 210;
const CRIMSON_HUNTER_COUNT = 16;
const TRAIL_ALPHA        = 0.22;
const CELL_SIZE          = 56;

/** Neon color palettes */
const PALETTES = {
  blue: {
    colors: ['#00ffe7', '#00cfff', '#5af5ff', '#38bdf8', '#7dd3fc'],
  },
  crimson: {
    colors: ['#ff2d55', '#ff0044', '#ff3f80', '#fb7185', '#f43f5e'],
  },
  flagship: {
    color: '#00ffe7',
    glow:  20,
  },
};

// ─────────────────────────────────────────────────────────────
//  HUD DOM references
// ─────────────────────────────────────────────────────────────

const $modeBadge    = document.getElementById('hud-mode-badge');
const $velocity     = document.getElementById('hud-velocity');
const $swarmCount   = document.getElementById('hud-swarm-count');
const $hunterCount  = document.getElementById('hud-hunter-count');
const $scatters     = document.getElementById('hud-scatters');
const $fps          = document.getElementById('hud-fps');
const $tick         = document.getElementById('hud-tick');
const $entities     = document.getElementById('hud-entities');
const $simtime      = document.getElementById('hud-simtime');
const $gridCells    = document.getElementById('hud-grid-cells');
const $bpPairs      = document.getElementById('hud-bp-pairs');
const $pruned       = document.getElementById('hud-pruned');
const $pauseBadge   = document.getElementById('pause-badge');

// ─────────────────────────────────────────────────────────────
//  Simulation State
// ─────────────────────────────────────────────────────────────

let _loop, _world, _viewport, _bus;
let _collisionSystem, _renderSystem, _boundarySystem, _boidSystem, _playerInputSystem;
let _flagshipEntity = null;
let _blueCount = 0;
let _crimsonCount = 0;
let _scatterCount = 0;
let _isPaused = false;
let _debugWireframe = false;

// ─────────────────────────────────────────────────────────────
//  Bootstrap
// ─────────────────────────────────────────────────────────────

function init() {
  // ── 1. Core Subsystems ────────────────────────────────────
  _bus      = new EventBus();
  const canvas = document.getElementById('sim-canvas');
  _viewport = new Viewport(canvas, _bus);
  _world    = new World();

  // ── 2. Systems ────────────────────────────────────────────
  _playerInputSystem = new PlayerInputSystem({ viewport: _viewport, bus: _bus });
  _boidSystem        = new BoidSystem({ gridCellSize: 64 });
  const movementSystem = new MovementSystem();
  _boundarySystem    = new BoundarySystem({ mode: 'wrap', margin: 30, viewport: _viewport });
  _collisionSystem   = new CollisionSystem({
    bus: _bus,
    cellSize: CELL_SIZE,
    velocityThreshold: 50,
  });
  _renderSystem      = new RenderSystem({
    debugWireframe: _debugWireframe,
    grid: _collisionSystem.grid,
    viewport: _viewport,
  });

  _world
    .addSystem(_playerInputSystem)
    .addSystem(_boidSystem)
    .addSystem(movementSystem)
    .addSystem(_boundarySystem)
    .addSystem(_collisionSystem)
    .addSystem(_renderSystem);

  // ── 3. Spawning ───────────────────────────────────────────
  _blueCount    = 0;
  _crimsonCount = 0;
  _scatterCount = 0;

  spawnFlagship();
  spawnBlueSwarm(BLUE_BOID_COUNT);
  spawnCrimsonHunters(CRIMSON_HUNTER_COUNT);

  // ── 4. Combat / Scatter Event Hook ────────────────────────
  _bus.on('collision:enter', ({ entityA, entityB }) => {
    if (!entityA || !entityB) return;

    const boidA = entityA.get(BoidComponent);
    const boidB = entityB.get(BoidComponent);

    // If a crimson hunter collides with a blue prey flocker
    if (boidA && boidB && boidA.flockType !== boidB.flockType) {
      _scatterCount++;

      const hunter = boidA.flockType === 'crimson' ? entityA : entityB;
      const prey   = boidA.flockType === 'blue'    ? entityA : entityB;

      const tfH = hunter.get(TransformComponent);
      const tfP = prey.get(TransformComponent);
      const kinP = prey.get(KinematicsComponent);

      if (tfH && tfP && kinP) {
        // Scatter impulse: push prey explosively away from hunter
        const dx = tfP.position.x - tfH.position.x;
        const dy = tfP.position.y - tfH.position.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        kinP.velocity.x += (dx / len) * 140;
        kinP.velocity.y += (dy / len) * 140;

        const colP = prey.get(ColliderComponent);
        if (colP) colP.flashTimer = 0.18;

        const combatP = prey.get(CombatStateComponent);
        if (combatP) combatP.takeDamage(15);
      }
    }
  });

  // Mode toggle event
  _bus.on('player:modeToggle', () => {
    toggleFlightMode();
  });

  // ── 5. HUD Diagnostics ────────────────────────────────────
  let _hudSkip = 0;

  function updateHUD() {
    if (++_hudSkip % 4 !== 0) return;

    // Mode Badge
    const ctrl = _flagshipEntity?.get(PlayerControllerComponent);
    const isManual = ctrl ? ctrl.isManualControlled : false;
    if (isManual) {
      $modeBadge.textContent = '[MANUAL PILOT ACTIVE]';
      $modeBadge.className   = 'mode-badge manual';
    } else {
      $modeBadge.textContent = '[AUTO SWARM SIMULATION]';
      $modeBadge.className   = 'mode-badge auto';
    }

    // Flagship speed
    const kin = _flagshipEntity?.get(KinematicsComponent);
    const speed = kin ? kin.velocity.mag() : 0;
    $velocity.textContent = `${speed.toFixed(1)} px/s`;

    // Swarm counts & combat
    $swarmCount.textContent  = _blueCount;
    $hunterCount.textContent = _crimsonCount;
    $scatters.textContent    = _scatterCount;

    // Engine performance
    $fps.textContent      = _loop.fps.toFixed(1);
    $tick.textContent     = _loop.tickMs.toFixed(2);
    $entities.textContent = _world.entityCount;
    $simtime.textContent  = formatSimTime(_loop.simTime);

    // Spatial hash
    const broad = _collisionSystem.lastBroadphasePairs;
    const N     = _world.entityCount;
    const naive = N * (N - 1) / 2;
    $gridCells.textContent = _collisionSystem.lastGridOccupancy;
    $bpPairs.textContent   = broad;
    $pruned.textContent    = Math.max(0, naive - broad).toLocaleString();
  }

  // ── 6. Game Loop ──────────────────────────────────────────
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

  // ── 7. Resize ─────────────────────────────────────────────
  _bus.on('viewport:resize', () => {
    _boundarySystem.viewport = _viewport;
    _renderSystem.viewport   = _viewport;
  });

  // ── 8. Start ──────────────────────────────────────────────
  _loop.start();
  _isPaused = false;

  console.info(
    '%c⚡ NovaPulse v3.0 Phase 3 Initialized',
    'color:#00ffe7;font-weight:bold;font-size:13px;',
    `\n  Blue Swarm: ${_blueCount} | Crimson Hunters: ${_crimsonCount}`,
    '\n  [M] Manual Pilot · [WASD] Thrusters · [Mouse] Aim',
    '\n  [B] Wireframes · [Space] Pause · [R] Reset'
  );
}

// ─────────────────────────────────────────────────────────────
//  Entity Spawners
// ─────────────────────────────────────────────────────────────

/**
 * Spawn the Flagship / Player entity with dual-mode controller.
 */
function spawnFlagship() {
  const cx = _viewport.width * 0.5;
  const cy = _viewport.height * 0.5;

  _flagshipEntity = _world.createEntity(entity => {
    entity
      .add(new TransformComponent(cx, cy, 0, 1.2))
      .add(new KinematicsComponent({
        maxSpeed: 240,
        maxForce: 360,
        drag:     0.975,
      }))
      .add(new RenderComponent({
        shape:   'flagship',
        size:    9,
        color:   PALETTES.flagship.color,
        glow:    PALETTES.flagship.glow,
      }))
      .add(new ColliderComponent({
        shape: new CircleCollider({ radius: 11 }),
        layer: 0x01,
        mask:  0xFF,
      }))
      .add(new RigidBodyComponent({
        mass:        2.5,
        restitution: 0.5,
        friction:    0.2,
      }))
      .add(new BoidComponent({
        flockType:        'blue',
        perceptionRadius: 100,
        separationRadius: 36,
        maxForce:         200,
        maxSpeed:         170,
      }))
      .add(new PlayerControllerComponent({
        thrustForce:        340,
        turnRate:           9.5,
        damping:            0.965,
        isManualControlled: false, // Default to AUTO SWARM mode
      }))
      .add(new CombatStateComponent({
        health:    200,
        maxHealth: 200,
        energy:    100,
      }));

    // Start with gentle forward drift
    const kin = entity.get(KinematicsComponent);
    kin.velocity.set(50, 0);
  });
}

/**
 * Spawn Blue Prey / Flocking Boids.
 */
function spawnBlueSwarm(count) {
  const palette = PALETTES.blue.colors;
  const cx = _viewport.width * 0.5;
  const cy = _viewport.height * 0.5;

  for (let i = 0; i < count; i++) {
    const color = palette[Math.floor(Math.random() * palette.length)];
    // Spawn clustered in middle third of canvas
    const x = cx + (Math.random() - 0.5) * (_viewport.width * 0.65);
    const y = cy + (Math.random() - 0.5) * (_viewport.height * 0.65);

    const heading = Math.random() * Math.PI * 2;
    const speed   = 70 + Math.random() * 80;

    _world.createEntity(entity => {
      entity
        .add(new TransformComponent(x, y, heading, 0.95))
        .add(new KinematicsComponent({
          maxSpeed: 175 + Math.random() * 30,
          maxForce: 210,
          drag:     0.985,
        }))
        .add(new RenderComponent({
          shape: 'arrowhead',
          size:  4.5 + Math.random() * 2.5,
          color,
          glow:  10,
        }))
        .add(new ColliderComponent({
          shape: new CircleCollider({ radius: 5.5 }),
          layer: 0x01,
          mask:  0xFF,
        }))
        .add(new RigidBodyComponent({
          mass:        0.8,
          restitution: 0.4,
          friction:    0.15,
        }))
        .add(new BoidComponent({
          flockType:        'blue',
          perceptionRadius: 75 + Math.random() * 20,
          separationRadius: 28,
          maxForce:         185 + Math.random() * 40,
          maxSpeed:         160 + Math.random() * 30,
        }))
        .add(new CombatStateComponent({
          health: 50,
          maxHealth: 50,
        }));

      const kin = entity.get(KinematicsComponent);
      kin.velocity.set(Math.cos(heading) * speed, Math.sin(heading) * speed);
    });

    _blueCount++;
  }
}

/**
 * Spawn Crimson Hunter / Predator Agents.
 */
function spawnCrimsonHunters(count) {
  const palette = PALETTES.crimson.colors;

  for (let i = 0; i < count; i++) {
    const color = palette[Math.floor(Math.random() * palette.length)];
    // Spawn along perimeter
    const side = Math.floor(Math.random() * 4);
    let x = 0, y = 0;
    if (side === 0) { x = Math.random() * _viewport.width; y = 20; }
    else if (side === 1) { x = _viewport.width - 20; y = Math.random() * _viewport.height; }
    else if (side === 2) { x = Math.random() * _viewport.width; y = _viewport.height - 20; }
    else { x = 20; y = Math.random() * _viewport.height; }

    const heading = Math.random() * Math.PI * 2;
    const speed   = 85 + Math.random() * 65;

    _world.createEntity(entity => {
      entity
        .add(new TransformComponent(x, y, heading, 1.1))
        .add(new KinematicsComponent({
          maxSpeed: 195 + Math.random() * 25,
          maxForce: 240,
          drag:     0.98,
        }))
        .add(new RenderComponent({
          shape: 'spiked_diamond',
          size:  6.5 + Math.random() * 2.5,
          color,
          glow:  14,
        }))
        .add(new ColliderComponent({
          shape: new CircleCollider({ radius: 8 }),
          layer: 0x02,
          mask:  0xFF,
        }))
        .add(new RigidBodyComponent({
          mass:        1.6,
          restitution: 0.5,
          friction:    0.2,
        }))
        .add(new BoidComponent({
          flockType:        'crimson',
          perceptionRadius: 150,
          separationRadius: 40,
          maxForce:         230,
          maxSpeed:         190,
        }))
        .add(new CombatStateComponent({
          health:    120,
          maxHealth: 120,
        }));

      const kin = entity.get(KinematicsComponent);
      kin.velocity.set(Math.cos(heading) * speed, Math.sin(heading) * speed);
    });

    _crimsonCount++;
  }
}

// ─────────────────────────────────────────────────────────────
//  Flight Mode Toggle
// ─────────────────────────────────────────────────────────────

function toggleFlightMode() {
  if (!_flagshipEntity) return;
  const ctrl = _flagshipEntity.get(PlayerControllerComponent);
  if (!ctrl) return;

  ctrl.isManualControlled = !ctrl.isManualControlled;
  console.info(`[NovaPulse] Mode Switched → ${ctrl.isManualControlled ? 'MANUAL PILOT' : 'AUTO SWARM'}`);
}

// ─────────────────────────────────────────────────────────────
//  Keyboard Hotkey Listeners
// ─────────────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if (e.target !== document.body && e.target !== document.documentElement) return;

  switch (e.code) {
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

    case 'KeyB': {
      _debugWireframe = !_debugWireframe;
      _renderSystem.debugWireframe = _debugWireframe;
      console.info(`[NovaPulse] Wireframes: ${_debugWireframe ? 'ON' : 'OFF'}`);
      break;
    }

    case 'KeyR': {
      _loop.stop();
      if (_playerInputSystem) _playerInputSystem.destroy();
      _world = new World();
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
//  Debug API Exposure
// ─────────────────────────────────────────────────────────────

function attachDebugAPI() {
  window.__NOVAPULSE__ = {
    version:           '3.0.0',
    phase:             3,
    get loop()         { return _loop; },
    get world()        { return _world; },
    get viewport()     { return _viewport; },
    get flagship()     { return _flagshipEntity; },
    get blueCount()    { return _blueCount; },
    get crimsonCount() { return _crimsonCount; },
    get scatters()     { return _scatterCount; },

    toggleFlightMode,
    togglePause: () => {
      _isPaused ? (_loop.resume(), _isPaused = false, $pauseBadge.classList.remove('visible'))
                : (_loop.pause(),  _isPaused = true,  $pauseBadge.classList.add('visible'));
    },
    toggleWireframe: () => {
      _debugWireframe = !_debugWireframe;
      _renderSystem.debugWireframe = _debugWireframe;
    },
    spawnBlue: (n = 10) => spawnBlueSwarm(n),
    spawnCrimson: (n = 3) => spawnCrimsonHunters(n),

    stats: () => ({
      fps:       _loop?.fps,
      entities:  _world?.entityCount,
      blue:      _blueCount,
      crimson:   _crimsonCount,
      scatters:  _scatterCount,
      isManual:  _flagshipEntity?.get(PlayerControllerComponent)?.isManualControlled,
    }),
  };
}

// ─────────────────────────────────────────────────────────────
//  Bootstrap Execution
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
