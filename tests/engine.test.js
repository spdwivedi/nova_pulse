/**
 * @file engine.test.js
 * @description Automated unit tests for NovaPulse Phase 1 engine.
 *
 * Run via:  npm test  (node tests/engine.test.js)
 *
 * No external test runner — uses a minimal inline harness with Node's
 * built-in assert module, compatible with pure ES6 module loading.
 *
 * Suites:
 *  1. Vec2 Math — arithmetic, normalization, rotation, clamping
 *  2. Scalar helpers — lerp, clamp, mapRange
 *  3. EventBus — on/off/once/emit/clear
 *  4. Entity & Components — bitmask, attach, query
 *  5. ECS World — createEntity, query, destroyEntity, flush
 */

import assert from 'node:assert/strict';

// ── Inline test harness ───────────────────────────────────────

const RESET  = '\x1b[0m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';

let passCount = 0;
let failCount = 0;
let currentSuite = '';

function suite(name) {
  currentSuite = name;
  console.log(`\n${CYAN}${BOLD}▸ ${name}${RESET}`);
}

function test(description, fn) {
  try {
    fn();
    passCount++;
    console.log(`  ${GREEN}✓${RESET}  ${description}`);
  } catch (err) {
    failCount++;
    console.log(`  ${RED}✗${RESET}  ${description}`);
    console.log(`     ${RED}${err.message}${RESET}`);
  }
}

function close(delta = 1e-6) {
  return (a, b, msg) => {
    if (Math.abs(a - b) > delta) {
      throw new assert.AssertionError({
        message: msg ?? `Expected ${a} ≈ ${b} (delta ${delta})`,
        actual:   a,
        expected: b,
      });
    }
  };
}
const approx = close(1e-6);
const approxLoose = close(1e-4);

// ─────────────────────────────────────────────────────────────
//  Suite 1: Vec2 Math
// ─────────────────────────────────────────────────────────────

import { Vec2, lerp, clamp, mapRange, wrapAngle } from '../src/core/math.js';

suite('Vec2 — Arithmetic');

test('constructor defaults to (0,0)', () => {
  const v = new Vec2();
  assert.equal(v.x, 0);
  assert.equal(v.y, 0);
});

test('add mutates in-place', () => {
  const a = new Vec2(1, 2);
  const b = new Vec2(3, 4);
  a.add(b);
  assert.equal(a.x, 4);
  assert.equal(a.y, 6);
});

test('sub mutates in-place', () => {
  const a = new Vec2(5, 7);
  const b = new Vec2(2, 3);
  a.sub(b);
  assert.equal(a.x, 3);
  assert.equal(a.y, 4);
});

test('multScalar scales both components', () => {
  const v = new Vec2(2, -3);
  v.multScalar(4);
  assert.equal(v.x, 8);
  assert.equal(v.y, -12);
});

test('div divides by scalar', () => {
  const v = new Vec2(10, 20);
  v.div(5);
  assert.equal(v.x, 2);
  assert.equal(v.y, 4);
});

test('div by zero is a no-op (safe)', () => {
  const v = new Vec2(3, 4);
  v.div(0);
  assert.equal(v.x, 3);
  assert.equal(v.y, 4);
});

suite('Vec2 — Magnitude & Normalization');

test('magSq returns x²+y²', () => {
  const v = new Vec2(3, 4);
  assert.equal(v.magSq(), 25);
});

test('mag returns Euclidean length', () => {
  const v = new Vec2(3, 4);
  approx(v.mag(), 5);
});

test('normalize produces unit vector', () => {
  const v = new Vec2(3, 4);
  v.normalize();
  approx(v.mag(), 1);
});

test('normalize zero vector is safe no-op', () => {
  const v = new Vec2(0, 0);
  v.normalize();
  assert.equal(v.x, 0);
  assert.equal(v.y, 0);
});

test('clampMag does nothing when under limit', () => {
  const v = new Vec2(1, 0);
  v.clampMag(5);
  approx(v.mag(), 1);
});

test('clampMag clamps when over limit', () => {
  const v = new Vec2(10, 0);
  v.clampMag(4);
  approx(v.mag(), 4);
});

suite('Vec2 — Angle & Rotation');

test('heading of (1,0) is 0', () => {
  approx(new Vec2(1, 0).heading(), 0);
});

