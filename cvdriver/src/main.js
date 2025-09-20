import * as THREE from 'three';
import { Car } from './playerobject.js';
import { generateRoadSchematic } from "./mapgen.js";

// Import and initialize Rapier physics
let RAPIER, world, playerRigidBody, groundRigidBody;

async function initPhysics() {
    // Load Rapier from CDN
    RAPIER = await import('https://cdn.skypack.dev/@dimforge/rapier3d-compat');
    await RAPIER.init();

    // Create physics world with gravity
    const gravity = { x: 0.0, y: 0, z: 0.0 };
    world = new RAPIER.World(gravity);

    // Create ground physics body
    const groundColliderDesc = RAPIER.ColliderDesc.cuboid(2, 0.1, 10);
    world.createCollider(groundColliderDesc);

    // Create player physics body
    const playerColliderDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.1, 0.5);
    const playerRigidBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, 0);
    playerRigidBody = world.createRigidBody(playerRigidBodyDesc);
    world.createCollider(playerColliderDesc, playerRigidBody);
}

// Add toggle button
const toggleBtn = document.createElement('button');
toggleBtn.textContent = 'Toggle Camera';
toggleBtn.style.position = 'absolute';
toggleBtn.style.top = '10px';
toggleBtn.style.left = '10px';
document.body.appendChild(toggleBtn);

const coordinatesCard = document.createElement('div');
coordinatesCard.style.position = 'absolute';
coordinatesCard.style.top = '10px';
coordinatesCard.style.right = '10px';
coordinatesCard.style.padding = '10px';
coordinatesCard.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
coordinatesCard.style.fontFamily = 'monospace';
coordinatesCard.style.fontSize = '14px';
coordinatesCard.textContent = 'Coordinates: (0, 0, 0)';
document.body.appendChild(coordinatesCard);

const carStatsCard = document.createElement('div');
carStatsCard.style.position = 'absolute';
carStatsCard.style.bottom = '10px';
carStatsCard.style.right = '10px';
carStatsCard.style.padding = '10px';
carStatsCard.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
carStatsCard.style.fontFamily = 'monospace';
carStatsCard.style.fontSize = '14px';
carStatsCard.textContent = 'Speed: 0 | Steering: 0';
document.body.appendChild(carStatsCard);

// Get the canvas element
const canvas = document.getElementById('three-canvas');

// Create renderer
const renderer = new THREE.WebGLRenderer({ canvas });
renderer.setSize(window.innerWidth, window.innerHeight);

// Create scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0096FF);

// Track generated road segments and grids to avoid duplicates
const generatedSegments = new Set();
const generatedGrids = new Set(); // Track generated grids separately
let lastPlayerZ = 0;
const roadSegments = []; // Store all road points for continuous generation

// Alternative method using ribbon/strip geometry for better performance
function createRoadStrip(points, roadWidth = 12) {
    if (points.length < 2) return null;

    const vertices = [];
    const indices = [];
    const normals = [];
    const uvs = [];

    // Create vertices for both sides of the road
    for (let i = 0; i < points.length; i++) {
        const point = points[i];
        const pos = new THREE.Vector3(point.x, (point.y || 0.01) + 0.02, point.z);

        // Calculate perpendicular direction for road width
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

        normals.push(0, 1, 0);
        normals.push(0, 1, 0);

        const u = i / (points.length - 1);
        uvs.push(0, u);
        uvs.push(1, u);

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

    const material = new THREE.MeshLambertMaterial({
        color: 0x36454F,
        side: THREE.DoubleSide
    });

    return new THREE.Mesh(geometry, material);
}

// Function to add grid helpers along the road path
function addGridsForRoadPoints(points) {
    points.forEach((point, index) => {
        if (index % 4 === 0) {
            const gridKey = `grid_${Math.round(point.x / 50) * 50}_${Math.round(point.z / 50) * 50}`;
            if (generatedGrids.has(gridKey)) {
                return;
            }
            generatedGrids.add(gridKey);

            // Create a plane at this position
            const planeGeometry = new THREE.PlaneGeometry(300, 100);
            const planeMaterial = new THREE.MeshBasicMaterial({ color: 0x98FB98, side: THREE.DoubleSide });
            const plane = new THREE.Mesh(planeGeometry, planeMaterial);

            // Rotate to lie flat (XZ plane)
            plane.rotation.x = -Math.PI / 2;
            plane.position.set(
                Math.round(point.x / 50) * 50,
                0,
                Math.round(point.z / 50) * 50
            );
            scene.add(plane);
        }
    });
}

// Modified function to add curved road segments
function addCurvyRoadSegment(points) {
    if (!points || points.length < 2) return;

    // Create unique key for this segment group
    const segmentKey = `${Math.round(points[0].x * 10)},${Math.round(points[0].z * 10)}-${Math.round(points[points.length-1].x * 10)},${Math.round(points[points.length-1].z * 10)}`;

    // Skip if already generated
    if (generatedSegments.has(segmentKey)) {
        return;
    }
    generatedSegments.add(segmentKey);

    // Create the curved road mesh
    const roadMesh = createRoadStrip(points);
    if (roadMesh) {
        scene.add(roadMesh);
    }

    // Add grid helpers for this road segment
    addGridsForRoadPoints(points);

    // Add physics colliders along the road path
    points.forEach((point, index) => {
        if (index % 3 === 0) { // Add colliders every 3rd point to avoid too many
            const roadColliderDesc = RAPIER.ColliderDesc.cuboid(6, 0.1, 6);
            roadColliderDesc.setTranslation(point.x, point.y || 0, point.z);
            world.createCollider(roadColliderDesc, groundRigidBody);
        }
    });
}

function setupNextFrame(x, y = 0, z, angle = 0) {
    // Add this point to our road segments array
    roadSegments.push({ x, y, z, angle });
}

// Car (replaces previous red cube player)
const car = new Car(scene);
// For existing camera logic expecting `player`, alias to car group
const player = car.carGroup;

// Basic lighting for Car's Lambert materials
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
dirLight.position.set(5, 10, 2);
scene.add(dirLight);

// Cameras
const overviewCamera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);
overviewCamera.position.set(0, 20, 20);
overviewCamera.lookAt(0, 0, 0);

