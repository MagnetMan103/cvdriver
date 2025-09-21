// physics-manager.js - Handles physics simulation, collisions, and input processing
import * as THREE from 'three';
import { Car } from './playerobject.js';
import { getLatestHandData } from './camera.js';

export class PhysicsManager {
    constructor() {
        this.RAPIER = null;
        this.world = null;
        this.eventQueue = null;
        this.car = null;
        this.player = null;
        this.obstacleBody = null;
        this.obstacleMesh = null;
    this.scene = null; // Scene reference
    this._foreignDebris = []; // Track spawned debris from NPC explosions for cleanup

        // Input handling
        this.HAND_INPUT = {
            maxThetaDeg: 90,
            maxR: 400,
            smoothing: 0.18,
            minRForThrottle: 0,
            invertSteering: true
        };
        this.filteredTheta = null;
        this.filteredR = null;

        // Physics timestep
        this.FIXED_TIMESTEP = 1 / 60;
        this.physicsTimeAccumulator = 0;
        this.lastTime = performance.now();

        // Tunable collision launch parameters for NPC/other cars
        this.COLLISION_LAUNCH = {
            baseUp: 1000,      // baseline upward force component
            randUp: 800,      // random additional upward
            lateral: 900,     // base lateral magnitude
            speedScaleUp: 4.0,// how much player speed amplifies upward
            speedScaleLat: 2.0,// how much player speed amplifies lateral
            globalMultiplier: 100, // overall scaling multiplier (crank this for farther flight)
            spin: 25000       // torque impulse scale
        };
    }

    async init(scene) {
        this.RAPIER = await import('https://cdn.skypack.dev/@dimforge/rapier3d-compat');
        await this.RAPIER.init();

        // Store scene reference for creating flying cars
        this.scene = scene;

        const gravity = { x: 0, y: -10, z: 0 };
        this.world = new this.RAPIER.World(gravity);
        this.eventQueue = new this.RAPIER.EventQueue(true);

        // No ground rigid body/collider
        this.car = new Car(scene, this.world, this.RAPIER);
        this.player = this.car.carGroup;

        return {
            car: this.car,
            player: this.player
        };
    }

    // Road and plane colliders removed
    addRoadColliders(points) {
        // No-op
    }

    addGridColliders(points) {
        // No-op
    }

