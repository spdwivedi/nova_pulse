/**
 * @file weapons.js
 * @description Weapon firing behaviors for Player Cannon & Crimson Hunter Spores.
 */

import { Vec2 } from '../core/math.js';

const _dir = new Vec2();
const _perp = new Vec2();

/**
 * Fire dual-barrel plasma cannons from the Flagship/Player ship.
 *
 * @param {object} transform - TransformComponent of shooter
 * @param {object} weapon - WeaponComponent of shooter
 * @param {Vec2} targetPos - Target position (crosshair)
 * @param {import('./projectile_pool.js').ProjectilePool} pool
 * @param {import('../fx/particle_pool.js').ParticlePool} [fx]
 * @param {import('../audio/sound_synth.js').SoundSynth} [audio]
 * @returns {boolean} true if fired, false if on cooldown or overheated
 */
export function firePlayerCannon(transform, weapon, targetPos, pool, fx = null, audio = null) {
  if (weapon.cooldown > 0 || weapon.isOverheated) return false;

  const posX = transform.position.x;
  const posY = transform.position.y;
  const heading = transform.rotation;

  // Direction towards crosshair or along heading
  let dirX = targetPos ? targetPos.x - posX : Math.cos(heading);
  let dirY = targetPos ? targetPos.y - posY : Math.sin(heading);
  const len = Math.sqrt(dirX * dirX + dirY * dirY);

  if (len > 0.001) {
    dirX /= len;
    dirY /= len;
  } else {
    dirX = Math.cos(heading);
    dirY = Math.sin(heading);
  }

  // Perpendicular vector for dual barrels (-dy, dx)
  const perpX = -dirY;
  const perpY = dirX;
  const barrelOffset = 6 * transform.scale;
  const forwardOffset = 14 * transform.scale;

  const speed = weapon.projectileSpeed || 480;
  const damage = weapon.damage || 25;
  const ttl = weapon.ttl || 1.4;
  const color = weapon.color || '#00ffe7';

  // Barrel 1 (Right)
  const b1X = posX + dirX * forwardOffset + perpX * barrelOffset;
  const b1Y = posY + dirY * forwardOffset + perpY * barrelOffset;
  // Barrel 2 (Left)
  const b2X = posX + dirX * forwardOffset - perpX * barrelOffset;
  const b2Y = posY + dirY * forwardOffset - perpY * barrelOffset;

  // Spread variation
  const spread = (weapon.spread || 0.02) * (Math.random() - 0.5);
  const cosS = Math.cos(spread);
  const sinS = Math.sin(spread);
  const vx = (dirX * cosS - dirY * sinS) * speed;
  const vy = (dirX * sinS + dirY * cosS) * speed;

  // Spawn dual projectiles
  pool.spawn(b1X, b1Y, vx, vy, 'blue', damage, ttl, color, 3.5);
  pool.spawn(b2X, b2Y, vx, vy, 'blue', damage, ttl, color, 3.5);

  // Muzzle flash particles
  if (fx) {
    fx.emitMuzzleFlash(b1X, b1Y, heading, color);
    fx.emitMuzzleFlash(b2X, b2Y, heading, color);
  }

  // Laser chiptune sound
  if (audio) {
    audio.playLaser(920, 240, 0.11);
  }

  // Heat & Cooldown
  weapon.cooldown = 1 / (weapon.fireRate || 7);
  weapon.heat = Math.min(weapon.maxHeat, weapon.heat + weapon.heatPerShot);
  if (weapon.heat >= weapon.maxHeat) {
    weapon.isOverheated = true;
  }

  return true;
}

/**
 * Fire Crimson Hunter seeker spore thorn.
 *
 * @param {object} transform - TransformComponent of hunter
 * @param {object} weapon - WeaponComponent of hunter
 * @param {Vec2} [targetPos] - Position of targeted blue prey
 * @param {import('./projectile_pool.js').ProjectilePool} pool
 * @param {import('../fx/particle_pool.js').ParticlePool} [fx]
 * @param {import('../audio/sound_synth.js').SoundSynth} [audio]
 * @returns {boolean}
 */
export function fireHunterSpore(transform, weapon, targetPos, pool, fx = null, audio = null) {
  if (weapon.cooldown > 0) return false;

  const posX = transform.position.x;
  const posY = transform.position.y;
  let dirX, dirY;

  if (targetPos) {
    dirX = targetPos.x - posX;
    dirY = targetPos.y - posY;
    const len = Math.sqrt(dirX * dirX + dirY * dirY);
    if (len > 0.001) {
      dirX /= len;
      dirY /= len;
    } else {
      dirX = Math.cos(transform.rotation);
      dirY = Math.sin(transform.rotation);
    }
  } else {
    dirX = Math.cos(transform.rotation);
    dirY = Math.sin(transform.rotation);
  }

  const speed = weapon.projectileSpeed || 260;
  const damage = weapon.damage || 14;
  const ttl = weapon.ttl || 1.8;
  const color = '#ff2d55';

  const spawnX = posX + dirX * 10;
  const spawnY = posY + dirY * 10;
  const vx = dirX * speed;
  const vy = dirY * speed;

  pool.spawn(spawnX, spawnY, vx, vy, 'crimson', damage, ttl, color, 3);

  if (fx) {
    fx.emitMuzzleFlash(spawnX, spawnY, Math.atan2(dirY, dirX), color);
  }

  if (audio) {
    audio.playLaser(440, 160, 0.15);
  }

  weapon.cooldown = 1 / (weapon.fireRate || 1.2);
  return true;
}

/**
 * Fire multi-turret spore cannons from the Crimson Boss Dreadnought.
 * Discharges a wide 5-way spread of tracking spores.
 *
 * @param {object} transform
 * @param {object} weapon
 * @param {import('../core/math.js').Vec2} [targetPos]
 * @param {import('./projectile_pool.js').ProjectilePool} pool
 * @param {import('../fx/particle_pool.js').ParticlePool} [fx]
 * @param {import('../audio/sound_synth.js').SoundSynth} [audio]
 * @returns {boolean}
 */
export function fireBossTurrets(transform, weapon, targetPos, pool, fx = null, audio = null) {
  if (weapon.cooldown > 0) return false;

  const posX = transform.position.x;
  const posY = transform.position.y;
  let baseAngle = transform.rotation;

  if (targetPos) {
    baseAngle = Math.atan2(targetPos.y - posY, targetPos.x - posX);
  }

  const speed = weapon.projectileSpeed || 280;
  const damage = weapon.damage || 22;
  const ttl = weapon.ttl || 2.4;
  const color = '#ff0044';
  const angles = [-0.4, -0.2, 0, 0.2, 0.4];

  for (let i = 0; i < angles.length; i++) {
    const a = baseAngle + angles[i];
    const vx = Math.cos(a) * speed;
    const vy = Math.sin(a) * speed;
    const sx = posX + Math.cos(a) * 24;
    const sy = posY + Math.sin(a) * 24;

    pool.spawn(sx, sy, vx, vy, 'crimson', damage, ttl, color, 4.2);

    if (fx && i % 2 === 0) {
      fx.emitMuzzleFlash(sx, sy, a, color);
    }
  }

  if (audio) {
    audio.playLaser(550, 140, 0.22);
  }

  weapon.cooldown = 1 / (weapon.fireRate || 0.65);
  return true;
}

