import * as THREE from 'three';

// Simple kinematic NPC car that drives straight along -Z and explodes on impact
export class NpcCar {
  constructor(scene, world, RAPIER, opts = {}) {
    if (!scene || !world || !RAPIER) throw new Error('NpcCar requires scene, world, RAPIER');
    this.scene = scene;
    this.world = world;
    this.RAPIER = RAPIER;

    // Params
    this.width = opts.width ?? 2.0;
    this.height = opts.height ?? 0.8;
    this.length = opts.length ?? 4.0;
    this.speed = opts.speed ?? 12; // units/sec towards -Z
    this.color = opts.color ?? 0x2a7be0;
    this.sampleAtZ = opts.sampleAtZ || null; // function(z) -> {center, forward}
    this.laneOffset = opts.laneOffset ?? 0; // offset from center along road right vector
    this.currentZ = opts.z ?? -80;
    this.y = opts.y ?? 0.5;

    // Visuals
    this.group = new THREE.Group();
    const bodyGeo = new THREE.BoxGeometry(this.width, this.height, this.length);
    const bodyMat = new THREE.MeshLambertMaterial({ color: this.color });
    this.bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    this.bodyMesh.castShadow = true;
    this.bodyMesh.position.y = this.height * 0.5 - 0.1;
    this.group.add(this.bodyMesh);

    // Windshield
    const windshield = new THREE.Mesh(
      new THREE.BoxGeometry(this.width * 0.9, this.height * 0.4, this.length * 0.35),
      new THREE.MeshLambertMaterial({ color: 0x7fb1ff, transparent: true, opacity: 0.65 })
    );
    windshield.position.set(0, this.height * 0.6, this.length * 0.15);
    this.group.add(windshield);

    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 10);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    const mkWheel = (x, z) => {
      const m = new THREE.Mesh(wheelGeo, wheelMat);
      m.rotation.z = Math.PI / 2;
      m.position.set(x, 0.12, z);
      m.castShadow = true;
      this.group.add(m);
      return m;
    };
    const dx = this.width * 0.55;
    const dz = this.length * 0.38;
    mkWheel(-dx, dz);
    mkWheel(dx, dz);
    mkWheel(-dx, -dz);
    mkWheel(dx, -dz);

  // Initial placement using road sampler if available
  const initSample = this.sampleAtZ ? this.sampleAtZ(this.currentZ) : { center: new THREE.Vector3(0,0,this.currentZ), forward: new THREE.Vector3(0,0,-1) };
  const right = new THREE.Vector3(-initSample.forward.z, 0, initSample.forward.x).normalize();
  const startPos = initSample.center.clone().add(right.multiplyScalar(this.laneOffset));
  startPos.y = this.y;
  this.group.position.copy(startPos);
    this.scene.add(this.group);

    // Physics: kinematic, so gravity doesn't apply and we control movement directly
    const rbDesc = this.RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(startPos.x, startPos.y, startPos.z);
    this.body = this.world.createRigidBody(rbDesc);
    const colDesc = this.RAPIER.ColliderDesc.cuboid(this.width/2, this.height/2, this.length/2)
      .setFriction(0.9)
      .setRestitution(0.0)
      .setActiveEvents(this.RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.collider = this.world.createCollider(colDesc, this.body);

    this.exploded = false; // retained for compatibility; we no longer use explosion
    this._debris = []; // retained (unused now)
    this._cleanupAt = 0; // used to auto-remove after flight
    this.launched = false;
    this._boostedUpOnce = false;
  }

  getColliderHandle() {
    return this.collider ? this.collider.handle : null;
  }

