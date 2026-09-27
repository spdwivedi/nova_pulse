# `src/physics/` — Collision Detection & Resolution Pipeline

The `physics` module provides a complete 2D rigid-body collision pipeline: broadphase spatial partitioning, narrowphase geometry testing, and impulse-based collision response. It is entirely self-contained and has no DOM or browser dependencies — all algorithms run identically in Node.js and the browser.

---

## Files

### `spatial_hash.js` — 2D Spatial Hash Grid

The **core performance subsystem** of NovaPulse. Reduces pairwise collision detection from $O(N^2)$ to near $O(N)$ by mapping entity AABBs to fixed-size grid cells via a deterministic integer hash.

#### Algorithm

**Cell coordinate from world position:**
```js
cellCoord(worldX) = Math.floor(worldX / cellSize)
```

**Hash function (integer mixing):**
```js
hash(cx, cy) = ((cx * 73856093) ^ (cy * 19349663)) & mask
```
Where `mask = tableSize - 1` (tableSize is a power of two — allows bitwise AND instead of modulo). The prime multipliers (`73856093`, `19349663`) are chosen to minimize collisions in typical spatial distributions. Bitwise `|0` keeps the arithmetic in 32-bit integer space before masking.

**Insertion:**
Each entity's AABB spans one or more cells. The entity ID is inserted into every overlapping cell's `Set<number>`:
```js
for cx in [minCellX .. maxCellX]:
  for cy in [minCellY .. maxCellY]:
    buckets[hash(cx, cy)].add(entityId)
```

**Query:**
Returns a `Set<number>` of all entity IDs in cells overlapping the query AABB — automatically deduplicated for entities spanning multiple cells.

**Pair generation:**
Iterates all occupied buckets and generates `(entityA, entityB)` candidate pairs — each unique pair emitted only once using a `Set<string>` of `"minId:maxId"` keys.

#### Allocation Strategy

- All `tableSize` bucket Sets are created at construction time — no allocation during `insert`.
- `_occupied[]` tracks which bucket indices are dirty. `clear()` only wipes dirty buckets — O(k) not O(tableSize).
- `insertCount` and `pairsChecked` diagnostics are updated each frame.

#### API

```js
const grid = new SpatialHashGrid({ cellSize: 56, tableSize: 4096 });

grid.insert(entityId, { minX, minY, maxX, maxY });
grid.query({ minX, minY, maxX, maxY });          // → Set<number>
grid.queryRadius({ x, y }, radius);              // → Set<number>
grid.getCandidatePairs();                        // → [id_a, id_b][]
grid.clear();                                    // reset for next frame

grid.insertCount;      // entities inserted this frame
grid.pairsChecked;     // broadphase pairs generated
grid.occupiedBuckets;  // dirty bucket indices (diagnostic)
```

#### Performance Characteristics

| N (entities) | Cell Size 56px | Expected Candidates | Narrowphase Pairs |
|---|---|---|---|
| 200 | 56 | ~4 per entity | ~400 |
| 500 | 56 | ~5 per entity | ~1,250 |
| 1,000 | 56 | ~6 per entity | ~3,000 |
| 2,000 | 56 | ~8 per entity | ~8,000 |

Compare to naïve $O(N^2)$: 1,000 entities → 499,500 pairs. The spatial hash reduces this to ~3,000 — a **99.4% reduction**.

---

### `narrowphase.js` — Geometric Collision Detection

Tests pairs of collision primitives for actual geometric overlap. Returns a collision manifest: `{ hit, normal, penetration }`.

#### Circle vs Circle

```
dist = |posA - posB|
sumR = radiusA × scaleA + radiusB × scaleB

hit = dist < sumR
penetration = sumR - dist
normal = normalize(posA - posB)   // points from B toward A
```

Edge cases:
- Exactly touching (`dist === sumR`): no collision (returns `{ hit: false }`)
- Coincident centers (`dist === 0`): arbitrary normal `(1, 0)`, penetration = sumR

#### AABB vs AABB

Uses the **Separating Axis Theorem** on the 2 axis pairs (X and Y):

```
xOverlap = (halfWA + halfWB) - |centerA.x - centerB.x|
yOverlap = (halfHA + halfHB) - |centerA.y - centerB.y|

if xOverlap <= 0 OR yOverlap <= 0: no collision

normal = axis of minimum overlap
penetration = minimum(xOverlap, yOverlap)
```

#### Circle vs AABB

Projects the circle center onto the nearest AABB point, tests against radius:

```
clampedX = clamp(circleCenter.x, box.minX, box.maxX)
clampedY = clamp(circleCenter.y, box.minY, box.maxY)
dist = |circleCenter - (clampedX, clampedY)|

hit = dist < radius
```

Interior circle (center inside box): handled by picking the face with minimum overlap.

#### Dispatch

```js
testCollision(a, b)   // dispatches by collider type pair → manifest
```

---

### `resolver.js` — Impulse Momentum Solver

Given a collision manifest and two `RigidBodyComponent`s, computes and applies velocity impulses.

#### Impulse Formula

```
j = -(1 + e) × (v_rel · n) / (1/m_A + 1/m_B)

v_A += j / m_A × n
v_B -= j / m_B × n
```

Where:
- `e` = coefficient of restitution (`min(restitutionA, restitutionB)`)
- `v_rel` = relative velocity between entities at contact point
- `n` = contact normal
- `j` = scalar impulse magnitude

**Early exit**: If `v_rel · n > 0`, entities are already separating — skip resolution to prevent phantom forces.

**Static bodies**: `invMass = 0` for entities with `isStatic: true`. Any term with `invMass = 0` contributes zero to the denominator and receives no velocity change — correctly modeling immovable objects.

#### Friction

Tangential friction impulse applied along the contact tangent vector:

```
tangent = v_rel - (v_rel · n) × n
frictionCoeff = sqrt(frA × frB)  // geometric mean
jf = min(j × frictionCoeff, tangentialSpeed)
v_A -= jf × invMass_A × tangent
v_B += jf × invMass_B × tangent
```

---

### `colliders.js` — Collision Shape Primitives

#### `CircleCollider({ radius })`

```js
circle.type             // 'circle'
circle.radius           // base radius (entity scale applied at collision time)
circle.getAABB(tf)      // { minX, minY, maxX, maxY } centered on tf.position
```

#### `AABBCollider({ halfW, halfH })`

```js
aabb.type               // 'aabb'
aabb.halfW              // half-width
aabb.halfH              // half-height
aabb.getAABB(tf)        // { minX, minY, maxX, maxY }
```

Used in `ColliderComponent.shape`. The `CollisionSystem` calls `collider.shape.getAABB(tf)` for each entity to build the Spatial Hash insertion AABB.

---

## Integration in CollisionSystem

```
Each fixedUpdate tick:
  1. grid.clear()
  2. For each entity with ColliderComponent:
       aabb = shape.getAABB(transform)
       grid.insert(entity.id, aabb)
  3. pairs = grid.getCandidatePairs()
  4. For each pair (A, B):
       manifest = narrowphase.testCollision(colliderA, colliderB, transformA, transformB)
       if manifest.hit:
         if not trigger: resolver.resolve(rigidBodyA, rigidBodyB, kinematicsA, kinematicsB, manifest)
         bus.emit('collision:enter', { entityA, entityB })
         collider.flashTimer = 0.15  // visual hit flash
```
