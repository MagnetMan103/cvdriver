import * as THREE from 'three';

class Car {
    constructor(scene, world, rapier, params = {}) {
        if (!world) throw new Error('Rapier world instance required: new Car(scene, world, rapier)');
        if (!rapier) throw new Error('Pass shared RAPIER instance: new Car(scene, world, RAPIER)');
        this.scene = scene;
        this.world = world;
        this.RAPIER = rapier;

        // Visual orientation state (kept for convenience)
        this.rotation = 0;

        // Car parameters (tunable)
        this.accelerationForce = 250; // boosted for clearer motion
        this.brakeForce = 150;
        this.turnSpeed = 2.5;
        this.minSteerFactor = 0.25;
        this.baseGrip = 2.0;
        this.maxGrip = 7.0;
        this.driftGripMultiplier = 0.3;
        this.driftSlipThreshold = 0.25;
        this.handbrakeYawBoost = 1.2;

        // Runtime vectors mirrored from physics each frame
        this.position = new THREE.Vector3();
        this.velocity = new THREE.Vector3();
        this.acceleration = new THREE.Vector3(); // (kept for API compatibility, no longer integrated manually)

        this.controls = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            handbrake: false
        };
        // External analog control (overrides keyboard when provided)
        this.analog = {
            steering: null, // -1..1
            throttle: null  // 0..1 (positive only for now)
        };

        this.createCarMesh();
        this._createPhysicsBody();
        this.setupControls();
        this.exploded = false;
        this.debris = [];
        this.explodeOnAnyCollision = true;
        this.minExplodeSpeed = 0; // m/s threshold before collision can trigger explosion