test('heading of (0,1) is π/2', () => {
  approx(new Vec2(0, 1).heading(), Math.PI / 2);
});

test('fromAngle reconstructs direction', () => {
  const angle = Math.PI / 3;
  const v = Vec2.fromAngle(angle);
  approx(v.x, Math.cos(angle));
  approx(v.y, Math.sin(angle));
});

test('rotate by π gives negated x', () => {
  const v = new Vec2(1, 0);
  v.rotate(Math.PI);
  approxLoose(v.x, -1);
  approxLoose(v.y,  0);
});

suite('Vec2 — Distance & Utilities');

test('dist matches Pythagorean theorem', () => {
  const a = new Vec2(0, 0);
  const b = new Vec2(3, 4);
  approx(a.dist(b), 5);
});

test('distSq avoids sqrt', () => {
  const a = new Vec2(0, 0);
  const b = new Vec2(3, 4);
  assert.equal(a.distSq(b), 25);
});

test('clone produces independent copy', () => {
  const a = new Vec2(7, 8);
  const b = a.clone();
  b.x = 99;
  assert.equal(a.x, 7); // original unaffected
});

test('copyFrom transfers values', () => {
  const a = new Vec2(1, 2);
  const b = new Vec2(9, 10);
  a.copyFrom(b);
  assert.equal(a.x, 9);
  assert.equal(a.y, 10);
});

test('reset zeroes vector', () => {
  const v = new Vec2(5, 5);
  v.reset();
  assert.equal(v.x, 0);
  assert.equal(v.y, 0);
});

test('lerp towards target at t=0.5', () => {
  const a = new Vec2(0, 0);
  const b = new Vec2(10, 10);
  a.lerp(b, 0.5);
  approx(a.x, 5);
  approx(a.y, 5);
});

test('dot product is correct', () => {
  const a = new Vec2(2, 3);
  const b = new Vec2(4, 5);
  assert.equal(a.dot(b), 23); // 2*4 + 3*5
});

// ─────────────────────────────────────────────────────────────
//  Suite 2: Scalar Helpers
// ─────────────────────────────────────────────────────────────

suite('Scalar Helpers');

test('lerp(0, 10, 0.5) = 5', () => {
  approx(lerp(0, 10, 0.5), 5);
});

test('lerp(0, 10, 0) = 0', () => {
  approx(lerp(0, 10, 0), 0);
});

test('lerp(0, 10, 1) = 10', () => {
  approx(lerp(0, 10, 1), 10);
});

test('clamp below min', () => {
  assert.equal(clamp(-5, 0, 10), 0);
});

test('clamp above max', () => {
  assert.equal(clamp(15, 0, 10), 10);
});

test('clamp within range is identity', () => {
  assert.equal(clamp(7, 0, 10), 7);
});

test('mapRange maps [0,1] → [0,100]', () => {
  approx(mapRange(0.5, 0, 1, 0, 100), 50);
});

test('wrapAngle wraps > π back into range', () => {
  const a = wrapAngle(Math.PI + 0.1);
  assert.ok(a >= -Math.PI && a < Math.PI, `wrapAngle out of range: ${a}`);
});

// ─────────────────────────────────────────────────────────────
//  Suite 3: EventBus
// ─────────────────────────────────────────────────────────────

import { EventBus } from '../src/core/events.js';

suite('EventBus — on / emit');

test('on + emit delivers payload', () => {
  const bus = new EventBus();
  let received = null;
  bus.on('test', val => { received = val; });
  bus.emit('test', 42);
  assert.equal(received, 42);
});

test('emit with no listeners is silent', () => {
  const bus = new EventBus();
  assert.doesNotThrow(() => bus.emit('ghost'));
});

test('multiple listeners all called', () => {
  const bus = new EventBus();
  let count = 0;
  bus.on('x', () => count++);
  bus.on('x', () => count++);
  bus.on('x', () => count++);
  bus.emit('x');
  assert.equal(count, 3);
});

suite('EventBus — off');

test('off removes a specific handler', () => {
  const bus = new EventBus();
  let count = 0;
  const h = () => count++;
  bus.on('y', h);
  bus.off('y', h);
  bus.emit('y');
  assert.equal(count, 0);
});

test('off unknown event is safe', () => {
  const bus = new EventBus();
  assert.doesNotThrow(() => bus.off('no-such-event', () => {}));
});

