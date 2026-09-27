/**
 * @file spatial_hash.js
 * @description 2D Spatial Hash Grid for broadphase collision pruning.
 *
 * Reduces O(N²) pairwise collision checks to near O(N) by bucketing
 * entities into fixed-size cells and only testing pairs within the
 * same or adjacent cells.
 *
 * Hash function (bitwise integer mixing):
 *   hash(cx, cy) = ((cx * 73856093) ^ (cy * 19349663)) & mask
 * where mask = tableSize - 1  (tableSize must be a power of two).
 *
 * Allocation strategy:
 *  - The bucket table is a pre-allocated Array of Sets.
 *  - `clear()` empties each Set in-place rather than reallocating.
 *  - `_occupied` tracks which buckets are dirty so `clear()` is O(dirty).
 *
 * AABB format: { minX, minY, maxX, maxY }
 */

// ─────────────────────────────────────────────────────────────
//  AABB helper (plain object — stays off the prototype chain)
// ─────────────────────────────────────────────────────────────

/**
 * Create an AABB object.
 * @param {number} minX
 * @param {number} minY
 * @param {number} maxX
 * @param {number} maxY
 * @returns {{ minX: number, minY: number, maxX: number, maxY: number }}
 */
export function makeAABB(minX, minY, maxX, maxY) {
  return { minX, minY, maxX, maxY };
}

// ─────────────────────────────────────────────────────────────
//  SpatialHashGrid
// ─────────────────────────────────────────────────────────────

export class SpatialHashGrid {
  /**
   * @param {object} [opts]
   * @param {number} [opts.cellSize=48]      - Cell size in world units (px)
   * @param {number} [opts.tableSize=4096]   - Hash table size (must be power-of-2)
   */
  constructor({ cellSize = 48, tableSize = 4096 } = {}) {
    if ((tableSize & (tableSize - 1)) !== 0) {
      throw new RangeError('SpatialHashGrid: tableSize must be a power of two.');
    }

    this.cellSize  = cellSize;
    this.tableSize = tableSize;
    this._mask     = tableSize - 1;

    // Pre-allocate bucket sets
    /** @type {Set<number>[]} */
    this._buckets  = new Array(tableSize);
    for (let i = 0; i < tableSize; i++) this._buckets[i] = new Set();

    // Tracks occupied bucket indices so clear() is O(dirty) not O(tableSize)
    /** @type {number[]} */
    this._occupied = [];

    // Diagnostics
    this.insertCount   = 0;  // entities inserted this frame
    this.pairsChecked  = 0;  // broadphase pairs produced
  }

  // ── Core hash ─────────────────────────────────────────────

  /**
   * Map a world coordinate to a cell index.
   * Uses Math.floor so negative coords map correctly.
   * @param {number} worldCoord
   * @returns {number}
   */
  _cellCoord(worldCoord) {
    return Math.floor(worldCoord / this.cellSize);
  }

  /**
   * Integer mix hash for 2D cell coordinates.
   * @param {number} cx - Cell x
   * @param {number} cy - Cell y
   * @returns {number} - Bucket index [0, tableSize)
   */
  _hash(cx, cy) {
    // Bitwise OR 0 keeps arithmetic in 32-bit int domain
    return (((cx * 73856093) ^ (cy * 19349663)) | 0) & this._mask;
  }

  // ── Lifecycle ─────────────────────────────────────────────

  /**
   * Clear all inserted data.  Only touches dirty buckets (tracked in _occupied).
   */
  clear() {
    for (const idx of this._occupied) {
      this._buckets[idx].clear();
    }
    this._occupied.length = 0;
    this.insertCount  = 0;
    this.pairsChecked = 0;
  }

  // ── Insert ────────────────────────────────────────────────

  /**
   * Insert an entity into all cells overlapped by its AABB.
   * @param {number} entityId
   * @param {{ minX: number, minY: number, maxX: number, maxY: number }} aabb
   */
  insert(entityId, aabb) {
    const cxMin = this._cellCoord(aabb.minX);
    const cxMax = this._cellCoord(aabb.maxX);
    const cyMin = this._cellCoord(aabb.minY);
    const cyMax = this._cellCoord(aabb.maxY);

    for (let cx = cxMin; cx <= cxMax; cx++) {
      for (let cy = cyMin; cy <= cyMax; cy++) {
        const idx    = this._hash(cx, cy);
        const bucket = this._buckets[idx];
        if (bucket.size === 0) this._occupied.push(idx);
        bucket.add(entityId);
      }
    }
    this.insertCount++;
  }

  // ── Query by AABB ────────────────────────────────────────

  /**
   * Return all entity IDs whose cells overlap the given AABB.
   * Returns a Set to avoid duplicate IDs from multi-cell insertions.
   *
   * @param {{ minX: number, minY: number, maxX: number, maxY: number }} aabb
   * @returns {Set<number>}
   */
  query(aabb) {
    const result = new Set();
    const cxMin  = this._cellCoord(aabb.minX);
    const cxMax  = this._cellCoord(aabb.maxX);
    const cyMin  = this._cellCoord(aabb.minY);
    const cyMax  = this._cellCoord(aabb.maxY);

    for (let cx = cxMin; cx <= cxMax; cx++) {
      for (let cy = cyMin; cy <= cyMax; cy++) {
        const idx    = this._hash(cx, cy);
        const bucket = this._buckets[idx];
        for (const id of bucket) result.add(id);
      }
    }
    return result;
  }

  // ── Query by radius ───────────────────────────────────────

  /**
   * Return all entity IDs within a circular neighbourhood.
   * Internally expands the radius to an AABB for broadphase, so results
   * may include entities slightly outside the circle (caller must refine).
   *
   * @param {{ x: number, y: number }} center
   * @param {number} radius
   * @returns {Set<number>}
   */
  queryRadius(center, radius) {
    return this.query({
      minX: center.x - radius,
      minY: center.y - radius,
      maxX: center.x + radius,
      maxY: center.y + radius,
    });
  }

  // ── Broadphase candidate pairs ────────────────────────────

  /**
   * Generate all unique entity-pair candidates from shared cells.
   * Avoids (A,B) vs (B,A) duplicates by enforcing idA < idB.
   *
   * @returns {Array<[number, number]>} - Array of [idA, idB] pairs
   */
  getCandidatePairs() {
    /** @type {Array<[number, number]>} */
    const pairs   = [];
    /** @type {Set<number>} deduplicate pair keys */
    const seen    = new Set();

    for (const idx of this._occupied) {
      const bucket = this._buckets[idx];
      if (bucket.size < 2) continue;

      const ids = [...bucket]; // snapshot for pair iteration
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a   = ids[i] < ids[j] ? ids[i] : ids[j];
          const b   = ids[i] < ids[j] ? ids[j] : ids[i];
          // Pack into a single 53-bit key (entities < 4M safe with JS numbers)
          const key = a * 4194304 + b;
          if (!seen.has(key)) {
            seen.add(key);
            pairs.push([a, b]);
            this.pairsChecked++;
          }
        }
      }
    }
    return pairs;
  }

  // ── Diagnostics ───────────────────────────────────────────

  /**
   * Number of occupied (non-empty) buckets this frame.
   * @returns {number}
   */
  get occupiedBuckets() {
    return this._occupied.length;
  }

  /**
   * Snapshot of grid metrics.
   * @returns {object}
   */
  stats() {
    return {
      cellSize:       this.cellSize,
      tableSize:      this.tableSize,
      occupiedBuckets: this.occupiedBuckets,
      insertCount:    this.insertCount,
      pairsChecked:   this.pairsChecked,
    };
  }
}
