import * as THREE from 'three';

class Car {
    constructor(scene) {
        this.scene = scene;
        
        // Car physical properties
        this.position = new THREE.Vector3(0, 0.5, 0);
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.acceleration = new THREE.Vector3(0, 0, 0);
        this.rotation = 0; // Y-axis rotation

        // Car parameters
        this.accelerationForce = 50;
        this.brakeForce = 25;
        this.friction = .985;
        this.turnSpeed = 2.5;

        // Control states
        this.controls = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            handbrake: false
        };
        
        this.createCarMesh();
        this.setupControls();

        // Smoke particle parameters (tweakable)
        this.smokeParams = {
            enabled: true,
            baseSpawnInterval: 0.01, // faster cycles for denser trail
            minSpeed: 4, // minimum speed to emit
            slipThreshold: 0.15, // lateral slip ratio to begin emission
            particleLife: 0.7, // slightly shorter life for less lingering
            startSize: 0.28,
            endSize: 1.4,
            upwardSpeed: 1.1, // increased base upward velocity
            upwardAccel: 5, // stronger secondary upward acceleration during life
            lateralDampen: 0.9,
            fadePower: 1.8,
            maxParticlesPerCycle: 10, // allow more per cycle for density
            slipToDensity: 18, // multiplier converting slip to target particles/sec
            maxPoolSize: 250,
            colorVariance: 0.15,
            sizeJitter: 0.55,
            spinSpeed: 2.5,
            stopGrace: 0.08, // seconds after steering release to still allow emission
            baseSpread: 0.25, // tighter cluster baseline
            slipSpreadFactor: 0.4, // additional spread per slip unit
            rearWheelOffset: 1.5, // distance behind center to start emission
            lateralWheelOffset: 1.1, // half-width to approximate wheel positions
            lateralJitter: 0.5, // additional random lateral jitter scale
            longitudinalJitter: 0.4, // random along forward/back jitter scale
            shapeWobbleAmp: 0.25, // amplitude of non-uniform scaling wobble (0-~0.4)
            shapeWobbleFreqMin: 2.0,
            shapeWobbleFreqMax: 5.0
        };

