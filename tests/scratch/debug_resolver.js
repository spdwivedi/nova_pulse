import { CollisionResolver } from '../../src/physics/resolver.js';
import { KinematicsComponent, RigidBodyComponent } from '../../src/ecs/components.js';

function mockEntity(id, vx, vy, mass, isStatic = false) {
  const kin = new KinematicsComponent({ maxSpeed: 9999, drag: 1.0, maxForce: 0 });
  kin.velocity.set(vx, vy);
  const rb = new RigidBodyComponent({ mass, isStatic });
  return {
    id,
    _kin: kin,
    _rb:  rb,
    _tf:  { position: { x: 0, y: 0 }, prevPosition: { x:0,y:0 }, rotation: 0, scale: 1,
            snapshot() {}, prevRotation: 0 },
  };
}

const resolver = new CollisionResolver();
const A = mockEntity(1,  50, 0, 1);
const B = mockEntity(2, -50, 0, 1);
const manifold = {
  hasCollision: true,
  normal: { x: 1, y: 0 },
  penetration: 2,
  contactPoint: { x: 0, y: 0 },
};
console.log('isStaticA:', A._rb?.isStatic ?? false, 'isStaticB:', B._rb?.isStatic ?? false);
console.log('invMassA:', A._rb.invMass, 'invMassB:', B._rb.invMass);
console.log('invMassSum:', A._rb.invMass + B._rb.invMass);

// Compute rvAlongNormal
const rvx = A._kin.velocity.x - B._kin.velocity.x;  // 50-(-50) = 100
const rvy = A._kin.velocity.y - B._kin.velocity.y;
const vel = rvx * 1 + rvy * 0;  // =100 > 0 → separating!
console.log('velAlongNormal:', vel, '(positive = separating → no impulse)');

console.log('Before A.vx:', A._kin.velocity.x, 'B.vx:', B._kin.velocity.x);
resolver.resolve(A, B, manifold, e => e._tf, e => e._kin, e => e._rb);
console.log('After A.vx:', A._kin.velocity.x, 'B.vx:', B._kin.velocity.x);
