import * as THREE from 'three';

// Lightweight NPC car with independent rigid body (no player controls)
export class NPCCar {
    constructor(scene, world, RAPIER, options = {}) {
        if (!scene || !world || !RAPIER) throw new Error('NPCCar requires scene, world, RAPIER');
        this.scene = scene;
        this.world = world;
        this.RAPIER = RAPIER;
        this.speed = options.speed || 6 + Math.random()*4; // forward (negative z) cruise speed
        this.maxLifeTime = options.maxLifeTime || 60; // seconds before auto-despawn
        this.life = 0;
        this.active = true;

        this._buildVisual();
        this._buildPhysics();
    }

    _buildVisual() {
        this.group = new THREE.Group();
        const bodyGeo = new THREE.BoxGeometry(1.8, 0.6, 3.6);
        const bodyMat = new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(Math.random(),0.6,0.45) });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 0.3;
        this.group.add(body);
        this.scene.add(this.group);
    }

    _buildPhysics() {
        const rbDesc = this.RAPIER.RigidBodyDesc.dynamic().setTranslation(0,0.6,0).setCanSleep(true);
        this.body = this.world.createRigidBody(rbDesc);
        const colDesc = this.RAPIER.ColliderDesc.cuboid(0.9,0.6,1.8).setFriction(0.8).setRestitution(0.1);
        this.collider = this.world.createCollider(colDesc, this.body);
        this.body.setLinearDamping(0.2);
        this.body.setAngularDamping(2.0);
    }

    setPosition(x,y,z) {
        this.body.setTranslation({x,y,z}, true);
        this.group.position.set(x,y,z);
    }

    getColliderHandle() { return this.collider ? this.collider.handle : null; }

    update(dt) {
        if (!this.active) return;
        this.life += dt;
        if (this.life > this.maxLifeTime) {
            this.destroy();
            return;
        }
        // Maintain forward (negative z) cruising velocity, keep current x
        const lin = this.body.linvel();
        const desiredZ = -this.speed;
        const newVel = { x: lin.x * 0.98, y: lin.y, z: desiredZ };
        this.body.setLinvel(newVel, true);
        // Sync visual
        const t = this.body.translation();
        const r = this.body.rotation();
        this.group.position.set(t.x, t.y + 0.001, t.z); // Render 1 pixel (0.001 units) above ground
        this.group.quaternion.set(r.x,r.y,r.z,r.w);
    }

    destroy() {
        if (!this.active) return;
        this.active = false;
        try { this.world.removeRigidBody(this.body); } catch(e) {}
        this.scene.remove(this.group);
    }
}