        this._smokeTimeAccum = 0;
        this.smokeParticles = [];
        this._smokePool = [];
        this._initSmokeResources();
        this._lastSteerTime = 0;
    }

    _initSmokeResources() {
        // Create multiple irregular blobby grayscale textures for smoke variety
        const variantCount = 5;
        const size = 96;
        this.smokeTextures = [];
        for (let v=0; v<variantCount; v++) {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = size;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0,0,size,size);
            // Fill transparent
            // Draw several overlapping fuzzy blobs
            const blobNum = 5 + Math.floor(Math.random()*4); // 5-8 blobs
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
            // Slight overall soft vignette to smooth edges
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
        // Base material (map will be swapped per particle)
        this.smokeBaseMaterial = new THREE.SpriteMaterial({ map: this.smokeTextures[0], transparent: true, depthWrite: false });
    }
    
    createCarMesh() {
        // Create car body
        this.carGroup = new THREE.Group();
        
        // Main body
        const bodyGeometry = new THREE.BoxGeometry(2, 0.6, 4);
        const bodyMaterial = new THREE.MeshLambertMaterial({ color: 0xff4444 });
        const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
        bodyMesh.position.y = 0.3;
        bodyMesh.castShadow = true;
        this.carGroup.add(bodyMesh);
        
        // Windshield
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
        
        // Wheels
        const wheelGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 8);
        const wheelMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 });
        
        // Front wheels
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
        
        // Rear wheels
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
        
        // Add the car group to the scene
        this.scene.add(this.carGroup);
    }
    
    setupControls() {
        document.addEventListener('keydown', (event) => {
            switch(event.code) {
                case 'KeyW':
                case 'ArrowUp':
                    this.controls.forward = true;
                    break;
                case 'KeyS':
                case 'ArrowDown':
                    this.controls.backward = true;
                    break;
                case 'KeyA':
                case 'ArrowLeft':
                    this.controls.left = true;
                    break;
                case 'KeyD':
                case 'ArrowRight':
                    this.controls.right = true;
                    break;
                case 'Space':
                    this.controls.handbrake = true;
                    event.preventDefault();
                    break;
            }
        });
        
        document.addEventListener('keyup', (event) => {
            switch(event.code) {
                case 'KeyW':
                case 'ArrowUp':
                    this.controls.forward = false;
                    break;
                case 'KeyS':
                case 'ArrowDown':
                    this.controls.backward = false;
                    break;
                case 'KeyA':
                case 'ArrowLeft':
                    this.controls.left = false;
                    break;
                case 'KeyD':
                case 'ArrowRight':
                    this.controls.right = false;
                    break;
                case 'Space':
                    this.controls.handbrake = false;
                    break;
            }
        });
    }
    
    update(deltaTime) {
        // Calculate forward direction (inverted so initial forward is -Z to match existing map logic)
        const forward = new THREE.Vector3(-Math.sin(this.rotation), 0, -Math.cos(this.rotation));
        
        // Handle acceleration/braking
        if (this.controls.forward) {
            this.acceleration.copy(forward).multiplyScalar(this.accelerationForce);
        } else if (this.controls.backward) {
            this.acceleration.copy(forward).multiplyScalar(-this.brakeForce);
        } else {
            this.acceleration.set(0, 0, 0);
        }
        
        // Apply acceleration
        this.velocity.add(this.acceleration.clone().multiplyScalar(deltaTime));
        if (this.velocity.length() > 60) {
            this.velocity.setLength(60);
        }
        // Apply friction
        this.velocity.multiplyScalar(this.friction);
        
        // Handle steering
        const speed = this.velocity.length();
        if (speed > 0.1) {
            if (this.controls.left) {
                this.rotation += this.turnSpeed * deltaTime;
                this._lastSteerTime = performance.now() / 1000;
            }
            if (this.controls.right) {
                this.rotation -= this.turnSpeed * deltaTime;
                this._lastSteerTime = performance.now() / 1000;
            }
        }
        
        // Update position
        this.position.add(this.velocity.clone().multiplyScalar(deltaTime));
        
        // Update car group position and rotation
        this.carGroup.position.copy(this.position);
        this.carGroup.rotation.y = this.rotation;

        // Update and possibly spawn smoke particles
        this._updateSmoke(deltaTime, forward);
    }

    _computeSlip(forward) {
        // Slip = magnitude of lateral component / total speed
        const speed = this.velocity.length();
        if (speed < 0.001) return 0;
        const forwardDir = forward.clone().normalize();
        const forwardSpeed = this.velocity.dot(forwardDir);
        const lateral = this.velocity.clone().sub(forwardDir.multiplyScalar(forwardSpeed));
        return lateral.length() / speed; // 0..1 (roughly)
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
        if (this.smokeParticles.length > p.maxPoolSize) return; // cap
        const sprite = this._acquireSprite();
        if (!sprite.parent) this.scene.add(sprite);
        sprite.visible = true;
        // Assign a random texture variant for shape variety
        if (this.smokeTextures && this.smokeTextures.length) {
            sprite.material.map = this.smokeTextures[Math.floor(Math.random()*this.smokeTextures.length)];
            sprite.material.needsUpdate = true;
        }
        // Slight color variance (grey shades)
        const shade = 1 - Math.random() * p.colorVariance;
        sprite.material.color.setRGB(shade, shade, shade);
        // Compute side vector (right) from forward
        const right = new THREE.Vector3(Math.cos(this.rotation), 0, -Math.sin(this.rotation));
        // Choose wheel side or center biased by slip (more slip = more chance of wide emission)
        const sideChoice = Math.random();
        let lateralBase = 0;
        if (sideChoice < 0.45) lateralBase = -p.lateralWheelOffset; // left wheel
        else if (sideChoice > 0.55) lateralBase = p.lateralWheelOffset; // right wheel
        else lateralBase = (Math.random()-0.5) * p.lateralWheelOffset * 0.4; // near center
        // Base rear anchor
        const rearOffset = forward.clone().multiplyScalar(-p.rearWheelOffset);
        const basePos = this.position.clone()
            .add(rearOffset)
            .add(right.clone().multiplyScalar(lateralBase));
        // Additional jitter (wider with slip)
        const lateralExtra = (Math.random()-0.5) * p.lateralJitter * (0.4 + slip*1.1);
        const longitudinalExtra = (Math.random()-0.5) * p.longitudinalJitter * (0.3 + slip*0.9);
        const jitterPos = basePos
            .add(right.clone().multiplyScalar(lateralExtra))
            .add(forward.clone().multiplyScalar(longitudinalExtra));
        const worldPos = jitterPos;
        sprite.position.copy(worldPos).add(new THREE.Vector3(0,0.18 + Math.random()*0.05,0));
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
            aspect: 0.85 + Math.random()*0.4, // anisotropic aspect ratio
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
            // Determine target particles per second from slip
            const density = Math.min(this.smokeParams.slipToDensity * slip, this.smokeParams.slipToDensity);
            const interval = this.smokeParams.baseSpawnInterval;
            this._smokeTimeAccum += deltaTime;
            while (this._smokeTimeAccum >= interval) {
                this._smokeTimeAccum -= interval;
                // Spawn variable number based on density & randomness
                const count = Math.min(
                    1 + Math.floor(density * interval + Math.random()*1.5),
                    this.smokeParams.maxParticlesPerCycle
                );
                for (let i=0; i<count; i++) this._spawnSmokeParticle(forward, slip);
            }
        } else {
            this._smokeTimeAccum = 0;
        }
        // Update existing particles
        for (let i = this.smokeParticles.length -1; i >=0; i--) {
            const part = this.smokeParticles[i];
            part.age += deltaTime;
            const t = part.age / part.life;
            if (t >= 1) {
                this._releaseSprite(part.sprite);
                this.smokeParticles.splice(i,1);
                continue;
            }
            // Movement & damping
            part.velocity.x *= this.smokeParams.lateralDampen;
            part.velocity.z *= this.smokeParams.lateralDampen;
            // Apply upward acceleration curve (strong early, taper late)
            if (this.smokeParams.upwardAccel) {
                const liftFactor = (1 - Math.min(part.age/part.life, 1));
                part.velocity.y += this.smokeParams.upwardAccel * liftFactor * deltaTime;
            }
            part.sprite.position.addScaledVector(part.velocity, deltaTime);
            // Expansion with slight irregular pulse
            const growth = Math.pow(t, 0.55 + Math.random()*0.05);
            const size = THREE.MathUtils.lerp(part.baseSize, this.smokeParams.endSize, growth);
            // Anisotropic + wobble deformation
            const wobble = this.smokeParams.shapeWobbleAmp * Math.sin(part.wobblePhase + part.wobbleFreq * part.age);
            const wobbleY = this.smokeParams.shapeWobbleAmp * 0.6 * Math.cos(part.wobblePhase*0.7 + part.wobbleFreq * part.age * 0.85);
            const scaleX = size * part.aspect * (1 + wobble);
            const scaleY = size * (1 - wobbleY);
            part.sprite.scale.set(scaleX, scaleY, size);
            // Spin
            part.sprite.material.rotation += part.spin * deltaTime;
            // Darken slightly over life and fade
            const fade = Math.pow(1 - t, this.smokeParams.fadePower);
            part.sprite.material.opacity = fade;
            const shadeFactor = 0.85 + 0.15 * (1 - t);
            part.sprite.material.color.offsetHSL(0, 0, 0); // no hue change; placeholder
            part.sprite.material.color.multiplyScalar(shadeFactor);
        }
    }
    
    getPosition() {
        return this.position.clone();
    }
    
    getForwardDirection() {
        return new THREE.Vector3(-Math.sin(this.rotation), 0, -Math.cos(this.rotation));
    }
    
    getSpeedKmh() {
        return this.velocity.length() * 3.6; // Convert to km/h
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