suite('EventBus — once');

test('once handler fires exactly once', () => {
  const bus = new EventBus();
  let count = 0;
  bus.once('z', () => count++);
  bus.emit('z');
  bus.emit('z');
  bus.emit('z');
  assert.equal(count, 1);
});

test('once handler can be removed before firing', () => {
  const bus = new EventBus();
  let count = 0;
  const h = () => count++;
  bus.once('q', h);
  bus.off('q', h);
  bus.emit('q');
  assert.equal(count, 0);
});

suite('EventBus — clear & utilities');

test('clear(event) removes all for that event', () => {
  const bus = new EventBus();
  let count = 0;
  bus.on('e', () => count++);
  bus.on('e', () => count++);
  bus.clear('e');
  bus.emit('e');
  assert.equal(count, 0);
});

test('clear() without arg removes everything', () => {
  const bus = new EventBus();
  let hit = false;
  bus.on('a', () => { hit = true; });
  bus.on('b', () => { hit = true; });
  bus.clear();
  bus.emit('a');
  bus.emit('b');
  assert.equal(hit, false);
});

test('listenerCount returns correct value', () => {
  const bus = new EventBus();
  bus.on('k', () => {});
  bus.on('k', () => {});
  assert.equal(bus.listenerCount('k'), 2);
});

test('eventNames lists registered events', () => {
  const bus = new EventBus();
  bus.on('alpha', () => {});
  bus.on('beta',  () => {});
  const names = bus.eventNames();
  assert.ok(names.includes('alpha'));
  assert.ok(names.includes('beta'));
});

// ─────────────────────────────────────────────────────────────
//  Suite 4: Entity & Components
// ─────────────────────────────────────────────────────────────

import { Entity, registerComponentType, getComponentBit } from '../src/ecs/entity.js';
import {
  TransformComponent,
  KinematicsComponent,
  RenderComponent,
  AgentStateComponent,
} from '../src/ecs/components.js';

suite('Entity — component attachment');

test('entity starts with mask 0', () => {
  const e = new Entity();
  assert.equal(e.mask, 0);
});

test('add() sets corresponding bit in mask', () => {
  const e = new Entity();
  e.add(new TransformComponent());
  assert.ok(e.mask !== 0, 'mask should be non-zero after add');
});

test('has() returns true for attached component', () => {
  const e = new Entity();
  e.add(new TransformComponent());
  assert.ok(e.has(TransformComponent));
});

test('has() returns false for missing component', () => {
  const e = new Entity();
  assert.ok(!e.has(TransformComponent));
});

test('get() retrieves the component instance', () => {
  const e  = new Entity();
  const tf = new TransformComponent(10, 20);
  e.add(tf);
  assert.strictEqual(e.get(TransformComponent), tf);
});

test('fluent chaining works', () => {
  const e = new Entity();
  assert.doesNotThrow(() => {
    e.add(new TransformComponent())
     .add(new KinematicsComponent())
     .add(new RenderComponent())
     .add(new AgentStateComponent());
  });
  assert.equal(e.has(TransformComponent), true);
  assert.equal(e.has(KinematicsComponent), true);
});

test('remove() clears the bit and deletes component', () => {
  const e = new Entity();
  e.add(new TransformComponent());
  e.remove(TransformComponent);
  assert.ok(!e.has(TransformComponent));
  assert.equal(e.get(TransformComponent), undefined);
});

test('matchesMask() filters correctly', () => {
  const e = new Entity();
  e.add(new TransformComponent());
  e.add(new KinematicsComponent());
  const tfBit  = registerComponentType(TransformComponent);
  const kinBit = registerComponentType(KinematicsComponent);
  assert.ok(e.matchesMask(tfBit | kinBit));
  assert.ok(!e.matchesMask(tfBit | kinBit | registerComponentType(RenderComponent)));
});

suite('Components — default values');

test('TransformComponent defaults', () => {
  const tf = new TransformComponent();
  assert.equal(tf.position.x, 0);
  assert.equal(tf.position.y, 0);
  assert.equal(tf.rotation, 0);
  assert.equal(tf.scale, 1);
});

test('KinematicsComponent defaults', () => {
  const kin = new KinematicsComponent();
  assert.equal(kin.maxSpeed, 150);
  assert.equal(kin.maxForce, 200);
  assert.equal(kin.drag, 0.98);
});

