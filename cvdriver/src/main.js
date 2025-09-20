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
coordinatesCard.style.bottom = '10px';
coordinatesCard.style.left = '10px';
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
scene.background = new THREE.Color(0xeeeeee);

// Add large grid helper (black lines)
const gridSize = 1000;
const gridDivisions = 1000;
const gridHelper = new THREE.GridHelper(gridSize, gridDivisions, 0x000000, 0x000000);
gridHelper.position.y = 0;
scene.add(gridHelper);

// Track generated road segments to avoid duplicates
const generatedSegments = new Set();
let lastPlayerZ = 0;

// used to generate new roads
function addRoadSegment(x, y = 0, z, theta = 0) {
    const roadWidth = 12;
    const roadLength = 20;
    const roadGeometry = new THREE.PlaneGeometry(roadWidth, roadLength);
    const roadMaterial = new THREE.MeshBasicMaterial({ color: 0x333333 });
    const road = new THREE.Mesh(roadGeometry, roadMaterial);
    road.rotation.x = -Math.PI / 2;
    road.rotation.y = theta; // Apply rotation around Y axis for curves
    road.position.set(x, y + 0.01, z);
    scene.add(road);
}

function setupNextFrame(x, y = 0, z, theta = 0) {
    // Create unique key for this segment
    const segmentKey = `${Math.round(x * 10)},${Math.round(z * 10)}`;

    // Skip if already generated
    if (generatedSegments.has(segmentKey)) {
        return;
    }
    generatedSegments.add(segmentKey);

    // Add the road segment
    addRoadSegment(x, y, z, theta);

    // Add grid helper for this section
    const gridHelper = new THREE.GridHelper(100, 100, 0x000000, 0x000000);
    gridHelper.position.set(x, 0, z);
    scene.add(gridHelper);

    // Add physics collider for this road segment
    const roadColliderDesc = RAPIER.ColliderDesc.cuboid(2, 0.1, 10);
    roadColliderDesc.setTranslation(x, y, z);
    world.createCollider(roadColliderDesc, groundRigidBody);
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
function generateNewRoadSegments(x, y, z) {
    try {
        const roadPoints = generateRoadSchematic(x, y, z);
        if (roadPoints && Array.isArray(roadPoints)) {
            roadPoints.forEach(point => {
                if (point && typeof point.x === 'number' && typeof point.z === 'number') {
                    setupNextFrame(point.x, point.y || 0, point.z, point.theta || 0);
                }
            });
        }
        lastRoad = roadPoints[roadPoints.length - 1];
    } catch (error) {
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
    if (player.position.z < lastRoad.z + 100) {
        lastPlayerZ = player.position.z;
        generateNewRoadSegments(lastRoad.x, lastRoad.y, lastRoad.z);
    }

    // Update overview camera to follow player loosely
    if (!usePlayerCamera) {
        overviewCamera.position.set(
            player.position.x,
            player.position.y + 20,
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