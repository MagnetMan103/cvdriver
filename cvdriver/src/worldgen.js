// world-manager.js - Handles world generation, rendering, and visual elements
import * as THREE from 'three';
import {getLatestThumbCount} from "./camera.js";

const gameContainer = document.getElementById("game")
function generateRoadSchematic(initialX, initialY, initialZ = 0, initialAngle = 0) {
    // returns an array of points representing a path of the road that will be like a parabola with curves and turns
    const points = [];
    let z = initialZ;
    let x = initialX;
    let y = initialY;
    let angle = initialAngle; // Start from the provided initial angle instead of 0

    for (let i = 0; i < 100; i++) {
        z -= 20;
        angle += (Math.random() - 0.5) * 3; // random small turn
        x += Math.sin(angle) * 6; // curve effect
        y = 0 // flat road for now, can add hills later
        points.push({ x, y, z, angle });
    }
    return points;
}
export class WorldManager {
    constructor() {
        this.scene = null;
        this.renderer = null;
        this.overviewCamera = null;
        this.playerCamera = null;
        this.usePlayerCamera = false;

        // World generation state
        this.generatedSegments = new Set();
        this.generatedGrids = new Set();
        this.roadSegments = [];
        this.lastRoad = { x: 0, y: 0, z: 0, theta: 0 };
        this.lastGeneratedSegmentCount = 0;
        this.lastRoadEndPoint = null;

        // Fence continuity tracking
        this.leftFencePoints = [];
        this.rightFencePoints = [];
        this.lastLeftFenceEnd = null;
        this.lastRightFenceEnd = null;

        // Tree generation tracking
        this.generatedTreeCells = new Set();
        this.treeGroup = new THREE.Group();
        if (this.scene) this.scene.add(this.treeGroup);

        // NPC Car system
        this.npcCars = []; // { mesh, roadPoint, progress, direction, speed, body }
        this.npcCarGroup = new THREE.Group();
        this.npcGenerationZones = new Set(); // Track where we've generated NPCs
        this.lastNpcGenerationZ = 0; // Track last Z position where we generated NPCs
        this.npcGenerationDistance = 50; // Generate NPCs every 50 units
        if (this.scene) this.scene.add(this.npcCarGroup);

        // Coin system
        this.coinGroup = new THREE.Group();
        this.coins = []; // { mesh, collected }
        this.coinGeometry = new THREE.CylinderGeometry(0.5, 0.5, 0.12, 20);
        this.coinMaterial = new THREE.MeshStandardMaterial({ color: 0xFFD700, emissive: 0x554400, metalness: 0.7, roughness: 0.3 });
        if (this.scene) this.scene.add(this.coinGroup);

        // Reusable tree assets
        this.trunkGeometry = new THREE.CylinderGeometry(0.3, 0.5, 2, 6);
        this.foliageGeometry = new THREE.ConeGeometry(2.2, 4, 8);
        this.trunkMaterial = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
        this.leafMaterial = new THREE.MeshLambertMaterial({ color: 0x2E8B57 });

        // UI elements
        this.coordinatesCard = null;
        this.carStatsCard = null;
        this.lastThumbCount = 0;
        this.ctrlDebug = null;
        // Scoring
        this.coinsCollected = 0;
        this.carsHit = 0; // Track number of cars hit by player
        this.scoreCard = null;
        this.scorePopups = []; // {el, start, duration, y, vy}

        this.init();
    }