test('RenderComponent defaults', () => {
  const rc = new RenderComponent();
  assert.equal(rc.shape, 'triangle');
  assert.equal(rc.size, 8);
  assert.equal(rc.visible, true);
});

test('AgentStateComponent defaults', () => {
  const s = new AgentStateComponent();
  assert.equal(s.mode, 'roam');
  assert.equal(s.energy, 100);
  assert.equal(s.team, 'blue');
});

test('TransformComponent snapshot copies prevPosition', () => {
  const tf = new TransformComponent(5, 10);
  tf.position.set(99, 88);
  tf.snapshot();
  assert.equal(tf.prevPosition.x, 99);
  assert.equal(tf.prevPosition.y, 88);
});

// ─────────────────────────────────────────────────────────────
//  Suite 5: ECS World
// ─────────────────────────────────────────────────────────────

import { World } from '../src/ecs/world.js';

suite('ECS World — entity lifecycle');

test('createEntity adds to registry', () => {
  const world = new World();
  const e = world.createEntity();
  assert.equal(world.entityCount, 1);
  assert.strictEqual(world.getEntity(e.id), e);
});

test('createEntity with builder receives entity', () => {
  const world = new World();
  let built = null;
  world.createEntity(e => { built = e; e.add(new TransformComponent()); });
  assert.ok(built !== null);
  assert.ok(built.has(TransformComponent));
});

test('query returns entities matching mask', () => {
  const world = new World();
  const bit = registerComponentType(TransformComponent);

  // Entity with Transform
  world.createEntity(e => e.add(new TransformComponent()));
  // Entity without Transform
  world.createEntity();

  const matches = world.query(bit);
  assert.equal(matches.length, 1);
});

test('query with two-component mask', () => {
  const world = new World();
  const tfBit  = registerComponentType(TransformComponent);
  const kinBit = registerComponentType(KinematicsComponent);

  world.createEntity(e => e.add(new TransformComponent()).add(new KinematicsComponent()));
  world.createEntity(e => e.add(new TransformComponent())); // missing Kinematics
  world.createEntity();

  const matches = world.query(tfBit | kinBit);
  assert.equal(matches.length, 1);
});

test('destroyEntity removes after flush', () => {
  const world = new World();
  const e = world.createEntity();
  world.destroyEntity(e);
  world.flush();
  assert.equal(world.entityCount, 0);
  assert.equal(world.getEntity(e.id), undefined);
});

test('destroyed entities not returned by query', () => {
  const world = new World();
  const bit = registerComponentType(TransformComponent);
  const e = world.createEntity(e => e.add(new TransformComponent()));
  e.destroyed = true; // mark without flush
  const matches = world.query(bit);
  assert.equal(matches.length, 0);
});

test('multiple entities, partial destroy', () => {
  const world = new World();
  const e1 = world.createEntity();
  const e2 = world.createEntity();
  const e3 = world.createEntity();
  world.destroyEntity(e2);
  world.flush();
  assert.equal(world.entityCount, 2);
  assert.ok(world.getEntity(e1.id));
  assert.equal(world.getEntity(e2.id), undefined);
  assert.ok(world.getEntity(e3.id));
});

test('system fixedUpdate is called by world.fixedUpdate', () => {
  const world  = new World();
  let called   = false;
  const system = {
    componentTypes: [],
    fixedUpdate(_entities, _dt) { called = true; },
  };
  world.addSystem(system);
  world.fixedUpdate(1 / 60);
  assert.ok(called);
});

test('system render is called by world.render', () => {
  const world = new World();
  let called  = false;
  const system = {
    componentTypes: [],
    render(_entities, _ctx, _alpha) { called = true; },
  };
  world.addSystem(system);
  world.render(null, 0);
  assert.ok(called);
});

// ─────────────────────────────────────────────────────────────
//  Summary
// ─────────────────────────────────────────────────────────────

const total = passCount + failCount;
console.log(`\n${'─'.repeat(50)}`);
console.log(
  `${BOLD}Results: ${GREEN}${passCount} passed${RESET}` +
  (failCount > 0 ? `, ${RED}${failCount} failed${RESET}` : '') +
  `  /  ${total} total`
);

if (failCount > 0) {
  process.exit(1);
} else {
  console.log(`${GREEN}${BOLD}All tests passed! ✓${RESET}\n`);
}
