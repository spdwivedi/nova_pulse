/**
 * @file world.js
 * @description ECS World manager — entity registry, system orchestration,
 *              and bitmask-based archetype queries for NovaPulse.
 *
 * Responsibilities:
 *  - Create / destroy entities.
 *  - Register and tick systems in defined order.
 *  - Query entities matching a component mask (used by systems).
 *  - Flush destroyed entities each frame.
 */

import { Entity, registerComponentType } from './entity.js';

export class World {
  constructor() {
    /** @type {Map<number, Entity>} All live entities keyed by id */
    this._entities = new Map();

    /**
     * Systems are stored as ordered arrays for deterministic tick order.
     * Each system is an object: { mask: number, fixedUpdate?, update?, render? }
     * @type {Array<object>}
     */
    this._systems = [];

    /** Pending entity creations / deletions (processed at flush boundary) */
    this._pendingDestroy = [];
  }

  // ── Entity API ────────────────────────────────────────────

  /**
   * Create and register a new Entity, optionally running a builder callback.
   * @param {function(Entity): void} [builder] - Optional setup callback
   * @returns {Entity}
   */
  createEntity(builder) {
    const entity = new Entity();
    this._entities.set(entity.id, entity);
    if (typeof builder === 'function') builder(entity);
    return entity;
  }

  /**
   * Mark an entity for removal. It will be removed at the next `flush()`.
   * @param {Entity|number} entityOrId
   */
  destroyEntity(entityOrId) {
    const id = typeof entityOrId === 'number' ? entityOrId : entityOrId.id;
    const entity = this._entities.get(id);
    if (entity) {
      entity.destroyed = true;
      this._pendingDestroy.push(id);
    }
  }

  /**
   * Immediately remove all entities marked as destroyed.
   * Called automatically at the start of each `fixedUpdate`.
   */
  flush() {
    for (const id of this._pendingDestroy) {
      this._entities.delete(id);
    }
    this._pendingDestroy.length = 0;
  }

  /**
   * Look up a live entity by numeric id.
   * @param {number} id
   * @returns {Entity | undefined}
   */
  getEntity(id) {
    return this._entities.get(id);
  }

  /** Total count of live entities. */
  get entityCount() {
    return this._entities.size;
  }

  // ── System registration ───────────────────────────────────

  /**
   * Register a system.
   *
   * A system is a plain object (or class instance) with:
   *  - `componentTypes` {Function[]} — which component classes it queries
   *  - optional `fixedUpdate(entities, dt, world)` — called each physics tick
   *  - optional `update(entities, dt, alpha, world)` — called each render frame
   *  - optional `render(entities, ctx, alpha, world)` — called each render frame
   *
   * @param {object} system
   * @returns {this}
   */
  addSystem(system) {
    // Build the required bitmask from the system's declared component types
    let mask = 0;
    if (Array.isArray(system.componentTypes)) {
      for (const cls of system.componentTypes) {
        mask |= registerComponentType(cls);
      }
    }
    this._systems.push({ system, mask });
    return this;
  }

  // ── Query ─────────────────────────────────────────────────

  /**
   * Return all live entities matching a bitmask.
   * Called internally by the tick methods; exposed for system use.
   *
   * @param {number} mask
   * @returns {Entity[]}
   */
  query(mask) {
    const result = [];
    for (const entity of this._entities.values()) {
      if (!entity.destroyed && entity.matchesMask(mask)) {
        result.push(entity);
      }
    }
    return result;
  }

  // ── Orchestration ticks ───────────────────────────────────

  /**
   * Fixed-timestep update — called by GameLoop at 60 Hz.
   * Flushes destroyed entities, then runs each system's `fixedUpdate`.
   *
   * @param {number} dt - Fixed step in seconds (1/60)
   */
  fixedUpdate(dt) {
    this.flush();
    for (const { system, mask } of this._systems) {
      if (typeof system.fixedUpdate === 'function') {
        const entities = this.query(mask);
        system.fixedUpdate(entities, dt, this);
      }
    }
  }

  /**
   * Variable-rate frame update — called by GameLoop each RAF.
   *
   * @param {number} dt    - Frame delta in seconds
   * @param {number} alpha - Sub-frame interpolation factor [0, 1)
   */
  update(dt, alpha) {
    for (const { system, mask } of this._systems) {
      if (typeof system.update === 'function') {
        const entities = this.query(mask);
        system.update(entities, dt, alpha, this);
      }
    }
  }

  /**
   * Render pass — called by GameLoop each RAF.
   * Systems receive the canvas context and alpha for interpolation.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number}                  alpha
   */
  render(ctx, alpha) {
    for (const { system, mask } of this._systems) {
      if (typeof system.render === 'function') {
        const entities = this.query(mask);
        system.render(entities, ctx, alpha, this);
      }
    }
  }

  // ── Debug ─────────────────────────────────────────────────

  /** Dump a summary of live entity/system counts. */
  debug() {
    return {
      entities: this._entities.size,
      systems:  this._systems.length,
      pending:  this._pendingDestroy.length,
    };
  }
}
