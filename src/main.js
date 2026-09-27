/**
 * @file main.js
 * @description NovaPulse Phase 4 entrypoint.
 *
 * Features:
 *  - 210 Blue flocking agents with Craig Reynolds flocking algorithms
 *  - 16 Crimson predator hunters with tracking spore thorns
 *  - 1 Flagship fighter with dual plasma cannons and active heat/energy management
 *  - Zero-allocation 400-slot ProjectilePool & 800-slot ParticlePool
 *  - Hardware-accelerated additive neon particle FX (muzzle flashes, sparks, radial explosions)
 *  - Zero-asset procedural chiptune sound synthesizer (WebAudio API)
 *  - HUD Ship Status telemetry (Shield/Hull, Capacitor, Overheat gauge)
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
  WeaponComponent,
  AudioSourceComponent,
}                              from './ecs/components.js';
import {
  MovementSystem,
  BoundarySystem,
  CollisionSystem,
  BoidSystem,
  PlayerInputSystem,
  CombatSystem,
  RenderSystem,
}                              from './ecs/systems.js';
import { CircleCollider }      from './physics/colliders.js';
import { ProjectilePool }      from './combat/projectile_pool.js';
import { ParticlePool }        from './fx/particle_pool.js';
import { SoundSynth }          from './audio/sound_synth.js';

// ─────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────

const BLUE_BOID_COUNT      = 210;
const CRIMSON_HUNTER_COUNT = 16;
const TRAIL_ALPHA          = 0.24;
const CELL_SIZE            = 56;

const PALETTES = {
  blue: {
    colors: ['#00ffe7', '#00cfff', '#5af5ff', '#38bdf8', '#7dd3fc'],
  },
  crimson: {
    colors: ['#ff2d55', '#ff0044', '#ff3f80', '#fb7185', '#f43f5e'],
  },
  flagship: {
    color: '#00ffe7',
    glow:  22,
  },
};

// ─────────────────────────────────────────────────────────────
//  HUD DOM references
// ─────────────────────────────────────────────────────────────

const $modeBadge    = document.getElementById('hud-mode-badge');
const $hpVal        = document.getElementById('hud-hp-val');
const $hpBar        = document.getElementById('hud-hp-bar');
const $energyVal    = document.getElementById('hud-energy-val');
const $energyBar    = document.getElementById('hud-energy-bar');
const $heatVal      = document.getElementById('hud-heat-val');
const $heatBar      = document.getElementById('hud-heat-bar');

const $velocity     = document.getElementById('hud-velocity');
const $destroyed    = document.getElementById('hud-destroyed');
const $swarmCount   = document.getElementById('hud-swarm-count');
const $hunterCount  = document.getElementById('hud-hunter-count');
const $scatters     = document.getElementById('hud-scatters');

const $projectiles  = document.getElementById('hud-projectiles');
const $particles    = document.getElementById('hud-particles');
const $audioStatus  = document.getElementById('hud-audio-status');

const $fps          = document.getElementById('hud-fps');
const $tick         = document.getElementById('hud-tick');
const $pauseBadge   = document.getElementById('pause-badge');

// ─────────────────────────────────────────────────────────────
//  Simulation State
// ─────────────────────────────────────────────────────────────

let _loop, _world, _viewport, _bus;
let _projectilePool, _particlePool, _soundSynth;
let _collisionSystem, _renderSystem, _boundarySystem, _boidSystem, _playerInputSystem, _combatSystem;

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
  _bus            = new EventBus();
  const canvas    = document.getElementById('sim-canvas');
  _viewport       = new Viewport(canvas, _bus);
  _world          = new World();

  _projectilePool = new ProjectilePool(400);
  _particlePool   = new ParticlePool(800);
  _soundSynth     = new SoundSynth();

  // ── 2. Systems ────────────────────────────────────────────
  _playerInputSystem = new PlayerInputSystem({
    viewport:     _viewport,
    bus:          _bus,
    particlePool: _particlePool,
    soundSynth:   _soundSynth,
  });

  _boidSystem = new BoidSystem({ gridCellSize: 64 });
  const movementSystem = new MovementSystem();
  _boundarySystem = new BoundarySystem({ mode: 'wrap', margin: 30, viewport: _viewport });

  _collisionSystem = new CollisionSystem({
    bus: _bus,
    cellSize: CELL_SIZE,
    velocityThreshold: 50,
  });

  _combatSystem = new CombatSystem({
    projectilePool: _projectilePool,
    particlePool:   _particlePool,
    soundSynth:     _soundSynth,
    bus:            _bus,
  });

  _renderSystem = new RenderSystem({
    debugWireframe: _debugWireframe,
    grid:           _collisionSystem.grid,
    viewport:       _viewport,
    projectilePool: _projectilePool,
    particlePool:   _particlePool,
  });

  _world
    .addSystem(_playerInputSystem)
    .addSystem(_boidSystem)
    .addSystem(movementSystem)
    .addSystem(_boundarySystem)
    .addSystem(_collisionSystem)
    .addSystem(_combatSystem)
    .addSystem(_renderSystem);

  // ── 3. Spawning ───────────────────────────────────────────
  _blueCount    = 0;
  _crimsonCount = 0;
  _scatterCount = 0;

  spawnFlagship();
  spawnBlueSwarm(BLUE_BOID_COUNT);
  spawnCrimsonHunters(CRIMSON_HUNTER_COUNT);

  // ── 4. Event Subscriptions ────────────────────────────────
  _bus.on('collision:enter', ({ entityA, entityB }) => {
    if (!entityA || !entityB) return;

    const boidA = entityA.get(BoidComponent);
    const boidB = entityB.get(BoidComponent);

    // Crimson hunter strike on Blue flocker
    if (boidA && boidB && boidA.flockType !== boidB.flockType) {
      _scatterCount++;

      const hunter = boidA.flockType === 'crimson' ? entityA : entityB;
      const prey   = boidA.flockType === 'blue'    ? entityA : entityB;

      const tfH = hunter.get(TransformComponent);
      const tfP = prey.get(TransformComponent);
      const kinP = prey.get(KinematicsComponent);

      if (tfH && tfP && kinP) {
        const dx = tfP.position.x - tfH.position.x;
        const dy = tfP.position.y - tfH.position.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        kinP.velocity.x += (dx / len) * 150;
        kinP.velocity.y += (dy / len) * 150;

        const colP = prey.get(ColliderComponent);
        if (colP) colP.flashTimer = 0.18;

        const combatP = prey.get(CombatStateComponent);
        if (combatP) combatP.takeDamage(12);

        _particlePool.emitImpactSparks(tfP.position.x, tfP.position.y, { x: dx / len, y: dy / len }, 6, '#00ffe7');
        _soundSynth.playImpact(0.06);
      }
    }
  });

  _bus.on('entity:destroyed', ({ killerTeam }) => {
    if (killerTeam === 'blue') {
      _crimsonCount = Math.max(0, _crimsonCount - 1);
      // Auto-replenish hunter periodically to keep combat dynamic
      if (_crimsonCount < 8) {
        setTimeout(() => spawnCrimsonHunters(1), 3000);
      }
    } else {
      _blueCount = Math.max(0, _blueCount - 1);
    }
  });

  _bus.on('player:modeToggle', () => {
    toggleFlightMode();
  });

  _bus.on('sound:muteToggle', isMuted => {
    $audioStatus.textContent = isMuted ? '[MUTED]' : '[ACTIVE]';
    $audioStatus.className = isMuted ? 'val amber' : 'val green';
  });

  // ── 5. HUD Telemetry Updates ──────────────────────────────
  let _hudSkip = 0;

  function updateHUD() {
    if (++_hudSkip % 3 !== 0) return;

    // 1. Mode Badge
    const ctrl = _flagshipEntity?.get(PlayerControllerComponent);
    const isManual = ctrl ? ctrl.isManualControlled : false;
    if (isManual) {
      $modeBadge.textContent = '[MANUAL PILOT ACTIVE]';
      $modeBadge.className   = 'mode-badge manual';
    } else {
      $modeBadge.textContent = '[AUTO SWARM SIMULATION]';
      $modeBadge.className   = 'mode-badge auto';
    }

    // 2. Flagship Status Bars
    const combat = _flagshipEntity?.get(CombatStateComponent);
    if (combat) {
      const hpPct = Math.round((combat.health / combat.maxHealth) * 100);
      $hpVal.textContent    = `${hpPct}%`;
      $hpBar.style.width    = `${hpPct}%`;
      $energyVal.textContent = `${Math.round(combat.energy)}%`;
      $energyBar.style.width = `${Math.round(combat.energy)}%`;
    }

    const weapon = _flagshipEntity?.get(WeaponComponent);
    if (weapon) {
      const heatPct = Math.round((weapon.heat / weapon.maxHeat) * 100);
      $heatVal.textContent = weapon.isOverheated ? 'OVERHEATED!' : `${heatPct}%`;
      $heatVal.className   = weapon.isOverheated ? 'val crimson' : 'val amber';
      $heatBar.style.width = `${heatPct}%`;
      $heatBar.className   = weapon.isOverheated ? 'bar-fill heat overheated' : 'bar-fill heat';
    }

    // 3. Flight Telemetry & Combat
    const kin = _flagshipEntity?.get(KinematicsComponent);
    const speed = kin ? kin.velocity.mag() : 0;
    $velocity.textContent  = `${speed.toFixed(1)} px/s`;
    $destroyed.textContent = _combatSystem.enemiesDestroyed;
    $swarmCount.textContent = _blueCount;
    $hunterCount.textContent = _crimsonCount;
    $scatters.textContent   = _scatterCount;

    // 4. Object Pools & Performance
    $projectiles.textContent = _projectilePool.activeCount;
    $particles.textContent   = _particlePool.activeCount;
    $fps.textContent         = _loop.fps.toFixed(1);
    $tick.textContent        = _loop.tickMs.toFixed(2);
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
    '%c⚡ NovaPulse v4.0 Phase 4 Initialized',
    'color:#00ffe7;font-weight:bold;font-size:13px;',
    `\n  Blue Swarm: ${_blueCount} | Crimson Hunters: ${_crimsonCount}`,
    '\n  [Mouse Left / Space] Plasma Cannons · [WASD] Thrusters',
    '\n  [M] Manual Pilot · [X] Sound FX · [P] Pause · [B] Wireframes · [R] Reset'
  );
}

// ─────────────────────────────────────────────────────────────
//  Entity Spawners
// ─────────────────────────────────────────────────────────────

function spawnFlagship() {
  const cx = _viewport.width * 0.5;
  const cy = _viewport.height * 0.5;

  _flagshipEntity = _world.createEntity(entity => {
    entity
      .add(new TransformComponent(cx, cy, 0, 1.25))
      .add(new KinematicsComponent({
        maxSpeed: 260,
        maxForce: 380,
        drag:     0.975,
      }))
      .add(new RenderComponent({
        shape: 'flagship',
        size:  9,
        color: PALETTES.flagship.color,
        glow:  PALETTES.flagship.glow,
      }))
      .add(new ColliderComponent({
        shape: new CircleCollider({ radius: 12 }),
        layer: 0x01,
        mask:  0xFF,
      }))
      .add(new RigidBodyComponent({
        mass:        2.8,
        restitution: 0.5,
        friction:    0.2,
      }))
      .add(new BoidComponent({
        flockType:        'blue',
        perceptionRadius: 110,
        separationRadius: 38,
        maxForce:         210,
        maxSpeed:         180,
      }))
      .add(new PlayerControllerComponent({
        thrustForce:        360,
        turnRate:           9.5,
        damping:            0.965,
        isManualControlled: false,
      }))
      .add(new CombatStateComponent({
        health:    250,
        maxHealth: 250,
        energy:    100,
      }))
      .add(new WeaponComponent({
        fireRate:        7.5,
        projectileSpeed: 520,
        damage:          28,
        spread:          0.025,
        heatPerShot:     7.5,
        maxHeat:         100,
        coolingRate:     38,
        color:           '#00ffe7',
      }))
      .add(new AudioSourceComponent());

    const kin = entity.get(KinematicsComponent);
    kin.velocity.set(60, 0);
  });
}

function spawnBlueSwarm(count) {
  const palette = PALETTES.blue.colors;
  const cx = _viewport.width * 0.5;
  const cy = _viewport.height * 0.5;

  for (let i = 0; i < count; i++) {
    const color = palette[Math.floor(Math.random() * palette.length)];
    const x = cx + (Math.random() - 0.5) * (_viewport.width * 0.7);
    const y = cy + (Math.random() - 0.5) * (_viewport.height * 0.7);

    const heading = Math.random() * Math.PI * 2;
    const speed   = 70 + Math.random() * 80;

    _world.createEntity(entity => {
      entity
        .add(new TransformComponent(x, y, heading, 0.95))
        .add(new KinematicsComponent({
          maxSpeed: 180 + Math.random() * 30,
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
          health:    50,
          maxHealth: 50,
        }));

      const kin = entity.get(KinematicsComponent);
      kin.velocity.set(Math.cos(heading) * speed, Math.sin(heading) * speed);
    });

    _blueCount++;
  }
}

function spawnCrimsonHunters(count) {
  const palette = PALETTES.crimson.colors;

  for (let i = 0; i < count; i++) {
    const color = palette[Math.floor(Math.random() * palette.length)];
    const side = Math.floor(Math.random() * 4);
    let x = 0, y = 0;
    if (side === 0)      { x = Math.random() * _viewport.width; y = 20; }
    else if (side === 1) { x = _viewport.width - 20; y = Math.random() * _viewport.height; }
    else if (side === 2) { x = Math.random() * _viewport.width; y = _viewport.height - 20; }
    else                 { x = 20; y = Math.random() * _viewport.height; }

    const heading = Math.random() * Math.PI * 2;
    const speed   = 90 + Math.random() * 65;

    _world.createEntity(entity => {
      entity
        .add(new TransformComponent(x, y, heading, 1.15))
        .add(new KinematicsComponent({
          maxSpeed: 200 + Math.random() * 25,
          maxForce: 250,
          drag:     0.98,
        }))
        .add(new RenderComponent({
          shape: 'spiked_diamond',
          size:  7 + Math.random() * 2.5,
          color,
          glow:  15,
        }))
        .add(new ColliderComponent({
          shape: new CircleCollider({ radius: 8.5 }),
          layer: 0x02,
          mask:  0xFF,
        }))
        .add(new RigidBodyComponent({
          mass:        1.8,
          restitution: 0.5,
          friction:    0.2,
        }))
        .add(new BoidComponent({
          flockType:        'crimson',
          perceptionRadius: 160,
          separationRadius: 42,
          maxForce:         240,
          maxSpeed:         195,
        }))
        .add(new CombatStateComponent({
          health:    110,
          maxHealth: 110,
        }))
        .add(new WeaponComponent({
          fireRate:        0.9,
          projectileSpeed: 260,
          damage:          15,
          ttl:             2.0,
          color:           '#ff2d55',
        }));

      const kin = entity.get(KinematicsComponent);
      kin.velocity.set(Math.cos(heading) * speed, Math.sin(heading) * speed);
    });

    _crimsonCount++;
  }
}

// ─────────────────────────────────────────────────────────────
//  Flight Mode & Pause Toggles
// ─────────────────────────────────────────────────────────────

function toggleFlightMode() {
  if (!_flagshipEntity) return;
  const ctrl = _flagshipEntity.get(PlayerControllerComponent);
  if (!ctrl) return;

  ctrl.isManualControlled = !ctrl.isManualControlled;
  console.info(`[NovaPulse] Mode Switched → ${ctrl.isManualControlled ? 'MANUAL PILOT' : 'AUTO SWARM'}`);
}

function togglePause() {
  if (_isPaused) {
    _loop.resume();
    _isPaused = false;
    $pauseBadge.classList.remove('visible');
  } else {
    _loop.pause();
    _isPaused = true;
    $pauseBadge.classList.add('visible');
  }
}

// ─────────────────────────────────────────────────────────────
//  Keyboard Hotkey Listeners
// ─────────────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if (e.target !== document.body && e.target !== document.documentElement) return;

  switch (e.code) {
    case 'KeyP': {
      e.preventDefault();
      togglePause();
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
//  Debug API Exposure
// ─────────────────────────────────────────────────────────────

function attachDebugAPI() {
  window.__NOVAPULSE__ = {
    version:           '4.0.0',
    phase:             4,
    get loop()         { return _loop; },
    get world()        { return _world; },
    get viewport()     { return _viewport; },
    get flagship()     { return _flagshipEntity; },
    get projectilePool() { return _projectilePool; },
    get particlePool()   { return _particlePool; },
    get soundSynth()     { return _soundSynth; },
    get combatSystem()   { return _combatSystem; },

    toggleFlightMode,
    togglePause,
    toggleMute: () => _soundSynth?.toggleMute(),
    toggleWireframe: () => {
      _debugWireframe = !_debugWireframe;
      _renderSystem.debugWireframe = _debugWireframe;
    },

    spawnBlue: (n = 10) => spawnBlueSwarm(n),
    spawnCrimson: (n = 3) => spawnCrimsonHunters(n),

    stats: () => ({
      fps:         _loop?.fps,
      entities:    _world?.entityCount,
      projectiles: _projectilePool?.activeCount,
      particles:   _particlePool?.activeCount,
      destroyed:   _combatSystem?.enemiesDestroyed,
      isMuted:     _soundSynth?.isMuted,
      isManual:    _flagshipEntity?.get(PlayerControllerComponent)?.isManualControlled,
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
