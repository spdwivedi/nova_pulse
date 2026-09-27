/**
 * @file main.js
 * @description NovaPulse Phase 5 entrypoint.
 *
 * Features:
 *  - Dynamic Arena Hazards (Quantum Black Hole, Pulsing Laser Gates, Kinetic Mines)
 *  - Procedural Wave Director (4 Waves: The Gathering, Predator Surge, Gravity Storm, Dreadnought Incursion)
 *  - Crimson Dreadnought Heavy Boss Encounter (1500 HP, 5-Way Turret Salvos)
 *  - Hardware Telemetry Suite (CPU physics tick ms, GPU raster ms, frame delta ms, FPS, glowing status)
 *  - Stress-Test Benchmarks (±100 swarm scaling, GPU Glow toggle, Nova Bomb explosion burst)
 *  - Victory & Defeat Mission Modals with statistical summary and immediate redeployment
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
import {
  ArenaManager,
  PulsingLaserGate,
  QuantumBlackHole,
  KineticMine,
}                              from './environment/arena.js';
import {
  WaveDirector,
  WAVE_CONFIGS,
}                              from './ai/wave_director.js';

// ─────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────

const TRAIL_ALPHA = 0.22;
const CELL_SIZE   = 56;

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
//  DOM References
// ─────────────────────────────────────────────────────────────

const $modeBadge      = document.getElementById('hud-mode-badge');
const $waveTitle      = document.getElementById('hud-wave-title');
const $waveTimer      = document.getElementById('hud-wave-timer');
const $score          = document.getElementById('hud-score');
const $waveBanner     = document.getElementById('wave-banner');
const $bannerText     = document.getElementById('banner-text');

const $hpVal          = document.getElementById('hud-hp-val');
const $hpBar          = document.getElementById('hud-hp-bar');
const $energyVal      = document.getElementById('hud-energy-val');
const $energyBar      = document.getElementById('hud-energy-bar');
const $heatVal        = document.getElementById('hud-heat-val');
const $heatBar        = document.getElementById('hud-heat-bar');

const $fps            = document.getElementById('hud-fps');
const $tickMs         = document.getElementById('hud-tick-ms');
const $renderMs       = document.getElementById('hud-render-ms');
const $frameMs        = document.getElementById('hud-frame-ms');
const $entitiesCap    = document.getElementById('hud-entities-cap');
const $gpuStatus      = document.getElementById('hud-gpu-status');
const $pauseBadge     = document.getElementById('pause-badge');

const $gameModal      = document.getElementById('game-modal');
const $modalCard      = document.getElementById('modal-card');
const $modalTitle     = document.getElementById('modal-title');
const $modalSub       = document.getElementById('modal-sub');
const $modalScore     = document.getElementById('modal-score');
const $modalDestroyed = document.getElementById('modal-destroyed');
const $modalPeak      = document.getElementById('modal-peak');
const $modalFps       = document.getElementById('modal-fps');
const $modalTime      = document.getElementById('modal-time');
const $modalRestartBtn= document.getElementById('modal-restart-btn');

// ─────────────────────────────────────────────────────────────
//  Simulation State
// ─────────────────────────────────────────────────────────────

let _loop, _world, _viewport, _bus;
let _projectilePool, _particlePool, _soundSynth;
let _collisionSystem, _renderSystem, _boundarySystem, _boidSystem, _playerInputSystem, _combatSystem;
let _arenaManager, _waveDirector;

let _flagshipEntity = null;
let _blueCount = 0;
let _crimsonCount = 0;
let _scatterCount = 0;
let _isPaused = false;
let _debugWireframe = false;

// ─────────────────────────────────────────────────────────────
//  Bootstrap & Initialization
// ─────────────────────────────────────────────────────────────

function init() {
  // ── 1. Core Subsystems ────────────────────────────────────
  _bus            = new EventBus();
  const canvas    = document.getElementById('sim-canvas');
  _viewport       = new Viewport(canvas, _bus);
  _world          = new World();

  _projectilePool = new ProjectilePool(450);
  _particlePool   = new ParticlePool(900);
  _soundSynth     = new SoundSynth();

  _arenaManager   = new ArenaManager({
    width:  _viewport.width,
    height: _viewport.height,
  });

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

  // ── 3. Wave Director ──────────────────────────────────────
  _waveDirector = new WaveDirector({
    bus: _bus,
    onSpawnWave: handleSpawnWave,
  });

  // ── 4. Spawning ───────────────────────────────────────────
  _blueCount    = 0;
  _crimsonCount = 0;
  _scatterCount = 0;

  spawnFlagship();
  _waveDirector.start();

  // ── 5. Event Subscriptions ────────────────────────────────
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

  _bus.on('entity:destroyed', ({ killerTeam, isBoss }) => {
    if (isBoss) {
      _waveDirector.onEnemyKilled(true);
    } else if (killerTeam === 'blue') {
      _crimsonCount = Math.max(0, _crimsonCount - 1);
      _waveDirector.onEnemyKilled(false);
      // Auto-replenish hunter periodically in early waves
      if (_crimsonCount < 6 && _waveDirector.state === 'active') {
        setTimeout(() => {
          if (_world && _waveDirector.state === 'active') {
            spawnCrimsonHunters(1);
          }
        }, 3000);
      }
    } else {
      _blueCount = Math.max(0, _blueCount - 1);
    }
  });

  _bus.on('player:modeToggle', () => {
    toggleFlightMode();
  });

  _bus.on('wave:victory', () => {
    showMissionModal(true);
  });

  _bus.on('wave:gameOver', () => {
    showMissionModal(false);
  });

  // ── 6. Game Loop ──────────────────────────────────────────
  _loop = new GameLoop({
    fixedUpdate(dt) {
      // 1. Advance ECS world simulation
      _world.fixedUpdate(dt);

      // 2. Advance Dynamic Arena Hazards
      const activeEntities = _world.query([TransformComponent, CombatStateComponent]);
      _arenaManager.update(dt, activeEntities, _particlePool, _soundSynth, _world);

      // 3. Advance Wave Director
      _waveDirector.update(dt, _world.entityCount);

      // 4. Verify Flagship Survivability
      if (_flagshipEntity) {
        const combat = _flagshipEntity.get(CombatStateComponent);
        if (_flagshipEntity.destroyed || (combat && combat.health <= 0)) {
          if (_waveDirector.state !== 'game_over' && _waveDirector.state !== 'victory') {
            _particlePool.emitExplosion(
              _flagshipEntity.get(TransformComponent)?.position.x || _viewport.width * 0.5,
              _flagshipEntity.get(TransformComponent)?.position.y || _viewport.height * 0.5,
              64,
              '#00ffe7'
            );
            _soundSynth.playExplosion(0.8);
            _waveDirector.triggerGameOver();
          }
        }
      }
    },
    update(_dt, _alpha) {
      updateHUD();
    },
    render(alpha) {
      _viewport.trail(TRAIL_ALPHA);
      _arenaManager.render(_viewport.ctx);
      _world.render(_viewport.ctx, alpha);
    },
  });

  // ── 7. Resize ─────────────────────────────────────────────
  _bus.on('viewport:resize', () => {
    _boundarySystem.viewport = _viewport;
    _renderSystem.viewport   = _viewport;
    _arenaManager.setDimensions(_viewport.width, _viewport.height);
  });

  // ── 8. Start ──────────────────────────────────────────────
  _loop.start();
  _isPaused = false;
  if ($gameModal) $gameModal.classList.remove('visible');

  console.info(
    '%c⚡ NovaPulse v5.0 Phase 5 Initialized',
    'color:#00ffe7;font-weight:bold;font-size:13px;',
    '\n  [Mouse / Space] Dual Plasma Cannons · [WASD] Inertial Thrusters',
    '\n  [M] Manual Pilot · [X] Sound FX · [G] GPU Glow · [K] Nova Bomb',
    '\n  [+] Spawn +100 · [-] Despawn 100 · [P] Pause · [B] Wireframe · [R] Reset'
  );
}

// ─────────────────────────────────────────────────────────────
//  Wave Spawning Handler
// ─────────────────────────────────────────────────────────────

function handleSpawnWave(cfg) {
  // 1. Clear previous hazards
  _arenaManager.clearHazards();

  const w = _viewport.width;
  const h = _viewport.height;

  // 2. Setup hazards according to wave configuration
  if (cfg.hazards.laserGates > 0) {
    if (cfg.hazards.laserGates === 1) {
      _arenaManager.addLaserGate(new PulsingLaserGate({
        centerX:      w * 0.5,
        centerY:      h * 0.5,
        length:       Math.min(w, h) * 0.35,
        angularSpeed: 0.65,
        damage:       130,
        color:        '#ff0055',
      }));
    } else {
      _arenaManager.addLaserGate(new PulsingLaserGate({
        centerX:      w * 0.35,
        centerY:      h * 0.35,
        length:       Math.min(w, h) * 0.32,
        angularSpeed: 0.75,
        damage:       120,
        color:        '#ff0055',
      }));
      _arenaManager.addLaserGate(new PulsingLaserGate({
        centerX:      w * 0.65,
        centerY:      h * 0.65,
        length:       Math.min(w, h) * 0.32,
        angularSpeed: -0.75,
        damage:       120,
        color:        '#00ffe7',
      }));
    }
  }

  if (cfg.hazards.blackHole) {
    _arenaManager.setBlackHole(new QuantumBlackHole({
      centerX:       w * 0.5,
      centerY:       h * 0.5,
      mass:          195000,
      eventHorizon:  34,
      gravityRadius: Math.min(w, h) * 0.46,
    }));
  }

  if (cfg.hazards.mines > 0) {
    const cx = w * 0.5;
    const cy = h * 0.5;
    const margin = 100;

    for (let i = 0; i < cfg.hazards.mines; i++) {
      const angle = (i / cfg.hazards.mines) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const dist  = 130 + Math.random() * (Math.min(w, h) * 0.34);
      const mx    = cx + Math.cos(angle) * dist;
      const my    = cy + Math.sin(angle) * dist;

      _arenaManager.addMine(new KineticMine({
        x:             Math.max(margin, Math.min(w - margin, mx)),
        y:             Math.max(margin, Math.min(h - margin, my)),
        triggerRadius: 50,
        blastRadius:   95,
        damage:        85,
      }));
    }
  }

  // 3. Clear non-flagship entities to guarantee accurate wave quotas
  clearNonFlagshipEntities();

  // 4. Spawn swarm units
  spawnBlueSwarm(cfg.blueCount);
  spawnCrimsonHunters(cfg.crimsonCount);

  // 5. Boss spawn for Wave 4
  if (cfg.hazards.boss) {
    spawnBossDreadnought();
  }

  // 6. Sound synth acoustic alert
  if (_soundSynth) {
    _soundSynth.playLaser(220, 80);
  }
}

function clearNonFlagshipEntities() {
  const allBoids = _world.query([BoidComponent]);
  for (let i = 0; i < allBoids.length; i++) {
    const e = allBoids[i];
    if (e !== _flagshipEntity) {
      _world.destroyEntity(e);
    }
  }
  _blueCount = 0;
  _crimsonCount = 0;
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

function spawnBossDreadnought() {
  const cx = _viewport.width * 0.5;
  const cy = 55;

  _world.createEntity(entity => {
    entity.isBoss = true;
    entity
      .add(new TransformComponent(cx, cy, Math.PI * 0.5, 2.0))
      .add(new KinematicsComponent({
        maxSpeed: 95,
        maxForce: 170,
        drag:     0.97,
      }))
      .add(new RenderComponent({
        shape: 'dreadnought',
        size:  24,
        color: '#ff0055',
        glow:  28,
      }))
      .add(new ColliderComponent({
        shape: new CircleCollider({ radius: 28 }),
        layer: 0x02,
        mask:  0xFF,
      }))
      .add(new RigidBodyComponent({
        mass:        14.0,
        restitution: 0.35,
        friction:    0.25,
      }))
      .add(new BoidComponent({
        flockType:        'crimson',
        perceptionRadius: 280,
        separationRadius: 75,
        maxForce:         180,
        maxSpeed:         90,
      }))
      .add(new CombatStateComponent({
        health:    1500,
        maxHealth: 1500,
      }))
      .add(new WeaponComponent({
        fireRate:        0.8,
        projectileSpeed: 290,
        damage:          25,
        ttl:             3.2,
        color:           '#ff0055',
      }));

    const kin = entity.get(KinematicsComponent);
    kin.velocity.set(0, 35);
  });
}

function despawnSwarm(count = 100) {
  const blueBoids = _world.query([BoidComponent]).filter(
    e => e !== _flagshipEntity && e.get(BoidComponent).flockType === 'blue'
  );
  const toRemove = Math.min(count, Math.max(0, blueBoids.length - 50));
  for (let i = 0; i < toRemove; i++) {
    _world.destroyEntity(blueBoids[i]);
    _blueCount = Math.max(0, _blueCount - 1);
  }
}

function triggerNovaBomb() {
  const cx = _viewport.width * 0.5;
  const cy = _viewport.height * 0.5;

  _particlePool.emitExplosion(cx, cy, 140, '#00ffe7');
  _particlePool.emitExplosion(cx, cy, 140, '#ff2d55');
  _particlePool.emitExplosion(cx, cy, 120, '#ffc400');
  _particlePool.emitExplosion(cx, cy, 60,  '#ffffff');

  if (_soundSynth) {
    _soundSynth.playExplosion(0.9);
  }

  // Radial kinetic and damage shockwave
  const enemies = _world.query([TransformComponent, CombatStateComponent]).filter(e => e !== _flagshipEntity);
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    const combat = e.get(CombatStateComponent);
    if (combat) combat.takeDamage(120);

    const tf = e.get(TransformComponent);
    const kin = e.get(KinematicsComponent);
    if (tf && kin) {
      const dx = tf.position.x - cx;
      const dy = tf.position.y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      kin.velocity.x += (dx / dist) * 220;
      kin.velocity.y += (dy / dist) * 220;
    }
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
    if ($pauseBadge) $pauseBadge.classList.remove('visible');
  } else {
    _loop.pause();
    _isPaused = true;
    if ($pauseBadge) $pauseBadge.classList.add('visible');
  }
}

function showMissionModal(isVictory) {
  if (!$gameModal) return;

  $gameModal.classList.add('visible');

  if (isVictory) {
    if ($modalCard) $modalCard.className = 'modal-card';
    if ($modalTitle) $modalTitle.textContent = 'MISSION ACCOMPLISHED';
    if ($modalSub) $modalSub.textContent = 'ALL THREATS AND BOSS DREADNOUGHT NEUTRALIZED';
  } else {
    if ($modalCard) $modalCard.className = 'modal-card game-over';
    if ($modalTitle) $modalTitle.textContent = 'CRITICAL FAILURE';
    if ($modalSub) $modalSub.textContent = 'FLAGSHIP DESTROYED — DEFENSES BREACHED';
  }

  if ($modalScore)     $modalScore.textContent     = _waveDirector.survivalScore;
  if ($modalDestroyed) $modalDestroyed.textContent = _combatSystem.enemiesDestroyed;
  if ($modalPeak)      $modalPeak.textContent      = _waveDirector.peakSwarmCount;
  if ($modalFps)       $modalFps.textContent       = _loop.fps.toFixed(1);
  if ($modalTime)      $modalTime.textContent      = formatTime(_waveDirector.timeAlive);
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function restartSimulation() {
  if ($gameModal) $gameModal.classList.remove('visible');
  _loop.stop();
  if (_playerInputSystem) _playerInputSystem.destroy();
  _world = new World();
  init();
}

if ($modalRestartBtn) {
  $modalRestartBtn.addEventListener('click', restartSimulation);
}

// ─────────────────────────────────────────────────────────────
//  HUD Telemetry Updates
// ─────────────────────────────────────────────────────────────

let _hudSkip = 0;

function updateHUD() {
  if (++_hudSkip % 2 !== 0) return;

  // 1. Mission Wave Status
  if ($waveTitle) {
    $waveTitle.textContent = `${_waveDirector.waveNumber}: ${_waveDirector.currentConfig.title}`;
  }

  if ($waveTimer) {
    if (_waveDirector.state === 'intermission') {
      $waveTimer.textContent = `INCOMING (${Math.max(0, Math.ceil(_waveDirector.timer))}s)`;
      $waveTimer.className = 'val amber';
    } else if (_waveDirector.state === 'active') {
      $waveTimer.textContent = `${Math.max(0, _waveDirector.timer).toFixed(1)}s`;
      $waveTimer.className = 'val green';
    } else if (_waveDirector.state === 'victory') {
      $waveTimer.textContent = 'VICTORY';
      $waveTimer.className = 'val cyan';
    } else if (_waveDirector.state === 'game_over') {
      $waveTimer.textContent = 'DEFEATED';
      $waveTimer.className = 'val crimson';
    }
  }

  if ($score) {
    $score.textContent = _waveDirector.survivalScore;
  }

  // 2. Banner Text
  if ($bannerText && $waveBanner) {
    $bannerText.textContent = _waveDirector.announcement;
    $waveBanner.style.opacity = Math.max(0, Math.min(1, _waveDirector.announcementAlpha)).toFixed(2);
  }

  // 3. Mode Badge
  if ($modeBadge) {
    const ctrl = _flagshipEntity?.get(PlayerControllerComponent);
    const isManual = ctrl ? ctrl.isManualControlled : false;
    if (isManual) {
      $modeBadge.textContent = '[MANUAL PILOT ACTIVE]';
      $modeBadge.className   = 'mode-badge manual';
    } else {
      $modeBadge.textContent = '[AUTO SWARM SIMULATION]';
      $modeBadge.className   = 'mode-badge auto';
    }
  }

  // 4. Flagship Status Bars
  const combat = _flagshipEntity?.get(CombatStateComponent);
  if (combat) {
    const hpPct = Math.max(0, Math.round((combat.health / combat.maxHealth) * 100));
    if ($hpVal) $hpVal.textContent = `${hpPct}%`;
    if ($hpBar) $hpBar.style.width = `${hpPct}%`;
    if ($energyVal) $energyVal.textContent = `${Math.round(combat.energy)}%`;
    if ($energyBar) $energyBar.style.width = `${Math.round(combat.energy)}%`;
  }

  const weapon = _flagshipEntity?.get(WeaponComponent);
  if (weapon) {
    const heatPct = Math.round((weapon.heat / weapon.maxHeat) * 100);
    if ($heatVal) {
      $heatVal.textContent = weapon.isOverheated ? 'OVERHEATED!' : `${heatPct}%`;
      $heatVal.className   = weapon.isOverheated ? 'val crimson' : 'val amber';
    }
    if ($heatBar) {
      $heatBar.style.width = `${heatPct}%`;
      $heatBar.className   = weapon.isOverheated ? 'bar-fill heat overheated' : 'bar-fill heat';
    }
  }

  // 5. Hardware Profiler Telemetry
  if ($fps)         $fps.textContent         = _loop.fps.toFixed(1);
  if ($tickMs)      $tickMs.textContent      = `${_loop.physicsTimeMs.toFixed(2)} ms`;
  if ($renderMs)    $renderMs.textContent    = `${_loop.renderTimeMs.toFixed(2)} ms`;
  if ($frameMs)     $frameMs.textContent     = `${_loop.frameTimeMs.toFixed(2)} ms`;
  if ($entitiesCap) $entitiesCap.textContent  = `${_world.entityCount} [P:${_projectilePool.activeCount} FX:${_particlePool.activeCount}]`;
  if ($gpuStatus) {
    $gpuStatus.textContent = _renderSystem.enableGlow ? '[GLOW: HIGH]' : '[GLOW: OFF]';
    $gpuStatus.className   = _renderSystem.enableGlow ? 'val purple' : 'val dim';
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

    case 'KeyG': {
      _renderSystem.enableGlow = !_renderSystem.enableGlow;
      if ($gpuStatus) {
        $gpuStatus.textContent = _renderSystem.enableGlow ? '[GLOW: HIGH]' : '[GLOW: OFF]';
        $gpuStatus.className   = _renderSystem.enableGlow ? 'val purple' : 'val dim';
      }
      console.info(`[NovaPulse] GPU Glow: ${_renderSystem.enableGlow ? 'ON' : 'OFF'}`);
      break;
    }

    case 'KeyK': {
      triggerNovaBomb();
      console.info('[NovaPulse] Nova Bomb Detonated!');
      break;
    }

    case 'Equal':
    case 'NumpadAdd': {
      spawnBlueSwarm(100);
      console.info(`[NovaPulse] Spawned +100 Units (Total Entities: ${_world.entityCount})`);
      break;
    }

    case 'Minus':
    case 'NumpadSubtract': {
      despawnSwarm(100);
      console.info(`[NovaPulse] Despawned 100 Units (Total Entities: ${_world.entityCount})`);
      break;
    }

    case 'Enter': {
      if (($gameModal && $gameModal.classList.contains('visible')) ||
          _waveDirector.state === 'game_over' ||
          _waveDirector.state === 'victory') {
        restartSimulation();
      }
      break;
    }

    case 'KeyR': {
      restartSimulation();
      break;
    }
  }
});

// ─────────────────────────────────────────────────────────────
//  Debug API Exposure
// ─────────────────────────────────────────────────────────────

function attachDebugAPI() {
  window.__NOVAPULSE__ = {
    version:           '5.0.0',
    phase:             5,
    get loop()         { return _loop; },
    get world()        { return _world; },
    get viewport()     { return _viewport; },
    get flagship()     { return _flagshipEntity; },
    get projectilePool() { return _projectilePool; },
    get particlePool()   { return _particlePool; },
    get soundSynth()     { return _soundSynth; },
    get combatSystem()   { return _combatSystem; },
    get arenaManager()   { return _arenaManager; },
    get waveDirector()   { return _waveDirector; },

    toggleFlightMode,
    togglePause,
    toggleGlow: () => {
      _renderSystem.enableGlow = !_renderSystem.enableGlow;
      return _renderSystem.enableGlow;
    },
    triggerNovaBomb,
    toggleMute: () => _soundSynth?.toggleMute(),
    toggleWireframe: () => {
      _debugWireframe = !_debugWireframe;
      _renderSystem.debugWireframe = _debugWireframe;
    },

    spawnBlue: (n = 10) => spawnBlueSwarm(n),
    spawnCrimson: (n = 3) => spawnCrimsonHunters(n),
    despawnSwarm,
    restart: restartSimulation,

    stats: () => ({
      fps:         _loop?.fps,
      physicsMs:   _loop?.physicsTimeMs,
      renderMs:    _loop?.renderTimeMs,
      frameMs:     _loop?.frameTimeMs,
      wave:        _waveDirector?.waveNumber,
      score:       _waveDirector?.survivalScore,
      entities:    _world?.entityCount,
      projectiles: _projectilePool?.activeCount,
      particles:   _particlePool?.activeCount,
      destroyed:   _combatSystem?.enemiesDestroyed,
      isMuted:     _soundSynth?.isMuted,
      glow:        _renderSystem?.enableGlow,
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