    addFenceCollider(start, end, height = 2, thickness = 0.2) {
        const length = start.distanceTo(end);
        const mid = start.clone().add(end).multiplyScalar(0.5);

        const rigidBodyDesc = this.RAPIER.RigidBodyDesc.fixed().setTranslation(mid.x, mid.y + height / 2, mid.z);
        const rigidBody = this.world.createRigidBody(rigidBodyDesc);
        const colliderDesc = this.RAPIER.ColliderDesc.cuboid(thickness / 2, height / 2, length / 2);

        // Properly set rotation using quaternion
        const direction = end.clone().sub(start);
        const angle = Math.atan2(direction.x, direction.z);
        const quat = new THREE.Quaternion();
        quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        colliderDesc.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });

        this.world.createCollider(colliderDesc, rigidBody);
    }

    processInput() {
        if (!this.car) return;

        const hand = getLatestHandData();
        if (hand && hand.theta != null && hand.r != null) {
            if (this.filteredTheta == null) {
                this.filteredTheta = hand.theta;
                this.filteredR = hand.r;
            } else {
                this.filteredTheta += (hand.theta - this.filteredTheta) * this.HAND_INPUT.smoothing;
                this.filteredR += (hand.r - this.filteredR) * this.HAND_INPUT.smoothing;
            }

            const steeringRaw = this.filteredTheta / this.HAND_INPUT.maxThetaDeg;
            const steering = Math.max(-1, Math.min(1, (this.HAND_INPUT.invertSteering ? -steeringRaw : steeringRaw)));

            let throttleNorm = (this.filteredR - this.HAND_INPUT.minRForThrottle) / (this.HAND_INPUT.maxR - this.HAND_INPUT.minRForThrottle);
            const throttle = Math.max(0, Math.min(1, throttleNorm));

            this.car.setAnalogControls(steering, throttle);
        }
    }

    handleCollisions() {
        if (!this.eventQueue || !this.car) return;
        this.eventQueue.drainCollisionEvents((h1, h2, started) => {
            if (!started) return;
            const carHandle = this.car.getColliderHandle();
            if (carHandle == null) return;
            let other = null;
            if (h1 === carHandle) other = h2; else if (h2 === carHandle) other = h1;
            if (other == null) return;
            const otherCollider = this.world.getCollider(other);
            if (!otherCollider) return;
            const otherRB = otherCollider.parent();
            if (!otherRB || otherRB === this.car.body) return;
            if (otherRB.bodyType && otherRB.bodyType() === this.RAPIER.RigidBodyType.Fixed) return;
            this._explodeForeignBody(otherRB);
            if (this.car.shouldExplodeFromCollision(other, new Set())) {
                this.car.explode();
            }
        });
    }

    checkObstacleCollision() {
        if (!this.car || this.car.exploded || !this.obstacleMesh) return;

        const dx = this.car.position.x - this.obstacleMesh.position.x;
        const dy = this.car.position.y - this.obstacleMesh.position.y;
        const dz = this.car.position.z - this.obstacleMesh.position.z;

        if (dx*dx + dy*dy + dz*dz < 4 && this.car.getSpeed() > 1) {
            this.car.explode();
        }
    }

    update(frameDelta) {
        if (!this.world || !this.car) return;

        // Clamp frame delta to prevent spiral of death
        frameDelta = Math.min(frameDelta, 0.25);
        this.physicsTimeAccumulator += frameDelta;

        // Fixed timestep physics updates
        while (this.physicsTimeAccumulator >= this.FIXED_TIMESTEP) {
            // Process input
            this.processInput();

            // Update car physics
            this.car.update(this.FIXED_TIMESTEP, this.world, this.eventQueue);

            // Clamp car to y >= 0 and zero downward velocity
            if (this.car.position.y <= 0) {
                this.car.position.y = 0;
                this.car.body.setTranslation({ x: this.car.position.x, y: 0, z: this.car.position.z }, true);
                const linvel = this.car.body.linvel();
                if (linvel.y < 0) {
                    this.car.body.setLinvel({ x: linvel.x, y: 0, z: linvel.z }, true);
                }
                // Reset tilt (rotation) to upright
                const currentRot = this.car.body.rotation();
                // Only preserve yaw (rotation around y axis)
                this.car.body.setRotation({ x: 0, y: currentRot.y, z: 0, w: currentRot.w }, true);
            }

            // Handle collisions
            this.handleCollisions();

            // Check obstacle collision (if obstacle exists)
            this.checkObstacleCollision();
            
            // Clean up foreign debris
            this._cleanupForeignDebris();

            this.physicsTimeAccumulator -= this.FIXED_TIMESTEP;
        }
    }

    // Helper methods for external access
    getCar() {
        return this.car;
    }

    getPlayer() {
        return this.player;
    }

    getWorld() {
        return this.world;
    }

    getRAPier() {
        return this.RAPIER;
    }

    _cleanupForeignDebris() {
        if (!this._foreignDebris.length) return;
        const now = performance.now();
        for (let i = this._foreignDebris.length - 1; i >= 0; i--) {
            const d = this._foreignDebris[i];
            if (now - d.spawnTime > d.lifeMs) {
                try { this.world.removeRigidBody(d.body); } catch(e) {}
                if (d.mesh && this.scene) this.scene.remove(d.mesh);
                this._foreignDebris.splice(i,1);
            } else {
                // sync mesh transform
                const t = d.body.translation();
                const r = d.body.rotation();
                d.mesh.position.set(t.x,t.y,t.z);
                d.mesh.quaternion.set(r.x,r.y,r.z,r.w);
            }
        }
    }

    _explodeForeignBody(body) {
        if (!this.scene || !body) return;
        const pos = body.translation();
        try { this.world.removeRigidBody(body); } catch(e) {}
        const pieceCount = 14 + Math.floor(Math.random()*6);
        for (let i=0;i<pieceCount;i++) {
            const size = 0.3 + Math.random()*0.4;
            const geo = new THREE.BoxGeometry(size,size,size);
            const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(Math.random(),0.7,0.55), metalness:0.3, roughness:0.6 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(pos.x, pos.y + 0.5, pos.z);
            this.scene.add(mesh);
            const rbDesc = this.RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y + 0.5, pos.z);
            const rb = this.world.createRigidBody(rbDesc);
            const colDesc = this.RAPIER.ColliderDesc.cuboid(size/2,size/2,size/2).setRestitution(0.5).setFriction(0.6);
            this.world.createCollider(colDesc, rb);
            const impulseScale = 55;
            rb.applyImpulse({
                x:(Math.random()-0.5)*impulseScale,
                y:Math.random()*impulseScale*0.9 + 18,
                z:(Math.random()-0.5)*impulseScale
            }, true);
            rb.applyTorqueImpulse({
                x:(Math.random()-0.5)*400,
                y:(Math.random()-0.5)*400,
                z:(Math.random()-0.5)*400
            }, true);
            this._foreignDebris.push({ body: rb, mesh, spawnTime: performance.now(), lifeMs: 8000 + Math.random()*4000 });
        }
    }

    // Create obstacle (unchanged)
    createObstacle(scene) {
        const obsSize = {x:1,y:1,z:1};
        const obsRBDesc = this.RAPIER.RigidBodyDesc.fixed().setTranslation(0,1,-25);
        this.obstacleBody = this.world.createRigidBody(obsRBDesc);
        const obsCol = this.RAPIER.ColliderDesc.cuboid(obsSize.x,obsSize.y,obsSize.z).setRestitution(0.2).setFriction(0.8);
        this.world.createCollider(obsCol, this.obstacleBody);

        const boxGeo = new THREE.BoxGeometry(obsSize.x*2, obsSize.y*2, obsSize.z*2);
        const boxMat = new THREE.MeshStandardMaterial({color:0xffff00});
        this.obstacleMesh = new THREE.Mesh(boxGeo, boxMat);
        this.obstacleMesh.position.set(0,0.5,-25);
        scene.add(this.obstacleMesh);
    }
}