    createNpcCarMesh(color = 0x00ccff) {
        const group = new THREE.Group();
        const bodyGeo = new THREE.BoxGeometry(2, 0.6, 4);
        const bodyMat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 1 });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 0.3;
        group.add(body);

        const cabinGeo = new THREE.BoxGeometry(1.6, 0.5, 1.2);
        const cabinMat = new THREE.MeshLambertMaterial({ color: 0x222244, transparent: true, opacity: 0.6 });
        const cab = new THREE.Mesh(cabinGeo, cabinMat);
        cab.position.set(0, 0.75, 0.3);
        group.add(cab);

        // Add wheels
        const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 8);
        const wheelMat = new THREE.MeshLambertMaterial({ color: 0x333333 });

        // Front wheels
        const frontLeftWheel = new THREE.Mesh(wheelGeo, wheelMat);
        frontLeftWheel.position.set(-0.9, 0.0, -1.4);
        frontLeftWheel.rotation.z = Math.PI / 2;
        group.add(frontLeftWheel);

        const frontRightWheel = new THREE.Mesh(wheelGeo, wheelMat);
        frontRightWheel.position.set(0.9, 0.0, -1.4);
        frontRightWheel.rotation.z = Math.PI / 2;
        group.add(frontRightWheel);

        // Rear wheels
        const rearLeftWheel = new THREE.Mesh(wheelGeo, wheelMat);
        rearLeftWheel.position.set(-0.9, 0.0, 1.4);
        rearLeftWheel.rotation.z = Math.PI / 2;
        group.add(rearLeftWheel);

        const rearRightWheel = new THREE.Mesh(wheelGeo, wheelMat);
        rearRightWheel.position.set(0.9, 0.0, 1.4);
        rearRightWheel.rotation.z = Math.PI / 2;
        group.add(rearRightWheel);

        group.position.set(0, -5, 0);
        return group;
    }

    generateNpcCarsInfinite(playerZ, physicsManager) {
        // Generate NPCs ahead of the player
        const generationAheadDistance = 200; // Generate NPCs 200 units ahead
        const targetZ = playerZ - generationAheadDistance; // NPCs spawn ahead (negative Z)

        // Check if we need to generate new NPCs
        while (this.lastNpcGenerationZ > targetZ) {
            const spawnZ = this.lastNpcGenerationZ - this.npcGenerationDistance;
            const zoneKey = `npc_zone_${Math.floor(spawnZ / this.npcGenerationDistance)}`;

            if (!this.npcGenerationZones.has(zoneKey)) {
                this.npcGenerationZones.add(zoneKey);
                this.generateNpcCarsAtZ(spawnZ, physicsManager);
                console.log(`[NPC Infinite] Generated NPCs at Z: ${spawnZ.toFixed(2)}`);
            }

            this.lastNpcGenerationZ = spawnZ;
        }
    }

    generateNpcCarsAtZ(targetZ, physicsManager) {
        // Find road points near this Z coordinate with better search
        let nearbyRoadPoints = [];

        // Look through ALL road segments for points near targetZ (more thorough search)
        for (const point of this.roadSegments) {
            if (Math.abs(point.z - targetZ) < 20) { // Within 20 units of target
                nearbyRoadPoints.push(point);
            }
        }

        // If still no road points found, don't spawn cars here
        if (nearbyRoadPoints.length === 0) {
            console.log(`[NPC Infinite] No road points found near Z: ${targetZ.toFixed(2)}, skipping NPC generation`);
            return;
        }

        // Halved spawn count: Generate fewer NPCs (0-1 cars per zone instead of 1-3)
        const numCars = Math.random() < 0.6 ? 1 : 0; // 60% chance for 1 car, 40% chance for 0 cars

        if (numCars === 0) return;

        const spawnPoints = this.selectRandomPoints(nearbyRoadPoints, numCars);

        for (const point of spawnPoints) {
            this.createSingleNpcCar(point, physicsManager);
        }
    }

    createSingleNpcCar(point, physicsManager) {
        // Random car color
        const colors = [0xff4444, 0x44ff44, 0x4444ff, 0xffff44, 0xff44ff, 0x44ffff, 0xffffff, 0x888888];
        const color = colors[Math.floor(Math.random() * colors.length)];

        const npcMesh = this.createNpcCarMesh(color);

        // Ensure car is well above ground but STAY CLOSE TO ROAD POINT
        const carY = 0.32;

        // Reduce lateral offset to stay within 10 units of road point
        const maxOffset = 5; // Max 5 units from road center (well within 10 unit requirement)
        const lateralOffset = (Math.random() - 0.5) * maxOffset; // ±2.5 units lateral variation

        // Place car very close to the actual road point
        npcMesh.position.set(point.x + lateralOffset, carY, point.z);

        // Face forward (-Z direction) with minimal angle variation
        npcMesh.rotation.y = (Math.random() - 0.5) * 0.2; // Reduced random angle

        this.npcCarGroup.add(npcMesh);

        console.log(`[NPC Infinite] Spawned car at (${npcMesh.position.x.toFixed(2)}, ${carY.toFixed(2)}, ${point.z.toFixed(2)}) near road point (${point.x.toFixed(2)}, ${point.z.toFixed(2)})`);

        // Create NPC car data
        const npcCar = {
            mesh: npcMesh,
            roadPoints: [point], // Single point for simple movement
            currentIndex: 0,
            progress: 0,
            speed: 20 + Math.random() * 15, // Speed between 20-35
            direction: -1, // Always move in -Z direction
            body: null,
            launched: false,
            spawnZ: point.z // Track where it was spawned
        };

        this.npcCars.push(npcCar);

        // Create physics body
        if (physicsManager) {
            physicsManager.createNpcCarBody(npcCar);
        }
    }

    cleanupDistantNpcCars(playerZ, physicsManager) {
        const cleanupDistance = 300; // Remove NPCs more than 300 units behind player

        for (let i = this.npcCars.length - 1; i >= 0; i--) {
            const npc = this.npcCars[i];

            // Remove NPCs that are too far behind the player
            if (npc.mesh.position.z > playerZ + cleanupDistance) {
                console.log(`[NPC Cleanup] Removing NPC at Z: ${npc.mesh.position.z.toFixed(2)}`);
                this.removeNpcCar(i, physicsManager);
            }
        }

        // Also cleanup old generation zones
        const currentZone = Math.floor(playerZ / this.npcGenerationDistance);
        const zonesToKeep = new Set();

        // Keep recent zones
        for (let i = currentZone - 10; i <= currentZone + 10; i++) {
            zonesToKeep.add(`npc_zone_${i}`);
        }

        // Remove old zones
        for (const zone of this.npcGenerationZones) {
            if (!zonesToKeep.has(zone)) {
                this.npcGenerationZones.delete(zone);
            }
        }
    }

    updateNpcCars(deltaTime, physicsManager) {
        for (let i = this.npcCars.length - 1; i >= 0; i--) {
            const npc = this.npcCars[i];

            // Skip if physics body is missing or car is too far from player
            if (!npc.body || !npc.mesh.visible) continue;

            // Let physics manager handle NPC movement
            if (physicsManager) {
                physicsManager.updateNpcCar(npc, deltaTime);
            }
        }
    }

    removeNpcCar(index, physicsManager) {
        const npc = this.npcCars[index];
        if (npc) {
            this.npcCarGroup.remove(npc.mesh);
            if (physicsManager && npc.body) {
                physicsManager.removeNpcCarBody(npc.body);
            }
            this.npcCars.splice(index, 1);
        }
    }

    // ===== Car Hit Callback =====
    onCarHit() {
        this.carsHit += 1;
        this.createScorePopup(1000);
        console.log(`[Car Hit] Player hit car! Total cars hit: ${this.carsHit}`);
    }

    getPlayerPosition() {
        // This will be called from the render method, so we'll need the player object
        return this.playerPosition || new THREE.Vector3(0, 0, 0);
    }

    createTree(x, z, scaleJitter = 1) {
        const group = new THREE.Group();
        const trunk = new THREE.Mesh(this.trunkGeometry, this.trunkMaterial);
        trunk.position.y = 1;
        group.add(trunk);

        const foliage = new THREE.Mesh(this.foliageGeometry, this.leafMaterial);
        foliage.position.y = 3;
        foliage.rotation.y = Math.random() * Math.PI;
        group.add(foliage);

        const s = 0.7 + Math.random() * 0.6 * scaleJitter;
        group.scale.set(s, s, s);
        group.position.set(x, 0, z);
        return group;
    }

    generateTrees(roadPoints, roadWidth = 12, fenceOffset = 20) {
        if (!roadPoints || roadPoints.length < 2) return;
        const baseOffset = (roadWidth / 2) + fenceOffset;
        // Iterate through every Nth point for performance
        for (let i = 0; i < roadPoints.length; i += 2) {
            const point = roadPoints[i];
            const pos = new THREE.Vector3(point.x, 0, point.z);
            // Determine forward/perpendicular
            let perpendicular;
            if (i === 0) {
                const next = new THREE.Vector3(roadPoints[i + 1].x, 0, roadPoints[i + 1].z);
                const forward = next.clone().sub(pos).normalize();
                perpendicular = new THREE.Vector3(-forward.z, 0, forward.x);
            } else if (i === roadPoints.length - 1) {
                const prev = new THREE.Vector3(roadPoints[i - 1].x, 0, roadPoints[i - 1].z);
                const forward = pos.clone().sub(prev).normalize();
                perpendicular = new THREE.Vector3(-forward.z, 0, forward.x);
            } else {
                const prev = new THREE.Vector3(roadPoints[i - 1].x, 0, roadPoints[i - 1].z);
                const next = new THREE.Vector3(roadPoints[i + 1].x, 0, roadPoints[i + 1].z);
                const forward1 = pos.clone().sub(prev).normalize();
                const forward2 = next.clone().sub(pos).normalize();
                const avgForward = forward1.add(forward2).normalize();
                perpendicular = new THREE.Vector3(-avgForward.z, 0, avgForward.x);
            }

            // Random number of trees per side (0-2)
            const treesLeft = Math.random() < 0.7 ? (Math.random() < 0.4 ? 2 : 1) : 0;
            const treesRight = Math.random() < 0.7 ? (Math.random() < 0.4 ? 2 : 1) : 0;

            const placeTrees = (count, side) => {
                for (let t = 0; t < count; t++) {
                    const extra = 5 + Math.random() * 40; // distance beyond fence
                    const lateral = baseOffset + extra;
                    const jitterFwd = (Math.random() - 0.5) * 8; // forward jitter
                    const forwardDir = perpendicular.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
                    const basePos = pos.clone()
                        .add(forwardDir.multiplyScalar(jitterFwd))
                        .add(perpendicular.clone().multiplyScalar(side * lateral));
                    // Snap to grid cell to prevent duplicates
                    const cellSize = 6;
                    const cellX = Math.round(basePos.x / cellSize) * cellSize;
                    const cellZ = Math.round(basePos.z / cellSize) * cellSize;
                    const key = cellX + ',' + cellZ;
                    if (this.generatedTreeCells.has(key)) continue;
                    this.generatedTreeCells.add(key);
                    const tree = this.createTree(cellX + (Math.random()-0.5)*1.5, cellZ + (Math.random()-0.5)*1.5);
                    this.treeGroup.add(tree);
                }
            };

            placeTrees(treesLeft, 1);   // Left side (positive perpendicular)
            placeTrees(treesRight, -1); // Right side (negative perpendicular)
        }
    }


    init() {
        this.setupRenderer();
        this.setupScene();
        this.setupCameras();
        this.setupLighting();
        this.setupUI();
        this.setupEventListeners();
    }

    setupRenderer() {
        const canvas = document.getElementById('three-canvas');
        this.renderer = new THREE.WebGLRenderer({ canvas });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    setupScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0096FF);
        if (this.treeGroup) this.scene.add(this.treeGroup);
        if (this.coinGroup) this.scene.add(this.coinGroup); // ensure coins group added after scene exists
        if (this.npcCarGroup) this.scene.add(this.npcCarGroup);
    }

    setupCameras() {
        // Overview camera
        this.overviewCamera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.overviewCamera.position.set(0, 20, 20);
        this.overviewCamera.lookAt(0, 0, 0);

        // Player camera
        this.playerCamera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
    }

    setupLighting() {
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
        dirLight.position.set(5, 10, 2);
        this.scene.add(dirLight);
    }

    setupUI() {
        // Toggle camera button

        // Coordinates card
        this.coordinatesCard = document.createElement('div');
        this.coordinatesCard.style.position = 'absolute';
        this.coordinatesCard.style.bottom = '10px';
        this.coordinatesCard.style.right = '10px';
        this.coordinatesCard.style.padding = '10px';
        this.coordinatesCard.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
        this.coordinatesCard.style.fontFamily = 'monospace';
        this.coordinatesCard.style.fontSize = '14px';
        this.coordinatesCard.textContent = 'Coordinates: (0, 0, 0)';
        gameContainer.appendChild(this.coordinatesCard);

        // Car stats card as a larger circular speedometer
        this.carStatsCard = document.createElement('div');
        this.carStatsCard.style.position = 'absolute';
        this.carStatsCard.style.top = '30px';
        this.carStatsCard.style.right = '30px';
        this.carStatsCard.style.width = '160px';
        this.carStatsCard.style.height = '160px';
        this.carStatsCard.style.padding = '30px';
        this.carStatsCard.style.borderRadius = '50%';
        this.carStatsCard.style.background = 'radial-gradient(circle at 60% 40%, #fff 70%, #ccc 100%)';
        this.carStatsCard.style.display = 'flex';
        this.carStatsCard.style.alignItems = 'center';
        this.carStatsCard.style.justifyContent = 'center';
        this.carStatsCard.style.fontFamily = 'monospace';
        this.carStatsCard.style.textAlign = 'center';
        this.carStatsCard.style.fontSize = '60px';
        this.carStatsCard.style.fontWeight = 'bold';
        this.carStatsCard.style.boxShadow = '0 2px 18px rgba(0,0,0,0.18)';
        this.carStatsCard.textContent = '0 \n mph';
        gameContainer.appendChild(this.carStatsCard);

        // Control debug
        this.ctrlDebug = document.createElement('div');
        this.ctrlDebug.style.position = 'absolute';
        this.ctrlDebug.style.left = '10px';
        this.ctrlDebug.style.bottom = '10px';
        this.ctrlDebug.style.padding = '6px 8px';
        this.ctrlDebug.style.fontFamily = 'monospace';
        this.ctrlDebug.style.fontSize = '12px';
        this.ctrlDebug.style.background = 'rgba(0,0,0,0.4)';
        this.ctrlDebug.style.color = '#fff';
        this.ctrlDebug.style.whiteSpace = 'pre';
        gameContainer.appendChild(this.ctrlDebug);

        // Score card (restored)
        this.scoreCard = document.createElement('div');
        this.scoreCard.style.position = 'absolute';
        this.scoreCard.style.top = '10px';
        this.scoreCard.style.left = '10px';
        this.scoreCard.style.padding = '10px';
        this.scoreCard.style.backgroundColor = 'rgba(0,0,0,0.55)';
        this.scoreCard.style.fontFamily = 'monospace';
        this.scoreCard.style.fontSize = '40px';
        this.scoreCard.style.fontWeight = 'bold';
        this.scoreCard.style.color = '#FFD700';
        this.scoreCard.textContent = 'Score: 0';
        gameContainer.appendChild(this.scoreCard);
    }

    setupEventListeners() {

        window.addEventListener('resize', () => {
            this.overviewCamera.aspect = window.innerWidth / window.innerHeight;
            this.overviewCamera.updateProjectionMatrix();
            this.playerCamera.aspect = window.innerWidth / window.innerHeight;
            this.playerCamera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    createRoadStrip(points, roadWidth = 12) {
        if (points.length < 2) return null;

        const vertices = [], indices = [], normals = [], uvs = [];

        for (let i = 0; i < points.length; i++) {
            const point = points[i];
            const pos = new THREE.Vector3(point.x, 0.02, point.z);
            let perpendicular;

            if (i === 0) {
                const next = new THREE.Vector3(points[i + 1].x, points[i + 1].y || 0, points[i + 1].z);
                const forward = next.clone().sub(pos).normalize();
                perpendicular = new THREE.Vector3(-forward.z, 0, forward.x);
            } else if (i === points.length - 1) {
                const prev = new THREE.Vector3(points[i - 1].x, points[i - 1].y || 0, points[i - 1].z);
                const forward = pos.clone().sub(prev).normalize();
                perpendicular = new THREE.Vector3(-forward.z, 0, forward.x);
            } else {
                const prev = new THREE.Vector3(points[i - 1].x, points[i - 1].y || 0, points[i - 1].z);
                const next = new THREE.Vector3(points[i + 1].x, points[i + 1].y || 0, points[i + 1].z);
                const forward1 = pos.clone().sub(prev).normalize();
                const forward2 = next.clone().sub(pos).normalize();
                const avgForward = forward1.add(forward2).normalize();
                perpendicular = new THREE.Vector3(-avgForward.z, 0, avgForward.x);
            }

            const leftVertex = pos.clone().add(perpendicular.clone().multiplyScalar(roadWidth / 2));
            const rightVertex = pos.clone().add(perpendicular.clone().multiplyScalar(-roadWidth / 2));

            vertices.push(leftVertex.x, leftVertex.y, leftVertex.z);
            vertices.push(rightVertex.x, rightVertex.y, rightVertex.z);
            normals.push(0, 1, 0); normals.push(0, 1, 0);

            const u = i / (points.length - 1);
            uvs.push(0, u); uvs.push(1, u);

            if (i < points.length - 1) {
                const base = i * 2;
                indices.push(base, base + 1, base + 2);
                indices.push(base + 1, base + 3, base + 2);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);

        const material = new THREE.MeshLambertMaterial({ color: 0x36454F, side: THREE.DoubleSide });
        return new THREE.Mesh(geometry, material);
    }

    addGridsForRoadPoints(points) {
        points.forEach((point, index) => {
            if (index % 4 === 0) {
                const gridKey = `grid_${Math.round(point.x / 50) * 50}_${Math.round(point.z / 50) * 50}`;
                if (this.generatedGrids.has(gridKey)) return;

                this.generatedGrids.add(gridKey);
                const planeGeometry = new THREE.PlaneGeometry(300, 100);
                const planeMaterial = new THREE.MeshBasicMaterial({ color: 0x98FB98, side: THREE.DoubleSide });
                const plane = new THREE.Mesh(planeGeometry, planeMaterial);
                plane.rotation.x = -Math.PI / 2;

                const px = Math.round(point.x / 50) * 50;
                const pz = Math.round(point.z / 50) * 50;
                plane.position.set(px, 0, pz);
                this.scene.add(plane);
            }
        });
    }

    createContinuousFence(fencePoints, height = 2, thickness = 0.2, color = 0xffffff) {
        if (fencePoints.length < 2) return null;

        // Create fence segments between consecutive points
        const fenceGroup = new THREE.Group();

        for (let i = 0; i < fencePoints.length - 1; i++) {
            const start = fencePoints[i];
            const end = fencePoints[i + 1];

            const length = start.distanceTo(end);
            if (length < 0.1) continue; // Skip very small segments

            const geometry = new THREE.BoxGeometry(thickness, height, length);
            const material = new THREE.MeshLambertMaterial({ color });
            const fence = new THREE.Mesh(geometry, material);

            const mid = start.clone().add(end).multiplyScalar(0.5);
            fence.position.set(mid.x, mid.y + height / 2, mid.z);

            const direction = end.clone().sub(start);
            const angle = Math.atan2(direction.x, direction.z);
            fence.rotation.y = angle;

            fenceGroup.add(fence);
        }

        return fenceGroup;
    }

    // Check if two line segments intersect (2D check, ignoring Y)
    linesIntersect(p1, q1, p2, q2) {
        const orientation = (p, q, r) => {
            const val = (q.z - p.z) * (r.x - q.x) - (q.x - p.x) * (r.z - q.z);
            if (Math.abs(val) < 0.001) return 0; // Collinear
            return val > 0 ? 1 : 2; // Clockwise or counterclockwise
        };

        const onSegment = (p, q, r) => {
            return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) &&
                q.z <= Math.max(p.z, r.z) && q.z >= Math.min(p.z, r.z);
        };

        const o1 = orientation(p1, q1, p2);
        const o2 = orientation(p1, q1, q2);
        const o3 = orientation(p2, q2, p1);
        const o4 = orientation(p2, q2, q1);

        // General case
        if (o1 !== o2 && o3 !== o4) return true;

        // Special cases
        if (o1 === 0 && onSegment(p1, p2, q1)) return true;
        if (o2 === 0 && onSegment(p1, q2, q1)) return true;
        if (o3 === 0 && onSegment(p2, p1, q2)) return true;
        if (o4 === 0 && onSegment(p2, q1, q2)) return true;

        return false;
    }

    // Remove self-intersecting segments from fence points
    removeSelfIntersections(fencePoints) {
        if (fencePoints.length < 4) return fencePoints;

        const cleanedPoints = [fencePoints[0]];

        for (let i = 1; i < fencePoints.length; i++) {
            const currentPoint = fencePoints[i];
            let shouldAdd = true;

            // Check if adding this point would create intersections with previous segments
            if (cleanedPoints.length >= 2) {
                const newSegmentStart = cleanedPoints[cleanedPoints.length - 1];
                const newSegmentEnd = currentPoint;

                // Check against all previous segments except the immediate previous one
                for (let j = 0; j < cleanedPoints.length - 2; j++) {
                    const prevSegmentStart = cleanedPoints[j];
                    const prevSegmentEnd = cleanedPoints[j + 1];

                    if (this.linesIntersect(newSegmentStart, newSegmentEnd, prevSegmentStart, prevSegmentEnd)) {
                        shouldAdd = false;
                        break;
                    }
                }
            }

            // Also check minimum distance to prevent overcrowding
            if (shouldAdd && cleanedPoints.length > 0) {
                const lastPoint = cleanedPoints[cleanedPoints.length - 1];
                const distance = currentPoint.distanceTo(lastPoint);
                if (distance < 2.0) { // Minimum distance threshold
                    shouldAdd = false;
                }
            }

            if (shouldAdd) {
                cleanedPoints.push(currentPoint);
            }
        }

        return cleanedPoints;
    }

    generateFencePoints(roadPoints, roadWidth = 12, fenceOffset = 20) { // Doubled from 10 to 20
        const leftFencePoints = [];
        const rightFencePoints = [];

        for (let i = 0; i < roadPoints.length; i++) {
            const point = roadPoints[i];
            const pos = new THREE.Vector3(point.x, (point.y || 0.01) + 0.02, point.z);
            let perpendicular;

            // Calculate perpendicular direction for fence offset
            if (i === 0 && roadPoints.length > 1) {
                const next = new THREE.Vector3(roadPoints[i + 1].x, roadPoints[i + 1].y || 0, roadPoints[i + 1].z);
                const forward = next.clone().sub(pos).normalize();
                perpendicular = new THREE.Vector3(-forward.z, 0, forward.x);
            } else if (i === roadPoints.length - 1) {
                const prev = new THREE.Vector3(roadPoints[i - 1].x, roadPoints[i - 1].y || 0, roadPoints[i - 1].z);
                const forward = pos.clone().sub(prev).normalize();
                perpendicular = new THREE.Vector3(-forward.z, 0, forward.x);
            } else {
                const prev = new THREE.Vector3(roadPoints[i - 1].x, roadPoints[i - 1].y || 0, roadPoints[i - 1].z);
                const next = new THREE.Vector3(roadPoints[i + 1].x, roadPoints[i + 1].y || 0, roadPoints[i + 1].z);
                const forward1 = pos.clone().sub(prev).normalize();
                const forward2 = next.clone().sub(pos).normalize();
                const avgForward = forward1.add(forward2).normalize();
                perpendicular = new THREE.Vector3(-avgForward.z, 0, avgForward.x);
            }

            // Create fence points at offset distance from road
            const leftPoint = pos.clone().add(perpendicular.clone().multiplyScalar((roadWidth / 2) + fenceOffset));
            const rightPoint = pos.clone().add(perpendicular.clone().multiplyScalar(-(roadWidth / 2) - fenceOffset));

            leftFencePoints.push(leftPoint);
            rightFencePoints.push(rightPoint);
        }

        // Remove self-intersections from both fence lines
        const cleanedLeftPoints = this.removeSelfIntersections(leftFencePoints);
        const cleanedRightPoints = this.removeSelfIntersections(rightFencePoints);

        return { leftFencePoints: cleanedLeftPoints, rightFencePoints: cleanedRightPoints };
    }

    addContinuousFences(roadPoints, physicsManager) {
        const { leftFencePoints, rightFencePoints } = this.generateFencePoints(roadPoints);

        // Connect with previous fence points if they exist
        let finalLeftPoints = [...leftFencePoints];
        let finalRightPoints = [...rightFencePoints];

        if (this.lastLeftFenceEnd && this.lastRightFenceEnd) {
            // Add connecting points to ensure continuity
            finalLeftPoints.unshift(this.lastLeftFenceEnd);
            finalRightPoints.unshift(this.lastRightFenceEnd);
        }

        // Create continuous fence meshes
        const leftFence = this.createContinuousFence(finalLeftPoints);
        const rightFence = this.createContinuousFence(finalRightPoints);

        if (leftFence) {
            this.scene.add(leftFence);

            // Add physics colliders for left fence
            for (let i = 0; i < finalLeftPoints.length - 1; i++) {
                physicsManager.addFenceCollider(finalLeftPoints[i], finalLeftPoints[i + 1]);
            }
        }

        if (rightFence) {
            this.scene.add(rightFence);

            // Add physics colliders for right fence
            for (let i = 0; i < finalRightPoints.length - 1; i++) {
                physicsManager.addFenceCollider(finalRightPoints[i], finalRightPoints[i + 1]);
            }
        }

        // Store the end points for next segment continuity
        this.lastLeftFenceEnd = leftFencePoints[leftFencePoints.length - 1];
        this.lastRightFenceEnd = rightFencePoints[rightFencePoints.length - 1];
    }

    addCurvyRoadSegment(points, physicsManager) {
        if (!points || points.length < 2) return;

        const segmentKey = `${Math.round(points[0].x * 10)},${Math.round(points[0].z * 10)}-${Math.round(points[points.length-1].x * 10)},${Math.round(points[points.length-1].z * 10)}`;
        if (this.generatedSegments.has(segmentKey)) return;

        this.generatedSegments.add(segmentKey);

        // Create visual road
        const roadMesh = this.createRoadStrip(points);
        if (roadMesh) this.scene.add(roadMesh);

        // Add grids
        this.addGridsForRoadPoints(points);

        // Add physics colliders through physics manager
        physicsManager.addRoadColliders(points);

        // Add continuous fences
        this.addContinuousFences(points, physicsManager);

        // Add background trees outside fences
        this.generateTrees(points);

        // Add coins on this segment
        this.generateCoinClusters(points);

        // NPC generation is now handled procedurally in render()
    }

    setupNextFrame(x, y = 0, z, angle = 0) {
        this.roadSegments.push({ x, y, z, angle });
    }

    interpolateRoadPoints(points, subdivisions = 2) {
        if (points.length < 2) return points;

        const interpolated = [points[0]];

        for (let i = 0; i < points.length - 1; i++) {
            const current = points[i];
            const next = points[i + 1];

            for (let j = 1; j <= subdivisions; j++) {
                const t = j / (subdivisions + 1);
                const interpolatedPoint = {
                    x: current.x + (next.x - current.x) * t,
                    y: current.y + (next.y - current.y) * t,
                    z: current.z + (next.z - current.z) * t,
                    angle: current.angle + (next.angle - current.angle) * t
                };
                interpolated.push(interpolatedPoint);
            }

            if (i < points.length - 2) {
                interpolated.push(next);
            }
        }

        interpolated.push(points[points.length - 1]);
        return interpolated;
    }

    generateNewRoadSegments(x, y, z, physicsManager) {
        try {
            const roadPoints = generateRoadSchematic(x, y, z);
            if (roadPoints && Array.isArray(roadPoints)) {
                const smoothedPoints = this.interpolateRoadPoints(roadPoints, 2);
                smoothedPoints.forEach(point => {
                    if (point && typeof point.x === 'number' && typeof point.z === 'number') {
                        this.setupNextFrame(point.x, point.y || 0, point.z, point.angle || 0);
                    }
                });
            }

            this.lastRoad = roadPoints[roadPoints.length - 1];
            const segmentCount = this.roadSegments.length;

            if (segmentCount > this.lastGeneratedSegmentCount + 8) {
                let segmentsToProcess = this.roadSegments.slice(this.lastGeneratedSegmentCount);

                if (this.lastRoadEndPoint) {
                    segmentsToProcess = [this.lastRoadEndPoint, ...segmentsToProcess];
                }

                if (
                    segmentsToProcess.length > 1 &&
                    segmentsToProcess[0].x === segmentsToProcess[1].x &&
                    segmentsToProcess[0].z === segmentsToProcess[1].z
                ) {
                    segmentsToProcess.shift();
                }

                if (segmentsToProcess.length > 1) {
                    this.addCurvyRoadSegment(segmentsToProcess, physicsManager);
                    this.lastRoadEndPoint = segmentsToProcess[segmentsToProcess.length - 1];
                    this.lastRoadEndPoint.z += 3;
                    this.lastGeneratedSegmentCount = segmentCount;
                }
            }
        } catch (error) {
            console.warn('Road generation failed:', error);
            const fallbackZ = this.lastPlayerZ - 50;
            this.setupNextFrame(0, 0, fallbackZ, 0);
        }
    }
    updatePlayerCamera(player) {

        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(player.quaternion).normalize();
        const heightOffset = 4;
        const backDistance = 12;
        const targetPos = player.position.clone()
            .add(new THREE.Vector3(0, heightOffset, 0))
            .add(forward.clone().multiplyScalar(-backDistance));

        this.playerCamera.position.copy(targetPos);
        this.playerCamera.lookAt(player.position);
    }

    updateUI(player, car) {
        // Update coordinates
        this.coordinatesCard.textContent = `Coordinates: (${player.position.x.toFixed(2)}, ${player.position.y.toFixed(2)}, ${player.position.z.toFixed(2)})`;

        // Calculate gradient color based on speed
        const speed = car.velocity.length();
        let color;
        if (speed <= 50) {
            // Interpolate white to yellow
            const t = speed / 50;
            const r = Math.round(255 * (1 - t) + 255 * t);
            const g = Math.round(255 * (1 - t) + 224 * t);
            const b = Math.round(255 * (1 - t) + 102 * t);
            color = `rgb(${r},${g},${b})`;
        } else {
            // Interpolate yellow to light red
            const t = Math.min((speed - 50) / 50, 1);
            const r = Math.round(255 * (1 - t) + 255 * t);
            const g = Math.round(224 * (1 - t) + 111 * t);
            const b = Math.round(102 * (1 - t) + 111 * t);
            color = `rgb(${r},${g},${b})`;
        }
        this.carStatsCard.style.background = `radial-gradient(circle at 60% 40%, ${color} 70%, #ccc 100%)`;
        this.carStatsCard.textContent = `${speed.toFixed(0)} \n mph`;
        // Update control debug
        const c = car.controls;
        this.ctrlDebug.textContent = `W:${c.forward?'1':'0'} S:${c.backward?'1':'0'} A:${c.left?'1':'0'} D:${c.right?'1':'0'} HB:${c.handbrake?'1':'0'}\nSpeed:${car.velocity.length().toFixed(2)}`;

        // Score calc - include cars hit for bonus points
        const score = Math.floor(Math.abs(player.position.z)) + this.coinsCollected * 100 + this.carsHit * 1000;
        if (this.scoreCard) this.scoreCard.textContent = `Score: ${score}`;
    }

    render(player, car, physicsManager) {
        // Store player position for NPC distance checks
        this.playerPosition = player.position.clone();

        // Generate new road segments if needed
        const newThumbCount = getLatestThumbCount();
        if (newThumbCount !== this.lastThumbCount) {
            this.usePlayerCamera = !this.usePlayerCamera;
            this.lastThumbCount = newThumbCount;
        }
        if (player.position.z < this.lastRoad.z + 400) {
            this.generateNewRoadSegments(this.lastRoad.x, this.lastRoad.y, this.lastRoad.z, physicsManager);
        }

        // Procedurally generate NPCs ahead of the player
        this.generateNpcCarsInfinite(player.position.z, physicsManager);

        // Cleanup distant NPCs behind the player
        this.cleanupDistantNpcCars(player.position.z, physicsManager);

        // Register NPC cars and car hit callback with physics manager for collision detection
        if (physicsManager) {
            physicsManager.registerNpcCars(this.npcCars);
            physicsManager.setCarHitCallback(() => this.onCarHit());
        }

        // Update NPC cars
        this.updateNpcCars(1/60, physicsManager); // Assuming 60 FPS

        // Update cameras
        if (!this.usePlayerCamera) {
            this.overviewCamera.position.set(
                player.position.x,
                player.position.y + 40,
                player.position.z + 20
            );
            this.overviewCamera.lookAt(player.position.x, 0, player.position.z - 10);
        } else {
            this.updatePlayerCamera(player);
        }

        // Update UI
        this.updateUI(player, car);

        // Update coins (rotation + collection)
        this.updateCoins(car);
        // Update score popups
        this.updateScorePopups();

        // Render scene
        const camera = this.usePlayerCamera ? this.playerCamera : this.overviewCamera;
        this.renderer.render(this.scene, camera);
    }

    getScene() {
        return this.scene;
    }

    // ===== Score Popup System (restored) =====
    createScorePopup(amount = 100) {
        const el = document.createElement('div');
        el.textContent = `+${amount}`;
        el.style.position = 'absolute';
        el.style.pointerEvents = 'none';
        el.style.left = '50%';
        el.style.top = '55%';
        el.style.transform = 'translate(-50%, -50%)';
        el.style.fontFamily = 'monospace';
        el.style.fontSize = '28px';
        el.style.fontWeight = 'bold';
        el.style.color = '#FFD700';
        el.style.textShadow = '0 0 6px rgba(255,215,0,0.9), 0 0 12px rgba(255,140,0,0.6)';
        el.style.opacity = '1';
        document.body.appendChild(el);
        this.scorePopups.push({ el, start: performance.now(), duration: 1000, y: 0, vy: -0.04 });
    }

    updateScorePopups() {
        if (!this.scorePopups.length) return;
        const now = performance.now();
        for (let i = this.scorePopups.length - 1; i >= 0; i--) {
            const p = this.scorePopups[i];
            const t = (now - p.start) / p.duration;
            if (t >= 1) {
                p.el.remove();
                this.scorePopups.splice(i, 1);
                continue;
            }
            p.y += p.vy;
            const ease = t*t*(3-2*t);
            const opacity = 1 - ease;
            p.el.style.opacity = opacity.toFixed(3);
            p.el.style.transform = `translate(-50%, calc(-50% + ${p.y * 120}px))`;
        }
    }

    // ================= Coin System =================
    createCoin(x, y, z) {
        const mesh = new THREE.Mesh(this.coinGeometry, this.coinMaterial);
        mesh.position.set(x, y, z);
        mesh.rotation.x = Math.PI / 2; // face camera style (flat vertical)
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        this.coinGroup.add(mesh);
        this.coins.push({ mesh, collected: false });
        return mesh;
    }

    generateCoinClusters(roadPoints) {
        if (!roadPoints || roadPoints.length < 2) return;
        // Chance to create clusters along the segment
        for (let i = 1; i < roadPoints.length - 1; i++) {
            if (Math.random() > 0.15) continue; // ~15% of candidate points spawn a cluster

            const current = roadPoints[i];
            const next = roadPoints[i + 1];
            const dir = new THREE.Vector3(next.x - current.x, 0, next.z - current.z).normalize();
            if (dir.lengthSq() === 0) continue;

            // Slight lateral offset randomly (left/right of center of road)
            const lateral = new THREE.Vector3(-dir.z, 0, dir.x); // perpendicular
            const lateralOffset = (Math.random() - 0.5) * 4; // within road width roughly
            const basePos = new THREE.Vector3(current.x, 1, current.z).add(lateral.multiplyScalar(lateralOffset));

            const count = 3 + Math.floor(Math.random() * 2); // 3-4 coins
            const spacing = 1.6; // distance between coins along direction
            // Debug log first coin in cluster
            console.debug('[Coins] Spawning cluster', count, 'at index', i, 'pos', basePos.x.toFixed(2), basePos.z.toFixed(2));
            for (let c = 0; c < count; c++) {
                const jitter = (Math.random() - 0.5) * 0.4;
                const pos = basePos.clone().add(dir.clone().multiplyScalar(c * spacing + jitter));
                // Vertical bob base offset random seed
                pos.y = 1 + Math.random() * 0.2;
                this.createCoin(pos.x, pos.y, pos.z);
            }
        }
    }

    updateCoins(car) {
        if (!car || !this.coins.length) return;
        const carPos = car.position; // Vector3 from car object
        const collectRadiusSq = 1.2 * 1.2;
        const time = performance.now() * 0.001;
        for (const coin of this.coins) {
            if (coin.collected) continue;
            const mesh = coin.mesh;
            // Simple spin & gentle bob
            mesh.rotation.z += 0.08; // because we rotated X 90deg
            mesh.position.y += Math.sin(time * 2 + mesh.id * 0.3) * 0.002; // subtle

            const dx = mesh.position.x - carPos.x;
            const dz = mesh.position.z - carPos.z;
            if (dx * dx + dz * dz < collectRadiusSq) {
                // Collected
                coin.collected = true;
                mesh.visible = false;
                this.coinGroup.remove(mesh);
                this.coinsCollected += 1;
                this.createScorePopup(100);
            }
        }
        // Optionally prune collected coins array over time
        if (this.coins.length > 200) {
            this.coins = this.coins.filter(c => !c.collected);
        }
    }

    selectRandomPoints(nearbyRoadPoints, numCars) {
        const selected = [];
        const attempts = numCars * 5; // Limit attempts to avoid infinite loops
        let tries = 0;

        while (selected.length < numCars && tries < attempts) {
            const idx = Math.floor(Math.random() * nearbyRoadPoints.length);
            const candidate = nearbyRoadPoints[idx];
            if (selected.includes(candidate)) {
                tries++;
                continue; // Already selected
            }
            // Ensure minimum distance from already selected points
            let tooClose = false;
            for (const sel of selected) {
                const distSq = (candidate.x - sel.x) ** 2 + (candidate.z - sel.z) ** 2;
                if (distSq < 25) { // Minimum 5 units apart
                    tooClose = true;
                    break;
                }
            }
            if (!tooClose) {
                selected.push(candidate);
            }
            tries++;
        }

        return selected;
    }
}