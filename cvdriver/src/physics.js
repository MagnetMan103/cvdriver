// physics-manager.js - Handles physics simulation, collisions, and input processing
import * as THREE from 'three';
import { Car } from './playerobject.js';
import { NpcCar } from './npc.js';
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

        // World reference for road sampling
        this.worldManager = null;
        this.roadWidth = 12; // must match WorldManager.createRoadStrip default

    // NPCs
    this.npcs = [];
    this.nextNpcSpawnZ = 0; // first spawn when player z < -60
    this.npcSpawnInterval = 60; // distance between spawns along -Z
        this.npcLanes = [-3.5, 0, 3.5]; // lane offsets from road center (keep inside 6)

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
        // Do not explode the player car on any collision by default; we'll control behavior
        this.car.explodeOnAnyCollision = false;
        this.player = this.car.carGroup;

        return {
            car: this.car,
            player: this.player
        };
    }

    setWorldManager(worldManager) {
        this.worldManager = worldManager;
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
            // If collided with an NPC, launch it into the air. Do not apply impulses to player
            const npc = this.npcs.find(n => n.getColliderHandle && n.getColliderHandle() === other);
            if (npc) {
                // Optional: check relative speeds; if player is already faster, leave player untouched
                try {
                    const pVel = this.car.body.linvel();
                    const nVel = npc.body.linvel ? npc.body.linvel() : {x:0,y:0,z:-npc.speed};
                    const pSpeed = Math.hypot(pVel.x, pVel.y, pVel.z);
                    const nSpeed = Math.hypot(nVel.x, nVel.y, nVel.z);
                    // We never apply impulse to player; only ensure NPC launches
                    if (pSpeed >= nSpeed) {
                        npc.launch();
                    } else {
                        npc.launch();
                    }
                } catch(e) {
                    npc.launch();
                }
                return;
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

            // Spawn/update NPCs on fixed step to keep determinism
            this.updateNpcs(this.FIXED_TIMESTEP);

            // Fallback: proximity-based launch in case collision events are missed
            this.checkNpcProximityCollision();

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

    // ---------------- NPC Management ----------------
    spawnNpc() {
        const scene = this.player?.parent; // WorldManager scene already used to create player
        if (!scene) return;
        const laneOffset = this.npcLanes[Math.floor(Math.random()*this.npcLanes.length)];
        // Spawn ahead of player along -Z
        const playerZ = this.car?.position?.z ?? 0;
        const z = playerZ - 80 - Math.random()*40; // between -80 and -120 in front
        const speed = 10 + Math.random()*8;
        const color = new THREE.Color().setHSL(Math.random(), 0.6, 0.5).getHex();
        const npc = new NpcCar(scene, this.world, this.RAPIER, {
            y: 0.5,
            z,
            speed,
            color,
            // Provide road sampler and lane offset so NPC rides on road
            sampleAtZ: this.sampleRoadAtZ.bind(this),
            laneOffset
        });
        this.npcs.push(npc);
    }

    updateNpcs(dt) {
        if (!this.car) return;
        // Spawn based on distance progressed
        const playerZ = this.car.position.z;
        if (playerZ < this.nextNpcSpawnZ - this.npcSpawnInterval) {
            this.nextNpcSpawnZ -= this.npcSpawnInterval;
            // Chance to spawn 1-2
            const count = 1 + (Math.random() < 0.35 ? 1 : 0);
            for (let i=0;i<count;i++) this.spawnNpc();
        }

        // Update and cleanup
        for (let i=this.npcs.length-1;i>=0;i--) {
            const n = this.npcs[i];
            n.update(dt);
            if (n.isFarBehind(playerZ, 40)) {
                n.dispose();
                this.npcs.splice(i,1);
            }
        }
    }

    // Proximity/AABB fallback detection between player and NPC
    checkNpcProximityCollision() {
        if (!this.car || !this.npcs.length) return;
        const p = this.car.position; // THREE.Vector3 mirrored from Rapier
        // Player half-extents must match Car collider: x=1.0, z=2.0
        const pHx = 1.0, pHz = 2.0;
        for (const npc of this.npcs) {
            if (!npc || npc.exploded || npc.launched) continue;
            const npos = npc.group.position;
            const dx = Math.abs(p.x - npos.x);
            const dz = Math.abs(p.z - npos.z);
            const nHx = (npc.width || 2.0) * 0.5;
            const nHz = (npc.length || 4.0) * 0.5;
            if (dx < (pHx + nHx) * 0.95 && dz < (pHz + nHz) * 0.95) {
                // Same rule: never add impulse to player; fling only NPC
                npc.launch();
            }
        }
    }

    // Sample the road center and forward direction at given Z by interpolating roadSegments
    sampleRoadAtZ(z) {
        const wm = this.worldManager;
        if (!wm || !wm.roadSegments || wm.roadSegments.length < 2) {
            // Fallback: straight road along -Z at x=0
            return {
                center: new THREE.Vector3(0, 0, z),
                forward: new THREE.Vector3(0, 0, -1)
            };
        }
        const pts = wm.roadSegments;
        // Find segment where z is between pts[i] and pts[i+1] (z decreases along the road)
        let i = 0;
        while (i < pts.length - 1 && !(pts[i].z >= z && pts[i+1].z <= z)) i++;
        if (i >= pts.length - 1) {
            // Out of range: clamp to last or first
            if (z < pts[pts.length-1].z) {
                const p0 = new THREE.Vector3(pts[pts.length-2].x, 0, pts[pts.length-2].z);
                const p1 = new THREE.Vector3(pts[pts.length-1].x, 0, pts[pts.length-1].z);
                const f = p1.clone().sub(p0).normalize();
                return { center: p1, forward: f.lengthSq()>0?f:new THREE.Vector3(0,0,-1) };
            } else {
                const p0 = new THREE.Vector3(pts[0].x, 0, pts[0].z);
                const p1 = new THREE.Vector3(pts[1].x, 0, pts[1].z);
                const f = p1.clone().sub(p0).normalize();
                return { center: p0, forward: f.lengthSq()>0?f:new THREE.Vector3(0,0,-1) };
            }
        }
        const a = pts[i];
        const b = pts[i+1];
        const az = a.z, bz = b.z;
        const t = (az - z) / Math.max(1e-6, (az - bz)); // 0..1
        const x = a.x + (b.x - a.x) * t;
        const y = 0;
        const zz = a.z + (b.z - a.z) * t;
        const center = new THREE.Vector3(x, y, zz);
        let forward = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
        if (forward.lengthSq() === 0) forward = new THREE.Vector3(0,0,-1);
        return { center, forward };
    }
}