        // Smoke system (unchanged)
        this.smokeParams = {
            enabled: true,
            baseSpawnInterval: 0.01,
            minSpeed: 4,
            slipThreshold: 0.15,
            particleLife: 0.7,
            startSize: 0.28,
            endSize: 1.4,
            upwardSpeed: 1.1,
            upwardAccel: 5,
            lateralDampen: 0.9,
            fadePower: 1.8,
            maxParticlesPerCycle: 10,
            slipToDensity: 18,
            maxPoolSize: 250,
            colorVariance: 0.15,
            sizeJitter: 0.55,
            spinSpeed: 2.5,
            stopGrace: 0.08,
            baseSpread: 0.25,
            slipSpreadFactor: 0.4,
            rearWheelOffset: 1.5,
            lateralWheelOffset: 1.1,
            lateralJitter: 0.5,
            longitudinalJitter: 0.4,
            shapeWobbleAmp: 0.25,
            shapeWobbleFreqMin: 2.0,
            shapeWobbleFreqMax: 5.0
        };
        this._smokeTimeAccum = 0;
        this.smokeParticles = [];
        this._smokePool = [];
        this._initSmokeResources();
        this._lastSteerTime = 0;
    }

    static async initRapier() {
        if (!Car._rapierReady) {
            await RAPIER.init();
            Car._rapierReady = true;
        }
    }

    _createPhysicsBody() {
        const RAPIER = this.RAPIER;
        const rbDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(0, 2, 0)
            .setCanSleep(false); // keep always awake while testing movement
        this.body = this.world.createRigidBody(rbDesc);
        const halfExtents = { x: 1.0, y: 1, z: 2.0 };
        const colliderDesc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
            .setFriction(0.9)
            .setRestitution(0.0)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        this.collider = this.world.createCollider(colliderDesc, this.body);
        this.body.setLinearDamping(0.15);
        this.body.setAngularDamping(1.0);
    }

    _initSmokeResources() {
        const variantCount = 5;
        const size = 96;
        this.smokeTextures = [];
        for (let v=0; v<variantCount; v++) {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = size;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0,0,size,size);
            const blobNum = 5 + Math.floor(Math.random()*4);
            for (let b=0; b<blobNum; b++) {
                const cx = (0.3 + Math.random()*0.4) * size;
                const cy = (0.3 + Math.random()*0.4) * size;
                const rad = (0.18 + Math.random()*0.22) * size;
                const g = ctx.createRadialGradient(cx, cy, rad*0.1, cx, cy, rad);
                const alphaCore = 0.55 + Math.random()*0.25;
                g.addColorStop(0, `rgba(255,255,255,${alphaCore})`);
                g.addColorStop(0.6, 'rgba(255,255,255,0.25)');
                g.addColorStop(1, 'rgba(255,255,255,0)');
                ctx.globalCompositeOperation = 'lighter';
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(cx, cy, rad, 0, Math.PI*2);
                ctx.fill();
            }
            const vignette = ctx.createRadialGradient(size/2, size/2, size*0.2, size/2, size/2, size*0.5);
            vignette.addColorStop(0, 'rgba(255,255,255,0.15)');
            vignette.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = vignette;
            ctx.fillRect(0,0,size,size);
            const texture = new THREE.CanvasTexture(canvas);
            texture.minFilter = THREE.LinearFilter;
            this.smokeTextures.push(texture);
        }
        this.smokeBaseMaterial = new THREE.SpriteMaterial({ map: this.smokeTextures[0], transparent: true, depthWrite: false });
    }

    createCarMesh() {
        this.carGroup = new THREE.Group();
        const bodyGeometry = new THREE.BoxGeometry(2, 0.6, 4);
        const bodyMaterial = new THREE.MeshLambertMaterial({ color: 0xff4444 });
        const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
        bodyMesh.position.y = 0.3;
        bodyMesh.castShadow = true;
        this.carGroup.add(bodyMesh);

        const windshieldGeometry = new THREE.BoxGeometry(1.8, 0.4, 1.5);
        const windshieldMaterial = new THREE.MeshLambertMaterial({
            color: 0x4444ff,
            transparent: true,
            opacity: 0.7
        });
        const windshieldMesh = new THREE.Mesh(windshieldGeometry, windshieldMaterial);
        windshieldMesh.position.set(0, 0.7, 0.5);
        windshieldMesh.castShadow = true;
        this.carGroup.add(windshieldMesh);

        const wheelGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 8);
        const wheelMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 });

        this.frontLeftWheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
        this.frontLeftWheel.position.set(-1.1, 0, 1.2);
        this.frontLeftWheel.rotation.z = Math.PI / 2;
        this.frontLeftWheel.castShadow = true;
        this.carGroup.add(this.frontLeftWheel);

        this.frontRightWheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
        this.frontRightWheel.position.set(1.1, 0, 1.2);
        this.frontRightWheel.rotation.z = Math.PI / 2;
        this.frontRightWheel.castShadow = true;
        this.carGroup.add(this.frontRightWheel);

        this.rearLeftWheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
        this.rearLeftWheel.position.set(-1.1, 0, -1.2);
        this.rearLeftWheel.rotation.z = Math.PI / 2;
        this.rearLeftWheel.castShadow = true;
        this.carGroup.add(this.rearLeftWheel);

        this.rearRightWheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
        this.rearRightWheel.position.set(1.1, 0, -1.2);
        this.rearRightWheel.rotation.z = Math.PI / 2;
        this.rearRightWheel.castShadow = true;
        this.carGroup.add(this.rearRightWheel);

        this.scene.add(this.carGroup);
    }

    setupControls() {
        document.addEventListener('keydown', (event) => {
            switch(event.code) {
                case 'KeyW':
                case 'ArrowUp':
                    if (!this.controls.forward) console.debug('[Car] Forward pressed');
                    this.controls.forward = true;
                    break;
                case 'KeyS':
                case 'ArrowDown':
                    if (!this.controls.backward) console.debug('[Car] Backward pressed');
                    this.controls.backward = true;
                    break;
                case 'KeyA':
                case 'ArrowLeft':
                    if (!this.controls.left) console.debug('[Car] Left pressed');
                    this.controls.left = true;
                    break;
                case 'KeyD':
                case 'ArrowRight':
                    if (!this.controls.right) console.debug('[Car] Right pressed');
                    this.controls.right = true;
                    break;
                case 'Space':
                    if (!this.controls.handbrake) console.debug('[Car] Handbrake pressed');
                    this.controls.handbrake = true;
                    event.preventDefault();
                    break;
            }
            if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(event.code)) event.preventDefault();
        });
        document.addEventListener('keyup', (event) => {
            switch(event.code) {
                case 'KeyW':
                case 'ArrowUp':
                    if (this.controls.forward) console.debug('[Car] Forward released');
                    this.controls.forward = false;
                    break;
                case 'KeyS':
                case 'ArrowDown':
                    if (this.controls.backward) console.debug('[Car] Backward released');
                    this.controls.backward = false;
                    break;
                case 'KeyA':
                case 'ArrowLeft':
                    if (this.controls.left) console.debug('[Car] Left released');
                    this.controls.left = false;
                    break;
                case 'KeyD':
                case 'ArrowRight':
                    if (this.controls.right) console.debug('[Car] Right released');
                    this.controls.right = false;
                    break;
                case 'Space':
                    if (this.controls.handbrake) console.debug('[Car] Handbrake released');
                    this.controls.handbrake = false;
                    break;
            }
            if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(event.code)) event.preventDefault();
        });
    }

    _applyInputForces(deltaTime) {
        // Obtain forward vector from current orientation
        const rot = this.body.rotation();
        const quat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
        const forward = new THREE.Vector3(0,0,-1).applyQuaternion(quat).normalize();
        const right = new THREE.Vector3(1,0,0).applyQuaternion(quat).normalize();

        // Engine / brake with optional analog
        let throttleInput = 0;
        if (this.analog.throttle != null) {
            throttleInput = Math.max(0, Math.min(1, this.analog.throttle));
        } else {
            if (this.controls.forward) throttleInput += 1;
            if (this.controls.backward) throttleInput -= 1; // supports simple reverse
        }
        if (throttleInput !== 0) {
            const impulse = forward.clone().multiplyScalar(this.accelerationForce * throttleInput * deltaTime);
            this.body.applyImpulse(impulse, true);
        }

        // Steering via angular velocity (yaw) with optional analog
        let steerInput = 0;
        if (this.analog.steering != null) {
            steerInput = Math.max(-1, Math.min(1, this.analog.steering));
        } else {
            if (this.controls.left) steerInput += 1;
            if (this.controls.right) steerInput -= 1;
        }

        if (steerInput !== 0) {
            this._lastSteerTime = performance.now() / 1000;
        }



        const linvel = this.body.linvel();
        const velVec = new THREE.Vector3(linvel.x, linvel.y, linvel.z);
        const speed = velVec.length();

        if (speed > 0.05 && steerInput !== 0) {
            let steerFactor = Math.min(1, Math.max(this.minSteerFactor, speed / 8));
            if (this.controls.handbrake) steerFactor *= (1 + this.handbrakeYawBoost);
            const targetYawVel = steerInput * this.turnSpeed * steerFactor;
            const angvel = this.body.angvel();
            // Blend to target (simple approach)
            const blend = 0.6;
            const newYaw = THREE.MathUtils.lerp(angvel.y, targetYawVel, blend);
            this.body.setAngvel({ x: angvel.x * 0.5, y: newYaw, z: angvel.z * 0.5 }, true);
        }
    }

    // Allow external modules to set analog steering (-1..1) and throttle (0..1)
    setAnalogControls(steering, throttle) {
        this.analog.steering = steering;
        this.analog.throttle = throttle;
    }

    _applyGripAndDrift(deltaTime) {
        const linvel = this.body.linvel();
        const speed = Math.sqrt(linvel.x*linvel.x + linvel.y*linvel.y + linvel.z*linvel.z);
        if (speed < 0.05) {
            // Still mirror velocity so UI shows small movement onset
            this.velocity.set(linvel.x, linvel.y, linvel.z);
            return;
        }

        const rot = this.body.rotation();
        const quat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
        const forward = new THREE.Vector3(0,0,-1).applyQuaternion(quat).normalize();

        const velVec = new THREE.Vector3(linvel.x, linvel.y, linvel.z);
        const forwardSpeed = velVec.dot(forward);
        const forwardComp = forward.clone().multiplyScalar(forwardSpeed);
        const lateralComp = velVec.clone().sub(forwardComp);
        const lateralMag = lateralComp.length();
        const slip = lateralMag / speed;

        let grip = THREE.MathUtils.lerp(this.maxGrip, this.baseGrip, slip);
        if (slip > this.driftSlipThreshold) grip *= 0.7;
        if (this.controls.handbrake) grip *= this.driftGripMultiplier;

        const bleed = Math.min(1, grip * deltaTime);
        lateralComp.multiplyScalar(1 - bleed);
        const newVel = forwardComp.add(lateralComp);

        // Update linear velocity (preserve any vertical component)
        newVel.y = velVec.y;
        this.body.setLinvel({ x: newVel.x, y: newVel.y, z: newVel.z }, true);

        // Mirror for smoke & API
        this.velocity.copy(newVel);
        if (Math.random() < 0.02) {
            console.debug('[Car] linvel', linvel.x.toFixed(2), linvel.y.toFixed(2), linvel.z.toFixed(2));
        }
    }

    update(deltaTime, worldOverride, eventQueue) {
        if (this.exploded) {
            // Update debris meshes to follow their rigid bodies
            for (const piece of this.debris) {
                const t = piece.body.translation();
                piece.mesh.position.set(t.x, t.y, t.z);
                const r = piece.body.rotation();
                piece.mesh.quaternion.set(r.x, r.y, r.z, r.w);
            }
            return; // Skip normal car physics while exploded
        }
        const world = worldOverride || this.world;
        // Set per-frame timestep (Rapier uses fixed default if not set)
        world.timestep = deltaTime;

        // Phase 1: Apply input forces before stepping
        this._applyInputForces(deltaTime);

        // Step physics (optionally with event queue for collisions)
        if (eventQueue) world.step(eventQueue); else world.step();

        // Phase 2: Grip correction & drift shaping after physics step
        this._applyGripAndDrift(deltaTime);

        // Sync transform to Three.js
        const t = this.body.translation();
        const r = this.body.rotation();
        this.position.set(t.x, t.y, t.z);
        const quat = new THREE.Quaternion(r.x, r.y, r.z, r.w);
        const euler = new THREE.Euler().setFromQuaternion(quat, 'YXZ');
        this.rotation = euler.y;

        this.carGroup.position.copy(this.position);
        this.carGroup.quaternion.copy(quat);

        // For smoke forward vector (match original sign convention)
        const forward = new THREE.Vector3(0,0,-1).applyQuaternion(quat).normalize();

        // Update smoke using current velocity
        this._updateSmoke(deltaTime, forward);
    }

    explode() {
        if (this.exploded) return;
        this.exploded = true;
        this.carGroup.visible = false;
        // Spawn debris pieces
        const count = 12;
        for (let i=0;i<count;i++) {
            const size = 0.3 + Math.random()*0.2;
            const geo = new THREE.BoxGeometry(size,size,size);
            const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(Math.random(),0.6,0.5) });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(this.position);
            this.scene.add(mesh);
            const rbDesc = this.RAPIER.RigidBodyDesc.dynamic().setTranslation(this.position.x, this.position.y + 0.5, this.position.z);
            const body = this.world.createRigidBody(rbDesc);
            const colDesc = this.RAPIER.ColliderDesc.cuboid(size/2,size/2,size/2).setRestitution(0.4).setFriction(0.6);
            this.world.createCollider(colDesc, body);
            // Impulse outward
            body.applyImpulse({
                x:(Math.random()-0.5)*40,
                y:Math.random()*25 + 10,
                z:(Math.random()-0.5)*40
            }, true);
            this.debris.push({ mesh, body });
        }
        // Burst of smoke
        const forward = this.getForwardDirection();
        for (let j=0;j<60;j++) this._spawnSmokeParticle(forward, 1.0);
        setTimeout(()=>this.resetAfterExplosion(), 3500);
    }

    getColliderHandle() {
        return this.collider ? this.collider.handle : null;
    }

    getSpeed() { return this.velocity.length(); }

    shouldExplodeFromCollision(otherHandle, ignoreHandlesSet) {
        if (!this.explodeOnAnyCollision) return false;
        if (this.exploded) return false;
        if (ignoreHandlesSet && otherHandle && ignoreHandlesSet.has(otherHandle)) return false;
        if (this.getSpeed() < this.minExplodeSpeed) return false;
        return true;
    }

    resetAfterExplosion() {
        // Clean debris
        for (const piece of this.debris) {
            try { this.world.removeRigidBody(piece.body); } catch(e) {}
            this.scene.remove(piece.mesh);
        }
        this.debris.length = 0;
        // Reset car body
        this.body.setTranslation({x:0,y:0.5,z:0}, true);
        this.body.setLinvel({x:0,y:0,z:0}, true);
        this.body.setAngvel({x:0,y:0,z:0}, true);
        this.velocity.set(0,0,0);
        this.carGroup.position.set(0,0.5,0);
        this.carGroup.quaternion.identity();
        this.carGroup.visible = true;
        this.exploded = false;
    }

    _computeSlip(forward) {
        const speed = this.velocity.length();
        if (speed < 0.001) return 0;
        const forwardDir = forward.clone().normalize();
        const forwardSpeed = this.velocity.dot(forwardDir);
        const lateral = this.velocity.clone().sub(forwardDir.multiplyScalar(forwardSpeed));
        return lateral.length() / speed;
    }

    _shouldEmitSmoke(speed, slip) {
        if (!this.smokeParams.enabled) return false;
        if (speed < this.smokeParams.minSpeed) return false;
        return slip > this.smokeParams.slipThreshold;
    }

    _acquireSprite() {
        if (this._smokePool.length) {
            return this._smokePool.pop();
        }
        const sprite = new THREE.Sprite(this.smokeBaseMaterial.clone());
        sprite.material.depthWrite = false;
        return sprite;
    }

    _releaseSprite(sprite) {
        sprite.visible = false;
        this._smokePool.push(sprite);
    }

    _spawnSmokeParticle(forward, slip) {
        const p = this.smokeParams;
        if (this.smokeParticles.length > p.maxPoolSize) return;
        const sprite = this._acquireSprite();
        if (!sprite.parent) this.scene.add(sprite);
        sprite.visible = true;
        if (this.smokeTextures && this.smokeTextures.length) {
            sprite.material.map = this.smokeTextures[Math.floor(Math.random()*this.smokeTextures.length)];
            sprite.material.needsUpdate = true;
        }
        const shade = 1 - Math.random() * p.colorVariance;
        sprite.material.color.setRGB(shade, shade, shade);
        const right = new THREE.Vector3(1,0,0).applyQuaternion(this.carGroup.quaternion);
        const sideChoice = Math.random();
        let lateralBase = 0;
        if (sideChoice < 0.45) lateralBase = -p.lateralWheelOffset;
        else if (sideChoice > 0.55) lateralBase = p.lateralWheelOffset;
        else lateralBase = (Math.random()-0.5) * p.lateralWheelOffset * 0.4;
        const rearOffset = forward.clone().multiplyScalar(-p.rearWheelOffset);
        const basePos = this.position.clone()
            .add(rearOffset)
            .add(right.clone().multiplyScalar(lateralBase));
        const lateralExtra = (Math.random()-0.5) * p.lateralJitter * (0.4 + slip*1.1);
        const longitudinalExtra = (Math.random()-0.5) * p.longitudinalJitter * (0.3 + slip*0.9);
        const jitterPos = basePos
            .add(right.clone().multiplyScalar(lateralExtra))
            .add(forward.clone().multiplyScalar(longitudinalExtra));
        sprite.position.copy(jitterPos).add(new THREE.Vector3(0,0.18 + Math.random()*0.05,0));
        const scale = p.startSize * (0.6 + Math.random()*p.sizeJitter);
        sprite.scale.set(scale, scale, scale);
        sprite.material.opacity = 0.95;
        sprite.material.rotation = Math.random()*Math.PI*2;
        this.smokeParticles.push({
            sprite,
            age: 0,
            life: p.particleLife * (0.85 + Math.random()*0.35),
            baseSize: scale,
            velocity: new THREE.Vector3((Math.random()-0.5)*0.22, p.upwardSpeed * (0.55 + Math.random()*0.75), (Math.random()-0.5)*0.22),
            spin: (Math.random()-0.5) * p.spinSpeed,
            aspect: 0.85 + Math.random()*0.4,
            wobbleFreq: THREE.MathUtils.lerp(p.shapeWobbleFreqMin, p.shapeWobbleFreqMax, Math.random()),
            wobblePhase: Math.random() * Math.PI * 2
        });
    }

    _updateSmoke(deltaTime, forward) {
        const speed = this.velocity.length();
        const slip = this._computeSlip(forward);
        const now = performance.now() / 1000;
        const steeringActive = (now - this._lastSteerTime) <= this.smokeParams.stopGrace;
        if (steeringActive && this._shouldEmitSmoke(speed, slip)) {
            const density = Math.min(this.smokeParams.slipToDensity * slip, this.smokeParams.slipToDensity);
            const interval = this.smokeParams.baseSpawnInterval;
            this._smokeTimeAccum += deltaTime;
            while (this._smokeTimeAccum >= interval) {
                this._smokeTimeAccum -= interval;
                const count = Math.min(
                    1 + Math.floor(density * interval + Math.random()*1.5),
                    this.smokeParams.maxParticlesPerCycle
                );
                for (let i=0; i<count; i++) this._spawnSmokeParticle(forward, slip);
            }
        } else {
            this._smokeTimeAccum = 0;
        }
        for (let i = this.smokeParticles.length -1; i >=0; i--) {
            const part = this.smokeParticles[i];
            part.age += deltaTime;
            const t = part.age / part.life;
            if (t >= 1) {
                this._releaseSprite(part.sprite);
                this.smokeParticles.splice(i,1);
                continue;
            }
            part.velocity.x *= this.smokeParams.lateralDampen;
            part.velocity.z *= this.smokeParams.lateralDampen;
            if (this.smokeParams.upwardAccel) {
                const liftFactor = (1 - Math.min(part.age/part.life, 1));
                part.velocity.y += this.smokeParams.upwardAccel * liftFactor * deltaTime;
            }
            part.sprite.position.addScaledVector(part.velocity, deltaTime);
            const growth = Math.pow(t, 0.55 + Math.random()*0.05);
            const size = THREE.MathUtils.lerp(part.baseSize, this.smokeParams.endSize, growth);
            const wobble = this.smokeParams.shapeWobbleAmp * Math.sin(part.wobblePhase + part.wobbleFreq * part.age);
            const wobbleY = this.smokeParams.shapeWobbleAmp * 0.6 * Math.cos(part.wobblePhase*0.7 + part.wobbleFreq * part.age * 0.85);
            const scaleX = size * part.aspect * (1 + wobble);
            const scaleY = size * (1 - wobbleY);
            part.sprite.scale.set(scaleX, scaleY, size);
            part.sprite.material.rotation += part.spin * deltaTime;
            const fade = Math.pow(1 - t, this.smokeParams.fadePower);
            part.sprite.material.opacity = fade;
            const shadeFactor = 0.85 + 0.15 * (1 - t);
            part.sprite.material.color.multiplyScalar(shadeFactor);
        }
    }

    getPosition() {
        return this.position.clone();
    }

    getForwardDirection() {
        const rot = this.body.rotation();
        const quat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
        return new THREE.Vector3(0,0,-1).applyQuaternion(quat).normalize();
    }

    getSpeedKmh() {
        return this.velocity.length() * 3.6;
    }

    getCurrentGear() {
        const speed = this.velocity.length();
        if (speed < 10) return 1;
        if (speed < 30) return 2;
        if (speed < 60) return 3;
        return 4;
    }
}

export { Car };