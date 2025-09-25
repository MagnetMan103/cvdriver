// physics-manager.js - Handles physics simulation, collisions, and input processing
import * as THREE from 'three';
import { Car } from './playerobject.js';
import { getLatestHandData } from './camera.js';
import { audio } from './audio.js';

export class PhysicsManager {
    constructor() {
        this.RAPIER = null;
        this.world = null;
        this.eventQueue = null;
        this.car = null;
        this.player = null;
        this.obstacleBody = null;
        this.obstacleMesh = null;

        // NPC Car management
        this.npcCars = []; // Array of NPC car objects from WorldManager
        this.npcCarBodies = new Map(); // Map of NPC car objects to their physics bodies
        this.launchedNpcCars = new Set(); // Track which NPCs have been launched
        this.carHitCallback = null; // Callback function for when player hits a car

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
    }

    async init(scene) {
        this.RAPIER = await import('https://cdn.skypack.dev/@dimforge/rapier3d-compat');
        await this.RAPIER.init();

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

    // ===== NPC Car Physics =====
    createNpcCarBody(npcCar) {
        if (!npcCar || !npcCar.mesh) {
            console.warn('[NPC Physics] Invalid npcCar or mesh');
            return;
        }

        const position = npcCar.mesh.position;
        const rotation = npcCar.mesh.rotation;

        console.log(`[NPC Physics] Creating body at (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`);

        // Create kinematic rigid body for NPC car (easier to control movement)
        const rigidBodyDesc = this.RAPIER.RigidBodyDesc.kinematicPositionBased()
            .setTranslation(position.x, position.y, position.z);

        // Set initial rotation
        const quat = new THREE.Quaternion();
        quat.setFromEuler(new THREE.Euler(rotation.x, rotation.y, rotation.z));
        rigidBodyDesc.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });

        const rigidBody = this.world.createRigidBody(rigidBodyDesc);

        // Create box collider for NPC car (similar to car dimensions)
        const colliderDesc = this.RAPIER.ColliderDesc.cuboid(1.0, 0.5, 2.0) // width, height, length
            .setRestitution(0.3)
            .setFriction(0.8);

        const collider = this.world.createCollider(colliderDesc, rigidBody);

        // Store the body reference
        npcCar.body = rigidBody;
        this.npcCarBodies.set(npcCar, rigidBody);

        console.log(`[NPC Physics] Created body with handle ${collider.handle}`);

