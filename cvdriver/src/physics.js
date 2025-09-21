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
        this.scene = null;  // Store scene reference for creating flying cars
        
        // Track flying cars for cleanup
        this.flyingCars = [];  // Array of { body, mesh, createdTime }

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
            if (h1 === carHandle) {
                other = h2;
            } else if (h2 === carHandle) {
                other = h1;
            }

            if (other == null) return;

            const otherCollider = this.world.getCollider(other);
            if (otherCollider) {
                // Direct collider tag check
                if (otherCollider.__npcCarRef) {
                    console.log('[Physics] Player collided with NPC collider', other, 'destroying NPC');
                    otherCollider.__npcCarRef.destroy();
                } else {
                    const otherRB = otherCollider.parent();
                    if (otherRB && otherRB.__npcCarRef) {
                        console.log('[Physics] Player collided with NPC body', otherRB.handle, 'destroying NPC');
                        otherRB.__npcCarRef.destroy();
                    } else if (otherRB && otherRB !== this.car.body && otherRB.bodyType && otherRB.bodyType() !== this.RAPIER.RigidBodyType.Fixed) {
                        // Fallback flying car logic remains
                        console.log('[Physics] Collision with non-NPC dynamic body, spawning flying replacement');
                        const currentPos = otherRB.translation();
                        const currentRot = otherRB.rotation();
                        try { this.world.removeRigidBody(otherRB); } catch (e) { console.warn('Failed to remove rigid body:', e); }
                        const flyingCarResult = this.createFlyingCar(currentPos, currentRot);
                        if (flyingCarResult && flyingCarResult.body) {
                            const newRB = flyingCarResult.body;
                            const carMesh = flyingCarResult.mesh;
                            const speed = this.car.getSpeed ? this.car.getSpeed() : 0;
                            const initialYBoost = 5 + Math.random() * 3;
                            const newPos = { x: currentPos.x, y: currentPos.y + initialYBoost, z: currentPos.z };
                            newRB.setTranslation(newPos, true);
                            const flyingCarData = { body: newRB, mesh: carMesh, initialY: newPos.y, targetY: newPos.y + 20 + Math.random() * 15, riseSpeed: 15 + Math.random() * 10, startTime: performance.now(), duration: 2000 + Math.random() * 1000 };
                            this.flyingCars.push(flyingCarData);
                            const lateralSpeed = 20 + Math.random() * 25 + speed * 0.8;
                            const lateralAngle = Math.random() * Math.PI * 2;
                            const lateralX = Math.cos(lateralAngle) * lateralSpeed;
                            const lateralZ = Math.sin(lateralAngle) * lateralSpeed;
                            newRB.setLinvel({ x: lateralX, y: 0, z: lateralZ }, true);
                            if (newRB.setGravityScale) newRB.setGravityScale(0, true);
                            newRB.setAngvel({ x: (Math.random() - 0.5) * 15, y: (Math.random() - 0.5) * 10, z: (Math.random() - 0.5) * 15 }, true);
                        }
                    }
                }
            }

            if (this.car.shouldExplodeFromCollision(other, new Set())) {
                console.log('[Physics] Player car exploding due to collision with handle', other);
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
            
            // Clean up old flying cars
            this.cleanupFlyingCars();

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

    cleanupFlyingCars() {
        if (!this.flyingCars.length) return;
        
        const now = performance.now();
        const maxLifetime = 10000; // 10 seconds
        const maxDistance = 300;   // 300 units from origin
        
        for (let i = this.flyingCars.length - 1; i >= 0; i--) {
            const flyingCar = this.flyingCars[i];
            
            // Handle manual Y coordinate animation
            if (flyingCar.startTime && flyingCar.duration) {
                const elapsed = now - flyingCar.startTime;
                const progress = Math.min(1, elapsed / flyingCar.duration);
                
                if (progress < 1) {
                    // Animate Y coordinate manually
                    const currentY = flyingCar.initialY + (flyingCar.targetY - flyingCar.initialY) * progress;
                    const currentPos = flyingCar.body.translation();
                    
                    flyingCar.body.setTranslation({
                        x: currentPos.x,
                        y: currentY,
                        z: currentPos.z
                    }, true);
                }
            }
            
            // Check for cleanup conditions
            const age = flyingCar.createdTime ? (now - flyingCar.createdTime) : (now - flyingCar.startTime);
            const position = flyingCar.body.translation();
            const distanceFromOrigin = Math.sqrt(position.x * position.x + position.y * position.y + position.z * position.z);
            
            // Remove if too old, too far away, or fallen too low
            if (age > maxLifetime || distanceFromOrigin > maxDistance || position.y < -50) {
                try {
                    // Remove physics body
                    this.world.removeRigidBody(flyingCar.body);
                    
                    // Remove visual mesh
                    if (flyingCar.mesh && this.scene) {
                        this.scene.remove(flyingCar.mesh);
                    }
                } catch (e) {
                    console.warn('Failed to cleanup flying car:', e);
                }
                
                // Remove from tracking array
                this.flyingCars.splice(i, 1);
            }
        }
    }

    // Create a new flying car at the specified position
    createFlyingCar(position, rotation = null) {
        if (!this.world || !this.RAPIER) return null;
        
        try {
            // Create new dynamic rigid body at the collision position
            const rbDesc = this.RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(position.x, position.y, position.z)
                .setCanSleep(false);
            
            if (rotation) {
                rbDesc.setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w });
            }
            
            const newBody = this.world.createRigidBody(rbDesc);
            
            // Create collider for the new car
            const colliderDesc = this.RAPIER.ColliderDesc.cuboid(0.9, 0.6, 1.8)
                .setFriction(0.8)
                .setRestitution(0.1);
            
            const newCollider = this.world.createCollider(colliderDesc, newBody);
            
            // Set physics properties optimized for flying
            newBody.setLinearDamping(0.1);   // Less air resistance for farther flight
            newBody.setAngularDamping(0.5);  // Allow more spinning
            
            // Create visual representation
            if (this.scene) {
                const carGroup = new THREE.Group();
                
                // Car body
                const bodyGeometry = new THREE.BoxGeometry(1.8, 0.6, 3.6);
                const bodyMaterial = new THREE.MeshLambertMaterial({ 
                    color: new THREE.Color().setHSL(Math.random(), 0.6, 0.45) 
                });
                const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
                bodyMesh.position.y = 0.3;
                carGroup.add(bodyMesh);
                
                // Car cabin/windshield
                const cabinGeometry = new THREE.BoxGeometry(1.4, 0.4, 1.2);
                const cabinMaterial = new THREE.MeshLambertMaterial({ 
                    color: 0x222244, 
                    transparent: true, 
                    opacity: 0.7 
                });
                const cabinMesh = new THREE.Mesh(cabinGeometry, cabinMaterial);
                cabinMesh.position.set(0, 0.6, 0.3);
                carGroup.add(cabinMesh);
                
                carGroup.position.set(position.x, position.y, position.z);
                if (rotation) {
                    carGroup.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
                }
                
                this.scene.add(carGroup);
                
                // Return both body and mesh for external tracking
                return { body: newBody, mesh: carGroup };
            }
            
            return newBody;
            
        } catch (error) {
            console.error('Failed to create flying car:', error);
            return null;
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