const playerCamera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);

let usePlayerCamera = false;
toggleBtn.addEventListener('click', () => {
    usePlayerCamera = !usePlayerCamera;
});

function updatePlayerCamera() {
    // Determine forward direction from car orientation (car faces -Z initially)
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(player.quaternion).normalize();
    const heightOffset = 4;    // higher camera
    const backDistance = 12;   // farther back for zoomed out view
    const targetPos = player.position.clone()
        .add(new THREE.Vector3(0, heightOffset, 0))
        .add(forward.clone().multiplyScalar(-backDistance)); // move opposite forward to get behind
    playerCamera.position.copy(targetPos);
    playerCamera.lookAt(player.position);
}

let lastRoad = { x: 0, y: 0, z: 0, theta: 0 };
let lastGeneratedSegmentCount = 0;
let lastRoadEndPoint = null; // Save the last point from previous road segment

// Function to interpolate between road points for smoother curves
function interpolateRoadPoints(points, subdivisions = 2) {
    if (points.length < 2) return points;

    const interpolated = [points[0]]; // Start with first point

    for (let i = 0; i < points.length - 1; i++) {
        const current = points[i];
        const next = points[i + 1];

        // Add subdivisions between current and next point
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

        // Add the next point (except for the last iteration)
        if (i < points.length - 2) {
            interpolated.push(next);
        }
    }

    // Always add the final point
    interpolated.push(points[points.length - 1]);
    return interpolated;
}

function generateNewRoadSegments(x, y, z) {
    try {
        const roadPoints = generateRoadSchematic(x, y, z);
        if (roadPoints && Array.isArray(roadPoints)) {
            const smoothedPoints = interpolateRoadPoints(roadPoints, 2);

            smoothedPoints.forEach(point => {
                if (point && typeof point.x === 'number' && typeof point.z === 'number') {
                    setupNextFrame(point.x, point.y || 0, point.z, point.angle || 0);
                }
            });
        }
        lastRoad = roadPoints[roadPoints.length - 1];

        const segmentCount = roadSegments.length;
        if (segmentCount > lastGeneratedSegmentCount + 8) {
            let segmentsToProcess = roadSegments.slice(lastGeneratedSegmentCount);

            // Always prepend lastRoadEndPoint for continuity
            if (lastRoadEndPoint) {
                segmentsToProcess = [lastRoadEndPoint, ...segmentsToProcess];
            }

            // Remove duplicate points at the join (if any)
            if (
                segmentsToProcess.length > 1 &&
                segmentsToProcess[0].x === segmentsToProcess[1].x &&
                segmentsToProcess[0].z === segmentsToProcess[1].z
            ) {
                segmentsToProcess.shift();
            }

            if (segmentsToProcess.length > 1) {
                addCurvyRoadSegment(segmentsToProcess);

                lastRoadEndPoint = segmentsToProcess[segmentsToProcess.length - 1];
                lastRoadEndPoint.z += 3
                lastGeneratedSegmentCount = segmentCount;
            }
        }
    }
    catch (error) {
        console.warn('Road generation failed:', error);
        // Fallback: generate a simple straight road segment
        const fallbackZ = lastPlayerZ - 50;
        setupNextFrame(0, 0, fallbackZ, 0);
    }
}

// Animation loop
let lastTime = performance.now();
function animate() {
    const now = performance.now();
    const delta = (now - lastTime) / 1000;
    lastTime = now;

    if (lastRoad.z === 0) {
        generateNewRoadSegments(0, 0, 0);
    }

    if (world && playerRigidBody) {
        // Step physics simulation
        world.step();
    }

    // Update car simulation
    car.update(delta);

    // Update coordinates display
    coordinatesCard.textContent = `Coordinates: (${player.position.x.toFixed(2)}, ${player.position.y.toFixed(2)}, ${player.position.z.toFixed(2)})`;
    carStatsCard.textContent = `Speed: ${car.velocity.length().toFixed(2)} | Steering: ${car.rotation.toFixed(2)}`;

    // Generate new road segments when player moves forward significantly
    if (player.position.z < lastRoad.z + 400) {
        lastPlayerZ = player.position.z;
        generateNewRoadSegments(lastRoad.x, lastRoad.y, lastRoad.z);
    }

    // Update overview camera to follow player loosely
    if (!usePlayerCamera) {
        overviewCamera.position.set(
            player.position.x,
            player.position.y + 40,
            player.position.z + 20
        );
        overviewCamera.lookAt(player.position.x, 0, player.position.z - 10);
    }

    if (usePlayerCamera) {
        updatePlayerCamera();
        renderer.render(scene, playerCamera);
    } else {
        renderer.render(scene, overviewCamera);
    }

    requestAnimationFrame(animate);
}

// Initialize physics then start animation
initPhysics().then(() => {
    animate();
});

// Handle window resize
window.addEventListener('resize', () => {
    overviewCamera.aspect = window.innerWidth / window.innerHeight;
    overviewCamera.updateProjectionMatrix();
    playerCamera.aspect = window.innerWidth / window.innerHeight;
    playerCamera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});