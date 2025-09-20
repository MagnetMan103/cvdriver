import * as THREE from 'three';
import {generateRoadSchematic} from "./mapgen.js";

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
    //const groundRigidBodyDesc = RAPIER.RigidBodyDesc.fixed();
    //groundRigidBody = world.createRigidBody(groundRigidBodyDesc);
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

// Player
const playerSize = 1;
const playerGeometry = new THREE.BoxGeometry(playerSize, 0.2, playerSize);
const playerMaterial = new THREE.MeshBasicMaterial({ color: 0xff3333 });
const player = new THREE.Mesh(playerGeometry, playerMaterial);
player.position.set(0, 5, 0);
scene.add(player);

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

// Movement
const moveSpeed = 10;
const keys = {};

window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
});
window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
});

function updatePlayerPosition() {
    if (!playerRigidBody) return;

    const currentVel = playerRigidBody.linvel();

    let newVelX = currentVel.x;
    let newVelZ = currentVel.z;

    if (keys['ArrowUp'] || keys['KeyW']) newVelZ = -moveSpeed * 10;
    else if (keys['ArrowDown'] || keys['KeyS']) newVelZ = moveSpeed * 10;
    else newVelZ = 0;

    if (keys['ArrowLeft'] || keys['KeyA']) newVelX = -moveSpeed * 10;
    else if (keys['ArrowRight'] || keys['KeyD']) newVelX = moveSpeed * 10;
    else newVelX = 0;

    playerRigidBody.setLinvel({ x: newVelX, y: currentVel.y, z: newVelZ }, true);
}

function updatePlayerCamera() {
    playerCamera.position.set(
        player.position.x,
        player.position.y + 2,
        player.position.z + 3
    );
    playerCamera.lookAt(player.position.x, player.position.y, player.position.z - 5);
}
let lastRoad = { x: 0, y: 0, z: 0, theta: 0 };
function generateNewRoadSegments(x,y,z) {
    try {
        const roadPoints = generateRoadSchematic(x,y,z);
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
function animate() {
    if (lastRoad.z === 0) {
        generateNewRoadSegments(0, 0, 0);
    }
    if (world && playerRigidBody) {
        // Step physics simulation
        world.step();

        // Update player mesh position from physics body
        const position = playerRigidBody.translation();
        player.position.set(position.x, position.y, position.z);
        coordinatesCard.textContent = `Coordinates: (${position.x.toFixed(2)}, ${position.y.toFixed(
            2
        )}, ${position.z.toFixed(2)})`;

        // Update player rotation from physics body
        const rotation = playerRigidBody.rotation();
        player.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);

        // Generate new road segments when player moves forward significantly
        if (position.z < lastRoad.z + 100) {
            lastPlayerZ = position.z;
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
    }

    updatePlayerPosition();
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