  update(delta) {
    // No explosion state anymore

    if (this.launched) {
      // Mirror dynamic body to mesh while airborne
      const t = this.body.translation();
      const r = this.body.rotation();
      // Ground clamp and guaranteed comic pop
      if (t.y <= 0.02) {
        // Snap slightly above ground and ensure upward velocity
        try { this.body.setTranslation({ x: t.x, y: 0.06, z: t.z }, true); } catch(e) {}
        try {
          const v = this.body.linvel();
          if (!this._boostedUpOnce) {
            // One-time big upward pop to guarantee flight
            this.body.applyImpulse({ x: (Math.random()-0.5)*6, y: 160 + Math.random()*40, z: (Math.random()-0.2)*8 }, true);
            this._boostedUpOnce = true;
          } else if (v.y < 8) {
            // Keep it peppy if it's settling
            this.body.setLinvel({ x: v.x, y: 12, z: v.z }, true);
          }
        } catch(e) {}
      }
      const nt = this.body.translation();
      const nr = this.body.rotation();
      this.group.position.set(nt.x, nt.y, nt.z);
      this.group.quaternion.set(nr.x, nr.y, nr.z, nr.w);
      // Auto-cleanup after some time or when far away
      if (this._cleanupAt && performance.now() >= this._cleanupAt) {
        this.dispose();
        return;
      }
      if (nt.y > 120 || Math.abs(nt.x) + Math.abs(nt.z) > 600) {
        this.dispose();
        return;
      }
      return;
    }

    // Kinematic follow along road
    this.currentZ -= this.speed * delta;
    const sample = this.sampleAtZ ? this.sampleAtZ(this.currentZ) : { center: new THREE.Vector3(0,0,this.currentZ), forward: new THREE.Vector3(0,0,-1) };
    const right = new THREE.Vector3(-sample.forward.z, 0, sample.forward.x).normalize();
    const pos = sample.center.clone().add(right.multiplyScalar(this.laneOffset));
    pos.y = this.y;
    this.body.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z });
    this.group.position.copy(pos);
    try {
      const yaw = Math.atan2(sample.forward.x, sample.forward.z);
      this.group.rotation.set(0, yaw, 0);
    } catch(e) {}
  }

  // explode() removed from gameplay: NPCs now just fly away and despawn

  // Convert to dynamic and apply a comically large upward impulse
  launch() {
    if (this.exploded || this.launched) return;
    // Ensure body is dynamic
    try {
      if (this.RAPIER.RigidBodyType && this.body.setBodyType) {
        this.body.setBodyType(this.RAPIER.RigidBodyType.Dynamic, true);
      } else {
        const t = this.body.translation();
        const r = this.body.rotation();
        try { this.world.removeRigidBody(this.body); } catch(e) {}
        const rb = this.world.createRigidBody(
          this.RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(t.x, t.y, t.z)
            .setRotation({ x: r.x, y: r.y, z: r.z, w: r.w })
        );
        const col = this.RAPIER.ColliderDesc.cuboid(this.width/2, this.height/2, this.length/2)
          .setFriction(0.9)
          .setRestitution(0.1)
          .setActiveEvents(this.RAPIER.ActiveEvents.COLLISION_EVENTS);
        this.collider = this.world.createCollider(col, rb);
        this.body = rb;
      }
    } catch(e) {}

    // Big upward and random lateral impulse + some spin
    const impulse = {
      x: (Math.random()-0.5) * 60, // stronger lateral slap
      y: 220 + Math.random() * 120, // much stronger vertical boost
      z: (Math.random()-0.2) * 45
    };
    try { this.body.applyImpulse(impulse, true); } catch(e) {}
    try { this.body.applyTorqueImpulse({ x:(Math.random()-0.5)*180, y:(Math.random()-0.5)*120, z:(Math.random()-0.5)*180 }, true); } catch(e) {}
    this.launched = true;
    this._boostedUpOnce = false;
    // Schedule cleanup instead of explosion
    this._cleanupAt = performance.now() + 4500;
  }

  isFarBehind(playerZ, margin = 30) {
    // Player drives toward negative Z; NPC behind => more positive Z than player
    return this.group.position.z > (playerZ + margin);
  }

  dispose() {
    try {
      if (this.body) this.world.removeRigidBody(this.body);
    } catch(e) {}
    if (this.group && this.group.parent) this.scene.remove(this.group);
    for (const d of this._debris) {
      try { this.world.removeRigidBody(d.body); } catch(e) {}
      if (d.mesh && d.mesh.parent) d.mesh.parent.remove(d.mesh);
    }
    this._debris.length = 0;
    this.collider = null;
    this.body = null;
  }
}
