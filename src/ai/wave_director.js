/**
 * @file wave_director.js
 * @description Procedural survival wave director for NovaPulse Phase 5.
 *
 * Wave Schedule:
 *  - Wave 1: "The Gathering"       (150 Blue, 10 Crimson, Threat: 1.0x)
 *  - Wave 2: "Predator Surge"      (250 Blue, 25 Crimson, 2 Laser Gates, Threat: 1.5x)
 *  - Wave 3: "Gravity Storm"       (350 Blue, 35 Crimson, Central Black Hole, 6 Mines, Threat: 2.0x)
 *  - Wave 4: "Dreadnought Incursion" (500+ Swarm, Heavy Crimson Boss Dreadnought, Threat: 3.0x)
 */

export const WAVE_CONFIGS = [
  {
    wave: 1,
    title: 'THE GATHERING',
    blueCount: 150,
    crimsonCount: 10,
    duration: 35, // seconds
    threatMultiplier: 1.0,
    hazards: { laserGates: 0, blackHole: false, mines: 0, boss: false },
    announcement: 'WAVE 1: THE GATHERING — SURVIVE THE INITIAL SWARM',
  },
  {
    wave: 2,
    title: 'PREDATOR SURGE',
    blueCount: 250,
    crimsonCount: 25,
    duration: 45,
    threatMultiplier: 1.5,
    hazards: { laserGates: 2, blackHole: false, mines: 0, boss: false },
    announcement: 'WAVE 2: PREDATOR SURGE — ROTATING LASER GATES ONLINE',
  },
  {
    wave: 3,
    title: 'GRAVITY STORM',
    blueCount: 350,
    crimsonCount: 35,
    duration: 55,
    threatMultiplier: 2.0,
    hazards: { laserGates: 1, blackHole: true, mines: 6, boss: false },
    announcement: 'WAVE 3: GRAVITY STORM — BLACK HOLE & MINES DETECTED',
  },
  {
    wave: 4,
    title: 'DREADNOUGHT INCURSION',
    blueCount: 500,
    crimsonCount: 45,
    duration: 90,
    threatMultiplier: 3.0,
    hazards: { laserGates: 2, blackHole: true, mines: 8, boss: true },
    announcement: 'WAVE 4: DREADNOUGHT INCURSION — ELIMINATE THE CRIMSON FLAGSHIP',
  },
];

export class WaveDirector {
  /**
   * @param {object} opts
   * @param {import('../core/events.js').EventBus} opts.bus
   * @param {function(object): void} opts.onSpawnWave - Callback when a wave begins
   */
  constructor({ bus, onSpawnWave }) {
    this.bus         = bus;
    this.onSpawnWave = onSpawnWave;

    this.currentWaveIndex = 0;
    this.state            = 'intermission'; // 'intermission' | 'active' | 'victory' | 'game_over'
    this.intermissionTime = 4.0;            // seconds between waves
    this.timer            = this.intermissionTime;
    this.timeAlive        = 0;
    this.survivalScore    = 0;
    this.announcement     = WAVE_CONFIGS[0].announcement;
    this.announcementAlpha = 1.0;
    this.bossDefeated     = false;
    this.peakSwarmCount   = 0;
  }

  get currentConfig() {
    return WAVE_CONFIGS[Math.min(this.currentWaveIndex, WAVE_CONFIGS.length - 1)];
  }

  get waveNumber() {
    return this.currentWaveIndex + 1;
  }

  get isFinalWave() {
    return this.currentWaveIndex === WAVE_CONFIGS.length - 1;
  }

  start() {
    this.currentWaveIndex  = 0;
    this.state             = 'intermission';
    this.timer             = this.intermissionTime;
    this.timeAlive         = 0;
    this.survivalScore     = 0;
    this.bossDefeated      = false;
    this.announcement      = WAVE_CONFIGS[0].announcement;
    this.announcementAlpha = 1.0;
  }

  triggerVictory() {
    this.state = 'victory';
    this.announcement = 'MISSION ACCOMPLISHED — ALL THREATS NEUTRALIZED';
    if (this.bus) this.bus.emit('wave:victory', { score: this.survivalScore, timeAlive: this.timeAlive });
  }

  triggerGameOver() {
    this.state = 'game_over';
    this.announcement = 'CRITICAL FAILURE — FLAGSHIP DESTROYED';
    if (this.bus) this.bus.emit('wave:gameOver', { score: this.survivalScore, timeAlive: this.timeAlive });
  }

  onEnemyKilled(isBoss = false) {
    const pts = isBoss ? 5000 : 150 * this.currentConfig.threatMultiplier;
    this.survivalScore += Math.round(pts);

    if (isBoss) {
      this.bossDefeated = true;
      this.triggerVictory();
    }
  }

  update(dt, currentEntityCount = 0) {
    if (this.state === 'victory' || this.state === 'game_over') return;

    this.timeAlive += dt;
    this.survivalScore += Math.round(dt * 20 * this.currentConfig.threatMultiplier);

    if (currentEntityCount > this.peakSwarmCount) {
      this.peakSwarmCount = currentEntityCount;
    }

    if (this.announcementAlpha > 0) {
      this.announcementAlpha = Math.max(0, this.announcementAlpha - dt * 0.35);
    }

    if (this.state === 'intermission') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this._startWave();
      }
    } else if (this.state === 'active') {
      this.timer -= dt;

      // Check wave completion criteria
      if (this.timer <= 0) {
        if (this.isFinalWave) {
          // In Wave 4, must defeat the boss
          if (this.bossDefeated) {
            this.triggerVictory();
          }
        } else {
          // Advance to next wave intermission
          this._advanceWave();
        }
      }
    }
  }

  _startWave() {
    this.state = 'active';
    const cfg = this.currentConfig;
    this.timer = cfg.duration;
    this.announcement = `${cfg.title} — SURVIVE ${cfg.duration}s`;
    this.announcementAlpha = 1.0;

    if (this.onSpawnWave) {
      this.onSpawnWave(cfg);
    }

    if (this.bus) {
      this.bus.emit('wave:started', { wave: this.waveNumber, config: cfg });
    }
  }

  _advanceWave() {
    this.currentWaveIndex++;
    if (this.currentWaveIndex >= WAVE_CONFIGS.length) {
      this.triggerVictory();
      return;
    }

    this.state = 'intermission';
    this.timer = this.intermissionTime;
    const nextCfg = this.currentConfig;
    this.announcement = nextCfg.announcement;
    this.announcementAlpha = 1.0;

    if (this.bus) {
      this.bus.emit('wave:intermission', { nextWave: this.waveNumber, config: nextCfg });
    }
  }
}