        return rigidBody;
    }

    removeNpcCarBody(body) {
        if (!body) return;

        // Find and remove from our tracking structures
        for (const [npcCar, storedBody] of this.npcCarBodies.entries()) {
            if (storedBody === body) {
                this.npcCarBodies.delete(npcCar);
                this.launchedNpcCars.delete(npcCar);
                break;
            }
        }

        // Remove from physics world
        this.world.removeRigidBody(body);
    }

    updateNpcCar(npcCar, deltaTime) {
        if (!npcCar.body || !npcCar.mesh) return;

        // If car has been launched, switch to dynamic mode and let physics handle it
        if (this.launchedNpcCars.has(npcCar)) {
            const currentPos = npcCar.body.translation();
            npcCar.mesh.position.set(currentPos.x, currentPos.y, currentPos.z);
            const currentRot = npcCar.body.rotation();
            npcCar.mesh.quaternion.set(currentRot.x, currentRot.y, currentRot.z, currentRot.w);
            return;
        }

        const body = npcCar.body;
        const currentPos = body.translation();

        // Simple movement in -Z direction (forward)
        const moveSpeed = npcCar.speed * deltaTime;
        const newZ = currentPos.z - moveSpeed; // Move forward

        // Slight lateral movement for variety
        const lateralDrift = Math.sin(performance.now() * 0.001 + npcCar.spawnZ) * 0.5 * deltaTime;
        const newX = currentPos.x + lateralDrift;

        // Keep Y at proper height
        const physicsY = 2.0;

// Update position using kinematic body
        body.setNextKinematicTranslation({
            x: newX,
            y: physicsY,
            z: newZ
        });

        // Face forward (-Z direction) with slight variation
        const facingAngle = Math.sin(performance.now() * 0.0005 + npcCar.spawnZ) * 0.1;
        const quat = new THREE.Quaternion();
        quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), facingAngle);

        body.setNextKinematicRotation({
            x: quat.x,
            y: quat.y,
            z: quat.z,
            w: quat.w
        });

        // Update mesh to match physics body
        const finalPos = body.translation();
        const visualYOffset = -1.68;
        npcCar.mesh.position.set(finalPos.x, finalPos.y + visualYOffset, finalPos.z);
        const finalRot = body.rotation();
        npcCar.mesh.quaternion.set(finalRot.x, finalRot.y, finalRot.z, finalRot.w);
    }

    // Register NPC cars from WorldManager
    registerNpcCars(npcCars) {
        this.npcCars = npcCars;
    }

    // Set callback function for when player hits a car
    setCarHitCallback(callback) {
        this.carHitCallback = callback;
    }

    // Launch NPC car using Manhattan distance collision detection
    checkNpcCollisions() {
        if (!this.car || !this.npcCars.length) return;

        const playerPos = this.car.position;
        const collisionDistance = 4.0; // Manhattan distance threshold

        for (const npcCar of this.npcCars) {
            // Skip if already launched or no mesh
            if (this.launchedNpcCars.has(npcCar) || !npcCar.mesh) continue;

            const npcPos = npcCar.mesh.position;

            // Calculate Manhattan distance
            const manhattanDistance = Math.abs(playerPos.x - npcPos.x) +
                Math.abs(playerPos.y - npcPos.y) +
                Math.abs(playerPos.z - npcPos.z);

            if (manhattanDistance < collisionDistance) {
                // Play pew just before we modify physics to minimize perceived latency
                try { audio.playPew(0.85); } catch {}
                this.launchNpcCar(npcCar);

                // Call the car hit callback to update score and show popup
                if (this.carHitCallback) {
                    this.carHitCallback();
                }
            }
        }
    }

    launchNpcCar(npcCar) {
        if (!npcCar || !npcCar.body || this.launchedNpcCars.has(npcCar)) return;

        console.log('[NPC Physics] Launching NPC car!');

        // Mark as launched
        this.launchedNpcCars.add(npcCar);

        // Remove old kinematic body and create dynamic one
        const currentPos = npcCar.body.translation();
        const currentRot = npcCar.body.rotation();

        // Remove old body
        this.npcCarBodies.delete(npcCar);
        this.world.removeRigidBody(npcCar.body);

        // Create new dynamic body
        const rigidBodyDesc = this.RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(currentPos.x, currentPos.y, currentPos.z)
            .setRotation(currentRot);

        const newBody = this.world.createRigidBody(rigidBodyDesc);

        // Create collider
        const colliderDesc = this.RAPIER.ColliderDesc.cuboid(1.0, 0.5, 2.0)
            .setRestitution(0.5)
            .setFriction(0.7)
            .setDensity(1.0);

        this.world.createCollider(colliderDesc, newBody);

        // Update tracking
        npcCar.body = newBody;
        this.npcCarBodies.set(npcCar, newBody);

        // Launch the NPC car high into the air with random velocity
        const launchForce = {
            x: (Math.random() - 0.5) * 50, // Random horizontal force
            y: 40 + Math.random() * 30,    // High upward force (40-70)
            z: (Math.random() - 0.5) * 50  // Random horizontal force
        };

        newBody.setLinvel(launchForce, true);

        // Add random angular velocity for spinning effect
        const angularVel = {
            x: (Math.random() - 0.5) * 15,
            y: (Math.random() - 0.5) * 15,
            z: (Math.random() - 0.5) * 15
        };

        newBody.setAngvel(angularVel, true);

        console.log('[NPC Physics] NPC car launched with force:', launchForce);
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
            if (h1 === carHandle) {
                other = h2;
            } else if (h2 === carHandle) {
                other = h1;
            }

            if (other == null) return;

            // No groundHandles check needed
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

            // Check NPC collisions using Manhattan distance
            this.checkNpcCollisions();

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
            if (this.car.position.z > 1) {
                this.car.position.z = 1;
                this.car.body.setTranslation({ x: this.car.position.x, y: this.car.position.y, z: 1}, true);
                const linvel = this.car.body.linvel();
                if (linvel.z > 0) {
                    this.car.body.setLinvel({ x: linvel.x, y: linvel.y, z: 0 }, true);
                }
            }


            // Handle collisions
            this.handleCollisions();

            // Check obstacle collision (if obstacle exists)
            this.checkObstacleCollision();

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