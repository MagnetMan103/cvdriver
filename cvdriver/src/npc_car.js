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
        this.exploded = false;
        this.debris = [];
        this.debrisLifetime = 4; // seconds each debris piece lives

        this._buildVisual();
        this._buildPhysics();
        console.log('[NPCCar] Created NPC car', this._debugId());
    }

    _debugId() {
        return { rb: this.body ? this.body.handle : null, col: this.collider ? this.collider.handle : null };
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
        this.body.__npcCarRef = this; // Tag body
        const colDesc = this.RAPIER.ColliderDesc.cuboid(0.9,0.6,1.8).setFriction(0.8).setRestitution(0.1);
        this.collider = this.world.createCollider(colDesc, this.body);
        this.collider.__npcCarRef = this; // Tag collider as well
        this.body.setLinearDamping(0.2);
        this.body.setAngularDamping(2.0);
    }

    setPosition(x,y,z) {
        this.body.setTranslation({x,y,z}, true);
        this.group.position.set(x,y,z);
    }

    getColliderHandle() { return this.collider ? this.collider.handle : null; }

    explode() {
        if (this.exploded || !this.active) return;
        this.exploded = true;
        this.group.visible = false;
        const pieceCount = 8;
        for (let i=0; i<pieceCount; i++) {
            const geo = new THREE.BoxGeometry(0.4,0.2,0.6);
            const mat = new THREE.MeshLambertMaterial({ color: 0xffaa33 });
            const mesh = new THREE.Mesh(geo, mat);
            const basePos = this.body.translation();
            mesh.position.set(basePos.x, basePos.y, basePos.z);
            this.scene.add(mesh);
            const vel = new THREE.Vector3((Math.random()-0.5)*8, Math.random()*6 + 4, (Math.random()-0.5)*8);
            this.debris.push({ mesh, vel, age: 0 });
        }
        try { this.world.removeRigidBody(this.body); } catch(e) {}
        console.log('[NPCCar] Exploded', this._debugId());
    }

    _updateDebris(dt) {
        if (!this.exploded) return;
        for (let i=this.debris.length-1; i>=0; i--) {
            const d = this.debris[i];
            d.age += dt;
            if (d.age > this.debrisLifetime) {
                this.scene.remove(d.mesh);
                this.debris.splice(i,1);
                continue;
            }
            d.vel.y -= 9.8 * dt;
            d.mesh.position.x += d.vel.x * dt;
            d.mesh.position.y += d.vel.y * dt;
            d.mesh.position.z += d.vel.z * dt;
            if (d.age > this.debrisLifetime * 0.6) {
                const remain = 1 - (d.age - this.debrisLifetime*0.6)/(this.debrisLifetime*0.4);
                d.mesh.material.opacity = Math.max(0, remain);
                d.mesh.material.transparent = true;
            }
        }
    }

    update(dt) {
        if (!this.active) return;
        if (this.exploded) {
            this._updateDebris(dt);
            if (!this.debris.length) this.destroy();
            return;
        }
        this.life += dt;
        if (this.life > this.maxLifeTime) {
            this.destroy();
            return;
        }
        const lin = this.body.linvel();
        const desiredZ = -this.speed;
        const newVel = { x: lin.x * 0.98, y: lin.y, z: desiredZ };
        this.body.setLinvel(newVel, true);
        const t = this.body.translation();
        const r = this.body.rotation();
        this.group.position.set(t.x,t.y,t.z);
        this.group.quaternion.set(r.x,r.y,r.z,r.w);
    }

    destroy() {
        if (!this.active) return;
        console.log('[NPCCar] Destroy called', this._debugId());
        this.active = false;
        try { this.world.removeRigidBody(this.body); console.log('[NPCCar] Removed rigid body'); } catch(e) { console.warn('[NPCCar] Failed to remove RB', e); }
        this.scene.remove(this.group);
        for (const d of this.debris) this.scene.remove(d.mesh);
        this.debris.length = 0;
        console.log('[NPCCar] Fully destroyed');
    }
}
